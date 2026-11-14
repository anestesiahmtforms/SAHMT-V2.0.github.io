import test from 'node:test';
import assert from 'node:assert/strict';
import {withFcCompatibility, FC_COMPAT_ORIGIN} from '../worker-management-auth/fc-compat-forward.js';
import {createFcIntegrationWorker} from '../worker-fc-integration/worker.js';

const origin = 'https://anestesiahmtforms.github.io';
const paths = ['/v1/qmentum/write', '/v1/qmentum/prints'];
const env = {FC_COMPAT_FORWARD_ENABLED:'true', FC_COMPAT_PRINTS_READY:'true'};
const req = (path, options={}) => new Request('https://central.example.test' + path, {
  method:'POST', headers:{Origin:origin, Authorization:'Bearer synthetic-fixture', 'Content-Type':'application/json'}, body:'{"fixture":true}', ...options
});

test('disabled compatibility and every non-FC route use the original module unchanged', async () => {
  const calls = [], context = {};
  const original = {async fetch(...args) {calls.push(args); return new Response('original', {status:418});}};
  const worker = withFcCompatibility(original, {fetchImpl:async () => {throw Error('unexpected upstream');}});
  for (const [path, settings] of [...paths.map(p=>[p, {}]), ...['/v1/auth/first-login', '/v1/operational-sheets/notify', '/v1/diretrizes/reading', '/unknown'].map(p=>[p, env])]) {
    const request = req(path);
    assert.equal((await worker.fetch(request, settings, context)).status, 418);
    assert.deepEqual(calls.at(-1), [request, settings, context]);
  }
});

test('the cached QMENTUM routes retain bearer, body, CORS and upstream errors at the fixed FC origin', async () => {
  for (const path of paths) {
    let call;
    const worker = withFcCompatibility({fetch(){throw Error('central must not execute');}}, {fetchImpl:async (url, options) => {
      call = {url, options, body:await new Response(options.body).text()};
      return Response.json({code:'FIXTURE_AUTHORIZATION_DENIED'}, {status:403, headers:{'Access-Control-Allow-Origin':origin, 'Set-Cookie':'forbidden=1'}});
    }});
    const request = req(path, {headers:{Origin:origin, Authorization:'Bearer synthetic-fixture', Cookie:'private=1', 'X-Admin-Key':'forbidden', 'Content-Type':'application/json'}});
    const response = await worker.fetch(request, env);
    assert.equal(call.url, FC_COMPAT_ORIGIN + path);
    assert.equal(call.body, '{"fixture":true}');
    assert.equal(call.options.headers.get('Authorization'), 'Bearer synthetic-fixture');
    assert.equal(call.options.headers.get('Cookie'), null);
    assert.equal(call.options.headers.get('X-Admin-Key'), null);
    assert.equal(call.options.redirect, 'manual');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'FIXTURE_AUTHORIZATION_DENIED');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('query, origin and method violations cannot make any upstream request', async () => {
  let calls = 0;
  const worker = withFcCompatibility({fetch(){throw Error('central must not execute');}}, {fetchImpl:async () => {calls++;}});
  assert.equal((await worker.fetch(req(paths[0] + '?target=https://elsewhere.test'), env)).status, 404);
  assert.equal((await worker.fetch(req(paths[0], {headers:{Origin:'https://untrusted.invalid'}}), env)).status, 403);
  assert.equal((await worker.fetch(req(paths[0], {method:'GET', body:undefined}), env)).status, 405);
  assert.equal(calls, 0);
});

test('print drain blocks mutations while preflight and the other FC actions remain available', async () => {
  const calls = [];
  const worker = withFcCompatibility({}, {fetchImpl:async (url) => {calls.push(url); return new Response(null, {status:204});}});
  const draining = {...env, FC_COMPAT_PRINTS_READY:'false'};
  const blocked = await worker.fetch(req(paths[1]), draining);
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal((await blocked.json()).code, 'QMENTUM_PRINT_UNAVAILABLE');
  assert.equal((await worker.fetch(req(paths[1], {method:'OPTIONS', body:undefined}), draining)).status, 204);
  assert.equal((await worker.fetch(req(paths[0]), draining)).status, 204);
  assert.equal(calls.length, 2);
});

test('an outage or redirect never retries or falls back to the old executor', async () => {
  for (const failure of ['throw', 'redirect']) {
    let calls = 0;
    const worker = withFcCompatibility({fetch(){throw Error('forbidden fallback');}}, {fetchImpl:async () => {
      calls++; if (failure === 'throw') throw Error('fixture outage');
      return new Response('redirect', {status:302, headers:{Location:'https://untrusted.invalid'}});
    }});
    const response = await worker.fetch(req(paths[0]), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'FC_COMPAT_UNAVAILABLE');
    assert.equal(calls, 1);
  }
});

test('a cached client still reaches FC bearer validation before any privileged backend call', async () => {
  let proofs = 0;
  const fc = createFcIntegrationWorker({fetchImpl:async () => {
    proofs++;
    return Response.json({error:{code:403}}, {status:403});
  }});
  const fcEnv = {FC_INTEGRATION_ENABLED:'true', QMENTUM_WRITE_ENABLED:'true', OCCURRENCE_SCORING_ENABLED:'true',
    FC_MODULE_SCRIPT_URL:'https://script.google.com/macros/s/' + 'synthetic'.repeat(5) + '/exec',
    OPERATIONAL_SHEETS_HMAC_SECRET:'s'.repeat(43), OCCURRENCE_SCORING_HMAC_SECRET:'o'.repeat(43),
    FC_ADMISSION:{idFromName:name=>name, get:()=>({fetch:async request=>Response.json({ok:true, admitted:new URL(request.url).pathname==='/admit'})})}};
  const worker = withFcCompatibility({fetch(){throw Error('old executor forbidden');}}, {
    fetchImpl:(url, options)=>fc.fetch(new Request(url, options), fcEnv)
  });
  const response = await worker.fetch(req('/v1/qmentum/prints'), env);
  assert.equal(response.status, 401);
  assert.equal(proofs, 0);
  const token = 'header.' + Buffer.from(JSON.stringify({aud:'sahmt-17a16', iss:'https://securetoken.google.com/sahmt-17a16', sub:'same-fixture-uid'})).toString('base64url') + '.synthetic-signature';
  const denied = await worker.fetch(req('/v1/qmentum/prints', {
    headers:{Origin:origin, Authorization:'Bearer ' + token, 'Content-Type':'application/json'},
    body:JSON.stringify({operation:'SCAN', unitId:'sahmt', year:2026})
  }), env);
  assert.equal(denied.status, 401);
  assert.equal(proofs, 0);
  const fcToken = 'header.' + Buffer.from(JSON.stringify({aud:'indicadores---sahmt', iss:'https://securetoken.google.com/indicadores---sahmt', sub:'same-fixture-uid'})).toString('base64url') + '.synthetic-signature';
  const unapproved = await worker.fetch(req('/v1/qmentum/prints', {
    headers:{Origin:origin, Authorization:'Bearer ' + fcToken, 'Content-Type':'application/json'},
    body:JSON.stringify({operation:'SCAN', unitId:'sahmt', year:2026})
  }), env);
  assert.equal(unapproved.status, 403);
  assert.equal(proofs, 1);
});

test('FA refuses occurrence scoring before the central module or FC can be called', async () => {
 const unexpected=()=>assert.fail('Retired scoring must not reach another service');
 const worker=withFcCompatibility({fetch:unexpected},{fetchImpl:unexpected});
 for(const settings of [env,{}]){
  const response=await worker.fetch(req('/v1/evaluation/occurrence'),settings);
  assert.equal(response.status,410);
  assert.equal((await response.json()).code,'OCCURRENCE_SCORING_RETIRED_IN_FA');
 }
});
