import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/data.js',import.meta.url),'utf8');
test('Home retains the Etiquetas entry while the independent FH profile is pending or unavailable',async()=>{
 const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const code=main.slice(main.indexOf('function moduleCards()'),main.indexOf('function hasOccurrencePermission()')).replaceAll('import.meta.env.BASE_URL','"/"');
 const c=vm.createContext({fhLabelsEnabled:true,labels:{labels:['ETIQUETAS','Registros']},session:{status:'signed-in',profile:{active:true,access:true}},can:()=>false,featureEnabledForRoute:()=>true,appFeatures:{},escapeHtml:String});
 vm.runInContext(code,c);assert.match(c.moduleCards(),/data-route="labels"/);
 c.session.status='signed-out';assert.doesNotMatch(c.moduleCards(),/data-route="labels"/);
});
test('FH interface uses its own profile and explicit false overrides inherited admin',async()=>{
 const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const code=main.slice(main.indexOf('function can(permission)'),main.indexOf('// Individual release'));
 const context=vm.createContext({fhLabelsEnabled:true,session:{profile:{active:true,access:true,role:'administrador_app',permissions:{admin:true}},labelProfile:{active:true,access:true,permissions:{admin:true}}}});
 vm.runInContext(code,context);assert.equal(context.can('labelsWrite'),true);
 context.session.labelProfile.permissions.labelsWrite=false;assert.equal(context.can('labelsWrite'),false);
 context.session.labelProfile=null;assert.equal(context.can('labelsWrite'),false);
});
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+1);assert.ok(a>=0&&b>a);return source.slice(a,b).replaceAll('export ','');}
function fixture({deny=false}={}){
 const database={station:'FH'},calls=[],writes=[],mirrors=[],deliveries=[];
 const c=vm.createContext({console,navigator:{onLine:true},crypto:{randomUUID:()=> 'new'},db:{station:'FA'},identityDb:{station:'FA'},operationalModuleEnabled:s=>s==='FH',
  operationalDatabase:async(s,uid)=>{calls.push({s,uid});assert.equal(s,'FH');if(deny)throw Error('MODULE_ACCESS_DENIED');return database;},
  assertOnlineOperation(){},isOfflineRuntimeForced:()=>false,serverTimestamp:()=> 'SERVER_TIMESTAMP',
  doc:(db,...p)=>({db,path:p.join('/')}),collection:(db,...p)=>({db,path:p.join('/')}),query:(ref,...filters)=>({ref,filters}),orderBy:()=>0,limit:()=>0,
  getDocsFromServer:async q=>{assert.equal(q.ref.db,database);calls.push(q.ref.path);return {docs:[]};},
  runTransaction:async(db,fn)=>{assert.equal(db,database);return fn({get:async ref=>({exists:()=>ref.path==='labels/l1',data:()=>({version:1,active:true,status:'CONFIRMED',date:'2026-11-06'})}),update:(ref,data)=>writes.push({ref,data}),set:(ref,data)=>writes.push({ref,data})});},
  writeBatch:db=>({set:(ref,data)=>{assert.equal(db,database);writes.push({ref,data});},commit:async()=>{}}),
  stageOperationalWrite:(batch,{recordRef,data,uid,requestId})=>batch.set(recordRef,{...data,id:requestId,createdByUid:uid}),
  persistOperationalMutation:async p=>p.sendRemote(),operationalBackend:{noteFailure(){}},confirmOperationalSheetDelivery:(...args)=>deliveries.push(args),sahmtMirrorConfirmedSource:p=>mirrors.push(p)
 });
 vm.runInContext(section('export async function saveLabelStaffSiglas(', '\nexport async function saveContact(')+section('export async function updateLabelRecord(', '\nexport async function listChecklistStations(')+section('function buildRecordBatch(', '\nfunction canonicalValue(')+section('function canonicalValue(', '\nasync function confirmCommittedMutation(')+section('async function confirmCommittedMutation(', '\nasync function createScheduledEvent('),c);
 return {c,calls,writes,mirrors,deliveries,database};
}
test('FH label create and catalog changes never notify or mirror FA',async()=>{
 const f=fixture();await f.c.createOperationalRecord('labels',{date:'2026-11-06'},{uid:'u',requestId:'l1'});await f.c.saveLabelStaffSiglas(['AA'],'u');
 assert.deepEqual(f.writes.map(x=>x.ref.path),['labels/l1','appConfig/labelStaff']);assert.ok(f.writes.every(x=>x.ref.db===f.database));assert.equal(f.deliveries.length,0);assert.equal(f.mirrors.length,0);
});
test('FH edit and immutable history use one destination transaction',async()=>{
 const f=fixture();await f.c.updateLabelRecord('l1',{date:'2026-11-07'},'u','Actor',1,{queueOffline:false,requestId:'e1'});
 assert.deepEqual(f.writes.map(x=>x.ref.path),['labels/l1','labels/l1/history/2']);assert.ok(f.writes.every(x=>x.ref.db===f.database));assert.equal(f.mirrors.length,0);
 await f.c.listLabelHistory('l1',{uid:'u'});assert.ok(f.calls.includes('labels/l1/history'));
});
test('FH access denial does not fall back to a source write',async()=>{
 const f=fixture({deny:true});await assert.rejects(f.c.createOperationalRecord('labels',{},{uid:'u',requestId:'x'}),/MODULE_ACCESS_DENIED/);assert.equal(f.writes.length,0);assert.equal(f.deliveries.length,0);
});

test('generic label module listing resolves FH before any collection access',async()=>{
 let reads=0;const database={station:'FH'},c=vm.createContext({db:{station:'FA'},mayUseOfflineCache:()=>false,MAX_PAGE_SIZE:50,moduleCollections:{labels:{name:'labels',order:'date',direction:'desc'}},SAFE_CACHE_MODULES:new Set(),isOfflineRuntimeForced:()=>false,
  operationalDatabase:async station=>{assert.equal(station,'FH');return database;},collection:(db,path)=>{assert.equal(db,database);assert.equal(path,'labels');return {};},where:()=>0,orderBy:()=>0,limit:()=>0,query:()=>0,getDocsFromServer:async()=>{reads++;return {docs:[]};}});
 const begin=source.indexOf('export async function listModuleRecords('),end=source.indexOf('\nexport ',begin+1);vm.runInContext(source.slice(begin,end).replace('export ',''),c);
 await c.listModuleRecords('labels','u');assert.equal(reads,1);
});

test('FH replay preserves one label and rejects conflicting content for the same request ID',async()=>{
 const records=new Map(),database={station:'FH'};let writes=0;
 const c=vm.createContext({operationalDatabase:async s=>{assert.equal(s,'FH');return database;},identityDb:{station:'FA'},db:{station:'FA'},
  doc:(db,...path)=>{assert.equal(db,database);return path.join('/');},writeBatch:()=>assert.fail('Labels must compare an existing request before replay'),
  runTransaction:async(db,fn)=>{assert.equal(db,database);return fn({get:async ref=>({exists:()=>records.has(ref),data:()=>records.get(ref)}),set:(ref,data)=>{records.set(ref,data);writes++;}});},
  buildRecordBatch:(tx,{data,uid,requestId},db)=>{assert.equal(db,database);tx.set('labels/'+requestId,{...data,id:requestId,clientMutationId:requestId,createdByUid:uid});}
 });
 vm.runInContext(section('function canonicalValue(', '\nasync function confirmCommittedMutation(')+section('async function commitOperationalMutationOnce(', '\nasync function createScheduledEvent('),c);
 const data={patientName:'Synthetic'};await c.commitOperationalMutationOnce('labels',data,'u','same');const replay=await c.commitOperationalMutationOnce('labels',data,'u','same');assert.equal(replay.alreadyCommitted,true);assert.equal(writes,1);
 await assert.rejects(c.commitOperationalMutationOnce('labels',{patientName:'Changed'},'u','same'),e=>e.code==='stale-version');assert.equal(writes,1);
});
