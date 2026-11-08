import test from 'node:test';import assert from 'node:assert/strict';import {signSchedule,verifySchedule} from '../worker-indicators/schedule-envelope.js';
test('freshly signed performance checkpoint recovery uses the one-hour historical window without extending aggregate calls',async()=>{
 const time=Date.parse('2026-11-08T05:00:00Z'),now=time+1800000,secret='a'.repeat(43);
 const body={action:'PERFORMANCE',activity:'FG',scheduledTime:time,issuedAt:now};
 assert.equal((await verifySchedule(await signSchedule(body,secret),secret,now)).activity,'FG');
 await assert.rejects(verifySchedule(await signSchedule({...body,action:'PLAN'},secret),secret,now));
 await assert.rejects(verifySchedule(await signSchedule({...body,issuedAt:time},secret),secret,now));
});
