import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc} from 'firebase/firestore';
import {buildFhSourceRulesFreeze} from '../scripts/lib/fh-source-freeze.js';
let env;
before(async()=>{
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8493')throw Error('FH_FREEZE_LOCAL_EMULATOR_REQUIRED');
 const source=await readFile(new URL('../firestore.fa.fi-fj-retired.rules',import.meta.url),'utf8');
 env=await initializeTestEnvironment({projectId:'sahmt-17a16',firestore:{host:'127.0.0.1',port:8493,rules:buildFhSourceRulesFreeze(source).content}});
 await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{for(const [path,data] of [['users/admin',{uid:'admin',email:'admin@example.test',active:true,access:true,role:'administrador_app',permissions:{admin:true}}],['labels/l1',{createdByUid:'admin'}],['appConfig/labelStaff',{siglas:['AA']}],['appConfig/app',{features:{labels:true}}],['stations/s1',{active:true,name:'Station'}]])await setDoc(doc(c.firestore(),path),data);});
});
after(async()=>{await env?.cleanup();});
test('FA source closure denies labels and their catalog even to administrators while preserving identity, application config and Checklist',async()=>{
 const db=env.authenticatedContext('admin',{email:'admin@example.test',email_verified:true}).firestore();
 for(const path of ['labels/l1','labels/l1/history/2','appConfig/labelStaff']){await assertFails(getDoc(doc(db,path)));await assertFails(updateDoc(doc(db,path),{active:true}));}
 for(const path of ['users/admin','appConfig/app','stations/s1'])await assertSucceeds(getDoc(doc(db,path)));
});
