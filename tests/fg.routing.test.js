import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {canEditChecklistStationTitle} from '../src/checklist-display.js';
const source=await readFile(new URL('../src/data.js',import.meta.url),'utf8'),main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+1);assert.ok(a>=0&&b>a);return source.slice(a,b).replaceAll('export ','');}
function fixture({deny=false}={}){
  const database={station:'FG'},writes=[],deliveries=[];
  const c=vm.createContext({navigator:{onLine:true},crypto:{randomUUID:()=> 'new'},db:{station:'FA'},identityDb:{station:'FA'},operationalModuleEnabled:s=>s==='FG',operationalDatabase:async station=>{assert.equal(station,'FG');if(deny)throw Error('MODULE_ACCESS_DENIED');return database;},assertOnlineOperation(){},serverTimestamp:()=> 'SERVER',
    doc:(db,...path)=>({db,path:path.join('/')}),writeBatch:db=>({set:(ref,data)=>{assert.equal(db,database);assert.equal(ref.db,database);writes.push({ref,data});},commit:async()=>{}}),stageOperationalWrite:(batch,{recordRef,data,uid,requestId})=>batch.set(recordRef,{...data,id:requestId,createdByUid:uid}),persistOperationalMutation:async p=>p.sendRemote(),operationalBackend:{noteFailure(){}},unconfirmedWrite:error=>error,confirmOperationalSheetDelivery:(...args)=>deliveries.push(args)});
  vm.runInContext(section('function buildRecordBatch(', '\nfunction stageEventProjection(')+section('function canonicalValue(', '\nasync function commitOperationalMutationOnce('),c);
  return {c,database,writes,deliveries};
}
test('FG Checklist create uses only its destination and skips the retired FA sheet delivery',async()=>{
  const f=fixture();await f.c.createOperationalRecord('checklists',{date:'2026-11-07'},{uid:'u',requestId:'r'});
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].ref.path,'checklists/r');assert.equal(f.writes[0].ref.db,f.database);assert.equal(f.deliveries.length,0);
});
test('denied FG access never falls back to FA writes or source delivery',async()=>{
  const f=fixture({deny:true});await assert.rejects(f.c.createOperationalRecord('checklists',{},{uid:'u',requestId:'r'}),/MODULE_ACCESS_DENIED/);assert.equal(f.writes.length,0);assert.equal(f.deliveries.length,0);
});
test('FG replay is idempotent and rejects different content with the same request ID',async()=>{
  const f=fixture(),records=new Map();
  f.c.runTransaction=async(db,fn)=>{assert.equal(db,f.database);return fn({get:async ref=>({exists:()=>records.has(ref.path),data:()=>records.get(ref.path)}),set:(ref,data)=>records.set(ref.path,data)});};
  f.c.buildRecordBatch=(tx,{data,uid,requestId},db)=>{assert.equal(db,f.database);tx.set({path:'checklists/'+requestId},{...data,id:requestId,clientMutationId:requestId,createdByUid:uid});};
  vm.runInContext(section('async function commitOperationalMutationOnce(', '\nasync function createScheduledEvent('),f.c);
  await f.c.commitOperationalMutationOnce('checklists',{condition:'SIM'},'u','same');
  assert.equal((await f.c.commitOperationalMutationOnce('checklists',{condition:'SIM'},'u','same')).alreadyCommitted,true);assert.equal(records.size,1);
  await assert.rejects(f.c.commitOperationalMutationOnce('checklists',{condition:'NAO'},'u','same'),error=>error.code==='stale-version');
});
test('Checklist permissions come from the matching FG profile while central revocation still blocks access',()=>{
  const c=vm.createContext({fgChecklistEnabled:true,session:{user:{uid:'u'},profile:{active:true,access:true,permissions:{checklistWrite:true}},checklistProfile:{uid:'u',active:true,access:true,permissions:{checklistRead:true}}}});
  vm.runInContext(main.slice(main.indexOf('function can(permission)'),main.indexOf('// Individual release')),c);
  assert.equal(c.can('checklistWrite'),false);assert.equal(c.can('checklistRead'),true);
  c.session.profile.permissions.checklistRead=false;assert.equal(c.can('checklistRead'),true);
  c.session.user.uid='new-user';assert.equal(c.can('checklistRead'),false);c.session.user.uid='u';
  c.session.profile.active=false;assert.equal(c.can('checklistRead'),false);
});
test('Home keeps Checklist visible while its destination access check is pending',()=>{
  const c=vm.createContext({fgChecklistEnabled:true,labels:{checklist:['CHECKLIST','Arsenais']},session:{status:'signed-in',profile:{active:true,access:true}},can:()=>false,featureEnabledForRoute:()=>true,appFeatures:{},escapeHtml:String});
  vm.runInContext(main.slice(main.indexOf('function moduleCards()'),main.indexOf('function hasOccurrencePermission()')).replaceAll('import.meta.env.BASE_URL','"/"'),c);
  assert.match(c.moduleCards(),/data-route="checklist"/);c.session.status='signed-out';assert.doesNotMatch(c.moduleCards(),/data-route="checklist"/);
});
test('FG answers and title permissions use the same destination profile even when central name or grants differ',async()=>{
  const writes=[],session={user:{uid:'u',email:'wx2064@gmail.com',emailVerified:true},profile:{uid:'u',displayName:'New central name',active:true,access:true,permissions:{checklistManage:false}},checklistProfile:{uid:'u',displayName:'Module name',sigla:'AA',active:true,access:true,permissions:{checklistWrite:true,checklistManage:true}}};
  const c=vm.createContext({fgChecklistEnabled:true,session,navigator:{onLine:true},checklistDayMode:()=> 'today',todayInputValue:()=> '2026-11-07',loadDataModule:async()=>({createOperationalRecord:async(type,data)=>{writes.push({type,data});return {id:'r'};}})});
  const extract=name=>{const begin=main.indexOf(name),end=main.indexOf('\n}',begin)+2;assert.ok(begin>=0&&end>begin);return main.slice(begin,end);};
  vm.runInContext(extract('function can(permission)')+extract('function checklistIdentityProfile()')+extract('async function saveChecklistAnswer(').replace("await import('./data.js')",'await loadDataModule()'),c);
  assert.equal(c.checklistIdentityProfile().displayName,'Module name');
  const result=await c.saveChecklistAnswer('station','SIM','2026-11-07');assert.equal(result.ok,true);assert.equal(writes[0].data.createdByName,'Module name');
  assert.equal(canEditChecklistStationTitle(session.user,c.checklistIdentityProfile()),true);
  assert.ok(main.includes('canEditChecklistStationTitle(session.user, checklistIdentityProfile())'));
  assert.ok(main.includes("signerSigla: checklistIdentityProfile()?.sigla"));
  session.checklistProfile.uid='foreign';assert.equal(c.checklistIdentityProfile(),null);assert.equal(canEditChecklistStationTitle(session.user,c.checklistIdentityProfile()),false);
});
