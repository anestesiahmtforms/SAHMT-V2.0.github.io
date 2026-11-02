import {FD_FIXED_CRON,scheduleWindow,signSchedule} from '../worker-indicators/schedule-envelope.js';
export function createFdScheduler({now=Date.now}={}){return {
 fetch(){return new Response(null,{status:404});},
 async scheduled(event,env,ctx){
  if(env.FD_FIXED_REFRESH_ENABLED!=='true'||event.cron!==FD_FIXED_CRON||!scheduleWindow(event.scheduledTime))return;
  const run=async()=>{
   const call=async(action,activity)=>{const body={action,scheduledTime:event.scheduledTime,issuedAt:now(),...(activity?{activity}:{})},signed=await signSchedule(body,env.FD_SCHEDULE_HMAC_SECRET);const r=await env.FD_INDICATOR_EXECUTOR.fetch('https://fd.internal/v1/fd-scheduled-refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(signed)});if(!r.ok){await r.body?.cancel();throw Error('FD_SCHEDULE_ACTIVITY_UNAVAILABLE');}return r.json();};
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
