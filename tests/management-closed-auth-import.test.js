import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareManagementClosedAuthImport, validateManagementClosedAuthImportResponse, validateManagementClosedAuthImportPostcheck} from '../scripts/lib/management-closed-auth-import.js';
import {prepareAuthImportPlan, authImportPlanDigest, authSnapshotDigest, authSourceRecordDigest, authRawSnapshotDigest} from '../scripts/lib/management-auth-import-plan.js';

const sourceUser=(uid='member-a',overrides={})=>({uid,disabled:false,emailVerified:true,email:`${uid}@example.invalid`,displayName:'Member A',photoURL:'https://example.invalid/a.png',providerData:[{providerId:'google.com',uid:`google-${uid}`,email:`${uid}@example.invalid`,displayName:'Member A'}],...overrides});
const mapping=user=>({memberId:`stable-${user.uid}`,faUid:user.uid,fbUid:user.uid});
const snapshot=(projectId,users,readTime='2026-10-09T18:00:00.000Z')=>({schemaVersion:1,projectId,readTime,coverage:{complete:true,atomicSnapshot:false},users});
function fixture({sourceUsers=[sourceUser()],destinationUsers=[],rawOverrides={},expectedPlanSha256}={}){
 const source=snapshot('sahmt-17a16',sourceUsers),destination=snapshot('sahmt-gestao-5ae66',destinationUsers);
 const mappings=sourceUsers.map(mapping);
 const options={};
 const plan=prepareAuthImportPlan(source,destination,mappings,options);
 const rawUsers=sourceUsers.map(user=>({localId:user.uid,disabled:user.disabled,emailVerified:user.emailVerified,email:user.email,displayName:user.displayName,photoUrl:user.photoURL,providerUserInfo:user.providerData.map(p=>({providerId:p.providerId,rawId:p.uid,...(p.email?{email:p.email}:{}),...(p.displayName?{displayName:p.displayName}:{})})),...(rawOverrides[user.uid]||{})}));
 const input={sourceSnapshot:source,destinationSnapshot:destination,rawSourceUsers:rawUsers,identityMappings:mappings,planOptions:options,expectedPlanSha256:expectedPlanSha256??plan.resultSha256};
 return {input,plan,source,destination,mappings,rawUsers};
}

test('prepara accounts:batchCreate somente para plano pinado, com UID Google e sem sobrescrita',()=>{
 const f=fixture();
 const batch=prepareManagementClosedAuthImport(f.input);
 assert.equal(batch.destinationProjectId,'sahmt-gestao-5ae66');
 assert.equal(batch.request.allowOverwrite,false);
 assert.equal(batch.request.sanityCheck,true);
 assert.equal(batch.request.hashAlgorithm,'BCRYPT');
 assert.deepEqual(batch.request.users,[{localId:'member-a',email:'member-a@example.invalid',emailVerified:true,displayName:'Member A',photoUrl:'https://example.invalid/a.png',disabled:false,providerUserInfo:[{providerId:'google.com',rawId:'google-member-a',email:'member-a@example.invalid',displayName:'Member A'}]}]);
 assert.equal(batch.recordCount,1);
 assert.equal(batch.recomputedPlanSha256,f.plan.resultSha256);
});

test('prepara identidade providerless para custom token sem incluir hashes, senhas ou claims',()=>{
 const user=sourceUser('custom-token-only',{emailVerified:false,providerData:[]});
 const source=snapshot('sahmt-17a16',[user]),destination=snapshot('sahmt-gestao-5ae66',[]),mappings=[mapping(user)];
 const rawUsers=[{localId:user.uid,disabled:false,emailVerified:false,email:user.email,displayName:user.displayName,photoUrl:user.photoURL,providerUserInfo:[]}];
 const options={deferUnlinkedSource:true,requiredSourceUids:[],provisionCustomTokenOnlyUids:[user.uid],
  expectedRawSnapshotSha256:authRawSnapshotDigest(rawUsers),unlinkedSourceEvidence:{schemaVersion:1,
   sourceSnapshotSha256:authSnapshotDigest(source),rawSnapshotSha256:authRawSnapshotDigest(rawUsers),entries:[{
    faUid:user.uid,sourceRecordSha256:authSourceRecordDigest(user),rawRecordSha256:authSourceRecordDigest(rawUsers[0]),
    providerCount:0,passwordMaterialPresent:false,otherProviderIdentityPresent:false,disabled:false,emailVerified:false}]}};
 const plan=prepareAuthImportPlan(source,destination,mappings,options);
 const batch=prepareManagementClosedAuthImport({sourceSnapshot:source,destinationSnapshot:destination,rawSourceUsers:rawUsers,
  identityMappings:mappings,planOptions:options,expectedPlanSha256:plan.resultSha256});
 assert.equal(batch.request.users[0].localId,user.uid);
 assert.deepEqual(batch.request.users[0].providerUserInfo,[]);
 for(const forbidden of ['passwordHash','passwordSalt','salt','password','customClaims','PRIVATE']) assert.equal(JSON.stringify(batch).includes(forbidden),false);
 assert.equal(batch.request.allowOverwrite,false);
});

test('recusa plano alterado ou que não autoriza o subconjunto inteiro',()=>{
 const f=fixture();
 assert.throws(()=>prepareManagementClosedAuthImport({...f.input,expectedPlanSha256:'f'.repeat(64)}),/AUTH_IMPORT_PLAN_PIN_MISMATCH/);
 const conflict=fixture({sourceUsers:[sourceUser('member-a',{providerData:[{providerId:'password',uid:'member-a'}]})]});
 assert.throws(()=>prepareManagementClosedAuthImport(conflict.input),/AUTH_IMPORT_PLAN_NOT_READY/);
});

test('correlaciona origem bruta com snapshot normalizado e bloqueia outros provedores',()=>{
 const f=fixture({rawOverrides:{'member-a':{providerUserInfo:[{providerId:'google.com',rawId:'google-member-a'},{providerId:'password',rawId:'member-a'}]}}});
 assert.throws(()=>prepareManagementClosedAuthImport(f.input),/AUTH_IMPORT_RAW_IDENTITY_MISMATCH/);
});

test('confere resultado completo sem revelar identificadores; erro parcial fica para revisão',()=>{
 const f=fixture({sourceUsers:[sourceUser('member-a'),sourceUser('member-b')]});
 const batch=prepareManagementClosedAuthImport(f.input);
 const complete=validateManagementClosedAuthImportResponse({batch,response:{successCount:2,failureCount:0,errors:[]}});
 assert.deepEqual(complete,{status:'COMPLETE',requestedCount:2,successCount:2,failureCount:0,errorIndexes:[]});
 const partial=validateManagementClosedAuthImportResponse({batch,response:{successCount:1,failureCount:1,errors:[{index:1,error:{message:'private detail'}}]}});
 assert.deepEqual(partial,{status:'PARTIAL_REQUIRES_REVIEW',requestedCount:2,successCount:1,failureCount:1,errorIndexes:[1]});
 assert.equal(JSON.stringify(partial).includes('private detail'),false);
});

test('bloqueia índices inválidos, repetidos e contagem que não fecha',()=>{
 const batch=prepareManagementClosedAuthImport(fixture({sourceUsers:[sourceUser('member-a'),sourceUser('member-b')]}).input);
 for(const response of [
  {successCount:1,failureCount:1,errors:[{index:2,error:{}}]},
  {successCount:0,failureCount:2,errors:[{index:0,error:{}},{index:0,error:{}}]},
  {successCount:1,failureCount:0,errors:[]}
 ]) assert.throws(()=>validateManagementClosedAuthImportResponse({batch,response}),/AUTH_IMPORT_RESPONSE_INVALID/);
});

test('postcheck exige exatamente os usuários anteriores mais todos os imports esperados',()=>{
 const f=fixture({sourceUsers:[sourceUser('member-a'),sourceUser('member-b')],destinationUsers:[sourceUser('preexisting')]});
 const batch=prepareManagementClosedAuthImport(f.input);
 const normalizedImported=batch.request.users.map(user=>({uid:user.localId,disabled:user.disabled,emailVerified:user.emailVerified,email:user.email,displayName:user.displayName,photoURL:user.photoUrl,providerData:user.providerUserInfo.map(p=>({providerId:p.providerId,uid:p.rawId,...(p.email?{email:p.email}:{}),...(p.displayName?{displayName:p.displayName}:{})}))}));
 const post=snapshot('sahmt-gestao-5ae66',[...f.destination.users,...normalizedImported]);
 const result=validateManagementClosedAuthImportPostcheck({batch,before:f.destination,after:post});
 assert.equal(result.status,'COMPLETE');
 assert.equal(result.importedCount,2);
 assert.equal(result.preservedExistingCount,1);
 assert.equal(result.afterSnapshotSha256,authSnapshotDigest(post));
 assert.throws(()=>validateManagementClosedAuthImportPostcheck({batch,before:f.destinationSnapshot,after:snapshot('sahmt-gestao-5ae66',[...normalizedImported])}),/AUTH_IMPORT_POSTCHECK_INVALID/);
});
