import {readFile} from 'node:fs/promises';
import {after, before, beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {collection, doc, getDocFromServer, getDocsFromServer, limit, query, runTransaction, serverTimestamp, setDoc, updateDoc} from 'firebase/firestore';
import {assertFails, assertSucceeds, initializeTestEnvironment} from '@firebase/rules-unit-testing';

const HOST='127.0.0.1',PORT=Number(process.env.SAHMT_OCCURRENCES_TEST_PORT || 18491),PROJECT='demo-sahmt-occurrence-rules';
const uid='member-synthetic',id='10000000-0000-4000-8000-000000000001';
let env;
const claims=(extra={})=>({firebase:{sign_in_provider:'custom'},sahmtFaSourceProjectId:'sahmt-17a16',...extra});
const writer=()=>env.authenticatedContext(uid,claims({sahmtOccurrencesCatalogRead:true,sahmtOccurrencesWrite:true})).firestore();
const reader=()=>env.authenticatedContext('reader-synthetic',claims({sahmtOccurrencesCatalogRead:true,sahmtOccurrencesRead:true})).firestore();
const auditor=()=>env.authenticatedContext('auditor-synthetic',claims({sahmtOccurrencesAuditRead:true})).firestore();
const reportData=(overrides={})=>({schemaVersion:1,id,formId:'F01',formTitle:'Formulário sintético',occurredOn:'2026-10-12',
  occurrence:'Ocorrência sintética',description:'Descrição sintética',classification:{},details:{attendance:'Caso sintético'},
  anonymous:true,authorLabel:'Anônimo',pointsClaimed:2,pointsStatus:'PENDING_VALIDATION',createdAt:serverTimestamp(),...overrides});
const auditData=(overrides={})=>({schemaVersion:1,reportId:id,uid,formId:'F01',anonymous:true,createdAt:serverTimestamp(),...overrides});
const scoreData=(overrides={})=>({schemaVersion:1,id,source:'REGISTRO_OCORRENCIA',sourceId:id,uid,formId:'F01',points:2,status:'PENDING_VALIDATION',createdAt:serverTimestamp(),...overrides});
async function commitAll(db,{report=reportData(),audit=auditData(),score=scoreData()}={}) {
  return runTransaction(db,async tx=>{
    await Promise.all(['occurrenceReports','occurrenceAudit','occurrenceScoreClaims'].map(name=>tx.get(doc(db,name,id))));
    tx.set(doc(db,'occurrenceReports',id),report); tx.set(doc(db,'occurrenceAudit',id),audit); tx.set(doc(db,'occurrenceScoreClaims',id),score);
  });
}

before(async()=>{
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,`${HOST}:${PORT}`,'Dedicated local Firestore emulator is required');
  const rules=await readFile(new URL('../firestore.occurrences.rules',import.meta.url),'utf8');
  env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:HOST,port:PORT,rules}});
});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'occurrenceCatalogs','current'),{schemaVersion:1,catalogs:{synthetic:['safe']}}));
});

test('writer lê o catálogo autorizado e persiste relato, auditoria e claim no mesmo commit',async()=>{
  const db=writer();
  await assertSucceeds(getDocFromServer(doc(db,'occurrenceCatalogs','current')));
  await assertSucceeds(commitAll(db));
  assert.equal((await getDocFromServer(doc(db,'occurrenceReports',id))).exists(),true);
  assert.equal((await getDocFromServer(doc(db,'occurrenceAudit',id))).data().uid,uid);
  assert.equal((await getDocFromServer(doc(db,'occurrenceScoreClaims',id))).data().points,2);
});

test('nega catálogo sem claim, origem Google direta e fonte diferente de FA',async()=>{
  await assertFails(getDocFromServer(doc(env.authenticatedContext(uid,claims()).firestore(),'occurrenceCatalogs','current')));
  const google=env.authenticatedContext(uid,{firebase:{sign_in_provider:'google.com'},sahmtFaSourceProjectId:'sahmt-17a16',sahmtOccurrencesCatalogRead:true}).firestore();
  await assertFails(getDocFromServer(doc(google,'occurrenceCatalogs','current')));
  const otherSource=env.authenticatedContext(uid,{...claims({sahmtOccurrencesCatalogRead:true}),sahmtFaSourceProjectId:'another-project'}).firestore();
  await assertFails(getDocFromServer(doc(otherSource,'occurrenceCatalogs','current')));
});

test('nega gravação sem par transacional, com UID divergente ou pontuação adulterada',async()=>{
  const db=writer();
  await assertFails(setDoc(doc(db,'occurrenceReports',id),reportData()));
  await assertFails(commitAll(db,{audit:auditData({uid:'other-user'})}));
  await assertFails(commitAll(db,{score:scoreData({points:200})}));
  await assertFails(commitAll(env.authenticatedContext('other-user',claims({sahmtOccurrencesWrite:true})).firestore()));
});

test('nega exposição de autoria, lista a gravadores sem permissão e acesso de outros UIDs',async()=>{
  const db=writer(); await assertSucceeds(commitAll(db));
  const readDb=reader();
  const reports=await assertSucceeds(getDocsFromServer(query(collection(readDb,'occurrenceReports'),limit(50))));
  assert.equal(reports.size,1);
  await assertFails(getDocFromServer(doc(readDb,'occurrenceAudit',id)));
  await assertFails(getDocFromServer(doc(readDb,'occurrenceScoreClaims',id)));
  await assertFails(getDocsFromServer(collection(db,'occurrenceReports')));
  await assertSucceeds(getDocFromServer(doc(auditor(),'occurrenceAudit',id)));
  await assertFails(updateDoc(doc(db,'occurrenceReports',id),{authorLabel:'alterado'}));
  await assertFails(updateDoc(doc(db,'occurrenceScoreClaims',id),{points:200}));
});
