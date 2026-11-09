import test from 'node:test';
import assert from 'node:assert/strict';
import {planFiControlMigration} from '../scripts/lib/fi-control-migration.js';
const snapshot={projectId:'sahmt-operacional-fi',users:[{id:'fa-a',uid:'fa-a',email:'ana@example.test',displayName:'Ana',active:true,access:true,permissions:{peopleManage:true},role:'anestesiologista'}],faAccounts:[{localId:'fa-a',email:'ana@example.test',emailVerified:true}],fiAccounts:[{localId:'different-fi-a',email:'ana@example.test',emailVerified:true}],contacts:[{id:'AA',sigla:'AA',name:'Ana',email:'ana@example.test',active:true}],categories:[],appConfig:{id:'app',version:2,features:{}},existing:[]};
test('migration binds verified identities explicitly and keeps source authorship and all source data',()=>{
 const original=structuredClone(snapshot),plan=planFiControlMigration(snapshot);
 const link=plan.documents.find(d=>d.path==='fiAdminIdentityLinks/fa-a').data;assert.equal(link.fiUid,'different-fi-a');
 assert.ok(plan.documents.some(d=>d.path==='users/different-fi-a'));assert.ok(plan.documents.some(d=>d.path==='fiAdminUsers/fa-a'));assert.deepEqual(snapshot,original);assert.equal(plan.sourceDeletes,0);
});
test('migration rejects wrong project, duplicate identities and destination collisions',()=>{
 assert.throws(()=>planFiControlMigration({...snapshot,projectId:'sahmt-17a16'}),/FI_MIGRATION_TARGET/);
 assert.throws(()=>planFiControlMigration({...snapshot,users:[...snapshot.users,{...snapshot.users[0],id:'other',uid:'other'}]}),/FI_MIGRATION_IDENTITY/);
 const first=planFiControlMigration(snapshot);assert.throws(()=>planFiControlMigration({...snapshot,existing:[{path:first.documents[0].path,data:{different:true}}]}),/FI_MIGRATION_DESTINATION/);
});
test('unchanged replay only creates missing records and disabled identities remain disabled',()=>{
 const first=planFiControlMigration(snapshot),again=planFiControlMigration({...snapshot,existing:first.documents});assert.equal(again.documents.length,0);
 const disabled=planFiControlMigration({...snapshot,users:[{...snapshot.users[0],active:false}]});assert.equal(disabled.documents.find(d=>d.path==='users/different-fi-a').data.active,false);
});
