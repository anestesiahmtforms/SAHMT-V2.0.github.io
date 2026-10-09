import {readFile} from 'node:fs/promises';
import {before, beforeEach, after, test as nativeTest} from 'node:test';
import assert from 'node:assert/strict';
import {doc, setDoc, getDocFromServer, getDocsFromServer, collection, query, where, updateDoc, deleteDoc, setLogLevel} from 'firebase/firestore';
import {assertFails, assertSucceeds, initializeTestEnvironment} from '@firebase/rules-unit-testing';

const test = (name, execute) => nativeTest(name, {timeout: 30000}, execute);
const PROJECT = 'demo-sahmt-management-rules', HOST = '127.0.0.1', PORT = 8187;
const permissions = ['admin','managementRead','managementManage','managementActivityWrite','managementIndicatorsRead',
  'managementIndicatorsWrite','managementPlansManage','documentsManage','equipmentManage','qualityManage','trainingsManage',
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
async function seedLease(value) {
  await env.withSecurityRulesDisabled(context=>setDoc(leaseRef(context.firestore(),value.uid),value.lease));
}
before(async () => {
  // Never let this suite silently use the standard port, a cloud project, or a
  // caller-provided endpoint. Only our isolated local emulator is accepted.
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST+':'+PORT,'Dedicated emulator is required');
  env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:HOST,port:PORT,
    rules:(await readFile(new URL('../firestore.management.rules',import.meta.url),'utf8')).replace(/^\uFEFF/,'')}});
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

test('lease próprio completo, vigente e ligado às claims é legível por get',async()=>{
  const result=await assertSucceeds(getDocFromServer(leaseRef(dbFor())));
  assert.equal(result.exists(),true);assert.equal(result.data().memberId,member.lease.memberId);
});

test('terceiros não leem o lease, mesmo quando alegam papel ou claim admin',async()=>{
  await assertFails(getDocFromServer(leaseRef(dbFor(other))));
  await assertFails(getDocFromServer(leaseRef(dbFor(other,{...other.claims,admin:true,role:'administrador_app'}))));
  await assertFails(getDocFromServer(leaseRef(dbFor(member),other.uid)));
});

test('listas e consultas filtradas de leases são negadas inclusive ao próprio membro',async()=>{
  const db=dbFor();
  await assertFails(getDocsFromServer(collection(db,'managementAuthorizationLeases')));
  await assertFails(getDocsFromServer(query(collection(db,'managementAuthorizationLeases'),where('fbUid','==',member.uid))));
});

test('cliente não cria, altera, apaga ou substitui lease',async()=>{
  const db=dbFor();
  await assertFails(setDoc(leaseRef(db,'new-member'),member.lease));
  await assertFails(setDoc(leaseRef(db),{...member.lease,validUntilMs:Date.now()+86400000}));
  await assertFails(updateDoc(leaseRef(db),{revoked:false,permissions:{admin:true}}));
  await assertFails(deleteDoc(leaseRef(db)));
});

test('sem Auth, Google direto FB, claims ausentes ou provider diferente mantêm negação',async()=>{
  await assertFails(getDocFromServer(leaseRef(env.unauthenticatedContext().firestore())));
  await assertFails(getDocFromServer(leaseRef(dbFor(member,{email_verified:true,firebase:{sign_in_provider:'google.com'}}))));
  for(const provider of ['google.com','password','anonymous']){
    await assertFails(getDocFromServer(leaseRef(dbFor(member,{...member.claims,firebase:{sign_in_provider:provider}}))));
  }
  await assertFails(getDocFromServer(leaseRef(dbFor(member,{...member.claims,firebase:{}}))));
  await assertFails(getDocFromServer(leaseRef(dbFor(member,{...member.claims,firebase:null}))));
  // The SDK fills firebase=custom when omitted; remove only custom management
  // claims here, rather than mistaking that injected default for a Rules grant.
  for(const key of Object.keys(member.claims).filter(key=>key!=='firebase')){
    const claims=clone(member.claims);delete claims[key];
    await assertFails(getDocFromServer(leaseRef(dbFor(member,claims))));
  }
});

test('claim membro/fonte/versão/hash/política/authTime divergente não autoriza lease',async()=>{
  for(const change of [{managementSourceProjectId:'sahmt-gestao-5ae66'}, {managementMemberId:'member-other'},
    {managementSourceVersion:3}, {managementSourceVersion:4.5}, {managementSourceVersion:'4'},
    {managementSourceHash:'b'.repeat(64)}, {managementSourceHash:'invalid'}, {managementPolicyVersion:'other-policy'},
    {managementSourceAuthTimeMs:member.lease.sourceAuthValidAfterTimeMs-1},
    {managementSourceAuthTimeMs:Date.now()+60000}, {managementSourceAuthTimeMs:0}]){
    await assertFails(getDocFromServer(leaseRef(dbFor(member,{...member.claims,...change}))));
  }
});

test('revogação, inatividade ou managementAllowed falso bloqueiam leitura subsequente',async()=>{
  for(const change of [{revoked:true},{active:false},{managementAllowed:false}]){
    member.lease={...fixture().lease,...change};await seedLease(member);
    await assertFails(getDocFromServer(leaseRef(dbFor())));
  }
});

test('prazo e confirmação usam horário do servidor; lease ausente, vencido ou futuro é negado',async()=>{
  await env.withSecurityRulesDisabled(context=>deleteDoc(leaseRef(context.firestore())));
  await assertFails(getDocFromServer(leaseRef(dbFor())));
  const now=Date.now();
  for(const change of [{validUntilMs:now-1},{confirmedAtMs:now+60000,validUntilMs:now+120000},
    {validUntilMs:member.lease.confirmedAtMs},{confirmedAtMs:0},{validUntilMs:'later'}]){
    member.lease={...fixture().lease,...change};await seedLease(member);
    await assertFails(getDocFromServer(leaseRef(dbFor())));
  }
});

test('schema/payload extra, identidade ou origem documental divergente falham fechados',async()=>{
  for(const change of [{schemaVersion:2},{faUid:'other'},{fbUid:'other'},{memberId:'member-other'},
    {sourceProjectId:'other-project'},{destinationProjectId:'other-project'},{sourceVersion:5},
    {sourceHash:'b'.repeat(64)},{policyVersion:'other-policy'},{leaseVersion:0},{grantId:''},
    {permissions:{admin:true}},{permissions:{...member.lease.permissions,admin:'true'}},
    {permissions:{...member.lease.permissions,unapproved:true}},{memberAreaIds:{}},{managerAreaIds:{}},
    {memberAreaIds:['area','area']},{documentGroups:['PUBLIC']},{documentGroups:['GENERAL','GENERAL']},
    {privateToken:'never-expose'}]){
    member.lease={...fixture().lease,...change};await seedLease(member);
    await assertFails(getDocFromServer(leaseRef(dbFor())));
  }
});

test('todos os recursos e descendentes ficam negados apesar de lease ou permissões administrativas',async()=>{
  member.lease.permissions=Object.fromEntries(permissions.map(key=>[key,true]));
  member.lease.role='administrador_app';member.lease.managerAreaIds=['fixture-area'];member.lease.documentGroups=['GENERAL','RESTRICTED'];
  await seedLease(member);
  const db=dbFor();await assertSucceeds(getDocFromServer(leaseRef(db)));
  for(const path of ['users/member','managementAreas/fixture-area','activities/fixture-activity',
    'evaluationAwards/fixture-award','evaluationLedger/fixture-ledger','evaluationParticipations/fixture-participation',
    'evaluationRequests/fixture-request','documents/fixture-document','scopedDocuments/fixture-document',
    'evaluationManagerReviewEvents/fixture-event','managementAuthorizationMirrors/member','managementLeaseFences/fixture-fence',
    'migrationProvenance/fixture-copy','migrationJobs/fixture-job','checklists/fixture-day',
    'managementAuthorizationLeases/member/private/fixture-child','unclassified/fixture-resource']){
    await assertFails(getDocFromServer(doc(db,path)));await assertFails(setDoc(doc(db,path),{uid:'member',points:999}));
    await assertFails(updateDoc(doc(db,path),{points:999}));await assertFails(deleteDoc(doc(db,path)));
  }
  await assertFails(getDocsFromServer(collection(db,'activities')));
  await assertFails(getDocsFromServer(query(collection(db,'evaluationAwards'),where('uid','==','member'))));
});

test('somente leaseVersion/grant novos não isolam sessão antiga da mesma fonte; limite documentado',async()=>{
  member.lease.leaseVersion=2;member.lease.grantId='renewed-grant';member.lease.validUntilMs=Date.now()+60000;await seedLease(member);
  await assertSucceeds(getDocFromServer(leaseRef(dbFor())));
  member.lease.sourceVersion++;await seedLease(member);
  await assertFails(getDocFromServer(leaseRef(dbFor())));
});

test('expiração em get novo não depende de signOut ou refresh de claims do cliente',async()=>{
  const db=dbFor();await assertSucceeds(getDocFromServer(leaseRef(db)));
  member.lease.validUntilMs=Date.now()-1;await seedLease(member);
  // Use an independent SDK context with identical claims, forcing a fresh
  // server request. Previously received snapshots cannot be remotely retracted.
  await assertFails(getDocFromServer(leaseRef(dbFor())));
});
