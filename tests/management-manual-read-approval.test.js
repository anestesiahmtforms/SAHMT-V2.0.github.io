import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {MANAGEMENT_CAPTURE_RECOVERY_AUTHORIZATION as authorizationEvidence} from '../scripts/lib/management-capture-recovery-plan.js';
import {sourceUsageHumanReportObservationSha256} from '../scripts/lib/management-read-budget.js';
let api;try{api=await import('../scripts/lib/management-manual-read-approval.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const library=()=>{assert.ok(api,'manual read approval implementation is missing');return api;};
const clone=value=>structuredClone(value),hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const NOW=Date.parse('2026-10-09T19:20:00.000Z'),DAY='2026-10-09T07:00:00.000Z';
const TEXT='não quero nenhuma janela de segurança , vou autorizando a leitura manualmente. pois estã atrazando tuso\n';
function fixture(){
  const manualControlEvidence={schemaVersion:1,source:'EXPLICIT_HUMAN_MESSAGE',humanMessageId:'synthetic-manual-control',
    recordedAt:'2026-10-09T19:14:30.000Z',text:TEXT,textSha256:hash(TEXT)};
  const observation={observationSource:'USER_CURRENT_USAGE_HUMAN_REPORT',project:'sahmt-17a16',quotaDayStart:DAY,
    reportedAt:'2026-10-09T18:54:13.000Z',reviewedAt:'2026-10-09T19:20:00.000Z',periodStart:DAY,
    periodKind:'CURRENT_FA_QUOTA_DAY_TO_REPORT',reportedReads:3300,reads:4000,reportedText:'3,3 mil',
    evidenceId:'synthetic-historical-report',evidenceSha256:hash('3,3 mil'),exactGlobalCutoff:false,totalUsageKnown:false,
    measuredTotalReads:null,reportProvenance:{schemaVersion:1,source:'HUMAN_USER_MESSAGE_TEXT',humanMessageId:'synthetic-report',
      evidenceId:'synthetic-historical-report',evidenceSha256:hash('3,3 mil'),reportedAt:'2026-10-09T18:54:13.000Z'}};
  const body={schemaVersion:1,kind:'MANAGEMENT_FRESH_CONSISTENT_RECOVERY_CAPTURE',namespace:'FA-rec1',sourceProjectId:'sahmt-17a16',
    databaseId:'(default)',createdAt:'2026-10-09T16:00:00.000Z',predecessor:{policySha256:'a'.repeat(64),reservedReads:1342},
    authority:clone(authorizationEvidence),quota:{quotaDayStart:DAY,dailyReadLimit:45000,appTrafficReserve:5000,metricLagReserve:2000,
      predecessorReservedReads:1342,newCaptureReservationLimit:3000,cumulativeReadReservationLimit:6000},
    captureConfiguration:{projectId:'sahmt-17a16',databaseId:'(default)',rootCollections:Array.from({length:43},(_,i)=>'root'+i),
      pageSize:25,collectionPageSize:100,limits:{maxPages:3000,maxDocuments:6000,maxDepth:30,maxBytes:12*1024*1024,maxDurationMs:240000,requestTimeoutMs:20000}},
    automaticRetry:false,implicitResume:false,oldArtifactsMutable:false,oldDocumentsUsedInNewSnapshot:false,productionActivation:false};
  return {plan:{...body,planSha256:snapshotDigest(body)},authorizationEvidence:clone(authorizationEvidence),manualControlEvidence,observation,nowMs:NOW};
}
const resealPlan=input=>{const {planSha256,...body}=input.plan;input.plan.planSha256=snapshotDigest(body);};
const approve=input=>library().prepareManagementManualReadApproval(input);
function changedObservation(input,reportedReads,reportedText){input.observation.reportedReads=reportedReads;
  input.observation.reads=(Math.floor(reportedReads/1000)+1)*1000;input.observation.reportedText=reportedText;
  input.observation.evidenceSha256=hash(reportedText);input.observation.reportProvenance.evidenceSha256=hash(reportedText);}

test('same-day manual consent accepts a historical report older than five minutes without labeling it current',()=>{
  const input=fixture(),before=snapshotDigest(input),approval=approve(input);
  assert.equal(approval.kind,'MANAGEMENT_FA_MANUAL_CAPTURE_AUTHORIZATION');assert.equal(approval.maximumAttempts,1);
  assert.equal(approval.namespace,'FA-rec1');assert.equal(approval.planSha256,input.plan.planSha256);
  assert.equal(approval.historicalUsage.reportedAt,'2026-10-09T18:54:13.000Z');assert.equal(approval.historicalUsage.estimatedUpperReads,4000);
  assert.equal(approval.historicalUsage.observationSha256,sourceUsageHumanReportObservationSha256(input.observation));
  assert.equal(approval.observationCurrent,false);assert.equal(approval.totalUsageKnown,false);assert.equal(approval.measuredTotalReads,null);
  assert.equal(approval.temporalExpiryMinutes,null);assert.equal(approval.automaticRetry,false);assert.equal(approval.automaticResume,false);
  assert.equal(approval.renewalClearsPause,false);assert.equal(approval.exactGlobalCutoff,false);
  const {approvalSha256,...body}=approval;assert.equal(approvalSha256,snapshotDigest(body));assert.equal(snapshotDigest(input),before);
  assert.ok(Object.isFrozen(approval));assert.ok(Object.isFrozen(approval.historicalUsage));
});

test('manual consent remains valid later in the same LA day without re-dating report or approval',()=>{
  const input=fixture(),approval=approve(input),later={...input,approval,nowMs:Date.parse('2026-10-10T06:59:59.999Z')};
  assert.deepEqual(library().validateManagementManualReadApproval(later),approval);
  const result=library().assessManagementManualReadApproval({...later,recoveryReservedReads:50,maximumReads:25,legacyReservedReads:10});
  assert.equal(result.reservedReads,1417);assert.equal(result.recoveryReservedReads,75);assert.equal(result.estimatedWithMargin,12427);
  assert.equal(result.remainingAfterMargin,32573);assert.equal(result.additionalReservedReads,25);assert.equal(result.requiresDurableReservation,true);
  assert.equal(result.observationCurrent,false);assert.equal(result.measuredTotalReads,null);
});

test('current admission maximumReads zero retains prior debits without creating another reservation',()=>{
  const input=fixture(),approval=approve(input),result=library().assessManagementManualReadApproval({...input,approval,
    recoveryReservedReads:50,maximumReads:0,legacyReservedReads:10});
  assert.equal(result.recoveryReservedReads,50);assert.equal(result.reservedReads,1392);assert.equal(result.additionalReservedReads,0);
  assert.equal(result.estimatedWithMargin,12402);assert.equal(result.requiresDurableReservation,true);
  assert.throws(()=>library().assessManagementManualReadApproval({...input,approval,recoveryReservedReads:0,maximumReads:0,legacyReservedReads:0}),
    /MANUAL_READ_EXISTING_RESERVATION_REQUIRED/);
});

test('numeric report values are generic historical estimates, never hardcoded private conversation values',()=>{
  for(const [reportedReads,text,upper]of [[0,'0',1000],[3000,'3 mil',4000],[4000,'4 mil',5000]]){
    const input=fixture();changedObservation(input,reportedReads,text);input.manualControlEvidence.humanMessageId='different-trusted-message';
    input.manualControlEvidence.recordedAt='2026-10-09T19:18:00.000Z';
    assert.equal(approve(input).historicalUsage.estimatedUpperReads,upper);
  }
});

for(const [name,mutate,code]of [
  ['next LA quota day',i=>{i.nowMs=Date.parse('2026-10-10T07:00:00.000Z');},'QUOTA_DAY_CHANGED'],
  ['future control decision',i=>{i.manualControlEvidence.recordedAt='2026-10-09T19:21:00.000Z';},'CONTROL_EVIDENCE_INVALID'],
  ['control from yesterday',i=>{i.manualControlEvidence.recordedAt='2026-10-08T19:14:30.000Z';},'CONTROL_EVIDENCE_INVALID'],
  ['unauthorized control text',i=>{i.manualControlEvidence.text='run anything';i.manualControlEvidence.textSha256=hash('run anything');},'CONTROL_EVIDENCE_INVALID'],
  ['wrong control hash',i=>{i.manualControlEvidence.textSha256='b'.repeat(64);},'CONTROL_EVIDENCE_INVALID'],
  ['boolean control bypass',i=>{i.manualControlEvidence.authorized=true;},'CONTROL_EVIDENCE_INVALID'],
  ['wrong control source',i=>{i.manualControlEvidence.source='ASSISTANT_NOTE';},'CONTROL_EVIDENCE_INVALID'],
  ['future report',i=>{i.observation.reportedAt='2026-10-09T19:21:00.000Z';i.observation.reportProvenance.reportedAt=i.observation.reportedAt;},'OBSERVATION_INVALID'],
  ['future review',i=>{i.observation.reviewedAt='2026-10-09T19:21:00.000Z';},'OBSERVATION_INVALID'],
  ['wrong report project',i=>{i.observation.project='sahmt-gestao-5ae66';},'OBSERVATION_INVALID'],
  ['wrong report day',i=>{i.observation.quotaDayStart='2026-10-08T07:00:00.000Z';},'OBSERVATION_INVALID'],
  ['redated numeric timestamp',i=>{i.observation.reportProvenance.reportedAt='2026-10-09T19:20:00.000Z';},'OBSERVATION_INVALID'],
  ['forged report hash',i=>{i.observation.evidenceSha256='b'.repeat(64);},'OBSERVATION_INVALID'],
  ['understated upper bound',i=>{i.observation.reads=3300;},'OBSERVATION_INVALID'],
  ['claims measurement',i=>{i.observation.measuredTotalReads=3300;},'OBSERVATION_INVALID'],
  ['claims freshness',i=>{i.observation.fresh=true;},'OBSERVATION_INVALID'],
  ['claims current total',i=>{i.observation.totalUsageKnown=true;},'OBSERVATION_INVALID'],
  ['extra source authorization',i=>{i.authorizationEvidence.bypass=true;},'SOURCE_AUTHORIZATION_INVALID'],
  ['redated original authorization',i=>{i.authorizationEvidence.sourceHumanDecisionAt='2026-10-09T19:20:00.000Z';},'SOURCE_AUTHORIZATION_INVALID'],
  ['wrong source project',i=>{i.plan.sourceProjectId='sahmt-gestao-5ae66';resealPlan(i);},'PLAN_INVALID'],
  ['different namespace',i=>{i.plan.namespace='FA-rec2';resealPlan(i);},'PLAN_INVALID'],
  ['automatic retry plan',i=>{i.plan.automaticRetry=true;resealPlan(i);},'PLAN_INVALID'],
  ['implicit resume plan',i=>{i.plan.implicitResume=true;resealPlan(i);},'PLAN_INVALID'],
  ['writes enabled plan',i=>{i.plan.productionActivation=true;resealPlan(i);},'PLAN_INVALID'],
  ['old artifacts mutable',i=>{i.plan.oldArtifactsMutable=true;resealPlan(i);},'PLAN_INVALID'],
  ['daily limit increase',i=>{i.plan.quota.dailyReadLimit=50000;resealPlan(i);},'PLAN_INVALID'],
  ['reduced app reserve',i=>{i.plan.quota.appTrafficReserve=0;resealPlan(i);},'PLAN_INVALID'],
  ['reduced lag reserve',i=>{i.plan.quota.metricLagReserve=0;resealPlan(i);},'PLAN_INVALID'],
  ['old debit refunded',i=>{i.plan.quota.predecessorReservedReads=0;resealPlan(i);},'PLAN_INVALID'],
  ['new reserve raised',i=>{i.plan.quota.newCaptureReservationLimit=6000;resealPlan(i);},'PLAN_INVALID'],
  ['cumulative reserve raised',i=>{i.plan.quota.cumulativeReadReservationLimit=9000;resealPlan(i);},'PLAN_INVALID'],
  ['technical duration raised',i=>{i.plan.captureConfiguration.limits.maxDurationMs=600000;resealPlan(i);},'PLAN_INVALID'],
])test('manual authorization rejects '+name,()=>{const input=fixture();mutate(input);assert.throws(()=>approve(input),new RegExp('MANUAL_READ_'+code));});

for(const [name,mutate]of [
  ['approval hash',a=>{a.approvalSha256='b'.repeat(64);}],['extra bypass',a=>{a.bypass=true;}],
  ['multiple attempts',a=>{a.maximumAttempts=2;}],['time expiry mode replaced',a=>{a.temporalExpiryMinutes=5;}],
  ['historical report timestamp',a=>{a.historicalUsage.reportedAt='2026-10-09T19:20:00.000Z';}],
  ['approval pause renewal',a=>{a.renewalClearsPause=true;}]
])test('validation rejects changed '+name,()=>{const input=fixture(),approval=clone(approve(input));mutate(approval);
  assert.throws(()=>library().validateManagementManualReadApproval({...input,approval}),/MANUAL_READ_APPROVAL_INVALID_OR_CHANGED/);});

test('valid original approval cannot be reused with a resealed different plan',()=>{
  const input=fixture(),approval=approve(input);input.plan.predecessor.policySha256='b'.repeat(64);resealPlan(input);
  assert.throws(()=>library().validateManagementManualReadApproval({...input,approval}),/MANUAL_READ_APPROVAL_INVALID_OR_CHANGED/);
});

test('re-reading historical report metadata requires a new pinned approval and never changes numeric timestamp',()=>{
  const input=fixture(),approval=approve(input);input.observation.reviewedAt='2026-10-09T20:00:00.000Z';input.nowMs=Date.parse(input.observation.reviewedAt);
  assert.throws(()=>library().validateManagementManualReadApproval({...input,approval}),/MANUAL_READ_APPROVAL_INVALID_OR_CHANGED/);
  const next=approve(input);assert.equal(next.historicalUsage.reportedAt,'2026-10-09T18:54:13.000Z');
  assert.notEqual(next.approvalSha256,approval.approvalSha256);
});

for(const [name,fields,code]of [
  ['negative debit',{recoveryReservedReads:-1,maximumReads:1,legacyReservedReads:0},'RESERVATION_INVALID'],
  ['refund-shaped debit',{recoveryReservedReads:0,maximumReads:-1,legacyReservedReads:0},'RESERVATION_INVALID'],
  ['invalid page reservation',{recoveryReservedReads:0,maximumReads:2,legacyReservedReads:0},'RESERVATION_INVALID'],
  ['negative legacy',{recoveryReservedReads:0,maximumReads:25,legacyReservedReads:-1},'RESERVATION_INVALID'],
  ['new limit exceeded',{recoveryReservedReads:3000,maximumReads:1,legacyReservedReads:0},'CAPTURE_RESERVE_LIMIT'],
  ['legacy consumes day margin',{recoveryReservedReads:0,maximumReads:25,legacyReservedReads:32633},'DAILY_LIMIT_OR_MARGIN'],
])test('assessment rejects '+name,()=>{const input=fixture(),approval=approve(input);
  assert.throws(()=>library().assessManagementManualReadApproval({...input,approval,...fields}),new RegExp('MANUAL_READ_'+code));});

test('assessment admits strict daily-margin boundary and exact recovery cap without enlarging either cap',()=>{
  const input=fixture(),approval=approve(input);
  const boundary=library().assessManagementManualReadApproval({...input,approval,recoveryReservedReads:0,maximumReads:25,legacyReservedReads:32632});
  assert.equal(boundary.estimatedWithMargin,44999);assert.equal(boundary.remainingAfterMargin,1);
  const last=library().assessManagementManualReadApproval({...input,approval,recoveryReservedReads:2975,maximumReads:25,legacyReservedReads:0});
  assert.equal(last.recoveryReservedReads,3000);assert.equal(last.reservedReads,4342);
});

test('stale historical estimate near the daily cap fails margin without being called a current metric',()=>{
  const input=fixture();changedObservation(input,40000,'40 mil');const approval=approve(input);
  assert.throws(()=>library().assessManagementManualReadApproval({...input,approval,recoveryReservedReads:0,maximumReads:25,legacyReservedReads:0}),
    /MANUAL_READ_DAILY_LIMIT_OR_MARGIN/);
});

test('accessors, cycles and nonfinite fields are rejected before any accessor runs',()=>{
  const input=fixture();let touched=false;Object.defineProperty(input.manualControlEvidence,'text',{enumerable:true,get(){touched=true;return TEXT;}});
  assert.throws(()=>approve(input),/MANUAL_READ_INPUT_INVALID/);assert.equal(touched,false);
  const cycle=fixture();cycle.observation.loop=cycle.observation;assert.throws(()=>approve(cycle),/MANUAL_READ_INPUT_INVALID/);
  const nonfinite=fixture();nonfinite.observation.reportedReads=Infinity;assert.throws(()=>approve(nonfinite),/MANUAL_READ_INPUT_INVALID/);
});

test('pure approval helpers do not obtain clock, credentials, filesystem or network implicitly',()=>{
  const input=fixture(),oldNow=Date.now,oldFetch=globalThis.fetch;Date.now=()=>{throw Error('implicit clock');};globalThis.fetch=()=>{throw Error('network');};
  try{const approval=approve(input);assert.equal(library().assessManagementManualReadApproval({...input,approval,
    recoveryReservedReads:0,maximumReads:25,legacyReservedReads:0}).allowed,true);}finally{Date.now=oldNow;globalThis.fetch=oldFetch;}
});