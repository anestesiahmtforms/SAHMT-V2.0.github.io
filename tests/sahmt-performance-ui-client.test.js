import test from 'node:test';
import assert from 'node:assert/strict';
import {createSahmtPerformanceRequest} from '../src/sahmt-performance-client.js';
test('client restricts actions and aborts all pending calls when disposed',async()=>{
 let options;
 const request=createSahmtPerformanceRequest({uid:'u1',isCurrent:()=>true,transport:async input=>{options=input;return {status:'PREPARING'};}});
 await assert.rejects(()=>request('READ_SOURCE',{}),/UNSUPPORTED/);
 await request('GET_SAHMT_PERFORMANCE',{});assert.equal(options.uid,'u1');assert.equal(options.signal.aborted,false);request.dispose();assert.equal(options.signal.aborted,true);
 await assert.rejects(()=>request('GET_SAHMT_PERFORMANCE',{}),/SESSION_CHANGED/);
});
test('client refuses a response that arrives after the session changes',async()=>{
 let current=true,release;
 const request=createSahmtPerformanceRequest({uid:'u1',isCurrent:()=>current,transport:()=>new Promise(resolve=>{release=resolve;})});
 const pending=request('GET_SAHMT_PERFORMANCE',{});current=false;release({status:'READY',uid:'u1'});await assert.rejects(pending,/SESSION_CHANGED/);
});
