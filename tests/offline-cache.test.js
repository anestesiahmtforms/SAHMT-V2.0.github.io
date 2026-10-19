import test from 'node:test';
import assert from 'node:assert/strict';
import {readThroughSafeCache} from '../src/offline-cache.js';

test('online read refreshes the UID-scoped cache and returns current data', async () => {
  let cached;
  const uidReads = [];
  const value = await readThroughSafeCache({
    uid: 'uid-a', kind: 'contacts', id: 'active',
    fetchOnline: async () => [{id: 'new-contact'}],
    readCache: async (uid) => { uidReads.push(uid); return cached; },
    writeCache: async (uid, kind, id, data) => { uidReads.push(uid); cached = {uid, kind, id, data}; },
    mayFallback: () => true
  });
  assert.deepEqual(value, [{id: 'new-contact'}]);
  assert.deepEqual(uidReads, ['uid-a']);
  assert.equal(cached.data[0].id, 'new-contact');
});

test('offline read uses only the same UID cache and marks array items stale', async () => {
  const reads = [];
  const value = await readThroughSafeCache({
    uid: 'uid-a', kind: 'vacations', id: '2026-09-25',
    fetchOnline: async () => { throw Object.assign(new Error('offline'), {code: 'unavailable'}); },
    readCache: async (uid, kind, id) => { reads.push([uid, kind, id]); return {uid, data: [{id: 'v1'}]}; },
    writeCache: async () => assert.fail('offline read must not write cache'),
    mayFallback: (error) => error.code === 'unavailable'
  });
  assert.deepEqual(reads, [['uid-a', 'vacations', '2026-09-25']]);
  assert.deepEqual(value, [{id: 'v1', stale: true}]);
  assert.equal(value.stale, true);
});

test('offline cache is not used without a UID or for non-connectivity errors', async () => {
  let cacheReads = 0;
  const base = {
    kind: 'contacts', id: 'active',
    fetchOnline: async () => { throw Object.assign(new Error('denied'), {code: 'permission-denied'}); },
    readCache: async () => { cacheReads++; return {data: [{id: 'cached'}]}; },
    writeCache: async () => {}, mayFallback: (error) => error.code === 'unavailable'
  };
  await assert.rejects(readThroughSafeCache({...base, uid: 'uid-a'}), {code: 'permission-denied'});
  await assert.rejects(readThroughSafeCache({...base, uid: undefined}), {code: 'permission-denied'});
  assert.equal(cacheReads, 0);
});

import {offlineOperationalDashboardMarkup} from '../src/offline-operational-snapshot.js';

test('offline operational modules expose local write forms only for granted write permissions', () => {
  const events = offlineOperationalDashboardMarkup({day: '2026-10-19', route: 'events', permissions: {events: true, eventsWrite: true},
    eventCatalog: {payers: ['Caixa'], creditors: ['Equipe']}, eventSchedule: {positions: [{sigla: 'AB', name: 'Pessoa A'}]}});
  assert.match(events, /data-offline-write-form="events"/);
  assert.match(events, /Aguardando confirmação/);
  assert.doesNotMatch(offlineOperationalDashboardMarkup({day: '2026-10-19', route: 'events', permissions: {events: true, eventsWrite: false}}), /data-offline-write-form="events"/);

  const labels = offlineOperationalDashboardMarkup({day: '2026-10-19', route: 'labels', permissions: {labels: true, labelsWrite: true}, labelStaffSiglas: ['AB']});
  assert.match(labels, /data-offline-write-form="labels"/);
  assert.match(labels, /Nome do paciente/);
  assert.doesNotMatch(offlineOperationalDashboardMarkup({day: '2026-10-19', route: 'labels', permissions: {labels: true, labelsWrite: false}}), /data-offline-write-form="labels"/);

  const checklist = offlineOperationalDashboardMarkup({day: '2026-10-19', route: 'checklist', permissions: {checklist: true, checklistWrite: true}, stations: [{id: 'station-1', name: 'Arsenal 1', active: true}]});
  assert.match(checklist, /data-offline-write-form="checklists"/);
  assert.match(checklist, /Salvar Checklist offline/);
  assert.doesNotMatch(offlineOperationalDashboardMarkup({day: '2026-10-19', route: 'checklist', permissions: {checklist: true, checklistWrite: false}, stations: [{id: 'station-1', active: true}]}), /data-offline-write-form="checklists"/);
});
