import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveScheduleSourceProject} from '../worker-communication/worker.js';
import {createStore} from '../worker-communication/store.js';

test('communication schedule source defaults to the FJ owner and never to FA',()=>{
 assert.equal(resolveScheduleSourceProject({}),'FJ');
 assert.equal(resolveScheduleSourceProject({SCHEDULE_SOURCE_PROJECT:'FJ'}),'FJ');
 assert.throws(()=>resolveScheduleSourceProject({SCHEDULE_SOURCE_PROJECT:'FA'}),{code:'COMM_CONFIG_REQUIRED'});
});

test('FJ schedule store rejects user and other source collection reads',async()=>{
 const store=createStore({source:'FJ',getToken:async()=>'synthetic',fetchImpl:async()=>{throw Error('NETWORK_FORBIDDEN');}});
 await assert.rejects(store.get('users','u1'),{code:'COMM_SOURCE_DENIED'});
 await assert.rejects(store.get('events','e1'),{code:'COMM_SOURCE_DENIED'});
});
