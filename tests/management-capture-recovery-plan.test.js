import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {prepareManagementCaptureQuarterPlan} from '../scripts/lib/management-capture-quarter-plan.js';
import {firestoreQuotaDayStart} from '../scripts/lib/management-read-budget.js';
import {MANAGEMENT_CAPTURE_RECOVERY_AUTHORIZATION,prepareManagementCaptureRecoveryPlan,
  validateManagementCaptureRecoveryPlan,validateManagementCaptureRecoveryPlanEnvelope,
  bindManagementCaptureRecoveryReadTime,validateManagementCaptureRecoveryReadTimeBinding}
  from '../scripts/lib/management-capture-recovery-plan.js';

const FA='sahmt-17a16', readTime='2026-10-09T14:44:36.804Z',
  finishedAt='2026-10-09T15:44:36.807Z', NOW=Date.parse('2026-10-09T16:00:00.000Z');
const H=v=>createHash('sha256').update(v).digest('hex');
const clone=v=>structuredClone(v);
const repinPlan=v=>{const {planSha256,...body}=v;return {...body,planSha256:snapshotDigest(body)};};
function fixture(){
  const roots=Array.from({length:43},(_,i)=>'root'+String(i).padStart(2,'0'));
  const sourceScope={schemaVersion:1,projectId:FA,databaseId:'(default)',scope:'SELECTED_COLLECTION_TREES_WITH_IDENTITY_DEPENDENCIES',rootCollections:roots};
  const documents=roots.flatMap((root,index)=>Array.from({length:index===0?301:index<=22?2:1},(_,n)=>({
    path:root+'/item'+String(n).padStart(3,'0'),fields:{publicFixtureCounter:{integerValue:String(n)}},
    createTime:'2026-10-01T00:00:00.000Z',updateTime:readTime})));
  assert.equal(documents.length,365);
  const oldPlan=prepareManagementCaptureQuarterPlan({scope:sourceScope,sourceSnapshot:{
    schemaVersion:1,projectId:FA,databaseId:'(default)',readTime,
    coverage:{complete:true,consistent:true,rootCollections:roots},documents}});
  const pages=[];
  for(const root of roots){
    const rows=documents.filter(d=>d.path.startsWith(root+'/'));
    for(let offset=0;offset<rows.length;offset+=25){
      const returnedCount=Math.min(25,rows.length-offset),hasNext=offset+returnedCount<rows.length;
      pages.push({attempt:pages.length+1,operation:'listDocuments',parentPath:'',collectionId:root,readTime,
        requestSha256:H('request'+pages.length),pageTokenSha256:offset===0?null:H(root+':'+offset),maximumReads:25,
        status:'COMPLETE',responseSha256:H('response'+pages.length),responseBytes:1,returnedCount,
        nextPageTokenSha256:hasNext?H(root+':'+(offset+returnedCount)):null,existingCount:returnedCount,missingCount:0});
    }
  }
  assert.equal(pages.length,55);
  let deduction=pages.reduce((sum,p)=>sum+p.maximumReads,0)-1191;
  for(const p of pages){const delta=Math.min(deduction,p.maximumReads-Math.max(1,p.returnedCount));p.maximumReads-=delta;deduction-=delta;}
  assert.equal(deduction,0);
  const completedDiscoveryParents=documents.slice(0,151).map(d=>d.path);
  for(const path of completedDiscoveryParents)pages.push({attempt:pages.length+1,operation:'listCollectionIds',
    parentPath:path,readTime,requestSha256:H('request'+pages.length),pageTokenSha256:null,maximumReads:1,
    status:'COMPLETE',responseSha256:H('response'+pages.length),responseBytes:1,returnedCount:0,nextPageTokenSha256:null});
  const coreState={schemaVersion:1,mode:'READ_ONLY_FIRESTORE_CAPTURE',projectId:FA,databaseId:'(default)',readTime,
    rootCollections:roots,scopeSha256:snapshotDigest({projectId:FA,databaseId:'(default)',rootCollections:roots}),
    startedAt:'2026-10-09T14:44:43.850Z',status:'INCOMPLETE',errorCode:'CHECKPOINT_TIMEOUT',
    queue:documents.slice(151).map(d=>({operation:'listCollectionIds',parentPath:d.path,depth:1})),active:null,
    documents,missingDocumentPaths:[],completedCollections:roots,completedDiscoveryParents,pages,totalReservedReads:1342,
    totalResponseBytes:206,finishedAt,captureConfigSha256:H('original configuration'),
    batch:{number:4,maxDocuments:92,maxBatches:4,documentEntriesAtStart:276,
      startedAt:'2026-10-09T15:43:22.279Z',reviewId:'human-review-4'},
    batchHistory:[1,2,3].map(number=>({number,
      startedAt:new Date(Date.parse('2026-10-09T14:44:43.850Z')+(number-1)*60000).toISOString(),
      finishedAt:new Date(Date.parse('2026-10-09T14:44:45.845Z')+(number-1)*60000).toISOString(),documentEntries:92,
      reviewId:number===1?null:'human-review-'+number,status:'PARTIAL_REVIEW'})),
    knownCollections:roots,lastObservedAt:'2026-10-09T15:44:36.644Z'};
  const file=n=>'capture-FA-'+String(n)+'-latest.dpapi.json';
  const body={schemaVersion:1,kind:'MANAGEMENT_QUARTER_CAPTURE_HEAD',projectId:FA,databaseId:'(default)',
    planSha256:oldPlan.planSha256,scopeSha256:oldPlan.scopeSha256,baselineSnapshotSha256:oldPlan.baselineSnapshotSha256,
    sequenceId:'synthetic-original-sequence',revision:397,previousHeadSha256:H('previous head'),
    createdAt:'2026-10-09T14:44:43.850Z',updatedAt:'2026-10-09T15:44:36.864Z',readTime,
    captureConfigSha256:coreState.captureConfigSha256,status:'INCOMPLETE',batchNumber:4,activeRunId:'run4',
    activeCheckpointFile:file(4),checkpointSha256:snapshotDigest(coreState),checkpointFinishedAt:finishedAt,
    checkpointObservedAt:finishedAt,checkpointContentSha256:snapshotDigest(Object.fromEntries(Object.entries(coreState).filter(([k])=>k!=='lastObservedAt'))),
    counters:{documents:365,missingParents:0,attempts:206,reservedReads:1342,responseBytes:206},
    runHistory:[1,2,3,4].map(n=>({runId:'run'+n,checkpointFile:file(n),batchNumber:n,
      reviewId:n===1?null:'human-review-'+n,documentEntriesAtStart:(n-1)*92}))};
  const predecessorHead={...body,headSha256:snapshotDigest(body)};
  const quotaDay=firestoreQuotaDayStart(NOW);
  const predecessorPolicy={schemaVersion:1,projectId:FA,dailyReadLimit:45000,
    limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08',quotaTimeZone:'America/Los_Angeles',
    renewalClearsPause:false,pausedRequiresReview:true,pauseReason:'CHECKPOINT_TIMEOUT',
    authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',humanDecisionAt:'2026-10-09T15:12:31.000Z',
    maximumCaptureReserve:6000,reservedReads:1342,appTrafficReserve:5000,metricLagReserve:2000,
    reservationQuotaDayStart:quotaDay};
  const predecessorCheckpoint={schemaVersion:1,kind:'FIRESTORE_QUARTER_CHECKPOINT',projectId:FA,
    quarterPlan:oldPlan,coreState};
  const predecessorPins={headSha256:predecessorHead.headSha256,checkpointSha256:snapshotDigest(coreState),
    quarterPlanSha256:oldPlan.planSha256,scopeSha256:oldPlan.scopeSha256,policySha256:snapshotDigest(predecessorPolicy),
    originalReadTime:readTime,checkpointFinishedAt:finishedAt,reservedReads:1342};
  return {predecessorHead,predecessorCheckpoint,predecessorPolicy,sourceScope,predecessorPins,
    authorizationEvidence:clone(MANAGEMENT_CAPTURE_RECOVERY_AUTHORIZATION),quotaDay,nowMs:NOW};
}
function refreshPins(f){
  const s=f.predecessorCheckpoint.coreState,h=f.predecessorHead;
  h.checkpointSha256=snapshotDigest(s);
  const {headSha256,...body}=h;h.headSha256=snapshotDigest(body);
  f.predecessorPins.headSha256=h.headSha256;f.predecessorPins.checkpointSha256=h.checkpointSha256;
  f.predecessorPins.policySha256=snapshotDigest(f.predecessorPolicy);
}
const withPlan=f=>({...f,plan:prepareManagementCaptureRecoveryPlan(f)});

test('separate recovery plan pins failed head/checkpoint/policy without resetting or approving data',()=>{
  const f=fixture(),before=snapshotDigest(f),plan=prepareManagementCaptureRecoveryPlan(f);
  assert.equal(snapshotDigest(f),before);assert.equal(plan.namespace,'FA-rec1');
  assert.equal(plan.predecessor.reservedReads,1342);assert.equal(plan.predecessor.pendingDiscoveryParents,214);
  assert.equal(plan.quota.newCaptureReservationLimit,3000);assert.equal(plan.quota.cumulativeReadReservationLimit,6000);
  assert.equal(plan.authority.sourceHumanDecisionAt,'2026-10-09T15:12:31.000Z');
  assert.equal(plan.oldArtifactsMutable,false);assert.equal(plan.oldDocumentsUsedInNewSnapshot,false);
  assert.equal(plan.productionActivation,false);assert.equal(plan.automaticRetry,false);assert.equal(plan.implicitResume,false);
  assert.deepEqual(validateManagementCaptureRecoveryPlan({...f,plan}),plan);
  assert.ok(Object.isFrozen(plan)&&Object.isFrozen(plan.captureConfiguration.limits));
  for(const key of ['readTime','maxBatchDocuments','maxBatches','resumeState','resumeStateSha256','resumeReviewId'])
    assert.equal(Object.hasOwn(plan.captureConfiguration,key),false);
  assert.equal(plan.captureConfiguration.pageSize,25);assert.equal(plan.captureConfiguration.collectionPageSize,100);
  assert.equal(plan.captureConfiguration.limits.maxDurationMs,240000);
});

test('plan canonical digest ignores input property insertion order and takes no hidden clock/API',()=>{
  const f=fixture(),oldNow=Date.now,oldFetch=globalThis.fetch;
  Date.now=()=>{throw Error('clock forbidden');};globalThis.fetch=()=>{throw Error('API forbidden');};
  try{
    const first=prepareManagementCaptureRecoveryPlan(f);
    const reordered=Object.fromEntries(Object.entries(f).reverse());
    assert.equal(prepareManagementCaptureRecoveryPlan(reordered).planSha256,first.planSha256);
  }finally{Date.now=oldNow;globalThis.fetch=oldFetch;}
});

for(const [name,mutate,code]of [
  ['wrong namespace',f=>{f.authorizationEvidence.namespace='FA-rec2';},'RECOVERY_SOURCE_AUTHORIZATION_INVALID'],
  ['old grant',f=>{f.authorizationEvidence.kind='HUMAN_AUTHORIZED_REMAINING_QUARTERS';},'RECOVERY_SOURCE_AUTHORIZATION_INVALID'],
  ['re-dated human decision',f=>{f.authorizationEvidence.sourceHumanDecisionAt=new Date(NOW).toISOString();},'RECOVERY_SOURCE_AUTHORIZATION_INVALID'],
  ['changed literal',f=>{f.authorizationEvidence.sourceMessage.text+=' ';},'RECOVERY_SOURCE_AUTHORIZATION_INVALID'],
  ['changed quote hash',f=>{f.authorizationEvidence.sourceMessage.textSha256=H('forged');},'RECOVERY_SOURCE_AUTHORIZATION_INVALID'],
  ['additional authority boolean',f=>{f.authorizationEvidence.approved=true;},'RECOVERY_SOURCE_AUTHORIZATION_INVALID'],
  ['future clock',f=>{f.nowMs=Date.parse('2026-10-09T15:00:00.000Z');},'RECOVERY_SOURCE_AUTHORIZATION_STALE_OR_FUTURE'],
  ['next quota day',f=>{f.nowMs=Date.parse('2026-10-10T16:00:00.000Z');f.quotaDay=firestoreQuotaDayStart(f.nowMs);},'RECOVERY_SOURCE_AUTHORIZATION_STALE_OR_FUTURE'],
  ['wrong day',f=>{f.quotaDay='2026-10-08T07:00:00.000Z';},'RECOVERY_QUOTA_DAY_INVALID'],
  ['unreviewed head',f=>{f.predecessorPins.headSha256=H('other');},'QUARTER_HEAD_CAS_MISMATCH'],
  ['wrong checkpoint hash',f=>{f.predecessorPins.checkpointSha256=H('other');},'RECOVERY_PREDECESSOR_HEAD_OR_CHECKPOINT_CHANGED'],
  ['changed old policy',f=>{f.predecessorPolicy.reservedReads=0;},'RECOVERY_PREDECESSOR_POLICY_CHANGED'],
  ['unpaused old policy',f=>{f.predecessorPolicy.pausedRequiresReview=false;refreshPins(f);},'RECOVERY_PREDECESSOR_POLICY_INVALID'],
  ['refunded reservations',f=>{f.predecessorPolicy.reservedReads=0;refreshPins(f);},'RECOVERY_PREDECESSOR_POLICY_INVALID'],
  ['scope reordered without review',f=>{f.sourceScope.rootCollections.reverse();},'RECOVERY_PREDECESSOR_SCOPE_OR_PLAN_CHANGED'],
  ['extra root',f=>{f.sourceScope.rootCollections.push('extra');},'RECOVERY_SCOPE_INVALID'],
  ['missing root',f=>{f.sourceScope.rootCollections.pop();},'RECOVERY_SCOPE_INVALID'],
  ['scope accessor',f=>{Object.defineProperty(f.sourceScope,'projectId',{enumerable:true,get:()=>FA});},'RECOVERY_DATA_INVALID'],
  ['unresolved proof',f=>{f.predecessorCheckpoint.coreState.pages[0].status='UNCERTAIN';refreshPins(f);},'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS'],
  ['same-time mixed proof',f=>{f.predecessorCheckpoint.coreState.pages[0].readTime='2026-10-09T15:44:00.000Z';refreshPins(f);},'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS'],
  ['proof counter reduced',f=>{f.predecessorCheckpoint.coreState.pages[0].maximumReads--;refreshPins(f);},'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS'],
  ['duplicate discovery',f=>{const s=f.predecessorCheckpoint.coreState;s.queue[0]=clone(s.queue[1]);refreshPins(f);},'RECOVERY_PREDECESSOR_UNRESOLVED_PROOFS'],
  ['subcollection absence inferred',f=>{f.predecessorCheckpoint.coreState.completedDiscoveryParents.push('root00/item151');refreshPins(f);},'RECOVERY_PREDECESSOR_COVERAGE_INVALID'],
  ['new fields in source',f=>{f.predecessorCheckpoint.coreState.documents[0].fields.publicFixtureCounter.integerValue='999';},'RECOVERY_PREDECESSOR_HEAD_OR_CHECKPOINT_CHANGED']
])test('recovery preparation rejects '+name,()=>{
  const f=fixture();mutate(f);assert.throws(()=>prepareManagementCaptureRecoveryPlan(f),new RegExp(code));
});

for(const [name,mutate]of [
  ['new namespace',p=>{p.namespace='FA-rec2';}],
  ['higher reservation cap',p=>{p.quota.newCaptureReservationLimit=3001;}],
  ['larger cumulative cap',p=>{p.quota.cumulativeReadReservationLimit=6001;}],
  ['lower app margin',p=>{p.quota.appTrafficReserve=4999;}],
  ['lower lag margin',p=>{p.quota.metricLagReserve=1999;}],
  ['higher daily cap',p=>{p.quota.dailyReadLimit=50000;}],
  ['refund floor',p=>{p.quota.predecessorReservedReads=0;}],
  ['extra quota flag',p=>{p.quota.authorized=true;}],
  ['old readTime included',p=>{p.captureConfiguration.readTime=readTime;}],
  ['implicit resume',p=>{p.captureConfiguration.resumeState={};}],
  ['larger runtime',p=>{p.captureConfiguration.limits.maxDurationMs=240001;}],
  ['larger page',p=>{p.captureConfiguration.pageSize=100;}],
  ['different project',p=>{p.captureConfiguration.projectId='sahmt-gestao-5ae66';}],
  ['production activation',p=>{p.productionActivation=true;}],
  ['automatic retry',p=>{p.automaticRetry=true;}],
  ['old documents mixed',p=>{p.oldDocumentsUsedInNewSnapshot=true;}],
  ['missing discovery hidden',p=>{p.predecessor.pendingDiscoveryParents=0;}],
  ['future createdAt',p=>{p.createdAt=new Date(NOW+1).toISOString();}]
])test('envelope denies rehashed plan mutation '+name,()=>{
  const f=withPlan(fixture()),p=clone(f.plan);mutate(p);
  assert.throws(()=>validateManagementCaptureRecoveryPlanEnvelope({...f,plan:repinPlan(p)}),/RECOVERY_/);
});

test('envelope denies hash tampering and caller policy mutation without accessing private predecessor documents',()=>{
  const f=withPlan(fixture());
  const {predecessorHead,predecessorCheckpoint,sourceScope,predecessorPins,quotaDay,...small}=f;
  assert.deepEqual(validateManagementCaptureRecoveryPlanEnvelope(small),f.plan);
  assert.throws(()=>validateManagementCaptureRecoveryPlanEnvelope({...small,plan:{...small.plan,planSha256:H('other')}}),/RECOVERY_PLAN_INVALID/);
  assert.throws(()=>validateManagementCaptureRecoveryPlanEnvelope({...small,predecessorPolicy:{...small.predecessorPolicy,reservedReads:1343}}),
    /RECOVERY_PREDECESSOR_POLICY_CHANGED/);
});

test('fresh readTime is bound once by the caller journal with a fixed 240 second deadline',()=>{
  const f=withPlan(fixture()),readTimeNew=new Date(NOW-1000).toISOString();
  const binding=bindManagementCaptureRecoveryReadTime({plan:f.plan,readTime:readTimeNew,nowMs:NOW});
  assert.equal(binding.readTime,readTimeNew);assert.equal(binding.startedAt,new Date(NOW).toISOString());
  assert.equal(binding.deadlineAt,new Date(NOW+240000).toISOString());
  assert.equal(binding.coreConfiguration.readTime,readTimeNew);assert.equal(Object.hasOwn(binding.coreConfiguration,'resumeState'),false);
  assert.deepEqual(validateManagementCaptureRecoveryReadTimeBinding({plan:f.plan,binding,nowMs:NOW+239999}),binding);
  assert.throws(()=>validateManagementCaptureRecoveryReadTimeBinding({plan:f.plan,binding,nowMs:NOW+240000}),/RECOVERY_CAPTURE_DEADLINE_EXPIRED/);
  assert.deepEqual(validateManagementCaptureRecoveryReadTimeBinding({plan:f.plan,binding,nowMs:NOW+240001,requireOpenDeadline:false}),binding);
});

for(const value of [readTime,finishedAt,new Date(NOW+1).toISOString(),new Date(NOW-5001).toISOString(),
  '2026-10-09T15:99:00.000Z','2026-10-09T16:00:00.123456Z'])
  test('readTime binding denies old/future/invalid time '+value,()=>{
    const f=withPlan(fixture());
    assert.throws(()=>bindManagementCaptureRecoveryReadTime({plan:f.plan,readTime:value,nowMs:NOW}),
      /RECOVERY_READ_TIME_NOT_FRESH_OR_NEW/);
  });

test('binding requires actual nondecreasing clock and fails closed for rehashed deadline/config changes',()=>{
  const f=withPlan(fixture()),binding=bindManagementCaptureRecoveryReadTime({plan:f.plan,readTime:new Date(NOW-1000).toISOString(),nowMs:NOW});
  for(const mutate of [v=>{v.deadlineAt=new Date(NOW+241000).toISOString();},
    v=>{v.coreConfiguration.maxBatchDocuments=92;},v=>{v.readTime=new Date(NOW-2000).toISOString();}]){
    const value=clone(binding);mutate(value);const {bindingSha256,...body}=value;value.bindingSha256=snapshotDigest(body);
    assert.throws(()=>validateManagementCaptureRecoveryReadTimeBinding({plan:f.plan,binding:value,nowMs:NOW}),/RECOVERY_READ_TIME_BINDING_CHANGED/);
  }
  assert.throws(()=>validateManagementCaptureRecoveryReadTimeBinding({plan:f.plan,binding,nowMs:NOW-1}),/RECOVERY_PLAN_INVALID_OR_CHANGED/);
});


for(const mutate of [
  s=>{s.batchHistory[1].startedAt=s.batchHistory[0].startedAt;},
  s=>{s.batchHistory[0].documentEntries=91;},
  s=>{s.batchHistory[1].reviewId='different-review';},
  s=>{s.batch.reviewId='different-review';},
  s=>{s.pages[2].nextPageTokenSha256=s.pages[0].nextPageTokenSha256;}
])test('predecessor semantic audit denies re-pinned batch/token corruption '+String(mutate),()=>{
  const f=fixture();mutate(f.predecessorCheckpoint.coreState);refreshPins(f);
  assert.throws(()=>prepareManagementCaptureRecoveryPlan(f),/RECOVERY_PREDECESSOR_(STATE_INVALID|UNRESOLVED_PROOFS)/);
});

for(const mutate of [
  p=>{p.captureConfiguration.resumeState={};},
  p=>{p.captureConfiguration.maxBatchDocuments=92;},
  p=>{p.quota.newCaptureReservationLimit=3001;},
  p=>{p.authority.kind='HUMAN_AUTHORIZED_REMAINING_QUARTERS';},
  p=>{p.oldDocumentsUsedInNewSnapshot=true;},
  p=>{p.captureConfiguration.rootCollections[0]='differentRoot';},
  p=>{p.predecessor.pendingDiscoveryParents=0;}
])test('binding independently denies re-pinned plan mutation '+String(mutate),()=>{
  const f=withPlan(fixture()),p=clone(f.plan);mutate(p);
  assert.throws(()=>bindManagementCaptureRecoveryReadTime({plan:repinPlan(p),readTime:new Date(NOW-1000).toISOString(),nowMs:NOW}),/RECOVERY_/);
});

test('same original human authority can be validated later in the current day without re-dating it or claiming current usage',()=>{
  const f=withPlan(fixture());
  const later=validateManagementCaptureRecoveryPlanEnvelope({...f,nowMs:NOW+240001});
  assert.equal(later.authority.sourceHumanDecisionAt,'2026-10-09T15:12:31.000Z');
  assert.equal(Object.hasOwn(later,'observation'),false);
  assert.equal(Object.hasOwn(later,'currentReads'),false);
  assert.throws(()=>validateManagementCaptureRecoveryPlanEnvelope({...f,nowMs:Date.parse('2026-10-10T16:00:00.000Z')}),
    /RECOVERY_QUOTA_PLAN_CHANGED_OR_STALE/);
});


test('deadline terminal override must be an explicit boolean',()=>{
  const f=withPlan(fixture()),binding=bindManagementCaptureRecoveryReadTime({plan:f.plan,readTime:new Date(NOW-1000).toISOString(),nowMs:NOW});
  for(const requireOpenDeadline of [0,null,'false']) assert.throws(()=>validateManagementCaptureRecoveryReadTimeBinding({plan:f.plan,binding,nowMs:NOW+240001,requireOpenDeadline}),/RECOVERY_DEADLINE_MODE_INVALID/);
});

test('real scope schema preserves fifth scope field and original unsorted root order',()=>{
  const f=clone(fixture());f.sourceScope.rootCollections=[...f.sourceScope.rootCollections.slice(1),f.sourceScope.rootCollections[0]];
  const q=f.predecessorCheckpoint.quarterPlan;
  q.scopeSha256=snapshotDigest(f.sourceScope);const {planSha256,...qBody}=q;q.planSha256=snapshotDigest(qBody);
  f.predecessorHead.scopeSha256=q.scopeSha256;f.predecessorHead.planSha256=q.planSha256;
  refreshPins(f);f.predecessorPins.scopeSha256=q.scopeSha256;f.predecessorPins.quarterPlanSha256=q.planSha256;
  const plan=prepareManagementCaptureRecoveryPlan(f);
  assert.deepEqual(plan.captureConfiguration.rootCollections,f.sourceScope.rootCollections);
  assert.notEqual(plan.predecessor.scopeSha256,f.predecessorCheckpoint.coreState.scopeSha256);
  assert.deepEqual(validateManagementCaptureRecoveryPlan({...f,plan}),plan);
  assert.deepEqual(validateManagementCaptureRecoveryPlanEnvelope({...f,plan}),plan);
  assert.doesNotThrow(()=>bindManagementCaptureRecoveryReadTime({plan,readTime:new Date(NOW-1000).toISOString(),nowMs:NOW}));
});
for(const mutate of [s=>{delete s.scope;},s=>{s.scope='ALL_DATABASE_COLLECTIONS';},s=>{s.extraScope=true;}])
  test('exact real source scope rejects missing/changed/additional scope mode '+String(mutate),()=>{
    const f=fixture();mutate(f.sourceScope);assert.throws(()=>prepareManagementCaptureRecoveryPlan(f),/RECOVERY_SCOPE_INVALID/);
  });
