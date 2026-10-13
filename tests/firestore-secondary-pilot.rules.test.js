import {readFile} from 'node:fs/promises';
import {before, beforeEach, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {collection, doc, getDocFromServer, getDocsFromServer, limit, query, setDoc} from 'firebase/firestore';
import {assertFails, assertSucceeds, initializeTestEnvironment} from '@firebase/rules-unit-testing';

const HOST = '127.0.0.1', PORT = 8193;
const FB_PROJECT = 'demo-sahmt-secondary-fb-rules';
const FC_PROJECT = 'demo-sahmt-secondary-fc-rules';
const PERMISSIONS = ['admin','managementRead','managementManage','managementActivityWrite','managementIndicatorsRead',
  'managementIndicatorsWrite','managementPlansManage','documentsManage','equipmentManage','qualityManage','trainingsManage',
  'trainingsRead','financeRead','financeWrite','financeManage'];
let fb, fc, lease, sourceClaims;
const fbDb = () => fb.authenticatedContext('member-a', sourceClaims).firestore();
const fcDb = claims => fc.authenticatedContext('member-a', claims).firestore();

before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, `${HOST}:${PORT}`, 'Dedicated local Firestore emulator is required');
  const [fbRules, fcRules] = await Promise.all([
    readFile(new URL('../firestore.management.rules', import.meta.url), 'utf8'),
    readFile(new URL('../firestore.indicators-pilot.rules', import.meta.url), 'utf8')
  ]);
  fb = await initializeTestEnvironment({projectId:FB_PROJECT, firestore:{host:HOST,port:PORT,rules:fbRules}});
  fc = await initializeTestEnvironment({projectId:FC_PROJECT, firestore:{host:HOST,port:PORT,rules:fcRules}});
});
after(async () => { await Promise.all([fb?.cleanup(), fc?.cleanup()]); });
beforeEach(async () => {
  await Promise.all([fb.clearFirestore(), fc.clearFirestore()]);
  const now = Date.now();
  sourceClaims = {firebase:{sign_in_provider:'custom'},managementSourceProjectId:'sahmt-17a16',
    managementMemberId:'member-a',managementSourceVersion:3,managementSourceHash:'a'.repeat(64),
    managementPolicyVersion:'pilot-policy',managementSourceAuthTimeMs:now-30000};
  lease = {schemaVersion:1,sourceProjectId:'sahmt-17a16',destinationProjectId:'sahmt-gestao-5ae66',
    faUid:'member-a',fbUid:'member-a',memberId:'member-a',leaseVersion:1,grantId:'pilot-grant',sourceVersion:3,
    policyVersion:'pilot-policy',sourceHash:'a'.repeat(64),active:true,revoked:false,managementAllowed:true,
    role:'profissional',permissions:Object.fromEntries(PERMISSIONS.map(k=>[k,k==='trainingsRead'])),
    memberAreaIds:[],managerAreaIds:[],documentGroups:[],sourceAuthValidAfterTimeMs:now-60000,
    confirmedAtMs:now-10000,validUntilMs:now+60000};
  await fb.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(),'managementAuthorizationLeases/member-a'),lease);
    await setDoc(doc(ctx.firestore(),'trainings','synthetic-training'),{id:'synthetic-training',title:'synthetic'});
    await setDoc(doc(ctx.firestore(),'unclassified','private'),{value:'synthetic'});
  });
  await fc.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(),'indicators','synthetic-indicator'),{id:'synthetic-indicator',title:'synthetic'});
    await setDoc(doc(ctx.firestore(),'managementAreas','private'),{value:'synthetic'});
  });
});

test('FB permite apenas leitura de uma linha de trainings com lease FA atual e permissão de treinamento', async () => {
  await assertSucceeds(getDocFromServer(doc(fbDb(),'managementAuthorizationLeases','member-a')));
  const result = await assertSucceeds(getDocsFromServer(query(collection(fbDb(),'trainings'),limit(1))));
  assert.equal(result.size,1);
});
test('FB bloqueia query sem limite, limite acima de um, perfil sem permissão, lease vencido e escrita', async () => {
  const db=fbDb();
  await assertFails(getDocsFromServer(collection(db,'trainings')));
  await assertFails(getDocsFromServer(query(collection(db,'trainings'),limit(2))));
  const noPermission={...lease,permissions:{...lease.permissions,trainingsRead:false,trainingsManage:false}};
  await fb.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'managementAuthorizationLeases/member-a'),noPermission));
  await assertFails(getDocsFromServer(query(collection(db,'trainings'),limit(1))));
  lease={...lease,permissions:{...lease.permissions,trainingsRead:true}};
  lease.confirmedAtMs=Date.now()-300000;
  lease.validUntilMs=Date.now()-60000;
  await fb.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'managementAuthorizationLeases/member-a'),lease));
  await assertFails(getDocsFromServer(query(collection(db,'trainings'),limit(1))));
  await assertFails(getDocFromServer(doc(db,'trainings','synthetic-training')));
  await assertFails(setDoc(doc(db,'trainings','write-attempt'),{id:'write-attempt'}));
});
test('FB nega identidade secundária sem claims de fonte, consultas a outros dados e UID trocado', async () => {
  const other=fb.authenticatedContext('member-b',{...sourceClaims}).firestore();
  await assertFails(getDocsFromServer(query(collection(other,'trainings'),limit(1))));
  const google=fb.authenticatedContext('member-a',{firebase:{sign_in_provider:'google.com'}}).firestore();
  await assertFails(getDocsFromServer(query(collection(google,'trainings'),limit(1))));
  await assertFails(getDocsFromServer(query(collection(fbDb(),'unclassified'),limit(1))));
});

test('FC permite apenas leitura de uma linha de indicators em sessão custom autenticada pelo broker', async () => {
  const result=await assertSucceeds(getDocsFromServer(query(collection(fcDb({firebase:{sign_in_provider:'custom'}}),'indicators'),limit(1))));
  assert.equal(result.size,1);
});
test('FC bloqueia sessão Google direta, query sem limite, limite acima de um, get, escrita e outras coleções', async () => {
  const custom=fcDb({firebase:{sign_in_provider:'custom'}});
  await assertFails(getDocsFromServer(collection(custom,'indicators')));
  await assertFails(getDocsFromServer(query(collection(custom,'indicators'),limit(2))));
  await assertFails(getDocFromServer(doc(custom,'indicators','synthetic-indicator')));
  await assertFails(setDoc(doc(custom,'indicators','write-attempt'),{id:'write-attempt'}));
  await assertFails(getDocsFromServer(query(collection(custom,'managementAreas'),limit(1))));
  const google=fcDb({firebase:{sign_in_provider:'google.com'}});
  await assertFails(getDocsFromServer(query(collection(google,'indicators'),limit(1))));
});
