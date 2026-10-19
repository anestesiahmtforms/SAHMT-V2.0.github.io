import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {enqueueOccurrenceSubmission, listQueuedOperations, operationCounts, updateQueuedOperation} from '../src/outbox.js';

const makePayload = (description = 'Conteúdo sintético') => ({
  formId: 'F01',
  values: {occurrence: description},
  displayName: 'Participante sintético',
  anonymous: false,
  createdAtClient: 1_792_409_600_000
});

test('fila de Ocorrências valida tamanho, mantém ID idempotente, isola UID e limita pendências', async () => {
  const uid = 'offline-occurrence-user-a';
  const recordId = '10000000-0000-4000-8000-000000000001';
  assert.equal(await enqueueOccurrenceSubmission({uid, recordId, payload: makePayload()}), recordId);
  assert.equal(await enqueueOccurrenceSubmission({uid, recordId, payload: makePayload()}), recordId);
  assert.deepEqual(await operationCounts(uid), {queued: 1, failed: 0, conflict: 0, awaitingConfirmation: 0, sending: 0});
  assert.equal((await listQueuedOperations(uid))[0].type, 'occurrences');

  await assert.rejects(
    enqueueOccurrenceSubmission({uid, recordId, payload: makePayload('Conteúdo alterado') }),
    /outro conteúdo/
  );
  await assert.rejects(
    enqueueOccurrenceSubmission({uid: 'offline-occurrence-user-b', recordId, payload: makePayload()}),
    /outra ação ou sessão/
  );
  await assert.rejects(
    enqueueOccurrenceSubmission({uid, recordId: 'invalid-id', payload: makePayload()}),
    /OCCURRENCE_QUEUE_INVALID/
  );
  await assert.rejects(
    enqueueOccurrenceSubmission({uid, recordId: '10000000-0000-4000-8000-000000000002', payload: makePayload('x'.repeat(500_001))}),
    /OCCURRENCE_QUEUE_TOO_LARGE/
  );

  for (let index = 2; index <= 20; index++) {
    const id = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    await enqueueOccurrenceSubmission({uid, recordId: id, payload: makePayload(`Conteúdo ${index}`)});
  }
  await updateQueuedOperation(uid, recordId, {status: 'failed', lastErrorCode: 'permission-denied'});
  await assert.rejects(
    enqueueOccurrenceSubmission({uid, recordId: '10000000-0000-4000-8000-000000000021', payload: makePayload()}),
    /OCCURRENCE_QUEUE_FULL/
  );
  assert.equal((await operationCounts(uid)).queued, 19);
  assert.equal((await operationCounts(uid)).failed, 1);
  assert.equal((await listQueuedOperations('offline-occurrence-user-b')).length, 0);
});
