import {readFile} from 'node:fs/promises';
import {before, beforeEach, after, test as nativeTest} from 'node:test';
import assert from 'node:assert/strict';
import {doc, setDoc, getDocFromServer, getDocsFromServer, collection, query, where, serverTimestamp, updateDoc, deleteDoc, setLogLevel} from 'firebase/firestore';
import {assertFails, assertSucceeds, initializeTestEnvironment} from '@firebase/rules-unit-testing';

const test = (name, execute) => nativeTest(name, {timeout: 30000}, execute);
const PROJECT = 'demo-sahmt-management-rules', HOST = '127.0.0.1', PORT = 8274;
const permissions = ['admin','managementRead','managementManage','managementActivityWrite','managementIndicatorsRead',
  'managementIndicatorsWrite','managementPlansManage','documentsManage','equipmentManage','qualityManage','trainingsRead','trainingsManage',
  'financeRead','financeWrite','financeManage'];
const clone = value => JSON.parse(JSON.stringify(value));
let env, member, other;
setLogLevel('silent');
function fixture(uid = 'member') {
  const now = Date.now(), memberId = 'member-' + uid;
  const lease = {schemaVersion:1,sourceProjectId:'sahmt-17a16',destinationProjectId:'sahmt-gestao-5ae66',
    faUid:uid,fbUid:uid,memberId,leaseVersion:1,grantId:'fixture-grant',sourceVersion:4,policyVersion:'fixture-policy',
    sourceHash:'a'.repeat(64),active:true,revoked:false,managementAllowed:true,role:'anestesiologista',
    permissions:Object.fromEntries(permissions.map(key=>[key,key==='managementRead'])),
    memberAreaIds:['fixture-area'],managerAreaIds:[],documentGroups:['GENERAL'],
    sourceAuthValidAfterTimeMs:now-120000,confirmedAtMs:now-5000,validUntilMs:now+60000};
  const claims = {firebase:{sign_in_provider:'custom'},managementSourceProjectId:lease.sourceProjectId,
    managementMemberId:memberId,managementSourceVersion:lease.sourceVersion,managementSourceHash:lease.sourceHash,
    managementPolicyVersion:lease.policyVersion,managementSourceAuthTimeMs:now-60000};
  return {uid,lease,claims};
}
const dbFor = (value = member, claims = value.claims) => env.authenticatedContext(value.uid, claims).firestore();
const leaseRef = (db, uid = 'member') => doc(db,'managementAuthorizationLeases',uid);
async function enableEvaluation() {
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'managementRuntime','domainCutover'),{schemaVersion:1,projectId:'sahmt-gestao-5ae66',evaluationEnabled:true});
    await setDoc(doc(db,'evaluationSummaries','member'),{uid:'member',performanceTotal:2});
    await setDoc(doc(db,'evaluationReference','team'),{performanceStatus:'CONFIRMED'});
  });
}
async function seedLease(value) {
  await env.withSecurityRulesDisabled(context=>setDoc(leaseRef(context.firestore(),value.uid),value.lease));
}
before(async () => {
  // Never let this suite silently use the standard port, a cloud project, or a
  // caller-provided endpoint. Only our isolated local emulator is accepted.
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST+':'+PORT,'Dedicated emulator is required');
  env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:HOST,port:PORT,
    rules:(await readFile(new URL('../firestore.management-runtime.rules',import.meta.url),'utf8')).replace(/^\uFEFF/,'')}});
});

test('evaluation is denied without explicit server cutover marker',async()=>{
 await assertFails(getDocFromServer(doc(dbFor(),'evaluationAwards','fixture-award')));
});
test('current lease permits own evaluation and team summary only',async()=>{
 await enableEvaluation();await assertSucceeds(getDocFromServer(doc(dbFor(),'evaluationAwards','fixture-award')));
 await assertSucceeds(getDocFromServer(doc(dbFor(),'evaluationSummaries','member')));
 await assertSucceeds(getDocFromServer(doc(dbFor(),'evaluationReference','team')));
 await assertFails(getDocFromServer(doc(dbFor(other),'evaluationAwards','fixture-award')));
});
test('ledger queries must constrain owner and no browser can award points',async()=>{
 await enableEvaluation();const db=dbFor();
 await assertSucceeds(getDocsFromServer(query(collection(db,'evaluationLedger'),where('uid','==','member'))));
 await assertFails(getDocsFromServer(collection(db,'evaluationLedger')));
 await assertFails(setDoc(doc(db,'evaluationLedger','new'),{uid:'member',points:200}));
 await assertFails(updateDoc(doc(db,'evaluationAwards','fixture-award'),{points:20}));
 await assertFails(deleteDoc(doc(db,'evaluationAwards','fixture-award')));
});
test('expired or revoked lease denies evaluation even with admin claims',async()=>{
 await enableEvaluation();member.lease.revoked=true;await seedLease(member);
 await assertFails(getDocFromServer(doc(dbFor(member,{...member.claims,admin:true}),'evaluationSummaries','member')));
});
test('FA admin role alone does not grant FB management administration',async()=>{
 await enableEvaluation();other.lease.role='administrador_app';await seedLease(other);
 await assertFails(getDocFromServer(doc(dbFor(other),'evaluationAwards','fixture-award')));
 other.lease.permissions.managementManage=true;await seedLease(other);
 await assertSucceeds(getDocFromServer(doc(dbFor(other),'evaluationAwards','fixture-award')));
});
test('source receipts, migration marker and scoring backend state are private',async()=>{
 await enableEvaluation();const db=dbFor();for(const c of ['evaluationSourceReceipts','evaluationRuntime','checklistScoreOutbox','occurrenceScoreClaims']){
 await assertFails(setDoc(doc(db,c,'test'),{uid:'member'}));await assertFails(getDocFromServer(doc(db,c,'test')));}
 await assertFails(updateDoc(doc(db,'managementRuntime','domainCutover'),{evaluationEnabled:true}));
});
test('requests cannot claim awards or impersonate another actor',async()=>{
 await enableEvaluation();const db=dbFor();
 await assertFails(setDoc(doc(db,'evaluationRequests','forged'),{id:'forged',actorUid:'member',type:'AWARD',payload:{points:2},status:'PENDING',createdAt:serverTimestamp()}));
 await assertFails(setDoc(doc(db,'evaluationRequests','other'),{id:'other',actorUid:'other',type:'RECONCILE_LINKS',payload:{},status:'PENDING',createdAt:serverTimestamp()}));
});
test('explicit destination administrator can submit a request but cannot update its result',async()=>{
 await enableEvaluation();member.lease.permissions.managementManage=true;member.lease.permissions.admin=true;await seedLease(member);const db=dbFor(),ref=doc(db,'evaluationRequests','reconcile');
 await assertSucceeds(setDoc(ref,{id:'reconcile',actorUid:'member',type:'RECONCILE_LINKS',payload:{},status:'PENDING',createdAt:serverTimestamp()}));
 await assertFails(updateDoc(ref,{status:'PROCESSED'}));
});
test('activity access groups come from lease, never browser claim',async()=>{
 await enableEvaluation();await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'evaluationActivities','general'),{eligibleUids:[],eligibleGroups:['GENERAL'],managerUid:'manager'}));
 await assertSucceeds(getDocsFromServer(query(collection(dbFor(),'evaluationActivities'),where('eligibleGroups','array-contains','GENERAL'))));
 member.lease.documentGroups=[];await seedLease(member);await assertFails(getDocFromServer(doc(dbFor(member,{...member.claims,groups:['GENERAL']}),'evaluationActivities','general')));
});

test('every identity binding and revocation boundary is required for evaluation',async()=>{
 await enableEvaluation();
 for(const patch of [
   {managementSourceProjectId:'other-project'}, {managementMemberId:'other-member'},
   {managementSourceVersion:999}, {managementSourceHash:'b'.repeat(64)},
   {managementPolicyVersion:'other-policy'}, {managementSourceAuthTimeMs:1},
   {managementSourceAuthTimeMs:Date.now()+60000}, {firebase:{sign_in_provider:'google.com'}}
 ]) await assertFails(getDocFromServer(doc(dbFor(member,{...member.claims,...patch}),'evaluationSummaries','member')));
 for(const patch of [{sourceProjectId:'other'},{destinationProjectId:'other'},{faUid:'other'},
   {fbUid:'other'},{active:false},{managementAllowed:false},{confirmedAtMs:Date.now()+60000},{schemaVersion:2}]) {
   await seedLease({...member,lease:{...member.lease,...patch}});
   await assertFails(getDocFromServer(doc(dbFor(),'evaluationSummaries','member')));
 }
});

test('missing lease and anonymous session never read evaluation',async()=>{
 await enableEvaluation();
 await assertFails(getDocFromServer(doc(env.unauthenticatedContext().firestore(),'evaluationSummaries','member')));
 await env.withSecurityRulesDisabled(c=>deleteDoc(leaseRef(c.firestore())));
 await assertFails(getDocFromServer(doc(dbFor(),'evaluationSummaries','member')));
});

test('group query cannot broaden to another group or an unrestricted scan',async()=>{
 await enableEvaluation();await env.withSecurityRulesDisabled(async c=>{
  for(const group of ['GENERAL','RESTRICTED']) await setDoc(doc(c.firestore(),'evaluationActivities',group),{eligibleUids:[],eligibleGroups:[group],managerUid:'manager'});
 });
 await assertFails(getDocsFromServer(collection(dbFor(),'evaluationActivities')));
 await assertFails(getDocsFromServer(query(collection(dbFor(),'evaluationActivities'),where('eligibleGroups','array-contains','RESTRICTED'))));
 await assertSucceeds(getDocsFromServer(query(collection(dbFor(),'evaluationActivities'),where('eligibleGroups','array-contains','GENERAL'))));
});

test('legacy explicit UID and manager audiences remain accessible without group fields',async()=>{
 await enableEvaluation();await env.withSecurityRulesDisabled(async c=>{
  await setDoc(doc(c.firestore(),'evaluationActivities','legacy'),{eligibleUids:['member'],managerUid:'manager'});
  await setDoc(doc(c.firestore(),'evaluationActivities','managed'),{eligibleUids:[],managerUid:'member'});
 });
 await assertSucceeds(getDocsFromServer(query(collection(dbFor(),'evaluationActivities'),where('eligibleUids','array-contains','member'))));
 await assertSucceeds(getDocsFromServer(query(collection(dbFor(),'evaluationActivities'),where('managerUid','==','member'))));
});
after(async()=>env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();member=fixture();other=fixture('other');
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(leaseRef(db,member.uid),member.lease);await setDoc(leaseRef(db,other.uid),other.lease);
    for(const path of ['users/member','managementAreas/fixture-area','activities/fixture-activity',
      'evaluationAwards/fixture-award','evaluationLedger/fixture-ledger','evaluationParticipations/fixture-participation',
      'evaluationRequests/fixture-request','documents/fixture-document','scopedDocuments/fixture-document',
      'evaluationManagerReviewEvents/fixture-event','managementAuthorizationMirrors/member',
      'managementLeaseFences/fixture-fence','migrationProvenance/fixture-copy','migrationJobs/fixture-job',
      'checklists/fixture-day','managementAuthorizationLeases/member/private/fixture-child']){
      await setDoc(doc(db,path),{uid:'member',areaId:'fixture-area',category:'GOVERNANCE',points:2,active:true});
    }
  });
});

