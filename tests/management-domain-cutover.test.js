import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/outbox.js';

test('neither FA nor FB can restore an old management queue or progress cache',async()=>{await api.writeSafeCache('u','trainingProgress','mine',{records:[{id:'old',syncPending:true}]});assert.equal(await api.readSafeCache('u','trainingProgress','mine'),null);assert.deepEqual(await api.listPendingTrainingProgress('u'),[]);await assert.rejects(api.enqueueOperation({uid:'u',type:'activities',requestId:'id',resourceId:'id',payload:{}}),{code:'offline-storage-disabled'});});
