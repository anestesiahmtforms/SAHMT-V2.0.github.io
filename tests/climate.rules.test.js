import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, getDoc, setDoc, collection, getDocs} from 'firebase/firestore';
test('FE denies all raw access and writes; published reports require a dedicated FE claim', async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Run through the Firestore emulator');
  const env = await initializeTestEnvironment({projectId: 'demo-sahmt-climate', firestore: {rules: readFileSync(new URL('../firestore.climate.rules', import.meta.url), 'utf8')}});
  try {
    await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'climateReports/2026'), {submissions: 10}); });
    const anonymous = env.unauthenticatedContext().firestore(), user = env.authenticatedContext('reader-without-claim').firestore(), reader = env.authenticatedContext('designated-fe-reader', {climateReportReader: true}).firestore();
    for (const db of [anonymous, user]) { await assertFails(getDoc(doc(db, 'climateReports/2026'))); await assertFails(getDocs(collection(db, 'climateReports'))); await assertFails(getDoc(doc(db, 'climateActionReports/2026'))); }
    await assertSucceeds(getDoc(doc(reader, 'climateReports/2026'))); await assertSucceeds(getDocs(collection(reader, 'climateReports')));
    await assertSucceeds(getDoc(doc(reader, 'climateActionReports/2026')));
    for (const db of [anonymous, user, reader]) for (const path of ['climateResponses/token', 'climateComments/token', 'climateCycles/2026', 'climateReports/2026', 'climateActionReports/2026']) {
      await assertFails(setDoc(doc(db, path), {uid: 'forbidden'}));
      if (!path.startsWith('climateReports') && !path.startsWith('climateActionReports')) await assertFails(getDoc(doc(db, path)));
    }
  } finally { await env.cleanup(); }
});

test('FE registry lookup is own verified active account only, separate from anonymous answers',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-sahmt-classification',firestore:{rules:readFileSync(new URL('../firestore.climate.rules',import.meta.url),'utf8')}});
 try{
  await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'users/member'),{uid:'member',active:true,access:true});await setDoc(doc(c.firestore(),'userCategories/synthetic'),{schemaVersion:1,uid:'member',email:'member@example.invalid',identityStatus:'LINKED',memberCategories:['EFETIVO']});});
  const member=env.authenticatedContext('member',{email:'member@example.invalid',email_verified:true}).firestore();
  await assertSucceeds(getDoc(doc(member,'userCategories/synthetic')));
  for(const db of [env.unauthenticatedContext().firestore(),env.authenticatedContext('other',{email:'member@example.invalid',email_verified:true}).firestore(),env.authenticatedContext('member',{email:'member@example.invalid',email_verified:false}).firestore()])await assertFails(getDoc(doc(db,'userCategories/synthetic')));
  await assertFails(getDoc(doc(member,'users/member')));await assertFails(getDoc(doc(member,'climateResponses/synthetic')));await assertFails(setDoc(doc(member,'userCategories/synthetic'),{uid:'member'}));
  await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'users/member'),{uid:'member',active:true,access:false}));await assertFails(getDoc(doc(member,'userCategories/synthetic')));
 }finally{await env.clearFirestore();await env.cleanup();}
});
