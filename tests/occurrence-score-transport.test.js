import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createHmac} from 'node:crypto';
import {relayOccurrenceScore as relayActual} from '../worker-management-auth/occurrence-score-relay.js';
const relayOccurrenceScore=(request,env,options={})=>relayActual(request,env,{admitRequest:async()=>({allowed:true,release:async()=>{}}),...options});
import {notifyOccurrenceScore} from '../src/occurrence-scoring-delivery.js';
const secret='s'.repeat(43),id='12345678-1234-1234-1234-123456789abc',origin='https://anestesiahmtforms.github.io',worker='https://broker.invalid/v1/evaluation/occurrence';
const token='header.'+Buffer.from(JSON.stringify({aud:'indicadores---sahmt',iss:'https://securetoken.google.com/indicadores---sahmt',sub:'fixture',firebase:{sign_in_provider:'custom'},sahmtFaSourceProjectId:'sahmt-17a16'})).toString('base64url')+'.synthetic-signature';
const env={OCCURRENCE_SCORING_ENABLED:'true',OCCURRENCE_SCORING_HMAC_SECRET:secret,OCCURRENCE_SCORING_SCRIPT_URL:'https://script.google.com/macros/s/'+'synthetic'.repeat(4)+'/exec'};
const sign=payload=>createHmac('sha256',secret).update('SAHMT_OCCURRENCE_SCORE_V1\n'+payload).digest('hex');
const envelope=(overrides={})=>{const payload=Buffer.from(JSON.stringify({v:1,aud:'sahmt-occurrence-score',nonce:'a'.repeat(32),id,uid:'fixture',issuedAt:Date.now(),expiresAt:Date.now()+60000,...overrides})).toString('base64url');return{payload,mac:sign(payload)};};
function receiver() {
 const props=new Map([['SAHMT_V2_OCCURRENCE_SCORING_HMAC_SECRET',secret]]),calls=[],logs=[];let enabled=true;
 const ctx=vm.createContext({Date,JSON,Object,Number,String,Error,console:{log:x=>logs.push(x),error:x=>logs.push(x)},
   evaluationOccurrenceEnabled_:()=>enabled,sahmtV2Properties_:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),getProperties:()=>Object.fromEntries(props),deleteProperty:k=>props.delete(k)}),
   LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
   Utilities:{Charset:{UTF_8:'UTF-8'},computeHmacSha256Signature:(s,k)=>[...createHmac('sha256',k).update(s).digest()],base64EncodeWebSafe:s=>Buffer.from(s).toString('base64url'),base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString('utf8')})},
   ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},evaluationDeliverOccurrence_:(...x)=>calls.push(x)});
 for(const file of ['OperationalSheetPush.gs','EvaluationOccurrenceHttp.gs'])vm.runInContext(readFileSync(new URL('../apps-script-v2/'+file,import.meta.url),'utf8'),ctx);
 return {calls,logs,props,disable:()=>{enabled=false;},invoke:e=>ctx.doPost({parameter:{action:'occurrence-score-v1'},postData:{contents:JSON.stringify(e)}})};
}
const code=reply=>reply.payload?JSON.parse(Buffer.from(reply.payload,'base64url')).code:reply.code;
const request=()=>new Request(worker,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token},body:JSON.stringify({id})});
test('worker and actual Apps Script receiver agree on both HMACs and redirect protocol',async()=>{
 const h=receiver(),calls=[];let reply;
 const out=await relayOccurrenceScore(request(),env,{fetchImpl:async(url,options)=>{
  calls.push({url,options});if(url.startsWith('https://firestore.googleapis.com/'))return Response.json({name:'projects/indicadores---sahmt/databases/(default)/documents/occurrenceScoreClaims/'+id,fields:{uid:{stringValue:'fixture'},sourceId:{stringValue:id}}});
  if(url.startsWith('https://script.google.com/')){reply=h.invoke(JSON.parse(options.body));return new Response(null,{status:302,headers:{Location:'https://script.googleusercontent.com/macros/echo?user_content_key=synthetic'}});}
  return Response.json(reply);
 }});
 assert.equal(out.status,200);assert.equal((await out.json()).code,'OCCURRENCE_SCORE_ACCEPTED');assert.equal(h.calls.length,1);assert.deepEqual([...h.calls[0]],[id,'fixture']);assert.deepEqual(h.logs,[]);
 assert.equal(calls[2].options.method,'GET');assert.equal(calls[2].options.headers,undefined);
 assert.equal(calls[1].options.body.includes(token),false);assert.equal(calls[1].options.body.includes(secret),false);
});
test('disabled receiver does no privileged work or nonce storage',()=>{const h=receiver();h.disable();assert.equal(code(h.invoke(envelope())),'OCCURRENCE_SCORING_DISABLED');assert.equal(h.calls.length,0);assert.equal(h.props.size,1);});
test('tampering, expiry and wrong audience fail before scoring',()=>{
 for(const e of [envelope({aud:'sahmt-operational-sheet'}),envelope({issuedAt:Date.now()-120000,expiresAt:Date.now()-60000}),{...envelope(),mac:'0'.repeat(64)},envelope({points:100})]){const h=receiver();assert.notEqual(code(h.invoke(e)),'OCCURRENCE_SCORE_ACCEPTED');assert.equal(h.calls.length,0);assert.deepEqual(h.logs,[]);}
});
test('same nonce replay rejected; new nonce retry delegates idempotency to durable ledger',()=>{const h=receiver(),e=envelope();assert.equal(code(h.invoke(e)),'OCCURRENCE_SCORE_ACCEPTED');assert.equal(code(h.invoke(e)),'OCCURRENCE_SCORE_REPLAY_DENIED');assert.equal(code(h.invoke(envelope({nonce:'b'.repeat(32)}))),'OCCURRENCE_SCORE_ACCEPTED');assert.equal(h.calls.length,2);});
test('Firestore denial never reaches Apps Script',async()=>{let n=0;const out=await relayOccurrenceScore(request(),env,{fetchImpl:async()=>{n++;return new Response(null,{status:403});}});assert.equal(out.status,403);assert.equal(n,1);});

test('admission failure performs no external reads and a settled denial releases its slot',async()=>{
 let calls=0,released=0;const fetchImpl=async()=>{calls++;return new Response(null,{status:403});};
 assert.equal((await relayActual(request(),env,{fetchImpl})).status,503);
 assert.equal((await relayOccurrenceScore(request(),env,{fetchImpl,admitRequest:async()=>false})).status,429);assert.equal(calls,0);
 await relayOccurrenceScore(request(),env,{fetchImpl,admitRequest:async()=>({allowed:true,release:async()=>{released++;}})});
 assert.equal(calls,1);assert.equal(released,1);
});
test('external redirect is rejected without sending credentials to it',async()=>{let n=0;const out=await relayOccurrenceScore(request(),env,{fetchImpl:async()=>++n===1?Response.json({name:'projects/indicadores---sahmt/databases/(default)/documents/occurrenceScoreClaims/'+id,fields:{uid:{stringValue:'fixture'},sourceId:{stringValue:id}}}):new Response(null,{status:302,headers:{Location:'https://attacker.invalid/steal'}})});assert.equal(out.status,503);assert.equal(n,2);});
test('browser notification is disabled by default, never sends points or follows redirects',async()=>{
 const auth={currentUser:{uid:'fixture',getIdToken:async()=>token}};let n=0;
 const options={id,uid:'fixture',auth,endpoint:worker,allowedOrigin:new URL(worker).origin,fetchImpl:async(_url,o)=>{n++;assert.deepEqual(JSON.parse(o.body),{id});assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');return new Response(null,{status:200});}};
 assert.equal((await notifyOccurrenceScore(options)).code,'OCCURRENCE_SCORING_DISABLED');assert.equal(n,0);await notifyOccurrenceScore({...options,enabled:true});assert.equal(n,1);
});
test('user switch while obtaining token prevents sending',async()=>{const auth={currentUser:{uid:'fixture',getIdToken:async()=>{auth.currentUser={uid:'other'};return token;}}};let n=0;const r=await notifyOccurrenceScore({id,uid:'fixture',auth,enabled:true,endpoint:worker,allowedOrigin:new URL(worker).origin,fetchImpl:async()=>{n++;}});assert.equal(r.code,'OCCURRENCE_SCORE_SESSION_CHANGED');assert.equal(n,0);});
