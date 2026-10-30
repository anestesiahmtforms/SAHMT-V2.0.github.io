import test from 'node:test';
import assert from 'node:assert/strict';
import {createYearEndScheduleRepository} from '../src/year-end-schedule-data.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
const base='yearEndSchedules/2026-2027';
function fixture(){
  const store=vaccinationMemoryStore(),project={options:{projectId:'outros-48120'}};let now=0;
  const split=ref=>{const at=ref.lastIndexOf('/');return [ref.slice(0,at),ref.slice(at+1)];};
  const snapshot=data=>({exists:()=>data!==null,data:()=>data});
  const api={doc:(db,...parts)=>parts.join('/'),collection:(db,...parts)=>parts.join('/'),serverTimestamp:()=>++now,
    getDocFromServer:async ref=>snapshot(await store.get(...split(ref))),
    runTransaction:(db,fn)=>store.transaction(async tx=>{const reads=new Map();return fn({get:async ref=>{const data=await tx.get(...split(ref));reads.set(ref,data);return snapshot(data);},set:(ref,value)=>tx.set(...split(ref),value),update:(ref,patch)=>tx.set(...split(ref),{...reads.get(ref),...patch})});})};
  const repository=uid=>{store.seed('users',uid,{uid,active:true,access:true,displayName:'Pessoa '+uid});const auth={app:project,currentUser:{uid}};return {auth,repo:createYearEndScheduleRepository({db:{app:project},auth,uid,firestore:api,watchAuth:()=>()=>{}})};};
  return {store,api,repository,project};
}
test('simultaneous team confirmations allocate contiguous unique positions atomically',async()=>{
  const f=fixture(),users=Array.from({length:20},(_,i)=>f.repository('user'+i));
  const results=await Promise.all(users.map(({repo},i)=>repo.save({plantao:i%2?'natal':'reveillon',grupo:i%3?'natal':'reveillon'})));
  assert.deepEqual(results.map(r=>r.position).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+1));
  assert.equal((await f.store.list(base+'/registrations')).length,20);
  assert.equal((await f.store.get(base+'/control','order')).lastPosition,20);
});
test('duplicate submission and later updates keep one UID, original position and creation time',async()=>{
  const f=fixture(),{repo}=f.repository('one');
  const results=await Promise.all(Array.from({length:8},()=>repo.save({plantao:'natal',grupo:'reveillon'})));
  assert.deepEqual([...new Set(results.map(r=>r.position))],[1]);
  const first=await f.store.get(base+'/registrations','one');
  await repo.save({plantao:'reveillon',grupo:'natal'});
  const updated=await f.store.get(base+'/registrations','one');
  assert.equal(updated.position,1);assert.equal(updated.createdAt,first.createdAt);assert.equal(updated.grupo,'natal');assert.equal(updated.plantao,'reveillon');
  assert.equal((await f.store.get(base+'/control','order')).lastPosition,1);
});
test('wrong project, account changes, revoked profiles and invalid choices cannot write',async()=>{
  const f=fixture();assert.throws(()=>createYearEndScheduleRepository({db:{app:{options:{projectId:'sahmt-17a16'}}},auth:{app:f.project,currentUser:{uid:'one'}},uid:'one',firestore:f.api}));
  const {repo,auth}=f.repository('one');await assert.rejects(repo.save({plantao:['natal','reveillon'],grupo:'natal'}));
  f.store.seed('users','one',{uid:'one',active:false,access:true});await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}));
  auth.currentUser={uid:'other'};await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}));
  assert.equal((await f.store.list(base+'/registrations')).length,0);
});
test('broken counters fail without partial inscriptions or counter repair by the browser',async()=>{
  const f=fixture(),{repo}=f.repository('one');f.store.seed(base+'/control','order',{lastPosition:-1});
  await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}));assert.equal((await f.store.list(base+'/registrations')).length,0);assert.equal((await f.store.get(base+'/control','order')).lastPosition,-1);
});

test('permission errors retry only after a confirmed advancement of the shared counter',async()=>{
  for(const advanced of [false,true]) {
    const f=fixture(),{repo}=f.repository('one'),original=f.api.runTransaction;let calls=0;
    f.api.runTransaction=(db,fn)=>{calls++;if(calls===1){return original(db,async tx=>{await fn(tx);if(advanced)f.store.seed(base+'/control','order',{lastPosition:1,lastParticipantUid:'other'});throw Object.assign(Error('permission-denied'),{code:'permission-denied'});});}return original(db,fn);};
    if(advanced){const result=await repo.save({plantao:'natal',grupo:'natal'});assert.equal(result.position,2);assert.equal(calls,2);}
    else{await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}));assert.equal(calls,1);}
  }
});
