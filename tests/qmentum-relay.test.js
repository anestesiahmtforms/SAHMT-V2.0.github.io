import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {relayQmentumWrite} from '../worker-management-auth/qmentum-write-relay.js';
import {createManagementAuthWorker} from '../worker-management-auth/worker.js';
const uid='synthetic-user',hash='a'.repeat(64),id=uid+'_'+hash,key='A'.repeat(43),origin='https://anestesiahmtforms.github.io';
const token=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,aud:'indicadores---sahmt',iss:'https://securetoken.google.com/indicadores---sahmt'})).toString('base64url')+'.'+'s'.repeat(100);
const env={QMENTUM_WRITE_ENABLED:'true',OPERATIONAL_SHEETS_HMAC_SECRET:key,OPERATIONAL_SHEETS_SCRIPT_URL:'https://script.google.com/macros/s/'+'x'.repeat(30)+'/exec'};
const request=(o=origin)=>new Request('https://synthetic-worker/v1/qmentum/write',{method:'POST',headers:{Origin:o,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id})});
function fixture({readStatus=200,wrongUid=false,badMac=false,badRedirect=false}={}){
 const calls=[];let releases=0;
 const fetchImpl=async(url,options)=>{calls.push({url,options});if(calls.length===1)return new Response(JSON.stringify({name:'projects/indicadores---sahmt/databases/(default)/documents/qmentumWriteRequests/'+id,fields:{actorUid:{stringValue:wrongUid?'other':uid},payloadHash:{stringValue:hash}}}),{status:readStatus});
  if(badRedirect)return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/path'}});
  const sent=JSON.parse(options.body),input=JSON.parse(Buffer.from(sent.payload,'base64url'));
  assert.equal(sent.mac,createHmac('sha256',key).update('SAHMT_QMENTUM_WRITE_V1\n'+sent.payload).digest('hex'));
  const payload=Buffer.from(JSON.stringify({v:1,nonce:input.nonce,code:'QMENTUM_WRITE_CONFIRMED',version:1})).toString('base64url');
  return new Response(JSON.stringify({payload,mac:badMac?'0'.repeat(64):createHmac('sha256',key).update('SAHMT_QMENTUM_WRITE_V1\n'+payload).digest('hex')}),{status:200});
 };
 return{calls,fetchImpl,admitRequest:async()=>({allowed:true,release:async()=>{releases++;}}),releases:()=>releases};
}
test('relay verifies FC bearer through own command, signs request and verifies signed version',async()=>{
 const fcUrl='https://script.google.com/macros/s/'+'f'.repeat(30)+'/exec';
 const f=fixture(),r=await relayQmentumWrite(request(),{...env,FC_MODULE_SCRIPT_URL:fcUrl},f);assert.equal(r.status,200);assert.deepEqual(await r.json(),{code:'QMENTUM_WRITE_CONFIRMED',version:1});assert.equal(f.calls.length,2);assert.equal(f.releases(),1);assert.equal(f.calls[1].url,fcUrl+'?action=qmentum-write-v1');
});
test('Firestore denial and other UID never reach the privileged backend',async()=>{
 for(const options of [{readStatus:403},{wrongUid:true}]){const f=fixture(options),r=await relayQmentumWrite(request(),env,f);assert.equal(r.status,403);assert.equal(f.calls.length,1);}
});
test('tampered response and external redirects fail closed',async()=>{
 for(const options of [{badMac:true},{badRedirect:true}]){const f=fixture(options),r=await relayQmentumWrite(request(),env,f);assert.equal(r.status,503);assert.equal(f.calls.length,2);assert.deepEqual(await r.json(),{code:'QMENTUM_WRITE_UNAVAILABLE'});}
});
test('disabled writes, unsupported origins and missing admission do not fetch',async()=>{
 const f=fixture();assert.equal((await relayQmentumWrite(request(),{...env,QMENTUM_WRITE_ENABLED:'false'},f)).status,503);
 assert.equal((await relayQmentumWrite(request('https://untrusted.invalid'),env,f)).status,403);
 assert.equal((await relayQmentumWrite(request(),env,{fetchImpl:f.fetchImpl})).status,503);assert.equal(f.calls.length,0);
});
test('production Worker composition routes QMENTUM while secondary authentication remains retired',async()=>{
 const f=fixture(),original=globalThis.fetch;
 const worker=createManagementAuthWorker({buildOperationalRuntime:async()=>({maxRequestMs:80000,admitRequest:f.admitRequest})});
 try{globalThis.fetch=f.fetchImpl;const r=await worker.fetch(request(),{...env,MANAGEMENT_SECONDARY_AUTH_RETIRED:'true'});assert.equal(r.status,200);assert.equal((await r.json()).version,1);assert.equal(f.calls.length,2);}finally{globalThis.fetch=original;}
});
