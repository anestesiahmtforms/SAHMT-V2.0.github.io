import test from 'node:test';
import assert from 'node:assert/strict';
import {createYearEndScheduleRepository} from '../src/year-end-schedule-data.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
import {createHash} from 'node:crypto';
import {emptyYearEndTotals} from '../src/year-end-schedule-totals.js';
const base='yearEndSchedules/2026-2027';
function fixture(){
  const store=vaccinationMemoryStore(),project={options:{projectId:'outros-48120'}};let now=0;
  store.seed(base+'/summary','totals',emptyYearEndTotals());
  const split=ref=>{const at=ref.lastIndexOf('/');return [ref.slice(0,at),ref.slice(at+1)];};
  const snapshot=data=>({exists:()=>data!==null,data:()=>data});
  const reads=[];
  const api={doc:(db,...parts)=>parts.join('/'),collection:(db,...parts)=>parts.join('/'),serverTimestamp:()=>++now,
    getDocFromServer:async ref=>{reads.push(ref);return snapshot(await store.get(...split(ref)));},
    runTransaction:(db,fn)=>store.transaction(async tx=>{const reads=new Map();return fn({get:async ref=>{const data=await tx.get(...split(ref));reads.set(ref,data);return snapshot(data);},set:(ref,value)=>tx.set(...split(ref),value),update:(ref,patch)=>tx.set(...split(ref),{...reads.get(ref),...patch})});})};
  const subscriptions=[];
  api.query=ref=>({query:ref});api.orderBy=()=>null;
  api.onSnapshot=(ref,options,callback,error)=>{const listener={ref,callback,error,stopped:false};subscriptions.push(listener);return()=>{listener.stopped=true;};};
  const siglasByUid={};
  const repository=(uid,sigla='AB',memberCategories=['EFETIVO'],profile={},options={})=>{
    const email=uid+'@example.invalid',key=createHash('sha256').update(JSON.stringify(email)).digest('hex');
    store.seed('users',uid,{uid,email,active:true,access:true,displayName:'Nome que não deve ser publicado',sigla:'',...profile});
    store.seed('userCategories',key,{schemaVersion:1,identityStatus:'LINKED',uid,email,memberCategories});
    if(sigla)siglasByUid[uid]=sigla;store.seed(base+'/policy','participation',{schemaVersion:1,cycle:'2026-2027',summaryVersion:1,siglasByUid});
    if(sigla)store.seed(base+'/participation',uid,{schemaVersion:1,cycle:'2026-2027',sigla});
    const auth={app:project,currentUser:{uid,email}};
    return {auth,key,repo:createYearEndScheduleRepository({db:{app:project},auth,uid,firestore:api,watchAuth:()=>()=>{},...options})};
  };
  return {store,api,repository,project,subscriptions,reads};
}
test('simultaneous team confirmations allocate contiguous unique positions atomically',async()=>{
  const f=fixture(),users=Array.from({length:20},(_,i)=>f.repository('user'+i));
  const results=await Promise.all(users.map(({repo},i)=>repo.save({plantao:i%2?'natal':'reveillon',grupo:i%3?'natal':'reveillon'})));
  assert.deepEqual(results.map(r=>r.position).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+1));
  assert.equal((await f.store.list(base+'/registrations')).length,20);
  assert.deepEqual(Object.fromEntries(Object.entries(await f.store.get(base+'/summary','totals')).filter(([k])=>k!=='updatedAt')),{plantaoNatal:10,plantaoReveillon:10,grupoNatal:13,grupoReveillon:7,totalRegistrations:20});
  assert.ok(results.every(r=>r.sigla==='AB'&&!('displayName' in r)));
});

test('the four authoritative exceptions submit only a mandatory shift; profile sigla cannot grant exemption',async()=>{
  for(const sigla of ['FR','AD','L2','LE']){
    const f=fixture(),{repo}=f.repository('one',sigla);
    assert.deepEqual(await repo.open(),{sigla,requireGroup:false,canParticipate:true,isAdmin:false});
    await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}));
    await assert.rejects(repo.save({plantao:null,grupo:null}));
    const result=await repo.save({plantao:'reveillon',grupo:null});
    assert.equal(result.sigla,sigla);assert.equal(result.grupo,null);
  }
  const f=fixture(),{repo}=f.repository('one');
  f.store.seed('users','one',{uid:'one',email:'one@example.invalid',active:true,access:true,sigla:'FR'});
  await assert.rejects(repo.save({plantao:'natal',grupo:null}));
});

test('residents and substitutes are denied before records are loaded even with administrator category',async()=>{
  for(const category of ['RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO']){
    const f=fixture(),{repo}=f.repository('one','AB',[category,'ADMINISTRADOR']);
    await assert.rejects(repo.open(),{code:'YEAR_END_INELIGIBLE'});
    await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}),{code:'YEAR_END_INELIGIBLE'});
    assert.equal((await f.store.list(base+'/registrations')).length,0);
  }
});
test('duplicate submission and later updates keep one UID, original position and creation time',async()=>{
  const f=fixture(),{repo}=f.repository('one');
  const results=await Promise.all(Array.from({length:8},()=>repo.save({plantao:'natal',grupo:'reveillon'})));
  assert.deepEqual([...new Set(results.map(r=>r.position))],[1]);
  const first=await f.store.get(base+'/registrations','one');
  await repo.save({plantao:'reveillon',grupo:'natal'});
  const updated=await f.store.get(base+'/registrations','one');
  assert.equal(updated.position,1);assert.equal(updated.createdAt,first.createdAt);assert.equal(updated.grupo,'natal');assert.equal(updated.plantao,'reveillon');
  const totals=await f.store.get(base+'/summary','totals');
  assert.equal(totals.totalRegistrations,1);assert.equal(totals.plantaoNatal,0);assert.equal(totals.plantaoReveillon,1);assert.equal(totals.grupoNatal,1);assert.equal(totals.grupoReveillon,0);
});
test('wrong project, account changes, revoked profiles and invalid choices cannot write',async()=>{
  const f=fixture();assert.throws(()=>createYearEndScheduleRepository({db:{app:{options:{projectId:'sahmt-17a16'}}},auth:{app:f.project,currentUser:{uid:'one'}},uid:'one',firestore:f.api}));
  const {repo,auth}=f.repository('one');await assert.rejects(repo.save({plantao:['natal','reveillon'],grupo:'natal'}));
  f.store.seed('users','one',{uid:'one',active:false,access:true});await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}));
  auth.currentUser={uid:'other'};await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}));
  assert.equal((await f.store.list(base+'/registrations')).length,0);
});
test('broken counters fail without partial inscriptions or counter repair by the browser',async()=>{
  const f=fixture(),{repo}=f.repository('one');f.store.seed(base+'/summary','totals',{...emptyYearEndTotals(),totalRegistrations:-1});
  await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}));assert.equal((await f.store.list(base+'/registrations')).length,0);assert.equal((await f.store.get(base+'/summary','totals')).totalRegistrations,-1);
});

test('permission errors retry only after a confirmed advancement of the shared counter',async()=>{
  for(const advanced of [false,true]) {
    const f=fixture(),{repo}=f.repository('one'),original=f.api.runTransaction;let calls=0;
    f.api.runTransaction=(db,fn)=>{calls++;if(calls===1){return original(db,async tx=>{await fn(tx);if(advanced)f.store.seed(base+'/summary','totals',{plantaoNatal:0,plantaoReveillon:1,grupoNatal:0,grupoReveillon:1,totalRegistrations:1});throw Object.assign(Error('permission-denied'),{code:'permission-denied'});});}return original(db,fn);};
    if(advanced){const result=await repo.save({plantao:'natal',grupo:'natal'});assert.equal(result.position,2);assert.equal(calls,2);}
    else{await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}));assert.equal(calls,1);}
  }
});

test('ordinary participants subscribe only to anonymous totals and their own document',async()=>{
  const f=fixture(),{repo}=f.repository('one');await repo.open();const changes=[];
  assert.ok(!f.reads.includes(base+'/policy/participation'));
  assert.ok(f.reads.includes(base+'/participation/one'));
  const stop=repo.subscribe(s=>changes.push(s),assert.fail);
  assert.deepEqual(f.subscriptions.map(s=>s.ref),[base+'/summary/totals',base+'/registrations/one']);
  for(const s of f.subscriptions)s.callback({exists:()=>s.ref.endsWith('totals'),data:()=>({...emptyYearEndTotals(),lastParticipantUid:'must never escape'}),metadata:{hasPendingWrites:false,fromCache:false}});
  assert.equal(changes.length,1);assert.ok(!('rows' in changes[0]));assert.ok(!('lastParticipantUid' in changes[0].totals));assert.equal(changes[0].own,null);
  stop();assert.ok(f.subscriptions.every(s=>s.stopped));
});

test('startup reads the authenticated own registration directly from the server',async()=>{
 const f=fixture(),{repo,auth}=f.repository('one');await repo.open();assert.equal(await repo.readOwn(),null);
 const result=await repo.save({plantao:'natal',grupo:'reveillon'});
 const own=await repo.readOwn();assert.equal(own.uid,'one');assert.equal(own.position,result.position);
 assert.equal(f.reads.at(-1),base+'/registrations/one');assert.ok(!f.reads.includes(base+'/registrations'));
 auth.currentUser={uid:'other'};await assert.rejects(repo.readOwn(),{code:'YEAR_END_SESSION_CHANGED'});
});

test('participant-only entry never loads administrator rows or accepts an administrator without team participation',async()=>{
 const f=fixture(),{repo}=f.repository('one','AB',['EFETIVO','ADMINISTRADOR'],{role:'administrador_app'},{participantOnly:true});
 assert.deepEqual(await repo.open(),{sigla:'AB',requireGroup:true,canParticipate:true,isAdmin:false});repo.subscribe(()=>{},assert.fail);
 assert.deepEqual(f.subscriptions.map(s=>s.ref),[base+'/summary/totals',base+'/registrations/one']);
 const admin=fixture().repository('admin',null,['ADMINISTRADOR'],{role:'administrador_app'},{participantOnly:true});
 await assert.rejects(admin.repo.open(),{code:'YEAR_END_INELIGIBLE'});
});

test('administrators may view details without being enrolled as a participant; role alone does not bypass excluded affiliation',async()=>{
  const f=fixture(),{repo}=f.repository('admin',null,['ADMINISTRADOR'],{role:'administrador_app'});
  assert.deepEqual(await repo.open(),{sigla:null,requireGroup:false,canParticipate:false,isAdmin:true});
  repo.subscribe(()=>{},assert.fail);assert.equal(f.subscriptions.length,2);assert.deepEqual(f.subscriptions[1].ref,{query:base+'/registrations'});
  await assert.rejects(repo.save({plantao:'natal',grupo:'natal'}),{code:'YEAR_END_FORBIDDEN'});
  const other=fixture(),resident=other.repository('resident','AB',['RESIDENTE_1','ADMINISTRADOR'],{role:'administrador_app'});
  await assert.rejects(resident.repo.open(),{code:'YEAR_END_INELIGIBLE'});
});
