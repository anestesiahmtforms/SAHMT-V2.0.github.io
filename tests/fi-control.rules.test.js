import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,collection,getDocs} from 'firebase/firestore';
import {fiEmulatorPort,assertFiEmulator} from './helpers/fi-emulator-address.js';
let env;
before(async()=>{assertFiEmulator();env=await initializeTestEnvironment({projectId:'demo-sahmt-fi-control',firestore:{host:'127.0.0.1',port:fiEmulatorPort,rules:await readFile(new URL('../firestore.fi-control.rules',import.meta.url),'utf8')}});});
after(async()=>env?.cleanup());
test('FI control collections deny every browser identity, including claimed administrators',async()=>{
 for(const context of [env.unauthenticatedContext(),env.authenticatedContext('member',{email:'member@example.test'}),env.authenticatedContext('admin',{admin:true,role:'administrador_app',email_verified:true})]){
  const db=context.firestore();for(const path of ['users/private','fiAdminUsers/private','fiAdminIdentityLinks/private','fiSearchRecords/private','fiAiRuns/private','fiControlConfig/runtime']){await assertFails(getDoc(doc(db,path)));await assertFails(setDoc(doc(db,path),{active:true}));}
  await assertFails(getDocs(collection(db,'fiAdminUsers')));
 }
});
