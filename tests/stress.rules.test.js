import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,deleteDoc,setLogLevel} from 'firebase/firestore';
import {QUESTIONS,VERSION} from '../stress-domain/schema.js';
setLogLevel('silent');
test('stress responses and participation are server-only; dedicated claim reads only published aggregates',async()=>{
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST);const env=await initializeTestEnvironment({projectId:'demo-sahmt-stress',firestore:{rules:readFileSync('firestore.climate.rules','utf8')}});
 const anonymous=env.unauthenticatedContext().firestore(),reader=env.authenticatedContext('authorized-reader',{climateReportReader:true}).firestore(),ordinary=env.authenticatedContext('ordinary-user').firestore();
 const payload={survey_cycle:'2026',survey_version:VERSION,group:'team',answers:Object.fromEntries(QUESTIONS.map(q=>[q.id,0]))},id='a'.repeat(32);
 try{
  await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'stressCycles/2026'),{status:'open'});await setDoc(doc(c.firestore(),'stressResponses/'+id),payload);await setDoc(doc(c.firestore(),'stressReports/2025'),{survey_cycle:'2025'});});
  for(const db of [anonymous,reader,ordinary]){
   for(const group of ['team','resident','substitute','secretaries'])await assertFails(setDoc(doc(db,'stressResponses/'+'b'.repeat(32)),{...payload,group}));
   await assertFails(setDoc(doc(db,'stressResponses/'+id),payload));await assertFails(getDoc(doc(db,'stressResponses/'+id)));await assertFails(getDocs(collection(db,'stressResponses')));await assertFails(deleteDoc(doc(db,'stressResponses/'+id)));await assertFails(setDoc(doc(db,'stressReports/2026'),{mean:20}));await assertFails(setDoc(doc(db,'stressCycles/2026'),{status:'open'}));await assertFails(getDoc(doc(db,'surveyParticipation/ordinary-user_stress_2026')));
  }
  for(const db of [anonymous,ordinary])await assertFails(getDoc(doc(db,'stressReports/2025')));await assertSucceeds(getDocs(collection(reader,'stressReports')));
 }finally{await env.clearFirestore();await env.cleanup();}
});
