import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scheduleWindow,signSchedule,verifySchedule} from '../worker-indicators/schedule-envelope.js';
import {createScheduledRefresh} from '../worker-indicators/scheduled-refresh.js';
import {createFdScheduler} from '../worker-fd-scheduler/worker.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';

const time=Date.parse('2026-11-02T05:00:00Z'),secret='a'.repeat(43);

test('daily window accepts only exact 02h Brasilia and uses the current local year on January 1',()=>{
 assert.deepEqual(scheduleWindow(Date.parse('2027-01-01T05:00:00Z')),{id:'2027-01-01_02',day:'2027-01-01',hour:2,year:2027});
 assert.deepEqual(scheduleWindow(Date.parse('2026-12-31T05:00:00Z')),{id:'2026-12-31_02',day:'2026-12-31',hour:2,year:2026});
 for(const value of [Date.parse('2026-11-02T03:00:00Z'),Date.parse('2026-11-02T15:00:00Z'),time+1000,time+1,time+60000,time-1,NaN,Infinity,String(time)])assert.equal(scheduleWindow(value),null,String(value));
});

test('PERFORMANCE uses the same authenticated fresh daily envelope and rejects legacy windows',async()=>{
 const body={action:'PERFORMANCE',scheduledTime:time,issuedAt:time};
 const signed=await signSchedule(body,secret);
 assert.deepEqual(await verifySchedule(signed,secret,time),body);
 await assert.rejects(verifySchedule({...signed,payload:signed.payload.replace('PERFORMANCE','PLAN')},secret,time),/FD_SCHEDULE_DENIED/);
 await assert.rejects(verifySchedule(signed,'b'.repeat(43),time),/FD_SCHEDULE_DENIED/);
 await assert.rejects(verifySchedule(signed,secret,time+61000),/FD_SCHEDULE_DENIED/);
 for(const scheduledTime of [time-7200000,time+36000000,time+1,time+1000]){
  await assert.rejects(verifySchedule(await signSchedule({...body,scheduledTime},secret),secret,time),/FD_SCHEDULE_DENIED/);
 }
});

test('daily status reads only the current and prior daily windows',async()=>{
 const store=vaccinationMemoryStore();
 for(const id of ['2027-01-01_02','2026-12-31_02','2027-01-01_00','2027-01-01_12'])store.seed('indicatorScheduleRuns',id,{id,status:'CONFIRMED'});
 const refresh=createScheduledRefresh({store,manual:{},now:()=>Date.parse('2027-01-01T06:00:00Z')});
 const status=await refresh.describe();
 assert.deepEqual(status.times,['02:00']);assert.equal(status.timeZone,'America/Sao_Paulo');
 assert.deepEqual(status.runs.map(r=>r.id),['2027-01-01_02','2026-12-31_02']);
});

test('daily finish preserves source read counts for the dedicated FG and FI projects',async()=>{
 const store=vaccinationMemoryStore();
 store.seed('indicatorScheduleRuns','2026-11-02_02',{status:'RUNNING'});
 store.seed('indicatorScheduledActivityRuns','2026-11-02_02_FA_events',{status:'CONFIRMED',readsByProject:{FA:1,FG:3,FI:4}});
 const refresh=createScheduledRefresh({store,manual:{},now:()=>time});
 const result=await refresh.execute({action:'FINISH',scheduledTime:time,issuedAt:time});
 assert.equal(result.readsByProject.FG,3);assert.equal(result.readsByProject.FI,4);
});

async function runScheduler({complete=false,performanceEnabled=true,performanceFails=false}={}){
 const actions=[],pending=[],warnings=[];
 const scheduler=createFdScheduler({now:()=>time});
 const config=JSON.parse(await readFile(new URL('../worker-fd-scheduler/wrangler.jsonc',import.meta.url),'utf8'));
 const binding={fetch:async(_url,init)=>{
  const body=await verifySchedule(JSON.parse(init.body),secret,time);actions.push(body.action==='PERFORMANCE'?'PERFORMANCE:'+body.activity:body.action);
  if(body.action==='PERFORMANCE')return performanceFails?new Response('private source failure',{status:503}):Response.json(body.activity==='PREPARE'?{complete:false,stages:['FA','FG','RENDER_0','PUBLISH']}:{status:'CONFIRMED'});
  if(body.action==='PLAN')return Response.json(complete?{complete:true,activities:[]}:{activities:['FA.events']});
  return Response.json({status:'CONFIRMED'});
 }};
 const env={FD_FIXED_REFRESH_ENABLED:'true',SAHMT_PERFORMANCE_ENABLED:performanceEnabled?'true':'false',FD_SCHEDULE_HMAC_SECRET:secret,FD_INDICATOR_EXECUTOR:binding};
 const warn=console.warn;console.warn=value=>warnings.push(value);
 try{await scheduler.scheduled({cron:config.triggers.crons[0],scheduledTime:time},env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);}
 finally{console.warn=warn;}
 return {actions,warnings,scheduler,env};
}

test('daily scheduler signs PERFORMANCE before institutional source reads',async()=>{
 assert.deepEqual((await runScheduler()).actions,['PERFORMANCE:PREPARE','PERFORMANCE:FA','PERFORMANCE:FG','PERFORMANCE:RENDER_0','PERFORMANCE:PUBLISH','PLAN','ACTIVITY','FINISH']);
});

test('daily performance runs even when the institutional indicator window is already complete',async()=>{
 assert.deepEqual((await runScheduler({complete:true})).actions,['PERFORMANCE:PREPARE','PERFORMANCE:FA','PERFORMANCE:FG','PERFORMANCE:RENDER_0','PERFORMANCE:PUBLISH','PLAN']);
});

test('performance failure logs only a public code and allows institutional refresh without retries',async()=>{
 const {actions,warnings}=await runScheduler({performanceFails:true});
 assert.deepEqual(actions,['PERFORMANCE:PREPARE','PLAN','ACTIVITY','FINISH']);
 assert.deepEqual(warnings.map(v=>JSON.parse(v)),[{code:'SAHMT_PERFORMANCE_SCHEDULE_FAILED'}]);
});

test('performance activation remains explicit and neither public fetch nor retired cron can start it',async()=>{
 const {actions,scheduler,env}=await runScheduler({performanceEnabled:false});
 assert.deepEqual(actions,['PLAN','ACTIVITY','FINISH']);
 actions.length=0;
 for(const scheduledTime of [time-7200000,time+36000000])await scheduler.scheduled({cron:'0 3,15 * * *',scheduledTime},env,{waitUntil:()=>assert.fail('retired cron started')});
 assert.equal((await scheduler.fetch(new Request('https://scheduler/'))).status,404);
 assert.deepEqual(actions,[]);
});
