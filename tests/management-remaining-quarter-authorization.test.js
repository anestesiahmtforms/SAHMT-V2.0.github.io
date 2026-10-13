import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {captureFirestoreSnapshot} from '../scripts/lib/firestore-snapshot-capture.js';
import {prepareManagementCaptureQuarterPlan} from '../scripts/lib/management-capture-quarter-plan.js';
import {beginManagementCaptureQuarterHead,advanceManagementCaptureQuarterHead,
  validateManagementRemainingQuarterAuthorization} from '../scripts/lib/management-capture-quarter-head.js';
const FA='sahmt-17a16',readTime='2026-10-09T14:44:36.804Z',approved='2026-10-09T15:12:31.000Z';
const text='VEJO QUE ESTÁ BEM TRANQUILO , VAMOS FINALIZAR TODAS A S LEITURAS PARA PASSARMOS PARA PROXIMA ETAPA. VAMOS!';
const file=number=>'capture-FA-'+number+'-latest.dpapi.json',ms=value=>Date.parse(value);
const repin=head=>{const {headSha256,...body}=head;return {...body,headSha256:snapshotDigest(body)};};
async function fixture() {
  const roots=['managementAreas'],scope={schemaVersion:1,projectId:FA,databaseId:'(default)',rootCollections:roots};
  const snapshot={schemaVersion:1,projectId:FA,databaseId:'(default)',readTime,
    coverage:{complete:true,consistent:true,rootCollections:roots},
    documents:Array.from({length:365},(_,i)=>({path:'managementAreas/item'+i,fields:{value:{integerValue:String(i)}},
      createTime:readTime,updateTime:readTime}))};
  const plan=prepareManagementCaptureQuarterPlan({scope,sourceSnapshot:snapshot});
  const config={projectId:FA,databaseId:'(default)',rootCollections:roots,readTime,pageSize:25,collectionPageSize:100,
    maxBatchDocuments:92,maxBatches:4,limits:{maxPages:3000,maxDocuments:6000,maxDepth:30,maxBytes:12582912,
      maxDurationMs:180000,requestTimeoutMs:20000}};
  const adapters=nowMs=>({clock:()=>nowMs,reserveReads:()=>true,checkpoint:()=>{},transport:request=>{
    if(request.operation==='listCollectionIds')return {};
    const offset=Number(request.query.pageToken||0),size=Number(request.query.pageSize),rows=snapshot.documents.slice(offset,offset+size);
    return{documents:rows.map(({path,...rest})=>({...rest,name:'projects/'+FA+'/databases/(default)/documents/'+path})),
      ...(offset+rows.length<365?{nextPageToken:String(offset+rows.length)}:{})};
  }});
  let head=beginManagementCaptureQuarterHead({plan,runId:'run1',checkpointFile:file(1),readTime,nowMs:ms('2026-10-09T14:45:00Z')});
  let capture=await captureFirestoreSnapshot({...config,...adapters(ms('2026-10-09T14:45:01Z'))});
  head=advanceManagementCaptureQuarterHead({head,expectedHeadSha256:head.headSha256,plan,checkpointFile:file(1),
    coreState:capture.state,nowMs:ms('2026-10-09T14:45:02Z')});
  const saved={schemaVersion:1,kind:'FIRESTORE_QUARTER_CHECKPOINT',projectId:FA,quarterPlan:plan,coreState:capture.state,checkpointFile:file(1)};
  head=beginManagementCaptureQuarterHead({head,expectedHeadSha256:head.headSha256,plan,runId:'run2',checkpointFile:file(2),
    readTime,nowMs:ms('2026-10-09T15:07:50Z'),resumeCheckpoint:saved,
    review:{humanDecisionAt:'2026-10-09T15:05:00.000Z',authorizationEvidence:'SYNTHETIC_BATCH2'},captureConfiguration:config});
  capture=await captureFirestoreSnapshot({...config,...adapters(ms('2026-10-09T15:07:51.637Z')),
    resumeState:capture.state,resumeStateSha256:snapshotDigest(capture.state),resumeReviewId:head.runHistory[1].reviewId});
  head=advanceManagementCaptureQuarterHead({head,expectedHeadSha256:head.headSha256,plan,checkpointFile:file(2),
    coreState:capture.state,nowMs:ms('2026-10-09T15:07:52Z')});
  const grant={schemaVersion:1,kind:'HUMAN_AUTHORIZED_REMAINING_QUARTERS',projectId:FA,
    authorizedPurpose:'MANAGEMENT_BACKUP_ONLY',dailyReadLimit:45000,sourceHumanDecisionAt:approved,
    sourceMessage:{evidenceId:'USER_COMPLETE_REMAINING_CAPTURE_QUARTERS_2026_10_09T15_12_31Z',
      authority:'CURRENT_HUMAN_MESSAGE',text,textSha256:createHash('sha256').update(text,'utf8').digest('hex')},
    anchor:{headSha256:head.headSha256,checkpointSha256:head.checkpointSha256,
      checkpointFinishedAt:head.checkpointFinishedAt,batchNumber:2,sequenceId:head.sequenceId,
      runHistorySha256:snapshotDigest(head.runHistory),planSha256:plan.planSha256,readTime},
    firstBatch:3,lastBatch:4,maxBatchDocuments:92,maxReservedReadsPerBatch:1500,
    cumulativeReadReservationLimit:6000,deadlineAt:'2026-10-09T15:44:36.804Z',automaticNextBatch:false};
  const input={authorizationEvidence:grant,humanDecisionAt:approved,head,plan,nowMs:ms('2026-10-09T15:15:00Z')};
  return{config,adapters,plan,head,state:capture.state,grant,input};
}
test('mesma decisão autoriza lotes 3/4 da mesma sequência sem redatar nem resetar readTime',async()=>{
  const f=await fixture();
  assert.equal(validateManagementRemainingQuarterAuthorization(f.input).nextBatchNumber,3);
  const third=beginManagementCaptureQuarterHead({head:f.head,expectedHeadSha256:f.head.headSha256,plan:f.plan,
    runId:'run3',checkpointFile:file(3),readTime,nowMs:f.input.nowMs,
    resumeCheckpoint:{schemaVersion:1,kind:'FIRESTORE_QUARTER_CHECKPOINT',projectId:FA,quarterPlan:f.plan,
      coreState:f.state,checkpointFile:file(2)},review:{humanDecisionAt:approved,authorizationEvidence:f.grant},
    captureConfiguration:f.config});
  assert.equal(third.runHistory[2].remainingAuthorizationSha256,snapshotDigest(f.grant));
  const capture=await captureFirestoreSnapshot({...f.config,...f.adapters(ms('2026-10-09T15:15:01Z')),
    resumeState:f.state,resumeStateSha256:snapshotDigest(f.state),resumeReviewId:third.runHistory[2].reviewId});
  const head3=advanceManagementCaptureQuarterHead({head:third,expectedHeadSha256:third.headSha256,plan:f.plan,
    checkpointFile:file(3),coreState:capture.state,nowMs:ms('2026-10-09T15:15:02Z')});
  assert.ok(ms(approved)<ms(head3.checkpointFinishedAt));
  assert.equal(validateManagementRemainingQuarterAuthorization({...f.input,head:head3,nowMs:ms('2026-10-09T15:20:00Z')}).nextBatchNumber,4);
  const fourth=beginManagementCaptureQuarterHead({head:head3,expectedHeadSha256:head3.headSha256,plan:f.plan,
    runId:'run4',checkpointFile:file(4),readTime,nowMs:ms('2026-10-09T15:20:00Z'),
    resumeCheckpoint:{schemaVersion:1,kind:'FIRESTORE_QUARTER_CHECKPOINT',projectId:FA,quarterPlan:f.plan,
      coreState:capture.state,checkpointFile:file(3)},review:{humanDecisionAt:approved,authorizationEvidence:f.grant},
    captureConfiguration:f.config});
  assert.equal(fourth.batchNumber,4);assert.equal(fourth.readTime,readTime);
  assert.equal(fourth.runHistory[3].remainingAuthorizationSha256,snapshotDigest(f.grant));
  assert.notEqual(fourth.runHistory[3].reviewId,third.runHistory[2].reviewId);
  assert.throws(()=>validateManagementRemainingQuarterAuthorization({...f.input,head:fourth,nowMs:ms('2026-10-09T15:20:00Z')}),
    /QUARTER_REMAINING_BATCH_NOT_AUTHORIZED/);
});
for(const [name,mutate]of [
  ['unknown top field',v=>{v.authorizationEvidence.extra=true;}],
  ['unknown message field',v=>{v.authorizationEvidence.sourceMessage.extra=true;}],
  ['unknown anchor field',v=>{v.authorizationEvidence.anchor.extra=true;}],
  ['redated original decision',v=>{v.humanDecisionAt='2026-10-09T15:20:00.000Z';}],
  ['grant redated',v=>{v.authorizationEvidence.sourceHumanDecisionAt='2026-10-09T15:20:00.000Z';}],
  ['altered literal with recomputed hash',v=>{v.authorizationEvidence.sourceMessage.text='CONTINUE';
    v.authorizationEvidence.sourceMessage.textSha256=createHash('sha256').update('CONTINUE').digest('hex');}],
  ['wrong authority',v=>{v.authorizationEvidence.sourceMessage.authority='AUTOMATION';}],
  ['wrong source evidence',v=>{v.authorizationEvidence.sourceMessage.evidenceId='other';}],
  ['wrong text hash',v=>{v.authorizationEvidence.sourceMessage.textSha256='0'.repeat(64);}],
  ['different head',v=>{v.authorizationEvidence.anchor.headSha256='0'.repeat(64);}],
  ['different checkpoint',v=>{v.authorizationEvidence.anchor.checkpointSha256='0'.repeat(64);}],
  ['different finish',v=>{v.authorizationEvidence.anchor.checkpointFinishedAt='2026-10-09T15:00:00.000Z';}],
  ['different batch',v=>{v.authorizationEvidence.anchor.batchNumber=1;}],
  ['different sequence',v=>{v.authorizationEvidence.anchor.sequenceId='other';}],
  ['different prefix',v=>{v.authorizationEvidence.anchor.runHistorySha256='0'.repeat(64);}],
  ['different plan',v=>{v.authorizationEvidence.anchor.planSha256='0'.repeat(64);}],
  ['different readTime',v=>{v.authorizationEvidence.anchor.readTime='2026-10-09T14:40:00.000Z';}],
  ['first batch changed',v=>{v.authorizationEvidence.firstBatch=2;}],
  ['fifth batch included',v=>{v.authorizationEvidence.lastBatch=5;}],
  ['document cap expanded',v=>{v.authorizationEvidence.maxBatchDocuments=93;}],
  ['reserve cap expanded',v=>{v.authorizationEvidence.maxReservedReadsPerBatch=1501;}],
  ['cumulative cap expanded',v=>{v.authorizationEvidence.cumulativeReadReservationLimit=6001;}],
  ['daily cap expanded',v=>{v.authorizationEvidence.dailyReadLimit=50000;}],
  ['wrong purpose',v=>{v.authorizationEvidence.authorizedPurpose='OTHER';}],
  ['wrong project',v=>{v.authorizationEvidence.projectId='sahmt-gestao-5ae66';}],
  ['automatic advance',v=>{v.authorizationEvidence.automaticNextBatch=true;}],
  ['deadline extended',v=>{v.authorizationEvidence.deadlineAt='2026-10-09T15:44:36.805Z';}],
  ['deadline expired',v=>{v.nowMs=ms(v.authorizationEvidence.deadlineAt);}],
  ['decision in future',v=>{v.nowMs=ms(approved)-1;}],
  ['counters beyond cumulative cap',v=>{v.head=repin({...v.head,counters:{...v.head.counters,reservedReads:6001}});}]
])test('remaining grant rejects '+name,async()=>{
  const f=await fixture(),input=structuredClone(f.input);mutate(input);
  assert.throws(()=>validateManagementRemainingQuarterAuthorization(input));
});
test('grant alterado no lote 4 não pode ser re-pinando a evidência depois do lote 3',async()=>{
  const f=await fixture(),head3=repin({...f.head,batchNumber:3,activeRunId:'run3',activeCheckpointFile:file(3),
    runHistory:[...f.head.runHistory,{runId:'run3',checkpointFile:file(3),batchNumber:3,reviewId:'review3',
      documentEntriesAtStart:184,remainingAuthorizationSha256:'0'.repeat(64)}]});
  assert.throws(()=>validateManagementRemainingQuarterAuthorization({...f.input,head:head3}),
    /QUARTER_REMAINING_GRANT_NOT_PINNED/);
});
