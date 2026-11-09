import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createModuleStore} from '../worker-operational-domain/module-store.js';
import {applyEventProjection} from '../worker-operational-domain/projection-runtime.js';
import {encodeFields} from '../worker-training/firestore.js';
import {fiEmulatorPort,assertFiEmulator} from './helpers/fi-emulator-address.js';

const root = `http://127.0.0.1:${fiEmulatorPort}/v1/projects/sahmt-escala-fj/databases/(default)/documents`;
const headers = {Authorization: 'Bearer owner', 'Content-Type': 'application/json'};
const paths = ['scheduleDays/2026-11-07', 'scheduleDays/2026-11-08', 'eventProjections/emulator-projection'];
let commits = 0, injectConflict = false;
before(assertFiEmulator);
const fetchLocal = async (url, options) => {
  const prefix = 'https://firestore.googleapis.com/v1/projects/sahmt-escala-fj/databases/(default)/documents';
  assert.ok(url.startsWith(prefix));
  if (url.endsWith(':commit')) {
    commits++;
    if (injectConflict) {injectConflict = false; return Response.json({error: {status: 'ABORTED'}}, {status: 409});}
  }
  return fetch(root + url.slice(prefix.length), {...options, headers});
};
const store = createModuleStore({station: 'FJ', getAccessToken: async () => 'synthetic-never-sent-to-google', fetchImpl: fetchLocal});
const seed = async (path, fields) => {
  const response = await fetch(root + '/' + path, {method: 'PATCH', headers, body: JSON.stringify({fields})}); assert.equal(response.status, 200);
};
after(async () => {for (const path of paths) await fetch(root + '/' + path, {method: 'DELETE', headers});});

test('real Firestore transactions preserve typed fields and release marks across a moved event and retry', async () => {
  const fields = encodeFields({version: 4, positions: [{position: 1, sigla: 'AA'}], highlights: {siglas: ['AA'], releaseTimes: {AA: 1800000000000}, events: []}});
  fields.createdAt = {timestampValue: '2020-01-01T00:00:00Z'};
  for (const day of ['2026-11-07', '2026-11-08']) await seed('scheduleDays/' + day, {...fields, id: {stringValue: day}, date: {stringValue: day}});
  const event = {eventId: 'emulator-projection', version: 1, date: '2026-11-07', active: true, scheduleSigla: 'AA', memberSigla: 'BB', actorUid: 'member'};
  injectConflict = true;
  assert.equal((await applyEventProjection(event, store)).status, 'APPLIED'); assert.equal(commits, 2);
  const moved = {...event, version: 2, date: '2026-11-08'};
  assert.equal((await applyEventProjection(moved, store)).status, 'APPLIED');
  const count = commits; assert.equal((await applyEventProjection(moved, store)).status, 'ALREADY_APPLIED'); assert.equal(commits, count);
  const old = await store.get('scheduleDays', event.date), current = await store.get('scheduleDays', moved.date);
  assert.deepEqual(old.data.highlights.events, []); assert.deepEqual(current.data.highlights.events, ['EVENTO:AA:BB:emulator-projection']);
  assert.deepEqual(current.data.highlights.siglas, ['AA']); assert.deepEqual(current.data.highlights.releaseTimes, {AA: 1800000000000});
  const raw = await (await fetch(root + '/scheduleDays/' + moved.date, {headers})).json();
  assert.deepEqual(raw.fields.createdAt, fields.createdAt); assert.equal(typeof raw.fields.updatedAt.timestampValue, 'string');
  assert.deepEqual(raw.fields.positions, fields.positions);
});

test('waiting future schedules rotate behind older pending deliveries', async () => {
  const base = {version: 1, date: '2026-11-09', active: true, scheduleSigla: 'AA', memberSigla: 'BB', actorUid: 'member', status: 'WAITING_SCHEDULE'};
  for (const [id, year] of [['waiting-first', 2000], ['waiting-second', 2001]]) {
    paths.push('eventProjections/' + id);
    await seed('eventProjections/' + id, {...encodeFields({...base, eventId: id}), updatedAt: {timestampValue: year + '-01-01T00:00:00Z'}});
  }
  const first = await store.listPending(); assert.equal(first[0].id, 'waiting-first');
  assert.equal((await applyEventProjection(first[0].data, store)).status, 'WAITING_SCHEDULE');
  const second = await store.listPending(); assert.equal(second[0].id, 'waiting-second');
});

test('FI retry metadata updates never complete or remove a failed outbox request', async () => {
  const fiRoot = root.replace('sahmt-escala-fj', 'sahmt-operacional-fi');
  const path = '/eventProjectionOutbox/emulator-retry-1';
  const created = await fetch(fiRoot + path, {method: 'PATCH', headers, body: JSON.stringify({fields: encodeFields({eventId: 'emulator-retry', version: 1, status: 'PENDING'})})});
  assert.equal(created.status, 200);
  const fiStore = createModuleStore({station: 'FI', getAccessToken: async () => 'synthetic', fetchImpl: async (url, options) => {
    const googlePrefix = 'https://firestore.googleapis.com/v1/projects/sahmt-operacional-fi/databases/(default)/documents';
    assert.ok(url.startsWith(googlePrefix)); return fetch(fiRoot + url.slice(googlePrefix.length), {...options, headers});
  }});
  try {
    await fiStore.transaction(async transaction => {await transaction.get('eventProjectionOutbox', 'emulator-retry-1'); transaction.deferOutbox('emulator-retry-1');});
    const current = await fiStore.get('eventProjectionOutbox', 'emulator-retry-1');
    assert.equal(current.data.status, 'PENDING'); assert.equal(current.data.version, 1);
    assert.equal(typeof current.data.lastAttemptAt, 'number'); assert.equal(typeof current.data.updatedAt, 'number');
    await assert.rejects(fiStore.get('scheduleDays', '2026-11-06'), /DOMAIN_STORE_PATH_DENIED/);
  } finally {await fetch(fiRoot + path, {method: 'DELETE', headers});}
});
