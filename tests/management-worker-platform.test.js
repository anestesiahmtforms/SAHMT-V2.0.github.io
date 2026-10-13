import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {operationalFixture,ENDPOINT} from './helpers/management-operational-fixture.js';

test('production bundle loads in workerd and SQLite admission/replay binding works without external services',async()=>{
 const dir=await mkdtemp(resolve('.local-preview/sahmt-workerd-'));let mf;
 try {
  const output=join(dir,'worker.mjs');
  await build({entryPoints:[resolve('worker-management-auth/worker.js')],outfile:output,bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*']});
  mf=new Miniflare(convertV4MiniflareOptions({name:'auth',modules:true,scriptPath:output,compatibilityDate:'2026-10-10',compatibilityFlags:['nodejs_compat'],
   durableObjects:{BROKER_STATE:{className:'ManagementBrokerAdmissionState',useSQLite:true}},bindings:{MANAGEMENT_AUTH_ENABLED:'false'}}));
  const response=await mf.dispatchFetch('https://broker.example/v1/management/session',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,503);assert.equal((await response.json()).code,'BROKER_HTTP_DISABLED');
  const ns=await mf.getDurableObjectNamespace('BROKER_STATE','auth'),stub=ns.get(ns.idFromName('test'));
  const post=async(path,body)=>{const r=await stub.fetch('https://broker-state.internal/'+path,{method:'POST',body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
  const nowMs=Date.now(),request={slotId:'a'.repeat(32),nowMs,expiresAtMs:nowMs+10000,maxConcurrent:1};
  assert.equal((await post('admit',request)).admitted,true);
  assert.equal((await post('admit',{...request,slotId:'b'.repeat(32)})).status,429);
  assert.equal((await post('release',{slotId:request.slotId})).ok,true);
  const nonce={nonceHash:'c'.repeat(64),nowMs,expiresAtMs:nowMs+20000,retainUntilMs:nowMs+320000,maxNonceRecords:1536};
  assert.equal((await post('claim-gateway-response-nonce',nonce)).status,'CLAIMED');
  assert.equal((await post('claim-gateway-response-nonce',nonce)).status,'REPLAY');
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});

test('enabled production runtime survives preflight then multiple requests without sharing request-scoped DO stubs',async()=>{
 const fixture=operationalFixture({env:{MANAGEMENT_AUTH_PILOT_ONLY:'true',MANAGEMENT_AUTH_PILOT_UIDS_JSON:'["member-a"]',
  MANAGEMENT_AUTH_PILOT_ORIGIN:'https://pilot.example'}});
 const {BROKER_STATE,...bindings}=fixture.env;
 const bundle=await build({entryPoints:[resolve('worker-management-auth/worker.js')],bundle:true,write:false,
  format:'esm',platform:'node',target:'es2022',external:['node:*']});
 let outbound=0;
 const mf=new Miniflare(convertV4MiniflareOptions({name:'auth',modules:true,script:bundle.outputFiles[0].text,
  compatibilityDate:'2026-10-10',compatibilityFlags:['nodejs_compat'],
  durableObjects:{BROKER_STATE:{className:'ManagementBrokerAdmissionState',useSQLite:true}},bindings,
  outboundService:async()=>{outbound++;return new Response('{}',{status:503});}}));
 try {
  const preflight=await mf.dispatchFetch('https://broker.example/v1/management/session',{method:'OPTIONS',headers:{
   Origin:'https://pilot.example','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
  assert.equal(preflight.status,204);
  for(let attempt=0;attempt<3;attempt++){
   const response=await mf.dispatchFetch('https://broker.example/v1/management/session',{method:'POST',
    headers:{Origin:'https://pilot.example','Content-Type':'application/json'},
    body:JSON.stringify({faIdToken:'invalid-synthetic',sourceProjectId:'sahmt-17a16',
     targetProjectIds:{FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt'}})});
   assert.equal(response.status,403);
   assert.equal((await response.json()).code,'FA_TOKEN_REJECTED');
   assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://pilot.example');
  }
  const simultaneous=await Promise.all(Array.from({length:4},async()=>{
   const response=await mf.dispatchFetch('https://broker.example/v1/management/session',{method:'POST',
    headers:{Origin:'https://pilot.example','Content-Type':'application/json'},
    body:JSON.stringify({faIdToken:'invalid-synthetic',sourceProjectId:'sahmt-17a16',targetProjectIds:{FC:'indicadores---sahmt'}})});
   return {status:response.status,...await response.json()};
  }));
  for(const result of simultaneous){assert.equal(result.status,403);assert.equal(result.code,'FA_TOKEN_REJECTED');}
  assert.equal(outbound,0);
 }finally{await mf.dispose();}
});

test('cached Gateway nonce claimer resolves its DO stub separately for each workerd request',async()=>{
 const entry=`import {ManagementBrokerAdmissionState,createManagementGatewayResponseNonceClaimer} from './worker-management-auth/admission-state.js';
 export {ManagementBrokerAdmissionState};
 let claim;
 export default {async fetch(request,env){
  claim??=createManagementGatewayResponseNonceClaimer({stateBinding:env.BROKER_STATE});
  const nonce=new URL(request.url).pathname.slice(1),now=Date.now();
  const result=await claim({namespace:'synthetic-test-namespace',direction:'APPS_SCRIPT_TO_WORKER',nonce,expiresAtMs:now+20000});
  return Response.json({status:result.status});
 }};`;
 const bundle=await build({stdin:{contents:entry,resolveDir:resolve('.')},bundle:true,write:false,
  format:'esm',platform:'node',target:'es2022',external:['node:*']});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'nonce',modules:true,script:bundle.outputFiles[0].text,
  compatibilityDate:'2026-10-10',compatibilityFlags:['nodejs_compat'],
  durableObjects:{BROKER_STATE:{className:'ManagementBrokerAdmissionState',useSQLite:true}},
  outboundService:async()=>{throw Error('EXTERNAL_CALL_FORBIDDEN');}}));
 try {
  for(const [nonce,expected]of [['a'.repeat(32),'CLAIMED'],['b'.repeat(32),'CLAIMED'],['a'.repeat(32),'REPLAY']]){
   const response=await mf.dispatchFetch('https://nonce.example/'+nonce);
   assert.equal(response.status,200);assert.equal((await response.json()).status,expected);
  }
  const concurrent=await Promise.all([1,2].map(async()=>{
   const response=await mf.dispatchFetch('https://nonce.example/'+'c'.repeat(32));
   assert.equal(response.status,200);return (await response.json()).status;
  }));
  assert.deepEqual(concurrent.sort(),['CLAIMED','REPLAY']);
 }finally{await mf.dispose();}
});

test('enabled workerd runs full FA to FB and FC through HMAC Gateway VM, redirects, SQLite nonce state and lease transactions',async t=>{
 const entry=`import {createManagementAuthWorker} from './worker-management-auth/worker.js';
 import {buildManagementAuthRuntime} from './worker-management-auth/runtime.js';
 export {ManagementBrokerAdmissionState} from './worker-management-auth/admission-state.js';
 export default createManagementAuthWorker({buildRuntime:env=>buildManagementAuthRuntime(env,{now:()=>1800000000000})});`;
 const bundle=await build({stdin:{contents:entry,resolveDir:resolve('.')},bundle:true,write:false,
  format:'esm',platform:'node',target:'es2022',external:['node:*']});
 for(const failed of [null,'FB','FC'])await t.test(failed===null?'both ready on repeated requests':failed+' signer failure is isolated',async()=>{
  const fixture=operationalFixture(failed?{failSigner:failed}:{}),{BROKER_STATE,...bindings}=fixture.env;
  let mockedRequests=0;
  const mf=new Miniflare(convertV4MiniflareOptions({name:'auth',modules:true,script:bundle.outputFiles[0].text,
   compatibilityDate:'2026-10-10',compatibilityFlags:['nodejs_compat'],
   durableObjects:{BROKER_STATE:{className:'ManagementBrokerAdmissionState',useSQLite:true}},bindings,
   outboundService:async request=>{
    mockedRequests++;
    return fixture.fetchImpl(request.url,{method:request.method,headers:Object.fromEntries(request.headers),
     signal:request.signal,...(request.method==='POST'?{body:await request.text()}:{})});
   }}));
  try{
   const preflight=await mf.dispatchFetch(ENDPOINT,{method:'OPTIONS',headers:{Origin:'https://anestesiahmtforms.github.io',
    'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
   assert.equal(preflight.status,204);
   for(let attempt=0;attempt<(failed?1:2);attempt++){
    const response=await mf.dispatchFetch(ENDPOINT,{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io',
     'Content-Type':'application/json'},body:JSON.stringify({faIdToken:fixture.token,sourceProjectId:'sahmt-17a16',
      targetProjectIds:{FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt'}})});
    assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.faUid,'member-a');
    for(const name of ['FB','FC']){
     assert.equal(result.targets[name].status,name===failed?'UNAVAILABLE':'READY');
     if(name!==failed){assert.equal(result.targets[name].uid,'member-a');assert.equal(typeof result.targets[name].customToken,'string');}
    }
   }
   assert.ok(mockedRequests>0);assert.ok(fixture.operations.includes('AUTH_USER_LOOKUP_FA'));
   assert.ok(fixture.operations.includes('READ_FA_AUTHORIZATION'));
   if(failed!=='FB')assert.ok(fixture.operations.includes('WRITE_FB_LEASE'));
   assert.equal(fixture.logs.length,0);
  }finally{await mf.dispose();}
 });
});
