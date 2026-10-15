import {snapshotDigest,validateSplitSnapshot} from './management-split-plan.js';
import {managementDomainCollections} from './secondary-domain-release-package.js';

export const FA_PROJECT='sahmt-17a16';
export const FB_PROJECT='sahmt-gestao-5ae66';
export const FC_PROJECT='indicadores---sahmt';
export const FC_CONSOLIDATION_COLLECTIONS=Object.freeze(['occurrenceReports','occurrenceAudit','occurrenceScoreClaims','occurrenceCatalogs']);
export const FA_CONSOLIDATION_COLLECTIONS=Object.freeze([...managementDomainCollections,
 'evaluationActivities','evaluationFormConfigs','evaluationLinks','evaluationParticipations','evaluationAssignments',
 'evaluationAssignmentHistory','evaluationGovernanceRevisions','evaluationRequests','evaluationAwards','evaluationLedger',
 'evaluationSummaries','evaluationReference','evaluationRuntime','evaluationChecklistTransfers','evaluationSourceReceipts',
 'evaluationLegacyScoreOutbox','evaluationHomologationInputs','migrationOrigins','auditLogs','notifications','notificationGroups']);
const allowed=new Set(FA_CONSOLIDATION_COLLECTIONS);
const shared=new Set(['auditLogs','notifications','notificationGroups']);
const demand=(condition,code)=>{if(!condition)throw Error(code);};
const digest=value=>snapshotDigest(value);
const clone=value=>structuredClone(value);
const prefix=project=>'projects/'+project+'/databases/(default)/documents/';
const validReason=value=>typeof value==='string'&&value.trim().length>=8&&value.length<=1000;

/** Pure dry-run over typed REST snapshots. Contains no credential, network,
 * source deletion, points calculation or production apply capability. */
export function prepareFaConsolidationPlan(input){return prepareScopedPlan(input,FB_PROJECT,allowed,shared);}
export function prepareFcConsolidationPlan(input){
 const {planSha256,...plan}=prepareScopedPlan(input,FC_PROJECT,new Set(FC_CONSOLIDATION_COLLECTIONS),new Set());
 const rows=new Map(input.source.documents.map(row=>[row.path,row]));
 const problems=[];
 for(const row of input.source.documents){
  const [collection,id]=row.path.split('/');
  if(!['occurrenceReports','occurrenceAudit','occurrenceScoreClaims'].includes(collection))continue;
  const report=rows.get('occurrenceReports/'+id)?.fields,audit=rows.get('occurrenceAudit/'+id)?.fields,claim=rows.get('occurrenceScoreClaims/'+id)?.fields;
  let code=null;
  if(!report||!audit||!claim)code='OCCURRENCE_RELATION_INCOMPLETE';
  else if(report.id?.stringValue!==id||audit.reportId?.stringValue!==id||claim.sourceId?.stringValue!==id||claim.id?.stringValue!==id
   ||!audit.uid?.stringValue||audit.uid.stringValue!==claim.uid?.stringValue
   ||audit.formId?.stringValue!==report.formId?.stringValue||claim.formId?.stringValue!==report.formId?.stringValue
   ||audit.anonymous?.booleanValue!==report.anonymous?.booleanValue)code='OCCURRENCE_IDENTITY_MISMATCH';
  else if(!report.createdAt?.timestampValue||report.createdAt.timestampValue!==audit.createdAt?.timestampValue||report.createdAt.timestampValue!==claim.createdAt?.timestampValue)code='OCCURRENCE_TIMESTAMP_MISMATCH';
  if(code&&!problems.some(item=>item.path.endsWith('/'+id)&&item.code===code))problems.push({path:row.path,code});
 }
 const catalog=rows.get('occurrenceCatalogs/current');
 if(!catalog?.fields?.catalogs?.mapValue||catalog.fields.schemaVersion?.integerValue!=='1')problems.push({path:'occurrenceCatalogs/current',code:'OCCURRENCE_CATALOG_MISSING_OR_INVALID'});
 plan.conflicts.push(...problems);plan.counts.conflicts=plan.conflicts.length;plan.ready=plan.conflicts.length===0;
 return {...plan,planSha256:digest(plan)};
}
function prepareScopedPlan({source,destination,scope,resolutions=[],sharedPaths=[]}={},sourceProjectId,allowed,shared) {
 demand(source?.projectId===sourceProjectId&&destination?.projectId===FA_PROJECT,'CONSOLIDATION_PROJECT_INVALID');
 validateSplitSnapshot(source);validateSplitSnapshot(destination);
 demand(Array.isArray(scope)&&scope.length>0&&new Set(scope).size===scope.length&&scope.every(name=>allowed.has(name)),'CONSOLIDATION_SCOPE_INVALID');
 demand(scope.every(name=>source.coverage.rootCollections.includes(name)&&destination.coverage.rootCollections.includes(name)),'CONSOLIDATION_SNAPSHOT_COVERAGE_MISSING');
 demand(Array.isArray(resolutions)&&Array.isArray(sharedPaths),'CONSOLIDATION_RESOLUTION_INVALID');
 const selectedShared=new Map();
 for(const item of sharedPaths){
  demand(item&&shared.has(item.path?.split('/')[0])&&scope.includes(item.path.split('/')[0])&&!selectedShared.has(item.path)
   &&/^[a-f0-9]{64}$/.test(item.sourceFieldsSha256||''),'CONSOLIDATION_SHARED_SELECTION_INVALID');
  selectedShared.set(item.path,item);
 }
 const inScope=row=>scope.includes(row.path.split('/')[0]);
 const sourceRows=source.documents.filter(inScope),destinationRows=destination.documents.filter(inScope);
 for(const row of sourceRows)if(shared.has(row.path.split('/')[0])){
  demand(selectedShared.has(row.path),'CONSOLIDATION_SHARED_SELECTION_REQUIRED');
  demand(selectedShared.get(row.path).sourceFieldsSha256===digest(row.fields),'CONSOLIDATION_SHARED_SELECTION_STALE');
 }
 demand([...selectedShared.keys()].every(path=>sourceRows.some(row=>row.path===path)),'CONSOLIDATION_SHARED_SELECTION_MISSING');
 const sourceByPath=new Map(sourceRows.map(row=>[row.path,row])),targetByPath=new Map(destinationRows.map(row=>[row.path,row]));
 const decisions=new Map(),consumed=new Set();
 for(const row of resolutions){
  demand(row&&typeof row.path==='string'&&!decisions.has(row.path)&&['USE_SOURCE','KEEP_DESTINATION'].includes(row.action)&&validReason(row.reason),'CONSOLIDATION_RESOLUTION_INVALID');
  decisions.set(row.path,row);
 }
 const operations=[],conflicts=[];
 const counts={source:sourceRows.length,destination:destinationRows.length,create:0,update:0,equivalent:0,kept:0,destinationOnly:0,writes:0,conflicts:0};
 const rewrite=(value,unmapped)=>{
  if(Array.isArray(value))return value.map(item=>rewrite(item,unmapped));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>{
   if(key==='referenceValue'&&typeof item==='string'&&item.startsWith(prefix(sourceProjectId))){
    const path=item.slice(prefix(sourceProjectId).length);
    if(sourceByPath.has(path))return [key,prefix(FA_PROJECT)+path];
    unmapped.add(path);
   }
   return [key,rewrite(item,unmapped)];
  }));
  return value;
 };
 const checkDecision=(path,src,dst)=>{
  const resolution=decisions.get(path);if(!resolution)return null;consumed.add(path);
  demand(resolution.destinationFieldsSha256===(dst?digest(dst.fields):null)
   &&(src?resolution.sourceFieldsSha256===digest(src.fields):resolution.sourceFieldsSha256===undefined),'CONSOLIDATION_RESOLUTION_STALE');
  return resolution;
 };
 for(const path of [...sourceByPath.keys()].sort()){
  const src=sourceByPath.get(path),dst=targetByPath.get(path),unmapped=new Set(),fields=rewrite(src.fields,unmapped);
  const decision=checkDecision(path,src,dst);
  if(unmapped.size){conflicts.push({path,code:'UNMAPPED_SOURCE_REFERENCE',dependencyCount:unmapped.size});continue;}
  const base={path,sourceFieldsSha256:digest(src.fields),fieldsSha256:digest(fields),sourceCreateTime:src.createTime,sourceUpdateTime:src.updateTime};
  if(dst&&digest(dst.fields)===digest(fields)){
   operations.push({...base,action:'SKIP',precondition:{updateTime:dst.updateTime}});counts.equivalent++;continue;
  }
  if(!dst){
   demand(!decision,'CONSOLIDATION_RESOLUTION_UNNECESSARY');
   operations.push({...base,action:'CREATE',fields,precondition:{exists:false}});counts.create++;continue;
  }
  if(!decision){conflicts.push({path,code:'CONTENT_CONFLICT',sourceFieldsSha256:digest(src.fields),destinationFieldsSha256:digest(dst.fields)});continue;}
  if(decision.action==='KEEP_DESTINATION'){
   operations.push({...base,action:'KEEP',fieldsSha256:digest(dst.fields),precondition:{updateTime:dst.updateTime},resolution:clone(decision)});counts.kept++;
  }else{
   operations.push({...base,action:'UPDATE',fields,precondition:{updateTime:dst.updateTime},resolution:clone(decision)});counts.update++;
  }
 }
 for(const path of [...targetByPath.keys()].sort())if(!sourceByPath.has(path)){
  const dst=targetByPath.get(path),decision=checkDecision(path,null,dst);counts.destinationOnly++;
  if(!decision){conflicts.push({path,code:'DESTINATION_ONLY_REVIEW',destinationFieldsSha256:digest(dst.fields)});continue;}
  demand(decision.action==='KEEP_DESTINATION','CONSOLIDATION_RESOLUTION_ACTION_INVALID');counts.kept++;
  operations.push({path,action:'KEEP',fieldsSha256:digest(dst.fields),precondition:{updateTime:dst.updateTime},resolution:clone(decision)});
 }
 demand(consumed.size===decisions.size,'CONSOLIDATION_RESOLUTION_UNUSED');
 counts.writes=counts.create+counts.update;counts.conflicts=conflicts.length;
 const plan={schemaVersion:1,code:'FA_CONSOLIDATION_DRY_RUN',sourceProjectId,destinationProjectId:FA_PROJECT,databaseId:'(default)',
  sourceSnapshotSha256:digest(source),destinationSnapshotSha256:digest(destination),scope:[...scope].sort(),
  ready:conflicts.length===0,counts,operations,conflicts,sourcePreserved:true,identityChanges:0,scoreRecalculations:0};
 return {...plan,planSha256:digest(plan)};
}

/** Only this aggregate may be written to normal terminal/CI logs. The full plan
 * contains private paths and typed data and belongs in the private backup. */
export function faConsolidationReport(plan){
 const categories={};for(const row of plan.conflicts)categories[row.code]=(categories[row.code]||0)+1;
 return {schemaVersion:1,code:plan.code,sourceProjectId:plan.sourceProjectId,destinationProjectId:plan.destinationProjectId,
  ready:plan.ready,counts:clone(plan.counts),conflictCategories:categories,sourcePreserved:true,identityChanges:0,scoreRecalculations:0};
}
