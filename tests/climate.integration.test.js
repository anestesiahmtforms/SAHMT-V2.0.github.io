import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,writeBatch,deleteDoc,setLogLevel} from 'firebase/firestore';
import {VERSION} from '../climate-domain/schema.js';
setLogLevel('silent');
test('FE clients cannot bypass authenticated submission with direct answers, retries or a forged participation ledger',async()=>{
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
 const env=await initializeTestEnvironment({projectId:'demo-sahmt-climate-integration',firestore:{rules:readFileSync('firestore.climate.rules','utf8')}});
 const response={survey_cycle:'2026',survey_version:VERSION,group:'team',answers:{Q01:4}},id='a'.repeat(32);
 try{
  await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'climateCycles/2026'),{status:'open'});await setDoc(doc(c.firestore(),'climateResponses/'+id),response);await setDoc(doc(c.firestore(),'surveyParticipation/member_climate_2026'),{uid:'member',survey:'climate',cycle:'2026',completed:true});});
  for(const db of [env.unauthenticatedContext().firestore(),env.authenticatedContext('member',{email:'member@example.invalid',email_verified:true}).firestore(),env.authenticatedContext('reader',{climateReportReader:true}).firestore()]){
   await assertFails(setDoc(doc(db,'climateResponses/'+'b'.repeat(32)),response));await assertFails(setDoc(doc(db,'climateResponses/'+id),response));await assertFails(deleteDoc(doc(db,'climateResponses/'+id)));await assertFails(getDoc(doc(db,'climateResponses/'+id)));
   await assertFails(getDoc(doc(db,'surveyParticipation/member_climate_2026')));await assertFails(setDoc(doc(db,'surveyParticipation/member_climate_2026'),{uid:'member',completed:true}));
   const batch=writeBatch(db);batch.set(doc(db,'climateResponses/'+'c'.repeat(32)),response);batch.set(doc(db,'surveyParticipation/forged'),{uid:'member',completed:true});await assertFails(batch.commit());
  }
 }finally{await env.clearFirestore();await env.cleanup();}
});
