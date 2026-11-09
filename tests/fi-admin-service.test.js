import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiAdminService} from '../worker-fi-control/admin.js';

function memory(seed = {}) {
  const rows = new Map(Object.entries(seed).map(([key,value]) => [key,structuredClone(value)]));
  const store = {
    async get(collection,id) { return structuredClone(rows.get(`${collection}/${id}`) || null); },
    async list(collection,filters = [],limit = 1000) { return [...rows].filter(([key]) => key.startsWith(collection + '/') && !key.slice(collection.length+1).includes('/')).map(([key,value]) => ({...structuredClone(value),id:key.slice(collection.length+1)})).slice(0,limit); },
    async transaction(fn) {
      const next = new Map(rows);
      const result = await fn({get:store.get,set:async(c,id,v) => next.set(`${c}/${id}`,structuredClone(v)),create:async(c,id,v) => { if(next.has(`${c}/${id}`)) throw Error('EXISTS'); next.set(`${c}/${id}`,structuredClone(v)); },delete:async(c,id) => next.delete(`${c}/${id}`)});
      rows.clear();for(const row of next)rows.set(...row);return result;
    }
  }; return store;
}
const actor = {uid:'fa-admin',fiUid:'fi-admin',email:'admin@example.test',identityLink:{faUid:'fa-admin',fiUid:'fi-admin',email:'admin@example.test',active:true},profile:{uid:'fi-admin',email:'admin@example.test',active:true,access:true,permissions:{admin:true}}};
const contact = {sigla:'AA',name:'Ana',role:'staff',email:'ana@example.test',phone:'123',active:true};
function fixture(seed={},options={}) {
  const store=memory(seed),FA=memory({'users/fa-ana':{uid:'fa-ana',email:'ana@example.test',active:true,access:true,permissions:{labelsManage:true,checklistRead:true},firstLoginCohort:'OPERATIONAL',appUpdateRequest:{id:'old'}}}),FJ=memory();
  const service=createFiAdminService({store,projections:{FA,FJ},now:()=>1234,...options});
  return {store,FA,FJ,run:(action,input={},identity=actor)=>service.execute({actor:identity,action,input})};
}
test('denies inactive, unlinked and permissionless FI actors before reading or writing',async()=>{
  const f=fixture();for(const invalid of [{...actor,identityLink:null},{...actor,fiUid:actor.uid},{...actor,profile:{...actor.profile,active:false}},{...actor,profile:{...actor.profile,permissions:{}}}]) await assert.rejects(f.run('people.save',{...contact,expectedVersion:0},invalid),/FI_ADMIN_FORBIDDEN/);
  assert.equal(await f.store.get('contacts','AA'),null);
});
test('contact changes are authoritative in FI and project atomically into the two FJ catalogs',async()=>{
  const f=fixture();const result=await f.run('people.save',{...contact,expectedVersion:0});
  assert.equal(result.projection.status,'applied');assert.equal(result.record.version,1);
  assert.equal((await f.store.get('contacts','AA')).createdByUid,'fa-admin');
  assert.equal((await f.FJ.get('contacts','AA')).email,'ana@example.test');
  assert.deepEqual(await f.FJ.get('eventMembers','AA'),{id:'AA',sigla:'AA',name:'Ana',active:true,updatedByUid:'fa-admin',updatedAt:1234,fiAdminVersion:1});
  await assert.rejects(f.run('people.save',{...contact,name:'Lost edit',expectedVersion:0}),/FI_ADMIN_STALE_VERSION/);
  assert.equal((await f.FJ.get('contacts','AA')).name,'Ana');
});
test('projection failure is durable and is never reported as synchronization success',async()=>{
  const f=fixture({}, {projections:{FJ:{transaction:async()=>{throw Error('OFFLINE');}}}});
  const result=await f.run('people.save',{...contact,expectedVersion:0});assert.equal(result.projection.status,'pending');
  assert.equal((await f.store.get('contacts','AA')).name,'Ana');
  const jobs=await f.store.list('fiAdminOutbox');assert.equal(jobs.length,1);assert.equal(jobs[0].status,'pending');
});
test('registration import aborts all changes on missing contact or stale version',async()=>{
  const f=fixture({'contacts/AA':{...contact,version:3,createdAt:5,createdByUid:'creator'}});
  await assert.rejects(f.run('people.import',{records:[{...contact,expectedVersion:3},{...contact,sigla:'BB',expectedVersion:0}]}),/FI_ADMIN_CONTACT_MISSING/);
  assert.equal((await f.store.get('contacts','AA')).version,3);assert.equal((await f.store.list('fiAdminOutbox')).length,0);
  await f.run('people.import',{records:[{...contact,name:'Ana Updated',expectedVersion:3}]});
  assert.equal((await f.store.get('contacts','AA')).createdAt,5);assert.equal((await f.store.get('contacts','AA')).role,'staff');
});
test('user administration requires explicit verified target link and preserves independent grants and receipts',async()=>{
  const user={uid:'fa-ana',email:'ana@example.test',displayName:'Ana',role:'anestesiologista',active:true,access:true,permissions:{eventsRead:true},expectedVersion:0};
  const f=fixture();await assert.rejects(f.run('admin.users.save',user),/FI_ADMIN_IDENTITY_UNLINKED/);
  await f.store.transaction(tx=>tx.set('fiAdminIdentityLinks','fa-ana',{faUid:'fa-ana',fiUid:'fi-ana',email:'ana@example.test',active:true}));
  const result=await f.run('admin.users.save',user);assert.equal(result.projection.status,'applied');
  const projected=await f.FA.get('users','fa-ana');assert.equal(projected.permissions.labelsManage,true);assert.equal(projected.permissions.checklistRead,true);assert.equal(projected.permissions.eventsRead,true);assert.equal(projected.appUpdateRequest.id,'old');assert.equal(projected.firstLoginCohort,'OPERATIONAL');
  assert.equal(await f.store.get('users','fi-ana'),null,'FA administration cannot grant FI operator permissions');
});
test('a people manager cannot grant users or request updates and self administration is rejected',async()=>{
  const f=fixture();const people={...actor,profile:{...actor.profile,permissions:{peopleManage:true}}};
  await assert.rejects(f.run('updates.request',{uid:'fa-ana',minimumRelease:100},people),/FI_ADMIN_FORBIDDEN/);
  await assert.rejects(f.run('admin.users.save',{uid:'fa-ana'},people),/FI_ADMIN_FORBIDDEN/);
  await assert.rejects(f.run('admin.users.save',{uid:'fa-admin'},actor),/FI_ADMIN_SELF_EDIT/);
});

test('a new verified FA pending request receives an explicit FI directory link during approval',async()=>{
 const f=fixture();await f.FA.transaction(tx=>tx.set('accessRequests','new-user',{uid:'new-user',email:'new@example.test',displayName:'New',status:'PENDING'}));
 const result=await f.run('admin.users.save',{uid:'new-user',email:'new@example.test',displayName:'New',role:'anestesiologista',active:true,access:true,permissions:{eventsRead:true},expectedVersion:0});
 assert.equal(result.projection.status,'applied');
 assert.equal((await f.store.get('fiAdminIdentityLinks','new-user')).bindingMethod,'VERIFIED_FA_ACCESS_REQUEST');
 assert.equal((await f.store.get('users','new-user')).email,'new@example.test');
 assert.equal((await f.FA.get('accessRequests','new-user')).status,'APPROVED');
});
test('targeted update administration in FI preserves the FA client signal and per-device receipts',async()=>{
  const f=fixture({'fiAdminUsers/fa-ana':{uid:'fa-ana',email:'ana@example.test',active:true,access:true}});
  await f.FA.transaction(tx=>tx.set('users/fa-ana/appInstallations','device_FA',{uid:'fa-ana',deviceId:'device',target:'FA',loadedRelease:100}));
  const sent=await f.run('updates.request',{uid:'fa-ana',target:'FA',minimumRelease:200});assert.equal(sent.projection.status,'applied');
  const signal=(await f.FA.get('users','fa-ana')).appUpdateRequest;assert.equal(signal.target,'FA');assert.equal(signal.requestedByUid,'fa-admin');assert.equal(signal.minimumRelease,200);
  const read=await f.run('updates.read',{uid:'fa-ana'});assert.equal(read.devices.length,1);assert.equal(read.request.id,signal.id);
  await f.run('updates.cancel',{uid:'fa-ana',target:'FA'});assert.equal((await f.FA.get('users','fa-ana')).appUpdateRequest,null);
});
