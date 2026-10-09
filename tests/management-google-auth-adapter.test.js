import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {createManagementGoogleAuthAdapter} from '../scripts/lib/management-google-auth-adapter.js';

const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66', TIME = 1800000000000, SECONDS = TIME / 1000;
const SIGNER = 'management-broker@' + FB + '.iam.gserviceaccount.com';
const FA_CERTS = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const IAM_CERTS = 'https://www.googleapis.com/service_accounts/v1/metadata/x509/' + SIGNER;
const IAM_URL = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + SIGNER + ':signJwt';
const AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const keyA = generateKeyPairSync('rsa', {modulusLength: 2048}), keyB = generateKeyPairSync('rsa', {modulusLength: 2048});
const publicPem = key => key.publicKey.export({type: 'spki', format: 'pem'});
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload, header = {alg: 'RS256', kid: 'key-a', typ: 'JWT'}, key = keyA) => {
  const body = encode(header) + '.' + encode(payload);
  return body + '.' + sign('RSA-SHA256', Buffer.from(body), key.privateKey).toString('base64url');
};
const payload = () => ({sub: 'member-a', user_id: 'member-a', aud: FA, iss: 'https://securetoken.google.com/' + FA,
  auth_time: SECONDS - 50, iat: SECONDS - 10, exp: SECONDS + 3590, email_verified: true,
  firebase: {sign_in_provider: 'google.com', identities: {'google.com': ['google-id-a']}}});
const claims = () => ({managementSourceProjectId: FA, managementMemberId: 'stable-a', managementSourceVersion: 7,
  managementSourceHash: 'a'.repeat(64), managementPolicyVersion: 'test-policy', managementSourceAuthTimeMs: TIME - 50000});
const policy = () => ({operationTimeoutMs: 1000, maxResponseBytes: 65536, maxResponseChunks: 128,
  maxKeyCacheMs: 60000, maxFutureSkewMs: 0, maxIdTokenLifetimeSeconds: 3600, customTokenLifetimeSeconds: 600});
const user = () => ({localId: 'member-a', email: 'private-synthetic@example.invalid', emailVerified: true,
  disabled: false, validSince: String(SECONDS - 100), providerUserInfo: [{providerId: 'google.com', rawId: 'google-id-a'}],
  customAttributes: '{"admin":true}', passwordHash: 'never-return-hash', salt: 'never-return-salt'});
function response(url, data, {headers = {}, status = 200, body, redirected = false} = {}) {
  const bytes = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data)); let delivered = false;
  return {url, status, redirected, headers: new Headers({'content-type': 'application/json', ...headers}), body: body || {
    getReader: () => ({read: async () => delivered ? {done: true} : (delivered = true, {done: false, value: bytes}),
      cancel: async () => {}, releaseLock: () => {}})}};
}
function harness({fetchOverride, credentialOverride, suppliedPolicy = policy(), signer = SIGNER, enabled = true} = {}) {
  let time = TIME;
  const calls = [], credentials = [], state = {keys: {'key-a': publicPem(keyA)}, lookupUser: user(), signedKey: keyA, signedKid: 'key-a'};
  const fetchImpl = async (url, options) => {
    calls.push({url, options}); if (fetchOverride) return fetchOverride(url, options, state);
    if (url === FA_CERTS || url === IAM_CERTS) return response(url, state.keys, {headers: {'cache-control': 'public, max-age=60'}});
    if (url.includes('/accounts:lookup')) return response(url, {users: [state.lookupUser]});
    if (url === IAM_URL) { const signedPayload = JSON.parse(JSON.parse(options.body).payload);
      return response(url, {keyId: state.signedKid, signedJwt: jwt(signedPayload, {alg: 'RS256', kid: state.signedKid, typ: 'JWT'}, state.signedKey)}); }
    throw new Error('Unexpected synthetic endpoint');
  };
  const adapter = createManagementGoogleAuthAdapter({enabled, fetchImpl, signerServiceAccountEmail: signer,
    policy: suppliedPolicy, clock: () => time, getAdminAccessToken: async (request, context) => {
      credentials.push({request, context}); const value = {credentialType: 'google-oauth2', accessToken: 'opaque-server-oauth-access',
        expiresAtMs: time + 600000, scopes: request.scopes}; return credentialOverride ? credentialOverride(value, request, context) : value;
    }});
  return {adapter, calls, credentials, state, advance: milliseconds => { time += milliseconds; }};
}
const errorCode = (promise, code) => assert.rejects(promise, error => error.code === code && error.message === code);
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };

test('disabled adapter has no network, token provider or credential discovery', async () => {
  const context = harness({enabled: false});
  await errorCode(context.adapter.verifyFaIdToken(jwt(payload()), true), 'GOOGLE_AUTH_ADAPTER_DISABLED');
  await errorCode(context.adapter.getFbUser({uid: 'member-a', projectId: FB}), 'GOOGLE_AUTH_ADAPTER_DISABLED');
  assert.equal(context.calls.length, 0); assert.equal(context.credentials.length, 0);
});

test('policy and FB-owned signer must be explicit before any effects', async t => {
  for (const options of [{suppliedPolicy: undefined}, {suppliedPolicy: {...policy(), maxResponseChunks: 0}},
    {signer: 'management-broker@' + FA + '.iam.gserviceaccount.com'}]) await t.test('configuration', async () => {
    const context = harness({...options, suppliedPolicy: options.suppliedPolicy === undefined ? null : options.suppliedPolicy});
    await assert.rejects(context.adapter.verifyFaIdToken(jwt(payload()), true)); assert.equal(context.calls.length, 0);
  });
});

test('FA JWT signature, identity and current revocation lookup are checked each call', async () => {
  const context = harness(); const original = jwt(payload());
  for (let count = 0; count < 2; count++) { const decoded = await context.adapter.verifyFaIdToken(original, true);
    assert.equal(decoded.uid, 'member-a'); assert.equal(decoded.firebase.identities['google.com'][0], 'google-id-a');
    assert.equal(Object.hasOwn(decoded, 'email'), false); }
  assert.equal(context.calls.filter(call => call.url === FA_CERTS).length, 1);
  const lookups = context.calls.filter(call => call.url.includes('/accounts:lookup')); assert.equal(lookups.length, 2);
  for (const call of lookups) { assert.equal(call.url, 'https://identitytoolkit.googleapis.com/v1/projects/' + FA + '/accounts:lookup');
    assert.deepEqual(JSON.parse(call.options.body), {localId: ['member-a']}); assert.equal(Object.hasOwn(JSON.parse(call.options.body), 'idToken'), false);
    assert.equal(call.options.headers.Authorization, 'Bearer opaque-server-oauth-access'); assert.equal(call.options.cache, 'no-store'); }
  assert.equal(context.calls[0].options.headers.Authorization, undefined); context.adapter.dispose();
});

test('checkRevoked false is never accepted', async () => {
  const context = harness(); await errorCode(context.adapter.verifyFaIdToken(jwt(payload()), false), 'FA_REVOCATION_CHECK_REQUIRED'); assert.equal(context.calls.length, 0);
});

test('strict JWT/base64url/header formats fail before fetching keys', async t => {
  const valid = jwt(payload()); const cases = ['', valid + '=', valid.replace('.', '..'), 'bad.bad.bad',
    jwt(payload(), {alg: 'none', kid: 'key-a'}), jwt(payload(), {alg: 'HS256', kid: 'key-a'}),
    jwt(payload(), {alg: 'RS256', kid: 'key-a', jku: 'https://attacker.invalid/key'}), jwt(payload(), {alg: 'RS256'})];
  for (const token of cases) await t.test('token', async () => {
    const context = harness(); await assert.rejects(context.adapter.verifyFaIdToken(token, true)); assert.equal(context.calls.length, 0);
  });
});

test('wrong issuer/project/UID/provider/times and unverified/tenant tokens deny before keys', async t => {
  const cases = [data => ({...data, aud: FB}), data => ({...data, iss: 'https://securetoken.google.com/' + FB}),
    data => ({...data, sub: ''}), data => ({...data, uid: 'different'}), data => ({...data, user_id: 'different'}),
    data => ({...data, iat: SECONDS + 1}), data => ({...data, exp: SECONDS}), data => ({...data, auth_time: SECONDS + 1}),
    data => ({...data, auth_time: data.iat + 1}), data => ({...data, exp: data.iat + 3601}), data => ({...data, email_verified: false}),
    data => ({...data, firebase: {...data.firebase, sign_in_provider: 'custom'}}), data => ({...data, firebase: {...data.firebase, tenant: 'tenant'}}),
    data => ({...data, firebase: {...data.firebase, identities: {'google.com': []}}})];
  for (const change of cases) await t.test('claims', async () => {
    const context = harness(); await assert.rejects(context.adapter.verifyFaIdToken(jwt(change(payload())), true)); assert.equal(context.calls.length, 0);
  });
});

test('bad signature or missing kid never reaches admin lookup', async t => {
  for (const token of [jwt(payload(), {alg: 'RS256', kid: 'key-a'}, keyB), jwt(payload(), {alg: 'RS256', kid: 'unknown'})]) await t.test('signature', async () => {
    const context = harness(); await assert.rejects(context.adapter.verifyFaIdToken(token, true)); assert.equal(context.credentials.length, 0);
  });
});

test('rotation refreshes an unknown kid and expired caches never fall back', async () => {
  const context = harness(); await context.adapter.verifyFaIdToken(jwt(payload()), true);
  context.state.keys = {'key-b': publicPem(keyB)};
  await context.adapter.verifyFaIdToken(jwt(payload(), {alg: 'RS256', kid: 'key-b'}, keyB), true);
  assert.equal(context.calls.filter(call => call.url === FA_CERTS).length, 2);
  context.advance(60001); context.state.keys = {'key-a': publicPem(keyA)};
  await errorCode(context.adapter.verifyFaIdToken(jwt(payload(), {alg: 'RS256', kid: 'key-b'}, keyB), true), 'JWT_KEY_NOT_FOUND');
  assert.equal(context.calls.filter(call => call.url === FA_CERTS).length, 3); context.adapter.dispose();
});

test('certificate policy requires fresh max-age, bounded RSA public keys and no stale fallback', async t => {
  for (const fixture of [{headers: {}}, {headers: {'cache-control': 'max-age=1', age: '1'}},
    {headers: {'cache-control': 'no-store, max-age=60'}}, {headers: {'cache-control': 'max-age=60, max-age=1'}},
    {headers: {'cache-control': 'max-age=60'}, keys: {'key-a': 'not a key'}},
    {headers: {'cache-control': 'max-age=60'}, keys: {'key-a': keyA.privateKey.export({format: 'pem', type: 'pkcs8'})}}]) await t.test('keys', async () => {
    const context = harness({fetchOverride: async url => response(url, fixture.keys || {'key-a': publicPem(keyA)}, {headers: fixture.headers})});
    await assert.rejects(context.adapter.verifyFaIdToken(jwt(payload()), true)); assert.equal(context.credentials.length, 0);
  });
});

test('validSince compares auth_time in seconds; disabled/deleted/current mismatches deny', async t => {
  for (const [change, code] of [[data => ({...data, disabled: true}), 'FA_AUTH_USER_DISABLED_OR_UNVERIFIED'],
    [data => ({...data, validSince: String(SECONDS - 49)}), 'FA_TOKEN_REVOKED'],
    [data => ({...data, validSince: '1.5'}), 'AUTH_REVOCATION_TIME_INVALID'],
    [data => ({...data, localId: 'different'}), 'AUTH_USER_INVALID'],
    [data => ({...data, providerUserInfo: [{providerId: 'google.com', rawId: 'different-google'}]}), 'FA_AUTH_PROVIDER_CHANGED']]) await t.test(code, async () => {
    const context = harness(); context.state.lookupUser = change(user()); await errorCode(context.adapter.verifyFaIdToken(jwt(payload()), true), code); context.adapter.dispose();
  });
  const equal = harness(); equal.state.lookupUser.validSince = String(payload().auth_time);
  assert.equal((await equal.adapter.verifyFaIdToken(jwt(payload()), true)).uid, 'member-a'); equal.adapter.dispose();
});

test('missing disabled/validSince follow Admin SDK defaults, never suppress malformed values', async () => {
  const context = harness(); delete context.state.lookupUser.disabled; delete context.state.lookupUser.validSince;
  assert.equal((await context.adapter.verifyFaIdToken(jwt(payload()), true)).uid, 'member-a'); context.adapter.dispose();
});

test('Firebase/custom JWTs are never admin OAuth credentials even if a provider mislabels them', async t => {
  for (const accessToken of [jwt(payload()), jwt({...payload(), aud: FB}), jwt({uid: 'member-a', aud: AUD})]) await t.test('credential', async () => {
    const context = harness({credentialOverride: value => ({...value, accessToken})});
    await errorCode(context.adapter.verifyFaIdToken(jwt(payload()), true), 'GOOGLE_ADMIN_CREDENTIAL_INVALID');
    assert.equal(context.calls.filter(call => call.url.includes('/accounts:lookup')).length, 0); context.adapter.dispose();
  });
});

test('admin credential type/scope/expiration are validated before API', async t => {
  for (const change of [value => ({...value, credentialType: 'firebase-id-token'}), value => ({...value, scopes: []}),
    value => ({...value, expiresAtMs: TIME}), value => ({...value, accessToken: 'token with space'})]) await t.test('credential', async () => {
    const context = harness({credentialOverride: change}); await errorCode(context.adapter.getFbUser({uid: 'member-a', projectId: FB}), 'GOOGLE_ADMIN_CREDENTIAL_INVALID'); assert.equal(context.calls.length, 0);
  });
});

test('FB current user is projected without e-mails/hashes/attributes and aliases match core', async () => {
  const context = harness(); const snapshot = await context.adapter.readFbUser({uid: 'member-a', projectId: FB});
  assert.equal(snapshot.projectId, FB); assert.equal(snapshot.fromCache, false); assert.equal(snapshot.readTimeMs, TIME);
  assert.deepEqual(snapshot.user.providerData, [{providerId: 'google.com', uid: 'google-id-a'}]);
  for (const forbidden of ['email', 'passwordHash', 'salt', 'customAttributes']) assert.equal(Object.hasOwn(snapshot.user, forbidden), false);
  assert.equal(context.adapter.getFbUser, context.adapter.readFbUser); assert.equal(context.adapter.signFbCustomToken, context.adapter.createFbCustomToken); context.adapter.dispose();
});

test('lookup is admin-only, missing/ambiguous/cached records and wrong project deny', async t => {
  for (const options of [{records: []}, {records: [user(), user()]}, {records: [user()], headers: {age: '1'}}]) await t.test('records', async () => {
    const context = harness({fetchOverride: async url => response(url, {users: options.records}, {headers: options.headers})});
    await assert.rejects(context.adapter.getFbUser({uid: 'member-a', projectId: FB}));
  });
  const context = harness(); await errorCode(context.adapter.getFbUser({uid: 'member-a', projectId: FA}), 'FB_USER_REQUEST_INVALID'); assert.equal(context.calls.length, 0);
});

test('keyless IAM signs only internally derived payload and verifies signature/output exactly', async () => {
  const context = harness(); const token = await context.adapter.signFbCustomToken('member-a', claims());
  const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.deepEqual(decoded, {iss: SIGNER, sub: SIGNER, aud: AUD, iat: SECONDS, exp: SECONDS + 600, uid: 'member-a', claims: claims()});
  const request = context.calls.find(call => call.url === IAM_URL); assert.deepEqual(Object.keys(JSON.parse(request.options.body)), ['payload']);
  assert.equal(request.options.cache, 'no-store'); assert.equal(request.url.includes('opaque-server-oauth-access'), false);
  assert.equal(context.calls.find(call => call.url === IAM_CERTS).options.headers.Authorization, undefined); context.adapter.dispose();
});

test('reserved/arbitrary claims and invalid UID cannot be signed', async t => {
  for (const extra of ['admin', 'aud', 'iss', 'firebase', 'iat', 'exp', 'uid', 'user_id', 'permissions']) await t.test(extra, async () => {
    const context = harness(); await errorCode(context.adapter.createFbCustomToken('member-a', {...claims(), [extra]: true}), 'CUSTOM_CLAIMS_INVALID'); assert.equal(context.calls.length, 0);
  });
  const context = harness(); await errorCode(context.adapter.createFbCustomToken('', claims()), 'CUSTOM_TOKEN_UID_INVALID');
});

test('changed IAM payload/kid and wrong signer signature deny token return', async t => {
  for (const mode of ['payload', 'kid', 'signature']) await t.test(mode, async () => {
    const context = harness({fetchOverride: async (url, options) => {
      if (url === IAM_CERTS) return response(url, {'key-a': publicPem(keyA)}, {headers: {'cache-control': 'max-age=60'}});
      const data = JSON.parse(JSON.parse(options.body).payload); if (mode === 'payload') data.uid = 'different';
      return response(url, {keyId: mode === 'kid' ? 'different' : 'key-a', signedJwt: jwt(data, {alg: 'RS256', kid: 'key-a'}, mode === 'signature' ? keyB : keyA)});
    }});
    await assert.rejects(context.adapter.createFbCustomToken('member-a', claims())); context.adapter.dispose();
  });
});

test('timeout/external abort/dispose and caller deadline reject hanging adapters', {timeout: 3000}, async t => {
  for (const mode of ['timeout', 'abort', 'dispose', 'deadline']) await t.test(mode, async () => {
    const value = policy(); value.operationTimeoutMs = 40;
    let signal; const context = harness({suppliedPolicy: value, fetchOverride: async (url, options) => { signal = options.signal; return new Promise(() => {}); }});
    const controller = new AbortController(); const pending = context.adapter.verifyFaIdToken(jwt(payload()), true,
      {signal: controller.signal, ...(mode === 'deadline' ? {deadlineMs: TIME + 20} : {})});
    const checked = errorCode(pending, mode === 'abort' || mode === 'dispose' ? 'GOOGLE_AUTH_ABORTED' : 'GOOGLE_AUTH_TIMEOUT');
    await new Promise(resolve => setImmediate(resolve)); if (mode === 'abort') controller.abort(); if (mode === 'dispose') context.adapter.dispose();
    await checked; assert.equal(signal.aborted, true); context.adapter.dispose();
  });
});

test('empty/infinite microtask streams and synchronous delay cannot evade limits', async t => {
  for (const mode of ['empty', 'chunks', 'delay']) await t.test(mode, async () => {
    const value = policy(); value.maxResponseChunks = 2; value.operationTimeoutMs = mode === 'delay' ? 10 : 1000;
    const context = harness({suppliedPolicy: value, fetchOverride: async url => {
      if (mode === 'delay') { const end = performance.now() + 25; while (performance.now() < end) {} return response(url, {}); }
      return response(url, {}, {body: {getReader: () => ({read: async () => ({done: false, value: new Uint8Array(mode === 'empty' ? 0 : [32])}), cancel: async () => {}, releaseLock: () => {}})}});
    }});
    await errorCode(context.adapter.verifyFaIdToken(jwt(payload()), true), mode === 'empty' ? 'GOOGLE_RESPONSE_INVALID' : mode === 'chunks' ? 'GOOGLE_RESPONSE_TOO_MANY_CHUNKS' : 'GOOGLE_AUTH_TIMEOUT'); context.adapter.dispose();
  });
});

test('HTTP errors/redirect/wrong URL/oversized/nonJSON/raw errors never expose secrets', async t => {
  for (const mode of ['http', 'redirect', 'url', 'size', 'json', 'error']) await t.test(mode, async () => {
    const context = harness({fetchOverride: async url => {
      if (mode === 'error') throw Object.assign(new Error('secret-credential-body'), {code: 'secret-credential-code'});
      if (mode === 'url') return response('https://attacker.invalid', {});
      return response(url, mode === 'json' ? 'bad-json' : mode === 'size' ? {large: 'x'.repeat(70000)} : {},
        {status: mode === 'http' ? 403 : 200, redirected: mode === 'redirect'});
    }});
    await assert.rejects(context.adapter.verifyFaIdToken(jwt(payload()), true), error => !error.message.includes('secret') && !error.message.includes('credential-body')); context.adapter.dispose();
  });
});

test('late response after abort never becomes verified identity or token', async () => {
  const gate = deferred(); const context = harness({fetchOverride: async () => gate.promise});
  const controller = new AbortController(); const pending = context.adapter.verifyFaIdToken(jwt(payload()), true, {signal: controller.signal});
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); await errorCode(pending, 'GOOGLE_AUTH_ABORTED');
  gate.resolve(response(FA_CERTS, {'key-a': publicPem(keyA)}, {headers: {'cache-control': 'max-age=60'}}));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(context.credentials.length, 0); context.adapter.dispose();
});

function syntheticCertificate(key, validFrom = TIME - 1000, validUntil = TIME + 600000) {
  const der = (tag, value) => {
    const body = Buffer.isBuffer(value) ? value : Buffer.concat(value);
    let length = body.length, bytes = []; do { bytes.unshift(length & 255); length >>>= 8; } while (length);
    return Buffer.concat([Buffer.from([tag]), body.length < 128 ? Buffer.from([body.length]) : Buffer.from([128 + bytes.length, ...bytes]), body]);
  };
  const algorithm = Buffer.from('300d06092a864886f70d01010b0500', 'hex');
  const name = der(0x30, [der(0x31, [der(0x30, [Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('synthetic-only'))])])]);
  const timestamp = time => der(0x18, Buffer.from(new Date(time).toISOString().replace(/[-:]/g, '').replace('T', '').replace('.000', '')));
  const tbs = der(0x30, [der(0xa0, [Buffer.from([2, 1, 2])]), Buffer.from([2, 1, 1]), algorithm, name,
    der(0x30, [timestamp(validFrom), timestamp(validUntil)]), name, key.publicKey.export({type: 'spki', format: 'der'})]);
  const certificate = der(0x30, [tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), sign('RSA-SHA256', tbs, key.privateKey)]))]);
  return '-----BEGIN CERTIFICATE-----\n' + certificate.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
}

test('actual X509 response shape is exercised using only synthetic in-memory certificates', async t => {
  const valid = harness(); valid.state.keys = {'key-a': syntheticCertificate(keyA)};
  assert.equal((await valid.adapter.verifyFaIdToken(jwt(payload()), true)).uid, 'member-a'); valid.adapter.dispose();
  for (const cert of [syntheticCertificate(keyA, TIME - 60000, TIME - 1000), syntheticCertificate(keyA, TIME + 1000, TIME + 60000)]) await t.test('certificate-time', async () => {
    const context = harness(); context.state.keys = {'key-a': cert};
    await errorCode(context.adapter.verifyFaIdToken(jwt(payload()), true), 'GOOGLE_KEYS_EXPIRED'); assert.equal(context.credentials.length, 0); context.adapter.dispose();
  });
});

test('expired certificate cache with network failure does not reuse prior keys', async () => {
  let failing = false;
  const context = harness({fetchOverride: async (url, options) => {
    if (url === FA_CERTS) { if (failing) throw new Error('synthetic fetch failure'); return response(url, {'key-a': publicPem(keyA)}, {headers: {'cache-control': 'max-age=60'}}); }
    return response(url, {users: [user()]});
  }});
  await context.adapter.verifyFaIdToken(jwt(payload()), true); context.advance(60001); failing = true;
  await errorCode(context.adapter.verifyFaIdToken(jwt(payload()), true), 'GOOGLE_AUTH_ADAPTER_FAILED');
  assert.equal(context.credentials.length, 1); context.adapter.dispose();
});

test('cached public key never caches FA revocation state', async () => {
  const context = harness(); const token = jwt(payload()); await context.adapter.verifyFaIdToken(token, true);
  context.state.lookupUser.validSince = String(SECONDS - 49);
  await errorCode(context.adapter.verifyFaIdToken(token, true), 'FA_TOKEN_REVOKED');
  assert.equal(context.calls.filter(call => call.url === FA_CERTS).length, 1);
  assert.equal(context.calls.filter(call => call.url.includes('/accounts:lookup')).length, 2); context.adapter.dispose();
});

test('weak/non-RSA public keys are never accepted for RS256', async t => {
  const weak = generateKeyPairSync('rsa', {modulusLength: 1024}), ec = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  for (const key of [weak, ec]) await t.test('key-type', async () => {
    const context = harness(); context.state.keys = {'key-a': publicPem(key)};
    await errorCode(context.adapter.verifyFaIdToken(jwt(payload()), true), 'GOOGLE_KEYS_INVALID'); context.adapter.dispose();
  });
});

test('hanging credential provider is bounded and cancelled before admin API', {timeout: 2000}, async () => {
  let signal; const value = policy(); value.operationTimeoutMs = 40;
  const context = harness({suppliedPolicy: value, credentialOverride: (value, request, options) => { signal = options.signal; return new Promise(() => {}); }});
  await errorCode(context.adapter.getFbUser({uid: 'member-a', projectId: FB}), 'GOOGLE_AUTH_TIMEOUT');
  assert.equal(context.calls.length, 0); assert.equal(signal.aborted, true); context.adapter.dispose();
});


test('stale or invalid claims and expired credential cannot be handed to IAM signer', async t => {
  for (const change of [value => ({...value, managementSourceAuthTimeMs: TIME + 1}), value => ({...value, managementSourceHash: 'invalid'}),
    value => ({...value, managementSourceVersion: 0}), value => ({...value, managementPolicyVersion: ''})]) await t.test('claims', async () => {
    const context = harness(); await assert.rejects(context.adapter.createFbCustomToken('member-a', change(claims()))); assert.equal(context.calls.length, 0);
  });
});


test('cached X509 key expires at certificate notAfter even when max-age is longer', async () => {
  const context = harness(); context.state.keys = {'key-a': syntheticCertificate(keyA, TIME - 1000, TIME + 1000)};
  await context.adapter.verifyFaIdToken(jwt(payload()), true); context.advance(1001);
  await errorCode(context.adapter.verifyFaIdToken(jwt(payload()), true), 'GOOGLE_KEYS_EXPIRED');
  assert.equal(context.calls.filter(call => call.url === FA_CERTS).length, 2); assert.equal(context.credentials.length, 1); context.adapter.dispose();
});


test('getFaUser/readFaAuthUser supplies a fresh Auth snapshot for core source composition', async () => {
  const context = harness(); const first = await context.adapter.readFaAuthUser({uid: 'member-a', projectId: FA});
  assert.equal(context.adapter.getFaUser, context.adapter.readFaAuthUser); assert.equal(first.projectId, FA);
  assert.equal(first.fromCache, false); assert.equal(first.hasPendingWrites, false); assert.equal(first.user.googleUid, 'google-id-a');
  assert.equal(first.user.tokensValidAfterTimeMs, TIME - 100000);
  context.state.lookupUser.validSince = String(SECONDS - 25); context.state.lookupUser.disabled = true;
  const second = await context.adapter.getFaUser({uid: 'member-a', projectId: FA});
  assert.equal(second.user.tokensValidAfterTimeMs, TIME - 25000); assert.equal(second.user.disabled, true);
  assert.equal(context.calls.length, 2); assert.ok(context.calls.every(call => call.url === 'https://identitytoolkit.googleapis.com/v1/projects/' + FA + '/accounts:lookup'));
  assert.equal(Object.hasOwn(second.user, 'email'), false); context.adapter.dispose();
});

test('FA helper never accepts a destination-project or arbitrary UID request', async () => {
  const context = harness(); await errorCode(context.adapter.getFaUser({uid: 'member-a', projectId: FB}), 'FA_USER_REQUEST_INVALID');
  await errorCode(context.adapter.readFaAuthUser({uid: 'bad/uid', projectId: FA}), 'FA_USER_REQUEST_INVALID');
  assert.equal(context.calls.length, 0); context.adapter.dispose();
});
