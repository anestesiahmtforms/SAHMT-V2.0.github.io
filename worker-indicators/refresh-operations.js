import {scheduleWindow} from './schedule-envelope.js';
import {compileYear} from '../indicators-platform/domain/compiler.js';
import {REFRESH_ACTIVITIES,refreshActivity,refreshKey,refreshInterval} from './manual-refresh.js';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
export function createManualRefresh({store,sources,now,uuid,authorize,freshTransaction,yearValid,localDate}){
 async function configure(input,identity){
  await authorize(identity,true);refreshActivity(input.platform,input.activity);
  if(!yearValid(input.year)||!refreshInterval(input.intervalMinutes))fail('INDICATOR_INVALID_INPUT');
  const id=refreshKey(input.year,input.activity),record={year:input.year,platform:input.platform,activity:input.activity,intervalMinutes:input.intervalMinutes,updatedAt:now()};
  await store.transaction(async tx=>{await freshTransaction(tx,identity);tx.set('indicatorRefreshSettings',id,record);tx.create('indicatorAudit',uuid(),{action:'SET_REFRESH_INTERVAL',activity:input.activity,intervalMinutes:input.intervalMinutes,actorUid:identity.uid,at:now()});});return record;
 }
 async function collect(year,platform,identity,activity,window=null){
  if(!identity&&!window)fail('INDICATOR_MANUAL_ONLY',403);
  if(identity)await authorize(identity,true);refreshActivity(platform,activity);if(!yearValid(year))fail('INDICATOR_INVALID_INPUT');
  const key=refreshKey(year,activity),snapshotKey=year+'_'+platform,lease=uuid(),claimId=window?window.id+'_'+activity.replaceAll('.','_'):null;
  const acquired=await store.transaction(async tx=>{
   if(identity)await freshTransaction(tx,identity);
   if(claimId&&await tx.get('indicatorScheduledActivityRuns',claimId))return {cached:true,duplicate:true};
   const [prior,settings]=await Promise.all([tx.get('indicatorJobs',key),tx.get('indicatorRefreshSettings',key)]),intervalMinutes=settings?.intervalMinutes??10;
   if(identity&&!refreshInterval(intervalMinutes))fail('INDICATOR_REFRESH_SETTINGS_INVALID',503);
   const lastManualSuccess=prior?.lastManualSuccess??(prior?.lastMode==='AUTO'?0:prior?.lastSuccess||0),nextAllowedAt=Math.max((prior?.lastSuccess||0)+600000,identity?lastManualSuccess+intervalMinutes*60000:0);
   if(prior?.leaseUntil>now()||nextAllowedAt>now()){if(claimId)tx.create('indicatorScheduledActivityRuns',claimId,{windowId:window.id,activity,year,status:'SKIPPED',at:now()});return {cached:true,nextAllowedAt:Math.max(nextAllowedAt,prior?.leaseUntil||0)};}
   const day=localDate(now()),budgetKey='budget_'+platform+'_'+day,budget=await tx.get('indicatorJobs',budgetKey),attempts=budget?.attempts||0;
   if(identity&&attempts>=4)fail('INDICATOR_REFRESH_LIMIT',429);
   if(identity)tx.set('indicatorJobs',budgetKey,{platform,day,attempts:attempts+1});
   if(claimId)tx.create('indicatorScheduledActivityRuns',claimId,{windowId:window.id,activity,year,status:'RUNNING',at:now()});
   tx.set('indicatorJobs',key,{year,platform,activity,lease,leaseUntil:now()+180000,lastSuccess:prior?.lastSuccess||0,lastManualSuccess,lastMode:window?'AUTO':'MANUAL',status:'RUNNING',intervalMinutes});return {acquired:true};
  });
  if(!acquired.acquired)return {refreshed:false,...acquired};
  let loaded;
  try{
   loaded=await sources.load(platform,year,activity);const statuses=loaded.connectionStatus.map(s=>s.status);
   if(!statuses.length||statuses.some(s=>s==='UNAVAILABLE'))fail(loaded.budgetExceeded?'INDICATOR_SOURCE_BUDGET_EXHAUSTED':'INDICATOR_SOURCE_UNAVAILABLE',503);
   const compiled=compileYear({year,asOf:localDate(now()),sources:loaded.sources,platform,sourceKey:activity}),selected=compiled.metrics.filter(m=>m.source===activity).map(m=>({...m,collectedAt:now()}));
   if(identity)await authorize(identity,true);
   await store.transaction(async tx=>{
    if(identity)await freshTransaction(tx,identity);const job=await tx.get('indicatorJobs',key),old=await tx.get('indicatorSnapshots',snapshotKey);
    if(job?.lease!==lease)fail('INDICATOR_REFRESH_CONFLICT',409);
    const previous=new Map((old?.metrics||[]).map(m=>[m.id,{...m,collectedAt:m.collectedAt??old.checkedAt??null}]));
    for(const m of selected)previous.set(m.id,m);
    const saved={schemaVersion:1,year,platform,asOf:compiled.asOf,metrics:[...previous.values()],status:'AVAILABLE',checkedAt:now(),version:(old?.version||0)+1};
    tx.set('indicatorSnapshots',snapshotKey,saved);tx.create('indicatorSnapshotHistory',snapshotKey+'_'+lease,saved);
    tx.set('indicatorJobs',key,{...job,leaseUntil:0,lastSuccess:now(),lastManualSuccess:identity?now():job.lastManualSuccess||0,status:'AVAILABLE',reads:loaded.reads,readsByProject:loaded.readsByProject||{}});
    if(claimId)tx.set('indicatorScheduledActivityRuns',claimId,{windowId:window.id,activity,year,status:'CONFIRMED',at:now(),reads:loaded.reads,readsByProject:loaded.readsByProject||{}});
   });return {refreshed:true,status:'AVAILABLE',activity,reads:loaded.reads,readsByProject:loaded.readsByProject||{}};
  }catch(error){await store.transaction(async tx=>{const job=await tx.get('indicatorJobs',key);if(job?.lease===lease)tx.set('indicatorJobs',key,{...job,leaseUntil:0,status:'FAILED',reads:loaded?.reads||0,readsByProject:loaded?.readsByProject||{}});if(claimId)tx.set('indicatorScheduledActivityRuns',claimId,{windowId:window.id,activity,year,status:'FAILED',at:now(),code:error.code||'INDICATOR_SOURCE_UNAVAILABLE',reads:loaded?.reads||0,readsByProject:loaded?.readsByProject||{}});}).catch(()=>{});throw error;}
 }
 async function describe(year){
  const [settings,jobs]=await Promise.all([store.list('indicatorRefreshSettings',[{field:'year',op:'EQUAL',value:year}],200),store.list('indicatorJobs',[{field:'year',op:'EQUAL',value:year}],200)]);
  return REFRESH_ACTIVITIES.map(a=>{const setting=settings.find(s=>s.activity===a.id),job=jobs.find(s=>s.activity===a.id),intervalMinutes=setting?.intervalMinutes??10;return {...a,intervalMinutes,lastSuccess:job?.lastSuccess||null,nextAllowedAt:job?.lastSuccess?Math.max(job.lastSuccess+600000,(job.lastManualSuccess??(job.lastMode==='AUTO'?0:job.lastSuccess))+intervalMinutes*60000):null};});
 }
 async function refresh(year,platform,identity=null,activity){if(!identity)fail('INDICATOR_MANUAL_ONLY',403);return collect(year,platform,identity,activity);}
 async function scheduled(time,activity){const window=scheduleWindow(time),spec=REFRESH_ACTIVITIES.find(a=>a.id===activity);if(!window||!spec)fail('INDICATOR_SCHEDULE_INVALID');return collect(window.year,spec.platform,null,activity,window);}
 return {refresh,configure,describe,scheduled};
}
