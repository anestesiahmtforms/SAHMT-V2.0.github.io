import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/outbox.js';

test('FC occurrence submission cannot create a delayed send',async()=>{await assert.rejects(api.enqueueOccurrenceSubmission({uid:'u',recordId:'id',payload:{}}),{code:'offline-storage-disabled'});assert.deepEqual(await api.listQueuedOperations('u'),[]);});
