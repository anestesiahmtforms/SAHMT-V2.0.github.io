import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as store from '../src/outbox.js';
test('rascunho persiste após reabrir, não contém credenciais e não é exposto a outra conta', async () => {
  await store.saveOperationalDraft('draft-fixture', 'labels', 'entry', {patientName: 'Exemplo sintético', token: 'never-store', date: '2026-10-19'});
  const reopened = await import('../src/outbox.js?draft-reopened');
  const draft = await reopened.readOperationalDraft('draft-fixture', 'labels', 'entry');
  assert.equal(draft.fields.patientName, 'Exemplo sintético'); assert.equal(draft.fields.token, undefined);
  assert.equal(await reopened.readOperationalDraft('other-fixture', 'labels', 'entry'), null);
  await store.clearUserLocalData('draft-fixture');
  assert.ok(await store.readOperationalDraft('draft-fixture', 'labels', 'entry'));
});
test('limpeza de cache expirado e limite não apagam operações pendentes ou rascunhos', async () => {
  const uid = 'cache-clean-fixture';
  await store.enqueueOperation({uid, type: 'events', resourceId: 'pending-clean', requestId: 'pending-clean', payload: {collectionName: 'events', data: {date: '2026-10-19'}}});
  await store.saveOperationalDraft(uid, 'events', 'entry', {date: '2026-10-19'});
  for (let i = 0; i < 5; i++) await store.writeSafeCache(uid, 'events', String(i), {records: []});
  const result = await store.pruneLocalReadCache(uid, {maxEntries: 2});
  assert.equal(result.remainingEntries, 2);
  assert.equal((await store.listUnsettledOperations(uid)).length, 1);
  assert.ok(await store.readOperationalDraft(uid, 'events', 'entry'));
});

test('logout preserva progresso de treinamento não enviado e remove o cache comum', async () => {
  const uid = 'logout-progress-fixture';
  await store.writeSafeCache(uid, 'trainingProgress', 'mine', {records: [{trainingId: 'fixture', syncPending: true, updatedAt: '2026-10-19'}]});
  await store.writeSafeCache(uid, 'events', 'day', {records: []});
  await store.clearUserLocalData(uid, {clearOutbox: false});
  assert.equal((await store.listPendingTrainingProgress(uid)).length, 1);
  assert.equal(await store.readSafeCache(uid, 'events', 'day'), undefined);
});
