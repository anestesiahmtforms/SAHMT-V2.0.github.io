import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {createManagementAuthWorker, createManagementAuthWorkerWithBroker} from './worker.js';

const origin = 'https://anestesiahmtforms.github.io';
const endpoint = 'https://broker.invalid/v1/management/session';
const faIdToken = 'synthetic-fa-id-token';
const result = {ok: true, sourceProjectId: 'sahmt-17a16', destinationProjectId: 'sahmt-gestao-5ae66',
  faUid: 'uid-synthetic', fbUid: 'uid-synthetic', memberId: 'member-synthetic', leaseVersion: 1,
  policyVersion: 'policy-local', targets: {
    FB: {projectId: 'sahmt-gestao-5ae66', status: 'READY', uid: 'uid-synthetic', customToken: 'synthetic-fb-custom-token'},
    FC: {projectId: 'indicadores---sahmt', status: 'READY', uid: 'uid-synthetic', customToken: 'synthetic-fc-custom-token'}
  }};
const request = () => new Request(endpoint, {method: 'POST', headers: {Origin: origin,
  'Content-Type': 'application/json'}, body: JSON.stringify({faIdToken, sourceProjectId: 'sahmt-17a16',
    targetProjectIds: {FB: 'sahmt-gestao-5ae66', FC: 'indicadores---sahmt'}})});
const firstLoginRequest = (body={googleIdToken:'synthetic-google-id-token',nonce:'n'.repeat(32)}) => new Request('https://broker.invalid/v1/auth/first-login',
  {method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const runtime = broker => ({enabled: true, broker, admitRequest: async () => true,
  superviseExchange: () => true, maxRequestMs: 1000, cleanupDrainMs: 50});

test('dedicated Worker fails closed when no reviewed runtime is configured', async () => {
  const response = await worker.fetch(request(), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {ok: false, code: 'BROKER_HTTP_DISABLED'});
});

test('entrypoint forwards only FA proof and allowlisted FB+FC request to the isolated broker', async () => {
  const env = {}, calls = [];
  const app = createManagementAuthWorker({buildRuntime: async suppliedEnv => {
    assert.equal(suppliedEnv, env);
    return runtime({exchange: async body => { calls.push(body); return result; }});
  }});
  const response = await app.fetch(request(), env, {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{faIdToken, sourceProjectId: 'sahmt-17a16',
    targetProjectIds: {FB: 'sahmt-gestao-5ae66', FC: 'indicadores---sahmt'}}]);
  assert.deepEqual(body.targets, result.targets);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});

test('Worker routes the default-off first-login path separately and shares supervised admission',async()=>{
  const env={},calls=[],supervised=[];
  const app=createManagementAuthWorker({buildRuntime:async()=>({...runtime({exchange:async()=>result}),
    admitRequest:async()=>({allowed:true,release:async()=>{}}),
    superviseExchange:(completion,{releaseAdmission,executionContext})=>{executionContext.waitUntil(Promise.resolve(completion).finally(releaseAdmission));return true;},
    firstLoginEnabled:true,firstLoginBroker:{claim:async(body,context)=>{calls.push({body,signal:context.signal});
      return {status:'FIRST_LOGIN',uid:'fa-user-001',customToken:'synthetic-fa-token'};}}})});
  const response=await app.fetch(firstLoginRequest(),env,{waitUntil:promise=>supervised.push(promise)});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,status:'FIRST_LOGIN',uid:'fa-user-001',customToken:'synthetic-fa-token'});
  assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{googleIdToken:'synthetic-google-id-token',nonce:'n'.repeat(32)});
  assert.equal(calls[0].signal.aborted,true);assert.equal(supervised.length,1);await Promise.all(supervised);
});

test('first-login route rejects an untrusted origin before invoking broker',async()=>{
  let calls=0;const app=createManagementAuthWorker({buildRuntime:async()=>({...runtime({exchange:async()=>result}),
    firstLoginEnabled:true,firstLoginBroker:{claim:async()=>{calls++;return {status:'DENIED',code:'x'};}}})});
  const deniedRequest=new Request('https://broker.invalid/v1/auth/first-login',{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},
    body:JSON.stringify({googleIdToken:'synthetic-google-id-token',nonce:'n'.repeat(32)})});
  const response=await app.fetch(deniedRequest,{},{});assert.equal(response.status,403);assert.equal(calls,0);
});

test('runtime initialization is cached per Worker isolate environment', async () => {
  const env = {}, calls = [];
  const app = createManagementAuthWorker({buildRuntime: async () => {
    calls.push('build'); return runtime({exchange: async () => result});
  }});
  await app.fetch(request(), env, {});
  await app.fetch(request(), env, {});
  assert.deepEqual(calls, ['build']);
});

test('local Worker composition wires injected broker through durable admission and supervised release', async () => {
  const slots = new Set(), stateCalls = [], env = {BROKER_STATE:{idFromName:name => name,
    get:name => ({fetch:async request => {
      assert.equal(name,'global-admission-v1');
      const url = new URL(request.url), body = await request.json(); stateCalls.push(url.pathname);
      if (url.pathname === '/admit') {
        if (slots.size >= body.maxConcurrent) return Response.json({ok:false}, {status:429});
        slots.add(body.slotId); return Response.json({ok:true,admitted:true});
      }
      if (url.pathname === '/release') { slots.delete(body.slotId); return Response.json({ok:true}); }
      return Response.json({ok:false}, {status:404});
    }})}}, supervised = [];
  const app = createManagementAuthWorkerWithBroker({buildBroker:async (suppliedEnv, adapters) => {
    assert.equal(suppliedEnv,env);
    assert.equal(adapters.managementGateway.enabled,false);
    assert.equal(adapters.managementPolicyVersion,'sahmt-management-authz-v1');
    assert.equal(adapters.privilegedGateway,adapters.managementGateway);
    return {exchange:async body => { assert.equal(body.faIdToken,faIdToken); return result; }};
  },newSlotId:()=>'synthetic-slot-id-0001',maxConcurrent:1,maxRequestMs:1000,cleanupDrainMs:100});
  const response = await app.fetch(request(),env,{waitUntil:promise=>supervised.push(promise)});
  assert.equal(response.status,200);
  await Promise.all(supervised);
  assert.deepEqual(stateCalls,['/admit','/release']);
  assert.equal(slots.size,0);
});

test('invalid runtime fails closed without exposing configuration errors', async () => {
  const app = createManagementAuthWorker({buildRuntime: async () => ({enabled: true, secret: 'do-not-return'})});
  const response = await app.fetch(request(), {}, {});
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(body.includes('do-not-return'), false);
  assert.equal(body.includes('WORKER_RUNTIME_INVALID'), false);
});

test('a denial from the broker remains sanitized at the Worker edge', async () => {
  const app = createManagementAuthWorker({buildRuntime: async () => runtime({exchange: async () => ({
    ok: false, code: 'FA_TOKEN_REJECTED', privateDetail: faIdToken
  })})});
  const response = await app.fetch(request(), {}, {});
  const body = await response.text();
  assert.equal(response.status, 403);
  assert.equal(body.includes(faIdToken), false);
});
