import {before, beforeEach, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertSucceeds, assertFails} from '@firebase/rules-unit-testing';
import {doc, setDoc, getDoc, updateDoc, writeBatch, serverTimestamp} from 'firebase/firestore';
import {fiEmulatorPort,assertFiEmulator} from './helpers/fi-emulator-address.js';

const projects = {FI: 'sahmt-operacional-fi', FJ: 'sahmt-escala-fj'};
const environments = {};
const member = {uid: 'member', email: 'member@example.test', displayName: 'Member', sigla: 'AA', active: true, access: true,
  role: 'anestesiologista', permissions: {eventsRead: true, eventsWrite: true, scheduleRead: true, scheduleWrite: true}};
const catalog = {payers: ['Pagador'], creditors: ['Credor']};
function db(station, uid = 'member', claims = {}) {
  return environments[station].authenticatedContext(uid, {email: uid + '@example.test', email_verified: true,
    sourceProjectId: 'sahmt-17a16', moduleStation: station, aud: projects[station],
    moduleLeaseExpiresAt: Math.floor(Date.now() / 1000) + 300,
    firebase: {sign_in_provider: 'custom'}, ...claims}).firestore();
}
async function seed(station, path, data) {
  await environments[station].withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), path), data));
}
before(async () => {
  assertFiEmulator();
  for (const station of ['FI', 'FJ']) environments[station] = await initializeTestEnvironment({projectId: projects[station],
    firestore: {host: '127.0.0.1', port: fiEmulatorPort, rules: await readFile(new URL('../firestore.' + station.toLowerCase() + '.rules', import.meta.url), 'utf8')}});
});
beforeEach(async () => {
  for (const station of ['FI', 'FJ']) {
    await environments[station].clearFirestore();
    await seed(station, 'users/member', {...member, ...(station === 'FJ' ? {role:'gestor'} : {})});
    await seed(station, 'users/admin', {...member, uid: 'admin', email: 'admin@example.test', displayName: 'Admin', permissions: {admin: true}});
  }
  await seed('FI', 'eventCatalogs/operational', catalog);
  await seed('FJ', 'eventCatalogs/operational', catalog);
  await seed('FJ', 'scheduleDays/2026-11-06', {id: '2026-11-06', date: '2026-11-06', positions: [{position: 1, sigla: 'AA'}],
    highlights: {siglas: [], events: [], releaseTimes: {}}, version: 1});
});
after(async () => { for (const environment of Object.values(environments)) await environment.cleanup(); });

function eventRecord() {
  return {id: 'event', clientMutationId: 'event', date: '2026-11-06', memberSigla: 'AA', scheduleSigla: 'AA', memberStatus: 'Member',
    eventType: 'ATRASO', description: '', delayMultiple: 1, substitute: '', shift: '', payer: 'Pagador', creditor: 'Credor', amountToPay: 100,
    status: 'OPEN', active: true, createdByUid: 'member', updatedByUid: 'member', createdByName: 'Member', updatedByName: 'Member',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), version: 1};
}
test('only destination custom sessions derived from FA may access each module', async () => {
  for (const station of ['FI', 'FJ']) {
    await assertSucceeds(getDoc(doc(db(station), 'users/member')));
    await assertFails(getDoc(doc(db(station, 'member', {sourceProjectId: 'other-project'}), 'users/member')));
    await assertFails(getDoc(doc(db(station, 'member', {moduleStation: station === 'FI' ? 'FJ' : 'FI'}), 'users/member')));
    await assertFails(getDoc(doc(db(station, 'member', {firebase: {sign_in_provider: 'google.com'}}), 'users/member')));
    await assertFails(updateDoc(doc(db(station), 'users/member'), {permissions: {admin: true}}));
  }
});
for (const station of ['FI', 'FJ']) {
test(station + ' creates events with an atomic projection request and refuses forged projection versions', async () => {
  const database = db(station), batch = writeBatch(database);
  batch.set(doc(database, 'events/event'), eventRecord());
  batch.set(doc(database, 'eventProjectionOutbox/event-1'), {eventId: 'event', version: 1, actorUid: 'member', status: 'PENDING', updatedAt: serverTimestamp()});
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(database, 'events/event')));
  await assertFails(setDoc(doc(database, 'events/missing'), {...eventRecord(), id: 'missing', clientMutationId: 'missing'}));
  await assertFails(setDoc(doc(database, 'eventProjectionOutbox/event-2'), {eventId: 'event', version: 2, actorUid: 'member', status: 'PENDING', updatedAt: serverTimestamp()}));
  await assertFails(getDoc(doc(database, 'labels/other-module')));
});
test(station + ' event corrections require a matching immutable history entry', async () => {
  const database = db(station);
  const creation = writeBatch(database);
  creation.set(doc(database, 'events/event'), eventRecord());
  creation.set(doc(database, 'eventProjectionOutbox/event-1'), {eventId: 'event', version: 1, actorUid: 'member', status: 'PENDING', updatedAt: serverTimestamp()});
  await assertSucceeds(creation.commit());
  const adminDb = db(station, 'admin');
  await assertFails(updateDoc(doc(adminDb, 'events/event'), {delayMultiple: 2, amountToPay: 200, version: 2,
    updatedByUid: 'admin', updatedByName: 'Admin', updatedAt: serverTimestamp()}));
  const current = (await getDoc(doc(database, 'events/event'))).data();
  const fields = ['date','memberSigla','scheduleSigla','memberStatus','eventType','description','delayMultiple','substitute','shift','payer','creditor','amountToPay','status'];
  const previous = Object.fromEntries(fields.map(field => [field, current[field] ?? null]));
  const next = {...previous, delayMultiple: 2, amountToPay: 200};
  const batch = writeBatch(adminDb);
  batch.update(doc(adminDb, 'events/event'), {delayMultiple: 2, amountToPay: 200, version: 2, updatedByUid: 'admin', updatedByName: 'Admin', updatedAt: serverTimestamp()});
  batch.set(doc(adminDb, 'events/event/history/2'), {id: '2', eventId: 'event', version: 2, requestId: 'correction',
    actorUid: 'admin', actorName: 'Admin', changedFields: ['delayMultiple','amountToPay'], before: previous, after: next, createdAt: serverTimestamp()});
  batch.set(doc(adminDb, 'eventProjectionOutbox/event-2'), {eventId: 'event', version: 2, actorUid: 'admin', status: 'PENDING', updatedAt: serverTimestamp()});
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(adminDb, 'events/event/history/2'), {actorName: 'Changed'}));
});
}
test('FJ common users cannot launch events even with a legacy eventsWrite grant', async () => {
  await seed('FJ', 'users/member', member);
  const database = db('FJ'), batch = writeBatch(database);
  batch.set(doc(database, 'events/event'), eventRecord());
  batch.set(doc(database, 'eventProjectionOutbox/event-1'), {eventId:'event', version:1, actorUid:'member', status:'PENDING', updatedAt:serverTimestamp()});
  await assertFails(batch.commit());
});

test('FJ preserves release highlights and blocks direct event-marker injection', async () => {
  const reference = doc(db('FJ'), 'scheduleDays/2026-11-06');
  await assertSucceeds(updateDoc(reference, {'highlights.siglas': ['AA'], 'highlights.releaseTimes': {AA: 1800000000000},
    updatedByUid: 'member', updatedAt: serverTimestamp(), version: 2}));
  await assertFails(updateDoc(reference, {'highlights.events': ['EVENTO:AA:AA:forged'],
    updatedByUid: 'member', updatedAt: serverTimestamp(), version: 3}));
  await assertFails(setDoc(doc(db('FJ'), 'events/forged'), eventRecord()));
  const value = (await assertSucceeds(getDoc(reference))).data();
  assert.deepEqual(value.highlights.siglas, ['AA']);
});

test('destination refresh tokens cannot extend an expired module lease', async () => {
  for (const station of ['FI', 'FJ']) {
    await assertFails(getDoc(doc(db(station, 'member', {moduleLeaseExpiresAt: Math.floor(Date.now() / 1000) - 10}), 'users/member')));
    await assertFails(getDoc(doc(db(station, 'member', {moduleLeaseExpiresAt: null}), 'users/member')));
    await assertFails(getDoc(doc(db(station, 'member', {moduleLeaseExpiresAt: String(Math.floor(Date.now() / 1000) + 300)}), 'users/member')));
    await assertSucceeds(getDoc(doc(db(station), 'users/member')));
  }
});

test('checklist and operational consumers can read the local FJ member directory without Escala write access', async () => {
  await seed('FJ', 'eventMembers/AA', {sigla: 'AA', active: true, name: 'Member'});
  for (const permission of ['checklistSign', 'eventsRead']) {
    await seed('FJ', 'users/member', {...member, permissions: {[permission]: true}});
    await assertSucceeds(getDoc(doc(db('FJ'), 'eventMembers/AA')));
    await assertSucceeds(getDoc(doc(db('FJ'), 'scheduleDays/2026-11-06')));
    await assertFails(updateDoc(doc(db('FJ'), 'scheduleDays/2026-11-06'), {positions: []}));
  }
});
