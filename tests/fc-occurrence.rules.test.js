import {readFile} from 'node:fs/promises';
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocFromServer,getDocs,limit,query,runTransaction,serverTimestamp,setDoc,updateDoc,writeBatch} from 'firebase/firestore';
import {OCCURRENCE_CATALOG_SPECS} from '../src/occurrence-schema.js';
import {GRA_001_QUESTIONS} from '../src/occurrence-questionnaire.js';
import {createOccurrenceRepository} from '../src/occurrence-data.js';

const emulatorHost=process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:18493';
const [host,portText]=emulatorHost.split(':');
const port=Number(portText),project='demo-sahmt-fc-modules',uid='writer-synthetic',id='10000000-0000-4000-8000-000000000001';let env;
const google=(userId,claims={})=>env.authenticatedContext(userId,{firebase:{sign_in_provider:'google.com'},aud:'indicadores---sahmt',iss:'https://securetoken.google.com/indicadores---sahmt',sub:userId,...claims}).firestore();
const catalogs=Object.fromEntries(Object.entries(OCCURRENCE_CATALOG_SPECS).map(([key,spec])=>[key,Array.from({length:spec.count},(_,i)=>`Opção sintética ${i+1}`)]));
const patientValues={sex:'Masculino',age:'3 meses',diagnosisOrTreatment:'Tratamento sintético'};
const actionValues={chartDisclosure:'Não se aplica (Evento sem envolver o paciente)',patientFactors:'Nenhum',taskFactors:'Nenhum',
 individualFactors:'Nenhum',teamFactors:'Nenhuma',workEnvironmentFactors:'Nenhuma',informationTechnologyFactors:'Proteção de dados'};
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
  values:{sourceSector:loaded.catalogs.SETORES_55[0],destinationSector:loaded.catalogs.SETORES_55[1],
   patientOrAttendance:'012345',immediateAction:'Ação sintética',...patientValues,...actionValues}});
 assert.equal(result.status,'saved');
 assert.equal(result.protocol,'GRA 001');
 const report=(await getDoc(doc(database,'occurrenceReports',id))).data();
 assert.equal(report.formId,'F10');assert.equal(report.authorLabel,'Administrador sintético');
 assert.deepEqual(report.details,{...patientValues,actionFollowup:actionValues});
 const claim=(await getDoc(doc(database,'occurrenceScoreClaims',id))).data();
 assert.equal(claim.originProjectId,'indicadores---sahmt');
});

test('a numeração FC é consecutiva em gravações concorrentes e o contador não pode avançar sozinho',async()=>{
 const db=google(uid);
 const repository=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},
  auth:{currentUser:{uid}},notifyScore:async()=>{},firestore:{doc:(_,name,key)=>doc(db,name,key),getDocFromServer,
   runTransaction:(_,callback)=>runTransaction(db,callback)}});
 const data={uid,formId:'F10',displayName:'Autor sintético',catalogs,
  values:{sourceSector:catalogs.SETORES_55[0],destinationSector:catalogs.SETORES_55[1],
   patientOrAttendance:'012345',immediateAction:'Ação sintética',...patientValues,...actionValues}};
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
  values:{sourceSector:catalogs.SETORES_55[0],destinationSector:catalogs.SETORES_55[1],
   patientOrAttendance:'Paciente sintético',immediateAction:'Ação sintética',...patientValues,...actionValues}});
 await assertFails(getDocFromServer(doc(memberDb,'occurrenceReports',id)));
 await assertFails(getDocFromServer(doc(memberDb,'occurrenceAudit',id)));
 const visible=await assertSucceeds(getDocs(query(collection(memberDb,'occurrenceFollowups'),limit(30))));
 assert.equal(visible.size,1);
 assert.equal(Object.hasOwn(visible.docs[0].data().details,'actionFollowup'),false);
 assert.doesNotMatch(JSON.stringify(visible.docs[0].data()),/Autor sintético|Paciente sintético|patientOrAttendance|authorLabel|diagnosisOrTreatment|Tratamento sintético|3 meses|Masculino/);
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
 const values={eventDate:'2026-11-20',occurrence:'Queda',description:'Relato sintético',attendance:'Identificador sintético',...patientValues,
  causingSector:catalogs.SETORES_9[0],fallDate:'2026-11-20',fallTime:'08:00',fallRisk:catalogs.RISCO_QUEDA[0],
  fallRiskGuidance:catalogs.SIM_NAO_NI[0],lastAssessmentDate:'2026-11-19',redWristband:catalogs.SIM_NAO_NI[0],
  fallLocation:catalogs.LOCAL_QUEDA[0],fallMechanism:catalogs.MECANISMO_QUEDA[0],adequateFootwear:catalogs.SIM_NAO_NI[0],
  consciousness:catalogs.CONSCIENCIA[0],injury:catalogs.SIM_NAO_NI[0],symptomAfterEvent:catalogs.SIM_NAO_NI[0],
  immediateAction:'Ação sintética',eventPeriod:catalogs.PERIODO[0],...actionValues};
 assert.equal((await repository.save({uid,formId:'F05',recordId:id,displayName:'Autor sintético',catalogs,values})).protocol,'GRA 001');
 const entry=await assertSucceeds(getDocFromServer(doc(google('unauthorized-synthetic'),'occurrenceFollowups',id)));
 assert.equal(entry.data().details.fallTime,'08:00');
 assert.equal(Object.hasOwn(entry.data().details,'attendance'),false);
 const original=await getDocFromServer(doc(db,'occurrenceReports',id));
 assert.deepEqual(original.data().details.actionFollowup,actionValues);
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

test('administrador e gestor editam somente a versão de análise e preservam os relatos GRA, GR e original',async()=>{
 const admin='occurrence-admin',delegate='occurrence-delegate',ordinary='reader-synthetic';
 const hospitalId='gr-4',records=[id,hospitalId];
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await Promise.all([
   setDoc(doc(db,'users',admin),{uid:admin,active:true,access:true,role:'administrador_app'}),
   setDoc(doc(db,'users',delegate),{uid:delegate,active:true,access:true,role:'gestor'}),
   setDoc(doc(db,'occurrenceHospitalGrants',delegate),{enabled:true}),
   setDoc(doc(db,'runtimePolicy','folders'),{schemaVersion:1,revision:2,disabled:['registros']}),
   setDoc(doc(db,'occurrenceFollowups',id),{id,origin:'app',formId:'F10',sequence:1,description:null,analysisStarted:true}),
   setDoc(doc(db,'occurrenceFollowups',hospitalId),{id:hospitalId,origin:'hospital',formId:'F08',hospitalNumber:'4',description:'Original',analysisStarted:true}),
   setDoc(doc(db,'occurrenceReports',id),{description:'Original da equipe'})
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
 await assertFails(updateDoc(followup(adminDb,hospitalId),{description:'Tentativa de editar original'}));
 await assertFails(updateDoc(doc(adminDb,'occurrenceReports',id),{description:'Tentativa de editar original'}));
 await assertSucceeds(updateDoc(followup(adminDb,hospitalId),{preparedDescription:'Revisto pela administração'}));
 for(const key of records){
  const saved=(await getDocFromServer(followup(memberDb,key))).data();
  const input={uid:delegate,id:key,expectedDescription:saved.preparedDescription??saved.description,description:'Descrição revisada'};
  assert.equal(await repository.saveDescription(input),'Descrição revisada');
  assert.equal(await repository.saveDescription(input),'Descrição revisada');
  const current=(await getDocFromServer(followup(memberDb,key))).data();
  assert.equal(current.preparedDescription,'Descrição revisada');
  assert.equal(current.description,saved.description);
  await assert.rejects(repository.saveDescription({...input,description:'Sobrescrita desatualizada'}),{message:'OCCURRENCE_DESCRIPTION_CHANGED'});
 }
 await adminRepository.saveGrant({uid:admin,subjectUid:delegate,kind:'descriptions',enabled:false});
 await assertFails(updateDoc(followup(delegateDb,id),{preparedDescription:'Permissão revogada'}));
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

test('cada ocorrência tem questionário próprio, uma resposta por conta e resultado, ciência e encerramento com permissões próprias',async()=>{
 const caseId='49de5878-28c7-40b5-81e6-f416d58b2433',ordinary='reader-synthetic',admin='gra-admin',delegate='gra-delegate';
 const other='unauthorized-synthetic';
 const maxOptionsCase='10000000-0000-4000-8000-000000000099';
 const responses='ethicalPollResponses';
 const ref=(db,person=ordinary,recordId=caseId)=>doc(db,'occurrenceFollowups',recordId,responses,person);
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await Promise.all([
   setDoc(doc(db,'users',admin),{uid:admin,active:true,access:true,role:'administrador_app'}),
   setDoc(doc(db,'users',delegate),{uid:delegate,active:true,access:true,permissions:{}}),
   setDoc(doc(db,'occurrenceDescriptionGrants',delegate),{enabled:true}),
   setDoc(doc(db,'occurrenceFollowups',caseId),{id:caseId,formId:'F08',sequence:1,origin:'app'}),
   setDoc(doc(db,'occurrenceFollowups',maxOptionsCase),{id:maxOptionsCase,formId:'F10',origin:'app'}),
   setDoc(doc(db,'occurrenceFollowups',id),{id,formId:'F03',hospitalNumber:'1',origin:'hospital'})
  ]);
 });
 const ordinaryDb=google(ordinary),otherDb=google(other),adminDb=google(admin),delegateDb=google(delegate);
 const repository=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},auth:{currentUser:{uid:ordinary}},
  firestore:{doc:(_, ...path)=>doc(ordinaryDb,...path),getDocFromServer,runTransaction:(_,callback)=>runTransaction(ordinaryDb,callback)}});
 const config=(db,recordId=caseId)=>doc(db,'occurrenceFollowups',recordId,'analysisQuestionnaire','current');
 const caseRow=(db,record=caseId)=>doc(db,'occurrenceFollowups',record);
 const published={questions:GRA_001_QUESTIONS,publishedAt:serverTimestamp()};
 const shorter=GRA_001_QUESTIONS.map(({prompt,options})=>({prompt,options:options.slice(0,2)}));
 const maxOptions=GRA_001_QUESTIONS.map(({prompt})=>({prompt,options:['Um','Dois','Três','Quatro','Cinco']}));
 const managerPublisher=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},auth:{currentUser:{uid:delegate}},
  firestore:{doc:(_, ...path)=>doc(delegateDb,...path),getDocFromServer,runTransaction:(_,callback)=>runTransaction(delegateDb,callback)}});
 assert.deepEqual(await managerPublisher.publishOccurrenceQuestionnaire({uid:delegate,id:maxOptionsCase,description:'Preparação do caso',questions:maxOptions}),maxOptions);
 const valid={answers:[5,2,4,4],comment:'',submittedAt:serverTimestamp()};
 await env.withSecurityRulesDisabled(context=>updateDoc(config(context.firestore(),maxOptionsCase),{revision:2}));
 const revisedRef=ref(ordinaryDb,ordinary,maxOptionsCase);
 await assertFails(setDoc(revisedRef,{...valid,answers:[1,2,3,4]}));
 await assertFails(setDoc(revisedRef,{...valid,answers:[1,2,3,4],questionnaireRevision:1}));
 await assertSucceeds(setDoc(revisedRef,{...valid,answers:[1,2,3,4],questionnaireRevision:2}));
 assert.equal((await repository.readOccurrenceQuestionnaire({uid:ordinary,id:maxOptionsCase})).revision,2);
 await assertFails(setDoc(ref(ordinaryDb),valid));
 await assertFails(setDoc(config(ordinaryDb),published));
 await assertFails(setDoc(config(adminDb,'missing'),published));
 await assertFails(setDoc(config(adminDb),{...published,questions:shorter.slice(0,3)}));
 await assertFails(setDoc(config(adminDb),published));
 await assertFails(updateDoc(caseRow(adminDb),{analysisStarted:true}));
 const adminBatch=writeBatch(adminDb);
 adminBatch.set(config(adminDb),published);
 adminBatch.update(caseRow(adminDb),{analysisStarted:true,preparedDescription:'Relato preparado'});
 await assertSucceeds(adminBatch.commit());
 await assertFails(updateDoc(config(adminDb),{questions:shorter,publishedAt:serverTimestamp()}));
 assert.equal((await repository.readOccurrenceQuestionnaire({uid:ordinary,id:caseId})).questions.length,4);
 await assertFails(setDoc(ref(ordinaryDb,other),valid));
 await assertFails(setDoc(ref(ordinaryDb,ordinary,id),valid));
 const managerBatch=writeBatch(delegateDb);
 managerBatch.set(config(delegateDb,id),{...published,questions:shorter});
 managerBatch.update(caseRow(delegateDb,id),{analysisStarted:true,preparedDescription:'Relato do Núcleo preparado'});
 await assertSucceeds(managerBatch.commit());
 await assertFails(setDoc(ref(ordinaryDb,ordinary,id),valid));
 await assertSucceeds(setDoc(ref(otherDb,other,id),{...valid,answers:[1,2,1,2],comment:'  Preservar\n  espaços.  '}));
 assert.equal((await getDocFromServer(ref(otherDb,other,id))).data().comment,'  Preservar\n  espaços.  ');
 await assertFails(setDoc(ref(ordinaryDb),{...valid,answers:[5,2,5,4]}));
 await assertFails(setDoc(ref(ordinaryDb),{...valid,answers:[5,2,4]}));
 await assertFails(setDoc(ref(ordinaryDb),{...valid,comment:'a'.repeat(2001)}));
 assert.equal(await repository.readOccurrenceResponse({uid:ordinary,id:caseId}),false);
 assert.equal(await repository.submitOccurrenceResponse({uid:ordinary,id:caseId,answers:valid.answers}),'submitted');
 assert.equal(await repository.submitOccurrenceResponse({uid:ordinary,id:caseId,answers:[1,1,1,1],comment:'Nova resposta'}),'already-submitted');
 assert.equal(await repository.readOccurrenceResponse({uid:ordinary,id:caseId}),true);
 const analysisClaim=doc(ordinaryDb,'occurrenceScoreClaims','analysis-'+caseId+'_'+ordinary);
 assert.equal((await assertSucceeds(getDocFromServer(analysisClaim))).data().points,1);
 await assertFails(getDocFromServer(doc(otherDb,analysisClaim.path)));
 await assertFails(updateDoc(analysisClaim,{points:2}));
 const forgedClaimId='analysis-'+caseId+'_'+other;
 await assertFails(setDoc(doc(otherDb,'occurrenceScoreClaims',forgedClaimId),{
  schemaVersion:1,id:forgedClaimId,source:'ANALISE_OCORRENCIA',sourceId:caseId,uid:other,
  points:1,status:'PENDING_VALIDATION',createdAt:serverTimestamp()
 }));
 assert.deepEqual((await getDocFromServer(ref(ordinaryDb))).data().answers,valid.answers);
 await assertFails(updateDoc(ref(ordinaryDb),{comment:'Tentativa de sobrescrita'}));
 await assertSucceeds(getDocFromServer(ref(ordinaryDb)));
 await assertFails(getDocFromServer(ref(otherDb)));
 const listing=db=>getDocs(query(collection(db,'occurrenceFollowups',caseId,responses),limit(30)));
 await assertFails(listing(ordinaryDb));
 assert.equal((await assertSucceeds(listing(adminDb))).size,1);
 assert.equal((await assertSucceeds(listing(delegateDb))).size,1);
 await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'runtimePolicy','folders'),{
  schemaVersion:1,revision:2,disabled:['registros']
 }));
 await assertFails(setDoc(ref(otherDb,other),valid));
 await assertSucceeds(setDoc(ref(adminDb,admin),{...valid,comment:'Comentário opcional'}));
 const result=(db,record=caseId)=>doc(db,'occurrenceFollowups',record,'ethicalPollResult','current');
 const editor=createOccurrenceRepository({db:{app:{options:{projectId:'indicadores---sahmt'}}},auth:{currentUser:{uid:delegate}},
  firestore:{doc:(_, ...path)=>doc(delegateDb,...path),getDocFromServer,runTransaction:(_,callback)=>runTransaction(delegateDb,callback)}});
 await assertFails(setDoc(result(ordinaryDb),{text:'Sem autorização',updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(caseRow(delegateDb),{analysisClosed:true}));
 await assertFails(setDoc(result(delegateDb),{text:'Resultado sem fechamento',updatedAt:serverTimestamp()}));
 await assertFails(getDocFromServer(result(otherDb)));
 await assert.rejects(editor.saveOccurrenceResult({uid:delegate,id:caseId,text:'Resultado antecipado',expectedText:''}),{code:'permission-denied'});
 await assertFails(updateDoc(caseRow(ordinaryDb),{responsesClosedAt:serverTimestamp()}));
 await assert.rejects(managerPublisher.closeOccurrenceResponses({uid:delegate,id:caseId+'-inválido'}),{message:'OCCURRENCE_PERMISSION_DENIED'});
 await editor.closeOccurrenceResponses({uid:delegate,id:caseId});
 await editor.closeOccurrenceResponses({uid:delegate,id:caseId});
 assert.ok((await getDocFromServer(caseRow(ordinaryDb))).data().responsesClosedAt);
 await assertFails(setDoc(ref(otherDb,other),valid));
 await assertFails(updateDoc(caseRow(delegateDb),{preparedDescription:'Alteração após fechamento'}));
 await assertFails(updateDoc(caseRow(delegateDb),{responsesClosedAt:null}));
 const text='Resultado do serviço.\nSegunda linha.';
 assert.equal(await editor.saveOccurrenceResult({uid:delegate,id:caseId,text,expectedText:''}),text);
 const publication=await repository.readOccurrenceResult({uid:ordinary,id:caseId});
 assert.equal(publication.text,text);
 assert.equal((await assertSucceeds(getDocFromServer(result(otherDb)))).data().text,text);
 const receipt=(db,person=ordinary)=>doc(db,'occurrenceFollowups',caseId,'analysisAcknowledgements',person);
 await assertFails(setDoc(receipt(otherDb),{resultAt:publication.updatedAt,acknowledgedAt:serverTimestamp()}));
 await assertFails(updateDoc(caseRow(ordinaryDb),{eventClosed:true}));
 await assertFails(updateDoc(caseRow(delegateDb,id),{eventClosed:true}));
 await assertFails(setDoc(ref(otherDb,other),valid));
 await repository.acknowledgeOccurrence({uid:ordinary,id:caseId,resultAt:publication.updatedAt});
 await repository.acknowledgeOccurrence({uid:ordinary,id:caseId,resultAt:publication.updatedAt});
 const ackClaim=doc(ordinaryDb,'occurrenceScoreClaims','ack-'+caseId+'_'+ordinary);
 const firstAckClaim=(await assertSucceeds(getDocFromServer(ackClaim))).data();
 assert.equal(firstAckClaim.points,1);
 assert.equal(await repository.readOccurrenceAcknowledgement({uid:ordinary,id:caseId,resultAt:publication.updatedAt}),true);
 await assertFails(getDocFromServer(receipt(otherDb)));
 const update='Versão revisada';
 await editor.saveOccurrenceResult({uid:delegate,id:caseId,text:update,expectedText:text});
 const revised=await repository.readOccurrenceResult({uid:ordinary,id:caseId});
 assert.equal(await repository.readOccurrenceAcknowledgement({uid:ordinary,id:caseId,resultAt:revised.updatedAt}),false);
 await assert.rejects(repository.acknowledgeOccurrence({uid:ordinary,id:caseId,resultAt:publication.updatedAt}),{message:'OCCURRENCE_RESULT_CHANGED'});
 await assert.rejects(editor.finalizeOccurrence({uid:delegate,id:caseId,resultAt:publication.updatedAt}),{message:'OCCURRENCE_RESULT_CHANGED'});
 await editor.finalizeOccurrence({uid:delegate,id:caseId,resultAt:revised.updatedAt});
 await editor.finalizeOccurrence({uid:delegate,id:caseId,resultAt:revised.updatedAt});
 assert.equal((await getDocFromServer(caseRow(ordinaryDb))).data().eventClosed,true);
 await assert.rejects(editor.saveOccurrenceResult({uid:delegate,id:caseId,text:'Mudança tardia',expectedText:update}),{code:'permission-denied'});
 await repository.acknowledgeOccurrence({uid:ordinary,id:caseId,resultAt:revised.updatedAt});
 assert.ok((await getDocFromServer(ackClaim)).data().createdAt.isEqual(firstAckClaim.createdAt));
 assert.equal((await getDocFromServer(caseRow(otherDb))).data().analysisClosed,true);
 await assertFails(updateDoc(caseRow(delegateDb),{analysisClosed:false}));
 await assert.rejects(editor.saveOccurrenceResult({uid:delegate,id:caseId,text:'Conflito',expectedText:''}),{message:'OCCURRENCE_ETHICAL_REVIEW_CHANGED'});
 await editor.closeOccurrenceResponses({uid:delegate,id});
 assert.equal(await editor.saveOccurrenceResult({uid:delegate,id,text:'Outro caso',expectedText:''}),'Outro caso');
 assert.equal((await assertSucceeds(getDocFromServer(result(ordinaryDb,id)))).data().text,'Outro caso');
 assert.equal((await assertSucceeds(getDocFromServer(result(otherDb,id)))).data().text,'Outro caso');
 await assertFails(updateDoc(result(delegateDb),{text:'   ',updatedAt:serverTimestamp()}));
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
