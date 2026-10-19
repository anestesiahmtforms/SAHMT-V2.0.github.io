import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

test('ação offline permanece na fila isolada após recarregar o módulo e conserva o ID idempotente', async () => {
  const firstPage = await import('../src/outbox.js?offline-page-first');
  const uid = 'offline-recovery-user';
  const requestId = 'event-mutation-stable-1';
  const payload = {collectionName: 'events', data: {date: '2026-09-25', memberStatus: 'CR'}};

  await firstPage.enqueueOperation({uid, type: 'events', resourceId: requestId, requestId, payload});
  assert.deepEqual(await firstPage.listQueuedOperations(uid), []);

  // Uma nova instância do módulo representa o estado do cliente após fechar e reabrir o PWA.
  const reopenedPage = await import('../src/outbox.js?offline-page-reopened');
  const restored = await reopenedPage.listUnsettledOperations(uid);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].requestId, requestId);
  assert.equal(restored[0].status, 'awaiting-confirmation');
  assert.deepEqual(restored[0].payload, payload);
  assert.deepEqual(await reopenedPage.operationCounts(uid), {queued: 0, failed: 0, conflict: 0, awaitingConfirmation: 1, sending: 0});

  assert.equal(await reopenedPage.confirmQueuedOperation(uid, requestId), true);
  const claimed = await reopenedPage.claimQueuedOperationForSend(uid, requestId);
  assert.equal(claimed?.status, 'sending');
  await reopenedPage.clearUserLocalData(uid, {clearOutbox: true});
  assert.deepEqual(await firstPage.operationCounts(uid), {queued: 0, failed: 0, conflict: 0, awaitingConfirmation: 0, sending: 0});
});
