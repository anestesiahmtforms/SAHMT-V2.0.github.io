import test from 'node:test';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection} from 'firebase/firestore';
import {ADMINS} from '../communication/domain.js';
test('FF rules deny direct device, directory, message and audit access for unauthenticated/common/admin clients',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-sahmt-ff',firestore:{rules:readFileSync('firestore.ff.rules','utf8')}});
 try{
  const collections=['communicationMessages','communicationDevices','communicationRecipients','communicationGroups','communicationDispatches','communicationAuditLogs','communicationSettings','communicationBudgets'];
  const contexts=[env.unauthenticatedContext(),env.authenticatedContext('ordinary',{email:'ordinary@example.test',email_verified:true}),...ADMINS.map((email,i)=>env.authenticatedContext('admin-'+i,{email,email_verified:true})),env.authenticatedContext('forged',{email:'other@example.test',email_verified:true,admin:true})];
  for(const c of collections)for(const context of contexts){const db=context.firestore();await assertFails(getDoc(doc(db,c,'one')));await assertFails(getDocs(collection(db,c)));await assertFails(setDoc(doc(db,c,'one'),{uid:'forged'}));}
 }finally{await env.cleanup();}
});
