import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/outbox.js';

test('reconnect cannot recover or claim old operations',async()=>{assert.deepEqual(await api.listQueuedOperations('u'),[]);assert.equal(await api.nextQueuedAttemptAt('u'),null);await assert.rejects(api.claimQueuedOperationForSend('u','old'),{code:'offline-storage-disabled'});await assert.rejects(api.retryFailedOperations('u'),{code:'offline-storage-disabled'});});
