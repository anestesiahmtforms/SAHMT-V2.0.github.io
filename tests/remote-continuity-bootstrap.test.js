import test from'node:test';import assert from'node:assert/strict';import vm from'node:vm';import{createHash,createHmac}from'node:crypto';import{continuityBootstrapSource}from'../scripts/lib/continuity-bootstrap-source.js';
const secret='a'.repeat(43),endpoint='https://sahmt-operational-channel.anestesiahmtforms.workers.dev/v1/operational-continuity/import';
test('instalador exige HMAC e é idempotente sem ler Firestore',()=>{
 const props=new Map(),p={getProperty:key=>props.get(key),setProperty:(key,value)=>props.set(key,value)};let installs=0;
 const ctx=vm.createContext({Date,PropertiesService:{getScriptProperties:()=>p},Session:{getEffectiveUser:()=>({getEmail:()=> 'anestesiahmtforms@gmail.com'})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},ospJson_:v=>v,ospEqual_:(a,b)=>a===b,
  instalarSincronizadorCanalRemotoV1:()=>installs++,Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,text)=>[...createHash('sha256').update(text).digest()],computeHmacSha256Signature:(text,key)=>[...createHmac('sha256',key).update(text).digest()]}});
 vm.runInContext(continuityBootstrapSource({secret,endpoint,notBefore:123}),ctx);
 const payload=JSON.stringify({action:'install'}),time=String(Date.now()),nonce='b'.repeat(32),signature=createHmac('sha256',secret).update(time+'\n'+nonce+'\n'+createHash('sha256').update(payload).digest('hex')).digest('hex');
 const event={postData:{contents:JSON.stringify({time,nonce,payload,signature})}};
 assert.equal(ctx.ocsAdminHttp_(event).code,'CONTINUITY_INSTALLED_SEED_PENDING');assert.equal(installs,1);
 assert.equal(ctx.ocsAdminHttp_(event).code,'CONTINUITY_ALREADY_INSTALLED');assert.equal(installs,1);
 assert.equal(ctx.ocsAdminHttp_({postData:{contents:JSON.stringify({time,nonce,payload,signature:'0'.repeat(64)})}}).code,'CONTINUITY_PRIVATE_DENIED');
});
