import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFiControlWorker,pilotAccess} from '../worker-fi-control/worker.js';
import {createFiActorVerifier} from '../worker-fi-control/identity.js';
import {createFiStore} from '../worker-fi-control/store.js';
import {createFiControlRequest} from '../src/fi-control-client.js';
import {createFiReadBudget,createFiRequestQuota} from '../worker-fi-control/read-budget.js';
import {addFiCutoverRules} from '../scripts/lib/fi-cutover-rules.js';

const origin='https://anestesiahmtforms.github.io';
const actor={uid:'fa-user',fiUid:'fi-user',email:'person@example.test',profile:{uid:'fi-user',email:'person@example.test',active:true,access:true}};
function budgetStore(){const rows=new Map();const get=async(c,id)=>structuredClone(rows.get(c+'/'+id)||null);let pending=Promise.resolve();return {transaction(fn){const next=pending.then(async()=>{const writes=[];const result=await fn({get,getMany:keys=>Promise.all(keys.map(([c,id])=>get(c,id))),set:(c,id,value)=>writes.push([c+'/'+id,structuredClone(value)])});for(const [k,v]of writes)rows.set(k,v);return result;});pending=next.catch(()=>{});return next;}};}
const request=(body={action:'search',input:{query:'protocolo'}},headers={})=>new Request('https://fi.test/v1/control',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer proof',...headers},body:JSON.stringify(body)});
test('FI rejects origin, authentication and unknown input before service execution',async()=>{
 let executions=0;
 const worker=createFiControlWorker({verifyActor:async r=>{if(r.headers.get('Authorization')!=='Bearer proof')throw Object.assign(Error('FI_UNAUTHENTICATED'),{status:401});return actor;},buildServices:()=>({dispatch:async()=>{executions++;return {ok:true};}})});
 const enabled={FI_CONTROL_ENABLED:'true'};
 assert.equal((await worker.fetch(request({}, {Origin:'https://evil.test'}),enabled)).status,403);
 assert.equal((await worker.fetch(request(undefined,{Authorization:''}),enabled)).status,401);
 assert.equal((await worker.fetch(request({action:'search',input:{},uid:'other'}),enabled)).status,400);
 assert.equal(executions,0);
 const r=await worker.fetch(request(),enabled);assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});assert.equal(executions,1);
});
test('FI leaves search open but denies administrative actions to delegated non-admin accounts',async()=>{
 const dispatched=[];
 const worker=createFiControlWorker({verifyActor:async()=>({...actor,profile:{...actor.profile,permissions:{peopleManage:true,usersManage:true}}}),buildServices:()=>({dispatch:async(_actor,action)=>{dispatched.push(action);return {ok:true};}})});
 const env={FI_CONTROL_ENABLED:'true'};
 for(const action of ['people.list','admin.users.list','updates.read','monthly.generate','monthly.list']){
  assert.equal((await worker.fetch(request({action,input:{}}),env)).status,403);
 }
 assert.equal((await worker.fetch(request(),env)).status,200);
 assert.deepEqual(dispatched,['search']);
});
test('pilot admits only its active administrator, rejects writes, and requires App Check',async()=>{
 const admin={...actor,profile:{...actor.profile,permissions:{admin:true}}};
 const settings={schemaVersion:1,uid:actor.uid,expiresAt:1001};
 assert.equal(pilotAccess(admin,settings,'monthly.generate',1000),true);
 for(const [candidate,action,time] of [[actor,'search',1000],[{...admin,uid:'other'},'search',1000],[admin,'people.save',1000],[admin,'search',1001]])assert.equal(pilotAccess(candidate,settings,action,time),false);
 const worker=createFiControlWorker({verifyActor:()=>{throw Error('MUST_NOT_AUTH');},buildServices:()=>{throw Error('MUST_NOT_BUILD');}});
 const pilot=new Request('https://fi.test/v1/pilot',request());
 assert.equal((await worker.fetch(pilot,{FI_PILOT_ENABLED:'true',FI_REQUIRE_APP_CHECK:'false'})).status,503);
 assert.equal((await worker.fetch(request(),{FI_PILOT_ENABLED:'true'})).status,503);
});
test('cutover gates legacy administration without gating profile self edits, receipts or operations',async()=>{
 const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
 const fa=addFiCutoverRules(await read('firestore.fa.fi-fj-retired.rules'),'FA');
 const fj=addFiCutoverRules(await read('firestore.fj.rules'),'FJ');
 assert.match(fa,/allow update: if \(fiLegacyAdminWritable_\(\) && mayManageUser\(uid\)\) \|\| \(fiLegacyAdminWritable_\(\) && adminFirstLoginCohortUpdate\(uid\)\) \|\| \(activeUser\(\)/);
 assert.match(fa,/allow create, update: if activeUser\(\) && request.auth.uid == uid && validAppInstallation_/);
 assert.match(fa,/allow update: if fiLegacyAdminWritable_\(\) && validAccessRequestApproval/);
 assert.match(fj,/allow create, update: if fiLegacyAdminWritable_\(\) && moduleSession\(\).*validEventMember/);
 assert.match(fj,/allow create: if moduleSession\(\) && \(validProjectionRequest\(\)\)/);
 assert.throws(()=>addFiCutoverRules(fa,'FA'),/FI_RULES_ALREADY_PATCHED/);
});
test('FI health exposes readiness without credentials or personal details and schedule is disabled by default',async()=>{
 const worker=createFiControlWorker({buildServices:()=>{throw Error('MUST_NOT_BUILD');}});
 const result=await worker.fetch(new Request('https://fi.test/health'),{});
 const body=await result.json();assert.equal(body.station,'FI');assert.equal(body.projectId,'sahmt-operacional-fi');assert.equal(body.aiEnabled,false);
 await worker.scheduled({}, {}, {waitUntil(){throw Error('MUST_NOT_SCHEDULE');}});
});
test('actor verification uses current FA gate and explicit distinct FI identity, never browser fields',async()=>{
 let link={faUid:'fa-user',fiUid:'fi-user',email:actor.email,active:true};
 let managed=null;const get=async c=>c==='fiAdminIdentityLinks'?link:c==='users'?actor.profile:c==='fiAdminUsers'?managed:null;
 const store={get,getMany:keys=>Promise.all(keys.map(([c])=>get(c)))};
 const verify=createFiActorVerifier({store,verifySession:async()=>({uid:'fa-user',email:actor.email,emailVerified:true}),fetchImpl:async()=>Response.json({name:'projects/sahmt-17a16/databases/(default)/documents/users/fa-user',fields:{uid:{stringValue:'fa-user'},email:{stringValue:actor.email},active:{booleanValue:true},access:{booleanValue:true}}})});
 const result=await verify(request(),{});assert.equal(result.uid,'fa-user');assert.equal(result.fiUid,'fi-user');assert.equal(result.profile.uid,'fi-user');
 managed={uid:'fa-user',email:actor.email,active:false,access:true};await assert.rejects(verify(request(),{}),/FI_FORBIDDEN/);managed=null;
 link={...link,email:'someone@example.test'};await assert.rejects(verify(request(),{}),/FI_FORBIDDEN/);
});

test('projection writes preserve Firestore timestamp types in the operational source',async()=>{
 let writes;const base='projects/sahmt-17a16/databases/(default)/documents/users/u1';
 const store=createFiStore({projectId:'sahmt-17a16',allowedCollections:['users'],getAccessToken:async()=> 'token',fetchImpl:async(url,options)=>{const b=JSON.parse(options.body);if(url.endsWith(':beginTransaction'))return Response.json({transaction:'t'});if(url.endsWith(':batchGet'))return Response.json([{found:{name:base,fields:{createdAt:{timestampValue:'1970-01-01T00:00:01.000Z'},updatedAt:{timestampValue:'1970-01-01T00:00:01.000Z'}}}}]);if(url.endsWith(':commit')){writes=b.writes;return Response.json({});}return Response.json({});}});
 await store.transaction(async tx=>{const old=await tx.get('users','u1');tx.set('users','u1',{...old,updatedAt:2000});});
 assert.deepEqual(writes[0].update.fields.createdAt,{timestampValue:'1970-01-01T00:00:01.000Z'});assert.deepEqual(writes[0].update.fields.updatedAt,{timestampValue:'1970-01-01T00:00:02.000Z'});
});
test('store enforces project and collection boundaries before issuing a request',async()=>{
 let calls=0;const store=createFiStore({projectId:'sahmt-operacional-fi',getAccessToken:async()=> 'server-token',allowedCollections:['users'],fetchImpl:async(url)=>{calls++;assert.match(url,/sahmt-operacional-fi/);return Response.json([{found:{name:'projects/sahmt-operacional-fi/databases/(default)/documents/users/u1',fields:{active:{booleanValue:true}}}}]);}});
 assert.deepEqual(await store.get('users','u1'),{active:true});assert.equal(calls,1);
 await assert.rejects(store.get('events','x'),/FI_STORE_PATH_DENIED/);await assert.rejects(store.get('users','../other'),/FI_STORE_PATH_DENIED/);assert.equal(calls,1);
 assert.throws(()=>createFiStore({projectId:'wrong',getAccessToken:async()=>''}),/FI_STORE_CONFIG_INVALID/);
});
test('transport discards a result after session changes and keeps the fixed FI destination',async()=>{
 let current=true,sent;
 const send=createFiControlRequest({uid:'fa-user',isCurrent:()=>current,getIdToken:async()=> 'proof',fetchImpl:async(url,options)=>{sent={url,options};current=false;return new Response(JSON.stringify({private:'data'}),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}});
 await assert.rejects(send('search',{query:'protocolo'}),/FI_SESSION_CHANGED/);
 assert.equal(sent.url,'https://sahmt-fi-control.sahmt-fi-948f8565.workers.dev/v1/control');assert.deepEqual(JSON.parse(sent.options.body),{action:'search',input:{query:'protocolo'}});
 send.dispose();await assert.rejects(send('search',{}),/FI_SESSION_CHANGED/);
});

test('source read reservations and shared daily request quotas remain bounded under concurrency',async()=>{
 const store=budgetStore(),budget=createFiReadBudget({store,limit:10});
 const project='sahmt-gestao-5ae66',leases=await Promise.all([budget.open({[project]:8}),budget.open({[project]:8})]);
 const ticket=leases[0].reserve(project,8);assert.throws(()=>leases[1].reserve(project,8),/FI_SOURCE_READ_BUDGET/);
 const partial=leases[1].reserve(project,2);leases[1].settle(partial,1);await leases[1].finish();
 leases[0].settle(ticket,1);leases[0].settle(ticket,1);await leases[0].finish();await leases[0].finish();
 const full=await budget.open({[project]:8});full.reserve(project,8);assert.throws(()=>full.reserve(project,1),/FI_SOURCE_READ_BUDGET/);
 const quota=createFiRequestQuota({store:budgetStore(),dailyLimit:2,userLimit:2});const requests=await Promise.allSettled([quota.consume('a'),quota.consume('b'),quota.consume('c')]);assert.equal(requests.filter(r=>r.status==='fulfilled').length,2);
});
