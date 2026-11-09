import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scheduleWindow,signSchedule,verifySchedule} from '../worker-indicators/schedule-envelope.js';
import {createFdScheduler} from '../worker-fd-scheduler/worker.js';

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

async function runScheduler({complete=false,performanceEnabled=true,performanceFails=false,scheduledTime=Date.parse('2026-12-01T05:00:00Z')}={}){
 const actions=[],pending=[],warnings=[];
 const scheduler=createFdScheduler({now:()=>scheduledTime});
 const config=JSON.parse(await readFile(new URL('../worker-fd-scheduler/wrangler.jsonc',import.meta.url),'utf8'));
 const binding={fetch:async(_url,init)=>{
  const body=await verifySchedule(JSON.parse(init.body),secret,scheduledTime);actions.push(body.action==='PERFORMANCE'?'PERFORMANCE:'+body.activity:body.action);
  if(body.action==='PERFORMANCE')return performanceFails?new Response('private source failure',{status:503}):Response.json(body.activity==='PREPARE'?{complete:false,stages:['FD','FG','RENDER_0','PUBLISH']}:{status:'CONFIRMED'});
  if(body.action==='PLAN')return Response.json(complete?{complete:true,activities:[]}:{activities:['FA.events']});
  return Response.json({status:'CONFIRMED'});
 }};
 const env={FD_FIXED_REFRESH_ENABLED:'true',SAHMT_PERFORMANCE_ENABLED:performanceEnabled?'true':'false',FD_SCHEDULE_HMAC_SECRET:secret,FD_INDICATOR_EXECUTOR:binding};
 const warn=console.warn;console.warn=value=>warnings.push(value);
 try{await scheduler.scheduled({cron:config.triggers.crons[0],scheduledTime},env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);}
 finally{console.warn=warn;}
 return {actions,warnings,scheduler,env};
}

test('daily scheduler runs only consolidated performance stages',async()=>{
 assert.deepEqual((await runScheduler()).actions,['PERFORMANCE:PREPARE','PERFORMANCE:FD','PERFORMANCE:FG','PERFORMANCE:RENDER_0','PERFORMANCE:PUBLISH']);
});
test('before December the scheduler does not call any performance stage',async()=>{
 assert.deepEqual((await runScheduler({scheduledTime:Date.parse('2026-11-30T05:00:00Z')})).actions,[]);
});

test('daily performance remains independent of retired institutional state',async()=>{
 assert.deepEqual((await runScheduler({complete:true})).actions,['PERFORMANCE:PREPARE','PERFORMANCE:FD','PERFORMANCE:FG','PERFORMANCE:RENDER_0','PERFORMANCE:PUBLISH']);
});

test('performance failure logs only a public code and makes no legacy calls',async()=>{
 const {actions,warnings}=await runScheduler({performanceFails:true});
 assert.deepEqual(actions,['PERFORMANCE:PREPARE']);
 assert.deepEqual(warnings.map(v=>JSON.parse(v)),[{code:'SAHMT_PERFORMANCE_SCHEDULE_FAILED'}]);
});

test('performance activation remains explicit and neither public fetch nor retired cron can start it',async()=>{
 const {actions,scheduler,env}=await runScheduler({performanceEnabled:false});
 assert.deepEqual(actions,[]);
 actions.length=0;
 for(const scheduledTime of [time-7200000,time+36000000])await scheduler.scheduled({cron:'0 3,15 * * *',scheduledTime},env,{waitUntil:()=>assert.fail('retired cron started')});
 assert.equal((await scheduler.fetch(new Request('https://scheduler/'))).status,404);
 assert.deepEqual(actions,[]);
});
