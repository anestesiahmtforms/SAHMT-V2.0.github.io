import {assertActor,validateEvidence} from './fi-ai-policy.js';
import {createAiBudget} from './fi-ai-budget.js';
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function validSnapshot(s,period){
 return s?.schemaVersion===1&&s.source==='FD'&&s.period===period&&typeof s.signature==='string'&&s.signature.length>0&&s.signature.length<=200&&Number.isFinite(s.updatedAt)&&Array.isArray(s.missingSources)&&Array.isArray(s.indicators)&&s.indicators.length>0&&s.indicators.length<=100&&s.indicators.every(i=>typeof i.id==='string'&&i.id&&typeof i.label==='string'&&typeof i.value==='number'&&Number.isFinite(i.value)&&typeof i.unit==='string'&&(i.target===null||Number.isFinite(i.target))&&(i.previous===null||Number.isFinite(i.previous)))&&new Set(s.indicators.map(i=>i.id)).size===s.indicators.length;
}
function validPlan(p,s){
 const ids=new Set(s.indicators.map(i=>i.id)),techIds=new Set((s.technicalMetrics||[]).map(i=>i.id));
 const text=v=>typeof v==='string'&&v.length>0&&v.length<=4000;
 return p&&text(p.summary)&&Array.isArray(p.actions)&&p.actions.length<=30&&p.actions.every(a=>['HIGH','MEDIUM','LOW'].includes(a.priority)&&['ownerSuggested','dueSuggested','successMetric','action'].every(k=>text(a[k]))&&validateEvidence(a.evidence,ids))&&Array.isArray(p.technicalRecommendations)&&p.technicalRecommendations.length<=20&&p.technicalRecommendations.every(r=>text(r.proposal)&&text(r.validation)&&validateEvidence(r.evidence,techIds));
}
export function createMonthlyService({store,sourceProvider,modelProvider,now=Date.now,config={},budget=createAiBudget({store,now,config})}){
 const leaseMs=Number.isSafeInteger(config.monthlyLeaseMs)&&config.monthlyLeaseMs>0?Math.min(config.monthlyLeaseMs,300000):120000;
 return async function monthly(actor,{period,requestId}={}){
  assertActor(actor,true);
  if(typeof period!=='string'||!/^20\d\d-(0[1-9]|1[0-2])$/.test(period))throw Error('PERIOD_INVALID');
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(requestId))throw Error('REQUEST_ID_INVALID');
  const snapshot=await sourceProvider.monthlySnapshot(actor,period);
  if(!snapshot)return {status:'incomplete',period,missingSources:['FD']};
  if(snapshot.complete!==true||!validSnapshot(snapshot,period)||snapshot.missingSources.length)return {status:'incomplete',period,missingSources:Array.isArray(snapshot.missingSources)&&snapshot.missingSources.length?snapshot.missingSources:['FD_VALIDATION']};
  // Copy only FD aggregates; arbitrary source metadata is never sent to the model.
  const context={indicators:snapshot.indicators.map(({id,label,value,unit,target,previous})=>({id,label,value,unit,target,previous})),technicalMetrics:(Array.isArray(snapshot.technicalMetrics)?snapshot.technicalMetrics:[]).filter(i=>typeof i.id==='string'&&typeof i.label==='string'&&Number.isFinite(i.value)&&typeof i.unit==='string').slice(0,100).map(({id,label,value,unit})=>({id,label,value,unit}))};
  const key=`${period}_${await digest(snapshot.signature)}`,token=crypto.randomUUID();
  const claim=await store.transaction(async tx=>{
   const old=await tx.get('fiAiRuns',key);
   if(old?.status==='complete')return old.result;
   if(old?.status==='running'&&old.leaseUntil>now())return {status:'running',period,signature:snapshot.signature};
   await tx.set('fiAiRuns',key,{status:'running',period,signature:snapshot.signature,leaseToken:token,leaseUntil:now()+leaseMs,startedAt:now()});return null;
  });
  if(claim)return claim;
  const finish=async result=>store.transaction(async tx=>{
   const current=await tx.get('fiAiRuns',key);
   if(current?.leaseToken!==token||current.leaseUntil<=now())return {status:'lease_expired',period,signature:snapshot.signature};
   await tx.set('fiAiRuns',key,{status:result.status,period,signature:snapshot.signature,updatedAt:now(),...(result.status==='complete'?{result}:{} )});return result;
  });
  if(modelProvider?.enabled!==true)return finish({status:'disabled',period});
  const reservation=await budget.reserve(actor.uid);
  if(!reservation)return finish({status:'budget_exhausted',period});
  try {
   const response=await modelProvider.generate({kind:'monthly',period,context});
   await budget.settle(reservation,response.usage);
   if(!validPlan(response.data,context))throw Error('PLAN_INVALID');
   const report={summary:response.data.summary,actions:response.data.actions.map(({priority,ownerSuggested,dueSuggested,evidence,successMetric,action})=>({priority,ownerSuggested,dueSuggested,evidence,successMetric,action})),technicalRecommendations:response.data.technicalRecommendations.map(({evidence,proposal,validation})=>({evidence,proposal,validation}))};
   return finish({status:'complete',period,signature:snapshot.signature,sourceUpdatedAt:snapshot.updatedAt,generatedAt:now(),approvalStatus:'proposed',report});
  }catch(error){await budget.settle(reservation,error.usage);return finish({status:'failed',period,signature:snapshot.signature});}
 };
}
