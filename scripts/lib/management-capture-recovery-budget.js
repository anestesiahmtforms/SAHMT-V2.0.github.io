import {assessManagementReadBudget, firestoreQuotaDayStart, sourceUsageHumanReportObservationSha256} from './management-read-budget.js';
import {snapshotDigest} from './management-split-plan.js';
import {validateManagementCaptureRecoveryPlanEnvelope} from './management-capture-recovery-plan.js';
import {validateManagementManualReadApproval,assessManagementManualReadApproval} from './management-manual-read-approval.js';

const FA='sahmt-17a16', NAMESPACE='FA-rec1', DECISION='2026-10-09T15:12:31.000Z';
const SHA=/^[a-f0-9]{64}$/, ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const count=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const exact=(v,keys)=>plain(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{
  const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');
});
function copy(value) {
  let nodes=0,characters=0;
  const visit=(v,depth)=>{
    demand(++nodes<=100000&&depth<=60,'RECOVERY_BUDGET_INPUT_LIMIT');
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='string'){characters+=v.length;demand(characters<=8*1024*1024,'RECOVERY_BUDGET_INPUT_LIMIT');return v;}
    if(typeof v==='number'){demand(Number.isFinite(v),'RECOVERY_BUDGET_INPUT_INVALID');return v;}
    demand(Array.isArray(v)||plain(v),'RECOVERY_BUDGET_INPUT_INVALID');
    if(Array.isArray(v)){
      demand(Reflect.ownKeys(v).length===v.length+1,'RECOVERY_BUDGET_INPUT_INVALID');
      return Array.from({length:v.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(v,String(i));demand(d?.enumerable&&Object.hasOwn(d,'value'),'RECOVERY_BUDGET_INPUT_INVALID');return visit(d.value,depth+1);});
    }
    const result={};
    for(const key of Reflect.ownKeys(v)){
      const d=Object.getOwnPropertyDescriptor(v,key);
      demand(typeof key==='string'&&d?.enumerable&&Object.hasOwn(d,'value'),'RECOVERY_BUDGET_INPUT_INVALID');
      Object.defineProperty(result,key,{value:visit(d.value,depth+1),enumerable:true,writable:true,configurable:true});
    }
    return result;
  };
  return visit(value,0);
}
const time=value=>{demand(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value,'RECOVERY_BUDGET_TIME_INVALID');return Date.parse(value);};
const clock=nowMs=>{demand(count(nowMs),'RECOVERY_BUDGET_CLOCK_INVALID');return nowMs;};
const AUTH_KEYS=['schemaVersion','authorized','authorizationSource','authorizationId','humanDecisionMessageId','projectId','authorizedPurpose','dailyReadLimit','quotaDayStart','approvedAt','reviewedAt','reportedAt','evidenceId','evidenceSha256','observationSha256','reportHumanMessageId','reportSource','maximumCaptureReserve'];
function reportAuthority(value,day,nowMs,context) {
  if(value?.kind==='MANAGEMENT_FA_MANUAL_CAPTURE_AUTHORIZATION'){
    const {plan,authorizationEvidence,manualControlEvidence,observation}=context;
    return copy(validateManagementManualReadApproval({plan,authorizationEvidence,manualControlEvidence,observation,nowMs,approval:value}));
  }
  demand(exact(value,AUTH_KEYS)&&value.schemaVersion===1&&value.authorized===true
    &&value.authorizationSource==='EXPLICIT_HUMAN_FA_QUARTER_CAPTURE_REVIEW'
    &&['authorizationId','humanDecisionMessageId','evidenceId','reportHumanMessageId'].every(k=>ID.test(value[k]||''))
    &&value.projectId===FA&&value.authorizedPurpose==='MANAGEMENT_BACKUP_ONLY'&&value.dailyReadLimit===45000
    &&value.maximumCaptureReserve===6000&&value.quotaDayStart===day&&value.approvedAt===DECISION
    &&value.reportSource==='HUMAN_USER_MESSAGE_TEXT'
    &&SHA.test(value.evidenceSha256||'')&&SHA.test(value.observationSha256||''),'RECOVERY_REPORT_AUTHORITY_INVALID');
  demand(time(value.reportedAt)<=time(value.reviewedAt)&&time(value.reviewedAt)<=nowMs
    &&time(value.reportedAt)>=time(day)&&time(value.reviewedAt)>=time(DECISION),'RECOVERY_REPORT_AUTHORITY_INVALID');
  return copy(value);
}
function envelope(input) {
  const value=copy(input);clock(value.nowMs);
  validateManagementCaptureRecoveryPlanEnvelope({plan:value.plan,predecessorPolicy:value.predecessorPolicy,
    authorizationEvidence:value.authorizationEvidence,nowMs:value.nowMs});
  const {plan,predecessorPolicy:old,authorizationEvidence,nowMs}=value,quotaDayStart=firestoreQuotaDayStart(nowMs);
  demand(plan.namespace===NAMESPACE&&plan.sourceProjectId===FA&&plan.databaseId==='(default)'
    &&plan.quota?.quotaDayStart===quotaDayStart&&plan.quota.dailyReadLimit===45000
    &&plan.quota.appTrafficReserve===5000&&plan.quota.metricLagReserve===2000
    &&plan.quota.predecessorReservedReads===1342&&plan.quota.newCaptureReservationLimit===3000
    &&plan.quota.cumulativeReadReservationLimit===6000
    &&plan.predecessor?.reservedReads===1342&&plan.predecessor.policySha256===snapshotDigest(old)
    &&old.schemaVersion===1&&old.projectId===FA&&old.dailyReadLimit===45000
    &&old.limitApprovalEvidence==='USER_FA_DAILY_LIMIT_45000_2026_10_08'
    &&old.authorizedPurpose==='MANAGEMENT_BACKUP_ONLY'&&old.quotaTimeZone==='America/Los_Angeles'
    &&old.renewalClearsPause===false&&old.pausedRequiresReview===true&&old.reservedReads===1342
    &&old.maximumCaptureReserve===6000&&old.appTrafficReserve===5000&&old.metricLagReserve===2000
    &&old.reservationQuotaDayStart===quotaDayStart&&old.humanDecisionAt===DECISION
    &&authorizationEvidence.sourceHumanDecisionAt===DECISION
    &&plan.predecessor.batchNumber===4&&nowMs>=time(plan.predecessor.originalReadTime)+3600000,
    'RECOVERY_PREDECESSOR_OR_LIMITS_CHANGED');
  return {...value,quotaDayStart};
}
const BUDGET_KEYS=['schemaVersion','kind','namespace','projectId','databaseId','planSha256','predecessorPolicySha256',
  'sourceAuthorizationSha256','sourceHumanDecisionAt','quotaDayStart','dailyReadLimit','appTrafficReserve','metricLagReserve',
  'predecessorReservedReads','maximumRecoveryOperationReserve','maximumCumulativeCaptureReserve','predecessorPausedRequiresReview',
  'predecessorCaptureStatus','predecessorReadTimeExpired','renewalClearsPause','status','pausedRequiresReview','preparedAt',
  'lastUpdatedAt','readTime','startedAt','deadlineAt','captureFinishedAt','recoveryReservedReads','cumulativeReservedReads','reportAuthorization','reservations','budgetSha256'];
const ROW_KEYS=['ordinal','attempt','operation','readTime','requestSha256','maximumReads','reservedAt','observationSha256','recoveryReservedReads','cumulativeReservedReads'];
function sealBudget(value){const next=copy(value);delete next.budgetSha256;return {...next,budgetSha256:snapshotDigest(next)};}
function validateBudget(input,{allowTerminal=false}={}) {
  const value=envelope(input),{plan,budget,nowMs,quotaDayStart}=value;
  demand(exact(budget,BUDGET_KEYS)&&budget.schemaVersion===1&&budget.kind==='MANAGEMENT_FA_CAPTURE_RECOVERY_BUDGET'
    &&budget.namespace===NAMESPACE&&budget.projectId===FA&&budget.databaseId==='(default)'
    &&budget.planSha256===plan.planSha256&&budget.predecessorPolicySha256===plan.predecessor.policySha256
    &&budget.sourceAuthorizationSha256===snapshotDigest(value.authorizationEvidence)&&budget.sourceHumanDecisionAt===DECISION
    &&budget.quotaDayStart===quotaDayStart&&budget.dailyReadLimit===45000&&budget.appTrafficReserve===5000
    &&budget.metricLagReserve===2000&&budget.predecessorReservedReads===1342
    &&budget.maximumRecoveryOperationReserve===3000&&budget.maximumCumulativeCaptureReserve===6000
    &&budget.predecessorPausedRequiresReview===true&&budget.predecessorCaptureStatus==='INCOMPLETE'
    &&budget.predecessorReadTimeExpired===true&&budget.renewalClearsPause===false
    &&['AUTHORIZED','IN_PROGRESS','COMPLETE','INCOMPLETE'].includes(budget.status)
    &&budget.pausedRequiresReview===['COMPLETE','INCOMPLETE'].includes(budget.status)
    &&count(budget.recoveryReservedReads)&&budget.recoveryReservedReads<=3000
    &&budget.cumulativeReservedReads===1342+budget.recoveryReservedReads&&budget.cumulativeReservedReads<=6000
    &&Array.isArray(budget.reservations)&&budget.reservations.length<=3000
    &&budget.budgetSha256===sealBudget(budget).budgetSha256,'RECOVERY_BUDGET_INVALID_OR_CHANGED');
  demand(time(budget.preparedAt)<=time(budget.lastUpdatedAt)&&time(budget.lastUpdatedAt)<=nowMs,
    'RECOVERY_BUDGET_CLOCK_ROLLBACK');
  reportAuthority(budget.reportAuthorization,quotaDayStart,nowMs,value);
  const unbound=budget.readTime===null&&budget.startedAt===null&&budget.deadlineAt===null;
  if(unbound)demand(['AUTHORIZED','INCOMPLETE'].includes(budget.status)&&budget.recoveryReservedReads===0&&budget.reservations.length===0,
    'RECOVERY_BUDGET_BINDING_INVALID');
  else demand(time(budget.startedAt)>=time(budget.preparedAt)&&time(budget.startedAt)<=nowMs
    &&time(budget.readTime)<=time(budget.startedAt)&&time(budget.startedAt)-time(budget.readTime)<=5000
    &&time(budget.readTime)>time(plan.predecessor.checkpointFinishedAt)
    &&time(budget.deadlineAt)===time(budget.startedAt)+240000,'RECOVERY_BUDGET_BINDING_INVALID');
  demand(budget.status==='COMPLETE'
    ?budget.readTime!==null&&time(budget.captureFinishedAt)>=time(budget.startedAt)
      &&time(budget.captureFinishedAt)<time(budget.deadlineAt)&&time(budget.captureFinishedAt)<=time(budget.lastUpdatedAt)
      &&time(budget.captureFinishedAt)>=time(budget.reservations.at(-1)?.reservedAt??budget.startedAt)
    :budget.captureFinishedAt===null,'RECOVERY_BUDGET_TERMINAL_INVALID');
  let reserved=0,lastTime=time(budget.preparedAt);const requests=new Set();
  for(const [index,row]of budget.reservations.entries()){
    demand(exact(row,ROW_KEYS)&&row.ordinal===index+1&&row.attempt===index+1
      &&['listDocuments','listCollectionIds'].includes(row.operation)&&row.readTime===budget.readTime
      &&SHA.test(row.requestSha256||'')&&!requests.has(row.requestSha256)
      &&row.maximumReads===(row.operation==='listDocuments'?25:1)&&SHA.test(row.observationSha256||''),
      'RECOVERY_BUDGET_RESERVATIONS_INVALID');
    reserved+=row.maximumReads;requests.add(row.requestSha256);
    demand(row.recoveryReservedReads===reserved&&row.cumulativeReservedReads===1342+reserved
      &&time(row.reservedAt)>=lastTime&&time(row.reservedAt)>=time(budget.startedAt)
      &&time(row.reservedAt)<time(budget.deadlineAt)&&time(row.reservedAt)<=time(budget.lastUpdatedAt),
      'RECOVERY_BUDGET_RESERVATIONS_INVALID');lastTime=time(row.reservedAt);
  }
  demand(reserved===budget.recoveryReservedReads&&(!budget.reservations.length||budget.status!=='AUTHORIZED'),
    'RECOVERY_BUDGET_RESERVATIONS_INVALID');
  if(!allowTerminal)demand(!budget.pausedRequiresReview,'RECOVERY_BUDGET_PAUSED_REQUIRES_REVIEW');
  return value;
}
/** Preparation grants no IO, changes no predecessor policy, and debits no reads. */
export function prepareManagementCaptureRecoveryBudget(input) {
  const value=envelope(input),{plan,nowMs,quotaDayStart}=value;
  const reportAuthorization=reportAuthority(value.reportAuthorization,quotaDayStart,nowMs,value),stamp=new Date(nowMs).toISOString();
  return sealBudget({schemaVersion:1,kind:'MANAGEMENT_FA_CAPTURE_RECOVERY_BUDGET',namespace:NAMESPACE,projectId:FA,databaseId:'(default)',
    planSha256:plan.planSha256,predecessorPolicySha256:plan.predecessor.policySha256,sourceAuthorizationSha256:snapshotDigest(value.authorizationEvidence),
    sourceHumanDecisionAt:DECISION,quotaDayStart,dailyReadLimit:45000,appTrafficReserve:5000,metricLagReserve:2000,
    predecessorReservedReads:1342,maximumRecoveryOperationReserve:3000,maximumCumulativeCaptureReserve:6000,
    predecessorPausedRequiresReview:true,predecessorCaptureStatus:'INCOMPLETE',predecessorReadTimeExpired:true,renewalClearsPause:false,
    status:'AUTHORIZED',pausedRequiresReview:false,preparedAt:stamp,lastUpdatedAt:stamp,readTime:null,startedAt:null,deadlineAt:null,captureFinishedAt:null,
    recoveryReservedReads:0,cumulativeReservedReads:1342,reportAuthorization,reservations:[]});
}
function assessment(value,maximumReads,alreadyReserved=false) {
  const {budget,observation,nowMs,quotaDayStart}=value;
  demand(count(maximumReads)&&maximumReads>0&&maximumReads<=3000,'RECOVERY_READ_RESERVATION_INVALID');
  demand(alreadyReserved?budget.recoveryReservedReads>0:budget.recoveryReservedReads+maximumReads<=3000,'RECOVERY_OPERATION_RESERVE_LIMIT');
  demand(observation?.observationSource==='USER_CURRENT_USAGE_HUMAN_REPORT','RECOVERY_HUMAN_REPORT_REQUIRED');
  const auth=budget.reportAuthorization;
  if(auth.kind==='MANAGEMENT_FA_MANUAL_CAPTURE_AUTHORIZATION'){
    const result=assessManagementManualReadApproval({plan:value.plan,authorizationEvidence:value.authorizationEvidence,
      manualControlEvidence:value.manualControlEvidence,observation,nowMs,approval:auth,
      recoveryReservedReads:budget.recoveryReservedReads,maximumReads:alreadyReserved?0:maximumReads,
      legacyReservedReads:value.legacyReservedReads??0});
    return {...result,newRecoveryReservedReads:result.recoveryReservedReads,predecessorReservedReads:1342};
  }
  // A separate ephemeral projection authorizes only this recovery. The paused
  // predecessor object is never spread, unpaused, written, or used for dispatch.
  const projection={schemaVersion:1,projectId:FA,dailyReadLimit:45000,quotaTimeZone:'America/Los_Angeles',
    renewalClearsPause:false,pausedRequiresReview:false,limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08',
    authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',humanDecisionAt:DECISION,appTrafficReserve:5000,metricLagReserve:2000,
    maximumCaptureReserve:6000,reservationQuotaDayStart:quotaDayStart,reservedReads:budget.cumulativeReservedReads-(alreadyReserved?1:0),
    manualReportEvidence:auth.evidenceId,manualReportSha256:auth.evidenceSha256,manualReportAuthorization:auth};
  const result=assessManagementReadBudget({projectId:FA,nowMs,observation,policy:projection,
    maximumReads:alreadyReserved?1:maximumReads,legacyReservedReads:value.legacyReservedReads??0});
  return {...result,totalUsageKnown:false,measuredTotalReads:null,estimatedUpperReads:observation.reads,
    newRecoveryReservedReads:budget.recoveryReservedReads+(alreadyReserved?0:maximumReads),predecessorReservedReads:1342,
    localReservationOnly:true,exactGlobalCutoff:false};
}
/** Preflight never creates a reservation receipt or a new ledger state. */
export function preflightManagementCaptureRecoveryReadBudget(input) {
  const value=validateBudget(input);
  if(value.budget.deadlineAt!==null)demand(value.nowMs<time(value.budget.deadlineAt),'RECOVERY_CAPTURE_DEADLINE');
  return {...assessment(value,value.maximumReads??25),mode:'LOCAL_RECOVERY_PREFLIGHT',reservationPersisted:false,
    firestoreReadsIssued:0,firestoreWritesIssued:0};
}
/** The CLI must durably CAS this single binding before its first read. */
export function bindManagementCaptureRecoveryBudget(input) {
  const value=validateBudget(input),{budget,nowMs,readTime,startedAt,deadlineAt}=value;
  demand(budget.readTime===null&&budget.reservations.length===0&&startedAt===new Date(nowMs).toISOString()
    &&time(readTime)<=nowMs&&nowMs-time(readTime)<=5000&&time(readTime)>time(value.plan.predecessor.checkpointFinishedAt)
    &&time(deadlineAt)===nowMs+240000,'RECOVERY_BUDGET_BINDING_ONCE_REQUIRED');
  return sealBudget({...budget,readTime,startedAt,deadlineAt,lastUpdatedAt:startedAt});
}
/** Pure assessment only. Its proof is unusable without protected journal CAS
 * and a second current-policy/deadline check immediately before dispatch. */
export function assessRecoveryReadBudget(input) {
  const value=validateBudget(input),{budget,reservation,nowMs}=value;
  demand(budget.readTime!==null&&nowMs<time(budget.deadlineAt),'RECOVERY_CAPTURE_DEADLINE');
  const keys=['projectId','databaseId','readTime','operation','attempt','requestSha256','maximumReads'];
  demand(exact(reservation,keys)&&reservation.projectId===FA&&reservation.databaseId==='(default)'
    &&reservation.readTime===budget.readTime&&['listDocuments','listCollectionIds'].includes(reservation.operation)
    &&reservation.attempt===budget.reservations.length+1&&SHA.test(reservation.requestSha256||'')
    &&reservation.maximumReads===(reservation.operation==='listDocuments'?25:1)
    &&!budget.reservations.some(row=>row.requestSha256===reservation.requestSha256),'RECOVERY_READ_RESERVATION_INVALID');
  const result=assessment(value,reservation.maximumReads),stamp=new Date(nowMs).toISOString();
  const row={ordinal:reservation.attempt,attempt:reservation.attempt,operation:reservation.operation,
    readTime:budget.readTime,requestSha256:reservation.requestSha256,maximumReads:reservation.maximumReads,reservedAt:stamp,
    observationSha256:sourceUsageHumanReportObservationSha256(value.observation),
    recoveryReservedReads:result.newRecoveryReservedReads,cumulativeReservedReads:result.reservedReads};
  const nextBudget=sealBudget({...budget,status:'IN_PROGRESS',lastUpdatedAt:stamp,recoveryReservedReads:row.recoveryReservedReads,
    cumulativeReservedReads:row.cumulativeReservedReads,reservations:[...budget.reservations,row]});
  const proof={schemaVersion:1,kind:'MANAGEMENT_FA_RECOVERY_READ_RESERVATION',namespace:NAMESPACE,projectId:FA,
    planSha256:budget.planSha256,predecessorPolicySha256:budget.predecessorPolicySha256,
    beforeBudgetSha256:budget.budgetSha256,afterBudgetSha256:nextBudget.budgetSha256,...row,
    deadlineAt:budget.deadlineAt,reservationPersisted:false,durable:false,exactGlobalCutoff:false,totalUsageKnown:false,
    measuredTotalReads:null,estimatedUpperReads:value.observation.reads};
  return {...result,nextBudget,proof};
}
/** Revalidate a receipt already present in the protected current journal. This
 * creates no debit/proof. A caller's receipt alone never proves persistence. */
export function validateManagementCaptureRecoveryCurrentAdmission(input) {
  const value=validateBudget(input),{budget,proof,nowMs}=value;
  demand(budget.readTime!==null&&nowMs<time(budget.deadlineAt),'RECOVERY_CAPTURE_DEADLINE');
  const last=budget.reservations.at(-1);
  const keys=['schemaVersion','kind','namespace','projectId','planSha256','predecessorPolicySha256',
    'beforeBudgetSha256','afterBudgetSha256',...ROW_KEYS,'deadlineAt','reservationPersisted','durable',
    'exactGlobalCutoff','totalUsageKnown','measuredTotalReads','estimatedUpperReads'];
  demand(last&&exact(proof,keys)&&proof.schemaVersion===1&&proof.kind==='MANAGEMENT_FA_RECOVERY_READ_RESERVATION'
    &&proof.namespace===NAMESPACE&&proof.projectId===FA&&proof.planSha256===budget.planSha256
    &&proof.predecessorPolicySha256===budget.predecessorPolicySha256&&proof.afterBudgetSha256===budget.budgetSha256
    &&SHA.test(proof.beforeBudgetSha256||'')&&ROW_KEYS.every(k=>proof[k]===last[k])
    &&proof.deadlineAt===budget.deadlineAt&&proof.reservationPersisted===false&&proof.durable===false
    &&proof.exactGlobalCutoff===false&&proof.totalUsageKnown===false&&proof.measuredTotalReads===null
    &&proof.estimatedUpperReads===value.observation?.reads
    &&last.observationSha256===sourceUsageHumanReportObservationSha256(value.observation),
    'RECOVERY_CURRENT_RESERVATION_NOT_PINNED');
  const priorRows=budget.reservations.slice(0,-1);
  const before=sealBudget({...budget,status:priorRows.length?'IN_PROGRESS':'AUTHORIZED',
    lastUpdatedAt:priorRows.at(-1)?.reservedAt??budget.startedAt,
    recoveryReservedReads:budget.recoveryReservedReads-last.maximumReads,
    cumulativeReservedReads:budget.cumulativeReservedReads-last.maximumReads,reservations:priorRows});
  demand(before.budgetSha256===proof.beforeBudgetSha256,'RECOVERY_CURRENT_RESERVATION_NOT_PINNED');
  return {...assessment(value,1,true),mode:'LOCAL_RECOVERY_CURRENT_ADMISSION',reservationPersisted:false,
    additionalReservedReads:0,requiresProtectedJournalVerification:true};
}
/** Terminal records keep all debits and require review; they cannot be rearmed.
 * COMPLETE requires the actual core finishedAt from a validated final packet.
 * Local sealing may finish later; no dispatch deadline is ever extended. */
export function finishManagementCaptureRecoveryBudget(input) {
  const value=validateBudget(input,{allowTerminal:true}),{budget,nowMs,status}=value;
  demand(['COMPLETE','INCOMPLETE'].includes(status)&&!budget.pausedRequiresReview,'RECOVERY_BUDGET_TERMINAL_INVALID');
  if(status==='COMPLETE')demand(budget.readTime!==null&&budget.reservations.length>0
    &&time(value.captureFinishedAt)>=time(budget.startedAt)&&time(value.captureFinishedAt)<time(budget.deadlineAt)
    &&time(value.captureFinishedAt)<=nowMs&&time(value.captureFinishedAt)>=time(budget.reservations.at(-1).reservedAt),'RECOVERY_CAPTURE_DEADLINE');
  return sealBudget({...budget,status,pausedRequiresReview:true,lastUpdatedAt:new Date(nowMs).toISOString(),
    captureFinishedAt:status==='COMPLETE'?value.captureFinishedAt:null});
}
