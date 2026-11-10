import {readFile} from 'node:fs/promises';
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocFromServer,getDocs,limit,query,runTransaction,serverTimestamp,setDoc,writeBatch} from 'firebase/firestore';
import {OCCURRENCE_CATALOG_SPECS} from '../src/occurrence-schema.js';
import {createOccurrenceRepository} from '../src/occurrence-data.js';

const emulatorHost=process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:18493';
const [host,portText]=emulatorHost.split(':');
const port=Number(portText),project='demo-sahmt-fc-modules',uid='writer-synthetic',id='10000000-0000-4000-8000-000000000001';let env;
const google=(userId,claims={})=>env.authenticatedContext(userId,{firebase:{sign_in_provider:'google.com'},aud:'indicadores---sahmt',iss:'https://securetoken.google.com/indicadores---sahmt',sub:userId,...claims}).firestore();
const catalogs=Object.fromEntries(Object.entries(OCCURRENCE_CATALOG_SPECS).map(([key,spec])=>[key,Array.from({length:spec.count},(_,i)=>`Opção sintética ${i+1}`)]));
before(async()=>{assert.ok(host&&Number.isInteger(port)&&port>0,`Invalid FIRESTORE_EMULATOR_HOST: ${emulatorHost}`);env=await initializeTestEnvironment({projectId:project,firestore:{host,port,rules:await readFile(new URL('../firestore.fc.rules',import.meta.url),'utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{
 const db=c.firestore();await Promise.all([
  setDoc(doc(db,'users',uid),{uid,active:true,access:true,permissions:{occurrencesCatalogRead:true,occurrencesWrite:true}}),
  setDoc(doc(db,'users','reader-synthetic'),{uid:'reader-synthetic',active:true,access:true,permissions:{occurrencesRead:true}}),
  setDoc(doc(db,'users','unauthorized-synthetic'),{uid:'unauthorized-synthetic',active:true,access:true,permissions:{}}),
  setDoc(doc(db,'occurrenceCatalogs/current'),{schemaVersion:1,catalogs})
 ]);
});});
test('FC Google user reads only own profile and an authorized writer commits paired occurrence records',async()=>{
 const db=google(uid);await assertSucceeds(getDoc(doc(db,'users',uid)));await assertFails(getDoc(doc(db,'users','reader-synthetic')));
 await assertSucceeds(getDoc(doc(db,'occurrenceCatalogs/current')));
 const report={schemaVersion:1,id,formId:'F01',formTitle:'Registro sintético',occurredOn:'2026-10-23',occurrence:'Sintética',description:'Descrição sintética',classification:{},details:{},anonymous:true,authorLabel:'Anônimo',pointsClaimed:2,pointsStatus:'PENDING_VALIDATION',createdAt:serverTimestamp()};
 const audit={schemaVersion:1,reportId:id,uid,formId:'F01',anonymous:true,createdAt:serverTimestamp()};
 const claim={schemaVersion:1,id,source:'REGISTRO_OCORRENCIA',sourceId:id,uid,formId:'F01',points:2,status:'PENDING_VALIDATION',createdAt:serverTimestamp()};
 await assertSucceeds(runTransaction(db,async tx=>{
  const refs=['occurrenceReports','occurrenceAudit','occurrenceScoreClaims'].map(name=>doc(db,name,id));
  const existing=await Promise.all(refs.map(ref=>tx.get(ref)));assert.ok(existing.every(s=>!s.exists()));
  tx.set(refs[0],report);tx.set(refs[1],audit);tx.set(refs[2],claim);
 }));
 const reader=google('reader-synthetic'),rows=await assertSucceeds(getDocs(query(collection(reader,'occurrenceReports'),limit(50))));assert.equal(rows.size,1);
});
test('FC denies occurrence reads and writes without the matching local permission',async()=>{
 const db=google('unauthorized-synthetic');await assertFails(getDoc(doc(db,'occurrenceCatalogs/current')));
 await assertFails(getDocs(query(collection(db,'occurrenceReports'),limit(50))));
 await assertFails(setDoc(doc(db,'occurrenceReports',id),{id}));
});

test('administrator with registration permission opens the current catalog and saves the actual F10 payload',async()=>{
 const adminUid='administrator-synthetic',database=google(adminUid);
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'users',adminUid),{
  uid:adminUid,active:true,access:true,role:'administrador_app',permissions:{occurrencesWrite:true}
 }));
 const repository=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},
  auth:{currentUser:{uid:adminUid}},notifyScore:async()=>{},firestore:{
   doc:(_,name,key)=>doc(database,name,key),getDocFromServer,
   runTransaction:(_,callback)=>runTransaction(database,callback)
  }});
 const loaded=await repository.loadCatalog({uid:adminUid});
 assert.equal(loaded.schemaVersion,1);
 const result=await repository.save({uid:adminUid,recordId:id,formId:'F10',displayName:'Administrador sintético',
  values:{sourceSector:loaded.catalogs.SETORES_55[0],destinationSector:loaded.catalogs.SETORES_55[1]}});
 assert.equal(result.status,'saved');
 const report=(await getDoc(doc(database,'occurrenceReports',id))).data();
 assert.equal(report.formId,'F10');assert.equal(report.authorLabel,'Administrador sintético');
 const claim=(await getDoc(doc(database,'occurrenceScoreClaims',id))).data();
 assert.equal(claim.originProjectId,'indicadores---sahmt');
});

test('catalog access follows registration authorization and rejects blocked or read-only profiles',async()=>{
 await env.withSecurityRulesDisabled(async c=>{
  await setDoc(doc(c.firestore(),'users','writer-without-catalog'),{uid:'writer-without-catalog',active:true,access:true,permissions:{occurrencesWrite:true}});
  await setDoc(doc(c.firestore(),'users','blocked-writer'),{uid:'blocked-writer',active:false,access:true,permissions:{occurrencesWrite:true}});
 });
 await assertSucceeds(getDoc(doc(google('writer-without-catalog'),'occurrenceCatalogs/current')));
 for(const actor of ['reader-synthetic','unauthorized-synthetic','blocked-writer']){
  await assertFails(getDoc(doc(google(actor),'occurrenceCatalogs/current')));
 }
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'runtimePolicy','folders'),{
  schemaVersion:1,revision:1,disabled:['registros/ocorrencias']
 }));
 await assertFails(getDocFromServer(doc(google('writer-without-catalog'),'occurrenceCatalogs/current')));
});

test('occurrence score claims reject a foreign project even in a paired write',async()=>{
 const database=google(uid),batch=writeBatch(database);
 batch.set(doc(database,'occurrenceReports',id),{schemaVersion:1,id,formId:'F10',formTitle:'Sintético',occurredOn:null,
  occurrence:null,description:null,classification:{},details:{},anonymous:false,authorLabel:'Sintético',
  pointsClaimed:2,pointsStatus:'PENDING_VALIDATION',createdAt:serverTimestamp()});
 batch.set(doc(database,'occurrenceAudit',id),{schemaVersion:1,reportId:id,uid,formId:'F10',anonymous:false,createdAt:serverTimestamp()});
 batch.set(doc(database,'occurrenceScoreClaims',id),{schemaVersion:1,id,source:'REGISTRO_OCORRENCIA',sourceId:id,
  originProjectId:'other-project',uid,formId:'F10',points:2,status:'PENDING_VALIDATION',createdAt:serverTimestamp()});
 await assertFails(batch.commit());
});
