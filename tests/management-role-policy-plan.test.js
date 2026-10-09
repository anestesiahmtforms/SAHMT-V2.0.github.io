import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshotDigest, documentDigest} from '../scripts/lib/management-split-plan.js';
import {authSnapshotDigest, authSourceRecordDigest} from '../scripts/lib/management-auth-import-plan.js';
import {buildManagementAuthorizationPreview} from '../scripts/lib/management-authorization-preview.js';
import {buildManagementRolePolicyPlan, managementRolePolicyPlanDigest} from '../scripts/lib/management-role-policy-plan.js';
const FA='sahmt-17a16', FB='sahmt-gestao-5ae66', time='2026-10-08T12:00:00Z', scope='APPLICATION_AUTHORIZATION_ONLY_NOT_PROJECT_IAM';
const gates=['EXCLUSIVE_APPLICATION_ROLE_POLICY_OVERLAY_AND_TESTS_REQUIRED','PRESERVED_EXCEPTION_ROLE_PERMISSIONS_ACL_PARITY_REQUIRED','COMMON_USERS_OPERATIONAL_AND_PROFESSIONAL_RIGHTS_PRESERVATION_REQUIRED','HISTORICAL_ROLE_MANAGER_DIFF_RECONCILIATION_REQUIRED','CURRENT_AUTH_REVOCATION_PROFILE_AND_ACL_REQUIRED','CANONICAL_BINDING_PERSISTENCE_REQUIRED','NO_ACTIVATION_BY_THIS_INTENT'];
const typed=v=>v===null?{nullValue:null}:typeof v==='boolean'?{booleanValue:v}:typeof v==='string'?{stringValue:v}:typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:v.map(typed)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,typed(x)]))}};
const decode=v=>'mapValue'in v?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)])):'arrayValue'in v?(v.arrayValue.values||[]).map(decode):'integerValue'in v?Number(v.integerValue):Object.values(v)[0];
const doc=(path,value)=>({path,fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typed(v)])),createTime:time,updateTime:time});
const record=row=>Object.fromEntries(Object.entries(row.fields).map(([k,v])=>[k,decode(v)]));
const auth=(uid,google=true)=>({uid,email:uid+'@example.invalid',emailVerified:google,disabled:false,providerData:google?[{providerId:'google.com',uid:'google-'+uid,email:uid+'@example.invalid'}]:[]});
const clone=v=>structuredClone(v);
function base(){
 const documents=[
  doc('users/admin',{uid:'admin',role:'administrador_app',active:true,access:true,permissions:{trainingsRead:true,notificationsRead:true}}),
  doc('users/exception',{uid:'exception',role:'anestesiologista',active:true,access:true,permissions:{managementRead:true,labelsWrite:true,trainingsRead:true}}),
  doc('users/common',{uid:'common',role:'anestesiologista',active:true,access:true,permissions:{checklistWrite:true,eventsRead:true,trainingsRead:true}}),
  doc('users/legacy',{uid:'legacy',role:'administrador_app',active:false,access:false,permissions:{admin:true,trainingsRead:true}}),
  doc('users/defer',{uid:'defer',role:'residente',active:true,access:true,permissions:{trainingsRead:true}}),
  doc('managementAreas/area-a',{id:'area-a',active:true,version:1,managerUids:['admin','common'],memberUids:['defer'],permissions:{}}),
  doc('managementAreas/area-b',{id:'area-b',active:true,version:2,managerUids:['legacy'],memberUids:[],permissions:{}}),
  doc('documents/legacy',{managementAreaId:'area-a',active:true,version:1,createdByUid:'admin'}),
  doc('scopedDocuments/scoped',{managementAreaId:'area-a',active:true,version:1,audienceGroup:'RESTRICTED',createdByUid:'admin'}),
  ...['admin','exception','common','legacy','defer'].map(uid=>doc('documentAccessEmails/'+uid+'@example.invalid',{id:uid+'@example.invalid',email:uid+'@example.invalid',groups:['GENERAL','RESTRICTED'],active:true,version:1,createdByUid:'admin',updatedByUid:'admin',createdAt:time,updatedAt:time})),
  doc('evaluationFormConfigs/eval-a',{managerAreaId:'area-a',version:1,status:'READY',eligibleGroups:['GENERAL'],eligibleUids:['common'],publishedAudienceHash:'a'.repeat(64),accessVerifiedAt:time}),
  doc('evaluationActivities/eval-a',{managerAreaId:'area-a',version:1,status:'READY',eligibleGroups:['GENERAL'],eligibleUids:['common'],publishedAudienceHash:'a'.repeat(64),accessVerifiedAt:time}),
  doc('contacts/contact-admin',{uid:'admin',name:'Synthetic contact'}),
  doc('contacts/contact-exception',{uid:'exception'}),
  doc('eventMembers/member-exception',{uid:'exception'}),
  doc('appConfig/features',{features:{management:true,trainings:true}})];
 const roots=['users','managementAreas','documentAccessEmails','documents','scopedDocuments','evaluationFormConfigs','evaluationActivities','contacts','eventMembers','appConfig','roles'];
 const sourceSnapshot={schemaVersion:1,projectId:FA,databaseId:'(default)',readTime:time,coverage:{complete:true,consistent:true,rootCollections:roots},documents};
 const destinationSnapshot={schemaVersion:1,projectId:FB,databaseId:'(default)',readTime:time,coverage:{complete:true,consistent:true,rootCollections:[...roots,'migrationOrigins']},documents:[]};
 const sourceAuth={schemaVersion:1,projectId:FA,readTime:time,coverage:{complete:true,atomicSnapshot:false},users:['admin','exception','common','legacy','defer'].map(uid=>auth(uid,uid!=='defer'))};
 const manifest={schemaVersion:1,sourceProjectId:FA,destinationProjectId:FB,sourceDatabaseId:'(default)',destinationDatabaseId:'(default)',backupSha256:snapshotDigest(sourceSnapshot),identityMappings:sourceAuth.users.map(u=>({faUid:u.uid,fbUid:u.uid,memberId:'member-'+u.uid})),entries:documents.map(row=>({path:row.path,action:['users','documentAccessEmails','contacts','eventMembers','appConfig'].includes(row.path.split('/')[0])?'KEEP_FA':'COPY',reason:'Synthetic local only',scope:'GESTAO',evidence:'RELATION_VERIFIED',sourceSha256:documentDigest(row),dependencies:[]}))};
 const policy={schemaVersion:1,version:'preview-v1',sourceProjectId:FA,destinationProjectId:FB,mode:'OFFLINE_PROPOSAL_ONLY',managementSurfaceEnabled:false,performanceSurfaceEnabled:false,futureManagementGate:'DENIED',baseline:'FA_APP_MANAGEMENT_ADMIN_ONLY',cancelledTrainingRemainsStopped:true};
 return{sourceSnapshot,destinationSnapshot,sourceAuth,manifest,policy,aclBindings:[],pins:{}};
}
function repinPreview(i){
 i.manifest.backupSha256=snapshotDigest(i.sourceSnapshot);
 for(const e of i.manifest.entries)e.sourceSha256=documentDigest(i.sourceSnapshot.documents.find(d=>d.path===e.path));
 i.aclBindings=i.sourceAuth.users.filter(u=>u.providerData.length===1&&u.providerData[0].providerId==='google.com'&&u.emailVerified&&!u.disabled).map(u=>{const d=i.sourceSnapshot.documents.find(d=>d.path==='documentAccessEmails/'+u.email.toLowerCase());return{schemaVersion:1,path:d.path,sourceDocumentSha256:documentDigest(d),faUid:u.uid,googleUid:u.providerData[0].uid,authRecordSha256:authSourceRecordDigest(u),classification:'CAPTURED_INTENT_ONLY'};});
 i.pins={sourceSnapshotSha256:snapshotDigest(i.sourceSnapshot),destinationSnapshotSha256:snapshotDigest(i.destinationSnapshot),sourceAuthSha256:authSnapshotDigest(i.sourceAuth),manifestSha256:snapshotDigest(i.manifest),identityMappingsSha256:snapshotDigest(i.manifest.identityMappings),policySha256:snapshotDigest(i.policy),aclBindingsSha256:snapshotDigest(i.aclBindings)};
}
function humanIntent(i,p){
 const docs=i.sourceSnapshot.documents;
 const designations=[['ADMINISTRATOR_DESIGNATED','admin'],['PERMISSIONS_EXCEPTION','exception']].map(([alias,uid])=>{
  const user=i.sourceAuth.users.find(u=>u.uid===uid),profileRow=docs.find(d=>d.path==='users/'+uid),profile=record(profileRow),mapping=i.manifest.identityMappings.find(m=>m.faUid===uid),aclRow=docs.find(d=>d.path==='documentAccessEmails/'+user.email),acl=record(aclRow);
  const requestedPolicy=alias==='ADMINISTRATOR_DESIGNATED'?{intent:'EXCLUSIVE_DESIGNATED_ADMINISTRATOR_AND_MANAGER_ALL_APP_PROCESSES',administratorExclusive:true,scope,permissionGrantsComputed:false,roleIsNotProfessionalFunctionReset:true,projectIamOwnershipProposed:false,requireTwelveAreaAssignments:false,requiresFuturePolicyOverlay:true}:{intent:'PRESERVE_CAPTURED_ROLE_PERMISSIONS_AND_ACL_EXACTLY',preservedRole:profile.role,preservedPermissions:clone(profile.permissions),preservedAclDocument:clone(aclRow),preservedSourceProfileSha256:documentDigest(profileRow),preservedSourceAclSha256:documentDigest(aclRow),preserveCurrentDeniedFlags:true,permissionGrantsComputed:false};
  return{alias,requestedEmail:user.email,faUid:uid,googleUid:user.providerData[0]?.uid||'missing-google',proposedMemberId:mapping.memberId,sourceAuthRecordSha256:authSourceRecordDigest(user),sourceProfileSha256:documentDigest(profileRow),mappingSha256:snapshotDigest(mapping),sourceAclSha256:documentDigest(aclRow),uniqueness:{authEmailMatches:1,googleUidMatches:1,uidRosterMatches:1,mappingMatches:1,aclMatches:1,linkedRosterCounts:{users:1,contacts:docs.filter(d=>d.path.startsWith('contacts/')&&d.fields.uid?.stringValue===uid).length,eventMembers:docs.filter(d=>d.path.startsWith('eventMembers/')&&d.fields.uid?.stringValue===uid).length}},observed:{role:profile.role,permissions:clone(profile.permissions),active:profile.active,access:profile.access,roleIsAdministrator:profile.role==='administrador_app',explicitAdminPermission:profile.permissions.admin===true,adminPredicateWithFlags:profile.active&&profile.access&&(profile.role==='administrador_app'||profile.permissions.admin===true),acl:{active:acl.active,groups:clone(acl.groups),version:aclRow.fields.version.integerValue},managedAreaEvidence:docs.filter(d=>d.path.startsWith('managementAreas/')&&record(d).managerUids.includes(uid)).map(d=>({areaId:record(d).id,version:record(d).version,sourceDocumentSha256:documentDigest(d)})).sort((a,b)=>a.areaId<b.areaId?-1:a.areaId>b.areaId?1:0)},requestedPolicy,productionAuthorized:false,authorizationReady:false,loginAuthorized:false,effectiveGrant:false};
 });
 return{schemaVersion:1,mode:'PRIVATE_HUMAN_IDENTITY_AND_PERMISSION_INTENT_V2_ONLY',productionAuthorized:false,authorizationReady:false,instructionSource:'HUMAN_USER_MESSAGE_RELAYED_BY_PARENT_CURRENT_SESSION',sourceProjectId:FA,destinationProjectId:FB,sourcePins:{sourceSnapshotSha256:i.pins.sourceSnapshotSha256,sourceAuthSha256:i.pins.sourceAuthSha256,manifestSha256:i.pins.manifestSha256,identityMappingsSha256:i.pins.identityMappingsSha256,priorPreviewSha256:p.resultSha256},sourceReadTime:i.sourceSnapshot.readTime,authReadTime:i.sourceAuth.readTime,operationalFreshnessEvaluated:false,capturesAtomicTogether:false,designations,generalUserPolicyIntent:{classification:'COMMON_USERS_EXCEPT_PRESERVED_EXCEPTION',applicationAuthorizationClassificationOnly:true,preserveProfessionalFunctions:true,preserveOperationalPermissions:true,preserveContentEligibility:true,permissionsNotEnumeratedByThisProof:true,noAutomaticRoleReset:true,deltaComputed:false,overlayComputed:false,authorityCalculated:false,effectiveGrants:false},preservedArtifacts:{source:'capture-source.dpapi.json',auth:'capture-auth.dpapi.json',manifest:'manifest-v2.dpapi.json',review:'review-v2.dpapi.json',previewInputs:'preview-inputs-v1.dpapi.json',preview:'preview-v1.dpapi.json'},policyOverlayImplemented:false,surfaces:{management:false,performance:false},grants:[],leases:[],runtimeContexts:[],authImportRecords:[],gates:clone(gates),effects:{firestoreReadsIssued:0,firestoreWritesIssued:0,authChangesIssued:0,triggersActivated:0},previousIntentSha256:'e'.repeat(64),authorizationScope:scope,policyRefinement:{administratorExclusive:true,commonUserClassificationDoesNotResetProfessionalRole:true,preserveProfessionalFunctions:true,preserveOperationalPermissions:true,preserveContentEligibility:true,applicationAdministratorIsProjectIamOwner:false,adminNeedsEveryAreaManagerAssignment:false,deltaComputed:false,overlayComputed:false,runtimeAuthorityCalculated:false,historicalRoleOrManagerDifferencesMustBeReconciledBeforeActivation:true}};
}
function fixture(mutate){
 const previewInput=base();if(mutate)mutate(previewInput);repinPreview(previewInput);
 const preview=buildManagementAuthorizationPreview(previewInput),intent=humanIntent(previewInput,preview);
 return pin({previewInput,preview,humanIntent:intent,pins:{}});
}
function pin(input){input.pins={previewInputSha256:snapshotDigest(input.previewInput),previewSha256:input.preview.resultSha256,humanIntentSha256:snapshotDigest(input.humanIntent)};return input;}
function changed(mutate){const input=fixture();mutate(input);pin(input);return input;}
const expect=(mutate,pattern)=>assert.throws(()=>buildManagementRolePolicyPlan(changed(mutate)),pattern);
const admin=i=>i.humanIntent.designations.find(d=>d.alias==='ADMINISTRATOR_DESIGNATED'),exception=i=>i.humanIntent.designations.find(d=>d.alias==='PERMISSIONS_EXCEPTION');
const set=(i,path,key,value)=>{i.sourceSnapshot.documents.find(d=>d.path===path).fields[key]=typed(value);};
const hasGate=(p,code)=>p.gates.some(g=>g.code===code);

test('deterministic pure plan keeps every effect zero and never upgrades the preview into authority',()=>{
 const i=fixture(),before=clone(i),p=buildManagementRolePolicyPlan(i);
 assert.deepEqual(i,before);assert.deepEqual(buildManagementRolePolicyPlan(i),p);assert.equal(p.resultSha256,managementRolePolicyPlanDigest(p));
 assert.equal(p.counts.profiles,5);assert.equal(p.counts.exclusiveAdministratorIntents,1);assert.equal(p.counts.preservedExceptions,1);assert.equal(p.counts.commonUserIntents,3);
 assert.equal(p.productionAuthorized,false);assert.equal(p.authorizationReady,false);assert.equal(p.writeEnabled,false);assert.equal(p.operationalFreshnessEvaluated,false);assert.equal(p.capturesAtomicTogether,false);assert.equal(p.previousIntentLineageRevalidated,false);
 assert.deepEqual(p.surfaces,{management:false,performance:false});
 for(const k of ['grants','leases','runtimeContexts','authImportRecords'])assert.deepEqual(p[k],[]);
 assert.deepEqual(p.effects,{firestoreReadsIssued:0,firestoreWritesIssued:0,authChangesIssued:0,triggersActivated:0});
 assert.equal(p.counts.effectivePermissions+p.counts.effectiveMemberships+p.counts.effectiveAclGrants+p.counts.authorizedFbContexts+p.counts.authImports+p.counts.policyWrites,0);
 assert.equal('operations'in p,false);assert.equal('patches'in p,false);assert.equal('authorizationVersion'in p,false);assert.equal('confirmedAtMs'in p,false);assert.equal('validUntilMs'in p,false);
});
test('application classification is separate from captured professional roles and all masks',()=>{
 const i=fixture(),p=buildManagementRolePolicyPlan(i),common=p.entries.find(e=>e.faUid==='common');
 assert.equal(common.applicationPolicyIntent.classification,'COMMON_USER');assert.equal(common.sourceEvidence.role,'anestesiologista');assert.deepEqual(common.sourceEvidence.permissions,{checklistWrite:true,eventsRead:true,trainingsRead:true});
 assert.equal(common.applicationPolicyIntent.roleChangeProposed,false);assert.equal(common.applicationPolicyIntent.sourceRoleUsedAsApplicationPolicy,false);
 assert.equal(p.entries.find(e=>e.faUid==='exception').applicationPolicyIntent.classification,'PRESERVED_EXCEPTION');
 assert.ok(p.entries.every(e=>e.applicationPolicyIntent.professionalFunctionsPreserved&&e.applicationPolicyIntent.operationalPermissionsPreserved&&e.applicationPolicyIntent.contentEligibilityPreserved));
});
test('admin intent does not invent assignment in every area or alter memberships',()=>{
 const p=buildManagementRolePolicyPlan(fixture()),a=p.entries.find(e=>e.faUid==='admin');
 assert.equal(a.applicationPolicyIntent.classification,'EXCLUSIVE_ADMINISTRATOR');assert.equal(a.membershipEvidence.length,1);assert.equal(a.membershipEvidence[0].areaId,'area-a');
 assert.equal(a.applicationPolicyIntent.allAreaManagerAssignmentsInvented,false);assert.equal(p.applicationPolicyIntent.administratorNeedsAllAreaAssignments,false);
 assert.equal(p.applicationPolicyIntent.projectIamOwnershipProposed,false);assert.equal(a.loginAuthorized,false);assert.equal(a.effectiveGrant,false);
});
test('source denial remains denied even for designated administrator',()=>{
 const p=buildManagementRolePolicyPlan(fixture(i=>set(i,'users/admin','access',false))),a=p.entries.find(e=>e.faUid==='admin');
 assert.ok(a.sourceDenials.includes('SOURCE_PROFILE_INACTIVE_OR_NO_ACCESS'));assert.equal(a.active,false);assert.equal(a.access,false);assert.equal(a.effectiveGrant,false);assert.ok(hasGate(p,'DESIGNATED_ADMINISTRATOR_HAS_CAPTURED_DENIALS'));
});
test('administrator not elevated in capture has intent only with explicit uncomputed delta gate',()=>{
 const p=buildManagementRolePolicyPlan(fixture(i=>set(i,'users/admin','role','anestesiologista')));
 assert.ok(hasGate(p,'DESIGNATED_ADMINISTRATOR_GRANT_DELTA_NOT_COMPUTED'));assert.equal(p.entries.find(e=>e.faUid==='admin').sourceEvidence.role,'anestesiologista');assert.deepEqual(p.grants,[]);
});
test('legacy inactive administrator remains observed and yields exclusive reconciliation gate',()=>{
 const p=buildManagementRolePolicyPlan(fixture()),e=p.entries.find(e=>e.faUid==='legacy');
 assert.equal(e.applicationPolicyIntent.classification,'COMMON_USER');assert.equal(e.sourceEvidence.role,'administrador_app');assert.equal(e.sourceEvidence.permissions.admin,true);
 assert.ok(e.sourceDenials.includes('SOURCE_PROFILE_INACTIVE_OR_NO_ACCESS'));assert.ok(hasGate(p,'LEGACY_ADMIN_PREDICATE_REQUIRES_EXCLUSIVE_POLICY_RECONCILIATION'));assert.equal(p.counts.legacyAdminDifferences,1);
});
test('explicit privileged common mask is recorded without removing operational permissions',()=>{
 const p=buildManagementRolePolicyPlan(fixture(i=>set(i,'users/common','permissions',{checklistWrite:true,usersManage:true,documentsManage:true}))),e=p.entries.find(e=>e.faUid==='common');
 assert.deepEqual(e.sourceEvidence.permissions,{checklistWrite:true,usersManage:true,documentsManage:true});assert.ok(hasGate(p,'EXPLICIT_PRIVILEGED_MASK_REQUIRES_POLICY_RECONCILIATION'));assert.equal(e.applicationPolicyIntent.permissionDeltaComputed,false);
});
test('exception preserves exact role permissions and typed full ACL by hashes',()=>{
 const i=fixture(),p=buildManagementRolePolicyPlan(i),e=p.entries.find(e=>e.faUid==='exception');
 assert.deepEqual(e.sourceEvidence.permissions,exception(i).requestedPolicy.preservedPermissions);
 assert.equal(p.preservedExceptionEvidence.sourceAclSha256,documentDigest(exception(i).requestedPolicy.preservedAclDocument));
 assert.equal(p.preservedExceptionEvidence.rolePermissionsAndTypedAclPreservedExactly,true);
});
test('DEFER never gains Google account binding or login',()=>{
 const p=buildManagementRolePolicyPlan(fixture()),e=p.entries.find(e=>e.faUid==='defer');
 assert.equal(e.sourceEvidence.sourceAuthClassification,'DEFER_UNLINKED_SOURCE_CAPTURE_ONLY');assert.ok(e.sourceDenials.includes('SOURCE_GOOGLE_IDENTITY_NOT_CONFIRMED'));
 assert.equal(e.accountCreationProposed,false);assert.equal(e.loginAuthorized,false);assert.deepEqual(e.aclEvidence,[]);assert.ok(hasGate(p,'DEFERRED_IDENTITIES_HAVE_NO_ACCOUNT_OR_ACCESS'));assert.ok(hasGate(p,'UNRESOLVED_ACL_INTENTS_HAVE_NO_BINDING_OR_GRANT'));
});
test('explicit manager and documentary eligibility do not become admin entry',()=>{
 const i=fixture(),p=buildManagementRolePolicyPlan(i),e=p.entries.find(e=>e.faUid==='common');
 assert.ok(e.differences.includes('EXPLICIT_MANAGER_RELATION_DOES_NOT_AUTHORIZE_ADMIN_SURFACE'));assert.ok(e.differences.includes('DOCUMENT_ELIGIBILITY_DOES_NOT_AUTHORIZE_ADMIN_SURFACE'));
 assert.ok(hasGate(p,'BROKER_MEMBERSHIP_OR_GROUP_ENTRY_POLICY_REQUIRES_RECONCILIATION'));assert.ok(hasGate(p,'ADMIN_ONLY_GATE_REQUIRES_BROKER_UI_RULES_PARITY'));
 assert.equal(p.counts.managerRelationsOutsideDesignated,2);assert.equal(e.membershipEvidence[0].membershipEffective,false);assert.equal(e.aclEvidence[0].grantEffective,false);
 assert.equal(p.eligibilityEvidenceSha256,snapshotDigest({aclIntents:i.preview.proposals.aclIntents,contentCandidates:i.preview.proposals.contentCandidates,evaluationCandidates:i.preview.proposals.evaluationCandidates}));
});
test('canonical missing binding and version remain missing with gates',()=>{
 const p=buildManagementRolePolicyPlan(fixture());assert.ok(hasGate(p,'CANONICAL_MEMBER_BINDING_ABSENT'));assert.ok(hasGate(p,'SOURCE_AUTHORIZATION_VERSION_ABSENT'));
 assert.ok(p.entries.every(e=>e.sourceEvidence.capturedProfileVersion===null&&!e.sourceEvidence.sourceCanonicalMemberIdPresent));assert.ok(p.entries.every(e=>!('memberId'in e)&&e.proposedMemberId.startsWith('member-')));
});
test('output exposes no emails names typed ACL raw payload or token',()=>{
 const p=buildManagementRolePolicyPlan(fixture()),text=JSON.stringify(p);assert.equal(text.includes('@example.invalid'),false);assert.equal(text.includes('Synthetic contact'),false);assert.equal(text.includes('providerData'),false);assert.equal(text.includes('preservedAclDocument'),false);assert.equal(text.includes('token'),false);
});
test('returned output has no mutable input aliases and self hash detects changes',()=>{
 const i=fixture(),p=buildManagementRolePolicyPlan(i);i.humanIntent.policyRefinement.administratorExclusive=false;i.preview.sourceEvidence.profiles[0].permissions.admin=true;
 assert.equal(p.applicationPolicyIntent.administratorExclusive,true);assert.equal(p.resultSha256,managementRolePolicyPlanDigest(p));
 p.entries[0].applicationPolicyIntent.classification='COMMON_USER';assert.notEqual(p.resultSha256,managementRolePolicyPlanDigest(p));
});
test('entries and gates ordered by code unit lexicographic comparison',()=>{
 const p=buildManagementRolePolicyPlan(fixture());assert.deepEqual(p.entries.map(e=>e.faUid),['admin','common','defer','exception','legacy']);assert.deepEqual(p.gates.map(g=>g.code),p.gates.map(g=>g.code).sort());
});
for(const key of ['previewInputSha256','previewSha256','humanIntentSha256'])test('reject mismatch in pin '+key,()=>{const i=fixture();i.pins[key]='0'.repeat(64);assert.throws(()=>buildManagementRolePolicyPlan(i),/INPUT_PIN_MISMATCH/);});
test('reject missing extra and malformed input pins',()=>{for(const mutate of [i=>delete i.pins.humanIntentSha256,i=>i.pins.extra='x',i=>i.pins.humanIntentSha256='not-hash']){const i=fixture();mutate(i);assert.throws(()=>buildManagementRolePolicyPlan(i),/INPUT_PINS_INVALID/);}});
test('reject preview forged despite new digest and matching outer pins',()=>expect(i=>{i.preview.sourceEvidence.profiles[0].permissions.admin=true;delete i.preview.resultSha256;const value=clone(i.preview);i.preview.resultSha256=snapshotDigest(value);},/PREVIEW_REGENERATION_MISMATCH/));
test('reject source or auth hash differing from pinned human intent',()=>expect(i=>i.humanIntent.sourcePins.sourceAuthSha256='0'.repeat(64),/HUMAN_SOURCE_PIN_MISMATCH/));
test('reject divergent readTime without claiming freshness',()=>expect(i=>i.humanIntent.sourceReadTime='2026-10-09T12:00:00Z',/HUMAN_SOURCE_PIN_MISMATCH/));
for(const key of ['mode','instructionSource','schemaVersion'])test('reject unsupported human intent '+key,()=>expect(i=>i.humanIntent[key]=key==='schemaVersion'?2:'UNKNOWN',/HUMAN_INTENT_ENUM_INVALID/));
for(const key of ['productionAuthorized','authorizationReady','policyOverlayImplemented','operationalFreshnessEvaluated','capturesAtomicTogether'])test('reject falsely promoted authority '+key,()=>expect(i=>i.humanIntent[key]=true,/HUMAN_AUTHORITY_MUST_REMAIN_FALSE/));
test('reject extra human key and unsafe artifact reference',()=>{expect(i=>i.humanIntent.extra=true,/HUMAN_INTENT_SCHEMA_INVALID/);expect(i=>i.humanIntent.preservedArtifacts.source='../escape.dpapi.json',/ARTIFACT_REFERENCE_INVALID/);});
test('reject grant effect and enabled surface in human intent',()=>{expect(i=>i.humanIntent.grants.push({admin:true}),/EFFECTS_NOT_EMPTY/);expect(i=>i.humanIntent.effects.firestoreReadsIssued=1,/EFFECTS_NOT_EMPTY/);expect(i=>i.humanIntent.surfaces.management=true,/EFFECTS_NOT_EMPTY/);});
test('reject unknown duplicate or missing human gate',()=>{expect(i=>i.humanIntent.gates[0]='SILENT_ALLOW',/HUMAN_GATES_INVALID/);expect(i=>i.humanIntent.gates.push(i.humanIntent.gates[0]),/HUMAN_GATES_INVALID/);expect(i=>i.humanIntent.gates.pop(),/HUMAN_GATES_INVALID/);});
test('reject reset or grant policy for common users',()=>{expect(i=>i.humanIntent.generalUserPolicyIntent.noAutomaticRoleReset=false,/GENERAL_INTENT_INVALID/);expect(i=>i.humanIntent.generalUserPolicyIntent.classification='RESET_ALL_ROLES',/GENERAL_INTENT_INVALID/);expect(i=>i.humanIntent.generalUserPolicyIntent.effectiveGrants=true,/GENERAL_INTENT_INVALID/);});
test('reject IAM owner or every-area assignment reinterpretation',()=>{expect(i=>i.humanIntent.policyRefinement.applicationAdministratorIsProjectIamOwner=true,/REFINEMENT_INVALID/);expect(i=>admin(i).requestedPolicy.requireTwelveAreaAssignments=true,/EXCLUSIVE_ADMIN_INTENT_INVALID/);expect(i=>admin(i).requestedPolicy.scope='PROJECT_IAM',/EXCLUSIVE_ADMIN_INTENT_INVALID/);});
test('reject loss of operational eligibility preservation',()=>{expect(i=>i.humanIntent.policyRefinement.preserveContentEligibility=false,/REFINEMENT_INVALID/);expect(i=>i.humanIntent.generalUserPolicyIntent.preserveOperationalPermissions=false,/GENERAL_INTENT_INVALID/);});
test('reject duplicated alias same UID and unknown designation',()=>{expect(i=>exception(i).alias='ADMINISTRATOR_DESIGNATED',/DESIGNATIONS_NOT_DISTINCT/);expect(i=>exception(i).faUid='admin',/DESIGNATIONS_NOT_DISTINCT/);expect(i=>admin(i).faUid='unknown',/DESIGNATION_IDENTITY_MISMATCH/);expect(i=>admin(i).alias='ROOT_IAM_OWNER',/DESIGNATION_SCHEMA_INVALID/);});
for(const key of ['sourceAuthRecordSha256','sourceProfileSha256','mappingSha256','sourceAclSha256'])test('reject designation record pin '+key,()=>expect(i=>admin(i)[key]='0'.repeat(64),/DESIGNATION_RECORD_PIN_MISMATCH/));
test('reject designated member mapping fake Google or profile-email lookup',()=>{expect(i=>admin(i).proposedMemberId='fake',/DESIGNATION_IDENTITY_MISMATCH/);expect(i=>admin(i).googleUid='google-fake',/CAPTURED_GOOGLE_BINDING_INVALID/);expect(i=>admin(i).requestedEmail='common@example.invalid',/CAPTURED_GOOGLE_BINDING_INVALID/);});
test('reject observed permission role active or area evidence changes',()=>{expect(i=>admin(i).observed.permissions.admin=true,/CAPTURED_RIGHTS_MISMATCH/);expect(i=>admin(i).observed.role='gestor',/CAPTURED_RIGHTS_MISMATCH/);expect(i=>admin(i).observed.active=false,/CAPTURED_RIGHTS_MISMATCH/);expect(i=>admin(i).observed.managedAreaEvidence.push({areaId:'area-b',version:2,sourceDocumentSha256:'0'.repeat(64)}),/AREA_EVIDENCE_MISMATCH/);});
test('reject fake roster correspondence and do not infer it from email',()=>{expect(i=>admin(i).uniqueness.linkedRosterCounts.contacts=2,/LINKED_ROSTER_EVIDENCE_MISMATCH/);expect(i=>admin(i).uniqueness.googleUidMatches=2,/UNIQUENESS_INVALID/);});
test('reject exception ACL any typed data or metadata tamper',()=>{expect(i=>exception(i).requestedPolicy.preservedAclDocument.fields.groups=typed(['GENERAL']),/EXCEPTION_PRESERVATION_INVALID/);expect(i=>exception(i).requestedPolicy.preservedAclDocument.updateTime='2026-10-07T12:00:00Z',/EXCEPTION_PRESERVATION_INVALID/);expect(i=>exception(i).requestedPolicy.preservedRole='temporario',/EXCEPTION_PRESERVATION_INVALID/);expect(i=>exception(i).requestedPolicy.preservedPermissions={},/EXCEPTION_PRESERVATION_INVALID/);});
test('exception administrator conflicts with exclusivity even while denied',()=>{
 for(const change of [i=>set(i,'users/exception','role','administrador_app'),i=>set(i,'users/exception','permissions',{admin:true,labelsWrite:true}),i=>{set(i,'users/exception','role','administrador_app');set(i,'users/exception','active',false);}])assert.throws(()=>buildManagementRolePolicyPlan(fixture(change)),/EXCEPTION_ADMIN_EXCLUSIVITY_CONFLICT/);
});
test('designated identity without captured Google remains blocked not upgraded',()=>{
 const i=fixture();i.previewInput.sourceAuth.users.find(u=>u.uid==='admin').providerData=[];i.previewInput.sourceAuth.users.find(u=>u.uid==='admin').emailVerified=false;repinPreview(i.previewInput);i.preview=buildManagementAuthorizationPreview(i.previewInput);i.humanIntent=humanIntent(i.previewInput,i.preview);pin(i);
 assert.throws(()=>buildManagementRolePolicyPlan(i),/CAPTURED_GOOGLE_BINDING_INVALID/);
});
test('input mutation rejects getters without invoking private accessor',()=>{
 let called=0;const i=fixture();Object.defineProperty(i.humanIntent,'mode',{enumerable:true,get(){called++;throw Error('must-not-call');}});
 assert.throws(()=>buildManagementRolePolicyPlan(i),/JSON_ACCESSOR/);assert.equal(called,0);
});
test('reject hidden symbol custom prototype cycles and sparse arrays before hashing',()=>{
 const mutations=[i=>Object.defineProperty(i.humanIntent,'hidden',{value:true}),i=>i.humanIntent[Symbol('private')]=true,i=>Object.setPrototypeOf(i.humanIntent,{hidden:true}),i=>i.humanIntent.loop=i.humanIntent,i=>i.humanIntent.designations=new Array(2)];
 for(const mutate of mutations){const i=fixture();mutate(i);assert.throws(()=>buildManagementRolePolicyPlan(i),/JSON_|NOT_PLAIN_JSON/);}
});
test('reject excessive depth strings and nonfinite values before any effect',()=>{
 const i=fixture();i.humanIntent.instructionSource='x'.repeat(16777217);assert.throws(()=>buildManagementRolePolicyPlan(i),/JSON_LIMIT/);
 const n=fixture();n.humanIntent.schemaVersion=NaN;assert.throws(()=>buildManagementRolePolicyPlan(n),/JSON_NUMBER_INVALID/);
 const d=fixture();let nest=d;for(let j=0;j<82;j++)nest=nest.next={};assert.throws(()=>buildManagementRolePolicyPlan(d),/JSON_LIMIT/);
});
test('imports and planning never obtain credentials or call network or clock',()=>{
 const oldFetch=globalThis.fetch,oldNow=Date.now;globalThis.fetch=()=>{throw Error('network-not-allowed');};Date.now=()=>{throw Error('clock-not-authority');};
 try{const p=buildManagementRolePolicyPlan(fixture());assert.equal(p.operationalFreshnessEvaluated,false);assert.deepEqual(p.grants,[]);}finally{globalThis.fetch=oldFetch;Date.now=oldNow;}
});

test('accept captured Firestore INT64 area version without changing source fields',()=>{
 const input=fixture();const sourceBefore=snapshotDigest(input.previewInput.sourceSnapshot);
 for(const d of input.humanIntent.designations)for(const area of d.observed.managedAreaEvidence)area.version=String(area.version);
 pin(input);const result=buildManagementRolePolicyPlan(input);
 assert.equal(snapshotDigest(input.previewInput.sourceSnapshot),sourceBefore);assert.equal(result.productionAuthorized,false);
});
test('reject a decimal area version with another value or noncanonical representation',()=>{
 for(const value of ['2','01','1.0',null,NaN])expect(i=>admin(i).observed.managedAreaEvidence[0].version=value,/AREA_EVIDENCE_MISMATCH|JSON_NUMBER_INVALID/);
});
