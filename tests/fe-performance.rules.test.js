import test from 'node:test';import {readFile} from 'node:fs/promises';import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';import {doc,getDoc,setDoc} from 'firebase/firestore';
test('FE point records remain separate from survey responses and are server-only',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-sahmt-fe-performance',firestore:{rules:await readFile('firestore.climate.rules','utf8')}});
 try{
  await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const name of ['fePerformanceRuntime','fePerformanceAwards','fePerformanceSummaries','fePerformanceReference','climateResponses'])await setDoc(doc(db,name,'u1'),{uid:'u1',answers:{Q01:5},points:1});});
  const user=env.authenticatedContext('u1',{email:'u1@example.invalid',email_verified:true}).firestore();
  for(const name of ['fePerformanceRuntime','fePerformanceAwards','fePerformanceSummaries','fePerformanceReference','climateResponses']){
   await assertFails(getDoc(doc(user,name,'u1')));await assertFails(setDoc(doc(user,name,'injected'),{uid:'u1',points:999}));
  }
 }finally{await env.cleanup();}
});
