import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, verify} from 'node:crypto';
import {verifyFaSession, canEnterModule, serviceIdentity} from '../worker-operational-domain/identity.js';
import {createOperationalDomainWorker} from '../worker-operational-domain/worker.js';

const now = 1800000000000;
const actor = {uid: 'synthetic-uid', email: 'member@example.test', emailVerified: true, authTime: now / 1000 - 100};
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (extra = {}) => b64({alg: 'RS256', kid: 'synthetic'}) + '.' + b64({aud: 'sahmt-17a16',
  iss: 'https://securetoken.google.com/sahmt-17a16', sub: actor.uid, email: actor.email,
  email_verified: true, exp: now / 1000 + 1000, iat: now / 1000 - 1, auth_time: actor.authTime, ...extra}) + '.' + 'x'.repeat(50);

test('never trusts decoded FA claims when Firebase rejects the signature', async () => {
  await assert.rejects(verifyFaSession('Bearer ' + token(), {apiKey: 'synthetic-public-key', now: () => now,
    fetchImpl: async () => Response.json({error: {message: 'INVALID_ID_TOKEN'}}, {status: 400})}), /DOMAIN_SESSION_INVALID/);
  let networkCalls = 0;
  await assert.rejects(verifyFaSession('Bearer ' + token({aud: 'other-project'}), {apiKey: 'synthetic-public-key', now: () => now,
    fetchImpl: async () => { networkCalls++; throw Error(); }}), /DOMAIN_SESSION_INVALID/);
  assert.equal(networkCalls, 0);
});

test('checks live account identity, disabled state and source revocation on exchange', async () => {
  const user = {localId: actor.uid, email: actor.email, emailVerified: true, validSince: String(actor.authTime - 1)};
  const invoke = override => verifyFaSession('Bearer ' + token(), {apiKey: 'synthetic-key', now: () => now,
    fetchImpl: async () => Response.json({users: [{...user, ...override}]})});
  assert.deepEqual(await invoke({}), actor);
  await assert.rejects(invoke({disabled: true}), /DOMAIN_SESSION_INVALID/);
  await assert.rejects(invoke({validSince: String(actor.authTime + 1)}), /DOMAIN_SESSION_INVALID/);
  await assert.rejects(invoke({localId: 'other-user'}), /DOMAIN_SESSION_INVALID/);
});

test('keeps access local to the selected module and refuses inactive or mismatched profiles', () => {
  const profile = {uid: actor.uid, email: actor.email, active: true, access: true, permissions: {scheduleRead: true}};
  assert.equal(canEnterModule(profile, actor, 'FJ'), true);
  assert.equal(canEnterModule(profile, actor, 'FI'), false);
  assert.equal(canEnterModule({...profile, active: false}, actor, 'FJ'), false);
  assert.equal(canEnterModule({...profile, uid: 'other-user'}, actor, 'FJ'), false);
});

test('signs a destination-specific custom token with the preserved FA UID', () => {
  const keys = generateKeyPairSync('rsa', {modulusLength: 2048});
  const credentials = {project_id: 'sahmt-escala-fj', client_email: 'fj-module-worker@sahmt-escala-fj.iam.gserviceaccount.com',
    private_key: keys.privateKey.export({type: 'pkcs8', format: 'pem'})};
  const service = serviceIdentity(credentials, 'FJ', {now: () => now});
  const parts = service.customToken(actor).split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')), keys.publicKey, Buffer.from(parts[2], 'base64url')), true);
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  assert.equal(claims.uid, actor.uid);
  assert.equal(claims.claims.moduleStation, 'FJ');
  assert.equal(claims.claims.sourceProjectId, 'sahmt-17a16');
  assert.equal(claims.claims.moduleLeaseExpiresAt, now / 1000 + 300);
  assert.equal(claims.exp - claims.iat, 300);
  assert.throws(() => serviceIdentity(credentials, 'FI'), /DOMAIN_CONFIG_REQUIRED/);
});

test('session endpoint checks central access and reads only its own destination profile with the service credential', async () => {
  const urls = [];
  const worker = createOperationalDomainWorker({verify: async () => actor,
    createService: () => ({accessToken: async () => 'synthetic', customToken: () => 'synthetic-custom-token'}),
    fetchImpl: async url => { urls.push(url); return Response.json({name: url.replace('https://firestore.googleapis.com/v1/', ''), fields: {
      uid: {stringValue: actor.uid}, email: {stringValue: actor.email}, active: {booleanValue: true}, access: {booleanValue: true},
      permissions: {mapValue: {fields: {eventsRead: {booleanValue: true}}}}
    }}); }});
  const env = {MODULE_STATION: 'FI', MODULE_PROJECT_ID: 'sahmt-operacional-fi', MODULE_CUTOVER_ACTIVE: 'true', ALLOWED_ORIGINS: 'https://example.test', MODULE_SERVICE_ACCOUNT_JSON: '{}'};
  const response = await worker.fetch(new Request('https://worker.test/v1/session', {method: 'POST',
    headers: {Origin: 'https://example.test', Authorization: 'Bearer synthetic-fa-proof', 'Content-Type': 'application/json'}, body: '{}'}), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).uid, actor.uid);
  assert.deepEqual(urls, ['https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents/users/synthetic-uid',
    'https://firestore.googleapis.com/v1/projects/sahmt-operacional-fi/databases/(default)/documents/users/synthetic-uid']);
  const denied = await worker.fetch(new Request('https://worker.test/v1/session', {method: 'POST',
    headers: {Origin: 'https://attacker.test', 'Content-Type': 'application/json'}, body: '{}'}), env);
  assert.equal(denied.status, 403);
  assert.equal(urls.length, 2);
});

test('source access is checked with the FA proof before using any destination administrator credential', async () => {
  for (const source of [{active: false, access: true}, {active: true, access: false}, {missing: true}]) {
    let createdService = false; const urls = [];
    const worker = createOperationalDomainWorker({verify: async () => actor,
      createService: () => { createdService = true; throw Error('destination must not be used'); },
      fetchImpl: async (url, options) => {
        urls.push(url); assert.equal(options.headers.Authorization, 'Bearer synthetic-fa-proof');
        assert.equal(options.headers['X-Firebase-AppCheck'], 'synthetic-attestation');
        if (source.missing) return Response.json({}, {status: 404});
        return Response.json({name: url.replace('https://firestore.googleapis.com/v1/', ''), fields: {
          uid: {stringValue: actor.uid}, email: {stringValue: actor.email},
          active: {booleanValue: source.active}, access: {booleanValue: source.access}
        }});
      }});
    const response = await worker.fetch(new Request('https://worker.test/v1/session', {method: 'POST',
      headers: {Origin: 'https://example.test', Authorization: 'Bearer synthetic-fa-proof',
        'X-Firebase-AppCheck': 'synthetic-attestation', 'Content-Type': 'application/json'}, body: '{}'}),
    {MODULE_STATION: 'FI', MODULE_PROJECT_ID: 'sahmt-operacional-fi', MODULE_CUTOVER_ACTIVE: 'true', ALLOWED_ORIGINS: 'https://example.test'});
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'DOMAIN_SOURCE_ACCESS_DENIED');
    assert.equal(createdService, false);
    assert.deepEqual(urls, ['https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents/users/synthetic-uid']);
  }
});

test('schedule consumers retain access for operational events and checklist signatures', () => {
  for (const permission of ['eventsRead', 'eventsWrite', 'checklistSign']) {
    const profile = {uid: actor.uid, email: actor.email, active: true, access: true, permissions: {[permission]: true}};
    assert.equal(canEnterModule(profile, actor, 'FJ'), true);
  }
});

test('valid FA identities cannot open a destination session before the coordinated cutover', async () => {
  let reads = 0;
  const worker = createOperationalDomainWorker({verify: async () => actor, fetchImpl: async () => {reads++; throw Error('must not read');}});
  const response = await worker.fetch(new Request('https://worker.test/v1/session', {method: 'POST',
    headers: {Origin: 'https://example.test', 'Content-Type': 'application/json'}, body: '{}'}),
    {MODULE_STATION: 'FI', MODULE_PROJECT_ID: 'sahmt-operacional-fi', MODULE_CUTOVER_ACTIVE: 'false', ALLOWED_ORIGINS: 'https://example.test'});
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'DOMAIN_MODULE_NOT_ACTIVE'); assert.equal(reads, 0);
});
