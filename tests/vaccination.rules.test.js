import {readFile} from 'node:fs/promises';import {before,after,test} from 'node:test';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {getDoc,setDoc,doc,getDocs,collection,setLogLevel} from 'firebase/firestore';
let env;setLogLevel('silent');
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-sahmt-vaccination',firestore:{host:'127.0.0.1',port:Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':').at(-1)||8289),rules:await readFile(process.env.VACCINATION_RULES_PATH||new URL('../firestore.independent-fb.rules',import.meta.url),'utf8')}});
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'evaluationRuntime','independentFbCutover'),{release:'fb-independent-20261022-v1',status:'ACTIVE'});
 for(const uid of ['one','two','admin','manager'])await setDoc(doc(db,'users',uid),{uid,active:true,access:true,role:uid==='admin'?'administrador_app':'anestesiologista',permissions:{admin:uid==='admin',peopleManage:uid==='manager',managementRead:true}});
 for(const name of ['professionalRegistrations','professionalRegistrationFiles','professionalRegistrationUploadLimits','registrationDriveFolders','integrationCredentials','integrationOAuthStates','institutionalBiosafetyManuals','occupationalDosimetry','occupationalVaccinations','professionalDocumentFolders','professionalDocumentUploads','professionalDocumentUploadLimits'])for(const id of ['one','two','one_2026'])await setDoc(doc(db,name,id),{uid:'one',privateValue:'synthetic'});
 });
});
after(async()=>env?.cleanup());
test('browser sessions cannot directly read, query or write vaccination and document records, including admin',async()=>{
 for(const uid of ['one','two','admin','manager']){const db=env.authenticatedContext(uid,{firebase:{sign_in_provider:'google.com'}}).firestore();
 await assertSucceeds(getDoc(doc(db,'users',uid)));
 for(const name of ['professionalRegistrations','professionalRegistrationFiles','professionalRegistrationUploadLimits','registrationDriveFolders','integrationCredentials','integrationOAuthStates','institutionalBiosafetyManuals','occupationalDosimetry','occupationalVaccinations','professionalDocumentFolders','professionalDocumentUploads','professionalDocumentUploadLimits']){
  await assertFails(getDoc(doc(db,name,'one')));await assertFails(getDocs(collection(db,name)));await assertFails(setDoc(doc(db,name,'new'),{uid}));
 }
 }
});
test('anonymous direct reads and writes are denied',async()=>{const db=env.unauthenticatedContext().firestore();for(const name of ['professionalRegistrations','professionalRegistrationFiles','professionalRegistrationUploadLimits','registrationDriveFolders','integrationCredentials','integrationOAuthStates','institutionalBiosafetyManuals','occupationalDosimetry','occupationalVaccinations','professionalDocumentFolders','professionalDocumentUploads']){await assertFails(getDoc(doc(db,name,'one')));await assertFails(setDoc(doc(db,name,'new'),{uid:'one'}));}});
