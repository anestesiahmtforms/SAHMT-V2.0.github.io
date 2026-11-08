import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../src/data.js', import.meta.url), 'utf8');
function section(begin, end) {
  const start = source.indexOf(begin), finish = source.indexOf(end, start + 1);
  assert.ok(start >= 0 && finish > start); return source.slice(start, finish).replaceAll('export ', '');
}
function fixture({deny = false} = {}) {
  const database = {station: 'FJ'}, writes = [], calls = [];
  const context = vm.createContext({console, operationalModuleEnabled: station => station === 'FJ',
    operationalDatabase: async (station, uid) => {calls.push({station, uid}); if (deny) throw Error('MODULE_ACCESS_DENIED'); return database;},
    stageOperationalWrite: (batch, {recordRef, data, uid, requestId, now}) => batch.set(recordRef, {...data, id: requestId, createdByUid: uid, updatedAt: now}),
    serverTimestamp: () => 'SERVER_TIMESTAMP', doc: (db, ...path) => ({db, path: path.join('/')}),
    writeBatch: db => ({set(ref, data) {assert.equal(db, database); writes.push({ref, data});}, commit: async () => {}}),
    db: {station: 'FA'}
  });
  vm.runInContext(section('function buildRecordBatch(', '\nfunction canonicalValue(') +
    section('async function createScheduledEvent(', '\nconst flushPromises'), context);
  return {context, database, writes, calls};
}

test('migrated event and durable projection request commit together only in FI', async () => {
  const f = fixture();
  const result = await f.context.createScheduledEvent({date: '2026-11-06', scheduleSigla: 'AA', memberSigla: 'BB'}, {uid: 'member', requestId: 'event'});
  assert.equal(result.projectionQueued, true);
  assert.deepEqual(f.calls, [{station: 'FJ', uid: 'member'}]);
  assert.deepEqual(f.writes.map(write => write.ref.path), ['events/event', 'eventProjectionOutbox/event-1']);
  assert.equal(f.writes[1].data.actorUid, 'member'); assert.equal(f.writes[1].data.version, 1);
  assert.ok(f.writes.every(write => write.ref.db === f.database));
});

test('denied destination access produces no event or legacy FA write', async () => {
  const f = fixture({deny: true});
  await assert.rejects(f.context.createScheduledEvent({date: '2026-11-06', scheduleSigla: 'AA'}, {uid: 'member', requestId: 'event'}), /MODULE_ACCESS_DENIED/);
  assert.equal(f.writes.length, 0);
});
