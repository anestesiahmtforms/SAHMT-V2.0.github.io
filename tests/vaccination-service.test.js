import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaccinationService } from '../worker-training/vaccination-service.js';
import {createHash} from 'node:crypto';
import { vaccinationMemoryStore } from './helpers/vaccination-memory-store.js';
const identity = uid => ({uid,email:`${uid}@example.invalid`,emailVerified:true,provider:'google.com'});
const input = () => ({year:2026,category:'Equipe',awareness:false,truth:true,states:{hepatitisB:'UNKNOWN',tetanus:'PENDING',mmr:'UPDATED',influenza:'NOT_ADHERED'},declaration:'WILL_UPDATE',notes:'Synthetic fixture',expectedVersion:0});
function setup(){const store=vaccinationMemoryStore();for(const uid of ['one','two','admin'])store.seed('userCategories',createHash('sha256').update(identity(uid).email).digest('hex'),{schemaVersion:1,identityStatus:'LINKED',...identity(uid),memberCategories:['EFETIVO']}); for(const uid of ['one','two','admin']) store.seed('users',uid,{uid,email:identity(uid).email,displayName:`Synthetic ${uid}`,active:true,access:true,role:uid==='admin'?'administrador_app':'medico',category:'Equipe'});return {store,service:createVaccinationService({store,now:()=>1234})};}
const rejectsCode=(promise,code)=>assert.rejects(promise,error=>error.code===code);
test('bootstrap and save bind to authenticated profile and never expose another participant',async()=>{
  const {store,service}=setup();await service.execute('SAVE',input(),identity('two'));
  const before=await service.execute('BOOTSTRAP',{year:2026},identity('one'));assert.equal(before.record,null);assert.equal(before.isAdmin,false);assert.equal(before.profile.displayName,'Synthetic one');
  const {record}=await service.execute('SAVE',input(),identity('one'));assert.equal(record.uid,'one');assert.equal(record.email,'one@example.invalid');assert.equal(record.displayName,'Synthetic one');assert.equal(record.version,1);assert.equal(record.createdAt,1234);
  assert.deepEqual((await service.execute('BOOTSTRAP',{year:2026},identity('one'))).record,record);
  assert.equal((await store.get('occupationalVaccinations','two_2026')).uid,'two');
  for(const action of ['BOOTSTRAP','REPORT'])await rejectsCode(service.execute(action,{year:2026,uid:'two'},identity('admin')),'VAC_INVALID_INPUT');
  for(const patch of [{uid:'two'},{email:'two@example.invalid'},{displayName:'Injected'},{version:90}])await rejectsCode(service.execute('SAVE',{...input(),...patch},identity('one')),'VAC_INVALID_INPUT');
});
test('version comparison is transactional and concurrent saves cannot overwrite',async()=>{
  const {store,service}=setup();const results=await Promise.allSettled([service.execute('SAVE',input(),identity('one')),service.execute('SAVE',input(),identity('one'))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'VAC_VERSION_CONFLICT');
  store.seed('occupationalVaccinations','one_2026',{...await store.get('occupationalVaccinations','one_2026'),attachment:{id:'synthetic'}});
  const {record}=await service.execute('SAVE',{...input(),expectedVersion:1},identity('one'));assert.equal(record.version,2);assert.equal(record.attachment,undefined);
  await rejectsCode(service.execute('SAVE',{...input(),expectedVersion:1},identity('one')),'VAC_VERSION_CONFLICT');
});
test('identity and fresh profile checks reject unverified, provider, inactive, mismatched and revoked accounts',async()=>{
  for(const patch of [{emailVerified:false},{provider:'password'},{uid:'../one'},{email:'invalid'}]){const {service}=setup();await rejectsCode(service.execute('BOOTSTRAP',{year:2026},{...identity('one'),...patch}),'VAC_UNAUTHENTICATED');}
  for(const patch of [{active:false},{access:false},{uid:'another'},{email:'another@example.invalid'}]){const {store,service}=setup();store.seed('users','one',{...await store.get('users','one'),...patch});await rejectsCode(service.execute('BOOTSTRAP',{year:2026},identity('one')),'VAC_FORBIDDEN');}
  const {store,service}=setup();store.beforeCommit=async()=>store.seed('users','one',{...await store.get('users','one'),access:false});await rejectsCode(service.execute('SAVE',input(),identity('one')),'VAC_FORBIDDEN');assert.equal(await store.get('occupationalVaccinations','one_2026'),null);
});
test('report is admin only and fresh permission revocation prevents release',async()=>{
  const {store,service}=setup();for(const patch of [{role:'gestor'},{permissions:{peopleManage:true}}]){store.seed('users','one',{...await store.get('users','one'),...patch});await rejectsCode(service.execute('REPORT',{year:2026},identity('one')),'VAC_FORBIDDEN');}
  await service.execute('SAVE',input(),identity('two'));
  store.seed('users','owner',{uid:'owner',email:'anestesiahmtforms3@gmail.com',active:true,access:true});store.seed('users','inactive',{uid:'inactive',active:false,access:true});
  const report=await service.execute('REPORT',{year:2026},identity('admin'));assert.equal(report.participants.length,3);assert.equal(report.records.length,1);assert.equal(report.report.general.registered,3);
  const list=store.list;store.list=async(...args)=>{const data=await list(...args);store.seed('users','admin',{...await store.get('users','admin'),role:'medico'});return data;};
  await rejectsCode(service.execute('REPORT',{year:2026},identity('admin')),'VAC_FORBIDDEN');
});
test('admin permission flag is allowed but inactive/revoked admins cannot scan health records',async()=>{
  const {store,service}=setup();
  store.seed('users','one',{...await store.get('users','one'),permissions:{admin:true}});
  assert.equal((await service.execute('BOOTSTRAP',{year:2026},identity('one'))).isAdmin,true);
  assert.equal((await service.execute('REPORT',{year:2026},identity('one'))).report.general.registered,3);
  let scans=0;const list=store.list;store.list=async(...args)=>{scans++;return list(...args);};
  for(const patch of [{active:false},{access:false}]){
    store.seed('users','admin',{uid:'admin',email:identity('admin').email,role:'administrador_app',active:true,access:true,...patch});
    await rejectsCode(service.execute('REPORT',{year:2026},identity('admin')),'VAC_FORBIDDEN');
  }
  assert.equal(scans,0);
});
test('year records remain separate and reports exclude owner/inactive record contents',async()=>{
  const {store,service}=setup();
  await service.execute('SAVE',input(),identity('one'));
  const {record}=await service.execute('SAVE',{...input(),year:2027},identity('one'));
  assert.equal(record.version,1);assert.equal((await service.execute('BOOTSTRAP',{year:2028},identity('one'))).record,null);
  for(const [uid,patch] of [['owner',{email:'anestesiahmtforms5@gmail.com'}],['inactive',{active:false}]]){
    store.seed('users',uid,{uid,email:`${uid}@example.invalid`,active:true,access:true,...patch});
    store.seed('occupationalVaccinations',`${uid}_2026`,{...input(),uid,version:1});
  }
  const result=await service.execute('REPORT',{year:2026},identity('admin'));
  assert.deepEqual(result.records.map(r=>r.uid),['one']);assert.equal(result.report.general.respondents,1);
  assert.equal(result.records[0].expectedVersion,undefined);
});
test('corrupt record identity fails closed and action/year contracts are strict',async()=>{
  const {store,service}=setup();store.seed('occupationalVaccinations','one_2026',{uid:'two',year:2026,version:1});
  await rejectsCode(service.execute('BOOTSTRAP',{year:2026},identity('one')),'VAC_RECORD_INVALID');
  await rejectsCode(service.execute('SAVE',input(),identity('one')),'VAC_RECORD_INVALID');
  for(const action of ['BOOTSTRAP','REPORT'])await rejectsCode(service.execute(action,{year:2030},identity('admin')),'VAC_INVALID_INPUT');
  await rejectsCode(service.execute('DELETE',{year:2026},identity('one')),'VAC_INVALID_INPUT');
});

test('registry wins over submitted/saved groups and missing mappings never fall back to roles',async()=>{
 const {store,service}=setup(),key=createHash('sha256').update(identity('one').email).digest('hex');
 const assignment={schemaVersion:1,identityStatus:'LINKED',uid:'one',email:identity('one').email,memberCategories:['RESIDENTE_2','ADMINISTRADOR']};
 store.seed('userCategories',key,assignment);
 const saved=await service.execute('SAVE',{...input(),category:'Substitutos'},identity('one'));assert.equal(saved.record.category,'Residentes');
 assert.equal((await service.execute('BOOTSTRAP',{year:2026},identity('one'))).profile.category,'Residentes');
 store.seed('userCategories',key,{...assignment,memberCategories:['SUBSTITUTO']});
 const report=await service.execute('REPORT',{year:2026},identity('admin'));assert.equal(report.participants.find(p=>p.uid==='one').category,'Substitutos');assert.equal(report.report.byGroup.find(g=>g.category==='Substitutos').respondents,1);
 for(const patch of [{identityStatus:'PENDING_ACCOUNT'},{uid:'two'},{email:identity('two').email},{memberCategories:['ADMINISTRADOR']},{memberCategories:['EFETIVO','SUBSTITUTO']}]){
  store.seed('userCategories',key,{...assignment,...patch});await rejectsCode(service.execute('SAVE',{...input(),expectedVersion:1},identity('one')),'VAC_CATEGORY_NOT_CONFIGURED');
 }
});
test('transaction detects registry changes before commit',async()=>{
 const {store,service}=setup(),key=createHash('sha256').update(identity('one').email).digest('hex');
 store.beforeCommit=async()=>store.seed('userCategories',key,{schemaVersion:1,identityStatus:'LINKED',uid:'one',email:identity('one').email,memberCategories:['SUBSTITUTO']});
 const result=await service.execute('SAVE',input(),identity('one'));assert.equal(result.record.category,'Substitutos');
});

test('manual Drive destination is server configured and released only after admin authorization',async()=>{
 const {store}=setup(),url='https://drive.google.com/drive/folders/SYNTHETIC_DRIVE_FOLDER';
 const service=createVaccinationService({store,adminDriveFolderUrl:url});assert.equal((await service.execute('BOOTSTRAP',{year:2026},identity('one'))).adminDriveFolderUrl,undefined);
 await rejectsCode(service.execute('REPORT',{year:2026},identity('one')),'VAC_FORBIDDEN');assert.equal((await service.execute('REPORT',{year:2026},identity('admin'))).adminDriveFolderUrl,url);
 for(const unsafe of ['https://evil.invalid/folder','javascript:alert(1)','https://drive.google.com.evil.invalid/drive/folders/SYNTHETIC_DRIVE_FOLDER'])assert.equal((await createVaccinationService({store,adminDriveFolderUrl:unsafe}).execute('REPORT',{year:2026},identity('admin'))).adminDriveFolderUrl,undefined);
});
