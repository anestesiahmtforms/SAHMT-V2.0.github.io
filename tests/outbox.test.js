import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/outbox.js';

for(const type of ['events','labels','checklists','activities','eventEdits','labelEdits','scheduleReleases','occurrences'])test(type+' cannot be queued',async()=>{await assert.rejects(api.enqueueOperation({uid:'u',type,requestId:'r',resourceId:'r',payload:{}}),{code:'offline-storage-disabled'});assert.deepEqual(await api.listUnsettledOperations('u'),[]);});
