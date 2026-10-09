import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createHmac} from 'node:crypto';
import {createManagementGatewayProtocol, gatewayCanonicalJson, gatewayEnvelopeHash,
  MANAGEMENT_GATEWAY_PROTOCOL_VERSION as VERSION, MANAGEMENT_GATEWAY_AUDIENCE as AUDIENCE,
  MANAGEMENT_GATEWAY_OPERATIONS as OPERATIONS} from '../scripts/lib/management-gateway-protocol.js';

// Deliberately synthetic test key, not a usable deployment credential.
const TEST_KEY = Buffer.alloc(32, 0x6a), START = 1700000000000;
const policy = changes => ({schemaVersion: 1, protocolVersion: VERSION, audience: AUDIENCE, keyId: 'synthetic-v1',
  maximumTtlMs: 120000, maxFutureSkewMs: 1000, maxEnvelopeBytes: 65536, operationTimeoutMs: 1000,
  customTokenMaxTtlSeconds: 3600, enabledOperations: Object.fromEntries(OPERATIONS.map(op => [op, true])), ...changes});
const claims = () => ({managementSourceProjectId: 'sahmt-17a16', managementMemberId: 'member-synthetic',
  managementSourceVersion: 1, managementSourceHash: 'a'.repeat(64), managementPolicyVersion: 'synthetic-policy-v1',
  managementSourceAuthTimeMs: START - 1000});
const signBody = () => ({uid: 'uid-synthetic', claims: claims(), issuedAtSeconds: START / 1000, expiresAtSeconds: START / 1000 + 60});
const lookup = () => ({users: [{localId: 'uid-synthetic', disabled: false, emailVerified: true, validSince: '0',
  providerUserInfo: [{providerId: 'google.com', rawId: 'google-synthetic'}]}]});
const factory = (changes = {}, options = {}) => createManagementGatewayProtocol({policy: policy(changes), secret: TEST_KEY,
  now: () => START, ...options});
const request = (p, overrides = {}) => p.createRequest({operation: 'AUTH_USER_LOOKUP_FA', requestId: '1'.repeat(32),
  nonce: '2'.repeat(32), issuedAtMs: START, expiresAtMs: START + 10000, body: {uid: 'uid-synthetic'}, ...overrides});
const envelopeHash = value => createHash('sha256').update(gatewayCanonicalJson(value)).digest('hex');
const rawSign = (value, direction = 'REQUEST') => {
  const result = structuredClone(value); result.bodySha256 = envelopeHash(result.body);
  const unsigned = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'signature'));
  result.signature = createHmac('sha256', TEST_KEY).update('SAHMT_MANAGEMENT_GATEWAY_V1_' + direction + '\n'
    + gatewayCanonicalJson(unsigned)).digest('hex'); return result;
};
const fullReceipt = metadata => ({...metadata, status: 'CLAIMED', durable: true, atomic: true, budgetAllowed: true,
  capacityAllowed: true, retained: true});
// An in-memory DOUBLE verifies protocol call requirements; production must use a durable atomic store.
function ledgerDouble() {
  const ids = new Set(), nonces = new Set(), records = [];
  return {records, claim: async metadata => {
    const id = metadata.namespace + ':' + metadata.requestId, nonce = metadata.namespace + ':' + metadata.nonce;
    if (ids.has(id) || nonces.has(nonce)) return {status: 'REPLAY'};
    ids.add(id); nonces.add(nonce); records.push(metadata); return fullReceipt(metadata);
  }};
}
const handlers = dispatch => ({AUTH_USER_LOOKUP_FA: {enabled: true, dispatch}, AUTH_USER_LOOKUP_FB: {enabled: true, dispatch},
  SIGN_FB_CUSTOM_TOKEN: {enabled: true, dispatch}});
const expectCode = (fn, code) => assert.throws(fn, error => error?.code === code && error.message === code);
const expectAsyncCode = (fn, code) => assert.rejects(fn, error => error?.code === code && error.message === code);

test('canonical code-unit ordering, unicode escaping, arrays and hash vector are deterministic', () => {
  assert.equal(gatewayCanonicalJson({z: 1, 'é': ['x', null], a: true}), '{"a":true,"z":1,"é":["x",null]}');
  assert.equal(gatewayCanonicalJson({b: 1, a: 2}), gatewayCanonicalJson({a: 2, b: 1}));
  assert.equal(gatewayEnvelopeHash({a: 1}), '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
});
const jsonBad = [undefined, NaN, Infinity, -0, 0.5, 2n, new Date(), Object.create(null), new Uint8Array(2), () => 1,
  Object.assign([], {extra: 1}), new Array(2), Object.assign(Object.create({x: 1}), {a: 1})];
for (const [n, value] of jsonBad.entries()) test('strict JSON rejects unsupported representation ' + n, () => assert.throws(() => gatewayCanonicalJson(value)));
test('JSON rejects getters, hidden props, symbol keys, custom array prototype and cycles without evaluating getter', () => {
  let touched = 0; const getter = {}; Object.defineProperty(getter, 'a', {enumerable: true, get: () => { touched++; return 1; }});
  const hidden = {}; Object.defineProperty(hidden, 'a', {value: 1}); const symbol = {[Symbol('a')]: 1};
  const cyclic = {}; cyclic.self = cyclic; const customArray = []; Object.setPrototypeOf(customArray, {});
  for (const value of [getter, hidden, symbol, cyclic, customArray]) assert.throws(() => gatewayCanonicalJson(value)); assert.equal(touched, 0);
});
test('JSON bounds depth, nodes, UTF8 bytes and oversized sparse arrays', () => {
  assert.throws(() => gatewayCanonicalJson({a: {b: {c: 1}}}, {maxDepth: 1}));
  assert.throws(() => gatewayCanonicalJson([1, 2], {maxNodes: 2}));
  assert.throws(() => gatewayCanonicalJson('éé', {maxBytes: 5}));
  assert.throws(() => gatewayCanonicalJson(new Array(100000000)));
});
for (const [field, value] of [['schemaVersion', 2], ['protocolVersion', 'free'], ['audience', 'other'], ['keyId', 'bad key'],
  ['maximumTtlMs', 120001], ['maximumTtlMs', 0], ['maxFutureSkewMs', 60001], ['maxEnvelopeBytes', 1023],
  ['maxEnvelopeBytes', 65537], ['operationTimeoutMs', 0], ['operationTimeoutMs', 120001], ['customTokenMaxTtlSeconds', 3601],
  ['enabledOperations', {AUTH_USER_LOOKUP_FA: true}]]) test('policy rejects ' + field + ':' + String(value), () => expectCode(() => factory({[field]: value}), 'GATEWAY_POLICY_INVALID'));
test('policy rejects unknown/hidden/getter fields', () => {
  expectCode(() => factory({freeUrl: 'https://invalid.example'}), 'GATEWAY_POLICY_INVALID');
  const p = policy(); Object.defineProperty(p, 'hidden', {value: true}); assert.throws(() => createManagementGatewayProtocol({policy: p, secret: TEST_KEY}));
});
test('secret required, 32 bytes minimum, private copy independent of caller mutation', () => {
  for (const secret of [undefined, 'a'.repeat(64), Buffer.alloc(31), Buffer.alloc(1025)]) expectCode(() => createManagementGatewayProtocol({policy: policy(), secret}), 'GATEWAY_SECRET_INVALID');
  const supplied = Buffer.from(TEST_KEY), p = createManagementGatewayProtocol({policy: policy(), secret: supplied, now: () => START});
  supplied.fill(0); const r = request(p); assert.deepEqual(factory().verifyRequest(r), r);
});
test('policy caller mutation cannot enable operations or extend limits after construction', async () => {
  const supplied = policy({enabledOperations: undefined}); delete supplied.enabledOperations;
  const p = createManagementGatewayProtocol({policy: supplied, secret: TEST_KEY, now: () => START});
  supplied.enabledOperations = Object.fromEntries(OPERATIONS.map(op => [op, true])); supplied.maximumTtlMs = 999999;
  let calls = 0; const response = await p.receiveRequest(request(p), {handlers: handlers(() => { calls++; return lookup(); }), claimNonce: () => { calls++; }});
  assert.equal(response.code, 'GATEWAY_DISABLED'); assert.equal(calls, 0);
});
for (const [field, value] of [['requestId', 'a'.repeat(31)], ['requestId', 'A'.repeat(32)], ['nonce', 'z'.repeat(32)],
  ['operation', 'GET_ACCESS_TOKEN'], ['issuedAtMs', START + 1001], ['expiresAtMs', START], ['expiresAtMs', START + 120001],
  ['issuedAtMs', 0], ['body', {uid: 'uid-synthetic', projectId: 'other'}], ['body', {uid: 'bad/uid'}]])
  test('request rejects ' + field + ':' + String(value), () => assert.throws(() => request(factory(), {[field]: value})));
test('request verified as deep copy with fixed metadata', () => {
  const p = factory(), r = request(p); const verified = p.verifyRequest(r); verified.body.uid = 'other'; assert.equal(r.body.uid, 'uid-synthetic');
  assert.equal(r.sourceProjectId, 'sahmt-17a16'); assert.equal(r.destinationProjectId, 'sahmt-gestao-5ae66');
});
for (const field of ['audience', 'keyId', 'sourceProjectId', 'destinationProjectId', 'protocolVersion', 'direction', 'operation', 'signature', 'bodySha256'])
  test('tampered envelope rejects field ' + field, () => { const p = factory(), r = request(p); r[field] = 'wrong'; assert.throws(() => p.verifyRequest(r)); });
test('body mutation, extra hidden envelope properties, and direction-separated MAC are rejected', () => {
  const p = factory(), r = request(p); r.body.uid = 'other'; expectCode(() => p.verifyRequest(r), 'GATEWAY_SIGNATURE_INVALID');
  const hidden = request(p); Object.defineProperty(hidden, 'hidden', {value: 1}); assert.throws(() => p.verifyRequest(hidden));
  const wrongDomain = rawSign(request(p), 'RESPONSE'); expectCode(() => p.verifyRequest(wrongDomain), 'GATEWAY_SIGNATURE_INVALID');
});
test('fixed TTL ends exactly at expiry and accepts only configured future skew', () => {
  let wall = START; const p = factory({}, {now: () => wall}); const r = request(p); wall = r.expiresAtMs;
  expectCode(() => p.verifyRequest(r), 'GATEWAY_ENVELOPE_TIME_INVALID');
  const future = request(factory(), {issuedAtMs: START + 1000, expiresAtMs: START + 2000}); assert.ok(future.signature);
});
test('sign operation accepts only the six closed claims and bounded caller times', () => {
  const p = factory(), r = request(p, {operation: 'SIGN_FB_CUSTOM_TOKEN', body: signBody()}); assert.equal(r.body.claims.managementSourceVersion, 1);
  for (const key of Object.keys(claims())) { const b = signBody(); delete b.claims[key]; assert.throws(() => request(p, {operation: 'SIGN_FB_CUSTOM_TOKEN', body: b})); }
});
for (const mutate of [b => b.payloadJwt = {}, b => b.signer = 'other', b => b.claims.admin = true, b => b.claims.managementSourceProjectId = 'other',
  b => b.claims.managementSourceVersion = 0, b => b.claims.managementSourceHash = 'A'.repeat(64), b => b.claims.managementSourceAuthTimeMs = START + 1001,
  b => b.issuedAtSeconds += 2, b => b.issuedAtSeconds -= 3, b => b.expiresAtSeconds = b.issuedAtSeconds,
  b => b.expiresAtSeconds = b.issuedAtSeconds + 3601, b => b.expiresAtSeconds = START / 1000, b => b.issuedAtSeconds = 1.5])
  test('SIGN body denies free payload, invalid claim or time ' + mutate.toString(), () => { const body = signBody(); mutate(body); assert.throws(() => request(factory(), {operation: 'SIGN_FB_CUSTOM_TOKEN', body})); });
test('SIGN host shorter custom lifetime enforced', () => assert.throws(() => request(factory({customTokenMaxTtlSeconds: 30}), {operation: 'SIGN_FB_CUSTOM_TOKEN', body: signBody()})));
test('successful lookup response binds full signed request and maintains exact request expiry', () => {
  const p = factory(), r = request(p), response = p.createResponse(r, {status: 'SUCCESS', code: 'OK', body: lookup()});
  assert.equal(response.requestHash, gatewayEnvelopeHash(r)); assert.equal(response.expiresAtMs, r.expiresAtMs);
  assert.deepEqual(p.verifyResponse(response, r), {status: 'SUCCESS', code: 'OK', body: lookup()});
});
test('empty filtered lookup and provisional signature shapes are accepted', () => {
  const p = factory(), r = request(p); assert.deepEqual(p.verifyResponse(p.createResponse(r, {status: 'SUCCESS', code: 'OK', body: {users: []}}), r).body, {users: []});
  const sign = request(p, {operation: 'SIGN_FB_CUSTOM_TOKEN', body: signBody()}), body = {keyId: 'synthetic-public-key', signedJwt: 'e30.e30.c3ludGhldGlj'};
  assert.deepEqual(p.verifyResponse(p.createResponse(sign, {status: 'SUCCESS', code: 'OK', body}), sign).body, body);
});
for (const mutate of [b => b.token = 'never-echo', b => b.users.push(structuredClone(b.users[0])), b => b.users[0].email = 'synthetic@example.invalid',
  b => b.users[0].localId = 'other', b => b.users[0].emailVerified = 'true', b => b.users[0].disabled = 1,
  b => b.users[0].validSince = '00', b => b.users[0].validSince = '9007199254740991', b => b.users[0].providerUserInfo[0].rawId = '',
  b => b.users[0].providerUserInfo[0].email = 'synthetic@example.invalid', b => b.users[0].providerUserInfo.push(structuredClone(b.users[0].providerUserInfo[0]))])
  test('filtered result rejects private/ambiguous/invalid output ' + mutate.toString(), () => { const p = factory(), b = lookup(); mutate(b); expectCode(() => p.createResponse(request(p), {status: 'SUCCESS', code: 'OK', body: b}), 'GATEWAY_RESULT_INVALID'); });
test('signed response cannot change request ID, nonce, op, hash or fixed expiry', () => {
  const p = factory(), r = request(p), result = p.createResponse(r, {status: 'SUCCESS', code: 'OK', body: lookup()});
  for (const [field, value] of [['requestId', '3'.repeat(32)], ['nonce', '4'.repeat(32)], ['operation', 'AUTH_USER_LOOKUP_FB'],
    ['requestHash', 'f'.repeat(64)], ['expiresAtMs', START + 11000]]) {
    const changed = rawSign({...result, [field]: value}, 'RESPONSE'); expectCode(() => p.verifyResponse(changed, r), 'GATEWAY_RESPONSE_BINDING_INVALID');
  }
});
test('DENIED response body must be null and code static', () => {
  const p = factory(), r = request(p);
  assert.deepEqual(p.verifyResponse(p.createResponse(r, {status: 'DENIED', code: 'GATEWAY_DISABLED', body: null}), r), {status: 'DENIED', code: 'GATEWAY_DISABLED', body: null});
  for (const result of [{status: 'DENIED', code: 'remote secret text', body: null}, {status: 'DENIED', code: 'GATEWAY_DISABLED', body: lookup()},
    {status: 'SUCCESS', code: 'GATEWAY_DISABLED', body: lookup()}]) expectCode(() => p.createResponse(r, result), 'GATEWAY_RESULT_INVALID');
});
test('guarded receive and accept consume separate durable directions before data reaches caller', async () => {
  const p = factory(), r = request(p), ledger = ledgerDouble(); let dispatches = 0;
  const response = await p.receiveRequest(r, {claimNonce: ledger.claim, handlers: handlers((body, context) => {
    assert.equal(ledger.records.length, 1); assert.deepEqual(body, {uid: 'uid-synthetic'}); assert.equal(context.projectId, 'sahmt-17a16');
    assert.ok(context.signal instanceof AbortSignal); dispatches++; return lookup(); })});
  assert.equal(response.status, 'SUCCESS'); const result = await p.acceptResponse(response, r, {claimNonce: ledger.claim});
  assert.equal(result.status, 'SUCCESS'); assert.equal(dispatches, 1); assert.equal(ledger.records.length, 2);
  assert.notEqual(ledger.records[0].namespace, ledger.records[1].namespace); assert.equal(ledger.records[0].requestHash, ledger.records[0].envelopeHash);
  assert.equal(ledger.records[1].requestHash, ledger.records[0].requestHash); assert.equal(ledger.records[1].envelopeHash, gatewayEnvelopeHash(response));
  await expectAsyncCode(() => p.acceptResponse(response, r, {claimNonce: ledger.claim}), 'GATEWAY_REPLAY_DENIED');
});
test('request ID and nonce individually replay denied across operations', async () => {
  const p = factory(), r = request(p), ledger = ledgerDouble(); let calls = 0; const options = {claimNonce: ledger.claim, handlers: handlers(() => { calls++; return lookup(); })};
  assert.equal((await p.receiveRequest(r, options)).status, 'SUCCESS');
  for (const overrides of [{nonce: '3'.repeat(32), operation: 'AUTH_USER_LOOKUP_FB'}, {requestId: '4'.repeat(32), operation: 'AUTH_USER_LOOKUP_FB'}, {}])
    assert.equal((await p.receiveRequest(request(p, overrides), options)).code, 'GATEWAY_REPLAY_DENIED');
  assert.equal(calls, 1); assert.equal(ledger.records.length, 1);
});
test('concurrent duplicate requests invoke only once under atomic ledger double', async () => {
  const p = factory(), r = request(p), ledger = ledgerDouble(); let calls = 0;
  const options = {claimNonce: ledger.claim, handlers: handlers(async () => { calls++; await Promise.resolve(); return lookup(); })};
  const results = await Promise.all([p.receiveRequest(r, options), p.receiveRequest(r, options)]);
  assert.deepEqual(results.map(x => x.code).sort(), ['GATEWAY_REPLAY_DENIED', 'OK']); assert.equal(calls, 1);
});
for (const [field, value] of [['durable', false], ['atomic', false], ['budgetAllowed', false], ['capacityAllowed', false], ['retained', false],
  ['nonce', '0'.repeat(32)], ['requestId', '0'.repeat(32)], ['requestHash', '0'.repeat(64)], ['envelopeHash', '0'.repeat(64)],
  ['namespace', 'wrong'], ['keyId', 'wrong'], ['status', 'PENDING'], ['extra', true]])
  test('admission receipt must exactly match and durably authorize ' + field, async () => {
    const p = factory(); let calls = 0; const response = await p.receiveRequest(request(p), {claimNonce: meta => ({...fullReceipt(meta), [field]: value}),
      handlers: handlers(() => { calls++; return lookup(); })}); assert.equal(response.code, 'GATEWAY_ADMISSION_DENIED'); assert.equal(calls, 0);
  });
test('missing/throwing/hidden/getter receipt denies without exposing raw error or dispatch', async () => {
  const p = factory(); let calls = 0; const dispatch = handlers(() => { calls++; return lookup(); });
  const getters = meta => { const receipt = fullReceipt(meta); Object.defineProperty(receipt, 'secret', {get: () => { throw new Error('never-print'); }, enumerable: true}); return receipt; };
  for (const claimNonce of [undefined, () => null, () => { throw new Error('never-print'); }, getters]) {
    const r = await p.receiveRequest(request(p), {claimNonce, handlers: dispatch}); assert.equal(r.code, 'GATEWAY_ADMISSION_DENIED'); assert.equal(r.body, null);
    assert.equal(JSON.stringify(r).includes('never-print'), false);
  } assert.equal(calls, 0);
});
test('default disabled, absent handler and disabled handler deny before nonce claim', async () => {
  let calls = 0; const claimNonce = () => { calls++; }; const p = factory();
  for (const hs of [undefined, {}, {AUTH_USER_LOOKUP_FA: {enabled: false, dispatch: () => { calls++; }}}])
    assert.equal((await p.receiveRequest(request(p), {claimNonce, handlers: hs})).code, 'GATEWAY_DISABLED');
  assert.equal(calls, 0);
});
test('malformed signature never claims or dispatches', async () => {
  const p = factory(), r = request(p); r.signature = '0'.repeat(64); let calls = 0;
  await expectAsyncCode(() => p.receiveRequest(r, {claimNonce: () => { calls++; }, handlers: handlers(() => { calls++; })}), 'GATEWAY_SIGNATURE_INVALID'); assert.equal(calls, 0);
});
test('raw handler error and unsafe result are sanitized with retained claim', async () => {
  const p = factory(), ledger = ledgerDouble();
  const failure = await p.receiveRequest(request(p), {claimNonce: ledger.claim, handlers: handlers(() => { throw new Error('private-token-never-print'); })});
  assert.equal(failure.code, 'GATEWAY_OPERATION_FAILED'); assert.equal(JSON.stringify(failure).includes('private-token'), false); assert.equal(ledger.records.length, 1);
  const bad = await p.receiveRequest(request(p, {nonce: '3'.repeat(32), requestId: '4'.repeat(32)}), {claimNonce: ledger.claim, handlers: handlers(() => ({users: [], accessToken: 'private-token'}))});
  assert.equal(bad.code, 'GATEWAY_RESULT_INVALID'); assert.equal(bad.body, null); assert.equal(ledger.records.length, 2);
});
test('nonce hang is bounded, aborts adapter signal and never dispatches', async () => {
  const p = factory({operationTimeoutMs: 10}); let calls = 0, signal;
  const response = await p.receiveRequest(request(p), {claimNonce: (_meta, ctx) => { signal = ctx.signal; return new Promise(() => {}); },
    handlers: handlers(() => { calls++; return lookup(); })}); assert.equal(response.code, 'GATEWAY_OPERATION_TIMEOUT'); assert.equal(signal.aborted, true); assert.equal(calls, 0);
});
test('handler hang is bounded; late completion cannot return token/body and does not release nonce', async () => {
  const p = factory({operationTimeoutMs: 10}), ledger = ledgerDouble(); let resolve, signal;
  const pending = p.receiveRequest(request(p), {claimNonce: ledger.claim, handlers: handlers((_body, ctx) => { signal = ctx.signal; return new Promise(r => { resolve = r; }); })});
  const response = await pending; assert.equal(response.code, 'GATEWAY_OPERATION_TIMEOUT'); assert.equal(signal.aborted, true); assert.equal(ledger.records.length, 1);
  resolve(lookup()); await Promise.resolve(); assert.equal(response.body, null);
});
test('parent cancellation before admission and while handler pending returns only denial', async () => {
  const p = factory(), pre = new AbortController(); pre.abort(); let calls = 0;
  assert.equal((await p.receiveRequest(request(p), {signal: pre.signal, claimNonce: () => { calls++; }, handlers: handlers(() => { calls++; })})).code, 'GATEWAY_ABORTED'); assert.equal(calls, 0);
  const controller = new AbortController(), ledger = ledgerDouble(); let started;
  const signaled = new Promise(resolve => { started = resolve; });
  const pending = p.receiveRequest(request(p), {signal: controller.signal, claimNonce: ledger.claim, handlers: handlers(() => { started(); return new Promise(() => {}); })});
  await signaled; controller.abort(); const response = await pending; assert.equal(response.code, 'GATEWAY_ABORTED'); assert.equal(ledger.records.length, 1);
});
test('caller deadline and logical post-await deadline prevent later dispatch/return even before timer', async () => {
  let wall = START, mono = 0, dispatches = 0; const p = factory({}, {now: () => wall, monotonicNow: () => mono}), r = request(p);
  const response = await p.receiveRequest(r, {deadlineMs: START + 5, claimNonce: metadata => { wall += 5; return fullReceipt(metadata); },
    handlers: handlers(() => { dispatches++; return lookup(); })}); assert.equal(response.code, 'GATEWAY_OPERATION_TIMEOUT'); assert.equal(dispatches, 0);
});
test('monotonic post-await deadline blocks ready result when logical clock does not advance', async () => {
  let mono = 0; const p = factory({operationTimeoutMs: 10}, {monotonicNow: () => mono});
  const response = await p.receiveRequest(request(p), {claimNonce: meta => fullReceipt(meta), handlers: handlers(() => { mono = 10; return lookup(); })});
  assert.equal(response.code, 'GATEWAY_OPERATION_TIMEOUT'); assert.equal(response.body, null);
});
test('nonce queued microtask rechecks cancellation before callback', async () => {
  const p = factory(), controller = new AbortController(); let calls = 0;
  const promise = p.receiveRequest(request(p), {signal: controller.signal, claimNonce: () => { calls++; }, handlers: handlers(() => { calls++; })});
  controller.abort(); assert.equal((await promise).code, 'GATEWAY_ABORTED'); assert.equal(calls, 0);
});
test('dispatch queued microtask rechecks parent cancellation and keeps consumed nonce', async () => {
  const p = factory(), controller = new AbortController(), ledger = ledgerDouble(); let calls = 0;
  const response = await p.receiveRequest(request(p), {signal: controller.signal, claimNonce: async meta => {
    const receipt = await ledger.claim(meta); queueMicrotask(() => controller.abort()); return receipt; }, handlers: handlers(() => { calls++; return lookup(); })});
  assert.equal(response.code, 'GATEWAY_ABORTED'); assert.equal(calls, 0); assert.equal(ledger.records.length, 1);
});
test('acceptResponse never returns body on receipt mismatch/hang/cancellation', async () => {
  const p = factory({operationTimeoutMs: 10}), r = request(p), response = p.createResponse(r, {status: 'SUCCESS', code: 'OK', body: lookup()});
  await expectAsyncCode(() => p.acceptResponse(response, r, {claimNonce: meta => ({...fullReceipt(meta), retained: false})}), 'GATEWAY_ADMISSION_DENIED');
  await expectAsyncCode(() => p.acceptResponse(response, r, {claimNonce: () => new Promise(() => {})}), 'GATEWAY_OPERATION_TIMEOUT');
  const controller = new AbortController(); controller.abort(); await expectAsyncCode(() => p.acceptResponse(response, r, {claimNonce: meta => fullReceipt(meta), signal: controller.signal}), 'GATEWAY_ABORTED');
});
test('wall and monotonic regression fail closed; disposed instance cannot sign/verify/use key', () => {
  let wall = START, mono = 5; const p = factory({}, {now: () => wall, monotonicNow: () => mono}), r = request(p);
  wall--; expectCode(() => p.verifyRequest(r), 'GATEWAY_CLOCK_INVALID'); wall++; mono--; expectCode(() => p.verifyRequest(r), 'GATEWAY_CLOCK_INVALID');
  p.dispose(); expectCode(() => p.verifyRequest(r), 'GATEWAY_DISABLED'); expectCode(() => request(p), 'GATEWAY_DISABLED'); p.dispose();
});
test('expiry after pending operation cannot be renewed into a signed response', async () => {
  let wall = START; const p = factory({}, {now: () => wall}), r = request(p);
  await expectAsyncCode(() => p.receiveRequest(r, {claimNonce: meta => fullReceipt(meta), handlers: handlers(() => { wall = r.expiresAtMs; return lookup(); })}), 'GATEWAY_ENVELOPE_TIME_INVALID');
});
test('malformed signal and throwing listener setup are sanitized before admission', async () => {
  const p = factory(); let calls = 0;
  for (const signal of [null, {}, {aborted: 'false', addEventListener() {}, removeEventListener() {}},
    {aborted: false, addEventListener() { throw new Error('never-print-setup'); }, removeEventListener() { throw new Error('never-print-cleanup'); }}]) {
    const r = await p.receiveRequest(request(p), {signal, claimNonce: () => { calls++; }, handlers: handlers(() => { calls++; })});
    assert.equal(r.code, 'GATEWAY_OPERATION_FAILED'); assert.equal(JSON.stringify(r).includes('never-print'), false);
  }
  assert.equal(calls, 0);
});
test('throwing signal cleanup cannot overwrite successful result, fail to abort, or expose raw error', async () => {
  const p = factory(), ledger = ledgerDouble(); let signal;
  const external = {aborted: false, addEventListener() {}, removeEventListener() { throw new Error('never-print-cleanup'); }};
  const r = await p.receiveRequest(request(p), {signal: external, claimNonce: ledger.claim, handlers: handlers((_body, context) => { signal = context.signal; return lookup(); })});
  assert.equal(r.status, 'SUCCESS'); assert.equal(signal.aborted, true);
  assert.equal((await p.acceptResponse(r, request(p), {signal: external, claimNonce: ledger.claim})).status, 'SUCCESS');
});
test('clock implementation exception is never returned raw', () => {
  const p = factory({}, {now: () => { throw new Error('never-print-clock'); }});
  expectCode(() => request(p), 'GATEWAY_CLOCK_INVALID');
});