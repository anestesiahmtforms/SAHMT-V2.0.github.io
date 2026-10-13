import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareManagementClosedFcAuthImport,
  validateManagementClosedFcAuthImportResponse,
  validateManagementClosedFcAuthImportPostcheck,
  managementClosedFcAuthImportRequestDigest
} from '../scripts/lib/management-closed-fc-auth-import.js';
import {prepareAuthImportPlan, authSnapshotDigest, authRawSnapshotDigest, authSourceRecordDigest} from '../scripts/lib/management-auth-import-plan.js';

const sourceUser=(uid='member-a')=>({uid,disabled:false,emailVerified:true,email:`${uid}@example.invalid`,displayName:'Synthetic Member',photoURL:'https://example.invalid/photo.png',providerData:[{providerId:'google.com',uid:`google-${uid}`,email:`${uid}@example.invalid`,displayName:'Synthetic Member'}]});
const snapshot=(projectId,users=[])=>({schemaVersion:1,projectId,readTime:'2026-10-11T12:00:00.000Z',coverage:{complete:true,atomicSnapshot:false},users});
function fixture({sourceUsers=[sourceUser()],destinationUsers=[]}={}){
  const source=snapshot('sahmt-17a16',sourceUsers), destination=snapshot('indicadores---sahmt',destinationUsers);
  const identityMappings=sourceUsers.map(user=>({memberId:`stable-${user.uid}`,faUid:user.uid,fcUid:user.uid}));
  const plan=prepareAuthImportPlan(source,destination,identityMappings);
  const rawSourceUsers=sourceUsers.map(user=>({localId:user.uid,disabled:user.disabled,emailVerified:user.emailVerified,email:user.email,displayName:user.displayName,photoUrl:user.photoURL,
    providerUserInfo:user.providerData.map(provider=>({providerId:provider.providerId,rawId:provider.uid,email:provider.email,displayName:provider.displayName})),
    passwordHash:'SYNTHETIC-SECRET-HASH',salt:'SYNTHETIC-SECRET-SALT',customAttributes:'SYNTHETIC-CLAIMS'}));
  const input={sourceSnapshot:source,destinationSnapshot:destination,rawSourceUsers,identityMappings,planOptions:{},expectedPlanSha256:plan.resultSha256};
  return {source,destination,identityMappings,rawSourceUsers,input,plan};
}

test('prepara lote FC com UID original, somente campos permitidos e overwrite desativado',()=>{
  const f=fixture(), batch=prepareManagementClosedFcAuthImport(f.input);
  assert.equal(batch.destinationProjectId,'indicadores---sahmt');
  assert.equal(batch.kind,'CLOSED_GOOGLE_AUTH_IMPORT_FC_BATCH');
  assert.equal(batch.request.allowOverwrite,false);
  assert.equal(batch.request.sanityCheck,true);
  assert.equal(batch.request.hashAlgorithm,'BCRYPT');
  assert.deepEqual(batch.request.users,[{localId:'member-a',email:'member-a@example.invalid',emailVerified:true,displayName:'Synthetic Member',photoUrl:'https://example.invalid/photo.png',disabled:false,
    providerUserInfo:[{providerId:'google.com',rawId:'google-member-a',email:'member-a@example.invalid',displayName:'Synthetic Member'}]}]);
  assert.equal(batch.request.users[0].localId,f.source.users[0].uid);
  assert.equal(batch.previewOnly,true);
  assert.equal(batch.writeEnabled,false);
  assert.equal(batch.productionAuthorized,false);
  for(const secret of ['SYNTHETIC-SECRET-HASH','SYNTHETIC-SECRET-SALT','SYNTHETIC-CLAIMS']) assert.equal(JSON.stringify(batch).includes(secret),false);
  for(const key of ['passwordHash','passwordSalt','salt','customClaims','idToken','refreshToken']) assert.equal(JSON.stringify(batch).includes(key),false);
  assert.equal(managementClosedFcAuthImportRequestDigest(batch).length,64);
});

test('pré-provisiona em FC uma conta sem provedor para Custom Token, sem material credencial',()=>{
  const user={...sourceUser('providerless-fc'),emailVerified:false,providerData:[]};
  const source=snapshot('sahmt-17a16',[user]),destination=snapshot('indicadores---sahmt',[]);
  const identityMappings=[{memberId:'stable-providerless-fc',faUid:user.uid,fcUid:user.uid}];
  const rawSourceUsers=[{localId:user.uid,disabled:false,emailVerified:false,email:user.email,displayName:user.displayName,photoUrl:user.photoURL,providerUserInfo:[]}];
  const rawSnapshotSha256=authRawSnapshotDigest(rawSourceUsers);
  const planOptions={deferUnlinkedSource:true,requiredSourceUids:[],provisionCustomTokenOnlyUids:[user.uid],
    expectedRawSnapshotSha256:rawSnapshotSha256,unlinkedSourceEvidence:{schemaVersion:1,sourceSnapshotSha256:authSnapshotDigest(source),rawSnapshotSha256,
      entries:[{faUid:user.uid,sourceRecordSha256:authSourceRecordDigest(user),rawRecordSha256:authSourceRecordDigest(rawSourceUsers[0]),providerCount:0,
        passwordMaterialPresent:false,otherProviderIdentityPresent:false,disabled:false,emailVerified:false}]}};
  const plan=prepareAuthImportPlan(source,destination,identityMappings,planOptions);
  const batch=prepareManagementClosedFcAuthImport({sourceSnapshot:source,destinationSnapshot:destination,rawSourceUsers,identityMappings,
    planOptions,expectedPlanSha256:plan.resultSha256});
  assert.deepEqual(batch.request.users[0].providerUserInfo,[]);
  assert.equal(batch.request.users[0].localId,user.uid);
  assert.equal(plan.ready,false);
  assert.equal(plan.requiresFirstLoginLinkFlow,true);
  assert.equal(batch.request.allowOverwrite,false);
  for(const key of ['passwordHash','passwordSalt','salt','password','customClaims','SYNTHETIC-SECRET']) assert.equal(JSON.stringify(batch).includes(key),false);
});

test('equivalente existente é ignorado e não pode entrar no lote FC',()=>{
  const existing=sourceUser('already-there'), f=fixture({sourceUsers:[existing],destinationUsers:[existing]});
  assert.throws(()=>prepareManagementClosedFcAuthImport(f.input),/AUTH_IMPORT_BATCH_SIZE_OR_SELECTION_INVALID/);
});

test('recusa mapeamento de UID diferente e snapshots de outro destino',()=>{
  const f=fixture();
  assert.throws(()=>prepareManagementClosedFcAuthImport({...f.input,identityMappings:[{memberId:'stable-member-a',faUid:'member-a',fcUid:'different'}]}),/AUTH_IMPORT_PLAN_PIN_MISMATCH/);
  assert.throws(()=>prepareManagementClosedFcAuthImport({...f.input,destinationSnapshot:snapshot('sahmt-gestao-5ae66')}),/AUTH_IMPORT_PROJECT_MISMATCH/);
});

test('resultado parcial fica para reconciliação; nenhum dado privado sai no resumo',()=>{
  const f=fixture({sourceUsers:[sourceUser('a'),sourceUser('b')]});
  const batch=prepareManagementClosedFcAuthImport(f.input);
  const result=validateManagementClosedFcAuthImportResponse({batch,response:{successCount:1,failureCount:1,errors:[{index:1,error:{message:'private e-mail and server detail'}}]}});
  assert.deepEqual(result,{status:'PARTIAL_REQUIRES_REVIEW',requestedCount:2,successCount:1,failureCount:1,errorIndexes:[1]});
  assert.equal(JSON.stringify(result).includes('private'),false);
});

test('pós-conferência preserva contas anteriores e exige exatamente os registros planejados',()=>{
  const existing=sourceUser('keep-existing'), f=fixture({sourceUsers:[sourceUser('new-user')],destinationUsers:[existing]});
  const batch=prepareManagementClosedFcAuthImport(f.input);
  const imported=batch.request.users.map(user=>({uid:user.localId,email:user.email,displayName:user.displayName,photoURL:user.photoUrl,emailVerified:user.emailVerified,disabled:user.disabled,
    providerData:user.providerUserInfo.map(provider=>({providerId:provider.providerId,uid:provider.rawId,email:provider.email,displayName:provider.displayName}))}));
  const after=snapshot('indicadores---sahmt',[existing,...imported]);
  const result=validateManagementClosedFcAuthImportPostcheck({batch,before:f.destination,after});
  assert.deepEqual({status:result.status,importedCount:result.importedCount,preservedExistingCount:result.preservedExistingCount},
    {status:'COMPLETE',importedCount:1,preservedExistingCount:1});
  assert.equal(result.afterSnapshotSha256,authSnapshotDigest(after));
  assert.throws(()=>validateManagementClosedFcAuthImportPostcheck({batch,before:f.destination,after:snapshot('indicadores---sahmt',imported)}),/AUTH_IMPORT_POSTCHECK_INVALID/);
});
