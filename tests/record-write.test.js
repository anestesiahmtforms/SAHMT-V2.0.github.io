import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOperationalWrite, createReportSyncJob, mayQueueOffline, requiresReportSync, stageOperationalWrite} from '../src/record-write.js';

test('criação de Eventos, Etiquetas e Checklist inclui job mínimo no mesmo batch', () => {
  const now = {serverTimestamp: true};
  for (const collectionName of ['events', 'labels', 'checklists']) {
    const {record, syncJob} = buildOperationalWrite({
      collectionName,
      data: {active: true, title: 'registro'},
      uid: 'uid-1',
      requestId: 'mutation-1',
      now
    });
    assert.equal(record.syncJobId, 'mutation-1');
    assert.equal(record.clientMutationId, 'mutation-1');
    assert.deepEqual(syncJob, {
      id: 'mutation-1', resourceType: collectionName, resourceId: 'mutation-1', operation: 'upsert',
      version: 1, status: 'pending', attempts: 0, createdByUid: 'uid-1', createdAt: now,
      updatedAt: now, nextAttemptAt: now, lastError: '', clientMutationId: 'mutation-1'
    });
  }
});

test('atividade de Gestão mantém o contrato próprio e não recebe syncJobId de Sheets', () => {
  const now = {serverTimestamp: true};
  const {record, syncJob} = buildOperationalWrite({
    collectionName: 'activities', data: {title: 'Tarefa'}, uid: 'uid-1', requestId: 'activity-1', now
  });
  assert.equal(record.id, 'activity-1');
  assert.equal(record.clientMutationId, 'activity-1');
  assert.equal(record.syncJobId, undefined);
  assert.equal(syncJob, null);
  assert.equal(requiresReportSync('activities'), false);
});

test('batch cria sidecar somente nas três coleções espelhadas para relatório', () => {
  const operations = [];
  const batch = {set: (ref, value) => operations.push({ref, value})};
  const now = {serverTimestamp: true};
  stageOperationalWrite(batch, {
    collectionName: 'activities', data: {title: 'Atividade'}, uid: 'uid-1', requestId: 'activity-1', now,
    recordRef: 'activities/activity-1', syncJobRef: (id) => `syncQueue/${id}`
  });
  assert.deepEqual(operations.map((item) => item.ref), ['activities/activity-1']);

  operations.length = 0;
  stageOperationalWrite(batch, {
    collectionName: 'events', data: {title: 'Evento'}, uid: 'uid-1', requestId: 'event-1', now,
    recordRef: 'events/event-1', syncJobRef: (id) => `syncQueue/${id}`
  });
  assert.deepEqual(operations.map((item) => item.ref), ['events/event-1', 'syncQueue/event-1']);
});

test('Etiquetas não entram na outbox persistente e continuam disponíveis como fluxo online', () => {
  assert.equal(mayQueueOffline('labels'), false);
  assert.equal(mayQueueOffline('events'), true);
  assert.equal(mayQueueOffline('checklists'), true);
  assert.equal(mayQueueOffline('activities'), true);
  assert.throws(() => createReportSyncJob({resourceType: 'activities', resourceId: 'a', version: 1, uid: 'u', jobId: 'j', now: {}}), /fora da integração/);
  assert.throws(() => buildOperationalWrite({collectionName: 'vacations', data: {}, uid: 'u', requestId: 'r', now: {}}), /não permitida/);
});
