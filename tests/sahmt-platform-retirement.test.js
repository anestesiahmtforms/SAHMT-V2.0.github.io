import test from 'node:test';
import assert from 'node:assert/strict';
import {signSchedule,verifySchedule} from '../worker-indicators/schedule-envelope.js';
import {callSahmtPerformanceApi} from '../src/sahmt-performance-api.js';
const time=Date.parse('2026-12-01T05:00:00Z'),secret='a'.repeat(43);
test('authenticated legacy scheduled envelopes are refused',async()=>{
 for(const action of ['PLAN','ACTIVITY','FINISH'])await assert.rejects(verifySchedule(await signSchedule({action,scheduledTime:time,issuedAt:time},secret),secret,time),/FD_SCHEDULE_DENIED/);
});
test('browser transport refuses legacy platform actions before loading authentication',async()=>{
 for(const action of ['BOOTSTRAP','REFRESH','SAVE_REVIEW','SAVE_ACTION','GET_PERFORMANCE'])await assert.rejects(callSahmtPerformanceApi({action}),/SAHMT_PERFORMANCE_UNSUPPORTED_ACTION/);
});
