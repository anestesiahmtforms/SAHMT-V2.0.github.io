import {createHash} from 'node:crypto';
import {snapshotDigest} from './management-split-plan.js';
import {firestoreQuotaDayStart,sourceUsageHumanReportTextSha256,sourceUsageHumanReportUpperReads,
  sourceUsageHumanReportObservationSha256} from './management-read-budget.js';
import {MANAGEMENT_CAPTURE_RECOVERY_AUTHORIZATION} from './management-capture-recovery-plan.js';

const FA='sahmt-17a16',NS='FA-rec1',SHA=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CONTROL_TEXT='não quero nenhuma janela de segurança , vou autorizando a leitura manualmente. pois estã atrazando tuso';
const commonKeys=['plan','authorizationEvidence','manualControlEvidence','observation','nowMs'];
const planKeys=['schemaVersion','kind','namespace','sourceProjectId','databaseId','createdAt','predecessor','authority',
  'quota','captureConfiguration','automaticRetry','implicitResume','oldArtifactsMutable','oldDocumentsUsedInNewSnapshot','productionActivation','planSha256'];
const quotaKeys=['quotaDayStart','dailyReadLimit','appTrafficReserve','metricLagReserve','predecessorReservedReads',
  'newCaptureReservationLimit','cumulativeReadReservationLimit'];
const controlKeys=['schemaVersion','source','humanMessageId','recordedAt','text','textSha256'];
const observationKeys=['observationSource','project','quotaDayStart','reportedAt','reviewedAt','periodStart','periodKind',
  'reportedReads','reads','reportedText','evidenceId','evidenceSha256','exactGlobalCutoff','totalUsageKnown','measuredTotalReads','reportProvenance'];
const provenanceKeys=['schemaVersion','source','humanMessageId','evidenceId','evidenceSha256','reportedAt'];
const limits={maxPages:3000,maxDocuments:6000,maxDepth:30,maxBytes:12*1024*1024,maxDurationMs:240000,requestTimeoutMs:20000};
const demand=(ok,code)=>{if(!ok)throw Error('MANUAL_READ_'+code);};
const count=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>plain(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{
  const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');});
const same=(a,b)=>snapshotDigest(a)===snapshotDigest(b);
const iso=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  &&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
function json(input){let nodes=0,characters=0;const seen=new Set();const visit=(v,depth=0)=>{
  demand(++nodes<=100000&&depth<=40,'INPUT_INVALID');
  if(v===null||typeof v==='boolean')return;
  if(typeof v==='string'){characters+=v.length;demand(characters<=1024*1024,'INPUT_INVALID');return;}
  if(typeof v==='number'){demand(Number.isFinite(v)&&!Object.is(v,-0),'INPUT_INVALID');return;}
  demand((Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype||plain(v))&&!seen.has(v),'INPUT_INVALID');
  seen.add(v);const keys=Reflect.ownKeys(v);if(Array.isArray(v))demand(keys.length===v.length+1&&keys.at(-1)==='length','INPUT_INVALID');
  for(const key of keys){if(Array.isArray(v)&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(v,key);
    demand(typeof key==='string'&&d.enumerable&&Object.hasOwn(d,'value'),'INPUT_INVALID');visit(d.value,depth+1);}
  seen.delete(v);};visit(input);const encoded=JSON.stringify(input);demand(Buffer.byteLength(encoded,'utf8')<=1024*1024,'INPUT_INVALID');
  return JSON.parse(encoded);}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function envelope(input,additionalKeys=[]){const value=json(input);demand(exact(value,[...commonKeys,...additionalKeys])&&count(value.nowMs),'INPUT_INVALID');
  const {plan,authorizationEvidence,manualControlEvidence:control,observation:o,nowMs}=value;
  const day=firestoreQuotaDayStart(nowMs);
  demand(plan?.quota?.quotaDayStart===day,'QUOTA_DAY_CHANGED');
  demand(exact(plan,planKeys)&&plan.schemaVersion===1&&plan.kind==='MANAGEMENT_FRESH_CONSISTENT_RECOVERY_CAPTURE'
    &&plan.namespace===NS&&plan.sourceProjectId===FA&&plan.databaseId==='(default)'&&iso(plan.createdAt)
    &&Date.parse(plan.createdAt)<=nowMs&&firestoreQuotaDayStart(Date.parse(plan.createdAt))===day
    &&SHA.test(plan.planSha256||'')
    &&snapshotDigest((({planSha256,...body})=>body)(plan))===plan.planSha256
    &&['automaticRetry','implicitResume','oldArtifactsMutable','oldDocumentsUsedInNewSnapshot','productionActivation'].every(k=>plan[k]===false)
    &&exact(plan.quota,quotaKeys)&&plan.quota.dailyReadLimit===45000&&plan.quota.appTrafficReserve===5000
    &&plan.quota.metricLagReserve===2000&&plan.quota.predecessorReservedReads===1342&&plan.quota.newCaptureReservationLimit===3000
    &&plan.quota.cumulativeReadReservationLimit===6000&&plan.predecessor?.reservedReads===1342,'PLAN_INVALID');
  const c=plan.captureConfiguration;
  demand(exact(c,['projectId','databaseId','rootCollections','pageSize','collectionPageSize','limits'])&&c.projectId===FA
    &&c.databaseId==='(default)'&&c.pageSize===25&&c.collectionPageSize===100&&Array.isArray(c.rootCollections)
    &&c.rootCollections.length===43&&new Set(c.rootCollections).size===43&&c.rootCollections.every(v=>typeof v==='string'&&/^[A-Za-z][A-Za-z0-9_-]*$/.test(v))
    &&same(c.limits,limits),'PLAN_INVALID');
  demand(same(authorizationEvidence,MANAGEMENT_CAPTURE_RECOVERY_AUTHORIZATION)&&same(plan.authority,authorizationEvidence)
    &&Date.parse(authorizationEvidence.sourceHumanDecisionAt)<=nowMs
    &&firestoreQuotaDayStart(Date.parse(authorizationEvidence.sourceHumanDecisionAt))===day,'SOURCE_AUTHORIZATION_INVALID');
  demand(exact(control,controlKeys)&&control.schemaVersion===1&&control.source==='EXPLICIT_HUMAN_MESSAGE'
    &&ID.test(control.humanMessageId||'')&&iso(control.recordedAt)&&Date.parse(control.recordedAt)<=nowMs
    &&Date.parse(control.recordedAt)>=Date.parse(authorizationEvidence.sourceHumanDecisionAt)
    &&firestoreQuotaDayStart(Date.parse(control.recordedAt))===day
    &&(control.text===CONTROL_TEXT||control.text===CONTROL_TEXT+'\n')&&SHA.test(control.textSha256||'')
    &&createHash('sha256').update(control.text,'utf8').digest('hex')===control.textSha256,'CONTROL_EVIDENCE_INVALID');
  demand(exact(o,observationKeys)&&o.observationSource==='USER_CURRENT_USAGE_HUMAN_REPORT'&&o.project===FA&&o.quotaDayStart===day
    &&o.periodStart===day&&o.periodKind==='CURRENT_FA_QUOTA_DAY_TO_REPORT'&&iso(o.reportedAt)&&iso(o.reviewedAt)
    &&Date.parse(o.reportedAt)>=Date.parse(day)&&Date.parse(o.reportedAt)<=Date.parse(o.reviewedAt)&&Date.parse(o.reviewedAt)<=nowMs
    &&count(o.reportedReads)&&count(o.reads)&&typeof o.reportedText==='string'&&o.reportedText.length>0&&o.reportedText.length<=4096
    &&ID.test(o.evidenceId||'')&&SHA.test(o.evidenceSha256||'')&&o.exactGlobalCutoff===false&&o.totalUsageKnown===false
    &&o.measuredTotalReads===null,'OBSERVATION_INVALID');
  const report=o.reportProvenance;
  demand(exact(report,provenanceKeys)&&report.schemaVersion===1&&report.source==='HUMAN_USER_MESSAGE_TEXT'
    &&ID.test(report.humanMessageId||'')&&report.evidenceId===o.evidenceId&&report.evidenceSha256===o.evidenceSha256
    &&report.reportedAt===o.reportedAt,'OBSERVATION_INVALID');
  try{demand(sourceUsageHumanReportTextSha256(o.reportedText)===o.evidenceSha256
    &&sourceUsageHumanReportUpperReads(o.reportedReads)===o.reads,'OBSERVATION_INVALID');}
  catch{throw Error('MANUAL_READ_OBSERVATION_INVALID');}
  return {...value,quotaDayStart:day};
}
function bodyFor(value,preparedAt){const {plan,authorizationEvidence:a,manualControlEvidence:c,observation:o,quotaDayStart}=value;
  return {schemaVersion:1,kind:'MANAGEMENT_FA_MANUAL_CAPTURE_AUTHORIZATION',namespace:NS,projectId:FA,databaseId:'(default)',
    authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',planSha256:plan.planSha256,quotaDayStart,quotaTimeZone:'America/Los_Angeles',preparedAt,
    sourceHumanDecisionAt:a.sourceHumanDecisionAt,sourceAuthorizationSha256:snapshotDigest(a),
    manualControlEvidenceSha256:snapshotDigest(c),manualControlHumanMessageId:c.humanMessageId,manualControlRecordedAt:c.recordedAt,
    historicalUsage:{reportedAt:o.reportedAt,reviewedAt:o.reviewedAt,reportedReads:o.reportedReads,estimatedUpperReads:o.reads,
      evidenceId:o.evidenceId,evidenceSha256:o.evidenceSha256,reportHumanMessageId:o.reportProvenance.humanMessageId,
      observationSha256:sourceUsageHumanReportObservationSha256(o)},
    consentMode:'MANUAL_SINGLE_CAPTURE_SAME_QUOTA_DAY',maximumAttempts:1,temporalExpiryMinutes:null,
    dailyReadLimit:45000,appTrafficReserve:5000,metricLagReserve:2000,predecessorReservedReads:1342,
    newCaptureReservationLimit:3000,cumulativeReadReservationLimit:6000,automaticRetry:false,automaticResume:false,renewalClearsPause:false,
    observationCurrent:false,totalUsageKnown:false,measuredTotalReads:null,exactGlobalCutoff:false};}
function sealed(value,preparedAt){const body=bodyFor(value,preparedAt);return freeze({...body,approvalSha256:snapshotDigest(body)});}
function validate(value){const {approval,nowMs,manualControlEvidence,observation}=value;
  demand(plain(approval)&&iso(approval.preparedAt)&&Date.parse(approval.preparedAt)<=nowMs
    &&Date.parse(approval.preparedAt)>=Date.parse(manualControlEvidence.recordedAt)
    &&Date.parse(approval.preparedAt)>=Date.parse(observation.reviewedAt)
    &&same(approval,sealed(value,approval.preparedAt)),'APPROVAL_INVALID_OR_CHANGED');return freeze(approval);}

/** Pure finite-unit consent. Full predecessor/plan/file provenance and the unique
 * namespace/coordinator remain the CLI's responsibility. A hash alone is not
 * proof of a human decision. No metric is refreshed and no old pause is cleared. */
export function prepareManagementManualReadApproval(input){const value=envelope(input);return sealed(value,new Date(value.nowMs).toISOString());}
/** Same quota day only; elapsed minutes never revoke this manual consent. */
export function validateManagementManualReadApproval(input){return validate(envelope(input,['approval']));}
/** Pure next-debit/current-admission check; caller must durably persist its ledger
 * before HTTP and prove one capture attempt via the fixed namespace/coordinator.
 * maximumReads=0 checks a debit already in that ledger and never refunds it. */
export function assessManagementManualReadApproval(input){const value=envelope(input,['approval','recoveryReservedReads','maximumReads','legacyReservedReads']);
  const approval=validate(value),{recoveryReservedReads,maximumReads,legacyReservedReads}=value;
  demand(count(recoveryReservedReads)&&count(maximumReads)&&[0,1,25].includes(maximumReads)&&count(legacyReservedReads),'RESERVATION_INVALID');
  if(maximumReads===0)demand(recoveryReservedReads>0,'EXISTING_RESERVATION_REQUIRED');
  const nextRecovery=recoveryReservedReads+maximumReads,reservedReads=1342+nextRecovery;
  demand(count(nextRecovery)&&nextRecovery<=3000&&count(reservedReads)&&reservedReads<=6000,'CAPTURE_RESERVE_LIMIT');
  const estimatedWithMargin=approval.historicalUsage.estimatedUpperReads+legacyReservedReads+reservedReads+5000+2000;
  demand(count(estimatedWithMargin)&&estimatedWithMargin<45000,'DAILY_LIMIT_OR_MARGIN');
  return freeze({allowed:true,projectId:FA,namespace:NS,quotaDayStart:value.quotaDayStart,approvalSha256:approval.approvalSha256,
    reservedReads,recoveryReservedReads:nextRecovery,additionalReservedReads:maximumReads,estimatedWithMargin,
    remainingAfterMargin:45000-estimatedWithMargin,maximumAttempts:1,requiresDurableReservation:true,localReservationOnly:true,
    observationSource:'HISTORICAL_HUMAN_REPORT_MANUAL_CONSENT',observationCurrent:false,
    estimatedUpperReads:approval.historicalUsage.estimatedUpperReads,totalUsageKnown:false,measuredTotalReads:null,exactGlobalCutoff:false});}