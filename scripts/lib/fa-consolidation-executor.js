import {FA_PROJECT,prepareFaConsolidationPlan,faConsolidationReport} from './fa-consolidation-plan.js';
import {snapshotDigest} from './management-split-plan.js';
const demand=(condition,code)=>{if(!condition)throw Error(code);};
const gates=['backupVerified','restorationVerified','sourceWritersStopped','destinationWritersStopped','quotaBudgetVerified','sharedDataReviewed','backendPrepared','oldClientsBlocked'];

/** Administrative executor with injected adapters only. It cannot discover
 * credentials, open network connections or delete either source or destination.
 * A commit with uncertain outcome is stopped; a new invocation rereads it. */
export async function executeFaConsolidation({input,plan,mode='DRY_RUN',destinationProjectId=FA_PROJECT,
 approval,adapter,checkpoint,onCheckpoint,maxWrites=50,maxReads=5000,clock=Date.now}={}){
 const expected=prepareFaConsolidationPlan(structuredClone(input));
 demand(plan&&snapshotDigest(plan)===snapshotDigest(expected),'CONSOLIDATION_PLAN_CHANGED');
 demand(['DRY_RUN','APPLY'].includes(mode)&&destinationProjectId===FA_PROJECT,'CONSOLIDATION_EXECUTION_SCOPE_INVALID');
 if(mode==='DRY_RUN')return faConsolidationReport(expected);
 demand(expected.ready,'CONSOLIDATION_PLAN_BLOCKED');
 const now=clock();
 demand(approval?.destinationProjectId===FA_PROJECT&&approval.planSha256===expected.planSha256
  &&Number.isFinite(approval.expiresAt)&&approval.expiresAt>now&&approval.expiresAt-now<=900000
  &&gates.every(key=>approval.gates?.[key]===true),'CONSOLIDATION_APPROVAL_OR_GATES_MISSING');
 demand(adapter&&['assertBarrier','readSource','readDestination','commit'].every(name=>typeof adapter[name]==='function')
  &&typeof onCheckpoint==='function','CONSOLIDATION_ADAPTER_INVALID');
 demand(Number.isSafeInteger(maxWrites)&&maxWrites>0&&maxWrites<=500&&Number.isSafeInteger(maxReads)&&maxReads>0&&maxReads<=10000,'CONSOLIDATION_EXECUTION_LIMIT_INVALID');
 const paths=new Set(expected.operations.map(row=>row.path));
 if(checkpoint)demand(checkpoint.planSha256===expected.planSha256&&Array.isArray(checkpoint.completed)
  &&new Set(checkpoint.completed).size===checkpoint.completed.length&&checkpoint.completed.every(path=>paths.has(path)),'CONSOLIDATION_CHECKPOINT_INVALID');
 const completed=new Set(checkpoint?.completed||[]),result={code:'FA_CONSOLIDATION_VERIFIED',planSha256:expected.planSha256,plannedDocuments:expected.operations.length,writes:0,reads:0,verified:0,alreadyEquivalent:0,sourcePreserved:true};
 const read=async(method,path)=>{
  demand(++result.reads<=maxReads,'CONSOLIDATION_READ_BUDGET_EXHAUSTED');
  try{return await adapter[method](path);}catch{throw Error('CONSOLIDATION_'+(method==='readSource'?'SOURCE':'DESTINATION')+'_READ_FAILED');}
 };
 const barrier=async()=>{
  demand(clock()<approval.expiresAt,'CONSOLIDATION_APPROVAL_EXPIRED');
  let confirmed;try{confirmed=await adapter.assertBarrier(expected.planSha256);}catch{throw Error('CONSOLIDATION_BARRIER_UNAVAILABLE');}
  demand(confirmed===true,'CONSOLIDATION_BARRIER_LOST');
 };
 await barrier();
 for(const operation of expected.operations){
  if(operation.sourceFieldsSha256){
   const source=await read('readSource',operation.path);
   demand(source?.updateTime===operation.sourceUpdateTime&&snapshotDigest(source.fields)===operation.sourceFieldsSha256,'CONSOLIDATION_SOURCE_CHANGED');
  }
  const current=await read('readDestination',operation.path);
  const equivalent=current&&snapshotDigest(current.fields)===operation.fieldsSha256;
  if(!equivalent){
   demand(['CREATE','UPDATE'].includes(operation.action),'CONSOLIDATION_DESTINATION_CHANGED');
   demand(operation.action==='CREATE'?!current:current?.updateTime===operation.precondition.updateTime,'CONSOLIDATION_DESTINATION_CHANGED');
   if(result.writes>=maxWrites){result.code='FA_CONSOLIDATION_PARTIAL';break;}
   await barrier();
   try{await adapter.commit({projectId:FA_PROJECT,databaseId:'(default)',path:operation.path,fields:operation.fields,precondition:operation.precondition});}
   catch{throw Error('CONSOLIDATION_COMMIT_UNCERTAIN');}
   result.writes++;
   const stored=await read('readDestination',operation.path);
   demand(stored&&snapshotDigest(stored.fields)===operation.fieldsSha256,'CONSOLIDATION_POSTCHECK_FAILED');
  }else result.alreadyEquivalent++;
  result.verified++;completed.add(operation.path);
  // Checkpoint paths are private; the normal result is aggregate only.
  await onCheckpoint({schemaVersion:1,planSha256:expected.planSha256,completed:[...completed].sort()});
 }
 return result;
}
