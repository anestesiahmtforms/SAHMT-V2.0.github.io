import test from 'node:test';
import assert from 'node:assert/strict';
import {createYearEndStatusService} from '../worker-training/year-end-status-service.js';
import {readYearEndBannerStatus} from '../src/year-end-status-client.js';
import {institutionalAssignmentKey} from '../src/institutional-group.js';
const identity={uid:'user-test',email:'one@example.invalid',emailVerified:true,provider:'google.com'};
const profile={uid:identity.uid,email:identity.email,active:true,access:true};
const category={schemaVersion:1,identityStatus:'LINKED',uid:identity.uid,email:identity.email,memberCategories:['EFETIVO']};
const projection={schemaVersion:1,cycle:'2026-2027',sigla:'RL'};
test('FA caller receives only own canonical pending/completed status without a browser FE session',async()=>{
 const key=await institutionalAssignmentKey(identity.email),calls=[];let own=null;
 const service=createYearEndStatusService({store:{get:async(c,id)=>{calls.push([c,id]);return c==='users'?profile:id===key?category:null;},getYearEndRecord:async(k,uid)=>{assert.equal(uid,identity.uid);return k==='participation'?projection:own;}}});
 assert.deepEqual(await service.execute('STATUS',{},identity),{eligible:true,completed:false});
 own={uid:identity.uid,sigla:'RL',plantao:'natal',grupo:'reveillon',position:1};
 assert.deepEqual(await service.execute('STATUS',{},identity),{eligible:true,completed:true});
 own={...own,uid:'other'};assert.equal((await service.execute('STATUS',{},identity)).completed,false);
 await assert.rejects(service.execute('STATUS',{uid:'other'},identity),/INPUT_INVALID/);
 assert.ok(calls.every(([c,id])=>c==='userCategories'?id===key:id===identity.uid));
});
test('nonmembers, wrong identities and inactive profiles cannot obtain a team reminder',async()=>{
 for(const change of [{profile:{...profile,active:false}},{profile:{...profile,uid:'other'}},{category:{...category,uid:'other'}}]){
  const service=createYearEndStatusService({store:{get:async c=>c==='users'?(change.profile||profile):(change.category||category),getYearEndRecord:()=>assert.fail('forbidden read')}});
  await assert.rejects(service.execute('STATUS',{},identity),/FORBIDDEN/);
 }
 const service=createYearEndStatusService({store:{get:async c=>c==='users'?profile:{...category,memberCategories:['RESIDENTE_1']},getYearEndRecord:()=>assert.fail('resident registration read')}});
 assert.deepEqual(await service.execute('STATUS',{},identity),{eligible:false,completed:false});
 await assert.rejects(service.execute('STATUS',{}, {...identity,provider:'custom'}),/UNAUTHENTICATED/);
});
test('status client uses existing FA token, closes request shape and never reads or authenticates in FE',async()=>{
 const auth={app:{options:{projectId:'sahmt-17a16'}},authStateReady:async()=>{},currentUser:{uid:identity.uid,getIdToken:async()=> 'fake-fa-token'}};let calls=0;
 const response=await readYearEndBannerStatus({uid:identity.uid,isCurrent:()=>true,auth,fetchImpl:async(url,options)=>{
  calls++;assert.match(url,/\/v1\/year-end-status$/);assert.equal(options.headers.Authorization,'Bearer fake-fa-token');assert.deepEqual(JSON.parse(options.body),{action:'STATUS',input:{}});return Response.json({eligible:true,completed:false});
 }});
 assert.equal(calls,1);assert.deepEqual(response,{participation:{canParticipate:true},completed:false});
 await assert.rejects(readYearEndBannerStatus({uid:'another',isCurrent:()=>true,auth,fetchImpl:()=>assert.fail('foreign request')}),/SESSION_CHANGED/);
});
