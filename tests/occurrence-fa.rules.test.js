import {readFile} from 'node:fs/promises';import {before,beforeEach,after,test} from 'node:test';import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,query,limit,getDocFromServer,getDocsFromServer,runTransaction,setDoc,updateDoc,serverTimestamp} from 'firebase/firestore';
const PROJECT='demo-sahmt-v2',PORT=8279,uid='synthetic-member',id='10000000-0000-4000-8000-000000000001';let env;
const user=(id=uid)=>env.authenticatedContext(id,{firebase:{sign_in_provider:'google.com'}}).firestore();
const report=(extra={})=>({schemaVersion:1,id,formId:'F01',formTitle:'Synthetic',occurredOn:'2026-10-15',occurrence:'Synthetic',description:'Synthetic',classification:{},details:{},anonymous:true,authorLabel:'Anônimo',pointsClaimed:2,pointsStatus:'PENDING_VALIDATION',createdAt:serverTimestamp(),...extra});
const audit=(extra={})=>({schemaVersion:1,reportId:id,uid,formId:'F01',anonymous:true,createdAt:serverTimestamp(),...extra});
const claim=(extra={})=>({schemaVersion:1,id,source:'REGISTRO_OCORRENCIA',sourceId:id,originProjectId:'sahmt-17a16',uid,formId:'F01',points:2,status:'PENDING_VALIDATION',createdAt:serverTimestamp(),...extra});
const seed=(collection,id,fields)=>env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),collection,id),fields));
const commit=(db,{r=report(),a=audit(),c=claim()}={})=>runTransaction(db,async tx=>{
 await Promise.all(['occurrenceReports','occurrenceAudit','occurrenceScoreClaims'].map(name=>tx.get(doc(db,name,id))));
 tx.set(doc(db,'occurrenceReports',id),r);tx.set(doc(db,'occurrenceAudit',id),a);tx.set(doc(db,'occurrenceScoreClaims',id),c);
});
before(async()=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:'+PORT);
 env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:PORT,rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
});
after(async()=>env?.cleanup());
beforeEach(async()=>{
 await env.clearFirestore();
 await seed('occurrenceRuntime','faConsolidation',{status:'ACTIVE'});
 await seed('occurrenceCatalogs','current',{schemaVersion:1,catalogs:{synthetic:['safe']}});
 for(const [id,permissions]of [[uid,{}],['reader',{occurrencesRead:true}],['auditor',{occurrencesAuditRead:true}]])
  await seed('users',id,{uid:id,active:true,access:true,role:'usuario',permissions});
});
test('one FA Google identity writes all three linked documents; narrative has no UID',async()=>{
 const db=user();await assertSucceeds(getDocFromServer(doc(db,'occurrenceCatalogs','current')));await assertSucceeds(commit(db));
 const r=(await getDocFromServer(doc(db,'occurrenceReports',id))).data();assert.equal(r.authorLabel,'Anônimo');assert.equal(r.uid,undefined);
 assert.equal((await getDocFromServer(doc(db,'occurrenceAudit',id))).data().uid,uid);
});
test('unauthenticated unknown inactive denied or mismatched profile identities cannot read catalog or write',async()=>{
 for(const [name,extra]of [['inactive',{active:false}],['denied',{access:false}],['mismatch',{uid:'another'}]])
  await seed('users',name,{uid:name,active:true,access:true,permissions:{},...extra});
 for(const db of [env.unauthenticatedContext().firestore(),user('unknown'),user('inactive'),user('denied'),user('mismatch')]){
  await assertFails(getDocFromServer(doc(db,'occurrenceCatalogs','current')));await assertFails(commit(db));
 }
});
test('anonymous report readers cannot obtain the private author; role alone cannot grant audit',async()=>{
 await assertSucceeds(commit(user()));
 const reader=user('reader');assert.equal((await assertSucceeds(getDocsFromServer(query(collection(reader,'occurrenceReports'),limit(50))))).size,1);
 await assertFails(getDocFromServer(doc(reader,'occurrenceAudit',id)));await assertFails(getDocFromServer(doc(reader,'occurrenceScoreClaims',id)));
 await assertSucceeds(getDocFromServer(doc(user('auditor'),'occurrenceAudit',id)));
 await seed('users','admin',{uid:'admin',active:true,access:true,role:'administrador_app',permissions:{}});
 await assertFails(getDocFromServer(doc(user('admin'),'occurrenceAudit',id)));
 await assertFails(getDocsFromServer(query(collection(user(),'occurrenceReports'),limit(50))));
 await assertFails(getDocsFromServer(collection(reader,'occurrenceReports')));
});
test('single-document writes, forged author, origin, amount, report UID and partial tuple are denied',async()=>{
 const db=user();await assertFails(setDoc(doc(db,'occurrenceReports',id),report()));
 for(const patch of [{a:audit({uid:'other'})},{c:claim({points:200})},{c:claim({originProjectId:'indicadores---sahmt'})},
  {r:report({uid})},{r:report({anonymous:true,authorLabel:'Identified'})},{c:claim({formId:'F02'})}])await assertFails(commit(db,patch));
});
test('browser cannot edit points, overwrite prior report, grant audit or activate a cutover',async()=>{
 const db=user();await assertSucceeds(commit(db));
 await assertFails(updateDoc(doc(db,'occurrenceScoreClaims',id),{points:200}));await assertFails(updateDoc(doc(db,'occurrenceReports',id),{authorLabel:'Changed'}));
 await assertFails(updateDoc(doc(db,'users',uid),{permissions:{occurrencesAuditRead:true}}));
 await assertFails(setDoc(doc(db,'occurrenceRuntime','faConsolidation'),{status:'ACTIVE'}));
 await assertFails(commit(db));
});
test('retired or absent activation marker closes all new occurrence writes',async()=>{
 await seed('occurrenceRuntime','faConsolidation',{status:'PREPARING'});await assertFails(commit(user()));
 await assertFails(getDocFromServer(doc(user(),'occurrenceCatalogs','current')));
});
