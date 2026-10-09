import {createHash} from 'node:crypto';
import {snapshotDigest, documentDigest, validateSplitSnapshot} from './management-split-plan.js';
import {authSnapshotDigest, authSourceRecordDigest, authRawSnapshotDigest} from './management-auth-import-plan.js';
import {validateManagementMigrationExecution} from './management-migration-executor.js';

const FA='sahmt-17a16', FB='sahmt-gestao-5ae66';
const SHA=/^[a-f0-9]{64}$/, ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const digest=v=>createHash('sha256').update(v).digest('hex');
export const MANAGEMENT_MIGRATION_DESTINATION_ROOTS=Object.freeze([
  'managementAreas','activities','activityInteractions','activityScoreReviews','indicators','indicatorMeasurements',
  'actionPlans','actionPlanItems','documents','scopedDocuments','equipment','equipmentEvents','maintenanceRecords',
  'scoringRules','scores','learningActivities','learningActivityReceipts','trainings','trainingProgress','trainingReceipts',
  'trainingCompletions','evaluationActivities','evaluationFormConfigs','evaluationLinks','evaluationParticipations',
  'evaluationAssignments','evaluationAssignmentHistory','evaluationGovernanceRevisions','evaluationRequests',
  'evaluationAwards','evaluationLedger','auditLogs','evaluationSummaries','evaluationReference','evaluationRuntime',
  'users','roles','contacts','eventMembers','accessRequests','appConfig','documentAccessEmails',
  'evaluationChecklistTransfers','migrationOrigins'
]);
const SOURCE_ROOTS=MANAGEMENT_MIGRATION_DESTINATION_ROOTS.filter(v=>v!=='migrationOrigins');
const METHOD={APPS_SCRIPT_NATIVE:'NATIVE_READ_ONLY_STATUS',PWA_BROWSER:'PUBLISHED_CLIENT_SOURCE_REVIEW',
  CLOUD_FUNCTIONS:'ADMIN_FUNCTIONS_INVENTORY',BROKER_SERVER:'HOST_CONFIGURATION_REVIEW'};
class ContextError extends Error { constructor(code,gates=[{code}]) {super(code);this.code=code;this.gates=gates;} }
const demand=(ok,code)=>{if(!ok)throw new ContextError(code);};
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const equalSet=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&new Set(a).size===a.length
  &&new Set(b).size===b.length&&a.length===b.length&&a.every(v=>b.includes(v));

function copyJson(value) {
  let nodes=0,characters=0;
  const visit=(v,depth)=>{
    demand(++nodes<=2000000&&depth<=120,'MIGRATION_CONTEXT_INPUT_LIMIT');
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='string'){characters+=v.length;demand(characters<=96*1024*1024,'MIGRATION_CONTEXT_INPUT_LIMIT');return v;}
    if(typeof v==='number'){demand(Number.isFinite(v),'MIGRATION_CONTEXT_INPUT_INVALID');return v;}
    demand(Array.isArray(v)||plain(v),'MIGRATION_CONTEXT_INPUT_INVALID');
    const keys=Reflect.ownKeys(v);
    if(Array.isArray(v)) {
      demand(keys.length===v.length+1&&keys.every(k=>k==='length'||typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)), 'MIGRATION_CONTEXT_INPUT_INVALID');
      return Array.from({length:v.length},(_,i)=>{
        const d=Object.getOwnPropertyDescriptor(v,String(i));demand(d?.enumerable&&Object.hasOwn(d,'value'),'MIGRATION_CONTEXT_INPUT_INVALID');
        return visit(d.value,depth+1);
      });
    }
    const result=Object.create(null);
    for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);demand(typeof k==='string'&&d.enumerable&&Object.hasOwn(d,'value'),'MIGRATION_CONTEXT_INPUT_INVALID');characters+=k.length;result[k]=visit(d.value,depth+1);}
    return result;
  };
  try{return visit(value,0);}catch(error){if(error instanceof ContextError)throw error;throw new ContextError('MIGRATION_CONTEXT_INPUT_INVALID');}
}
function time(value) {
  demand(typeof value==='string','MIGRATION_CONTEXT_TIME_INVALID');
  const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
  demand(m&&Number(value.slice(0,4))>=1,'MIGRATION_CONTEXT_TIME_INVALID');
  const ms=Date.parse(m[1]+'Z');demand(Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,19)===m[1],'MIGRATION_CONTEXT_TIME_INVALID');
  return BigInt(ms)*1000000n+BigInt((m[2]||'').padEnd(9,'0'));
}
function fresh(value,nowMs,code) {const ns=time(value),current=BigInt(nowMs)*1000000n;demand(ns<=current&&current-ns<=300000000000n,code);return value;}
function pin(pins,key,value) {demand(SHA.test(pins?.[key]||'')&&pins[key]===value,'MIGRATION_CONTEXT_EVIDENCE_PIN_MISMATCH');}
function validateCapture(snapshot,project,roots,nowMs) {
  demand(plain(snapshot)&&snapshot.projectId===project&&snapshot.databaseId==='(default)','MIGRATION_CONTEXT_CAPTURE_SCOPE_INVALID');
  try{validateSplitSnapshot(snapshot);}catch{throw new ContextError('MIGRATION_CONTEXT_CAPTURE_INVALID_OR_INCOMPLETE');}
  demand(equalSet(snapshot.coverage.rootCollections,roots),'MIGRATION_CONTEXT_CAPTURE_ROOTS_CHANGED');
  return fresh(snapshot.readTime,nowMs,'MIGRATION_CONTEXT_CAPTURE_STALE');
}
function identicalDocuments(previous,current,code) {
  demand(previous.documents.length===current.documents.length,code);
  const byPath=new Map(previous.documents.map(d=>[d.path,documentDigest(d)]));
  demand(current.documents.every(d=>byPath.has(d.path)&&byPath.get(d.path)===documentDigest(d)),code);
}
function normalizeRaw(row) {
  demand(plain(row)&&typeof row.localId==='string','MIGRATION_CONTEXT_RAW_AUTH_INVALID');
  demand(row.providerUserInfo===undefined||Array.isArray(row.providerUserInfo),'MIGRATION_CONTEXT_RAW_AUTH_INVALID');
  return {uid:row.localId,disabled:row.disabled===true,emailVerified:row.emailVerified===true,
    ...Object.fromEntries(['email','displayName'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]])),
    ...(row.photoUrl!==undefined?{photoURL:row.photoUrl}:{}),
    providerData:(row.providerUserInfo||[]).map(p=>({providerId:p.providerId,uid:p.rawId,
      ...Object.fromEntries(['email','displayName'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]])),
      ...(p.photoUrl!==undefined?{photoURL:p.photoUrl}:{})}))};
}
function authIndex(snapshot,raw,project) {
  demand(plain(snapshot)&&snapshot.schemaVersion===1&&snapshot.projectId===project&&snapshot.coverage?.complete===true
    &&Array.isArray(snapshot.users)&&snapshot.users.length<=50000,'MIGRATION_CONTEXT_AUTH_CAPTURE_INCOMPLETE');
  time(snapshot.readTime);
  demand(Array.isArray(raw)&&raw.length===snapshot.users.length,'MIGRATION_CONTEXT_RAW_AUTH_REQUIRED');
  const users=new Map(),google=new Map(),emails=new Map(),rawByUid=new Map();
  for(const row of raw){demand(plain(row)&&typeof row.localId==='string'&&!rawByUid.has(row.localId),'MIGRATION_CONTEXT_RAW_AUTH_AMBIGUOUS');rawByUid.set(row.localId,row);}
  for(const user of snapshot.users){
    demand(plain(user)&&typeof user.uid==='string'&&user.uid.length>0&&user.uid.length<=128&&!/[\s/\x00-\x1f]/.test(user.uid)
      &&!users.has(user.uid)&&typeof user.disabled==='boolean'&&typeof user.emailVerified==='boolean'
      &&Array.isArray(user.providerData)&&user.providerData.length<=1,'MIGRATION_CONTEXT_AUTH_AMBIGUOUS');
    demand(Object.keys(user).every(k=>['uid','disabled','emailVerified','email','displayName','photoURL','providerData'].includes(k)), 'MIGRATION_CONTEXT_AUTH_RECORD_INVALID');
    demand(rawByUid.has(user.uid)&&authSourceRecordDigest(normalizeRaw(rawByUid.get(user.uid)))===authSourceRecordDigest(user),'MIGRATION_CONTEXT_RAW_AUTH_NORMALIZATION_MISMATCH');
    if(user.email!==undefined){demand(typeof user.email==='string'&&/^[^@\s]+@[^@\s]+$/.test(user.email),'MIGRATION_CONTEXT_AUTH_RECORD_INVALID');const email=user.email.toLowerCase();demand(!emails.has(email),'MIGRATION_CONTEXT_AUTH_EMAIL_COLLISION');emails.set(email,user.uid);}
    if(user.providerData.length){const p=user.providerData[0];demand(plain(p)&&p.providerId==='google.com'&&typeof p.uid==='string'&&p.uid.length>0&&p.uid.length<=128
      &&!/[\s/\x00-\x1f]/.test(p.uid)&&!google.has(p.uid),'MIGRATION_CONTEXT_AUTH_GOOGLE_AMBIGUOUS');
      demand(Object.keys(p).every(k=>['providerId','uid','email','displayName','photoURL'].includes(k)),'MIGRATION_CONTEXT_AUTH_RECORD_INVALID');
      demand(user.disabled===false&&user.emailVerified===true&&typeof user.email==='string'&&typeof p.email==='string'
        &&p.email.toLowerCase()===user.email.toLowerCase(),'MIGRATION_CONTEXT_AUTH_GOOGLE_NOT_CURRENT_ENABLED');google.set(p.uid,user.uid);
    }else demand(user.disabled===false&&user.emailVerified===false,'MIGRATION_CONTEXT_AUTH_DEFER_STATUS_CHANGED');
    users.set(user.uid,user);
  }
  return {users,google,rawByUid};
}
function compareAuth(previous,current,previousRaw,currentRaw,project,nowMs) {
  const a=authIndex(previous,previousRaw,project),b=authIndex(current,currentRaw,project);
  fresh(current.readTime,nowMs,'MIGRATION_CONTEXT_AUTH_STALE');
  demand(time(current.readTime)>=time(previous.readTime),'MIGRATION_CONTEXT_AUTH_CAPTURE_ORDER_INVALID');
  demand(a.users.size===b.users.size&&[...a.users].every(([uid,row])=>b.users.has(uid)
    &&authSourceRecordDigest(row)===authSourceRecordDigest(b.users.get(uid))
    &&authSourceRecordDigest(a.rawByUid.get(uid))===authSourceRecordDigest(b.rawByUid.get(uid))),
  'MIGRATION_CONTEXT_AUTH_CHANGED_SINCE_REVIEW');
  return b;
}
function denyAllRules(source) {
  demand(Array.isArray(source)&&source.length===1&&plain(source[0])&&typeof source[0].name==='string'
    &&typeof source[0].content==='string'&&source[0].content.length<=100000,'MIGRATION_CONTEXT_DESTINATION_RULES_REQUIRED');
  const normalized=source[0].content.replace(/^\uFEFF/,'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\r\n]*/g,'').replace(/\s+/g,'');
  demand(/^rules_version=['"]2['"];servicecloud\.firestore\{match\/databases\/\{[A-Za-z_][A-Za-z0-9_]*\}\/documents\{match\/\{[A-Za-z_][A-Za-z0-9_]*=\*\*\}\{allowread,write:iffalse;\}\}\}$/.test(normalized),
    'MIGRATION_CONTEXT_DESTINATION_CLIENT_ACCESS_NOT_DENIED');
}

/** Validate actual packets from a trusted collector. Hashes are integrity pins, not authority. */
export function buildManagementMigrationContext(input) {
  const value=copyJson(input),{sourceSnapshot,manifest,destinationSnapshot,plan,approval,evidence,nowMs}=value;
  demand(Number.isSafeInteger(nowMs)&&nowMs>=0,'MIGRATION_CONTEXT_CLOCK_INVALID');
  demand(plain(evidence)&&evidence.schemaVersion===1&&evidence.mode==='CURRENT_MANAGEMENT_MIGRATION_EVIDENCE'
    &&plain(evidence.pins),'MIGRATION_CONTEXT_EVIDENCE_REQUIRED');
  const failures=[],facts={},observed=[];
  const gate=(name,fn)=>{try{facts[name]=fn();}catch(error){failures.push({gate:name,code:error instanceof ContextError?error.code:'MIGRATION_CONTEXT_'+name+'_INVALID'});}};
  gate('PLAN_APPROVAL',()=>validateManagementMigrationExecution({sourceSnapshot,manifest,destinationSnapshot,plan,approval,nowMs}));
  gate('SOURCE_CAPTURE',()=>{
    validateSplitSnapshot(sourceSnapshot);demand(sourceSnapshot.projectId===FA&&equalSet(sourceSnapshot.coverage.rootCollections,SOURCE_ROOTS),'MIGRATION_CONTEXT_SOURCE_REVIEW_SCOPE_INVALID');
    observed.push(validateCapture(evidence.currentSourceSnapshot,FA,SOURCE_ROOTS,nowMs));
    pin(evidence.pins,'currentSourceSnapshotSha256',snapshotDigest(evidence.currentSourceSnapshot));
    demand(time(evidence.currentSourceSnapshot.readTime)>=time(sourceSnapshot.readTime),'MIGRATION_CONTEXT_SOURCE_CAPTURE_ORDER_INVALID');
    identicalDocuments(sourceSnapshot,evidence.currentSourceSnapshot,'MIGRATION_CONTEXT_SOURCE_CHANGED_SINCE_BACKUP');return true;
  });
  gate('DESTINATION_CAPTURE',()=>{
    validateSplitSnapshot(destinationSnapshot);demand(destinationSnapshot.projectId===FB&&equalSet(destinationSnapshot.coverage.rootCollections,MANAGEMENT_MIGRATION_DESTINATION_ROOTS),'MIGRATION_CONTEXT_DESTINATION_REVIEW_SCOPE_INVALID');
    observed.push(validateCapture(evidence.currentDestinationSnapshot,FB,MANAGEMENT_MIGRATION_DESTINATION_ROOTS,nowMs));
    pin(evidence.pins,'currentDestinationSnapshotSha256',snapshotDigest(evidence.currentDestinationSnapshot));
    demand(time(evidence.currentDestinationSnapshot.readTime)>=time(destinationSnapshot.readTime),'MIGRATION_CONTEXT_DESTINATION_CAPTURE_ORDER_INVALID');
    identicalDocuments(destinationSnapshot,evidence.currentDestinationSnapshot,'MIGRATION_CONTEXT_DESTINATION_CHANGED_SINCE_PLAN');return true;
  });
  gate('SOURCE_AUTH',()=>{
    for(const [k,snapshot]of [['previousSourceAuthSha256',evidence.previousSourceAuth],['currentSourceAuthSha256',evidence.currentSourceAuth]])pin(evidence.pins,k,authSnapshotDigest(snapshot));
    for(const [k,rows]of [['previousSourceAuthRawSha256',evidence.previousSourceAuthRawUsers],['currentSourceAuthRawSha256',evidence.currentSourceAuthRawUsers]])pin(evidence.pins,k,authRawSnapshotDigest(rows));
    const index=compareAuth(evidence.previousSourceAuth,evidence.currentSourceAuth,evidence.previousSourceAuthRawUsers,evidence.currentSourceAuthRawUsers,FA,nowMs);observed.push(evidence.currentSourceAuth.readTime);return index;
  });
  gate('DESTINATION_AUTH',()=>{
    for(const [k,snapshot]of [['previousDestinationAuthSha256',evidence.previousDestinationAuth],['currentDestinationAuthSha256',evidence.currentDestinationAuth]])pin(evidence.pins,k,authSnapshotDigest(snapshot));
    for(const [k,rows]of [['previousDestinationAuthRawSha256',evidence.previousDestinationAuthRawUsers],['currentDestinationAuthRawSha256',evidence.currentDestinationAuthRawUsers]])pin(evidence.pins,k,authRawSnapshotDigest(rows));
    const index=compareAuth(evidence.previousDestinationAuth,evidence.currentDestinationAuth,evidence.previousDestinationAuthRawUsers,evidence.currentDestinationAuthRawUsers,FB,nowMs);observed.push(evidence.currentDestinationAuth.readTime);return index;
  });
  gate('ACL_IDENTITY',()=>{
    demand(facts.PLAN_APPROVAL&&facts.SOURCE_CAPTURE&&facts.SOURCE_AUTH&&facts.DESTINATION_AUTH,'MIGRATION_CONTEXT_IDENTITY_DEPENDENCY_UNVERIFIED');
    const acls=sourceSnapshot.documents.filter(d=>d.path.split('/')[0]==='documentAccessEmails');
    demand(acls.length>0&&snapshotDigest(acls)===approval.pins.aclSha256,'MIGRATION_CONTEXT_ACL_PIN_MISMATCH');
    const mappings=new Map(manifest.identityMappings.map(m=>[m.faUid,m]));
    const profiles=new Map(sourceSnapshot.documents.filter(d=>d.path.split('/')[0]==='users').map(d=>[d.path,d]));
    demand(mappings.size===profiles.size&&mappings.size===facts.SOURCE_AUTH.users.size,'MIGRATION_CONTEXT_MEMBER_SET_UNRECONCILED');
    for(const mapping of mappings.values()){
      const profile=profiles.get('users/'+mapping.faUid);
      demand(profile&&profile.fields.uid?.stringValue===mapping.faUid&&typeof profile.fields.active?.booleanValue==='boolean'
        &&typeof profile.fields.access?.booleanValue==='boolean'&&plain(profile.fields.permissions?.mapValue?.fields), 'MIGRATION_CONTEXT_PROFILE_UNRECONCILED');
      demand(profile.fields.memberId===undefined||profile.fields.memberId.stringValue===mapping.memberId,'MIGRATION_CONTEXT_PROFILE_MEMBER_CHANGED');
      demand(facts.SOURCE_AUTH.users.has(mapping.faUid),'MIGRATION_CONTEXT_SOURCE_AUTH_MEMBER_MISSING');
    }
    const required=new Set(),docs=new Map(sourceSnapshot.documents.map(d=>[d.path,d]));
    const visit=(v,key='')=>{
      if(!plain(v))return;
      if((key==='uid'||key.endsWith('Uid')||['createdBy','updatedBy'].includes(key))&&typeof v.stringValue==='string'&&mappings.has(v.stringValue))required.add(v.stringValue);
      if(key.endsWith('Uids'))for(const item of v.arrayValue?.values||[])if(mappings.has(item.stringValue))required.add(item.stringValue);
      for(const [child,item]of Object.entries(v.mapValue?.fields||{}))visit(item,child);
      for(const item of v.arrayValue?.values||[])visit(item);
    };
    for(const entry of manifest.entries.filter(e=>e.action==='COPY'))for(const [key,v]of Object.entries(docs.get(entry.path).fields))visit(v,key);
    for(const uid of required)demand(facts.SOURCE_AUTH.users.get(uid)?.providerData.length===1,'MIGRATION_CONTEXT_COPY_IDENTITY_GOOGLE_REQUIRED');
    for(const user of facts.DESTINATION_AUTH.users.values()){
      const source=facts.SOURCE_AUTH.users.get(user.uid);
      demand(mappings.has(user.uid)&&source?.providerData.length===1&&user.providerData.length===1
        &&user.providerData[0].uid===source.providerData[0].uid,'MIGRATION_CONTEXT_DESTINATION_AUTH_BINDING_CHANGED');
    }
    return {mappings:mappings.size,knownGoogle: facts.SOURCE_AUTH.google.size,deferred: facts.SOURCE_AUTH.users.size-facts.SOURCE_AUTH.google.size,
      copyReferencedGoogle:required.size,archivedAttributionFields:(manifest.historicalAttributions||[]).length};
  });
  gate('DESTINATION_METADATA_RULES',()=>{
    const meta=evidence.destinationMetadata,rules=evidence.destinationRules;
    demand(plain(meta)&&meta.schemaVersion===1&&meta.mode==='READ_ONLY_METADATA'&&meta.projectId===FB,'MIGRATION_CONTEXT_DESTINATION_METADATA_REQUIRED');
    observed.push(fresh(meta.verifiedAt,nowMs,'MIGRATION_CONTEXT_DESTINATION_METADATA_STALE'));
    pin(evidence.pins,'destinationMetadataSha256',snapshotDigest(meta));pin(evidence.pins,'destinationRulesSha256',snapshotDigest(rules));
    demand(['project','database','billing','iam','auth','google','rules'].every(k=>meta.checks?.[k]?.status==='VERIFIED'&&SHA.test(meta.checks[k].responseSha256||'')),'MIGRATION_CONTEXT_DESTINATION_METADATA_PARTIAL');
    demand(meta.projectMatches===true&&meta.principalMatched===true&&meta.expectedPrincipalIsOwner===true,'MIGRATION_CONTEXT_DESTINATION_PRINCIPAL_UNVERIFIED');
    demand(meta.billingEnabled===false&&meta.database?.name===`projects/${FB}/databases/(default)`
      &&meta.database.locationId==='southamerica-east1'&&meta.database.type==='FIRESTORE_NATIVE'
      &&meta.database.edition==='STANDARD','MIGRATION_CONTEXT_DESTINATION_DATABASE_OR_BILLING_CHANGED');
    demand(meta.googleEnabled===true&&meta.authorizedDomains?.includes('anestesiahmtforms.github.io'),'MIGRATION_CONTEXT_DESTINATION_AUTH_CONFIG_CHANGED');
    demand(plain(rules)&&rules.projectId===FB&&rules.release?.name===`projects/${FB}/releases/cloud.firestore`
      &&typeof rules.release.rulesetName==='string'&&rules.release.rulesetName.startsWith(`projects/${FB}/rulesets/`)
      &&meta.publishedRules?.rulesetName===rules.release.rulesetName&&meta.publishedRules.updateTime===rules.release.updateTime,
    'MIGRATION_CONTEXT_DESTINATION_RULESET_CHANGED');
    denyAllRules(rules.source);
    demand(Array.isArray(meta.publishedRules.files)&&meta.publishedRules.files.length===1
      &&meta.publishedRules.files[0].name===rules.source[0].name&&meta.publishedRules.files[0].sha256===digest(rules.source[0].content),
    'MIGRATION_CONTEXT_DESTINATION_RULE_SOURCE_CHANGED');return true;
  });
  gate('PRODUCER_INVENTORY',()=>{
    const registry=evidence.configuredProducerRegistry,inventory=evidence.producerInventory;
    demand(plain(registry)&&registry.schemaVersion===1&&registry.scope==='CONFIGURED_PRODUCERS_ONLY'
      &&registry.sourceProjectId===FA&&registry.destinationProjectId===FB&&Array.isArray(registry.producers)
      &&registry.producers.length>=3&&registry.producers.length<=1000,'MIGRATION_CONTEXT_CONFIGURED_PRODUCER_REGISTRY_REQUIRED');
    pin(evidence.pins,'producerRegistrySha256',snapshotDigest(registry));
    demand(plain(inventory)&&inventory.schemaVersion===1&&inventory.scope==='CONFIGURED_PRODUCERS_ONLY'
      &&inventory.sourceProjectId===FA&&inventory.destinationProjectId===FB
      &&inventory.registrySha256===snapshotDigest(registry)&&Array.isArray(inventory.observations), 'MIGRATION_CONTEXT_PRODUCER_OBSERVATIONS_REQUIRED');
    pin(evidence.pins,'producerInventorySha256',snapshotDigest(inventory));
    observed.push(fresh(inventory.observedAt,nowMs,'MIGRATION_CONTEXT_PRODUCER_OBSERVATIONS_STALE'));
    const registered=new Map();
    for(const producer of registry.producers){demand(exact(producer,['producerId','kind','ownerProjectId','configurationSha256'])
      &&ID.test(producer.producerId||'')&&Object.hasOwn(METHOD,producer.kind)&&[FA,FB].includes(producer.ownerProjectId)
      &&SHA.test(producer.configurationSha256||'')&&!registered.has(producer.producerId),'MIGRATION_CONTEXT_PRODUCER_REGISTRY_AMBIGUOUS');registered.set(producer.producerId,producer);}
    demand(['APPS_SCRIPT_NATIVE','PWA_BROWSER','CLOUD_FUNCTIONS'].every(kind=>registry.producers.some(p=>p.kind===kind)), 'MIGRATION_CONTEXT_PRODUCER_SURFACE_NOT_INVENTORIED');
    const seen=new Set();
    for(const row of inventory.observations){
      const producer=registered.get(row.producerId);
      demand(producer&&!seen.has(row.producerId)&&row.kind===producer.kind&&row.projectId===producer.ownerProjectId
        &&row.configurationSha256===producer.configurationSha256&&row.observationMethod===METHOD[row.kind]
        &&ID.test(row.observationId||''),'MIGRATION_CONTEXT_PRODUCER_OBSERVATION_UNBOUND');
      observed.push(fresh(row.observedAt,nowMs,'MIGRATION_CONTEXT_PRODUCER_OBSERVATIONS_STALE'));
      demand(Array.isArray(row.writeProjectIds)&&new Set(row.writeProjectIds).size===row.writeProjectIds.length
        &&row.writeProjectIds.every(id=>id===FA)&&['STOPPED','RUNNING_FA_ONLY'].includes(row.writerState)
        &&Array.isArray(row.nativeJobs)&&row.nativeJobs.length<=1000,'MIGRATION_CONTEXT_DESTINATION_WRITERS_NOT_STOPPED');
      const jobs=new Set();
      for(const job of row.nativeJobs){demand(exact(job,['jobId','handler','projectId','enabled'])&&ID.test(job.jobId||'')
        &&ID.test(job.handler||'')&&job.projectId===FA&&typeof job.enabled==='boolean'&&!jobs.has(job.jobId), 'MIGRATION_CONTEXT_DESTINATION_NATIVE_JOB_PRESENT_OR_UNKNOWN');jobs.add(job.jobId);}
      demand(row.writerState==='RUNNING_FA_ONLY'?row.writeProjectIds.length===1:
        row.writeProjectIds.length===0&&row.nativeJobs.every(j=>j.enabled===false),'MIGRATION_CONTEXT_PRODUCER_STATE_INCOHERENT');
      seen.add(row.producerId);
    }
    demand(seen.size===registered.size,'MIGRATION_CONTEXT_PRODUCER_OBSERVATION_MISSING');return {count:registered.size};
  });
  if(failures.length)throw new ContextError(failures[0].code,failures);
  const earliest=observed.reduce((a,b)=>time(a)<=time(b)?a:b),expiresMs=Math.min(Number(time(earliest)/1000000n)+300000,Date.parse(approval.expiresAt));
  demand(expiresMs>nowMs,'MIGRATION_CONTEXT_EVIDENCE_WINDOW_EXPIRED');
  const context={schemaVersion:1,sourceProjectId:FA,destinationProjectId:FB,databaseId:'(default)',verifiedAt:earliest,
    expiresAt:new Date(expiresMs).toISOString(),pins:copyJson(facts.PLAN_APPROVAL.pins),manifestVerified:true,aclVerified:true,
    identityVerified:true,sourceSnapshotVerified:true,destinationSnapshotVerified:true,sourceStillMatchesBackup:true,
    destinationWriterState:'STOPPED',destinationClientAccess:'DISABLED',destinationNativeTriggersAbsent:true,firestoreReadsIssued:0,
    producerEvidenceScope:'CONFIGURED_PRODUCERS_ONLY',globalNativeProducerAbsenceCertified:false,
    evidenceSha256:snapshotDigest(evidence),identityCreatesGrant:false};
  return {context,ready:true,counts:{sourceDocuments:sourceSnapshot.documents.length,destinationDocuments:destinationSnapshot.documents.length,
    proposedCopies:plan.operations.length,...facts.ACL_IDENTITY,configuredProducers:facts.PRODUCER_INVENTORY.count},
    scope:'SELECTED_TREES_AND_CONFIGURED_PRODUCERS_ONLY',globalDatabaseCoverageCertified:false,sourcePreserved:true,
    firestoreReadsIssued:0,firestoreWritesIssued:0,authChangesIssued:0,grantsIssued:0};
}

/** Safe review output. It never returns documents, UIDs, emails or raw observations. */
export function assessManagementMigrationContext(input) {
  try {const result=buildManagementMigrationContext(input);return {ready:true,gates:[],counts:result.counts,verifiedAt:result.context.verifiedAt,
    expiresAt:result.context.expiresAt,scope:result.scope,globalDatabaseCoverageCertified:false,globalNativeProducerAbsenceCertified:false,
    firestoreReadsIssued:0,firestoreWritesIssued:0,authChangesIssued:0,grantsIssued:0};}
  catch(error){return {ready:false,gates:error instanceof ContextError?error.gates:[{code:'MIGRATION_CONTEXT_INPUT_INVALID'}],
    firestoreReadsIssued:0,firestoreWritesIssued:0,authChangesIssued:0,grantsIssued:0};}
}
