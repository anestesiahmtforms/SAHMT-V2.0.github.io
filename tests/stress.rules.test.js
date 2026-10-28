import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,deleteDoc,setLogLevel} from 'firebase/firestore';
import {QUESTIONS,VERSION} from '../stress-domain/schema.js';
setLogLevel('silent');
test('stress FE: authenticated complete writes, private reads, frozen scores, cycles, dedicated aggregates',async()=>{
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST);const env=await initializeTestEnvironment({projectId:'demo-sahmt-stress',firestore:{rules:readFileSync(new URL('../firestore.climate.rules',import.meta.url),'utf8')}});
 const member=env.authenticatedContext('member',{email:'member@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore(),anonymous=env.unauthenticatedContext().firestore(),reader=env.authenticatedContext('authorized-reader',{climateReportReader:true}).firestore(),ordinary=env.authenticatedContext('ordinary-user').firestore();
 const payload={respondent_uid:'member',category_key:'a'.repeat(64),survey_cycle:'2026',survey_version:VERSION,group:'team',answers:Object.fromEntries(QUESTIONS.map(q=>[q.id,0]))},id=n=>n.toString(16).padStart(32,'0');

 const seed=group=>env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'users/member'),{uid:'member',active:true,access:true});await setDoc(doc(db,'userCategories/'+'a'.repeat(64)),{schemaVersion:1,identityStatus:'LINKED',uid:'member',email:'member@example.invalid',memberCategories:[{team:'EFETIVO',resident:'RESIDENTE_1',substitute:'SUBSTITUTO'}[group]]});});
 try{
  await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'stressCycles/2026'),{status:'open'});await setDoc(doc(c.firestore(),'stressReports/2025'),{survey_cycle:'2025'});});
  for(const [i,group]of ['team','resident','substitute'].entries()){await seed(group);await assertSucceeds(setDoc(doc(member,'stressResponses/'+id(i+1)),{...payload,group}));}
  await seed('team');await assertSucceeds(setDoc(doc(member,'stressResponses/'+id(1)),payload));
  await assertFails(setDoc(doc(member,'stressResponses/'+id(1)),{...payload,answers:{...payload.answers,S01:5}}));
  await seed('team');await assertSucceeds(setDoc(doc(member,'stressResponses/'+id(9)),{...payload,stress_rating:0}));
  await assertFails(setDoc(doc(anonymous,'stressResponses/'+id(501)),payload));

  // The registry decides the category; the client cannot impersonate another account.
  for(const change of [{respondent_uid:'other'},{category_key:'b'.repeat(64)},{group:'resident'}])await assertFails(setDoc(doc(member,'stressResponses/'+id(700)),{...payload,...change}));
  const incomplete={...payload.answers};delete incomplete.S30;
  for(const change of [{group:'secretaries'},{group:''},{group:'unspecified'},{uid:'forbidden'},{email:'forbidden'},{name:'forbidden'},{ip:'forbidden'},{score:0},{band:'mild'},{timestamp:'now'},{answers:incomplete},{answers:{...payload.answers,S01:'0'}},{answers:{...payload.answers,S01:6}},{answers:{...payload.answers,S01:1.2}},{answers:{...payload.answers,S01:false}},{stress_rating:11},{stress_rating:null},{survey_version:'other'},{survey_cycle:'2025'}])await assertFails(setDoc(doc(member,'stressResponses/'+id(10)),{...payload,...change}));
  for(const db of [anonymous,reader,ordinary,member]){await assertFails(getDoc(doc(db,'stressResponses/'+id(1))));await assertFails(getDocs(collection(db,'stressResponses')));await assertFails(deleteDoc(doc(db,'stressResponses/'+id(1))));await assertFails(setDoc(doc(db,'stressReports/2026'),{mean:20}));await assertFails(setDoc(doc(db,'stressCycles/2026'),{status:'open'}));}
  for(const db of [anonymous,ordinary])await assertFails(getDoc(doc(db,'stressReports/2025')));await assertSucceeds(getDocs(collection(reader,'stressReports')));
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'stressCycles/2026'),{status:'closed'}));await assertFails(setDoc(doc(member,'stressResponses/'+id(11)),payload));
 }finally{await env.clearFirestore();await env.cleanup();}
});
