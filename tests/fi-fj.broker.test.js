import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationalModuleExchange, OPERATIONAL_MODULE_TARGETS} from '../src/operational-module-broker.js';
const response = (station, overrides = {}, {headers, url} = {}) => {
  const target = OPERATIONAL_MODULE_TARGETS[station];
  const value = Response.json({station, projectId: target.config.projectId, uid: 'member', customToken: 'synthetic-custom-token', expiresIn: 300, ...overrides},
    {headers: {'Cache-Control': 'no-store', ...headers}});
  Object.defineProperty(value, 'url', {value: url || target.endpoint}); return value;
};

test('FI, FJ and FH exchange FA proofs only at their own fixed Worker endpoints', async () => {
  const calls = [];
  await Promise.all(['FI', 'FJ', 'FH'].map(async station => {
    const exchange = createOperationalModuleExchange({station, getAppCheckToken: async () => 'synthetic-attestation',
      fetchImpl: async (url, options) => {calls.push(url); assert.equal(url, OPERATIONAL_MODULE_TARGETS[station].endpoint);
        assert.equal(options.headers.Authorization, 'Bearer synthetic-fa-proof');
        assert.equal(options.headers['X-Firebase-AppCheck'], 'synthetic-attestation');
        assert.equal(options.body, '{}'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
        return response(station);
      }});
    assert.equal((await exchange({faIdToken: 'synthetic-fa-proof', faUid: 'member'})).uid, 'member');
  }));
  assert.equal(new Set(calls).size, 3);
});

test('broker rejects swapped stations, UIDs, cacheable replies, redirects and oversized tokens', async () => {
  const fixtures = [() => response('FJ'), () => response('FI', {uid: 'other'}),
    () => response('FI', {}, {headers: {'Cache-Control': 'public'}}),
    () => response('FI', {}, {url: 'https://untrusted.example/v1/session'}),
    () => response('FI', {customToken: 'x'.repeat(33000)})];
  for (const fixture of fixtures) {
    const exchange = createOperationalModuleExchange({station: 'FI', fetchImpl: async () => fixture()});
    await assert.rejects(exchange({faIdToken: 'synthetic-proof', faUid: 'member'}), /MODULE_BROKER_RESPONSE_INVALID/);
  }
});

test('invalid App Check tokens are rejected before any request', async () => {
  let calls = 0;
  const exchange = createOperationalModuleExchange({station: 'FI', getAppCheckToken: async () => ({token: 'object-is-not-a-proof'}),
    fetchImpl: async () => {calls++; return response('FI');}});
  await assert.rejects(exchange({faIdToken: 'synthetic-proof', faUid: 'member'}), /MODULE_BROKER_REQUEST_INVALID/);
  assert.equal(calls, 0);
});

test('denied exchanges close the response stream without exposing provider content', async () => {
  let cancelled = false;
  const body = new ReadableStream({cancel() {cancelled = true;}});
  const exchange = createOperationalModuleExchange({station: 'FI', fetchImpl: async () => new Response(body, {status: 403})});
  await assert.rejects(exchange({faIdToken: 'synthetic-proof', faUid: 'member'}), /MODULE_ACCESS_DENIED/);
  assert.equal(cancelled, true);
});

test('App Check failure never attempts the exchange in any module',async()=>{
 for(const station of ['FI','FJ','FH','FG']){
  let calls=0;const exchange=createOperationalModuleExchange({station,getAppCheckToken:async()=>{throw {code:'appCheck/recaptcha-error'};},fetchImpl:async()=>{calls++;return response(station);}});
  await assert.rejects(exchange({faIdToken:'synthetic-fa-proof',faUid:'member'}),{code:'MODULE_SESSION_UNAVAILABLE'});assert.equal(calls,0);
 }
});
