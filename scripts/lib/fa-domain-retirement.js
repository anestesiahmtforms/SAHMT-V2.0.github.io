import {managementDomainCollections} from './secondary-domain-release-package.js';
import {validateSplitSnapshot,documentDigest,snapshotDigest} from './management-split-plan.js';
const allowed=new Set([...managementDomainCollections,'evaluationActivities','evaluationFormConfigs','evaluationLinks','evaluationParticipations','evaluationAssignments','evaluationAssignmentHistory','evaluationGovernanceRevisions','evaluationRequests','evaluationAwards','evaluationLedger','evaluationSummaries','evaluationReference','evaluationRuntime']);
const gates=['backupVerified','productionRoutesVerified','sourceWritersStopped','destinationWritersStopped','areaNotificationsResolved','pendingActionsReconciled'];
export function planFaDomainRetirement(source,destination,evidence) {
 if(gates.some(key=>evidence?.[key]!==true))throw Error('RETIREMENT_GATES_INCOMPLETE');
 if(source?.projectId!=='sahmt-17a16'||destination?.projectId!=='sahmt-gestao-5ae66')throw Error('RETIREMENT_PROJECT_INVALID');
 validateSplitSnapshot(source);validateSplitSnapshot(destination);
 const target=new Map(destination.documents.map(d=>[d.path,d]));const writes=[];
 for(const row of source.documents){
  const parts=row.path.split('/');
  if(parts.length!==2||!allowed.has(parts[0]))throw Error('RETIREMENT_PATH_FORBIDDEN');
  if(!destination.coverage.rootCollections.includes(parts[0]))throw Error('RETIREMENT_DESTINATION_COVERAGE_MISSING');
  const copy=target.get(row.path);if(!copy||documentDigest(row.fields)!==documentDigest(copy.fields))throw Error('RETIREMENT_DESTINATION_NOT_EQUIVALENT');
  writes.push({delete:'projects/sahmt-17a16/databases/(default)/documents/'+row.path,currentDocument:{updateTime:row.updateTime}});
 }
 return {schemaVersion:1,code:'RETIREMENT_EXACT_PATH_PLAN',sourceSha256:snapshotDigest(source),destinationSha256:snapshotDigest(destination),count:writes.length,writes};
}
