import {authImportPlanDigest, authSnapshotDigest, prepareAuthImportPlan} from './management-auth-import-plan.js';

const FA='sahmt-17a16', FB='sahmt-gestao-5ae66', FC='indicadores---sahmt', MAX_BATCH=1000;
const TARGETS=Object.freeze({FB:Object.freeze({projectId:FB,uidField:'fbUid',kind:'CLOSED_GOOGLE_AUTH_IMPORT_BATCH'}),
  FC:Object.freeze({projectId:FC,uidField:'fcUid',kind:'CLOSED_GOOGLE_AUTH_IMPORT_FC_BATCH'})});
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha256=value=>authSnapshotDigest(value);
const demand=(condition,code)=>{if(!condition)throw new Error(code);};
const string=(value,max=4096)=>typeof value==='string'&&value.length>0&&value.length<=max;
const uid=value=>string(value,128)&&!/[\s/\x00-\x1f]/.test(value);
const optional=(source,target,key)=>{if(source[key]!==undefined)target[key]=source[key];};

function normalizeRawUser(raw){
  demand(isObject(raw)&&uid(raw.localId),'AUTH_IMPORT_RAW_USER_INVALID');
  demand((raw.disabled===undefined||typeof raw.disabled==='boolean')&&(raw.emailVerified===undefined||typeof raw.emailVerified==='boolean'),'AUTH_IMPORT_RAW_STATUS_INVALID');
  const rawProviders=raw.providerUserInfo??[];
  demand(Array.isArray(rawProviders),'AUTH_IMPORT_RAW_PROVIDERS_INVALID');
  const row={uid:raw.localId,disabled:raw.disabled===true,emailVerified:raw.emailVerified===true};
  optional(raw,row,'email'); optional(raw,row,'displayName');
  if(raw.photoUrl!==undefined)row.photoURL=raw.photoUrl;
  row.providerData=rawProviders.map(provider=>{
    demand(isObject(provider)&&string(provider.providerId)&&uid(provider.rawId),'AUTH_IMPORT_RAW_PROVIDER_INVALID');
    const normalized={providerId:provider.providerId,uid:provider.rawId};
    optional(provider,normalized,'email'); optional(provider,normalized,'displayName');
    if(provider.photoUrl!==undefined)normalized.photoURL=provider.photoUrl;
    return normalized;
  });
  return row;
}

function restUser(record){
  demand(isObject(record)&&uid(record.uid)&&record.disabled===false||isObject(record)&&uid(record.uid)&&record.disabled===true,'AUTH_IMPORT_PLAN_RECORD_INVALID');
  demand(typeof record.emailVerified==='boolean'&&Array.isArray(record.providerData),'AUTH_IMPORT_PLAN_RECORD_INVALID');
  demand(record.providerData.length===0||record.providerData.length===1&&record.providerData[0]?.providerId==='google.com'&&uid(record.providerData[0].uid),'AUTH_IMPORT_PLAN_RECORD_PROVIDER_NOT_ALLOWED');
  const provider=record.providerData[0];
  const result={localId:record.uid,emailVerified:record.emailVerified,disabled:record.disabled,providerUserInfo:provider?[{providerId:'google.com',rawId:provider.uid}]:[]};
  for(const key of ['email','displayName']){if(record[key]!==undefined)result[key]=record[key];if(provider?.[key]!==undefined)result.providerUserInfo[0][key]=provider[key];}
  if(record.photoURL!==undefined)result.photoUrl=record.photoURL;
  if(provider?.photoURL!==undefined)result.providerUserInfo[0].photoUrl=provider.photoURL;
  return result;
}

function targetForBatch(batch){
  return Object.values(TARGETS).find(target=>target.kind===batch?.kind&&target.projectId===batch?.destinationProjectId)||null;
}

export function prepareManagementClosedAuthImportForDestination({sourceSnapshot,destinationSnapshot,rawSourceUsers,identityMappings,planOptions={},expectedPlanSha256},destinationAlias){
  const target=TARGETS[destinationAlias];
  demand(target&&isObject(sourceSnapshot)&&sourceSnapshot.projectId===FA&&isObject(destinationSnapshot)&&destinationSnapshot.projectId===target.projectId,'AUTH_IMPORT_PROJECT_MISMATCH');
  demand(Array.isArray(rawSourceUsers)&&rawSourceUsers.length===sourceSnapshot.users?.length,'AUTH_IMPORT_RAW_SOURCE_COVERAGE_INVALID');
  demand(Array.isArray(identityMappings)&&isObject(planOptions),'AUTH_IMPORT_PLAN_INPUT_INVALID');
  demand(string(expectedPlanSha256,64)&&/^[a-f0-9]{64}$/.test(expectedPlanSha256),'AUTH_IMPORT_PLAN_PIN_INVALID');
  const rawByUid=new Map();
  for(const raw of rawSourceUsers){const normalized=normalizeRawUser(raw);demand(!rawByUid.has(normalized.uid),'AUTH_IMPORT_RAW_UID_DUPLICATE');rawByUid.set(normalized.uid,{raw,normalized});}
  demand(rawByUid.size===sourceSnapshot.users.length,'AUTH_IMPORT_RAW_SOURCE_COVERAGE_INVALID');
  for(const normalized of sourceSnapshot.users){const pair=rawByUid.get(normalized?.uid);demand(pair&&sha256(pair.normalized)===sha256(normalized),'AUTH_IMPORT_RAW_IDENTITY_MISMATCH');}
  const plan=prepareAuthImportPlan(sourceSnapshot,destinationSnapshot,identityMappings,planOptions);
  demand(plan.resultSha256===authImportPlanDigest(plan)&&plan.resultSha256===expectedPlanSha256,'AUTH_IMPORT_PLAN_PIN_MISMATCH');
  demand(plan.selectedImportReady===true&&plan.conflicts.length===0&&plan.counts.blockingIssues===0,'AUTH_IMPORT_PLAN_NOT_READY');
  demand(plan.importRecords.length>0&&plan.importRecords.length<=MAX_BATCH&&plan.importRecords.length===plan.counts.create,'AUTH_IMPORT_BATCH_SIZE_OR_SELECTION_INVALID');
  const users=plan.importRecords.map(record=>{
    const source=rawByUid.get(record.uid)?.normalized;
    demand(source&&sha256(source)===sha256(record),'AUTH_IMPORT_RAW_IDENTITY_MISMATCH');
    const entry=plan.entries.find(row=>row.faUid===record.uid);
    demand(source.providerData.length===1&&source.providerData[0].providerId==='google.com'
      || source.providerData.length===0&&entry?.action==='CREATE_CUSTOM_TOKEN_ONLY','AUTH_IMPORT_RAW_IDENTITY_MISMATCH');
    return restUser(record);
  });
  demand(new Set(users.map(user=>user.localId)).size===users.length,'AUTH_IMPORT_BATCH_UID_DUPLICATE');
  // The REST batchCreate schema requires an algorithm selector. BCRYPT has no
  // auxiliary parameters; passwordHash/passwordSalt are never copied or sent.
  const request={hashAlgorithm:'BCRYPT',sanityCheck:true,allowOverwrite:false,users};
  return {
    schemaVersion:1,kind:target.kind,sourceProjectId:FA,destinationProjectId:target.projectId,
    sourceReadTime:sourceSnapshot.readTime,destinationReadTime:destinationSnapshot.readTime,
    sourceSnapshotSha256:sha256(sourceSnapshot),destinationSnapshotSha256:sha256(destinationSnapshot),
    planSha256:plan.resultSha256,recomputedPlanSha256:plan.resultSha256,recordCount:users.length,request,
    requestSha256:sha256(request),previewOnly:true,productionAuthorized:false,writeEnabled:false
  };
}

export function prepareManagementClosedAuthImport(input){
  return prepareManagementClosedAuthImportForDestination(input,'FB');
}

export function prepareManagementClosedFcAuthImport(input){
  return prepareManagementClosedAuthImportForDestination(input,'FC');
}

export function validateManagementClosedAuthImportResponse({batch,response}){
  demand(isObject(batch)&&targetForBatch(batch)&&Number.isInteger(batch.recordCount)&&batch.recordCount>0,'AUTH_IMPORT_BATCH_INVALID');
  demand(isObject(response)&&Number.isInteger(response.successCount)&&Number.isInteger(response.failureCount)&&Array.isArray(response.errors),'AUTH_IMPORT_RESPONSE_INVALID');
  demand(response.successCount>=0&&response.failureCount>=0&&response.successCount+response.failureCount===batch.recordCount&&response.errors.length===response.failureCount,'AUTH_IMPORT_RESPONSE_INVALID');
  const errorIndexes=response.errors.map(error=>error?.index);
  demand(errorIndexes.every(index=>Number.isInteger(index)&&index>=0&&index<batch.recordCount)&&new Set(errorIndexes).size===errorIndexes.length,'AUTH_IMPORT_RESPONSE_INVALID');
  return {status:response.failureCount===0?'COMPLETE':'PARTIAL_REQUIRES_REVIEW',requestedCount:batch.recordCount,successCount:response.successCount,failureCount:response.failureCount,errorIndexes:[...errorIndexes].sort((a,b)=>a-b)};
}

export function validateManagementClosedAuthImportPostcheck({batch,before,after}){
  const target=targetForBatch(batch);
  demand(isObject(batch)&&target&&isObject(before)&&isObject(after)
    &&before.schemaVersion===1&&before.projectId===target.projectId&&before.coverage?.complete===true&&Array.isArray(before.users)
    &&after.schemaVersion===1&&after.projectId===target.projectId&&after.coverage?.complete===true&&Array.isArray(after.users)
    &&sha256(before)===batch.destinationSnapshotSha256,'AUTH_IMPORT_POSTCHECK_INVALID');
  const requested=batch.request?.users;
  demand(Array.isArray(requested)&&requested.length===batch.recordCount&&new Set(requested.map(row=>row?.localId)).size===requested.length,'AUTH_IMPORT_POSTCHECK_INVALID');
  const beforeByUid=new Map();
  for(const user of before.users){demand(uid(user?.uid)&&!beforeByUid.has(user.uid),'AUTH_IMPORT_POSTCHECK_INVALID');beforeByUid.set(user.uid,user);}
  for(const user of requested)demand(!beforeByUid.has(user.localId),'AUTH_IMPORT_POSTCHECK_INVALID');
  const expected=new Map(beforeByUid);
  for(const row of requested){
    const normalized=normalizeRawUser(row);
    expected.set(row.localId,normalized);
  }
  const afterByUid=new Map();
  for(const user of after.users){demand(uid(user?.uid)&&!afterByUid.has(user.uid),'AUTH_IMPORT_POSTCHECK_INVALID');afterByUid.set(user.uid,user);}
  demand(afterByUid.size===expected.size,'AUTH_IMPORT_POSTCHECK_INVALID');
  for(const [id,user] of expected)demand(afterByUid.has(id)&&sha256(afterByUid.get(id))===sha256(user),'AUTH_IMPORT_POSTCHECK_INVALID');
  return {status:'COMPLETE',importedCount:requested.length,preservedExistingCount:before.users.length,afterSnapshotSha256:sha256(after)};
}

export function managementClosedAuthImportRequestDigest(batch){
  demand(isObject(batch)&&targetForBatch(batch),'AUTH_IMPORT_BATCH_INVALID');
  return sha256({kind:batch.kind,destinationProjectId:batch.destinationProjectId,request:batch.request});
}
