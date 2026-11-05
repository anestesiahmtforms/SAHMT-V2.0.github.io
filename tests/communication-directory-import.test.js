import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCommunicationDirectoryImport} from '../scripts/lib/communication-directory-import.js';
import {decodeFields} from '../worker-communication/store.js';
const snapshot=()=>({at:'2026-11-04T18:00:00Z',faUsers:[{id:'local-a',uid:'local-a',email:'a@example.test',active:true,access:true,role:'gestor'}],fbUsers:[{id:'fb-a',uid:'fb-a',email:'a@example.test'}],ffUsers:[],authUsers:[{localId:'ff-a',email:'a@example.test'}],categories:[{email:'a@example.test',uid:'fb-a',schemaVersion:1,identityStatus:'LINKED',memberCategories:['RESIDENTE_2','GESTOR']}],areas:[{id:'area-a',active:true,memberUids:['fb-a'],managerUids:[]}],devices:[{id:'device-a',uid:'ff-a',sourceUid:'local-a',email:'a@example.test',token:'protected-token',updateTime:'v1'}],recipients:[{id:'ff-a',email:'a@example.test',sourceUid:'local-a',updateTime:'v1'}],messages:[]});
test('initial import keeps local audience IDs, maps groups by email and binds FF identity',()=>{
 const p=buildCommunicationDirectoryImport(snapshot());
 assert.equal(p.summary.users,1);assert.equal(p.summary.missingAffiliations,0);
 const read=path=>decodeFields(p.writes.find(w=>w.update?.name.endsWith(path)).update.fields);
 assert.equal(read('/users/local-a').ffUid,'ff-a');assert.equal(read('/users/local-a').institutionalGroup,'resident');
 assert.deepEqual(read('/managementAreas/area-a').memberUids,['local-a']);assert.equal(read('/communicationDevices/device-a').sourceUid,'local-a');
 assert.ok(p.writes.every(w=>(w.update?.name||w.delete).startsWith('projects/sahmt-comunicacao-ff/databases/comunicacao/documents/')));
});
test('duplicate source email and mismatched profile identity stop the import',()=>{
 const a=snapshot();a.faUsers.push({...a.faUsers[0],id:'other',uid:'other'});assert.throws(()=>buildCommunicationDirectoryImport(a),/IDENTITY_AMBIGUOUS/);
 const b=snapshot();b.faUsers[0].uid='wrong';assert.throws(()=>buildCommunicationDirectoryImport(b),/IDENTITY_AMBIGUOUS/);
 const c=snapshot();c.fbUsers.push({...c.fbUsers[0],id:'fb-other',uid:'fb-other'});assert.throws(()=>buildCommunicationDirectoryImport(c),/IDENTITY_AMBIGUOUS/);
});
test('deleted account is excluded and unresolved group memberships stop before writes',()=>{
 const a=snapshot();a.faUsers.push({id:'removed',uid:'removed',email:'wx2901@gmail.com',active:true,access:true});
 assert.equal(buildCommunicationDirectoryImport(a).summary.users,1);
 const b=snapshot();b.areas[0].memberUids=['missing'];assert.throws(()=>buildCommunicationDirectoryImport(b),/GROUP_MEMBER_UNMAPPED/);
});
test('an absent source Auth account is excluded only with a recorded verification for this source',()=>{
 const a=snapshot();a.groupSource='FA';a.areas[0].managerUids=['retired-manager'];
 assert.throws(()=>buildCommunicationDirectoryImport(a),/GROUP_MEMBER_UNMAPPED/);
 a.absentMemberships=[{uid:'retired-manager',source:'FA',reason:'SOURCE_AUTH_ACCOUNT_ABSENT',verifiedAt:'2026-11-05T12:00:00Z'}];
 const plan=buildCommunicationDirectoryImport(a);assert.deepEqual(decodeFields(plan.writes.find(w=>w.update?.name.endsWith('/managementAreas/area-a')).update.fields).managerUids,[]);
 a.absentMemberships[0].source='FB';assert.throws(()=>buildCommunicationDirectoryImport(a),/GROUP_MEMBER_UNMAPPED/);
});
test('missing affiliation prevents a complete import and disabled FF access is preserved',()=>{
 const a=snapshot();a.categories=[];assert.throws(()=>buildCommunicationDirectoryImport(a),/AFFILIATION_MISSING/);
 const b=snapshot();b.ffUsers=[{id:'local-a',uid:'local-a',email:'a@example.test',active:false,access:false,updateTime:'v1',permissions:{admin:false}}];
 const write=buildCommunicationDirectoryImport(b).writes.find(w=>w.update?.name.endsWith('/users/local-a'));
 assert.equal(decodeFields(write.update.fields).access,false);assert.deepEqual(write.currentDocument,{updateTime:'v1'});
});
test('the already deleted account cannot survive as a stale active FF profile',()=>{
 const a=snapshot();a.ffUsers.push({id:'old-deleted',uid:'old-deleted',email:'wx2901@gmail.com',active:true,access:true,updateTime:'old'});
 a.fbUsers.push({id:'deleted-uid',uid:'deleted-uid',email:'wx2901@gmail.com'});a.areas[0].memberUids.push('deleted-uid','EVUyLGKSjPZa5mvVI6evXLROern1');
 a.devices.push({id:'deleted-device',email:'wx2901@gmail.com',updateTime:'old'});a.recipients.push({id:'deleted-recipient',email:'wx2901@gmail.com',updateTime:'old'});
 const plan=buildCommunicationDirectoryImport(a);for(const path of ['/users/old-deleted','/communicationDevices/deleted-device','/communicationRecipients/deleted-recipient'])assert.ok(plan.writes.some(w=>w.delete?.endsWith(path)&&w.currentDocument.updateTime==='old'));
 assert.deepEqual(decodeFields(plan.writes.find(w=>w.update?.name.endsWith('/managementAreas/area-a')).update.fields).memberUids,['local-a']);
});
