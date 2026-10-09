import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshotDigest,documentDigest,prepareSplitPlan} from '../scripts/lib/management-split-plan.js';
import {authSnapshotDigest,authRawSnapshotDigest} from '../scripts/lib/management-auth-import-plan.js';
import {buildManagementMigrationContext,assessManagementMigrationContext,MANAGEMENT_MIGRATION_DESTINATION_ROOTS as ROOTS} from '../scripts/lib/management-migration-context.js';

const FA='sahmt-17a16',FB='sahmt-gestao-5ae66';
const NOW='2026-10-09T12:00:00.000Z',CURRENT='2026-10-09T11:59:59.000Z',OLD='2026-10-09T11:00:00.000Z';
const hash=value=>createHash('sha256').update(value).digest('hex');
const stringValue=value=>({stringValue:value}),booleanValue=value=>({booleanValue:value});
const clone=value=>structuredClone(value);
const doc=(path,fields)=>({path,fields,createTime:OLD,updateTime:OLD});
const snap=(projectId,roots,documents,readTime=OLD)=>({schemaVersion:1,projectId,databaseId:'(default)',readTime,coverage:{complete:true,consistent:true,rootCollections:[...roots]},documents});
const auth=(projectId,users,readTime=OLD)=>({schemaVersion:1,projectId,readTime,coverage:{complete:true,atomicSnapshot:false},users});
function pins(e) {
  e.pins={currentSourceSnapshotSha256:snapshotDigest(e.currentSourceSnapshot),currentDestinationSnapshotSha256:snapshotDigest(e.currentDestinationSnapshot),
    previousSourceAuthSha256:authSnapshotDigest(e.previousSourceAuth),currentSourceAuthSha256:authSnapshotDigest(e.currentSourceAuth),
    previousDestinationAuthSha256:authSnapshotDigest(e.previousDestinationAuth),currentDestinationAuthSha256:authSnapshotDigest(e.currentDestinationAuth),
    previousSourceAuthRawSha256:authRawSnapshotDigest(e.previousSourceAuthRawUsers),currentSourceAuthRawSha256:authRawSnapshotDigest(e.currentSourceAuthRawUsers),
    previousDestinationAuthRawSha256:authRawSnapshotDigest(e.previousDestinationAuthRawUsers),currentDestinationAuthRawSha256:authRawSnapshotDigest(e.currentDestinationAuthRawUsers),
    destinationMetadataSha256:snapshotDigest(e.destinationMetadata),destinationRulesSha256:snapshotDigest(e.destinationRules),
    producerRegistrySha256:snapshotDigest(e.configuredProducerRegistry),producerInventorySha256:snapshotDigest(e.producerInventory)};
}
function fixture({historical=false}={}) {
  const google={uid:'google-user',disabled:false,emailVerified:true,email:'person@example.invalid',providerData:[{providerId:'google.com',uid:'google-subject',email:'person@example.invalid'}]};
  const deferred={uid:'deferred-user',disabled:false,emailVerified:false,providerData:[]};
  const docs=[doc('managementAreas/area-demo',{name:stringValue('Área sintética'),createdByUid:stringValue('google-user')}),
    doc('users/google-user',{uid:stringValue('google-user'),active:booleanValue(false),access:booleanValue(false),permissions:{mapValue:{fields:{managementRead:booleanValue(false)}}}}),
    doc('users/deferred-user',{uid:stringValue('deferred-user'),active:booleanValue(true),access:booleanValue(true),permissions:{mapValue:{fields:{}}}}),
    doc('documentAccessEmails/acl-demo',{version:{integerValue:'1'},groups:{arrayValue:{values:[stringValue('GENERAL')]}}})];
  if(historical)docs.push(doc('documents/old-material',{createdByUid:stringValue('archived-user')}));
  const sourceSnapshot=snap(FA,ROOTS.filter(r=>r!=='migrationOrigins'),docs),destinationSnapshot=snap(FB,ROOTS,[]);
  const manifest={schemaVersion:1,sourceProjectId:FA,destinationProjectId:FB,sourceDatabaseId:'(default)',destinationDatabaseId:'(default)',
    backupSha256:snapshotDigest(sourceSnapshot),identityMappings:[{memberId:'member-google',faUid:google.uid,fbUid:google.uid},{memberId:'member-deferred',faUid:deferred.uid,fbUid:deferred.uid}],
    entries:docs.map(row=>({path:row.path,action:row.path.startsWith('managementAreas/')||row.path.startsWith('documents/')?'COPY':'KEEP_FA',reason:'Classificação sintética para Gestão',sourceSha256:documentDigest(row),dependencies:[]}))};
  if(historical){const old=docs.at(-1);manifest.historicalAttributions=[{path:old.path,sourceSha256:documentDigest(old),field:'createdByUid',sourceUid:'archived-user',
    actor:{sourceProjectId:FA,sourceUid:'archived-user',status:'ARCHIVED_UNRESOLVED',active:false,access:false,memberId:null}}];}
  const plan=prepareSplitPlan(sourceSnapshot,manifest,destinationSnapshot);
  const approval={schemaVersion:1,authorized:true,purpose:'MANAGEMENT_MIGRATION_CREATE_ONLY',requestId:'synthetic-context',sourceProjectId:FA,destinationProjectId:FB,databaseId:'(default)',
    approvedAt:NOW,expiresAt:'2026-10-09T12:10:00.000Z',pins:{planSha256:plan.planSha256,sourceSnapshotSha256:snapshotDigest(sourceSnapshot),
      manifestSha256:snapshotDigest(manifest),destinationSnapshotSha256:snapshotDigest(destinationSnapshot),
      aclSha256:snapshotDigest(docs.filter(d=>d.path.startsWith('documentAccessEmails/'))),identitySha256:snapshotDigest(manifest.identityMappings)}};
  const rawGoogle={localId:google.uid,disabled:false,emailVerified:true,email:google.email,validSince:'1',providerUserInfo:[{providerId:'google.com',rawId:'google-subject',email:google.email}]};
  const rawDeferred={localId:deferred.uid,disabled:false,emailVerified:false,providerUserInfo:[]};
  const rules={projectId:FB,release:{name:`projects/${FB}/releases/cloud.firestore`,rulesetName:`projects/${FB}/rulesets/synthetic`,updateTime:OLD},
    source:[{name:'firestore.rules',content:"rules_version = '2';\nservice cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }"}]};
  const metadata={schemaVersion:1,mode:'READ_ONLY_METADATA',projectId:FB,verifiedAt:CURRENT,principalMatched:true,projectMatches:true,expectedPrincipalIsOwner:true,
    checks:Object.fromEntries(['project','database','billing','iam','auth','google','rules'].map(k=>[k,{status:'VERIFIED',responseSha256:hash(k)}])),
    billingEnabled:false,database:{name:`projects/${FB}/databases/(default)`,locationId:'southamerica-east1',type:'FIRESTORE_NATIVE',edition:'STANDARD'},
    googleEnabled:true,authorizedDomains:['anestesiahmtforms.github.io'],publishedRules:{rulesetName:rules.release.rulesetName,updateTime:OLD,
      files:[{name:rules.source[0].name,sha256:hash(rules.source[0].content)}]}};
  const registry={schemaVersion:1,scope:'CONFIGURED_PRODUCERS_ONLY',sourceProjectId:FA,destinationProjectId:FB,
    producers:[{producerId:'native-demo',kind:'APPS_SCRIPT_NATIVE',ownerProjectId:FA,configurationSha256:hash('native-config')},
      {producerId:'pwa-demo',kind:'PWA_BROWSER',ownerProjectId:FA,configurationSha256:hash('pwa-config')},
      {producerId:'functions-demo',kind:'CLOUD_FUNCTIONS',ownerProjectId:FA,configurationSha256:hash('functions-config')}]};
  const methods={APPS_SCRIPT_NATIVE:'NATIVE_READ_ONLY_STATUS',PWA_BROWSER:'PUBLISHED_CLIENT_SOURCE_REVIEW',CLOUD_FUNCTIONS:'ADMIN_FUNCTIONS_INVENTORY'};
  const inventory={schemaVersion:1,scope:'CONFIGURED_PRODUCERS_ONLY',sourceProjectId:FA,destinationProjectId:FB,observedAt:CURRENT,registrySha256:snapshotDigest(registry),
    observations:registry.producers.map(p=>({producerId:p.producerId,kind:p.kind,projectId:p.ownerProjectId,configurationSha256:p.configurationSha256,
      observationMethod:methods[p.kind],observationId:'synthetic-observation-'+p.producerId,observedAt:CURRENT,
      writerState:p.kind==='CLOUD_FUNCTIONS'?'STOPPED':'RUNNING_FA_ONLY',writeProjectIds:p.kind==='CLOUD_FUNCTIONS'?[]:[FA],
      nativeJobs:p.kind==='APPS_SCRIPT_NATIVE'?[{jobId:'synthetic-job',handler:'syntheticHandler',projectId:FA,enabled:true}]:[]}))};
  const evidence={schemaVersion:1,mode:'CURRENT_MANAGEMENT_MIGRATION_EVIDENCE',
    currentSourceSnapshot:{...clone(sourceSnapshot),readTime:CURRENT},currentDestinationSnapshot:{...clone(destinationSnapshot),readTime:CURRENT},
    previousSourceAuth:auth(FA,[google,deferred]),currentSourceAuth:auth(FA,clone([google,deferred]),CURRENT),
    previousDestinationAuth:auth(FB,[]),currentDestinationAuth:auth(FB,[],CURRENT),
    previousSourceAuthRawUsers:[rawGoogle,rawDeferred],currentSourceAuthRawUsers:clone([rawGoogle,rawDeferred]),
    previousDestinationAuthRawUsers:[],currentDestinationAuthRawUsers:[],destinationMetadata:metadata,destinationRules:rules,
    configuredProducerRegistry:registry,producerInventory:inventory};pins(evidence);
  return {sourceSnapshot,manifest,destinationSnapshot,plan,approval,evidence,nowMs:Date.parse(NOW)};
}
function denied(change,expected) {const input=fixture();change(input);pins(input.evidence);const output=assessManagementMigrationContext(input);
  assert.equal(output.ready,false);assert.ok(output.gates.some(g=>g.code===expected),JSON.stringify(output));return output;}

test('derives bounded context from exact current packets and preserves denied profiles',()=>{
  const input=fixture(),before=structuredClone(input),result=buildManagementMigrationContext(input);
  assert.equal(result.context.verifiedAt,CURRENT);assert.equal(result.context.expiresAt,'2026-10-09T12:04:59.000Z');
  assert.equal(result.context.sourceStillMatchesBackup,true);assert.equal(result.context.aclVerified,true);
  assert.equal(result.context.identityCreatesGrant,false);assert.equal(result.context.producerEvidenceScope,'CONFIGURED_PRODUCERS_ONLY');
  assert.equal(result.context.globalNativeProducerAbsenceCertified,false);assert.equal(result.grantsIssued,0);assert.deepEqual(input,before);
  assert.equal(result.counts.knownGoogle,1);assert.equal(result.counts.deferred,1);assert.equal(result.counts.copyReferencedGoogle,1);
});

test('context expiration uses oldest real observation, never now as verifiedAt',()=>{
  const input=fixture();input.evidence.currentSourceAuth.readTime='2026-10-09T11:58:01.000Z';pins(input.evidence);
  const result=buildManagementMigrationContext(input);assert.equal(result.context.verifiedAt,'2026-10-09T11:58:01.000Z');
  assert.equal(result.context.expiresAt,'2026-10-09T12:03:01.000Z');
});

test('archived attribution requires no invented Auth row or live grant',()=>{
  const result=buildManagementMigrationContext(fixture({historical:true}));assert.equal(result.counts.archivedAttributionFields,1);
  assert.equal(result.counts.copyReferencedGoogle,1);assert.equal(result.grantsIssued,0);
});

for(const [label,change,code]of [
 ['changed source fields',i=>i.evidence.currentSourceSnapshot.documents[0].fields.name.stringValue='changed','MIGRATION_CONTEXT_SOURCE_CHANGED_SINCE_BACKUP'],
 ['changed source nanoseconds',i=>i.evidence.currentSourceSnapshot.documents[0].updateTime='2026-10-09T11:00:00.000000001Z','MIGRATION_CONTEXT_SOURCE_CHANGED_SINCE_BACKUP'],
 ['missing source document',i=>i.evidence.currentSourceSnapshot.documents.pop(),'MIGRATION_CONTEXT_SOURCE_CHANGED_SINCE_BACKUP'],
 ['changed ACL',i=>i.evidence.currentSourceSnapshot.documents.at(-1).fields.version.integerValue='2','MIGRATION_CONTEXT_SOURCE_CHANGED_SINCE_BACKUP'],
 ['changed profile',i=>i.evidence.currentSourceSnapshot.documents[1].fields.access.booleanValue=true,'MIGRATION_CONTEXT_SOURCE_CHANGED_SINCE_BACKUP'],
 ['source root omission',i=>i.evidence.currentSourceSnapshot.coverage.rootCollections.pop(),'MIGRATION_CONTEXT_CAPTURE_ROOTS_CHANGED'],
 ['stale source',i=>i.evidence.currentSourceSnapshot.readTime='2026-10-09T11:54:59.000Z','MIGRATION_CONTEXT_CAPTURE_STALE'],
 ['future source',i=>i.evidence.currentSourceSnapshot.readTime='2026-10-09T12:00:00.000000001Z','MIGRATION_CONTEXT_CAPTURE_STALE'],
 ['incomplete source',i=>i.evidence.currentSourceSnapshot.coverage.complete=false,'MIGRATION_CONTEXT_CAPTURE_INVALID_OR_INCOMPLETE'],
 ['changed destination',i=>i.evidence.currentDestinationSnapshot.documents.push(doc('managementAreas/concurrent',{name:stringValue('synthetic')})),'MIGRATION_CONTEXT_DESTINATION_CHANGED_SINCE_PLAN'],
 ['destination root omission',i=>i.evidence.currentDestinationSnapshot.coverage.rootCollections.pop(),'MIGRATION_CONTEXT_CAPTURE_ROOTS_CHANGED'],
 ['source auth raw revocation watermark changed',i=>i.evidence.currentSourceAuthRawUsers[0].validSince='2','MIGRATION_CONTEXT_AUTH_CHANGED_SINCE_REVIEW'],
 ['source auth display changed',i=>{i.evidence.currentSourceAuth.users[0].displayName='New';i.evidence.currentSourceAuthRawUsers[0].displayName='New';},'MIGRATION_CONTEXT_AUTH_CHANGED_SINCE_REVIEW'],
 ['source Auth disabled',i=>{i.evidence.currentSourceAuth.users[0].disabled=true;i.evidence.currentSourceAuthRawUsers[0].disabled=true;},'MIGRATION_CONTEXT_AUTH_GOOGLE_NOT_CURRENT_ENABLED'],
 ['source Auth email unverified',i=>{i.evidence.currentSourceAuth.users[0].emailVerified=false;i.evidence.currentSourceAuthRawUsers[0].emailVerified=false;},'MIGRATION_CONTEXT_AUTH_GOOGLE_NOT_CURRENT_ENABLED'],
 ['stale Auth',i=>i.evidence.currentSourceAuth.readTime='2026-10-09T11:54:59.000Z','MIGRATION_CONTEXT_AUTH_STALE'],
 ['source Auth omitted raw record',i=>i.evidence.currentSourceAuthRawUsers.pop(),'MIGRATION_CONTEXT_RAW_AUTH_REQUIRED'],
 ['source Auth normalization changed',i=>i.evidence.currentSourceAuthRawUsers[0].email='other@example.invalid','MIGRATION_CONTEXT_RAW_AUTH_NORMALIZATION_MISMATCH'],
 ['enabled billing',i=>i.evidence.destinationMetadata.billingEnabled=true,'MIGRATION_CONTEXT_DESTINATION_DATABASE_OR_BILLING_CHANGED'],
 ['wrong region',i=>i.evidence.destinationMetadata.database.locationId='us-central1','MIGRATION_CONTEXT_DESTINATION_DATABASE_OR_BILLING_CHANGED'],
 ['metadata endpoint incomplete',i=>i.evidence.destinationMetadata.checks.iam.status='UNVERIFIED','MIGRATION_CONTEXT_DESTINATION_METADATA_PARTIAL'],
 ['stale metadata',i=>i.evidence.destinationMetadata.verifiedAt='2026-10-09T11:54:59.000Z','MIGRATION_CONTEXT_DESTINATION_METADATA_STALE'],
 ['unapproved principal',i=>i.evidence.destinationMetadata.expectedPrincipalIsOwner=false,'MIGRATION_CONTEXT_DESTINATION_PRINCIPAL_UNVERIFIED'],
 ['google disabled',i=>i.evidence.destinationMetadata.googleEnabled=false,'MIGRATION_CONTEXT_DESTINATION_AUTH_CONFIG_CHANGED'],
 ['different Rules source',i=>i.evidence.destinationRules.source[0].content+='\n// concurrent version','MIGRATION_CONTEXT_DESTINATION_RULE_SOURCE_CHANGED'],
 ['Ruleset mismatch',i=>i.evidence.destinationRules.release.rulesetName=`projects/${FA}/rulesets/other`,'MIGRATION_CONTEXT_DESTINATION_RULESET_CHANGED'],
 ['missing native producer observations',i=>i.evidence.producerInventory.observations.shift(),'MIGRATION_CONTEXT_PRODUCER_OBSERVATION_MISSING'],
 ['old native producer observation',i=>i.evidence.producerInventory.observations[0].observedAt='2026-10-09T11:54:59.000Z','MIGRATION_CONTEXT_PRODUCER_OBSERVATIONS_STALE'],
 ['native job configured for FB',i=>i.evidence.producerInventory.observations[0].nativeJobs[0].projectId=FB,'MIGRATION_CONTEXT_DESTINATION_NATIVE_JOB_PRESENT_OR_UNKNOWN'],
 ['native job FB disabled still present',i=>{i.evidence.producerInventory.observations[0].nativeJobs[0].projectId=FB;i.evidence.producerInventory.observations[0].nativeJobs[0].enabled=false;},'MIGRATION_CONTEXT_DESTINATION_NATIVE_JOB_PRESENT_OR_UNKNOWN'],
 ['destination writer present',i=>i.evidence.producerInventory.observations[0].writeProjectIds=[FB],'MIGRATION_CONTEXT_DESTINATION_WRITERS_NOT_STOPPED'],
 ['native evidence unbound',i=>i.evidence.producerInventory.observations[0].configurationSha256='e'.repeat(64),'MIGRATION_CONTEXT_PRODUCER_OBSERVATION_UNBOUND'],
 ['producer state incoherent',i=>i.evidence.producerInventory.observations[0].writerState='STOPPED','MIGRATION_CONTEXT_PRODUCER_STATE_INCOHERENT'],
 ['empty producer registry cannot certify absence',i=>{i.evidence.configuredProducerRegistry.producers=[];i.evidence.producerInventory.observations=[];i.evidence.producerInventory.registrySha256=snapshotDigest(i.evidence.configuredProducerRegistry);},'MIGRATION_CONTEXT_CONFIGURED_PRODUCER_REGISTRY_REQUIRED']
])test('blocks '+label,()=>denied(change,code));

test('additional Auth UID blocks rather than accepting a fresh date',()=>{
  denied(i=>{const user={uid:'extra-user',disabled:false,emailVerified:false,providerData:[]};i.evidence.currentSourceAuth.users.push(user);
    i.evidence.currentSourceAuthRawUsers.push({localId:user.uid,disabled:false,emailVerified:false,providerUserInfo:[]});},'MIGRATION_CONTEXT_AUTH_CHANGED_SINCE_REVIEW');
});

test('changed plan or approval never gains context authority',()=>{
  const i=fixture();i.approval.authorized=false;assert.equal(assessManagementMigrationContext(i).ready,false);
  assert.throws(()=>buildManagementMigrationContext(i),/MIGRATION_CONTEXT_PLAN_APPROVAL_INVALID/);
});

test('self-rehashed broad Rules do not become deny-all evidence',()=>{
  denied(i=>{i.evidence.destinationRules.source[0].content=i.evidence.destinationRules.source[0].content.replace('if false','if true');
    i.evidence.destinationMetadata.publishedRules.files[0].sha256=hash(i.evidence.destinationRules.source[0].content);},'MIGRATION_CONTEXT_DESTINATION_CLIENT_ACCESS_NOT_DENIED');
});

test('source-only no-Google mapping cannot be used as COPY identity',()=>{
  const i=fixture();i.sourceSnapshot.documents[0].fields.createdByUid=stringValue('deferred-user');
  i.manifest.backupSha256=snapshotDigest(i.sourceSnapshot);i.manifest.entries[0].sourceSha256=documentDigest(i.sourceSnapshot.documents[0]);
  i.evidence.currentSourceSnapshot.documents=clone(i.sourceSnapshot.documents);i.plan=prepareSplitPlan(i.sourceSnapshot,i.manifest,i.destinationSnapshot);
  i.approval.pins.planSha256=i.plan.planSha256;i.approval.pins.sourceSnapshotSha256=snapshotDigest(i.sourceSnapshot);i.approval.pins.manifestSha256=snapshotDigest(i.manifest);pins(i.evidence);
  assert.ok(assessManagementMigrationContext(i).gates.some(g=>g.code==='MIGRATION_CONTEXT_COPY_IDENTITY_GOOGLE_REQUIRED'));
});

test('missing producer evidence is actionable even when destination is empty',()=>{
  const i=fixture();delete i.evidence.producerInventory;const result=assessManagementMigrationContext(i);
  assert.equal(result.ready,false);assert.ok(result.gates.some(g=>g.code==='MIGRATION_CONTEXT_PRODUCER_OBSERVATIONS_REQUIRED'));
});

test('safe assessment omits names, emails, UIDs and raw evidence',()=>{
  const i=fixture(),result=assessManagementMigrationContext(i);assert.equal(result.ready,true);
  const text=JSON.stringify(result);for(const secret of ['person@example.invalid','google-user','google-subject','deferred-user','Área sintética','validSince'])assert.equal(text.includes(secret),false);
  assert.equal(result.firestoreReadsIssued,0);assert.equal(result.authChangesIssued,0);
});

test('multiple independent missing proofs produce distinct gates',()=>{
  const i=fixture();i.evidence.currentSourceSnapshot.coverage.complete=false;delete i.evidence.producerInventory;
  const result=assessManagementMigrationContext(i);assert.ok(result.gates.some(g=>g.gate==='SOURCE_CAPTURE'));assert.ok(result.gates.some(g=>g.gate==='PRODUCER_INVENTORY'));
});

test('stale digest rejects changed evidence even if facts remain otherwise valid',()=>{
  const i=fixture();i.evidence.currentSourceSnapshot.readTime='2026-10-09T11:59:58.000Z';
  assert.ok(assessManagementMigrationContext(i).gates.some(g=>g.code==='MIGRATION_CONTEXT_EVIDENCE_PIN_MISMATCH'));
});

test('getter is rejected without invocation or raw error',()=>{
  const i=fixture();let executed=0;Object.defineProperty(i.evidence,'secret',{enumerable:true,get:()=>{executed++;throw Error('PRIVATE');}});
  const result=assessManagementMigrationContext(i);assert.equal(result.ready,false);assert.equal(executed,0);
  assert.deepEqual(result.gates,[{code:'MIGRATION_CONTEXT_INPUT_INVALID'}]);
});
