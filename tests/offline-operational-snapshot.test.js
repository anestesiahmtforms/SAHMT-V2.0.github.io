import test from 'node:test';
import assert from 'node:assert/strict';
import {readOfflineOperationalSnapshot, offlineOperationalCacheId, writeOfflineOperationalSnapshot, offlineOperationalDashboardMarkup} from '../src/offline-operational-snapshot.js';

test('offline operational snapshots are UID scoped and explicitly stale', async () => {
  const calls = [];
  const value = await readOfflineOperationalSnapshot({
    uid: 'user-a', kind: 'events', day: '2026-10-19',
    access: {sigla: 'AB', isAdmin: false},
    readSafeCache: async (...args) => { calls.push(args); return {uid: 'user-a', kind: 'offlineOperational', cachedAt: 1000, data: {records: [{id: 'e1'}]}}; },
    now: 2000
  });
  assert.deepEqual(calls, [['user-a', 'offlineOperational', offlineOperationalCacheId('events', '2026-10-19', {sigla: 'AB', isAdmin: false})]]);
  assert.deepEqual(value.records, [{id: 'e1', stale: true}]);
  assert.equal(value.stale, true);
});

test('offline snapshot refuses cross-user cache entries and missing UID', async () => {
  const read = async () => ({uid: 'other-user', cachedAt: 1000, data: {records: [{id: 'secret'}]}});
  assert.equal(await readOfflineOperationalSnapshot({uid: 'user-a', kind: 'labels', day: '2026-10-19', access: {}, readSafeCache: read}), null);
  assert.equal(await readOfflineOperationalSnapshot({uid: '', kind: 'labels', day: '2026-10-19', access: {}, readSafeCache: read}), null);
});

test('report cache scope separates admin and staff filters and ignores expired snapshots', async () => {
  assert.notEqual(offlineOperationalCacheId('events', '2026-10-19', {sigla: 'AB', isAdmin: true}), offlineOperationalCacheId('events', '2026-10-19', {sigla: 'AB', isAdmin: false}));
  const expired = await readOfflineOperationalSnapshot({uid: 'user-a', kind: 'events', day: '2026-10-19', access: {sigla: 'AB'}, now: 100_000_000, maxAgeMs: 1000,
    readSafeCache: async () => ({uid: 'user-a', cachedAt: 1_000, data: {records: [{id: 'old'}]}})});
  assert.equal(expired, null);
});

test('checklist and schedule snapshots normalize to read-only stale records', async () => {
  const values = {
    checklists: {uid: 'user-a', cachedAt: 1000, data: {records: [{id: 'c1'}], priorRecords: [{id: 'p1'}]}},
    scheduleDays: {uid: 'user-a', cachedAt: 1000, data: {id: '2026-10-19', positions: [{sigla: 'AB'}]}}
  };
  const readSafeCache = async (uid, kind) => ({...values[kind], uid});
  const checklist = await readOfflineOperationalSnapshot({uid: 'user-a', kind: 'checklist', day: '2026-10-19', readSafeCache, now: 2000});
  const schedule = await readOfflineOperationalSnapshot({uid: 'user-a', kind: 'schedule', day: '2026-10-19', readSafeCache, now: 2000});
  assert.deepEqual(checklist.records, [{id: 'c1', stale: true}]);
  assert.deepEqual(schedule.schedule.positions, [{sigla: 'AB'}]);
  assert.equal(schedule.stale, true);
});

test('invalid module and date never query local storage', async () => {
  let reads = 0;
  const options = {uid: 'user-a', day: '2026-99-99', access: {}, readSafeCache: async () => { reads++; }};
  assert.equal(await readOfflineOperationalSnapshot({...options, kind: 'admin'}), null);
  assert.equal(await readOfflineOperationalSnapshot({...options, kind: 'events'}), null);
  assert.equal(reads, 0);
});

test('only server-confirmed daily records are saved for the same UID and permission scope', async () => {
  const writes = [];
  const writeSafeCache = async (...args) => writes.push(args);
  assert.equal(await writeOfflineOperationalSnapshot({uid: 'user-a', kind: 'events', day: '2026-10-19', access: {sigla: 'AB'}, records: [{id: 'e1'}], confirmed: true, writeSafeCache}), true);
  assert.equal(await writeOfflineOperationalSnapshot({uid: 'user-a', kind: 'events', day: '2026-10-19', access: {sigla: 'AB'}, records: [{id: 'e2', pendingSync: true}], confirmed: true, writeSafeCache}), false);
  assert.equal(await writeOfflineOperationalSnapshot({uid: 'user-a', kind: 'labels', day: '2026-10-19', records: [{id: 'l1'}], confirmed: false, writeSafeCache}), false);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'user-a');
  assert.equal(writes[0][1], 'offlineOperational');
});

test('offline dashboard identifica dados locais e escapa texto no módulo correspondente', () => {
  const snapshots = {
    schedule: {schedule: {positions: [{sigla: 'AB'}]}}, checklist: {records: [{stationName: '<img>'}]},
    events: {records: [{description: '<script>'}]}, labels: {records: [{patientName: 'Pessoa <teste>'}]}
  };
  let markup = '';
  for (const [route, heading] of [['home', 'Escala do dia'], ['checklist', 'Checklist'], ['events', 'Eventos'], ['labels', 'Etiquetas']]) {
    const page = offlineOperationalDashboardMarkup({day: '2026-10-19', route, permissions: {schedule: true, checklist: true, events: true, labels: true}, snapshots});
    assert.ok(page.includes(heading)); assert.match(page, /cópia local/); assert.doesNotMatch(page, /<form/); markup += page;
  }
  assert.doesNotMatch(markup, /<script>|<img>/);
  assert.match(markup, /&lt;script&gt;/);
});
