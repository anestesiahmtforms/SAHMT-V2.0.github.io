import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {firestoreQuotaDayStart,sourceUsageHumanReportTextSha256,sourceUsageHumanReportObservationSha256} from '../scripts/lib/management-read-budget.js';
import {MANAGEMENT_CAPTURE_RECOVERY_AUTHORIZATION} from '../scripts/lib/management-capture-recovery-plan.js';
import {prepareManagementCaptureRecoveryBudget,preflightManagementCaptureRecoveryReadBudget,bindManagementCaptureRecoveryBudget,
  assessRecoveryReadBudget,validateManagementCaptureRecoveryCurrentAdmission,finishManagementCaptureRecoveryBudget} from '../scripts/lib/management-capture-recovery-budget.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const stamp='2026-10-09T15:45:03.000Z', nowMs=Date.parse(stamp), day=firestoreQuotaDayStart(nowMs);
const oldReadTime='2026-10-09T14:44:36.804Z', oldFinished='2026-10-09T15:44:36.900Z';
const clone=value=>structuredClone(value);
function resealBudget(value){const {budgetSha256,...body}=value;return {...body,budgetSha256:snapshotDigest(body)};}
function resealPlan(value){const {planSha256,...body}=value;return {...body,planSha256:snapshotDigest(body)};}
function fixture(){
  const predecessorPolicy={schemaVersion:1,projectId:'sahmt-17a16',dailyReadLimit:45000,
    limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08',quotaTimeZone:'America/Los_Angeles',
    reservationQuotaDayStart:day,renewalClearsPause:false,pausedRequiresReview:true,pauseReason:'CHECKPOINT_TIMEOUT',
    authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',humanDecisionAt:'2026-10-09T15:12:31.000Z',
    maximumCaptureReserve:6000,reservedReads:1342,appTrafficReserve:5000,metricLagReserve:2000};
  const scope={schemaVersion:1,projectId:'sahmt-17a16',databaseId:'(default)',scope:'SELECTED_COLLECTION_TREES_WITH_IDENTITY_DEPENDENCIES',rootCollections:Array.from({length:43},(_,i)=>'root'+i)};
  const authorizationEvidence=clone(MANAGEMENT_CAPTURE_RECOVERY_AUTHORIZATION);
  const planBody={schemaVersion:1,kind:'MANAGEMENT_FRESH_CONSISTENT_RECOVERY_CAPTURE',namespace:'FA-rec1',
    sourceProjectId:'sahmt-17a16',databaseId:'(default)',createdAt:'2026-10-09T15:45:00.000Z',
    predecessor:{headSha256:'a'.repeat(64),checkpointSha256:'b'.repeat(64),quarterPlanSha256:'c'.repeat(64),
      scopeSha256:snapshotDigest(scope),policySha256:snapshotDigest(predecessorPolicy),originalReadTime:oldReadTime,
      checkpointFinishedAt:oldFinished,reservedReads:1342,sequenceId:'synthetic-old-sequence',batchNumber:4,
      status:'INCOMPLETE',errorCode:'CHECKPOINT_TIMEOUT',documents:365,completedCollections:43,
      completedDiscoveryParents:151,pendingDiscoveryParents:214,attempts:206},authority:authorizationEvidence,
    quota:{quotaDayStart:day,dailyReadLimit:45000,appTrafficReserve:5000,metricLagReserve:2000,
      predecessorReservedReads:1342,newCaptureReservationLimit:3000,cumulativeReadReservationLimit:6000},
    captureConfiguration:{projectId:'sahmt-17a16',databaseId:'(default)',rootCollections:scope.rootCollections,
      pageSize:25,collectionPageSize:100,limits:{maxPages:3000,maxDocuments:6000,maxDepth:30,maxBytes:12*1024*1024,
        maxDurationMs:240000,requestTimeoutMs:20000}},automaticRetry:false,implicitResume:false,
    oldArtifactsMutable:false,oldDocumentsUsedInNewSnapshot:false,productionActivation:false};
  const plan={...planBody,planSha256:snapshotDigest(planBody)};
  const reportedText='SYNTHETIC: current displayed source estimate 3000', evidenceId='synthetic-recovery-numeric-report';
  const reportedAt='2026-10-09T15:45:01.000Z',reviewedAt='2026-10-09T15:45:02.000Z';
  const evidenceSha256=sourceUsageHumanReportTextSha256(reportedText);
  const observation={observationSource:'USER_CURRENT_USAGE_HUMAN_REPORT',project:'sahmt-17a16',quotaDayStart:day,
    reportedAt,reviewedAt,periodStart:day,periodKind:'CURRENT_FA_QUOTA_DAY_TO_REPORT',reportedReads:3000,reads:4000,
    reportedText,evidenceId,evidenceSha256,exactGlobalCutoff:false,totalUsageKnown:false,measuredTotalReads:null,
    reportProvenance:{schemaVersion:1,source:'HUMAN_USER_MESSAGE_TEXT',humanMessageId:'synthetic-later-numeric-message',
      evidenceId,evidenceSha256,reportedAt}};
  const reportAuthorization={schemaVersion:1,authorized:true,authorizationSource:'EXPLICIT_HUMAN_FA_QUARTER_CAPTURE_REVIEW',
    authorizationId:'synthetic-recovery-report-admission',humanDecisionMessageId:'synthetic-original-all-remaining-message',
    projectId:'sahmt-17a16',authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',dailyReadLimit:45000,quotaDayStart:day,
    approvedAt:'2026-10-09T15:12:31.000Z',reviewedAt,reportedAt,evidenceId,evidenceSha256,
    observationSha256:sourceUsageHumanReportObservationSha256(observation),reportHumanMessageId:observation.reportProvenance.humanMessageId,
    reportSource:'HUMAN_USER_MESSAGE_TEXT',maximumCaptureReserve:6000};
  const input={plan,predecessorPolicy,authorizationEvidence,reportAuthorization,observation,nowMs};
  return {...input,budget:prepareManagementCaptureRecoveryBudget(input)};
}
function boundFixture(){
  const f=fixture(),startedAt='2026-10-09T15:45:04.000Z';
  f.nowMs=Date.parse(startedAt);
  f.budget=bindManagementCaptureRecoveryBudget({...f,readTime:stamp,startedAt,deadlineAt:'2026-10-09T15:49:04.000Z'});
  return f;
}
function reserve(f,operation='listDocuments',requestSha256){
  const attempt=f.budget.reservations.length+1;
  const reservation={projectId:'sahmt-17a16',databaseId:'(default)',readTime:f.budget.readTime,operation,attempt,
    requestSha256:requestSha256??sha(operation+attempt),maximumReads:operation==='listDocuments'?25:1};
  return assessRecoveryReadBudget({...f,reservation});
}
function withReservation(){const f=boundFixture(),r=reserve(f);return {...f,budget:r.nextBudget,proof:r.proof};}

test('pure preparation carries 1342 and keeps predecessor pause, expiry and incomplete flags',()=>{
  const f=fixture(),before=JSON.stringify(f),result=preflightManagementCaptureRecoveryReadBudget(f);
  assert.equal(f.budget.cumulativeReservedReads,1342);assert.equal(f.budget.recoveryReservedReads,0);
  assert.equal(f.budget.predecessorPausedRequiresReview,true);assert.equal(f.budget.predecessorReadTimeExpired,true);
  assert.equal(f.budget.predecessorCaptureStatus,'INCOMPLETE');assert.equal(f.predecessorPolicy.pausedRequiresReview,true);
  assert.equal(result.estimatedUpperReads,4000);assert.equal(result.measuredTotalReads,null);assert.equal(result.totalUsageKnown,false);
  assert.equal(result.exactGlobalCutoff,false);assert.equal(result.reservationPersisted,false);assert.equal('nextBudget'in result,false);
  assert.equal(JSON.stringify(f),before);
});
test('bound reservation pins request and new epoch without changing original authority timestamp',()=>{
  const f=boundFixture(),before=JSON.stringify(f),r=reserve(f);
  assert.equal(r.nextBudget.recoveryReservedReads,25);assert.equal(r.nextBudget.cumulativeReservedReads,1367);
  assert.equal(r.nextBudget.sourceHumanDecisionAt,'2026-10-09T15:12:31.000Z');assert.equal(r.nextBudget.readTime,stamp);
  assert.equal(r.proof.beforeBudgetSha256,f.budget.budgetSha256);assert.equal(r.proof.afterBudgetSha256,r.nextBudget.budgetSha256);
  assert.equal(r.proof.durable,false);assert.equal(r.proof.reservationPersisted,false);assert.equal(r.proof.estimatedUpperReads,4000);
  assert.equal(r.estimatedWithMargin,12367);assert.equal(JSON.stringify(f),before);
});
test('already reserved admission rechecks freshness and margin without new debit',()=>{
  const f=withReservation(),before=JSON.stringify(f),r=validateManagementCaptureRecoveryCurrentAdmission(f);
  assert.equal(r.reservedReads,1367);assert.equal(r.newRecoveryReservedReads,25);assert.equal(r.additionalReservedReads,0);
  assert.equal(r.estimatedWithMargin,12367);assert.equal(r.requiresProtectedJournalVerification,true);
  assert.equal('nextBudget'in r,false);assert.equal(JSON.stringify(f),before);
});
test('120 pages reach new cap3000, current admission still works, next attempt is denied',()=>{
  const f=boundFixture();let proof;
  for(let i=0;i<120;i++){const r=reserve(f);f.budget=r.nextBudget;proof=r.proof;}
  assert.equal(f.budget.recoveryReservedReads,3000);assert.equal(f.budget.cumulativeReservedReads,4342);
  assert.equal(validateManagementCaptureRecoveryCurrentAdmission({...f,proof}).reservedReads,4342);
  assert.throws(()=>reserve(f,'listCollectionIds'),/RECOVERY_OPERATION_RESERVE_LIMIT/);
});
test('discovery uses one read and subsequent reservations retain both debits',()=>{
  const f=boundFixture(),a=reserve(f,'listCollectionIds');f.budget=a.nextBudget;
  const b=reserve(f);assert.equal(b.nextBudget.recoveryReservedReads,26);assert.equal(b.nextBudget.cumulativeReservedReads,1368);
  assert.equal(b.nextBudget.reservations.length,2);
  assert.equal(validateManagementCaptureRecoveryCurrentAdmission({...f,budget:b.nextBudget,proof:b.proof}).reservedReads,1368);
});
for(const [label,mutate]of [
  ['source project',f=>{f.plan=resealPlan({...f.plan,sourceProjectId:'sahmt-gestao-5ae66'});}],
  ['namespace',f=>{f.plan=resealPlan({...f.plan,namespace:'FA-rec2'});}],
  ['copy purpose',f=>{f.authorizationEvidence.authorizedPurpose='USER_AUTHORIZED_BOUNDED_FB_MIGRATION';}],
  ['original timestamp',f=>{f.authorizationEvidence.sourceHumanDecisionAt='2026-10-09T15:45:00.000Z';}],
  ['source quote',f=>{f.authorizationEvidence.sourceMessage.text+=' another instruction';}],
  ['predecessor hash',f=>{f.predecessorPolicy.reservedReads=0;}],
  ['old pause cleared',f=>{f.predecessorPolicy.pausedRequiresReview=false;}],
  ['old error cleared',f=>{f.predecessorPolicy.pauseReason='READY';}],
  ['new cap raised',f=>{f.plan=resealPlan({...f.plan,quota:{...f.plan.quota,newCaptureReservationLimit:4658}});}],
  ['total cap reset',f=>{f.plan=resealPlan({...f.plan,quota:{...f.plan.quota,cumulativeReadReservationLimit:7658}});}],
  ['app margin reduced',f=>{f.plan=resealPlan({...f.plan,quota:{...f.plan.quota,appTrafficReserve:4999}});}],
  ['lag margin reduced',f=>{f.plan=resealPlan({...f.plan,quota:{...f.plan.quota,metricLagReserve:1999}});}],
  ['old expiry ignored',f=>{f.plan=resealPlan({...f.plan,predecessor:{...f.plan.predecessor,originalReadTime:'2026-10-09T15:44:30.000Z'}});}],
  ['implicit retry',f=>{f.plan=resealPlan({...f.plan,automaticRetry:true});}],
  ['old rows reused',f=>{f.plan=resealPlan({...f.plan,oldDocumentsUsedInNewSnapshot:true});}]
]) test('recovery denies '+label+' without changing input',()=>{const f=fixture();mutate(f);const before=JSON.stringify(f);assert.throws(()=>preflightManagementCaptureRecoveryReadBudget(f));assert.equal(JSON.stringify(f),before);});
for(const [label,mutate]of [
  ['reported text altered',f=>{f.observation.reportedText+=' altered';}],
  ['reported count altered',f=>{f.observation.reportedReads=3400;}],
  ['measured total fabricated',f=>{f.observation.measuredTotalReads=4000;}],
  ['exact cutoff fabricated',f=>{f.observation.exactGlobalCutoff=true;}],
  ['wrong provenance',f=>{f.observation.reportProvenance.source='AGENT_SCREENSHOT';}],
  ['metric replaces report',f=>{f.observation={project:'sahmt-17a16',reads:4000,metric:'firestore.googleapis.com/document/read_ops_count',verifiedAt:stamp,latestPoint:stamp,fresh:true,complete:true};}],
  ['future report',f=>{f.observation.reportedAt='2026-10-09T15:46:00.000Z';}],
  ['stale report',f=>{f.nowMs=Date.parse(f.observation.reportedAt)+300001;}],
  ['FB report',f=>{f.observation.project='sahmt-gestao-5ae66';}],
  ['LA day changed',f=>{f.nowMs=Date.parse('2026-10-10T07:00:00.000Z');}],
  ['fake manual approval',f=>{f.budget=resealBudget({...f.budget,reportAuthorization:{...f.budget.reportAuthorization,authorizationSource:'CLIENT_SELF_DECLARED'}});}],
  ['report reapproved at present',f=>{f.budget=resealBudget({...f.budget,reportAuthorization:{...f.budget.reportAuthorization,approvedAt:stamp}});}],
  ['current estimate not conservative',f=>{f.observation.reads=3000;}]
]) test('report gate denies '+label,()=>{const f=fixture();mutate(f);assert.throws(()=>preflightManagementCaptureRecoveryReadBudget(f));});
test('five-minute boundary applies to actual report receipt, never preparation or review time',()=>{
  const f=fixture();f.nowMs=Date.parse(f.observation.reportedAt)+300000;
  assert.equal(preflightManagementCaptureRecoveryReadBudget(f).allowed,true);f.nowMs++;
  assert.throws(()=>preflightManagementCaptureRecoveryReadBudget(f),/HUMAN_REPORT_INVALID_OR_EXPIRED/);
});
test('existing legacy debit and app margin are counted; high current display is denied',()=>{
  const f=fixture();assert.equal(preflightManagementCaptureRecoveryReadBudget({...f,legacyReservedReads:1000}).estimatedWithMargin,13367);
  assert.throws(()=>preflightManagementCaptureRecoveryReadBudget({...f,legacyReservedReads:40000}),/DAILY_LIMIT_OR_MARGIN/);
  assert.throws(()=>preflightManagementCaptureRecoveryReadBudget({...f,legacyReservedReads:-1}),/RESERVES_INVALID/);
});
for(const [label,mutate]of [
  ['paused current budget',f=>{f.budget=finishManagementCaptureRecoveryBudget({...f,status:'INCOMPLETE'});}],
  ['counter reset',f=>{f.budget=resealBudget({...f.budget,recoveryReservedReads:0,cumulativeReservedReads:1342});}],
  ['reserved row deleted',f=>{f.budget=resealBudget({...f.budget,reservations:[]});}],
  ['predecessor floor removed',f=>{f.budget=resealBudget({...f.budget,predecessorReservedReads:0});}],
  ['old pause flag removed',f=>{f.budget=resealBudget({...f.budget,predecessorPausedRequiresReview:false});}],
  ['old expiry flag removed',f=>{f.budget=resealBudget({...f.budget,predecessorReadTimeExpired:false});}],
  ['old capture upgraded',f=>{f.budget=resealBudget({...f.budget,predecessorCaptureStatus:'COMPLETE'});}],
  ['new cap reset4658',f=>{f.budget=resealBudget({...f.budget,maximumRecoveryOperationReserve:4658});}],
  ['deadline extended',f=>{f.budget=resealBudget({...f.budget,deadlineAt:'2026-10-09T15:49:05.000Z'});}],
  ['reserved request changed',f=>{f.budget=resealBudget({...f.budget,reservations:[{...f.budget.reservations[0],requestSha256:'f'.repeat(64)}]});}],
  ['proof persisted flag fabricated',f=>{f.proof.reservationPersisted=true;}],
  ['proof durable flag fabricated',f=>{f.proof.durable=true;}],
  ['old receipt hash',f=>{f.proof.afterBudgetSha256='f'.repeat(64);}]
]) test('current admission denies '+label+' even after hash recomputation',()=>{const f=withReservation();mutate(f);assert.throws(()=>validateManagementCaptureRecoveryCurrentAdmission(f));});
test('one-time binding rejects timestamp switch, old readTime, stale start and deadline extension',()=>{
  const f=boundFixture();assert.throws(()=>bindManagementCaptureRecoveryBudget({...f,readTime:stamp,startedAt:new Date(f.nowMs).toISOString(),deadlineAt:f.budget.deadlineAt}),/BINDING_ONCE/);
  for(const overrides of [{readTime:oldReadTime},{readTime:'2026-10-09T15:45:04.001Z'},
    {readTime:'2026-10-09T15:44:58.999Z'},{startedAt:stamp},{deadlineAt:'2026-10-09T15:49:05.000Z'}]){
    const x=fixture(),bindingNow=Date.parse('2026-10-09T15:45:04.000Z');
    assert.throws(()=>bindManagementCaptureRecoveryBudget({...x,nowMs:bindingNow,readTime:stamp,
      startedAt:'2026-10-09T15:45:04.000Z',deadlineAt:'2026-10-09T15:49:04.000Z',...overrides}),/BINDING_ONCE/);
  }
});
test('request replay, wrong operation cost, skipped attempt and cross-project IO are rejected',()=>{
  const f=withReservation(),valid={projectId:'sahmt-17a16',databaseId:'(default)',readTime:stamp,
    operation:'listDocuments',attempt:2,requestSha256:sha('next'),maximumReads:25};
  for(const mutate of [r=>{r.attempt=1;},r=>{r.requestSha256=f.proof.requestSha256;},r=>{r.maximumReads=1;},
    r=>{r.projectId='sahmt-gestao-5ae66';},r=>{r.databaseId='other';},r=>{r.readTime=oldReadTime;},
    r=>{r.operation='writeDocuments';},r=>{r.budgetAllowed=true;}]){
    const r=clone(valid);mutate(r);assert.throws(()=>assessRecoveryReadBudget({...f,reservation:r}),/READ_RESERVATION_INVALID/);
  }
});
test('fixed deadline denies admission and new reservations exactly at expiration',()=>{
  const f=withReservation();f.nowMs=Date.parse(f.budget.deadlineAt);
  assert.throws(()=>reserve(f,'listCollectionIds'),/DEADLINE/);
  assert.throws(()=>validateManagementCaptureRecoveryCurrentAdmission(f),/DEADLINE/);
});
test('clock rollback before the persisted current receipt is denied',()=>{
  const f=withReservation();f.nowMs--;assert.throws(()=>validateManagementCaptureRecoveryCurrentAdmission(f),/CLOCK_ROLLBACK/);
});
test('local terminal completion can seal later, pins actual earlier finishedAt, and never reopens deadline',()=>{
  const f=withReservation(),before=clone(f.predecessorPolicy),captureFinishedAt='2026-10-09T15:49:03.000Z';
  f.nowMs=Date.parse('2026-10-09T15:49:10.000Z');
  const closed=finishManagementCaptureRecoveryBudget({...f,status:'COMPLETE',captureFinishedAt});
  assert.equal(closed.captureFinishedAt,captureFinishedAt);assert.equal(closed.pausedRequiresReview,true);
  assert.equal(closed.recoveryReservedReads,25);assert.equal(closed.cumulativeReservedReads,1367);
  assert.deepEqual(f.predecessorPolicy,before);assert.throws(()=>reserve({...f,budget:closed}),/PAUSED/);
  assert.throws(()=>finishManagementCaptureRecoveryBudget({...f,budget:closed,status:'COMPLETE',captureFinishedAt}),/TERMINAL/);
  assert.throws(()=>finishManagementCaptureRecoveryBudget({...f,status:'COMPLETE',captureFinishedAt:f.budget.deadlineAt}),/DEADLINE/);
});
test('failed or unbound invocation closes without refund and cannot be rearmed',()=>{
  const f=withReservation(),closed=finishManagementCaptureRecoveryBudget({...f,status:'INCOMPLETE'});
  assert.equal(closed.cumulativeReservedReads,1367);assert.equal(closed.captureFinishedAt,null);assert.equal(closed.pausedRequiresReview,true);
  assert.throws(()=>reserve({...f,budget:closed}),/PAUSED/);
  const unbound=fixture(),stopped=finishManagementCaptureRecoveryBudget({...unbound,status:'INCOMPLETE'});
  assert.equal(stopped.cumulativeReservedReads,1342);assert.throws(()=>preflightManagementCaptureRecoveryReadBudget({...unbound,budget:stopped}),/PAUSED/);
});
test('getters and undefined client fields are rejected without invoking user code',()=>{
  const f=fixture();let invoked=false;Object.defineProperty(f.budget,'claim',{get(){invoked=true;throw Error('secret');},enumerable:true});
  assert.throws(()=>preflightManagementCaptureRecoveryReadBudget(f));assert.equal(invoked,false);
  const u=fixture();u.extra=undefined;assert.throws(()=>preflightManagementCaptureRecoveryReadBudget(u),/INPUT_INVALID/);
});


test('terminal completion cannot claim a time before its final reserved attempt',()=>{
  const f=boundFixture();f.nowMs+=1000;const r=reserve(f);f.budget=r.nextBudget;
  assert.throws(()=>finishManagementCaptureRecoveryBudget({...f,status:'COMPLETE',captureFinishedAt:f.budget.startedAt}),/DEADLINE/);
  assert.throws(()=>finishManagementCaptureRecoveryBudget({...f,status:'COMPLETE'}),/TIME_INVALID/);
  const closed=finishManagementCaptureRecoveryBudget({...f,status:'COMPLETE',captureFinishedAt:new Date(f.nowMs).toISOString()});
  assert.equal(closed.captureFinishedAt,f.budget.reservations.at(-1).reservedAt);
});
