import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndicatorService} from '../worker-indicators/service.js';
import {createIndicatorWorker} from '../worker-indicators/worker.js';
import {verifyTrainingIdentity} from '../worker-training/google-auth.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
const time=Date.parse('2026-12-01T05:00:00Z');
const identity={uid:'member',email:'member@example.invalid',provider:'google.com',emailVerified:true};
const profile={...identity,active:true,access:true,role:'usuario',permissions:{}};
function fixture(){
 const store=vaccinationMemoryStore();store.seed('users',identity.uid,profile);
 const sources={profile:async()=>profile,load:async()=>{throw Error('MUST_NOT_READ_SOURCES');}};
 const service=createIndicatorService({store,sources,sahmtEnabled:true,now:()=>time+1000});return {service,store,sources};
}
test('approved common user can read own FD summary while retired platform actions are unavailable',async()=>{
 const {service,sources}=fixture();const profileReads=[];sources.profile=async project=>{profileReads.push(project);return profile;};
 assert.equal((await service.execute('GET_SAHMT_PERFORMANCE',{},identity)).status,'PREPARING');
 assert.deepEqual(profileReads,[]);
 await assert.rejects(service.execute('BOOTSTRAP',{year:2026},identity),e=>e.status===404);
 await assert.rejects(service.execute('ADD_SAHMT_MANUAL',{},identity),e=>e.status===403);
});
test('consolidated performance verifies FD tokens only and rejects retired actions before authentication',async()=>{
 const fd='rotinas-8a617',fa='sahmt-17a16',lookups=[];
 const token=project=>{
  const now=time/1000,claims={aud:project,iss:'https://securetoken.google.com/'+project,sub:identity.uid,email:identity.email,email_verified:true,exp:now+3600,iat:now,auth_time:now,firebase:{sign_in_provider:'google.com'}};
  return 'eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.c2ln';
 };
 const worker=createIndicatorWorker({
  build:()=>({execute:async action=>({action})}),
  verifyIdentity:(authorization,options)=>verifyTrainingIdentity(authorization,{...options,now:()=>time,fetchImpl:async url=>{
   lookups.push(new URL(url).searchParams.get('key'));
   return Response.json({users:[{localId:identity.uid,email:identity.email,emailVerified:true}]});
  }})
 });
 const send=(project,action)=>worker.fetch(new Request('https://fd.invalid/v1/indicators',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json',Authorization:'Bearer '+token(project)},body:JSON.stringify({action,input:{}})}),{INDICATORS_ENABLED:'true',FD_WEB_API_KEY:'fd-key',FA_WEB_API_KEY:'fa-key'});
 assert.equal((await send(fd,'GET_SAHMT_PERFORMANCE')).status,200);
 assert.equal((await send(fa,'GET_SAHMT_PERFORMANCE')).status,401);
 assert.equal((await send(fd,'BOOTSTRAP')).status,404);
 assert.equal((await send(fa,'BOOTSTRAP')).status,404);
 assert.deepEqual(lookups,['fd-key']);
});

test('retired platform actions and scheduled stages cannot read any project or create points',async()=>{
 const store={get(){throw Error('RETIRED_ACTION_TOUCHED_STORE');},list(){throw Error('RETIRED_ACTION_TOUCHED_STORE');},transaction(){throw Error('RETIRED_ACTION_TOUCHED_STORE');}};
 const service=createIndicatorService({store,sahmtEnabled:true});
 for(const action of ['BOOTSTRAP','REFRESH','SAVE_REVIEW','SAVE_ACTION','SET_REFRESH_INTERVAL','GET_PERFORMANCE','ACKNOWLEDGE_INDICATOR','SUBMIT_SUGGESTION','REVIEW_SUGGESTION']){
  await assert.rejects(service.execute(action,{year:2026},identity),e=>e.status===404);
 }
 for(const action of ['PLAN','ACTIVITY','FINISH'])await assert.rejects(service.executeScheduled({action,scheduledTime:time,issuedAt:time}),e=>e.status===404);
});
test('public user cannot run a daily batch; signed internal action needs correct shape',async()=>{
 const {service}=fixture();await assert.rejects(service.execute('PERFORMANCE',{scheduledTime:time},identity));
 await assert.rejects(service.executeScheduled({action:'PERFORMANCE',issuedAt:time,scheduledTime:time,uid:'member'}),e=>e.code==='SAHMT_INPUT_INVALID');
});
test('worker preserves actionable SAHMT error code and never exposes source internals',async()=>{
 const worker=createIndicatorWorker({build:()=>({execute:async()=>{throw Object.assign(Error('SAHMT_BATCH_CHANGED'),{code:'SAHMT_BATCH_CHANGED',status:409});}}),verifyIdentity:async()=>identity});
 const result=await worker.fetch(new Request('https://fd.invalid/v1/indicators',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'LIST_SAHMT_HISTORY',input:{category:'OPERATIONS'}})}),{INDICATORS_ENABLED:'true'});
 assert.equal(result.status,409);assert.equal((await result.json()).code,'SAHMT_BATCH_CHANGED');
});
