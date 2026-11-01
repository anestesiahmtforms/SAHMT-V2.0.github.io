import {readFile} from 'node:fs/promises';import {before,after,beforeEach,test} from 'node:test';import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocs,limit,query,setDoc,where} from 'firebase/firestore';
const [host,port]=String(process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:18493').split(':');let env;
const uid='fc-member',other='other-member';
const google=(user=uid,project='indicadores---sahmt')=>env.authenticatedContext(user,{firebase:{sign_in_provider:'google.com'},aud:project,iss:'https://securetoken.google.com/'+project,sub:user}).firestore();
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-sahmt-fc-performance',firestore:{host,port:Number(port),rules:await readFile(new URL('../firestore.fc.rules',import.meta.url),'utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await Promise.all([
 ...[uid,other,'admin'].map(id=>setDoc(doc(db,'users',id),{uid:id,active:true,access:true,permissions:{admin:id==='admin'}})),
 setDoc(doc(db,'fcPerformanceRuntime','state'),{enabled:true}),setDoc(doc(db,'fcPerformanceReference','team'),{maxPerformance:2}),
 ...[uid,other].flatMap(id=>[setDoc(doc(db,'fcPerformanceSummaries',id),{uid:id,performanceTotal:2}),
  ...['fcPerformanceAwards','fcPerformanceLedger'].map(name=>setDoc(doc(db,name,id),{uid:id,category:'PERFORMANCE',points:2}))]),
 setDoc(doc(db,'fcPerformanceSourceReceipts','private'),{uid,sourceId:'sensitive'}),
 setDoc(doc(db,'fcPerformanceLedger','governance'),{uid,category:'GOVERNANCE',points:1})]);});});
test('approved FC member reads own summary and bounded personal performance queries',async()=>{
 const db=google();await assertSucceeds(getDoc(doc(db,'fcPerformanceRuntime','state')));await assertSucceeds(getDoc(doc(db,'fcPerformanceReference','team')));
 await assertSucceeds(getDoc(doc(db,'fcPerformanceSummaries',uid)));
 for(const name of ['fcPerformanceAwards','fcPerformanceLedger']){const rows=await assertSucceeds(getDocs(query(collection(db,name),where('uid','==',uid),where('category','==','PERFORMANCE'),limit(200))));assert.equal(rows.size,1);}
});
test('FC member cannot read another UID, unbounded history, governance or source receipts',async()=>{
 const db=google();for(const name of ['fcPerformanceSummaries','fcPerformanceAwards','fcPerformanceLedger'])await assertFails(getDoc(doc(db,name,other)));
 await assertFails(getDocs(query(collection(db,'fcPerformanceLedger'),where('uid','==',uid),where('category','==','PERFORMANCE'))));
 await assertFails(getDocs(query(collection(db,'fcPerformanceLedger'),limit(200))));await assertFails(getDoc(doc(db,'fcPerformanceLedger','governance')));await assertFails(getDoc(doc(db,'fcPerformanceSourceReceipts','private')));
});
test('anonymous, same UID in FA/FB and revoked FC profile cannot read points',async()=>{
 for(const db of [env.unauthenticatedContext().firestore(),google(uid,'sahmt-17a16'),google(uid,'sahmt-gestao-5ae66')])await assertFails(getDoc(doc(db,'fcPerformanceSummaries',uid)));
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'users',uid),{uid,active:true,access:false}));await assertFails(getDoc(doc(google(),'fcPerformanceSummaries',uid)));
});
test('even an administrator cannot write balances, awards, receipts or runtime from the browser',async()=>{
 for(const user of [uid,'admin'])for(const name of ['fcPerformanceRuntime','fcPerformanceReference','fcPerformanceSummaries','fcPerformanceAwards','fcPerformanceLedger','fcPerformanceSourceReceipts'])await assertFails(setDoc(doc(google(user),name,user),{uid:user,category:'PERFORMANCE',points:999}));
});
