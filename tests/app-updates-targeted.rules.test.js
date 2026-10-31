import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment, assertSucceeds, assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,serverTimestamp,Timestamp,setLogLevel,deleteField,writeBatch} from 'firebase/firestore';
setLogLevel('silent');
for (const [file,target] of [['firestore.rules','FA'],['firestore.independent-fb.rules','FB']]) test('targeted updates security '+target,async t=>{
  const env=await initializeTestEnvironment({projectId:'demo-sahmt-updates-'+target.toLowerCase(),firestore:{host:'127.0.0.1',port:Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':').pop()||8080),rules:await readFile(file,'utf8')}});
  t.after(()=>env.cleanup()); await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{
    for(const uid of ['admin','manager','member','other','blocked'])await setDoc(doc(c.firestore(),'users',uid),{uid,email:uid+'@example.invalid',displayName:uid,sigla:'',phone:'',active:true,access:uid!=='blocked',role:uid==='admin'?'administrador_app':'anestesiologista',permissions:uid==='manager'?{usersManage:true}:{},createdAt:Timestamp.now(),updatedAt:Timestamp.now()});
  });
  const db=uid=>env.authenticatedContext(uid).firestore();
  const requirement=()=>({id:'requirement-123456789012',target,minimumRelease:200,requestedByUid:'admin',requestedAt:serverTimestamp()});
  await t.test('only administrator selects users; self removal and usersManage privilege cannot change the request',async()=>{
    await assertSucceeds(updateDoc(doc(db('admin'),'users','member'),{appUpdateRequest:requirement()}));
    for(const uid of ['member','manager','other','blocked'])await assertFails(updateDoc(doc(db(uid),'users','member'),{appUpdateRequest:null}));
    await assertFails(updateDoc(doc(db('member'),'users','member'),{appUpdateRequest:deleteField()}));
    await assertFails(updateDoc(doc(db('admin'),'users','member'),{appUpdateRequest:{...requirement(),target:target==='FA'?'FB':'FA'}}));
    await assertFails(updateDoc(doc(db('admin'),'users','member'),{appUpdateRequest:requirement(),access:false}));
    await assertSucceeds(getDoc(doc(db('member'),'users','member')));
  });
  const deviceId='12345678-1234-1234-1234-123456789012';
  const receipt=(uid='member',extra={})=>({uid,deviceId,target,platform:'Android',loadedRelease:200,confirmedRequestId:'requirement-123456789012',lastSeenAt:serverTimestamp(),...extra});
  const path=uid=>['users',uid,'appInstallations',deviceId+'_'+target];
  await t.test('each owner writes only their installation; receipts require the correct request and version',async()=>{
    await assertSucceeds(setDoc(doc(db('member'),...path('member')),receipt()));
    await assertFails(setDoc(doc(db('other'),...path('member')),receipt()));
    await assertFails(setDoc(doc(db('admin'),...path('member')),receipt()));
    for(const change of [{loadedRelease:100},{confirmedRequestId:'another-request-id'}, {uid:'other'}, {lastSeenAt:Timestamp.fromMillis(1)}, {extra:'bad'}])await assertFails(setDoc(doc(db('member'),...path('member')),receipt('member',change)));
    await assertSucceeds(setDoc(doc(db('member'),...path('member')),receipt('member',{loadedRelease:100,confirmedRequestId:''})));
    await assertSucceeds(getDocs(collection(db('admin'),'users','member','appInstallations')));
    await assertFails(getDocs(collection(db('other'),'users','member','appInstallations')));
    await assertFails(getDocs(collection(db('manager'),'users','member','appInstallations')));
  });
  await t.test('global command writes separate user requirements without changing permissions and cancellation preserves devices',async()=>{
    const batch=writeBatch(db('admin'));for(const uid of ['member','other'])batch.update(doc(db('admin'),'users',uid),{appUpdateRequest:requirement()});await assertSucceeds(batch.commit());
    await assertSucceeds(updateDoc(doc(db('admin'),'users','member'),{appUpdateRequest:null}));
    assert.equal((await getDoc(doc(db('member'),'users','member'))).data().access,true);
    await assertSucceeds(getDoc(doc(db('admin'),...path('member'))));
  });
});
