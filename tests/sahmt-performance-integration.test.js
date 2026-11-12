import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndicatorWorker} from '../worker-indicators/worker.js';

test('legacy FD performance route is retired before authentication or source access',async()=>{
 const worker=createIndicatorWorker({
  build(){assert.fail('retired FD route initialized a service');},
  verifyIdentity(){assert.fail('retired FD route authenticated a request');}
 });
 const response=await worker.fetch(new Request('https://fd.invalid/v1/indicators',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'GET_SAHMT_PERFORMANCE',input:{}})}),{});
 assert.equal(response.status,410);
 assert.equal((await response.json()).code,'SAHMT_PERFORMANCE_MOVED_TO_FK');
});

test('legacy FD scheduled refresh is retired and cannot run performance stages',async()=>{
 const worker=createIndicatorWorker();
 const result=await worker.scheduled({scheduledTime:Date.now()},{FD_INDICATOR_EXECUTOR:{fetch(){assert.fail('retired FD scheduler called an executor');}}});
 assert.deepEqual(result,{code:'SAHMT_PERFORMANCE_MOVED_TO_FK'});
});

test('unknown legacy FD routes remain unavailable',async()=>{
 const worker=createIndicatorWorker();
 const response=await worker.fetch(new Request('https://fd.invalid/v1/removed'),{});
 assert.equal(response.status,404);
 assert.equal((await response.json()).code,'INDICATOR_ROUTE_UNKNOWN');
});
