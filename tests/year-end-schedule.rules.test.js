import {readFile} from 'node:fs/promises';
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,runTransaction,writeBatch,serverTimestamp,query,orderBy,setLogLevel} from 'firebase/firestore';
import * as firestore from 'firebase/firestore';
import {writeYearEndChoices} from '../src/year-end-schedule-transaction.js';

let env;setLogLevel('silent');
const base='yearEndSchedules/2026-2027',stamp=()=>serverTimestamp();
const context=(uid,claims={})=>env.authenticatedContext(uid,{email:uid+'@example.invalid',email_verified:true,name:'Pessoa '+uid,firebase:{sign_in_provider:'google.com'},...claims}).firestore();
before(async()=>{
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Execute exclusivamente pelo emulador Firestore.');
  env=await initializeTestEnvironment({projectId:'demo-sahmt-year-end',firestore:{rules:await readFile(new URL('../firestore.climate.rules',import.meta.url),'utf8')}});
});
after(async()=>env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{for(const uid of ['one','two','three','four','five','six','inactive'])await setDoc(doc(c.firestore(),'users',uid),{uid,displayName:'Pessoa '+uid,active:uid!=='inactive',access:true});});
});
const record=(uid,position,patch={})=>({uid,displayName:'Pessoa '+uid,plantao:'natal',grupo:'reveillon',position,createdAt:stamp(),updatedAt:stamp(),...patch});
async function confirm(db,uid,patch={}) {
  return runTransaction(db,async tx=>{
    const own=doc(db,base+'/registrations/'+uid),counter=doc(db,base+'/control/order');
    const prior=await tx.get(own);
    if(prior.exists()){tx.update(own,{plantao:'reveillon',grupo:'natal',updatedAt:stamp(),...patch});return prior.data().position;}
    const order=await tx.get(counter),position=(order.exists()?order.data().lastPosition:0)+1;
    tx.set(counter,{lastPosition:position,lastParticipantUid:uid,updatedAt:stamp()});tx.set(own,record(uid,position,patch));return position;
  },{maxAttempts:15});
}
test('six simultaneous confirmations commit unique positions and a single counter',async()=>{
  const users=['one','two','three','four','five','six'];
  const results=await Promise.allSettled(users.map((uid,i)=>{const db=context(uid);return writeYearEndChoices({api:firestore,db,ownRef:doc(db,base+'/registrations/'+uid),counterRef:doc(db,base+'/control/order'),uid,displayName:'Pessoa '+uid,choices:{plantao:i%2?'natal':'reveillon',grupo:i%3?'natal':'reveillon'},ensure(){}});}));
  assert.deepEqual(results.filter(r=>r.status==='rejected').map(r=>r.reason.message),[]);
  assert.deepEqual(results.map(r=>r.value.position).sort((a,b)=>a-b),[1,2,3,4,5,6]);
  const db=context('one'),rows=await getDocs(query(collection(db,base+'/registrations'),orderBy('position','asc')));
  assert.deepEqual(rows.docs.map(r=>r.data().position),[1,2,3,4,5,6]);
  assert.equal((await getDoc(doc(db,base+'/control/order'))).data().lastPosition,6);
});
test('invalid combinations, extra fields, spoofed name and client timestamps are rejected atomically',async()=>{
  for(const patch of [{plantao:['natal','reveillon']},{grupo:['natal','reveillon']},{grupo:'both'},{email:'forbidden'},{displayName:'Outra pessoa'},{createdAt:new Date(0)},{uid:'two'}]){
    await assertFails(confirm(context('one'),'one',patch));
    assert.equal((await getDoc(doc(context('one'),base+'/control/order'))).exists(),false);
    assert.equal((await getDocs(collection(context('one'),base+'/registrations'))).size,0);
  }
});
test('a later choice update preserves position and original confirmation; other accounts cannot alter it',async()=>{
  const one=context('one'),two=context('two');await assertSucceeds(confirm(one,'one'));
  const ref=doc(one,base+'/registrations/one'),first=(await getDoc(ref)).data();
  await assertSucceeds(confirm(one,'one'));
  const changed=(await getDoc(ref)).data();assert.equal(changed.position,1);assert.ok(changed.createdAt.isEqual(first.createdAt));assert.equal(changed.plantao,'reveillon');
  for(const patch of [{position:2},{displayName:'Outro nome'},{createdAt:stamp()},{uid:'two'}])await assertFails(updateDoc(ref,{...patch,updatedAt:stamp()}));
  await assertFails(updateDoc(doc(two,base+'/registrations/one'),{grupo:'natal',updatedAt:stamp()}));await assertFails(deleteDoc(ref));
  assert.equal((await getDoc(doc(one,base+'/control/order'))).data().lastPosition,1);
});
test('counter-only writes, unpaired registrations, skipped positions and arbitrary cycles are denied',async()=>{
  const db=context('one'),counter=doc(db,base+'/control/order');
  await assertFails(setDoc(counter,{lastPosition:1,lastParticipantUid:'one',updatedAt:stamp()}));
  await assertFails(setDoc(doc(db,base+'/registrations/one'),record('one',1)));
  const batch=writeBatch(db);batch.set(counter,{lastPosition:4,lastParticipantUid:'one',updatedAt:stamp()});batch.set(doc(db,base+'/registrations/one'),record('one',4));await assertFails(batch.commit());
  await assertFails(setDoc(doc(db,'yearEndSchedules/2027-2028/registrations/one'),record('one',1)));
});
test('only approved verified Google members can read the team list or write their own choices',async()=>{
  for(const db of [env.unauthenticatedContext().firestore(),context('unknown'),context('inactive'),context('one',{email_verified:false}),context('one',{firebase:{sign_in_provider:'password'}})]){
    await assertFails(getDocs(collection(db,base+'/registrations')));await assertFails(confirm(db,'one'));
  }
  const db=context('one');await assertSucceeds(getDoc(doc(db,'users/one')));await assertFails(getDoc(doc(db,'users/two')));await assertFails(getDocs(collection(db,'users')));
  for(const path of ['climateResponses/private','stressResponses/private','climateCycles/2026','epidemiologicalResponses/private'])await assertFails(getDoc(doc(db,path)));
});
