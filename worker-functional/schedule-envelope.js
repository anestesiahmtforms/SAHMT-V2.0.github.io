export const SAHMT_PERFORMANCE_CRON='0 5 * * *';
export function scheduleWindow(time){
 const date=new Date(time);if(!Number.isFinite(time)||!Number.isFinite(date.getTime())||date.getUTCHours()!==5||date.getUTCMinutes()!==0||date.getUTCSeconds()!==0||date.getUTCMilliseconds()!==0)return null;
 const local=new Date(time-10800000),day=local.toISOString().slice(0,10),hour=local.getUTCHours(),year=local.getUTCFullYear();
 return {id:day+'_02',day,hour,year};
}
