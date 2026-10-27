import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createLiveReportSession} from '../src/live-report-session.js';
import {subscribeReportWithDeadline} from '../src/report-deadline.js';
import {checklistCacheId, checklistCachedCatalogMatches} from '../src/offline-report-cache.js';
import {stationIsInDateRange} from '../src/checklist-qr.js';
import {projectPendingSchedule} from '../src/offline-schedule-overlay.js';
import {resolveChecklistRotation} from '../src/checklist-rotation.js';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('async function emitCachedOfflineReport('), source.indexOf('function receiveLiveReport('))
  .replaceAll(/import\('([^']+)'\)/g, (_, path) => `loadModule('${path}')`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };

function fixture(kind, {blockDisplay = true, blockSeed = true, automaticServer = true} = {}) {
  const storage = deferred(), remote = new Map(), failures = [], paints = [], stops = [];
  const report = {records: [{id: 'server', stationId: 'station'}], priorRecords: [], stationIds: ['station'], ready: true, confirmed: true, fromCache: false, hasPendingWrites: false};
  const catalog = {records: [{id: 'station', active: true}], truncated: false, fromCache: false, hasPendingWrites: false};
  const watcher = (key, value) => callback => { remote.set(key, callback); if (automaticServer) callback(value); return () => stops.push(key); };
  const scope = {uid: 'one', key: 'day', mode: 'daily', day: '2026-10-26', sourceKeys: kind === 'checklist' ? ['catalog', 'report'] : ['report']};
  const cached = {stations: catalog.records, checklists: {...report, records: [{id: 'cached', stationId: 'station'}]}, events: {...report, records: [{id: 'cached'}]}, labels: {...report, records: [{id: 'cached'}]}};
  Object.assign(cached, {scheduleDays: {positions: [{position: 1, sigla: 'BB'}]}, vacations: [], eventMembers: [{id: 'BB', sigla: 'BB', name: 'Cached', active: true}], checklistConference: {confirmation: {signerName: 'Cached'}}});
  const modules = {
    './report-live-data.js': {watchChecklistStations: watcher('catalog', catalog), watchEventRecords: (_scope, next) => watcher('report', report)(next)},
    './label-report-reader.js': {watchLabelRecords: (_scope, next) => watcher('report', report)(next)},
    './checklist-report-listener.js': {watchChecklistReport: (_scope, next) => watcher('report', report)(next)},
    './outbox.js': {readSafeCache: async (_uid, name) => { if (blockSeed) await storage.promise; return {data: cached[name]}; }, writeSafeCache: async () => {}},
    './checklist-conference-listener.js': {watchChecklistConference: async (_scope, next) => { remote.set('conference', next); return () => {}; }},
    './checklist-rotation-listener.js': {watchChecklistRotation: async (_scope, next) => { remote.set('rotation', next); return () => {}; }}
  };
  const timers = new Set();
  const ctx = vm.createContext({Map, Set, Promise, session: {status: 'signed-in', user: {uid: 'one'}, profile: {}},
    navigator: {onLine: true}, isOfflineRuntimeForced: () => false,
    subscribeReportWithDeadline: options => subscribeReportWithDeadline({...options, timeoutMs: 100}),
    operationalBackend: {noteFailure: error => failures.push(error.code)},
    isFirestoreCacheFallbackError: () => true, checklistCacheId, checklistCachedCatalogMatches, stationIsInDateRange,
    projectPendingSchedule, resolveChecklistRotation, listUnsettledOperations: async () => [],
    operationalReportCacheId: () => 'day', offlineOperationalCacheId: () => 'day',
    checklistCatalogLive: null, checklistRotationLive: null, checklistConferenceLive: null, checklistLocalIntent: null,
    readFreshSafeCache: async (_uid, name) => { if (blockDisplay) await storage.promise; return cached[name] ? {data: cached[name]} : null; },
    readOperationalDraft: async () => null, can: () => false, updateChecklistResponsibilityUI() {},
    loadModule: async path => { assert.ok(modules[path], path); return modules[path]; },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); }
  });
  vm.runInContext(code, ctx);
  const controller = createLiveReportSession({subscribe: (scope, hooks) => ctx.subscribeLiveReport(kind, scope, hooks), onData: value => paints.push(value)});
  controller.start(scope);
  return {ctx, controller, storage, remote, failures, paints, report, catalog, close() { controller.close(); for (const timer of timers) clearTimeout(timer); }};
}

for (const kind of ['events', 'labels', 'checklist']) test(`${kind}: a pending local cache cannot prevent a server-confirmed report`, async t => {
  const h = fixture(kind); t.after(() => h.close());
  await tick(); await tick();
  assert.equal(h.controller.snapshot().state, 'server');
  assert.deepEqual(h.failures, []);
});

test('Checklist starts its record query even when the separate seed reads never settle', async t => {
  const h = fixture('checklist', {blockDisplay: false}); t.after(() => h.close());
  await tick(); await tick();
  assert.equal(h.controller.snapshot().state, 'server');
  assert.equal(h.controller.snapshot().data.report.records[0].id, 'server');
});

test('a late local cache cannot replace a server-confirmed Checklist snapshot', async t => {
  const h = fixture('checklist'); t.after(() => h.close());
  await tick(); await tick();
  assert.equal(h.controller.snapshot().state, 'server');
  h.storage.resolve(); await tick(); await tick();
  assert.equal(h.controller.snapshot().state, 'server');
  assert.equal(h.controller.snapshot().data.report.records[0].id, 'server');
});

test('a report closed during a local read cannot publish its late cache', async () => {
  const h = fixture('checklist', {automaticServer: false});
  await tick(); h.close(); const count = h.paints.length;
  h.storage.resolve(); await tick(); await tick();
  assert.equal(h.controller.snapshot().state, 'closed');
  assert.equal(h.paints.length, count);
});

for (const kind of ['events', 'labels', 'checklist']) test(`${kind}: cached records remain visible until the remote sources are confirmed`, async t => {
  const h = fixture(kind, {blockDisplay: false, blockSeed: false, automaticServer: false}); t.after(() => h.close());
  await tick(); await tick();
  const records = () => kind === 'checklist' ? h.controller.snapshot().data.report.records : h.controller.snapshot().data.records;
  assert.equal(records()[0].id, 'cached');
  if (kind === 'checklist') h.remote.get('catalog')({...h.catalog, records: [], fromCache: true});
  await tick();
  h.remote.get('report')({...h.report, records: [], fromCache: true, confirmed: false});
  assert.equal(records()[0].id, 'cached');
  if (kind === 'checklist') h.remote.get('catalog')(h.catalog);
  await tick();
  h.remote.get('report')(h.report);
  assert.equal(h.controller.snapshot().state, 'server');
  assert.equal(records()[0].id, 'server');
});

test('saved display data never hides SDK pending writes', async t => {
  const h = fixture('events', {blockDisplay: false, automaticServer: false}); t.after(() => h.close());
  await tick();
  h.remote.get('report')({...h.report, fromCache: true, hasPendingWrites: true});
  assert.equal(h.controller.snapshot().state, 'pending');
});

test('late saved display data cannot replace SDK pending writes', async t => {
  const h = fixture('events', {automaticServer: false}); t.after(() => h.close());
  await tick();
  h.remote.get('report')({...h.report, records: [{id: 'pending'}], fromCache: true, hasPendingWrites: true});
  assert.equal(h.controller.snapshot().state, 'pending');
  h.storage.resolve(); await tick(); await tick();
  assert.equal(h.controller.snapshot().state, 'pending');
  assert.equal(h.controller.snapshot().data.records[0].id, 'pending');
});

test('late Checklist cache cannot replace live rotation or conference while the catalog is pending', async t => {
  const h = fixture('checklist', {automaticServer: false}); t.after(() => h.close());
  await tick();
  h.remote.get('conference')({ready: true, fromCache: false, hasPendingWrites: false, confirmation: null});
  h.remote.get('rotation')({ready: true, current: true, fromCache: false, hasPendingWrites: false, rotation: {sigla: 'AA'}});
  h.storage.resolve(); await tick(); await tick();
  assert.equal(h.ctx.checklistConferenceLive.confirmation, null);
  assert.equal(h.ctx.checklistRotationLive.current, true);
  assert.equal(h.ctx.checklistRotationLive.rotation.sigla, 'AA');
  assert.equal(h.controller.snapshot().data.report.records[0].id, 'cached');
  h.remote.get('catalog')(h.catalog); await tick();
  h.remote.get('report')(h.report);
  assert.equal(h.controller.snapshot().state, 'server');
  assert.equal(h.ctx.checklistRotationLive.current, true);
});
