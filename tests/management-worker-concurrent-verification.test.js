import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {operationalFixture,ENDPOINT,GATEWAY,FA} from './helpers/management-operational-fixture.js';

// All outbound traffic is handled in memory. No production account or credential.
const entry=`import {createManagementAuthWorker} from './worker-management-auth/worker.js';
import {buildManagementAuthRuntime} from './worker-management-auth/runtime.js';
export {ManagementBrokerAdmissionState} from './worker-management-auth/admission-state.js';
export default createManagementAuthWorker({buildRuntime:env=>buildManagementAuthRuntime(env,{now:()=>1800000000000})});`;

test('concurrent destination verifications keep separate Gateway failures and reordered certificate responses',async t=>{
 const bundle=await build({stdin:{contents:entry,resolveDir:resolve('.')},bundle:true,write:false,
  format:'esm',platform:'node',target:'es2022',external:['node:*']});
 for(const scenario of ['reordered','lock-denied','lookup-403','lookup-timeout'])await t.test(scenario,async()=>{
  const fixture=operationalFixture({env:{MANAGEMENT_AUTH_PILOT_ONLY:'true',MANAGEMENT_AUTH_PILOT_UIDS_JSON:'["member-a"]'}});
  const {BROKER_STATE,...bindings}=fixture.env;
  let lookupNumber=0,certificateNumber=0,blocked=0;
  const originalCall=fixture.h.call;
  fixture.h.call=(envelope)=>{
   if(envelope.operation==='AUTH_USER_LOOKUP_FA'&&scenario==='lock-denied'&&lookupNumber===2){
    fixture.h.state.lockAvailable=false;blocked++;
    try{return originalCall(envelope);}finally{fixture.h.state.lockAvailable=true;}
   }
   return originalCall(envelope);
  };
  const originalGoogle=fixture.h.state.responseOverride;
  fixture.h.state.responseOverride=(url,options,response)=>{
   if(url.includes('/projects/'+FA+'/accounts:lookup')&&scenario==='lookup-403'&&lookupNumber===2&&blocked===0){
    blocked++;return response({error:{status:'PERMISSION_DENIED',message:'synthetic-private-canary'}},{status:403});
   }
   return originalGoogle(url,options,response);
  };
  const mf=new Miniflare(convertV4MiniflareOptions({name:'auth',modules:true,script:bundle.outputFiles[0].text,
   compatibilityDate:'2026-10-10',compatibilityFlags:['nodejs_compat'],
   durableObjects:{BROKER_STATE:{className:'ManagementBrokerAdmissionState',useSQLite:true}},bindings,
   outboundService:async request=>{
    const body=request.method==='POST'?await request.text():undefined;
    if(request.url===GATEWAY){
     const envelope=JSON.parse(body);
     if(envelope.operation==='AUTH_USER_LOOKUP_FA'){
      const ordinal=++lookupNumber;
      if(scenario==='reordered')await delay(ordinal%2?70:15);
      if(scenario==='lookup-timeout'&&ordinal===2){
       blocked++;await delay(15100);
      }
     }
    }else if(request.url.includes('/metadata/x509/securetoken@')){
     const ordinal=++certificateNumber;
     if(scenario==='reordered')await delay(ordinal===1?60:5);
    }
    return fixture.fetchImpl(request.url,{method:request.method,headers:Object.fromEntries(request.headers),
     signal:request.signal,...(body===undefined?{}:{body})});
   }}));
  try{
   const response=await mf.dispatchFetch(ENDPOINT,{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io',
    'Content-Type':'application/json'},body:JSON.stringify({faIdToken:fixture.token,sourceProjectId:FA,
     targetProjectIds:{FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt'}})});
   assert.equal(response.status,200);
   const result=await response.json();assert.equal(result.faUid,'member-a');
   if(scenario==='reordered'){
    assert.equal(result.targets.FB.status,'READY');assert.equal(result.targets.FC.status,'READY');
    assert.ok(lookupNumber>=5);assert.equal(blocked,0);
   }else{
    assert.equal(result.targets.FB.status,'READY');assert.equal(result.targets.FC.status,'UNAVAILABLE');
    assert.equal(result.targets.FC.code,'FA_TOKEN_REJECTED');assert.equal(blocked,1);
    assert.equal(result.targets.FC.diagnostic.stage,'AUTH_LOOKUP');
    assert.ok((scenario==='lookup-timeout'?['GOOGLE_AUTH_TIMEOUT','GATEWAY_CANCELLED','GATEWAY_DEADLINE_EXCEEDED']
      :scenario==='lock-denied'?['GATEWAY_LOCK_BUSY']:['GATEWAY_OPERATION_FAILED']).includes(result.targets.FC.diagnostic.code));
    assert.deepEqual(Object.keys(result.targets.FC.diagnostic).sort(),['code','stage']);
   }
   assert.equal(fixture.logs.length,0);
  }finally{await mf.dispose();}
 });
});
