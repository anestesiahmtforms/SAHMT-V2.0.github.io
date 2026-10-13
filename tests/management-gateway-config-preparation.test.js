import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {gatewayCanonicalJson, MANAGEMENT_GATEWAY_OPERATIONS} from '../scripts/lib/management-gateway-protocol.js';
import {compareHmacSecretBytes, compareWorkerGatewayContract, createDisabledManagementGatewayConfig,
  createExpectedWorkerGatewayContract, MANAGEMENT_GATEWAY_LIMITS, MANAGEMENT_HMAC_KEY_ID,
  MANAGEMENT_POLICY_VERSION, validateDisabledManagementGatewayConfig} from '../scripts/lib/management-gateway-config-preparation.js';

const build = () => createDisabledManagementGatewayConfig({actorEmail:'synthetic-gateway@example.invalid'});

test('candidate config matches exact Gateway fields and keeps every operation disabled', () => {
  const generated = build();
  const parsed = JSON.parse(generated.canonicalJson);
  assert.equal(parsed.enabled, false);
  assert.deepEqual(Object.keys(parsed).sort(), ['schemaVersion','enabled','actorEmailSha256','faSignerServiceAccountEmail',
    'signerServiceAccountEmail','fcSignerServiceAccountEmail','managementPolicyVersion','maxGoogleResponseBytes','policy','noncePolicy'].sort());
  assert.deepEqual(Object.keys(parsed.policy.enabledOperations).sort(), [...MANAGEMENT_GATEWAY_OPERATIONS].sort());
  assert.ok(MANAGEMENT_GATEWAY_OPERATIONS.every(operation => parsed.policy.enabledOperations[operation] === false));
  assert.equal(parsed.managementPolicyVersion, MANAGEMENT_POLICY_VERSION);
  assert.equal(parsed.policy.keyId, MANAGEMENT_HMAC_KEY_ID);
  assert.equal(parsed.policy.maximumTtlMs, MANAGEMENT_GATEWAY_LIMITS.maximumTtlMs);
  assert.deepEqual(validateDisabledManagementGatewayConfig(parsed), {canonicalJson:generated.canonicalJson,sha256:generated.sha256});
});

test('canonical JSON and lowercase SHA-256 match the Gateway protocol serializer', () => {
  const generated = build();
  assert.equal(generated.canonicalJson, gatewayCanonicalJson(generated.config, {maxBytes:8192}));
  assert.equal(generated.sha256, createHash('sha256').update(generated.canonicalJson,'utf8').digest('hex'));
  assert.match(generated.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Buffer.byteLength(generated.canonicalJson,'utf8') <= 8192);
});

test('actor email is normalized and only its digest is retained in generated config', () => {
  const generated = createDisabledManagementGatewayConfig({actorEmail:'  Synthetic-Gateway@Example.Invalid  '});
  assert.equal(generated.config.actorEmailSha256,
    createHash('sha256').update('synthetic-gateway@example.invalid','utf8').digest('hex'));
  assert.equal(generated.canonicalJson.includes('Synthetic-Gateway'), false);
  assert.equal(generated.canonicalJson.includes('synthetic-gateway@example.invalid'), false);
});

test('CLI emits only canonical config and pin; actor email and HMAC secret never appear', () => {
  const actorEmail='synthetic-gateway@example.invalid';
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/prepare-management-gateway-config.mjs',import.meta.url))],
    {encoding:'utf8',env:{...process.env,SAHMT_GATEWAY_ACTOR_EMAIL:actorEmail}});
  assert.equal(result.status,0);
  assert.equal(result.stderr,'');
  assert.equal(result.stdout.includes(actorEmail),false);
  assert.equal(result.stdout.includes('MANAGEMENT_GATEWAY_HMAC_SECRET_BASE64URL'),false);
  const output=JSON.parse(result.stdout);
  assert.equal(output.property,'MANAGEMENT_GATEWAY_CONFIG_JSON');
  assert.equal(output.sha256Property,'MANAGEMENT_GATEWAY_CONFIG_SHA256');
  assert.equal(output.value.includes('"enabled":false'),true);
  assert.match(output.sha256,/^[a-f0-9]{64}$/);
});

test('Gateway and Worker contracts match only when policy version, key ID and numeric bounds match', () => {
  const generated = build(), config = JSON.parse(generated.canonicalJson);
  const expected = createExpectedWorkerGatewayContract(config);
  assert.deepEqual(compareWorkerGatewayContract(config, expected), {
    compatible:true, brokerPolicyMatches:true, gatewayPolicyMatches:true
  });
  assert.deepEqual(compareWorkerGatewayContract(config, {...expected,
    brokerPolicy:{version:'different-authz-policy'}}), {
    compatible:false, brokerPolicyMatches:false, gatewayPolicyMatches:true
  });
  assert.deepEqual(compareWorkerGatewayContract(config, {...expected,
    gatewayPolicy:{...expected.gatewayPolicy,keyId:'different-key'}}), {
    compatible:false, brokerPolicyMatches:true, gatewayPolicyMatches:false
  });
  assert.deepEqual(compareWorkerGatewayContract(config, {...expected,
    gatewayPolicy:{...expected.gatewayPolicy,enabledOperations:{...expected.gatewayPolicy.enabledOperations,SIGN_FB_CUSTOM_TOKEN:true}}}), {
    compatible:false, brokerPolicyMatches:true, gatewayPolicyMatches:false
  });
});

test('HMAC secret comparison stays in memory and rejects malformed lengths', () => {
  const a = Uint8Array.from({length:32},(_,index)=>index+1);
  const same = Uint8Array.from(a), different = Uint8Array.from(a); different[0] ^= 1;
  assert.equal(compareHmacSecretBytes(a,same),true);
  assert.equal(compareHmacSecretBytes(a,different),false);
  assert.equal(compareHmacSecretBytes(a,Uint8Array.from({length:33},(_,index)=>index)),false);
  assert.throws(()=>compareHmacSecretBytes(new Uint8Array(31),same),{message:'GATEWAY_SECRET_INVALID'});
});

test('invalid, enabled or incomplete configs fail closed', () => {
  const valid = JSON.parse(build().canonicalJson);
  for (const mutate of [
    config=>{config.enabled=true;},
    config=>{config.policy.enabledOperations.SIGN_FC_CUSTOM_TOKEN=true;},
    config=>{config.policy.enabledOperations={...config.policy.enabledOperations,EXTRA:false};},
    config=>{config.policy.keyId='bad key';},
    config=>{config.policy.maximumTtlMs=120001;},
    config=>{config.noncePolicy.maxNonceRecords=513;},
    config=>{config.noncePolicy.maxPropertyBytes=9000;},
    config=>{config.noncePolicy.maxStorageBytes=400001;},
    config=>{config.extra='unapproved';},
    config=>{config.actorEmailSha256='not-a-hash';}
  ]) {
    const value=structuredClone(valid); mutate(value);
    assert.throws(()=>validateDisabledManagementGatewayConfig(value));
  }
  assert.throws(()=>createDisabledManagementGatewayConfig(),{message:'GATEWAY_ACTOR_EMAIL_REQUIRED'});
});
