import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {relayDiretrizesReading} from '../worker-management-auth/diretrizes-reading-relay.js';
const origin='https://anestesiahmtforms.github.io',key='s'.repeat(43);
const request=()=>new Request('https://worker.test/v1/diretrizes/reading',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'start',documentId:'doc'})});
const claims={aud:'sahmt-17a16',iss:'https://securetoken.google.com/sahmt-17a16',sub:'reader',email:'reader@example.test',email_verified:true,exp:2000000000,auth_time:1000,firebase:{sign_in_provider:'google.com'}};
const token='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+'a'.repeat(64);
const env={DIRETRIZES_READING_ENABLED:'true',DIRETRIZES_READING_HMAC_SECRET:key,DIRETRIZES_READING_SCRIPT_URL:'https://script.google.com/macros/s/'+'a'.repeat(32)+'/exec',DIRETRIZES_READING_FA_API_KEY:'test-key'};
const admitRequest=async()=>({allowed:true,release:async()=>{}});
test('disabled sends nothing',async()=>{const r=await relayDiretrizesReading(request(),{}, {fetchImpl:()=>{throw Error('no');}});assert.equal(r.status,503);});
test('verified FA identity and authenticated response; never forward Firebase token',async()=>{
 let calls=0;
 const fetchImpl=async(url,options)=>{
  calls++;
  if(url.startsWith('https://identitytoolkit.googleapis.com/'))return Response.json({users:[{localId:'reader',email:'reader@example.test',emailVerified:true,disabled:false,validSince:'0',providerUserInfo:[{providerId:'google.com'}]}]});
  assert.ok(!options.body.includes(token));
  const input=JSON.parse(Buffer.from(JSON.parse(options.body).payload,'base64url').toString());
  assert.equal(input.uid,'reader');
  const payload=Buffer.from(JSON.stringify({v:1,nonce:input.nonce,code:'READING_STARTED',pages:2,sessionId:'f'.repeat(32),pdfBase64:'JVBERi0='})).toString('base64url');
  return Response.json({payload,mac:createHmac('sha256',key).update('SAHMT_READING_V1\n'+payload).digest('hex')});
 };
 const r=await relayDiretrizesReading(request(),env,{fetchImpl,admitRequest,now:()=>1500000000000});assert.equal(r.status,200);assert.equal(calls,2);
});
test('Google denial never reaches Apps Script',async()=>{
 let calls=0;const r=await relayDiretrizesReading(request(),env,{admitRequest,fetchImpl:async()=>{calls++;return new Response('{}',{status:401});}});
 assert.equal(r.status,401);assert.equal(calls,1);
});
test('admission required before external work',async()=>{
 const r=await relayDiretrizesReading(request(),env,{fetchImpl:()=>{throw Error('no');}});assert.equal(r.status,503);
});
for(const [name,mutate] of [
 ['disabled Google account',user=>user.disabled=true],
 ['different Google account',user=>user.localId='other'],
 ['unverified address',user=>user.emailVerified=false],
 ['revoked token',user=>user.validSince='2000'],
 ['missing Google provider',user=>user.providerUserInfo=[]]
])test(name+' is rejected before Apps Script',async()=>{
 let calls=0;const user={localId:'reader',email:'reader@example.test',emailVerified:true,disabled:false,validSince:'0',providerUserInfo:[{providerId:'google.com'}]};mutate(user);
 const r=await relayDiretrizesReading(request(),env,{admitRequest,now:()=>1500000000000,fetchImpl:async()=>{calls++;return Response.json({users:[user]});}});
 assert.equal(r.status,401);assert.equal(calls,1);
});
test('wrong response HMAC and malicious Content Service redirect fail closed',async()=>{
 for(const redirect of [false,true]){
 let calls=0;const r=await relayDiretrizesReading(request(),env,{admitRequest,now:()=>1500000000000,fetchImpl:async()=>{
  calls++;if(calls===1)return Response.json({users:[{localId:'reader',email:'reader@example.test',emailVerified:true,validSince:'0',providerUserInfo:[{providerId:'google.com'}]}]});
  return redirect?new Response(null,{status:302,headers:{Location:'https://attacker.invalid/steal'}}):Response.json({payload:'e30',mac:'a'.repeat(64)});
 }});assert.equal(r.status,503);assert.equal(calls,2);
 }
});

for(const readerOnly of [false,true])test('relay preserves trusted reader-only '+(readerOnly?'completion':'start metadata')+' without granting a Form',async()=>{
 const fetchImpl=async(url,options)=>{
  if(url.startsWith('https://identitytoolkit.googleapis.com/'))return Response.json({users:[{localId:'reader',email:'reader@example.test',emailVerified:true,validSince:'0',providerUserInfo:[{providerId:'google.com'}]}]});
  const input=JSON.parse(Buffer.from(JSON.parse(options.body).payload,'base64url').toString());
  const answer=readerOnly?{code:'READING_COMPLETED'}:{code:'READING_STARTED',hasForm:false,pages:2,sessionId:'f'.repeat(32),pdfBase64:'JVBERi0='};
  const payload=Buffer.from(JSON.stringify({v:1,nonce:input.nonce,...answer})).toString('base64url');return Response.json({payload,mac:createHmac('sha256',key).update('SAHMT_READING_V1\n'+payload).digest('hex')});
 };
 const input=readerOnly?new Request('https://worker.test/v1/diretrizes/reading',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'complete',documentId:'doc',sessionId:'f'.repeat(32),pages:[1,2]})}):request();
 const response=await relayDiretrizesReading(input,env,{fetchImpl,admitRequest,now:()=>1500000000000});assert.equal(response.status,200);const answer=await response.json();assert.equal(answer.formUrl,undefined);if(!readerOnly)assert.equal(answer.hasForm,false);
});
