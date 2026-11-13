import {readFile} from 'node:fs/promises';
import {before,beforeEach,after,test} from 'node:test';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,setLogLevel} from 'firebase/firestore';
let env;setLogLevel('silent');
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-sahmt-fb-independent',firestore:{host:'127.0.0.1',port:Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':').pop()||8080),rules:await readFile(new URL('../firestore.independent-fb.rules',import.meta.url),'utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();
 await setDoc(doc(db,'evaluationRuntime','independentFbCutover'),{release:'fb-independent-20261022-v1',status:'ACTIVE'});
 for(const uid of ['member','other','revoked','admin'])await setDoc(doc(db,'users',uid),{uid,active:true,access:uid!=='revoked',role:uid==='admin'?'administrador_app':'anestesiologista',permissions:{trainingsRead:true,managementRead:true,admin:uid==='admin'}});
 await setDoc(doc(db,'evaluationSummaries','member'),{uid:'member',performanceTotal:3});
 });});
const dbFor=uid=>env.authenticatedContext(uid,{firebase:{sign_in_provider:'google.com'}}).firestore();
test('an approved reader can watch only the folder policy document and cannot alter it',async()=>{
 const ref=db=>doc(db,'htmlTrainingSettings','folders');
 await env.withSecurityRulesDisabled(c=>setDoc(ref(c.firestore()),{version:1,disabled:[]}));
 await assertSucceeds(getDoc(ref(dbFor('member'))));
 await assertFails(getDoc(ref(dbFor('revoked'))));
 await assertFails(getDoc(ref(env.unauthenticatedContext().firestore())));
 await assertFails(getDoc(doc(dbFor('member'),'htmlTrainingSettings','folderIndex')));
 await assertFails(setDoc(ref(dbFor('admin')),{version:2,disabled:[]}));
});
test('direct Google member reads own performance without custom claims or a lease',async()=>{
 await assertSucceeds(getDoc(doc(dbFor('member'),'evaluationSummaries','member')));
 await assertFails(getDoc(doc(dbFor('other'),'evaluationSummaries','member')));
 await assertFails(getDoc(doc(dbFor('revoked'),'evaluationSummaries','member')));
});
test('even an administrator cannot invent scores, replace cutover evidence or write operational/QMENTUM data in FB',async()=>{
 const db=dbFor('admin');await assertFails(updateDoc(doc(db,'evaluationSummaries','member'),{performanceTotal:900}));
 for(const root of ['evaluationRuntime','checklists','events','labels','qmentumUnits','managementAuthorizationLeases'])await assertFails(setDoc(doc(db,root,'synthetic'),{active:true}));
});
test('inactive cutover evidence blocks domain reads while a user can inspect their existing profile',async()=>{
 await env.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore(),'evaluationRuntime','independentFbCutover'),{status:'PREPARED'}));
 await assertFails(getDoc(doc(dbFor('member'),'evaluationSummaries','member')));await assertSucceeds(getDoc(doc(dbFor('member'),'users','member')));
});

test('disabled management child blocks its documents while sibling and catalog remain available',async()=>{
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,'runtimePolicy','folders'),{schemaVersion:1,revision:1,disabled:['gestao/area-gestao-da-qualidade']});
  await setDoc(doc(db,'documents','quality'),{managementAreaId:'area-gestao-da-qualidade'});
  await setDoc(doc(db,'documents','finance'),{managementAreaId:'area-gestao-financeira'});
  await setDoc(doc(db,'managementAreas','area-gestao-da-qualidade'),{active:true});
 });
 for(const uid of ['member','admin']){
  const db=dbFor(uid);
  await (uid==='admin'?assertSucceeds:assertFails)(getDoc(doc(db,'documents','quality')));
  await assertSucceeds(getDoc(doc(db,'documents','finance')));
  await assertSucceeds(getDoc(doc(db,'managementAreas','area-gestao-da-qualidade')));
 }
});
