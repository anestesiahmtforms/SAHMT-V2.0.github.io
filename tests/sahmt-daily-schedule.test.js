import test from 'node:test';
import assert from 'node:assert/strict';
import {createFdScheduler} from '../worker-fd-scheduler/worker.js';

test('retired FD scheduler never starts a job and reports that performance moved to FK',async()=>{
 const scheduler=createFdScheduler();
 const result=await scheduler.scheduled({cron:'0 5 * * *',scheduledTime:Date.now()},{FD_INDICATOR_EXECUTOR:{fetch(){assert.fail('retired FD scheduler called an executor');}}});
 assert.deepEqual(result,{code:'SAHMT_PERFORMANCE_MOVED_TO_FK'});
});

test('retired FD scheduler has no public route',async()=>{
 const scheduler=createFdScheduler();
 assert.equal((await scheduler.fetch(new Request('https://fd.invalid/'))).status,404);
});
