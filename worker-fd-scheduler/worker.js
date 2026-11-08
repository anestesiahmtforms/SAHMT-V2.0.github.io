import {FD_FIXED_CRON,scheduleWindow,signSchedule} from '../worker-indicators/schedule-envelope.js';
export function createFdScheduler({now=Date.now}={}){return {
 fetch(){return new Response(null,{status:404});},
 async scheduled(event,env,ctx){
  if(env.FD_FIXED_REFRESH_ENABLED!=='true'||event.cron!==FD_FIXED_CRON||!scheduleWindow(event.scheduledTime))return;
  const run=async()=>{
   const call=async(action,activity)=>{const body={action,scheduledTime:event.scheduledTime,issuedAt:now(),...(activity?{activity}:{})},signed=await signSchedule(body,env.FD_SCHEDULE_HMAC_SECRET);const r=await env.FD_INDICATOR_EXECUTOR.fetch('https://fd.internal/v1/fd-scheduled-refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(signed)});if(!r.ok){await r.body?.cancel();throw Error('FD_SCHEDULE_ACTIVITY_UNAVAILABLE');}return r.json();};
   // Performance claims its own daily batch before institutional reads use the source budget.
   if(env.SAHMT_PERFORMANCE_ENABLED==='true'){
    try{
     const performance=await call('PERFORMANCE','PREPARE');
     if(!performance.complete){
      if(!Array.isArray(performance.stages)||!performance.stages.length||performance.stages.length>21||new Set(performance.stages).size!==performance.stages.length||performance.stages.some(stage=>!['FA','FG','FI','FB','FC','FE','ADMIN','PUBLISH'].includes(stage)&&!/^RENDER_(?:[0-9]|1[0-2])$/.test(stage)))throw Error('SAHMT_PERFORMANCE_PLAN_INVALID');
      for(const stage of performance.stages){const result=await call('PERFORMANCE',stage);if(result.complete)break;if(result.status!=='CONFIRMED')throw Error('SAHMT_PERFORMANCE_STAGE_UNAVAILABLE');}
     }
    }catch{console.warn(JSON.stringify({code:'SAHMT_PERFORMANCE_SCHEDULE_FAILED'}));}
   }
   const plan=await call('PLAN');if(plan.complete)return;
   if(!Array.isArray(plan.activities)||plan.activities.length>20)throw Error('FD_SCHEDULE_PLAN_INVALID');
   // Separate invocations keep each activity inside the free plan's CPU/subrequest limits.
   for(const activity of plan.activities){try{await call('ACTIVITY',activity);}catch{console.warn(JSON.stringify({code:'FD_SCHEDULE_ACTIVITY_FAILED',activity}));}}
   const result=await call('FINISH');console.log(JSON.stringify({code:'FD_SCHEDULE_FINISHED',...result}));
  };
  ctx.waitUntil(run());
 }
};}
export default createFdScheduler();
