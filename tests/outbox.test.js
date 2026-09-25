import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {localDateKey, shiftDateKey} from '../src/schedule-date.js';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test('migração IndexedDB preserva dados e isola outbox e cache por UID', async () => {
  const opening = indexedDB.open('sahmt-v2-local', 2);
  opening.onupgradeneeded = () => {
    const db = opening.result;
    db.createObjectStore('profiles', {keyPath: 'uid'});
    db.createObjectStore('cache', {keyPath: 'key'});
    db.createObjectStore('outbox', {keyPath: 'requestId'});
  };
  const legacyDb = await requestResult(opening);
  const seed = legacyDb.transaction(['profiles', 'cache', 'outbox'], 'readwrite');
  seed.objectStore('profiles').put({uid: 'uid-a', displayName: 'Pessoa A', cachedAt: Date.now()});
  seed.objectStore('profiles').put({uid: 'uid-b', displayName: 'Pessoa B', cachedAt: Date.now()});
  seed.objectStore('cache').put({key: 'uid-a::events::active', uid: 'uid-a', kind: 'events', id: 'active', data: []});
  seed.objectStore('cache').put({key: 'uid-b::events::active', uid: 'uid-b', kind: 'events', id: 'active', data: []});
  seed.objectStore('cache').put({key: 'uid-a::scheduleDays::2026-09-25', uid: 'uid-a', kind: 'scheduleDays', id: '2026-09-25', data: {id: '2026-09-25', positions: [{sigla: 'AB'}]}});
  seed.objectStore('outbox').put({requestId: 'a-queued', uid: 'uid-a', type: 'events', resourceId: 'a-queued', payload: {}, createdAt: 1, attempts: 0, status: 'queued', nextAttemptAt: 0, lastError: ''});
  seed.objectStore('outbox').put({requestId: 'a-failed', uid: 'uid-a', type: 'events', resourceId: 'a-failed', payload: {}, createdAt: 2, attempts: 1, status: 'failed', nextAttemptAt: 0, lastError: 'permission-denied'});
  seed.objectStore('outbox').put({requestId: 'a-expired-checklist', uid: 'uid-a', type: 'checklists', resourceId: 'station-a', payload: {data: {date: shiftDateKey(localDateKey(), -1)}}, createdAt: 3, attempts: 1, status: 'failed', nextAttemptAt: 0, lastError: 'permission-denied'});
  seed.objectStore('outbox').put({requestId: 'a-event-conflict', uid: 'uid-a', type: 'eventEdits', resourceId: 'event-a', payload: {eventId: 'event-a', expectedVersion: 2}, createdAt: 4, attempts: 1, status: 'conflict', nextAttemptAt: 0, lastErrorCode: 'stale-version'});
  seed.objectStore('outbox').put({requestId: 'b-queued', uid: 'uid-b', type: 'events', resourceId: 'b-queued', payload: {}, createdAt: 5, attempts: 0, status: 'queued', nextAttemptAt: 0, lastError: ''});
  await new Promise((resolve, reject) => {
    seed.oncomplete = resolve;
    seed.onerror = () => reject(seed.error);
    seed.onabort = () => reject(seed.error);
  });
  legacyDb.close();

  const outbox = await import('../src/outbox.js');
  assert.deepEqual((await outbox.listQueuedOperations('uid-a')).map((item) => item.requestId), ['a-queued']);
  const stablePayload = {data: {first: 1, second: 2}};
  await outbox.enqueueOperation({uid: 'uid-a', type: 'events', resourceId: 'stable-event', requestId: 'stable-event', payload: stablePayload});
  await outbox.enqueueOperation({uid: 'uid-a', type: 'events', resourceId: 'stable-event', requestId: 'stable-event', payload: {data: {second: 2, first: 1}}});
  await assert.rejects(
    outbox.enqueueOperation({uid: 'uid-a', type: 'events', resourceId: 'stable-event', requestId: 'stable-event', payload: {data: {first: 9}}}),
    /outro conteúdo/
  );
  await assert.rejects(
    outbox.enqueueOperation({uid: 'uid-b', type: 'events', resourceId: 'stable-event', requestId: 'stable-event', payload: stablePayload}),
    /outra ação ou sessão/
  );
  assert.deepEqual((await outbox.listQueuedOperations('uid-a')).find((item) => item.requestId === 'stable-event').payload, stablePayload);
  assert.equal(await outbox.removeQueuedOperation('uid-a', 'stable-event'), true);
  assert.equal(await outbox.nextQueuedAttemptAt('uid-a'), 0);
  assert.equal(await outbox.nextQueuedAttemptAt('uid-without-operations'), null);
  const laterAttempt = Date.now() + 30_000;
  const earliestAttempt = Date.now() + 10_000;
  await outbox.enqueueOperation({uid: 'retry-user', type: 'events', resourceId: 'retry-later', requestId: 'retry-later', payload: {}});
  await outbox.enqueueOperation({uid: 'retry-user', type: 'events', resourceId: 'retry-earlier', requestId: 'retry-earlier', payload: {}});
  assert.equal(await outbox.updateQueuedOperation('retry-user', 'retry-later', {nextAttemptAt: laterAttempt}), true);
  assert.equal(await outbox.updateQueuedOperation('retry-user', 'retry-earlier', {nextAttemptAt: earliestAttempt}), true);
  assert.equal(await outbox.nextQueuedAttemptAt('retry-user'), earliestAttempt);
  await outbox.clearUserLocalData('retry-user', {clearOutbox: true});
  assert.deepEqual((await outbox.listUnsettledOperations('uid-a')).map((item) => item.requestId), ['a-queued', 'a-failed', 'a-expired-checklist', 'a-event-conflict']);
  assert.deepEqual(await outbox.operationCounts('uid-a'), {queued: 1, failed: 2, conflict: 1});
  assert.equal(await outbox.pendingOperationCount('uid-a'), 4);
  assert.equal(await outbox.retryFailedOperations('uid-a'), 2);
  assert.deepEqual(await outbox.operationCounts('uid-a'), {queued: 3, failed: 0, conflict: 1});
  assert.equal((await outbox.listUnsettledOperations('uid-a')).some((item) => item.requestId === 'a-event-conflict'), true);
  assert.deepEqual(await outbox.readCachedSchedule('uid-a', '2026-09-25'), {id: '2026-09-25', positions: [{sigla: 'AB'}], stale: true});
  assert.equal(await outbox.readCachedSchedule('uid-b', '2026-09-25'), null);
  assert.equal(await outbox.readCachedSchedule('uid-a', 'invalid'), null);

  await outbox.writeSafeCache('uid-a', 'trainingProgress', 'mine', {records: [
    {id: 'uid-a_video-a', uid: 'uid-a', trainingId: 'video-a', syncPending: true, lastPosition: 12},
    {id: 'uid-a_video-b', uid: 'uid-a', trainingId: 'video-b', syncPending: true, lastPosition: 24, syncError: 'permission-denied'},
    {id: 'uid-a_video-c', uid: 'uid-a', trainingId: 'video-c', syncPending: false, lastPosition: 48}
  ]});
  await outbox.writeSafeCache('uid-b', 'trainingProgress', 'mine', {records: [
    {id: 'uid-b_video-a', uid: 'uid-b', trainingId: 'video-a', syncPending: true, lastPosition: 5}
  ]});
  assert.equal(await outbox.pendingTrainingProgressCount('uid-a'), 2);
  assert.deepEqual((await outbox.listPendingTrainingProgress('uid-a')).map((item) => item.trainingId), ['video-a', 'video-b']);
  assert.equal(await outbox.updateCachedTrainingProgress('uid-a', 'video-a', {syncError: 'unavailable', syncAttempts: 1}), true);
  assert.equal(await outbox.updateCachedTrainingProgress('uid-a', 'missing', {syncError: 'denied'}), false);
  assert.equal(await outbox.updateCachedTrainingProgress('uid-a', 'video-c', {status: 'COMPLETED'}), false);
  assert.equal(await outbox.updateCachedTrainingProgress('uid-a', 'video-c', {status: 'COMPLETED'}, {requirePending: false}), true);
  const trainingCache = await outbox.readSafeCache('uid-a', 'trainingProgress', 'mine');
  assert.equal(trainingCache.data.records.find((item) => item.trainingId === 'video-c').status, 'COMPLETED');
  assert.equal(await outbox.pendingTrainingProgressCount('uid-b'), 1);
  assert.equal(await outbox.discardCachedTrainingProgress('uid-a', 'video-a'), true);
  assert.deepEqual((await outbox.listPendingTrainingProgress('uid-a')).map((item) => item.trainingId), ['video-b']);
  assert.equal((await outbox.readSafeCache('uid-a', 'trainingProgress', 'mine')).data.records.some((item) => item.trainingId === 'video-c'), true);

  await outbox.enqueueOperation({uid: 'uid-a', type: 'events', resourceId: 'new-a', payload: {data: {}}, requestId: 'new-a'});
  await outbox.enqueueOperation({uid: 'uid-a', type: 'scheduleReleases', resourceId: '2026-09-25:AB', payload: {day: '2026-09-25', sigla: 'AB', marked: true}, requestId: 'schedule-release::uid-a::2026-09-25::AB', coalesce: true});
  await outbox.enqueueOperation({uid: 'uid-a', type: 'scheduleReleases', resourceId: '2026-09-25:AB', payload: {day: '2026-09-25', sigla: 'AB', marked: false}, requestId: 'schedule-release::uid-a::2026-09-25::AB', coalesce: true});
  const coalescedRelease = (await outbox.listQueuedOperations('uid-a')).find((item) => item.type === 'scheduleReleases');
  assert.equal(coalescedRelease.payload.marked, false);
  assert.equal((await outbox.listQueuedOperations('uid-a')).filter((item) => item.type === 'scheduleReleases').length, 1);
  await outbox.clearUserLocalData('uid-a', {clearOutbox: true});
  assert.deepEqual(await outbox.operationCounts('uid-a'), {queued: 0, failed: 0, conflict: 0});
  assert.deepEqual(await outbox.operationCounts('uid-b'), {queued: 1, failed: 0, conflict: 0});
  assert.equal(await outbox.readCachedProfile('uid-a'), null);
  assert.equal((await outbox.readCachedProfile('uid-b')).displayName, 'Pessoa B');
  assert.deepEqual((await outbox.readSafeCache('uid-b', 'events', 'active')).data, []);
});
