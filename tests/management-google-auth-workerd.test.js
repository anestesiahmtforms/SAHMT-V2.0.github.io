import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

const TIME = 1800000000000;
const key = generateKeyPairSync('rsa', {modulusLength: 2048});
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const payload = () => ({sub: 'member-a', aud: 'sahmt-17a16', iss: 'https://securetoken.google.com/sahmt-17a16',
  auth_time: TIME / 1000 - 50, iat: TIME / 1000 - 10, exp: TIME / 1000 + 3590, email_verified: true,
  firebase: {sign_in_provider: 'google.com', identities: {'google.com': ['google-id-a']}}});
const tokenFor = claims => {
  const input = encode({alg: 'RS256', kid: 'synthetic-key', typ: 'JWT'}) + '.' + encode(claims);
  return input + '.' + sign('RSA-SHA256', Buffer.from(input), key.privateKey).toString('base64url');
};

function certificate(validFrom = TIME - 1000, validUntil = TIME + 600000) {
  const der = (tag, value) => {
    const body = Buffer.isBuffer(value) ? value : Buffer.concat(value);
    let length = body.length, bytes = [];
    do { bytes.unshift(length & 255); length >>>= 8; } while (length);
    return Buffer.concat([Buffer.from([tag]), body.length < 128 ? Buffer.from([body.length])
      : Buffer.from([128 + bytes.length, ...bytes]), body]);
  };
  const algorithm = Buffer.from('300d06092a864886f70d01010b0500', 'hex');
  const name = der(0x30, [der(0x31, [der(0x30, [Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('synthetic-only'))])])]);
  const timestamp = time => der(0x18, Buffer.from(new Date(time).toISOString().replace(/[-:]/g, '').replace('T', '').replace('.000', '')));
  const tbs = der(0x30, [der(0xa0, [Buffer.from([2, 1, 2])]), Buffer.from([2, 1, 1]), algorithm, name,
    der(0x30, [timestamp(validFrom), timestamp(validUntil)]), name, key.publicKey.export({type: 'spki', format: 'der'})]);
  const value = der(0x30, [tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), sign('RSA-SHA256', tbs, key.privateKey)]))]);
  return '-----BEGIN CERTIFICATE-----\n' + value.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
}

// The real adapter and native workerd fetch/crypto run here. The only external
// surfaces are an in-memory public certificate response and a synthetic lookup.
const entry = `import {createManagementGoogleAuthAdapter} from './scripts/lib/management-google-auth-adapter.js';
let adapter, lookups=0;
export default {async fetch(request){
 adapter??=createManagementGoogleAuthAdapter({enabled:true,fetchImpl:fetch,clock:()=>1800000000000,
  signerServiceAccountEmail:'management-broker@sahmt-gestao-5ae66.iam.gserviceaccount.com',
  privilegedGateway:{lookupAuthUser:async()=>{lookups++;return {users:[{localId:'member-a',emailVerified:true,
   disabled:false,validSince:'1799999900',providerUserInfo:[{providerId:'google.com',rawId:'google-id-a'}]}]};},
   signFbCustomToken:async()=>{}},
  policy:{operationTimeoutMs:15000,maxResponseBytes:65536,maxResponseChunks:128,maxKeyCacheMs:3600000,
   maxFutureSkewMs:5000,maxIdTokenLifetimeSeconds:3600,customTokenLifetimeSeconds:600}});
 try{const result=await adapter.verifyFaIdToken(await request.text(),true);
  return Response.json({ok:true,uidMatched:result.uid==='member-a',lookups});}
 catch(error){return Response.json({ok:false,code:error.code,lookups});}
}};`;
let bundle;
async function runFixture({pem = key.publicKey.export({type: 'spki', format: 'pem'}), status = 200, claims = payload(), count = 1} = {}) {
  bundle ??= await build({stdin: {contents: entry, resolveDir: process.cwd()}, bundle: true, write: false,
    platform: 'node', format: 'esm', target: 'es2022', external: ['node:*']});
  let mockCalls = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({name: 'verify', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-10', compatibilityFlags: ['nodejs_compat'], outboundService: async request => {
      mockCalls++;
      assert.equal(request.url, 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
      return status === 200 ? Response.json({'synthetic-key': pem}, {headers: {'cache-control': 'public, max-age=3600'}})
        : new Response(null, {status, headers: {location: 'https://never-follow.example.invalid/'}});
    }}));
  try {
    const results = [];
    for (let index = 0; index < count; index++) {
      const response = await mf.dispatchFetch('https://synthetic-adapter.example/', {method: 'POST', body: tokenFor(claims)});
      results.push(await response.json());
    }
    return {results, mockCalls};
  } finally { await mf.dispose(); }
}

test('workerd validates an RS256 FA JWT with a synthetic public key and reuses only parsed key data', async () => {
  const fixture = await runFixture({count: 2});
  assert.deepEqual(fixture.results, [{ok: true, uidMatched: true, lookups: 1}, {ok: true, uidMatched: true, lookups: 2}]);
  assert.equal(fixture.mockCalls, 1);
});

test('workerd validates real X509 certificate structure and preserves its cache across requests', async () => {
  const fixture = await runFixture({pem: certificate(), count: 2});
  assert.deepEqual(fixture.results, [{ok: true, uidMatched: true, lookups: 1}, {ok: true, uidMatched: true, lookups: 2}]);
  assert.equal(fixture.mockCalls, 1);
});

test('workerd rejects redirects without following them or looking up an account', async t => {
  for (const status of [301, 302, 307]) await t.test(String(status), async () => {
    const fixture = await runFixture({status});
    assert.deepEqual(fixture.results, [{ok: false, code: 'GOOGLE_RESPONSE_REJECTED', lookups: 0}]);
    assert.equal(fixture.mockCalls, 1);
  });
});

test('workerd rejects certificates outside their validity period before account lookup', async t => {
  for (const pem of [certificate(TIME - 60000, TIME - 1000), certificate(TIME + 1000, TIME + 60000)]) {
    await t.test('invalid validity', async () => {
      const fixture = await runFixture({pem});
      assert.deepEqual(fixture.results, [{ok: false, code: 'GOOGLE_KEYS_EXPIRED', lookups: 0}]);
      assert.equal(fixture.mockCalls, 1);
    });
  }
});

test('workerd rejects a different FA project before any certificate request', async () => {
  const fixture = await runFixture({claims: {...payload(), aud: 'foreign-project'}});
  assert.deepEqual(fixture.results, [{ok: false, code: 'FA_TOKEN_PROJECT_INVALID', lookups: 0}]);
  assert.equal(fixture.mockCalls, 0);
});
