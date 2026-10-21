import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as outbox from '../src/outbox.js';
import {reconcileConfirmedChecklistOutbox} from '../src/checklist-outbox-reconcile.js';
import {createSyncNoticeState} from '../src/pending-sync-banner.js';

const operation=(uid,id)=>({uid,type:'checklists',resourceId:id,requestId:id,payload:{collectionName:'checklists',data:{date:'2026-10-21',stationId:'synthetic',condition:'SIM'}}});

test('recuperação remota atrasada não recria checklist confirmado no cache persistente',async()=>{
 const op=operation('commit-user','late-recovery');
 await outbox.enqueueOperation(op);
 await outbox.removeQueuedOperation(op.uid,op.requestId,{committed:true});
 await outbox.enqueueOperation(structuredClone(op));
 assert.deepEqual(await outbox.listUnsettledOperations(op.uid),[]);
 assert.equal(await outbox.hasCommittedOperation(op.uid,op.requestId,op.payload),true);
});

test('prova de confirmação é vinculada ao usuário e conteúdo e não confunde descarte',async()=>{
 const op=operation('commit-user','different-payload');
 await outbox.enqueueOperation(op);await outbox.removeQueuedOperation(op.uid,op.requestId,{committed:true});
 assert.equal(await outbox.hasCommittedOperation('other-user',op.requestId,op.payload),false);
 assert.equal(await outbox.hasCommittedOperation(op.uid,op.requestId,{...op.payload,data:{...op.payload.data,condition:'NAO'}}),false);
 const discarded=operation('commit-user','discarded');
 await outbox.enqueueOperation(discarded);await outbox.removeQueuedOperation(discarded.uid,discarded.requestId);
 await outbox.enqueueOperation(discarded);
 assert.equal((await outbox.listUnsettledOperations(discarded.uid)).length,1);
});


test('confirmação resiste a recarga do módulo e limpeza do cache de leitura',async()=>{
 const op=operation('reload-user','persistent-proof');
 await outbox.enqueueOperation(op);await outbox.removeQueuedOperation(op.uid,op.requestId,{committed:true});
 await outbox.pruneLocalReadCache(op.uid,{maxEntries:0,maxBytes:0});
 const reloaded=await import('../src/outbox.js?commit-proof-reload');
 await reloaded.enqueueOperation(op);
 assert.deepEqual(await reloaded.listUnsettledOperations(op.uid),[]);
 assert.equal(await reloaded.hasCommittedOperation(op.uid,op.requestId,op.payload),true);
});

test('conteúdo divergente nunca recebe a confirmação de outro conteúdo',async()=>{
 const op=operation('conflict-user','conflict-proof');
 await outbox.enqueueOperation(op);await outbox.removeQueuedOperation(op.uid,op.requestId,{committed:true});
 await assert.rejects(outbox.enqueueOperation({...op,payload:{...op.payload,data:{...op.payload.data,condition:'NAO'}}}),/outro conteúdo/);
 assert.equal(await outbox.hasCommittedOperation(op.uid,op.requestId,op.payload),true);
});

test('recuperações concorrentes ao commit terminam sem cópia pendente',async()=>{
 const op=operation('concurrent-user','race-proof');await outbox.enqueueOperation(op);
 await Promise.all([outbox.removeQueuedOperation(op.uid,op.requestId,{committed:true}),outbox.enqueueOperation(op)]);
 assert.deepEqual(await outbox.listUnsettledOperations(op.uid),[]);
 await outbox.enqueueOperation(op);
 assert.deepEqual(await outbox.listUnsettledOperations(op.uid),[]);
});


test('pendência antiga conciliada pelo relatório não reaparece por recuperação remota',async()=>{
 const op=operation('legacy-user','legacy-proof'),notice=createSyncNoticeState(()=>{},{pendingGraceMs:0});
 await outbox.enqueueOperation(op);notice.pending(op.uid,op.requestId);
 const records=[{id:op.requestId,clientMutationId:op.requestId,createdByUid:op.uid,...op.payload.data}];
 await reconcileConfirmedChecklistOutbox(records,await outbox.listUnsettledOperations(op.uid),op.uid,outbox.removeQueuedOperation,id=>notice.confirmed(op.uid,id));
 const pending=await outbox.listUnsettledOperations(op.uid);
 notice.update({uid:op.uid,pendingCount:pending.length,pendingIds:pending.map(item=>item.requestId)});
 assert.equal(notice.snapshot().state,'complete');
 await outbox.clearUserLocalData(op.uid);
 await outbox.enqueueOperation(op);
 assert.deepEqual(await outbox.listUnsettledOperations(op.uid),[]);
 notice.update({uid:op.uid,pendingCount:1,pendingIds:[]});
 assert.equal(notice.snapshot().state,'complete');
});
