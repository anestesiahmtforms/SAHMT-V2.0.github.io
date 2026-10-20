import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {confirmQueuedOperation, enqueueOperation, listAwaitingConfirmationOperations, listQueuedOperations, listUnsettledOperations} from '../src/outbox.js';

test('Eventos, Etiquetas e Checklist aguardam confirmação antes de entrar na fila de envio', async () => {
  const operations = [
    ['events', 'event-offline'],
    ['labels', 'label-offline'],
    ['checklists', 'checklist-offline']
  ];
  for (const [type, id] of operations) {
    await enqueueOperation({uid: 'uid-a', type, resourceId: id, requestId: id, payload: {collectionName: type, data: {}}});
  }
  assert.deepEqual(await listQueuedOperations('uid-a'), []);
  assert.deepEqual((await listAwaitingConfirmationOperations('uid-a')).map((item) => item.requestId), operations.map(([, id]) => id));
});

test('confirmação é vinculada ao UID e somente então libera o envio', async () => {
  await enqueueOperation({uid: 'uid-b', type: 'events', resourceId: 'event-confirm', requestId: 'event-confirm', payload: {collectionName: 'events', data: {}}});
  assert.equal(await confirmQueuedOperation('uid-a', 'event-confirm'), false);
  assert.equal(await confirmQueuedOperation('uid-b', 'event-confirm'), true);
  assert.deepEqual((await listQueuedOperations('uid-b')).map((item) => item.requestId), ['event-confirm']);
  assert.deepEqual(await listAwaitingConfirmationOperations('uid-b'), []);
});

test('ações antigas sem confirmação explícita são retidas em revisão local', async () => {
  await enqueueOperation({uid: 'uid-c', type: 'labels', resourceId: 'legacy-label', requestId: 'legacy-label', payload: {collectionName: 'labels', data: {}}});
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('sahmt-v2-local');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = db.transaction('outbox', 'readwrite');
  const store = transaction.objectStore('outbox');
  const request = store.get('legacy-label');
  request.onsuccess = () => store.put({...request.result, status: 'queued'});
  await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
  db.close();
  assert.equal((await listUnsettledOperations('uid-c')).find(item => item.requestId === 'legacy-label').status, 'awaiting-confirmation');
  assert.deepEqual(await listQueuedOperations('uid-c'), []);
});

test('confirmação antiga de Liberar não apaga alteração mais recente coalescida no mesmo ID',async()=>{
 const {removeQueuedOperation}=await import('../src/outbox.js');const uid='release-race-fixture',id='coalesced-release-fixture';
 const older={day:'2026-10-19',sigla:'AA',marked:true,occurredAt:1},newer={...older,marked:false,occurredAt:2};
 await enqueueOperation({uid,type:'scheduleReleases',resourceId:'2026-10-19:AA',requestId:id,payload:older,coalesce:true});await enqueueOperation({uid,type:'scheduleReleases',resourceId:'2026-10-19:AA',requestId:id,payload:newer,coalesce:true});
 assert.equal(await removeQueuedOperation(uid,id,{expectedPayload:older}),false);assert.equal((await listUnsettledOperations(uid))[0].payload.occurredAt,2);assert.equal(await removeQueuedOperation(uid,id,{throughOccurredAt:1}),false);assert.equal(await removeQueuedOperation(uid,id,{expectedPayload:newer}),true);
});
