import test from 'node:test';
import assert from 'node:assert/strict';
import {projectionHeaders, verifyProjectionRequest, applyEventProjection, drainEventProjections} from '../worker-operational-domain/projection-runtime.js';
const secret = 'synthetic'.repeat(8), now = 1800000000000;
const event = {eventId: 'event', version: 2, date: '2026-11-06', active: true, scheduleSigla: 'AA', memberSigla: 'BB', actorUid: 'member'};
const body = JSON.stringify(event);
function memoryStore() {
  const documents = new Map([['scheduleDays/' + event.date, {id: event.date, version: 1, highlights: {events: [], siglas: ['AA'], releaseTimes: {AA: now}}}]]);
  return {documents, get: async (collection, id) => documents.has(collection + '/' + id) ? {data: documents.get(collection + '/' + id)} : null,
    listPending: async () => [{id: 'event-2', data: {eventId: 'event', version: 2, status: 'PENDING'}}],
    async transaction(callback) {
      return callback({get: this.get, setProjection: (id, value) => documents.set('eventProjections/' + id, value),
        patchSchedule: (id, value) => {const old = documents.get('scheduleDays/' + id); documents.set('scheduleDays/' + id,
          {...old, version: value.version, highlights: {...old.highlights, events: value.events}});},
        completeOutbox: (id, version) => documents.set('eventProjectionOutbox/' + id, {status: 'DONE', processedVersion: version}),
        deferOutbox: id => documents.set('eventProjectionOutbox/' + id, {...documents.get('eventProjectionOutbox/' + id), lastAttemptAt: now})});
    }};
}

test('signed internal requests reject changed bodies, signatures and expired timestamps', async () => {
  const headers = projectionHeaders(body, secret, {now: () => now});
  const request = extra => new Request('https://worker.test/internal/v1/event-projection', {method: 'POST', headers, body, ...extra});
  assert.deepEqual(await verifyProjectionRequest(request(), secret, {now: () => now}), event);
  await assert.rejects(verifyProjectionRequest(request({body: JSON.stringify({...event, memberSigla: 'ZZ'})}), secret, {now: () => now}), /DOMAIN_PROJECTION_SIGNATURE_INVALID/);
  await assert.rejects(verifyProjectionRequest(request(), secret, {now: () => now + 60001}), /DOMAIN_PROJECTION_SIGNATURE_INVALID/);
  await assert.rejects(verifyProjectionRequest(request(), 'another'.repeat(9), {now: () => now}), /DOMAIN_PROJECTION_SIGNATURE_INVALID/);
});

test('duplicate target deliveries use a receipt and preserve release state', async () => {
  const store = memoryStore();
  assert.equal((await applyEventProjection(event, store)).status, 'APPLIED');
  assert.equal((await applyEventProjection(event, store)).status, 'ALREADY_APPLIED');
  const schedule = store.documents.get('scheduleDays/' + event.date);
  assert.equal(schedule.version, 2); assert.deepEqual(schedule.highlights.events, ['EVENTO:AA:BB:event']);
  assert.deepEqual(schedule.highlights.siglas, ['AA']); assert.deepEqual(schedule.highlights.releaseTimes, {AA: now});
});

test('a failed FI delivery stays pending and a successful retry marks only the outbox done', async () => {
  const store = memoryStore();
  store.documents.set('events/event', {...event, updatedByUid: 'member'});
  store.documents.set('eventProjectionOutbox/event-2', {status: 'PENDING'});
  let failDelivery = true;
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://sahmt-fj-escala.sahmt-fj-563bc56a.workers.dev/internal/v1/event-projection');
    assert.equal(options.redirect, 'manual'); assert.equal(JSON.parse(options.body).eventId, 'event');
    return failDelivery ? Response.json({code: 'synthetic'}, {status: 503}) : Response.json({eventId: 'event', version: 2, status: 'APPLIED'});
  };
  assert.deepEqual(await drainEventProjections({station: 'FI', store, secret, fetchImpl}), {station: 'FI', completed: 0, failed: 1});
  assert.equal(store.documents.get('eventProjectionOutbox/event-2').status, 'PENDING');
  assert.equal(store.documents.get('eventProjectionOutbox/event-2').lastAttemptAt, now);
  failDelivery = false;
  assert.deepEqual(await drainEventProjections({station: 'FI', store, secret, fetchImpl}), {station: 'FI', completed: 1, failed: 0});
  assert.equal(store.documents.get('eventProjectionOutbox/event-2').status, 'DONE');
  assert.equal(store.documents.get('events/event').version, 2);
});
