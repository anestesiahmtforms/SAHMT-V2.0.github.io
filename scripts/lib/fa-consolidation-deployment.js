const FA='sahmt-17a16',FB='sahmt-gestao-5ae66';
const files=new Set(['EvaluationLedger.gs','EvaluationLegacyScoreDelivery.gs','TrainingValidation.gs',
 'ManagementScoreValidation.gs','EvaluationChecklistDelivery.gs','ChecklistScienceRelease.gs',
 'EvaluationOccurrenceDelivery.gs','SparkReportSync.gs']);
const demand=(value,code)=>{if(!value)throw Error(code);};
const normalized=value=>value.replaceAll('\r\n','\n');
/** Merge the reviewed files only. Remote private installers, manifest, scopes,
 * and unrelated operational modules remain byte-for-byte intact. */
export function mergeConsolidationScript({remote,baseFiles,localFiles}={}){
 demand(Array.isArray(remote?.files)&&baseFiles&&localFiles,'CONSOLIDATION_DEPLOY_INPUT_INVALID');
 const result=structuredClone(remote),names=Object.keys(localFiles);
 demand(names.length>0&&names.every(name=>files.has(name)),'CONSOLIDATION_DEPLOY_FILE_FORBIDDEN');
 for(const name of names){
  const matches=result.files.filter(file=>file.name===name.slice(0,-3)&&file.type==='SERVER_JS');
  demand(matches.length===1&&typeof baseFiles[name]==='string'&&typeof localFiles[name]==='string'
   &&normalized(matches[0].source)===normalized(baseFiles[name]),'CONSOLIDATION_DEPLOY_REMOTE_DRIFT');
  matches[0].source=localFiles[name];
 }
 return result;
}
export function assertConsolidationDeployments({before,current,versionNumber}={}){
 demand(Array.isArray(before?.deployments)&&Array.isArray(current?.deployments)
  &&Number.isSafeInteger(versionNumber)&&versionNumber>0,'CONSOLIDATION_DEPLOYMENT_EVIDENCE_INVALID');
 demand(before.deployments.length>0&&before.deployments.length===current.deployments.length
  &&new Set(current.deployments.map(item=>item.deploymentId)).size===current.deployments.length,
  'CONSOLIDATION_DEPLOYMENT_DRIFT');
 for(const expected of before.deployments){
  const actual=current.deployments.find(item=>item.deploymentId===expected.deploymentId);
  demand(actual&&actual.deploymentConfig?.versionNumber===(Number.isSafeInteger(expected.deploymentConfig?.versionNumber)
   ?versionNumber:expected.deploymentConfig?.versionNumber),'CONSOLIDATION_DEPLOYMENT_DRIFT');
 }
 return true;
}
/** Patches only; callers must use update masks and CAS against backed-up
 * live documents. No destructive rollback or source data deletion exists. */
export function consolidationControlWrites({phase,planSha256,verifiedDocuments,plan,verification}={}){
 demand(['BLOCK','ACTIVATE'].includes(phase)&&/^[a-f0-9]{64}$/.test(planSha256||'')
  &&Number.isSafeInteger(verifiedDocuments)&&verifiedDocuments>=0
  &&(phase!=='ACTIVATE'||verifiedDocuments>0),'CONSOLIDATION_CONTROL_EVIDENCE_INVALID');
 const active=phase==='ACTIVATE',bool=value=>({booleanValue:value}),str=value=>({stringValue:value});
 if(active)demand(plan?.ready===true&&plan.planSha256===planSha256&&Array.isArray(plan.operations)
  &&plan.operations.length===verifiedDocuments&&verification?.code==='FA_CONSOLIDATION_VERIFIED'
  &&verification.planSha256===planSha256&&verification.plannedDocuments===verifiedDocuments
  &&verification.verified===verifiedDocuments&&verification.sourcePreserved===true,
  'CONSOLIDATION_CONTROL_COPY_INCOMPLETE');
 return [
  {projectId:FA,path:'managementRuntime/faConsolidation',fields:{schemaVersion:{integerValue:'1'},
   release:str('fa-consolidation-v1'),status:str(active?'ACTIVE':'PREPARING'),sourceProjectId:str(FB),destinationProjectId:str(FA),
   planSha256:str(planSha256),verifiedDocuments:{integerValue:String(verifiedDocuments)},
   plannedDocuments:{integerValue:String(active?plan.operations.length:0)},migrationCode:str(active?verification.code:'NOT_COMPLETED')}},
  {projectId:FA,path:'managementRuntime/domainCutover',fields:{retired:bool(!active),sourceWritesBlocked:bool(!active)}},
  {projectId:FB,path:'managementRuntime/domainCutover',fields:{managementEnabled:bool(false),evaluationEnabled:bool(false)}}
 ];
}
