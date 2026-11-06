import {test, before, after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, getDoc, setDoc, updateDoc} from 'firebase/firestore';
let environment;
before(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:18516') throw Error('SOURCE_FREEZE_LOCAL_EMULATOR_REQUIRED');
  environment = await initializeTestEnvironment({projectId: 'sahmt-17a16', firestore: {host: '127.0.0.1', port: 18516,
    rules: await readFile(new URL('../firestore.fa.fi-fj-retired.rules', import.meta.url), 'utf8')}});
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/member'), {uid: 'member', email: 'member@example.test', displayName: 'Member', sigla: 'AA', active: true, access: true,
      role: 'anestesiologista', permissions: {labelsRead: true, checklistRead: true, eventsRead: true, eventsWrite: true, scheduleRead: true, scheduleWrite: true}});
    for (const path of ['events/event', 'events/event/history/2', 'scheduleDays/2026-11-06', 'vacations/item', 'eventCatalogs/operational']) await setDoc(doc(db, path), {active: true});
    await setDoc(doc(db, 'appConfig/app'), {features: {checklist: true}});
    await setDoc(doc(db, 'stations/station'), {active: true, name: 'Station'});
    await setDoc(doc(db, 'labels/label'), {active: true, createdByUid: 'member', memberSigla: 'AA'});
  });
});
after(async () => {await environment?.cleanup();});
test('FA keeps central identity, Checklist and Etiquetas reads while retired module data is closed', async () => {
  const db = environment.authenticatedContext('member', {email: 'member@example.test', email_verified: true}).firestore();
  for (const path of ['users/member', 'appConfig/app', 'stations/station', 'labels/label']) await assertSucceeds(getDoc(doc(db, path)));
  for (const path of ['events/event', 'events/event/history/2', 'scheduleDays/2026-11-06', 'vacations/item', 'eventCatalogs/operational']) {
    await assertFails(getDoc(doc(db, path))); await assertFails(updateDoc(doc(db, path), {active: false}));
  }
  await assertFails(setDoc(doc(db, 'events/new'), {active: true}));
});
