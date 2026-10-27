import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/outbox.js';

test('committed-marker cache cannot restore a previously queued record',async()=>{assert.equal(await api.hasCommittedOperation('u','id',{}),false);assert.deepEqual(await api.listAwaitingConfirmationOperations('u'),[]);await assert.rejects(api.confirmQueuedOperation('u','id'),{code:'offline-storage-disabled'});});
