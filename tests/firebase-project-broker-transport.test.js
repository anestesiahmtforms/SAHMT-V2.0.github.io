import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirebaseProjectBrokerTransport} from '../src/firebase-project-broker-transport.js';

const endpoint = 'https://sahmt-auth-broker.example.workers.dev/v1/management/session';
const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66', FC = 'indicadores---sahmt';
const valid = () => ({schemaVersion: 1, sourceProjectId: FA, faUid: 'uid-a', targets: {
  FB: {projectId: FB, status: 'READY', uid: 'uid-a', customToken: 'private-fb-token'},
  FC: {projectId: FC, status: 'READY', uid: 'uid-a', customToken: 'private-fc-token'}
}});
function response(payload, {url = endpoint, status = 200, headers = {}} = {}) {
  const result = new Response(JSON.stringify(payload), {status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers}});
  Object.defineProperty(result, 'url', {value: url});
  return result;
}
function transport(fetchImpl, extra = {}) {
  return createFirebaseProjectBrokerTransport({enabled: true, endpoint, allowedOrigins: ['https://sahmt-auth-broker.example.workers.dev'],
    fetchImpl, timeoutMs: 200, maxResponseBytes: 4096, maxResponseChunks: 32, ...extra});
}
const request = () => ({faIdToken: 'private-fa-id-token', sourceProjectId: FA, targetProjectIds: {FB, FC}});

test('desligado não faz fetch e retorno de cliente não revela detalhes', async () => {
  let calls = 0;
  const client = createFirebaseProjectBrokerTransport();
  await assert.rejects(client.exchangeTargets(request()), {code: 'PROJECT_BROKER_DISABLED'});
  assert.equal(calls, 0);
});

test('envia somente token FA e projetos fixos, com cookies e redirects desativados', async () => {
  let sent;
  const client = transport(async (url, init) => {
    sent = {url, init, body: JSON.parse(init.body)};
    return response(valid());
  });
  const result = await client.exchangeTargets(request(), {deadlineMs: Date.now() + 1000});
  assert.deepEqual(sent.body, {faIdToken: 'private-fa-id-token', sourceProjectId: FA, targetProjectIds: {FB, FC}});
  assert.equal(sent.init.credentials, 'omit');
  assert.equal(sent.init.redirect, 'error');
  assert.equal(sent.init.cache, 'no-store');
  assert.equal(sent.init.referrerPolicy, 'no-referrer');
  assert.equal(sent.url, endpoint);
  assert.deepEqual(result.targets.FB, valid().targets.FB);
  assert.deepEqual(result.targets.FC, valid().targets.FC);
});

test('FC pode falhar sem remover token FB válido', async () => {
  const payload = valid();
  payload.targets.FC = {projectId: FC, status: 'UNAVAILABLE', code: 'FC_TOKEN_SIGN_FAILED'};
  const result = await transport(async () => response(payload)).exchangeTargets(request());
  assert.equal(result.targets.FB.status, 'READY');
  assert.deepEqual(result.targets.FC, payload.targets.FC);
});

test('o transporte permite FC-only e autorização negada por destino', async () => {
  let sent;
  const payload={schemaVersion:1,sourceProjectId:FA,faUid:'uid-a',targets:{
    FC:{projectId:FC,status:'READY',uid:'uid-a',customToken:'private-fc-token'}}};
  const client=transport(async(_url,init)=>{sent=JSON.parse(init.body);return response(payload);});
  const result=await client.exchangeTargets({faIdToken:'private-fa-id-token',sourceProjectId:FA,targetProjectIds:{FC}});
  assert.deepEqual(sent.targetProjectIds,{FC});assert.deepEqual(Object.keys(result.targets),['FC']);
  const denied={...payload,targets:{FC:{projectId:FC,status:'DENIED',code:'FC_ACCESS_DENIED'}}};
  const deniedResult=await transport(async()=>response(denied)).exchangeTargets({faIdToken:'private-fa-id-token',sourceProjectId:FA,targetProjectIds:{FC}});
  assert.deepEqual(deniedResult.targets.FC,{status:'UNAVAILABLE',projectId:FC,code:'FC_ACCESS_DENIED'});
});

test('endpoint, origem e target map são pinados antes de fetch', async t => {
  for (const extra of [
    {endpoint: 'http://sahmt-auth-broker.example.workers.dev/v1/management/session'},
    {endpoint: endpoint + '?token=secret'},
    {allowedOrigins: ['https://other.example']}
  ]) await t.test('transport config', async () => {
    let calls = 0;
    const client = transport(async () => { calls++; return response(valid()); }, extra);
    await assert.rejects(client.exchangeTargets(request()));
    assert.equal(calls, 0);
  });
  let calls = 0;
  const client = transport(async () => { calls++; return response(valid()); });
  await assert.rejects(client.exchangeTargets({...request(), targetProjectIds: {FB, FC: 'foreign'}}), {code: 'PROJECT_BROKER_REQUEST_INVALID'});
  assert.equal(calls, 0);
});

test('redirect, cacheable response, wrong UID/project and malformed token are rejected', async t => {
  const cases = [
    [valid(), {url: 'https://script.googleusercontent.com/macros/echo?user_content_key=x'}],
    [valid(), {headers: {'Cache-Control': 'public, max-age=3600'}}],
    [{...valid(), faUid: 'other'}, {}],
    [({...valid(), targets: {...valid().targets, FC: {...valid().targets.FC, projectId: FB}}}), {}],
    [({...valid(), targets: {...valid().targets, FC: {...valid().targets.FC, customToken: 'bad token'}}}), {}]
  ];
  for (const [payload, options] of cases) await t.test('response rejected', async () => {
    const client = transport(async () => response(payload, options));
    await assert.rejects(client.exchangeTargets(request()));
  });
});

test('oversized body, excess chunks, HTTP failures and raw exceptions are sanitized', async t => {
  const huge = {...valid(), extra: 'x'.repeat(5000)};
  const cases = [
    async () => response(huge),
    async () => response(valid(), {status: 500}),
    async () => { throw new Error('private-fa-id-token private-fb-token'); }
  ];
  for (const fetchImpl of cases) await t.test('static denial only', async () => {
    const client = transport(fetchImpl);
    await assert.rejects(client.exchangeTargets(request()), error => {
      assert.equal(String(error.message).includes('private-fa-id-token'), false);
      assert.equal(String(error.message).includes('private-fb-token'), false);
      return true;
    });
  });
});

test('timeout, abort, and dispose cancel fetch without accepting a late response', async t => {
  const hanging = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('late private response')), {once: true});
  });
  const timed = transport(hanging, {timeoutMs: 20});
  await assert.rejects(timed.exchangeTargets(request()), {code: 'PROJECT_BROKER_TIMEOUT'});
  const controller = new AbortController(), aborted = transport(hanging);
  const pending = aborted.exchangeTargets(request(), {signal: controller.signal});
  controller.abort();
  await assert.rejects(pending, {code: 'PROJECT_BROKER_ABORTED'});
  const disposed = transport(hanging), late = disposed.exchangeTargets(request());
  disposed.dispose();
  await assert.rejects(late);
});

test('transport separates safe HTTP, network/CORS, header and redirect codes without reading error bodies', async () => {
  const cases = [
    {fetchImpl:async()=>{throw Object.assign(Error('private-token@example.invalid'),{code:'PROJECT_BROKER_PRIVATE_TOKEN'});},code:'PROJECT_BROKER_NETWORK_OR_CORS',httpStatus:null},
    {fetchImpl:async()=>({status:403,get body(){throw Error('private body must not be read');},headers:{get(){throw Error('private headers must not be read');}}}),code:'PROJECT_BROKER_HTTP_ERROR',httpStatus:403},
    {fetchImpl:async()=>response(valid(),{headers:{'Content-Type':'text/html; private-token'}}),code:'PROJECT_BROKER_CONTENT_TYPE_INVALID',httpStatus:200},
    {fetchImpl:async()=>response(valid(),{headers:{'Cache-Control':'private'}}),code:'PROJECT_BROKER_CACHE_POLICY_INVALID',httpStatus:200},
    {fetchImpl:async()=>response(valid(),{url:'https://other.example.invalid/private-token'}),code:'PROJECT_BROKER_RESPONSE_URL_REJECTED',httpStatus:200},
    {fetchImpl:async()=>({status:0,type:'opaque'}),code:'PROJECT_BROKER_OPAQUE_RESPONSE',httpStatus:null}
  ];
  for (const entry of cases) await assert.rejects(transport(entry.fetchImpl).exchangeTargets(request()),error=>{
    assert.equal(error.code,entry.code);assert.equal(error.httpStatus,entry.httpStatus);
    assert.equal(error.message,entry.code);assert.equal(JSON.stringify(error).includes('private-token'),false);return true;
  });
});

test('HTTP denial exposes only allowlisted broker code and status, ignoring private fields', async () => {
  for(const [code,expected] of [['FA_TOKEN_REJECTED','FA_TOKEN_REJECTED'],['BROKER_PILOT_UID_DENIED','BROKER_PILOT_UID_DENIED'],
    ['FB_LEASE_WRITE_FAILED','FB_LEASE_WRITE_FAILED'],['PRIVATE_UID_TOKEN','PROJECT_BROKER_HTTP_ERROR']]) {
    const payload={ok:false,code,uid:'private-uid',email:'private@example.invalid',token:'private-token',message:'private-message'};
    await assert.rejects(transport(async()=>response(payload,{status:403})).exchangeTargets(request()),error=>{
      assert.equal(error.code,expected);assert.equal(error.httpStatus,403);
      assert.equal(JSON.stringify(error).includes('private'),false);return true;
    });
  }
});

test('HTTP denial body is not read unless JSON, no-store and pinned URL checks pass', async () => {
  for(const options of [{headers:{'Content-Type':'text/html'}},{headers:{'Cache-Control':'public'}},{url:'https://other.example.invalid/'}]){
    const reply=response({ok:false,code:'FA_TOKEN_REJECTED'},{status:403,...options});
    Object.defineProperty(reply,'body',{get(){assert.fail('rejected body must not be accessed');}});
    await assert.rejects(transport(async()=>reply).exchangeTargets(request()),{code:'PROJECT_BROKER_HTTP_ERROR',httpStatus:403});
  }
  await assert.rejects(transport(async()=>response({ok:false,code:'FA_TOKEN_REJECTED',padding:'x'.repeat(4200)},{status:403}),
    {maxResponseBytes:65536}).exchangeTargets(request()),{code:'PROJECT_BROKER_RESPONSE_TOO_LARGE',httpStatus:403});
});
