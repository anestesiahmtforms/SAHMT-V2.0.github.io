import test from 'node:test';import assert from 'node:assert/strict';
import {createSourceReadBudget,billingDay} from '../worker-indicators/read-budget.js';
import {scheduleWindow,signSchedule,verifySchedule} from '../worker-indicators/schedule-envelope.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
import {createManualRefresh} from '../worker-indicators/refresh-operations.js';
import {createScheduledRefresh} from '../worker-indicators/scheduled-refresh.js';
import {createFdScheduler} from '../worker-fd-scheduler/worker.js';
import {createIndicatorWorker} from '../worker-indicators/worker.js';
import {createIndicatorSources} from '../worker-indicators/sources.js';
test('FD daily source budget reserves concurrently, refunds confirmed reads once and keeps uncertain reservations',async()=>{
 const store=vaccinationMemoryStore(),b=createSourceReadBudget({store,now:()=>Date.parse('2026-11-02T15:00:00Z'),limits:{FA:6}});
 const results=await Promise.all([b.reserve('FA',4),b.reserve('FA',4)]);assert.equal(results.reduce((n,t)=>n+t.count,0),6);
 await b.settle(results[0],1);await b.settle(results[0],1);
 let usage=(await b.describe()).find(p=>p.project==='FA');assert.equal(usage.estimatedReads,3);assert.equal(usage.confirmedReads,1);
 const unknown=await b.reserve('FA',3);assert.equal(unknown.count,3);await assert.rejects(b.reserve('FA',1),/BUDGET_EXHAUSTED/);
 usage=(await b.describe()).find(p=>p.project==='FA');assert.equal(usage.estimatedReads,6);
});
test('FD counters follow Pacific quota day; schedules follow Brasilia 02h including Jan1',()=>{
 assert.equal(billingDay(Date.parse('2026-11-02T07:59:00Z')),'2026-11-01');assert.equal(billingDay(Date.parse('2026-11-02T08:00:00Z')),'2026-11-02');
 assert.deepEqual(scheduleWindow(Date.parse('2027-01-01T05:00:00Z')),{id:'2027-01-01_02',day:'2027-01-01',hour:2,year:2027});
 assert.equal(scheduleWindow(Date.parse('2027-01-01T03:00:00Z')),null);assert.equal(scheduleWindow(Date.parse('2027-01-01T15:00:00Z')),null);assert.equal(scheduleWindow(Date.parse('2026-11-02T10:00:00Z')),null);
});
test('FD internal requests require fresh HMAC and fixed schedule window',async()=>{
 const secret='a'.repeat(43),now=Date.parse('2026-11-02T05:00:01Z'),body={action:'PLAN',scheduledTime:now-1000,issuedAt:now};const signed=await signSchedule(body,secret);
 assert.deepEqual(await verifySchedule(signed,secret,now),body);
 await assert.rejects(verifySchedule({...signed,payload:signed.payload+'x'},secret,now));await assert.rejects(verifySchedule(signed,'b'.repeat(43),now));await assert.rejects(verifySchedule(signed,secret,now+61000));
});
test('FD complete fixed cycle is signed, separate from manual quota, deduplicated and records outcomes',async()=>{
 const time=Date.parse('2026-11-02T05:00:00Z');let now=time,sequence=0,loads=0;const store=vaccinationMemoryStore();
 const manual=createManualRefresh({store,sources:{load:async()=>{loads++;return {sources:{},connectionStatus:[{status:'EMPTY'}],reads:1,readsByProject:{FA:1}};}},now:()=>now,uuid:()=>String(++sequence),authorize:()=>assert.fail('Auto must not impersonate an administrator'),freshTransaction:()=>assert.fail('Auto must not impersonate a profile'),yearValid:()=>true,localDate:()=> '2026-11-02'});
 store.seed('indicatorJobs','budget_management_2026-11-02',{attempts:4});
 const fixed=createScheduledRefresh({store,manual,now:()=>now}),secret='a'.repeat(43),pending=[];
 const processor=createIndicatorWorker({build:()=>({executeScheduled:fixed.execute}),clock:()=>now}),env={INDICATORS_ENABLED:'true',FD_FIXED_REFRESH_ENABLED:'true',FD_SCHEDULE_HMAC_SECRET:secret};
 const scheduler=createFdScheduler({now:()=>now}),binding={fetch:(url,init)=>processor.fetch(new Request(url,init),env)};
 await scheduler.scheduled({cron:'0 5 * * *',scheduledTime:time},{...env,FD_INDICATOR_EXECUTOR:binding},{waitUntil:p=>pending.push(p)});await Promise.all(pending);
 const run=await store.get('indicatorScheduleRuns','2026-11-02_02');assert.equal(run.status,'CONFIRMED');assert.ok(run.confirmed>10);assert.equal((await store.get('indicatorJobs','budget_management_2026-11-02')).attempts,4);
 const initial=loads;now+=1000;await fixed.execute({action:'ACTIVITY',scheduledTime:time,issuedAt:now,activity:'FA.events'});assert.equal(loads,initial);
 const denied=await processor.fetch(new Request('https://fd.internal/v1/fd-scheduled-refresh',{method:'POST',body:JSON.stringify({action:'ACTIVITY',activity:'FA.events'})}),env);assert.equal(denied.status,403);
});
test('FD automatic activity retries never re-read sources; manual interval remains independent',async()=>{
 let now=Date.parse('2026-11-02T05:00:00Z'),loads=0,seq=0;const time=now,store=vaccinationMemoryStore(),actor={uid:'admin'};
 const manual=createManualRefresh({store,sources:{load:async()=>{loads++;return {sources:{},connectionStatus:[{status:'EMPTY'}],reads:1};}},now:()=>now,uuid:()=>String(++seq),authorize:async()=>{},freshTransaction:async()=>{},yearValid:()=>true,localDate:()=> '2026-11-02'});
 store.seed('indicatorRefreshSettings','2026_FA_events',{intervalMinutes:43200});
 await manual.scheduled(time,'FA.events');await manual.scheduled(time,'FA.events');assert.equal(loads,1);
 now+=600001;await manual.refresh(2026,'operations',actor,'FA.events');assert.equal(loads,2);assert.equal((await store.get('indicatorJobs','budget_operations_2026-11-02')).attempts,1);
});
test('FD exhausted daily source budget prevents network reads and preserves source-unavailable semantics',async()=>{
 const store=vaccinationMemoryStore(),now=()=>Date.parse('2026-11-02T15:00:00Z'),budget=createSourceReadBudget({store,now,limits:{FI:1}});await budget.reserve('FI',1);let calls=0;
 const source=createIndicatorSources({getAccessToken:async()=> 'token',readBudget:budget,fetchImpl:async()=>{calls++;return Response.json([]);}});
 const result=await source.load('operations',2026,'FA.events');assert.equal(calls,0);assert.equal(result.budgetExceeded,true);assert.equal(result.sources.FA.events.status,'unavailable');
});
