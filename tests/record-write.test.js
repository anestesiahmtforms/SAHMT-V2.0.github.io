import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOperationalWrite, mayQueueOffline, stageOperationalWrite} from '../src/record-write.js';

test('registros operacionais Firestore usam mutation ID estável sem fila de Sheets', () => {
  const now = {serverTimestamp: true};
  for (const collectionName of ['events', 'labels', 'checklists', 'activities']) {
    const {record} = buildOperationalWrite({collectionName, data: {active: true, title: 'registro'}, uid: 'uid-1', requestId: 'mutation-1', now});
    assert.equal(record.id, 'mutation-1');
    assert.equal(record.clientMutationId, 'mutation-1');
    assert.equal(record.createdAt, now);
  }
});

test('batch grava somente o recurso Firestore', () => {
  const operations = [];
  const batch = {set: (ref, value) => operations.push({ref, value})};
  stageOperationalWrite(batch, {collectionName: 'events', data: {title: 'Evento'}, uid: 'uid-1', requestId: 'event-1', now: {}, recordRef: 'events/event-1'});
  assert.deepEqual(operations.map((item) => item.ref), ['events/event-1']);
});

test('outbox local preserva políticas próprias e rejeita coleções desconhecidas', () => {
  assert.equal(mayQueueOffline('labels'), false);
  assert.equal(mayQueueOffline('events'), true);
  assert.equal(mayQueueOffline('checklists'), true);
  assert.equal(mayQueueOffline('activities'), true);
  for (const collectionName of ['trainingProgress', 'indicatorMeasurements', 'actionPlans', 'equipment']) {
    assert.equal(mayQueueOffline(collectionName), false, collectionName);
  }
  assert.throws(() => buildOperationalWrite({collectionName: 'vacations', data: {}, uid: 'u', requestId: 'r', now: {}}), /não permitida/);
});
