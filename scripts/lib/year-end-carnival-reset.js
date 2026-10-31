import {encodeFields} from '../../worker-training/firestore.js';
import {readYearEndTotalsSource} from './year-end-totals-migration.js';
import {emptyYearEndTotals,readYearEndTotals} from '../../src/year-end-schedule-totals.js';
import {YEAR_END_SUMMARY_VERSION} from '../../src/year-end-schedule.js';

export const YEAR_END_CARNIVAL_RESET_ID='carnaval-2027-v2';
const base='yearEndSchedules/2026-2027',policyPath=base+'/policy/participation',totalsPath=base+'/summary/totals',counterPath=base+'/control/order';
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const project=projectId=>demand(['outros-48120','demo-sahmt-year-end'].includes(projectId),'YEAR_END_FE_PROJECT_REQUIRED');
const zero=source=>source.records.length===0&&source.summary?.data.plantaoCarnaval===0&&Object.values(readYearEndTotals(source.summary?.data)).every(n=>n===0)&&(!source.counter||source.counter.data.lastPosition===0);
function inspect(source,projectId){
 const prefix=`projects/${projectId}/databases/(default)/documents/`;
 demand(source.policy?.data.schemaVersion===1&&source.policy.data.cycle==='2026-2027','YEAR_END_RESET_POLICY_REQUIRED');
 demand(source.summary,'YEAR_END_RESET_SUMMARY_REQUIRED');
 demand(source.policy.name===prefix+policyPath&&source.summary.name===prefix+totalsPath&&(!source.counter||source.counter.name===prefix+counterPath),'YEAR_END_RESET_SCOPE_INVALID');
 demand(source.records.every(r=>r.name.startsWith(prefix+base+'/registrations/')&&r.name.slice((prefix+base+'/registrations/').length)&&!r.name.slice((prefix+base+'/registrations/').length).includes('/')&&r.updateTime),'YEAR_END_RESET_SCOPE_INVALID');
 return {projectId,cycle:'2026-2027',registrations:source.records.length,summaryVersion:source.policy.data.summaryVersion,alreadyReset:source.policy.data.resetId===YEAR_END_CARNIVAL_RESET_ID};
}

// The user explicitly requested deletion of test choices without a backup.
// Callbacks and reports contain aggregate metadata only, never source records.
export async function resetYearEndForCarnival({request,projectId,apply=false,onPlan=async()=>{}}){
 project(projectId);
 for(let attempt=0;attempt<3;attempt++){
  let transaction;
  try{
   transaction=(await request(':beginTransaction',{options:apply?{readWrite:{}}:{readOnly:{}}}))?.transaction;
   demand(transaction,'YEAR_END_RESET_TRANSACTION_REQUIRED');
   const source=await readYearEndTotalsSource(request,transaction),report=inspect(source,projectId);
   await onPlan(report);
   // A retry after reopening must preserve new, real registrations.
   if(report.alreadyReset)return {...report,deleted:0,applied:apply,verified:true};
   demand(report.summaryVersion===1,'YEAR_END_RESET_UNEXPECTED_REVISION');
   if(!apply)return {...report,deleted:0,applied:false,verified:true};
   const name=path=>`projects/${projectId}/databases/(default)/documents/${path}`;
   const writes=[
    ...source.records.map(r=>({delete:r.name,currentDocument:{updateTime:r.updateTime}})),
    {update:{name:name(totalsPath),fields:encodeFields(emptyYearEndTotals())},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{updateTime:source.summary.updateTime}},
    {update:{name:source.policy.name,fields:encodeFields({summaryVersion:0,resetId:YEAR_END_CARNIVAL_RESET_ID})},updateMask:{fieldPaths:['summaryVersion','resetId']},updateTransforms:[{fieldPath:'resetAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{updateTime:source.policy.updateTime}}
   ];
   if(source.counter)writes.push({update:{name:name(counterPath),fields:encodeFields({lastPosition:0,retired:true})},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{updateTime:source.counter.updateTime}});
   await request(':commit',{transaction,writes});transaction=null;
   const after=await readYearEndTotalsSource(request);
   demand(after.policy?.data.resetId===YEAR_END_CARNIVAL_RESET_ID&&after.policy.data.summaryVersion===0&&zero(after),'YEAR_END_RESET_VERIFICATION_FAILED');
   return {...report,summaryVersion:0,deleted:source.records.length,remaining:0,applied:true,verified:true};
  }catch(error){if(error.code!=='ABORTED'||attempt===2)throw error;}
  finally{if(transaction)await request(':rollback',{transaction}).catch(()=>{});}
 }
}

export async function activateYearEndCarnival({request,projectId,verifyRelease}){
 project(projectId);demand(typeof verifyRelease==='function','YEAR_END_RELEASE_VERIFIER_REQUIRED');
 await verifyRelease();
 let transaction;
 try{
  transaction=(await request(':beginTransaction',{options:{readWrite:{}}}))?.transaction;
  demand(transaction,'YEAR_END_RESET_TRANSACTION_REQUIRED');
  const source=await readYearEndTotalsSource(request,transaction),report=inspect(source,projectId);
  demand(report.alreadyReset,'YEAR_END_RESET_REQUIRED');
  if(report.summaryVersion===YEAR_END_SUMMARY_VERSION)return {...report,alreadyActive:true,verified:true};
  demand(report.summaryVersion===0&&zero(source),'YEAR_END_REOPEN_REQUIRES_EMPTY_RESET');
  await request(':commit',{transaction,writes:[{update:{name:source.policy.name,fields:encodeFields({summaryVersion:YEAR_END_SUMMARY_VERSION})},updateMask:{fieldPaths:['summaryVersion']},currentDocument:{updateTime:source.policy.updateTime}}]});transaction=null;
  const current=await readYearEndTotalsSource(request);
  demand(current.policy?.data.summaryVersion===YEAR_END_SUMMARY_VERSION&&current.policy.data.resetId===YEAR_END_CARNIVAL_RESET_ID,'YEAR_END_REOPEN_VERIFICATION_FAILED');
  return {...report,summaryVersion:YEAR_END_SUMMARY_VERSION,alreadyActive:false,verified:true};
 }finally{if(transaction)await request(':rollback',{transaction}).catch(()=>{});}
}
