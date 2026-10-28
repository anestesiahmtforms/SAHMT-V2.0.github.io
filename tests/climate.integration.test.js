import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,writeBatch} from 'firebase/firestore';
import {VERSION} from '../climate-domain/schema.js';
const response={respondent_uid:'member',category_key:'a'.repeat(64),survey_cycle:'2026',survey_version:VERSION,group:'team',answers:{Q01:4}};
const comment={respondent_uid:'member',category_key:'a'.repeat(64),group:'team',survey_cycle:'2026',comments:{O01:'Comentário fictício'}};
const id=n=>n.toString(16).padStart(32,'0');
test('free FE rules validate authenticated atomic writes, exact retries and closure without exposing raw data',async()=>{
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Emulator only');
 const env=await initializeTestEnvironment({projectId:'demo-sahmt-climate-integration',firestore:{rules:readFileSync(new URL('../firestore.climate.rules',import.meta.url),'utf8')}});
 const db=env.authenticatedContext('member',{email:'member@example.invalid',email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();

 const seed=group=>env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'users/member'),{uid:'member',active:true,access:true});await setDoc(doc(db,'userCategories/'+'a'.repeat(64)),{schemaVersion:1,identityStatus:'LINKED',uid:'member',email:'member@example.invalid',memberCategories:[{team:'EFETIVO',resident:'RESIDENTE_1',substitute:'SUBSTITUTO'}[group]]});});
 try{
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'climateCycles/2026'),{status:'open',survey_version:'1.0'}));
  const send=()=>{const batch=writeBatch(db);batch.set(doc(db,'climateResponses/'+id(1)),response);batch.set(doc(db,'climateComments/'+id(2)),comment);return batch.commit();};
  await seed('team');await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(),'climateResponses/'+id(500)),response));
  await assertSucceeds(send());await assertSucceeds(send());
  for(const [group,module]of [['resident','R01'],['team','T01']]){await seed(group);await assertSucceeds(setDoc(doc(db,'climateResponses/'+id(20+module.charCodeAt(0))),{...response,group,answers:{Q01:4,[module]:5}}));}
  await seed('substitute');await assertSucceeds(setDoc(doc(db,'climateResponses/'+id(99)),{...response,group:'substitute'}));
  await assertFails(setDoc(doc(db,'climateResponses/'+id(98)),{...response,group:'substitute',answers:{Q01:4,T01:5}}));
  await assertFails(setDoc(doc(db,'climateResponses/'+id(100)),{...response,group:'team',answers:{Q01:4,R01:5}}));
  await assertFails(setDoc(doc(db,'climateResponses/'+id(101)),{...response,group:'unspecified'}));
  const noGroup={...response};delete noGroup.group;
  await assertFails(setDoc(doc(db,'climateResponses/'+id(102)),noGroup));
  const legacy={survey_cycle:'2026',survey_version:'1.0',answers:{Q01:4}};
  await assertFails(setDoc(doc(db,'climateResponses/'+id(103)),legacy));
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'climateResponses/'+id(104)),legacy));
  await assertFails(setDoc(doc(db,'climateResponses/'+id(104)),legacy));
  await seed('team');
  await assertFails(setDoc(doc(db,'climateResponses/'+id(104)),{...legacy,group:'team'}));

  // The registry decides the category; the client cannot impersonate another account.
  for(const change of [{respondent_uid:'other'},{category_key:'b'.repeat(64)},{group:'resident'}])await assertFails(setDoc(doc(db,'climateResponses/'+id(700)),{...response,...change}));
  await assertFails(getDoc(doc(db,'climateResponses/'+id(1))));await assertFails(getDoc(doc(db,'climateComments/'+id(2))));
  await assertFails(setDoc(doc(db,'climateResponses/'+id(1)),{...response,answers:{Q01:5}}));
  for(const change of [{group:'secretaries'},{answers:{Q01:4,A01:5}},{uid:'secret'},{name:'secret'},{email:'secret'},{ip:'secret'},{timestamp:'now'},{survey_cycle:'2025'},{answers:{Q01:'4'}},{answers:{Q01:6}},{answers:{Q01:'NA'}},{answers:{Q01:4,uid:'secret'}},{answers:{Q01:4,R01:4,T01:4}},{answers:{Q01:4,A01:4,T01:4}},{survey_version:'2'}])await assertFails(setDoc(doc(db,'climateResponses/'+id(3)),{...response,...change}));
  await assertFails(setDoc(doc(db,'climateResponses/user-name'),response));
  const badBatch=writeBatch(db);badBatch.set(doc(db,'climateResponses/'+id(4)),response);badBatch.set(doc(db,'climateComments/'+id(5)),{...comment,uid:'secret'});await assertFails(badBatch.commit());
  await env.withSecurityRulesDisabled(async c=>assert.equal((await getDoc(doc(c.firestore(),'climateResponses/'+id(4)))).exists(),false));
  await assertFails(setDoc(doc(db,'climateComments/'+id(6)),{...comment,comments:{O01:'x'.repeat(1501)}}));
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'climateCycles/2026'),{status:'closed',survey_version:'1.0'}));
  await assertFails(send());await assertFails(setDoc(doc(db,'climateResponses/'+id(7)),response));
 }finally{await env.clearFirestore();await env.cleanup();}
});
