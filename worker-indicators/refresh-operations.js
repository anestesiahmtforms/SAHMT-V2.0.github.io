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
 async function refresh(year,platform,identity=null,activity){
  if(!identity)fail('INDICATOR_MANUAL_ONLY',403);
  await authorize(identity,true);refreshActivity(platform,activity);if(!yearValid(year))fail('INDICATOR_INVALID_INPUT');
  const key=refreshKey(year,activity),snapshotKey=year+'_'+platform,lease=uuid();
  const acquired=await store.transaction(async tx=>{
   await freshTransaction(tx,identity);
   const [prior,settings]=await Promise.all([tx.get('indicatorJobs',key),tx.get('indicatorRefreshSettings',key)]),intervalMinutes=settings?.intervalMinutes??10;
   if(!refreshInterval(intervalMinutes))fail('INDICATOR_REFRESH_SETTINGS_INVALID',503);
   const nextAllowedAt=(prior?.lastSuccess||0)+intervalMinutes*60000;
   if(prior?.leaseUntil>now()||nextAllowedAt>now())return {cached:true,nextAllowedAt:Math.max(nextAllowedAt,prior?.leaseUntil||0)};
   const day=localDate(now()),budgetKey='budget_'+platform+'_'+day,budget=await tx.get('indicatorJobs',budgetKey),attempts=budget?.attempts||0;
   if(attempts>=4)fail('INDICATOR_REFRESH_LIMIT',429);
   tx.set('indicatorJobs',budgetKey,{platform,day,attempts:attempts+1});
   tx.set('indicatorJobs',key,{year,platform,activity,lease,leaseUntil:now()+180000,lastSuccess:prior?.lastSuccess||0,status:'RUNNING',intervalMinutes});return {acquired:true};
  });
  if(!acquired.acquired)return {refreshed:false,...acquired};
  try{
   const loaded=await sources.load(platform,year,activity),statuses=loaded.connectionStatus.map(s=>s.status);
   if(!statuses.length||statuses.some(s=>s==='UNAVAILABLE'))fail('INDICATOR_SOURCE_UNAVAILABLE',503);
   const compiled=compileYear({year,asOf:localDate(now()),sources:loaded.sources,platform}),selected=compiled.metrics.filter(m=>m.source===activity).map(m=>({...m,collectedAt:now()}));
   await authorize(identity,true);
   await store.transaction(async tx=>{
    await freshTransaction(tx,identity);const job=await tx.get('indicatorJobs',key),old=await tx.get('indicatorSnapshots',snapshotKey);
    if(job?.lease!==lease)fail('INDICATOR_REFRESH_CONFLICT',409);
    const previous=new Map((old?.metrics||[]).map(m=>[m.id,{...m,collectedAt:m.collectedAt??old.checkedAt??null}]));
    for(const m of selected)previous.set(m.id,m);
    const saved={schemaVersion:1,year,platform,asOf:compiled.asOf,metrics:[...previous.values()],status:'AVAILABLE',checkedAt:now(),version:(old?.version||0)+1};
    tx.set('indicatorSnapshots',snapshotKey,saved);tx.create('indicatorSnapshotHistory',snapshotKey+'_'+lease,saved);
    tx.set('indicatorJobs',key,{...job,leaseUntil:0,lastSuccess:now(),status:'AVAILABLE',reads:loaded.reads});
   });return {refreshed:true,status:'AVAILABLE',activity,reads:loaded.reads};
  }catch(error){await store.transaction(async tx=>{const job=await tx.get('indicatorJobs',key);if(job?.lease===lease)tx.set('indicatorJobs',key,{...job,leaseUntil:0,status:'FAILED'});}).catch(()=>{});throw error;}
 }
 async function describe(year){
  const [settings,jobs]=await Promise.all([store.list('indicatorRefreshSettings',[{field:'year',op:'EQUAL',value:year}],200),store.list('indicatorJobs',[{field:'year',op:'EQUAL',value:year}],200)]);
  return REFRESH_ACTIVITIES.map(a=>{const setting=settings.find(s=>s.activity===a.id),job=jobs.find(s=>s.activity===a.id),intervalMinutes=setting?.intervalMinutes??10;return {...a,intervalMinutes,lastSuccess:job?.lastSuccess||null,nextAllowedAt:job?.lastSuccess?job.lastSuccess+intervalMinutes*60000:null};});
 }
 return {refresh,configure,describe};
}
