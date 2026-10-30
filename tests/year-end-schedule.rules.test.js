import {readFile} from 'node:fs/promises';
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,runTransaction,writeBatch,serverTimestamp,query,orderBy,setLogLevel} from 'firebase/firestore';
import * as firestore from 'firebase/firestore';
import {writeYearEndChoices} from '../src/year-end-schedule-transaction.js';
import {emptyYearEndTotals,readYearEndTotals,changeYearEndTotals} from '../src/year-end-schedule-totals.js';
import {createHash} from 'node:crypto';

let env;setLogLevel('silent');
const base='yearEndSchedules/2026-2027',stamp=()=>serverTimestamp();
const siglas={one:'AB',two:'CD',three:'EF',four:'GH',five:'IJ',six:'KL',inactive:'ZZ',fr:'FR',ad:'AD',l2:'L2',le:'LE',resident1:'AA',resident2:'BB',resident3:'CC',substitute:'DD',excluded:'EE'};
const assignment=(uid,categories=['EFETIVO'])=>({schemaVersion:1,identityStatus:'LINKED',uid,email:uid+'@example.invalid',memberCategories:categories});
const categoryKey=uid=>createHash('sha256').update(JSON.stringify(uid+'@example.invalid')).digest('hex');
const context=(uid,claims={})=>env.authenticatedContext(uid,{email:uid+'@example.invalid',email_verified:true,name:'Pessoa '+uid,firebase:{sign_in_provider:'google.com'},...claims}).firestore();
const totalsRef=db=>doc(db,base+'/summary/totals');
const ownRef=(db,uid)=>doc(db,base+'/registrations/'+uid);
before(async()=>{
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Execute exclusivamente pelo emulador Firestore.');
  env=await initializeTestEnvironment({projectId:'demo-sahmt-year-end',firestore:{rules:await readFile(process.env.YEAR_END_TEST_RULES_FILE||new URL('../firestore.climate.rules',import.meta.url),'utf8')}});
});
after(async()=>env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    for(const uid of [...Object.keys(siglas),'admin']){
      const admin=uid==='admin'||uid==='two'||uid==='excluded'||uid.startsWith('resident')||uid==='substitute';
      await setDoc(doc(db,'users',uid),{uid,email:uid+'@example.invalid',displayName:'Pessoa '+uid,sigla:'',active:uid!=='inactive',access:true,role:admin?'administrador_app':'temporario'});
      const categories=uid==='admin'?['ADMINISTRADOR']:uid==='two'?['EFETIVO','ADMINISTRADOR']:uid.startsWith('resident')?['RESIDENTE_'+uid.at(-1),'ADMINISTRADOR']:uid==='substitute'?['SUBSTITUTO','ADMINISTRADOR']:['EFETIVO'];
      await setDoc(doc(db,'userCategories',categoryKey(uid)),assignment(uid,categories));
      if(siglas[uid])await setDoc(doc(db,base+'/participation/'+uid),{schemaVersion:1,cycle:'2026-2027',sigla:siglas[uid]});
    }
    await setDoc(doc(db,base+'/policy/participation'),{schemaVersion:1,cycle:'2026-2027',summaryVersion:1,siglasByUid:siglas,excludedUids:['excluded']});
    await setDoc(totalsRef(db),{...emptyYearEndTotals(),updatedAt:stamp()});
  });
});
const record=(uid,position,patch={})=>({uid,sigla:siglas[uid],plantao:'natal',grupo:'reveillon',position,createdAt:stamp(),updatedAt:stamp(),...patch});
async function confirm(db,uid,patch={},summaryPatch={}) {
  return runTransaction(db,async tx=>{
    const prior=await tx.get(ownRef(db,uid)),summary=await tx.get(totalsRef(db));
    const previous=prior.exists()?prior.data():null,totals=summary.exists()?readYearEndTotals(summary.data()):emptyYearEndTotals();
    const choices={plantao:previous?'reveillon':'natal',grupo:previous?'natal':'reveillon',...patch};
    const safeChoices={plantao:['natal','reveillon'].includes(choices.plantao)?choices.plantao:'natal',grupo:choices.grupo===null||['natal','reveillon'].includes(choices.grupo)?choices.grupo:'natal'};
    const next=changeYearEndTotals(totals,previous,safeChoices);
    tx.set(totalsRef(db),{...next,updatedAt:stamp(),...summaryPatch});
    if(previous)tx.update(ownRef(db,uid),{plantao:choices.plantao,grupo:choices.grupo,updatedAt:stamp(),...patch});
    else tx.set(ownRef(db,uid),record(uid,next.totalRegistrations,patch));
    return previous?.position||next.totalRegistrations;
  },{maxAttempts:15});
}
const save=(uid,choices)=>{const db=context(uid);return writeYearEndChoices({api:firestore,db,ownRef:ownRef(db,uid),totalsRef:totalsRef(db),uid,sigla:siglas[uid],choices,ensure(){}});};

test('simultaneous confirmations keep unique positions and correct anonymous totals',async()=>{
  const users=['one','two','three','four','five','six'];
  const results=await Promise.allSettled(users.map((uid,i)=>save(uid,{plantao:i%2?'natal':'reveillon',grupo:i%3?'natal':'reveillon'})));
  assert.deepEqual(results.filter(r=>r.status==='rejected').map(r=>r.reason.message),[]);
  assert.deepEqual(results.map(r=>r.value.position).sort((a,b)=>a-b),[1,2,3,4,5,6]);
  const rows=await getDocs(query(collection(context('admin'),base+'/registrations'),orderBy('position','asc')));
  assert.deepEqual(rows.docs.map(r=>r.data().position),[1,2,3,4,5,6]);
  assert.deepEqual(readYearEndTotals((await getDoc(totalsRef(context('one')))).data()),{plantaoNatal:3,plantaoReveillon:3,grupoNatal:4,grupoReveillon:2,totalRegistrations:6});
  await Promise.all(users.map(uid=>save(uid,{plantao:'natal',grupo:'reveillon'})));
  assert.deepEqual(readYearEndTotals((await getDoc(totalsRef(context('one')))).data()),{plantaoNatal:6,plantaoReveillon:0,grupoNatal:0,grupoReveillon:6,totalRegistrations:6});
});

test('participants read their own choice and four totals; only administrators read other records or any list',async()=>{
  await assertSucceeds(confirm(context('one'),'one'));
  await assertSucceeds(confirm(context('two'),'two'));
  const one=context('one'),admin=context('admin');
  await assertSucceeds(getDoc(ownRef(one,'one')));
  await assertFails(getDoc(ownRef(one,'two')));
  await assertFails(getDocs(collection(one,base+'/registrations')));
  await assertFails(getDoc(doc(one,base+'/control/order')));
  assert.equal((await assertSucceeds(getDocs(collection(admin,base+'/registrations')))).size,2);
  await assertSucceeds(getDoc(ownRef(admin,'one')));
  await assertSucceeds(getDocs(collection(context('two'),base+'/registrations')));
  const totals=(await assertSucceeds(getDoc(totalsRef(one)))).data();
  assert.deepEqual(Object.keys(totals).sort(),['grupoNatal','grupoReveillon','plantaoNatal','plantaoReveillon','totalRegistrations','updatedAt'].sort());
  await assertFails(confirm(admin,'admin',{sigla:'ZZ'})); // administrative viewer is not an enrolled participant
  await assertFails(updateDoc(ownRef(admin,'one'),{grupo:'natal',updatedAt:stamp()}));
});

test('privacy regression: a participant cannot query legacy registrations after the update',async()=>{
  await env.withSecurityRulesDisabled(c=>setDoc(ownRef(c.firestore(),'one'),record('one',1)));
  await assertFails(getDocs(collection(context('one'),base+'/registrations')));
  assert.equal((await assertSucceeds(getDocs(collection(context('admin'),base+'/registrations')))).size,1);
});

test('invalid combinations, missing choices, names and spoofed siglas are rejected atomically',async()=>{
  for(const patch of [{plantao:['natal','reveillon']},{plantao:null},{grupo:null},{grupo:['natal','reveillon']},{grupo:'both'},{email:'forbidden'},{displayName:'Outra pessoa'},{sigla:'FR'},{createdAt:new Date(0)},{uid:'two'},{position:9}]){
    await assertFails(confirm(context('one'),'one',patch));
    assert.equal((await getDoc(ownRef(context('one'),'one'))).exists(),false);
    assert.equal((await getDoc(totalsRef(context('one')))).data().totalRegistrations,0);
  }
});

test('updating choices moves counts atomically and preserves position and creation time',async()=>{
  const db=context('one');await assertSucceeds(confirm(db,'one'));
  const ref=ownRef(db,'one'),first=(await getDoc(ref)).data();
  await assertSucceeds(confirm(db,'one'));
  const changed=(await getDoc(ref)).data();assert.equal(changed.position,1);assert.ok(changed.createdAt.isEqual(first.createdAt));
  assert.deepEqual(readYearEndTotals((await getDoc(totalsRef(db))).data()),{plantaoNatal:0,plantaoReveillon:1,grupoNatal:1,grupoReveillon:0,totalRegistrations:1});
  await assertFails(updateDoc(ref,{plantao:'natal',updatedAt:stamp()}));
  for(const patch of [{position:2},{displayName:'Outro nome'},{createdAt:stamp()},{uid:'two'}])await assertFails(confirm(db,'one',patch));
  await assertFails(deleteDoc(ref));
});

test('clients cannot forge totals, write them alone, leak identity fields, skip positions or use legacy counters',async()=>{
  const db=context('one');
  await assertFails(setDoc(totalsRef(db),{...emptyYearEndTotals(),updatedAt:stamp()}));
  for(const patch of [{plantaoNatal:9,totalRegistrations:9},{grupoNatal:-1},{grupoReveillon:0},{lastParticipantUid:'one'},{sigla:'AB'},{updatedAt:new Date(0)}])await assertFails(confirm(db,'one',{},patch));
  await assertFails(setDoc(ownRef(db,'one'),record('one',1)));
  const batch=writeBatch(db);batch.set(doc(db,base+'/control/order'),{lastPosition:1,lastParticipantUid:'one',updatedAt:stamp()});batch.set(ownRef(db,'one'),record('one',1));await assertFails(batch.commit());
  await assertFails(setDoc(doc(db,'yearEndSchedules/2027-2028/registrations/one'),record('one',1)));
});

test('FR AD L2 LE contribute only to shift counts and cannot select a group',async()=>{
  for(const uid of ['fr','ad','l2','le']){
    const db=context(uid);await assertFails(confirm(db,uid));
    await assertFails(confirm(db,uid,{plantao:null,grupo:null}));
    await assertSucceeds(confirm(db,uid,{grupo:null}));
    await assertFails(confirm(db,uid,{grupo:'natal'}));
    await assertSucceeds(confirm(db,uid,{grupo:null}));
  }
  assert.deepEqual(readYearEndTotals((await getDoc(totalsRef(context('one')))).data()),{plantaoNatal:0,plantaoReveillon:4,grupoNatal:0,grupoReveillon:0,totalRegistrations:4});
  await assertFails(updateDoc(doc(context('one'),base+'/policy/participation'),{'siglasByUid.one':'FR'}));
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'users/one'),{sigla:'FR'}));
  await assertFails(confirm(context('one'),'one',{sigla:'FR',grupo:null}));
});

test('residents, substitutes, excluded accounts and unverified sessions cannot read totals or details',async()=>{
  for(const db of [env.unauthenticatedContext().firestore(),context('unknown'),context('inactive'),context('resident1'),context('resident2'),context('resident3'),context('substitute'),context('excluded'),context('one',{email:'two@example.invalid'}),context('one',{email_verified:false}),context('one',{firebase:{sign_in_provider:'password'}})]){
    await assertFails(getDoc(totalsRef(db)));await assertFails(getDocs(collection(db,base+'/registrations')));await assertFails(confirm(db,'one'));
  }
  const db=context('one');await assertSucceeds(getDoc(doc(db,'users/one')));await assertFails(getDoc(doc(db,'users/two')));await assertFails(getDocs(collection(db,'users')));
  for(const path of ['climateResponses/private','stressResponses/private','climateCycles/2026','epidemiologicalResponses/private'])await assertFails(getDoc(doc(db,path)));
});

test('membership or administrator revocation removes access; setup gate prevents writes during migration',async()=>{
  await assertSucceeds(confirm(context('one'),'one'));
  await env.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),'userCategories',categoryKey('one')),assignment('one',['SUBSTITUTO']));
    await updateDoc(doc(c.firestore(),'users/admin'),{role:'temporario'});
  });
  await assertFails(getDoc(totalsRef(context('one'))));await assertFails(getDocs(collection(context('admin'),base+'/registrations')));
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),base+'/policy/participation'),{summaryVersion:0}));
  await assertFails(confirm(context('two'),'two'));
});

test('missing totals cannot restart numbering while another registration exists',async()=>{
  await assertSucceeds(confirm(context('one'),'one'));
  await env.withSecurityRulesDisabled(c=>deleteDoc(totalsRef(c.firestore())));
  await assert.rejects(save('three',{plantao:'natal',grupo:'natal'}),{code:'YEAR_END_SUMMARY_UNAVAILABLE'});
  await assertFails(confirm(context('three'),'three'));
  assert.equal((await getDoc(totalsRef(context('one')))).exists(),false);
  const rows=await getDocs(collection(context('admin'),base+'/registrations'));
  assert.equal(rows.size,1);assert.equal(rows.docs[0].data().position,1);
});

test('ordinary participants cannot fetch the full participation policy',async()=>{
  await assertFails(getDoc(doc(context('one'),base+'/policy/participation')));
  await assertSucceeds(getDoc(doc(context('admin'),base+'/policy/participation')));
  await assertSucceeds(getDoc(doc(context('one'),base+'/participation/one')));
  await assertFails(getDoc(doc(context('one'),base+'/participation/two')));
  await assertFails(getDocs(collection(context('one'),base+'/participation')));
  await assertFails(updateDoc(doc(context('one'),base+'/participation/one'),{sigla:'FR'}));
});
