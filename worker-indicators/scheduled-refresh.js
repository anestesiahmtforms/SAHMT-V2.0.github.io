import {REFRESH_ACTIVITIES,refreshKey} from './manual-refresh.js';
import {scheduleWindow} from './schedule-envelope.js';
export function createScheduledRefresh({store,manual,budget,now=Date.now,enabled=true}){
 async function execute(body){
  const window=scheduleWindow(body.scheduledTime);if(!window)throw Error('FD_SCHEDULE_DENIED');
  if(body.action==='PLAN'){
   if(Object.keys(body).sort().join()!=='action,issuedAt,scheduledTime')throw Error('FD_SCHEDULE_INPUT_INVALID');
   const previous=await store.get('indicatorScheduleRuns',window.id);if(previous?.status&&previous.status!=='RUNNING')return {complete:true,activities:[]};
   const jobs=await store.list('indicatorJobs',[{field:'year',op:'EQUAL',value:window.year}],200),dates=new Map(jobs.map(j=>[j.activity,j.lastSuccess||0]));
   const activities=[...REFRESH_ACTIVITIES].sort((a,b)=>(dates.get(a.id)||0)-(dates.get(b.id)||0)).map(a=>a.id);
   await store.transaction(async tx=>{const old=await tx.get('indicatorScheduleRuns',window.id);if(!old)tx.create('indicatorScheduleRuns',window.id,{id:window.id,year:window.year,scheduledTime:body.scheduledTime,status:'RUNNING',startedAt:now()});});return {window,activities};
  }
  if(body.action==='ACTIVITY'){
   if(Object.keys(body).sort().join()!=='action,activity,issuedAt,scheduledTime')throw Error('FD_SCHEDULE_INPUT_INVALID');
   const run=await store.get('indicatorScheduleRuns',window.id);if(run?.status!=='RUNNING')return {cached:true,windowClosed:true};
   return manual.scheduled(body.scheduledTime,body.activity);
  }
  if(body.action==='FINISH'){
   if(Object.keys(body).sort().join()!=='action,issuedAt,scheduledTime')throw Error('FD_SCHEDULE_INPUT_INVALID');
   const outcomes=await Promise.all(REFRESH_ACTIVITIES.map(a=>store.get('indicatorScheduledActivityRuns',window.id+'_'+a.id.replaceAll('.','_'))));
   const counts={confirmed:0,skipped:0,failed:0,unconfirmed:0},readsByProject={FA:0,FB:0,FC:0,FE:0,FG:0,FI:0};
   for(const row of outcomes){if(row?.status==='CONFIRMED')counts.confirmed++;else if(row?.status==='SKIPPED')counts.skipped++;else if(row?.status==='FAILED')counts.failed++;else counts.unconfirmed++;for(const project of Object.keys(readsByProject))readsByProject[project]+=row?.readsByProject?.[project]||0;}
   const result={id:window.id,year:window.year,scheduledTime:body.scheduledTime,status:counts.failed||counts.unconfirmed?'PARTIAL':'CONFIRMED',...counts,readsByProject,finishedAt:now()};
   await store.transaction(async tx=>{const old=await tx.get('indicatorScheduleRuns',window.id);if(!old)throw Error('FD_SCHEDULE_PLAN_REQUIRED');tx.set('indicatorScheduleRuns',window.id,{...old,...result});});return result;
  }
  throw Error('FD_SCHEDULE_INPUT_INVALID');
 }
 async function describe(){
  const time=now(),day=new Date(time-10800000).toISOString().slice(0,10),priorDay=new Date(time-10800000-86400000).toISOString().slice(0,10),ids=[day+'_02',priorDay+'_02'];
  const runs=(await Promise.all(ids.map(id=>store.get('indicatorScheduleRuns',id)))).filter(Boolean).slice(0,2),usage=budget?await budget.describe():[];
  return {enabled,times:['02:00'],timeZone:'America/Sao_Paulo',usage,runs,estimatedOnly:true};
 }
 return {execute,describe};
}
