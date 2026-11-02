import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';import {doc,getDoc,setDoc} from 'firebase/firestore';
test('FD performance runtime and point records are server-only',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-sahmt-fd-performance',firestore:{rules:await readFile('firestore.indicators-platform.rules','utf8')}});
 try{
  await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const name of ['fdPerformanceRuntime','fdPerformanceAcknowledgements','fdPerformanceSuggestions','fdPerformanceAwards','fdPerformanceSummaries','fdPerformanceReference'])await setDoc(doc(db,name,'u1'),{uid:'u1',points:1});});
  const user=env.authenticatedContext('u1',{email:'u1@example.invalid',email_verified:true}).firestore();
  for(const name of ['fdPerformanceRuntime','fdPerformanceAcknowledgements','fdPerformanceSuggestions','fdPerformanceAwards','fdPerformanceSummaries','fdPerformanceReference']){
   await assertFails(getDoc(doc(user,name,'u1')));await assertFails(setDoc(doc(user,name,'injected'),{uid:'u1',points:999}));
  }
 }finally{await env.cleanup();}
});
