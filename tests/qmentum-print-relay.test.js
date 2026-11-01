import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {relayQmentumPrints} from '../worker-management-auth/qmentum-print-relay.js';
import {createManagementAuthWorker} from '../worker-management-auth/worker.js';
const uid='synthetic-manager',key='A'.repeat(43),origin='https://anestesiahmtforms.github.io';
const token=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,aud:'indicadores---sahmt',iss:'https://securetoken.google.com/indicadores---sahmt'})).toString('base64url')+'.'+'s'.repeat(100);
const env={QMENTUM_WRITE_ENABLED:'true',OPERATIONAL_SHEETS_HMAC_SECRET:key,FC_MODULE_SCRIPT_URL:'https://script.google.com/macros/s/'+'f'.repeat(30)+'/exec'};
const request=(body={operation:'SCAN',unitId:'synthetic',year:2026},o=origin)=>new Request('https://synthetic-worker/v1/qmentum/prints',{method:'POST',headers:{Origin:o,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
function fixture({readStatus=200,role='manager',wrongUnit=false,badMac=false,badRedirect=false}={}){
 const calls=[];let releases=0;const fetchImpl=async(url,options)=>{calls.push({url,options});if(calls.length===1)return Response.json({name:'projects/indicadores---sahmt/databases/(default)/documents/qmentumAccess/'+uid,fields:{uid:{stringValue:uid},role:{stringValue:role},active:{booleanValue:true},units:{arrayValue:{values:[{stringValue:wrongUnit?'other':'synthetic'}]}}}},{status:readStatus});
  if(badRedirect)return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/path'}});
  const sent=JSON.parse(options.body),input=JSON.parse(Buffer.from(sent.payload,'base64url'));assert.equal(sent.mac,createHmac('sha256',key).update('SAHMT_QMENTUM_PRINT_V1\n'+sent.payload).digest('hex'));assert.equal(input.uid,uid);assert.equal(input.request.unitId,'synthetic');
  const payload=Buffer.from(JSON.stringify({v:1,nonce:input.nonce,code:'QMENTUM_PRINT_SCAN',result:{candidates:[]}})).toString('base64url');return Response.json({payload,mac:badMac?'0'.repeat(64):createHmac('sha256',key).update('SAHMT_QMENTUM_PRINT_V1\n'+payload).digest('hex')});
 };return{calls,fetchImpl,admitRequest:async()=>({allowed:true,release:async()=>{releases++;}}),releases:()=>releases};
}
test('print relay proves FC manager scope and verifies dedicated signed request/reply',async()=>{
 const f=fixture(),r=await relayQmentumPrints(request(),env,f);assert.equal(r.status,200);assert.deepEqual(await r.json(),{code:'QMENTUM_PRINT_SCAN',result:{candidates:[]}});assert.equal(f.calls[1].url,env.FC_MODULE_SCRIPT_URL+'?action=qmentum-prints-v1');assert.equal(f.releases(),1);
});
test('denied FC identity, collectors and other units never invoke OCR backend',async()=>{
 for(const option of [{readStatus:403},{role:'collector'},{wrongUnit:true}]){const f=fixture(option),r=await relayQmentumPrints(request(),env,f);assert.equal(r.status,403);assert.equal(f.calls.length,1);}
});
test('disabled transport, invalid origins/operations, historical scope and absent admission cause no privileged calls',async()=>{
 const f=fixture();assert.equal((await relayQmentumPrints(request(),{...env,QMENTUM_WRITE_ENABLED:'false'},f)).status,503);assert.equal((await relayQmentumPrints(request(undefined,'https://bad.invalid'),env,f)).status,403);assert.equal((await relayQmentumPrints(request(),env,{fetchImpl:f.fetchImpl})).status,503);
 assert.equal((await relayQmentumPrints(request({operation:'DELETE',unitId:'synthetic'}),env,f)).status,400);assert.equal((await relayQmentumPrints(request({operation:'PREVIEW',unitId:'synthetic',period:'2026-06',source:'DRIVE'}),env,f)).status,400);assert.equal(f.calls.length,0);
});
test('unsigned responses and redirects outside the Apps Script echo endpoint fail closed',async()=>{
 for(const option of [{badMac:true},{badRedirect:true}]){const f=fixture(option),r=await relayQmentumPrints(request(),env,f);assert.equal(r.status,503);assert.equal(f.calls.length,2);}
});
test('production Worker routes print requests while retired secondary authentication remains disabled',async()=>{
 const f=fixture(),saved=globalThis.fetch,worker=createManagementAuthWorker({buildOperationalRuntime:async()=>({maxRequestMs:80000,admitRequest:f.admitRequest})});
 try{globalThis.fetch=f.fetchImpl;const r=await worker.fetch(request(),{...env,MANAGEMENT_SECONDARY_AUTH_RETIRED:'true'});assert.equal(r.status,200);assert.equal((await r.json()).code,'QMENTUM_PRINT_SCAN');}finally{globalThis.fetch=saved;}
});
