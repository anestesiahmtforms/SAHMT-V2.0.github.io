import {readFile} from 'node:fs/promises';
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocFromServer,getDocs,limit,query,runTransaction,serverTimestamp,setDoc,updateDoc,writeBatch} from 'firebase/firestore';
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
 assert.equal(result.protocol,'GRA 001');
 const report=(await getDoc(doc(database,'occurrenceReports',id))).data();
 assert.equal(report.formId,'F10');assert.equal(report.authorLabel,'Administrador sintético');
 const claim=(await getDoc(doc(database,'occurrenceScoreClaims',id))).data();
 assert.equal(claim.originProjectId,'indicadores---sahmt');
});

test('a numeração FC é consecutiva em gravações concorrentes e o contador não pode avançar sozinho',async()=>{
 const db=google(uid);
 const repository=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},
  auth:{currentUser:{uid}},notifyScore:async()=>{},firestore:{doc:(_,name,key)=>doc(db,name,key),getDocFromServer,
   runTransaction:(_,callback)=>runTransaction(db,callback)}});
 const data={uid,formId:'F10',displayName:'Autor sintético',catalogs,
  values:{sourceSector:catalogs.SETORES_55[0],destinationSector:catalogs.SETORES_55[1]}};
 const ids=[id,'10000000-0000-4000-8000-000000000002'];
 const results=await Promise.all(ids.map(recordId=>repository.save({...data,recordId})));
 assert.deepEqual(results.map(result=>result.protocol).sort(),['GRA 001','GRA 002']);
 assert.equal((await repository.save({...data,recordId:id})).protocol,results[0].protocol);
 await assertFails(setDoc(doc(db,'occurrenceSequences','app'),{last:3,reportId:id}));
 assert.equal((await getDocFromServer(doc(db,'occurrenceSequences','app'))).data().last,2);
});

test('a equipe consulta a cópia sem autoria e grava somente a própria análise completa',async()=>{
 const db=google(uid),member='unauthorized-synthetic',memberDb=google(member);
 const repository=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},
  auth:{currentUser:{uid}},notifyScore:async()=>{},firestore:{doc:(_,name,key)=>doc(db,name,key),getDocFromServer,
   runTransaction:(_,callback)=>runTransaction(db,callback)}});
 await repository.save({uid,formId:'F10',recordId:id,displayName:'Autor sintético',catalogs,
  values:{sourceSector:catalogs.SETORES_55[0],destinationSector:catalogs.SETORES_55[1],patientOrAttendance:'Paciente sintético'}});
 await assertFails(getDocFromServer(doc(memberDb,'occurrenceReports',id)));
 await assertFails(getDocFromServer(doc(memberDb,'occurrenceAudit',id)));
 const visible=await assertSucceeds(getDocs(query(collection(memberDb,'occurrenceFollowups'),limit(30))));
 assert.equal(visible.size,1);
 assert.doesNotMatch(JSON.stringify(visible.docs[0].data()),/Autor sintético|Paciente sintético|patientOrAttendance|authorLabel/);
 const ref=doc(memberDb,'occurrenceFollowups',id,'analyses',member);
 const valid={problem:'Problema',cause:'Causa',review:'Análise',correction:'Correção',plan:'Plano'};
 await assertFails(setDoc(ref,{analysis:{problem:'Incompleta'},updatedAt:serverTimestamp()}));
 await assertFails(setDoc(ref,{analysis:{...valid,plan:'  \n'},updatedAt:serverTimestamp()}));
 await assertFails(setDoc(doc(memberDb,'occurrenceFollowups',id,'analyses',uid),{analysis:valid,updatedAt:serverTimestamp()}));
 await assertSucceeds(setDoc(ref,{analysis:valid,updatedAt:serverTimestamp()}));
 await assertFails(getDocFromServer(doc(db,'occurrenceFollowups',id,'analyses',member)));
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'runtimePolicy','folders'),{schemaVersion:1,revision:2,disabled:['registros']}));
 await assertSucceeds(getDocFromServer(doc(memberDb,'occurrenceFollowups',id)));
 await assertFails(setDoc(ref,{analysis:valid,updatedAt:serverTimestamp()}));
});

test('a projeção do formulário mais extenso preserva contexto e não expõe o atendimento',async()=>{
 const db=google(uid);
 const repository=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},
  auth:{currentUser:{uid}},notifyScore:async()=>{},firestore:{doc:(_,name,key)=>doc(db,name,key),getDocFromServer,
   runTransaction:(_,callback)=>runTransaction(db,callback)}});
 const values={eventDate:'2026-11-20',occurrence:'Queda',description:'Relato sintético',attendance:'Identificador sintético',
  causingSector:catalogs.SETORES_9[0],fallDate:'2026-11-20',fallTime:'08:00',fallRisk:catalogs.RISCO_QUEDA[0],
  fallRiskGuidance:catalogs.SIM_NAO_NI[0],lastAssessmentDate:'2026-11-19',redWristband:catalogs.SIM_NAO_NI[0],
  fallLocation:catalogs.LOCAL_QUEDA[0],fallMechanism:catalogs.MECANISMO_QUEDA[0],adequateFootwear:catalogs.SIM_NAO_NI[0],
  consciousness:catalogs.CONSCIENCIA[0],injury:catalogs.SIM_NAO_NI[0],symptomAfterEvent:catalogs.SIM_NAO_NI[0],
  immediateAction:'Ação sintética',eventPeriod:catalogs.PERIODO[0]};
 assert.equal((await repository.save({uid,formId:'F05',recordId:id,displayName:'Autor sintético',catalogs,values})).protocol,'GRA 001');
 const entry=await assertSucceeds(getDocFromServer(doc(google('unauthorized-synthetic'),'occurrenceFollowups',id)));
 assert.equal(entry.data().details.fallTime,'08:00');
 assert.equal(Object.hasOwn(entry.data().details,'attendance'),false);
});

test('somente administrador delega registros GR, cujo protocolo preserva unicidade e não gera pontuação',async()=>{
 const admin='occurrence-admin',member='unauthorized-synthetic',memberDb=google(member),adminDb=google(admin);
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'users',admin),{uid:admin,active:true,access:true,role:'administrador_app'}));
 const repository=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},auth:{currentUser:{uid:member}},
  firestore:{doc:(_,name,key)=>doc(memberDb,name,key),getDocFromServer,runTransaction:(_,callback)=>runTransaction(memberDb,callback)}});
 const payload={uid:member,formId:'F03',number:'GR 004',occurredOn:'2026-11-20',title:'Relato do Núcleo',description:'Descrição para análise'};
 await assert.rejects(repository.saveHospital(payload),{message:'OCCURRENCE_PERMISSION_DENIED'});
 await assertFails(setDoc(doc(memberDb,'occurrenceHospitalGrants',member),{enabled:true,updatedBy:member,updatedAt:serverTimestamp()}));
 await assertSucceeds(setDoc(doc(adminDb,'occurrenceHospitalGrants',member),{enabled:true,updatedBy:admin,updatedAt:serverTimestamp()}));
 assert.equal(await repository.saveHospital(payload),'GR 004');
 assert.equal(await repository.saveHospital({...payload,number:'4'}),'GR 004');
 await assert.rejects(repository.saveHospital({...payload,title:'Outro título'}),{message:'OCCURRENCE_HOSPITAL_DUPLICATE'});
 const entry=await assertSucceeds(getDocFromServer(doc(memberDb,'occurrenceFollowups','gr-4')));
 assert.equal(entry.data().origin,'hospital');
 assert.equal(Object.hasOwn(entry.data(),'uid'),false);
 await assertFails(getDocFromServer(doc(memberDb,'occurrenceHospitalAudit','gr-4')));
 await env.withSecurityRulesDisabled(async c=>{
  assert.equal((await getDocFromServer(doc(c.firestore(),'occurrenceScoreClaims','gr-4'))).exists(),false);
 });
 await assertSucceeds(setDoc(doc(adminDb,'occurrenceHospitalGrants',member),{enabled:false,updatedBy:admin,updatedAt:serverTimestamp()}));
 await assert.rejects(repository.saveHospital({...payload,number:'GR 005'}),{message:'OCCURRENCE_PERMISSION_DENIED'});
});

test('administrador e gestor designado podem editar apenas a descrição de ocorrências GRA e GR',async()=>{
 const admin='occurrence-admin',delegate='occurrence-delegate',ordinary='reader-synthetic';
 const hospitalId='gr-4',records=[id,hospitalId];
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await Promise.all([
   setDoc(doc(db,'users',admin),{uid:admin,active:true,access:true,role:'administrador_app'}),
   setDoc(doc(db,'users',delegate),{uid:delegate,active:true,access:true,role:'gestor'}),
   setDoc(doc(db,'occurrenceHospitalGrants',delegate),{enabled:true}),
   setDoc(doc(db,'runtimePolicy','folders'),{schemaVersion:1,revision:2,disabled:['registros']}),
   setDoc(doc(db,'occurrenceFollowups',id),{id,origin:'app',formId:'F10',sequence:1,description:null}),
   setDoc(doc(db,'occurrenceFollowups',hospitalId),{id:hospitalId,origin:'hospital',formId:'F08',hospitalNumber:'4',description:'Original'})
  ]);
 });
 const adminDb=google(admin),delegateDb=google(delegate),memberDb=google(ordinary);
 const followup=(db,key)=>doc(db,'occurrenceFollowups',key);
 const repository=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},auth:{currentUser:{uid:delegate}},
  firestore:{doc:(_,name,key)=>doc(delegateDb,name,key),getDocFromServer,runTransaction:(_,callback)=>runTransaction(delegateDb,callback)}});
 const adminRepository=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},auth:{currentUser:{uid:admin}},
  firestore:{doc:(_,name,key)=>doc(adminDb,name,key),getDocFromServer,runTransaction:(_,callback)=>runTransaction(adminDb,callback)}});
 await assertFails(updateDoc(followup(memberDb,id),{description:'Não autorizado'}));
 await assertFails(updateDoc(followup(delegateDb,id),{description:'Só autorizado a registrar relatos do Núcleo'}));
 await assertFails(setDoc(doc(delegateDb,'occurrenceDescriptionGrants',delegate),{enabled:true,updatedBy:delegate,updatedAt:serverTimestamp()}));
 await adminRepository.saveGrant({uid:admin,subjectUid:delegate,kind:'descriptions',enabled:true});
 assert.equal(await adminRepository.getGrant({uid:admin,subjectUid:delegate,kind:'descriptions'}),true);
 await assertFails(updateDoc(followup(delegateDb,id),{description:'Mudança',sequence:2}));
 await assertFails(updateDoc(followup(adminDb,id),{description:' \n '}));
 await assertSucceeds(updateDoc(followup(adminDb,hospitalId),{description:'Revisto pela administração'}));
 for(const key of records){
  const previous=(await getDocFromServer(followup(memberDb,key))).data().description;
  const input={uid:delegate,id:key,expectedDescription:previous,description:'Descrição revisada'};
  assert.equal(await repository.saveDescription(input),'Descrição revisada');
  assert.equal(await repository.saveDescription(input),'Descrição revisada');
  assert.equal((await getDocFromServer(followup(memberDb,key))).data().description,'Descrição revisada');
  await assert.rejects(repository.saveDescription({...input,description:'Sobrescrita desatualizada'}),{message:'OCCURRENCE_DESCRIPTION_CHANGED'});
 }
 await adminRepository.saveGrant({uid:admin,subjectUid:delegate,kind:'descriptions',enabled:false});
 await assertFails(updateDoc(followup(delegateDb,id),{description:'Permissão revogada'}));
});

test('Dilema Ético tem abordagem livre restrita aos editores e preserva as análises legadas',async()=>{
 const admin='ethical-admin',delegate='ethical-delegate',ordinary='reader-synthetic',other='gr-2';
 const legacy={problem:'Problema anterior',cause:'Causa',review:'Análise',correction:'Correção',plan:'Plano'};
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await Promise.all([
   setDoc(doc(db,'users',admin),{uid:admin,active:true,access:true,role:'administrador_app'}),
   setDoc(doc(db,'users',delegate),{uid:delegate,active:true,access:true,role:'gestor',permissions:{}}),
   setDoc(doc(db,'occurrenceDescriptionGrants',delegate),{enabled:true}),
   setDoc(doc(db,'occurrenceFollowups',id),{id,formId:'F08',description:'Relato existente'}),
   setDoc(doc(db,'occurrenceFollowups',other),{id:other,formId:'F03'}),
   setDoc(doc(db,'occurrenceFollowups',id,'analyses',ordinary),{analysis:legacy})
  ]);
 });
 const adminDb=google(admin),delegateDb=google(delegate),ordinaryDb=google(ordinary);
 const draftRef=(db,key=id)=>doc(db,'occurrenceFollowups',key,'ethicalReview','current');
 const repository=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},auth:{currentUser:{uid:delegate}},
  firestore:{doc:(_, ...path)=>doc(delegateDb,...path),getDocFromServer,runTransaction:(_,callback)=>runTransaction(delegateDb,callback)}});
 await assertFails(getDocFromServer(draftRef(ordinaryDb)));
 await assertFails(setDoc(draftRef(ordinaryDb),{text:'Sem permissão',updatedAt:serverTimestamp()}));
 await assertFails(setDoc(draftRef(adminDb,other),{text:'Tema diferente',updatedAt:serverTimestamp()}));
 assert.equal(await repository.readEthicalReview({uid:delegate,id}),'');
 const text='Abordagem escolhida.\nSegundo parágrafo.';
 await repository.saveEthicalReview({uid:delegate,id,text,expectedText:''});
 assert.equal((await getDocFromServer(draftRef(adminDb))).data().text,text);
 await assertFails(getDocFromServer(draftRef(ordinaryDb)));
 await assert.rejects(repository.saveEthicalReview({uid:delegate,id,text:'Versão antiga',expectedText:''}),{message:'OCCURRENCE_ETHICAL_REVIEW_CHANGED'});
 const previous=doc(ordinaryDb,'occurrenceFollowups',id,'analyses',ordinary);
 assert.deepEqual((await getDocFromServer(previous)).data().analysis,legacy);
 await assertFails(setDoc(previous,{analysis:legacy,updatedAt:serverTimestamp()}));
 await assertSucceeds(setDoc(doc(ordinaryDb,'occurrenceFollowups',other,'analyses',ordinary),{analysis:legacy,updatedAt:serverTimestamp()}));
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
