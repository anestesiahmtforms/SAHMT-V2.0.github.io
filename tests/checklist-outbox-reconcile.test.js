import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedChecklistOutboxRequestIds} from '../src/checklist-outbox-reconcile.js';

const uid = 'uid-fixture';
const requestId = 'checklist-record-fixture';
const data = {stationId: 'station-fixture', date: '2026-10-21', condition: 'SIM', occurrence: ''};
const operation = (overrides = {}) => ({uid, type: 'checklists', requestId, payload: {collectionName: 'checklists', data}, ...overrides});
const remote = (overrides = {}) => ({id: requestId, clientMutationId: requestId, createdByUid: uid, ...data, ...overrides});

test('servidor confirma operação checklist local apenas quando UID, ID e payload coincidem', () => {
  assert.deepEqual(confirmedChecklistOutboxRequestIds([remote()], [operation()], uid), [requestId]);
});

test('registro apenas visível no cache não apaga fila sem identificador de mutação confirmado', () => {
  assert.deepEqual(confirmedChecklistOutboxRequestIds([remote({clientMutationId: undefined})], [operation()], uid), []);
});

test('ID igual com autor ou conteúdo divergente preserva operação pendente', () => {
  const mismatches = [remote({createdByUid: 'other-user'}), remote({condition: 'NAO'}), remote({stationId: 'other-station'})];
  assert.deepEqual(confirmedChecklistOutboxRequestIds(mismatches, [operation()], uid), []);
});

test('não reconcilia operação de outra pessoa ou outra coleção', () => {
  assert.deepEqual(confirmedChecklistOutboxRequestIds([remote()], [operation({uid: 'other-user'}), operation({type: 'events'})], uid), []);
});

test('confirmações repetidas e IDs duplicados produzem uma única remoção local', () => {
  assert.deepEqual(confirmedChecklistOutboxRequestIds([remote(), remote()], [operation(), operation()], uid), [requestId]);
});
