import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,open,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {captureFirestoreSnapshot} from '../scripts/lib/firestore-snapshot-capture.js';
import {snapshotDigest} from '../scripts/lib/management-split-plan.js';
import {prepareManagementCaptureQuarterPlan} from '../scripts/lib/management-capture-quarter-plan.js';
import {beginManagementCaptureQuarterHead,advanceManagementCaptureQuarterHead,
  adoptInitialManagementCaptureQuarterHead,validateManagementCaptureQuarterHead} from '../scripts/lib/management-capture-quarter-head.js';
import {readManagementCaptureQuarterHead,persistManagementCaptureQuarterHead} from '../scripts/lib/management-capture-quarter-head-store.js';

const FA='sahmt-17a16',readTime='2026-10-09T14:00:00.000Z',start=Date.parse(readTime)+5000;
const firstFile='capture-FA-20261009140005000-latest.dpapi.json',secondFile='capture-FA-20261009140008000-latest.dpapi.json';
const limits={maxPages:3000,maxDocuments:6000,maxDepth:30,maxBytes:12*1024*1024,maxDurationMs:180000,requestTimeoutMs:20000};
function baseline(count=365) {
  const scope={schemaVersion:1,projectId:FA,databaseId:'(default)',rootCollections:['managementAreas']};
  const sourceSnapshot={schemaVersion:1,projectId:FA,databaseId:'(default)',readTime,
    coverage:{complete:true,consistent:true,rootCollections:scope.rootCollections},
    documents:Array.from({length:count},(_,index)=>({path:'managementAreas/item'+index,
      fields:{value:{integerValue:String(index)}},createTime:readTime,updateTime:readTime}))};
  return {scope,sourceSnapshot,plan:prepareManagementCaptureQuarterPlan({scope,sourceSnapshot})};
}
async function fixture(count=365) {
  const {scope,sourceSnapshot,plan}=baseline(count);
  const captureConfiguration={projectId:FA,databaseId:'(default)',rootCollections:scope.rootCollections,readTime,
    pageSize:plan.documentPageSize,collectionPageSize:100,maxBatchDocuments:plan.maxBatchDocuments,maxBatches:4,limits};
  const capture=await captureFirestoreSnapshot({...captureConfiguration,clock:()=>start,reserveReads:()=>true,checkpoint:()=>{},
    transport:request=>{
      if(request.operation==='listCollectionIds')return {};
      const offset=Number(request.query.pageToken||0),size=Number(request.query.pageSize);
      const selected=sourceSnapshot.documents.slice(offset,offset+size);
      const documents=selected.map(({path,...row})=>({...row,name:'projects/'+FA+'/databases/(default)/documents/'+path}));
      return {documents,...(offset+selected.length<count?{nextPageToken:String(offset+selected.length)}:{})};
    }});
  assert.equal(capture.status,'PARTIAL_REVIEW');
  const initial=beginManagementCaptureQuarterHead({plan,runId:'run_1',checkpointFile:firstFile,readTime,nowMs:start});
  const head=advanceManagementCaptureQuarterHead({head:initial,expectedHeadSha256:initial.headSha256,plan,
    checkpointFile:firstFile,coreState:capture.state,nowMs:start+500});
  const saved={schemaVersion:1,kind:'FIRESTORE_QUARTER_CHECKPOINT',projectId:FA,quarterPlan:plan,
    coreState:capture.state,checkpointFile:firstFile};
  const resume={head,expectedHeadSha256:head.headSha256,plan,runId:'run_2',checkpointFile:secondFile,
    readTime,nowMs:start+3000,resumeCheckpoint:saved,
    review:{humanDecisionAt:new Date(start+2000).toISOString(),authorizationEvidence:'SYNTHETIC_USER_REVIEW_2'},
    captureConfiguration};
  return {plan,initial,head,state:capture.state,saved,resume};
}
const repin=value=>{const {headSha256,...body}=value;return {...body,headSha256:snapshotDigest(body)};};
const envelope=({state,plan},file=firstFile)=>({checkpointFile:file,coreStateSha256:snapshotDigest(state),
  planSha256:plan.planSha256,readTime:state.readTime,batchNumber:state.batch.number});

test('head fixa checkpoint e mantém hash, readTime, lote e contadores',async()=>{
  const f=await fixture();
  assert.equal(f.head.status,'PARTIAL_REVIEW');assert.equal(f.head.batchNumber,1);
  assert.equal(f.head.checkpointSha256,snapshotDigest(f.state));assert.equal(f.head.counters.documents,92);
  assert.equal(f.head.counters.reservedReads,92);assert.equal(f.head.previousHeadSha256,f.initial.headSha256);
  assert.deepEqual(validateManagementCaptureQuarterHead({head:f.head,expectedHeadSha256:f.head.headSha256,plan:f.plan}),f.head);
});
test('primeira sequência duplicada é recusada para todos os estados',async()=>{
  const f=await fixture();
  for(const candidate of [f.initial,f.head])assert.throws(()=>beginManagementCaptureQuarterHead({
    head:candidate,expectedHeadSha256:candidate.headSha256,plan:f.plan,runId:'other',checkpointFile:secondFile,
    readTime,nowMs:start+3000}),/QUARTER_SEQUENCE_ALREADY_EXISTS_REQUIRES_REVIEW/);
});
test('retomada revisada cria um único lote seguinte e preserva sequência',async()=>{
  const f=await fixture(),next=beginManagementCaptureQuarterHead(f.resume);
  assert.equal(next.batchNumber,2);assert.equal(next.status,'IN_PROGRESS');
  assert.equal(next.sequenceId,'run_1');assert.equal(next.readTime,f.head.readTime);
  assert.equal(next.previousHeadSha256,f.head.headSha256);assert.equal(next.checkpointSha256,null);
  assert.deepEqual(next.counters,f.head.counters);
  assert.equal(next.runHistory[1].documentEntriesAtStart,92);
});
for(const change of [
  value=>{value.expectedHeadSha256='0'.repeat(64);},
  value=>{value.resumeCheckpoint.checkpointFile='capture-FA-111-latest.dpapi.json';},
  value=>{value.resumeCheckpoint.coreState.documents[0].fields.value.integerValue='999';},
  value=>{value.resumeCheckpoint.coreState.batch.number=2;},
  value=>{value.resumeCheckpoint.coreState.readTime='2026-10-09T13:59:00.000Z';},
  value=>{value.readTime='2026-10-09T13:59:00.000Z';},
  value=>{value.review.humanDecisionAt=new Date(start).toISOString();},
  value=>{value.review.authorizationEvidence='';},
  value=>{value.runId='run_1';},
  value=>{value.checkpointFile=firstFile;},
  value=>{value.nowMs=start-1;},
  value=>{value.nowMs=Date.parse(readTime)+3600000;},
  value=>{value.captureConfiguration.pageSize=20;}
])test('retomada recusa head antigo, estado modificado e autorização inválida '+change.toString(),async()=>{
  const f=await fixture(),input=structuredClone(f.resume);change(input);
  assert.throws(()=>beginManagementCaptureQuarterHead(input));
});
test('lote 2 em progresso impede ramificação pelo checkpoint do lote 1',async()=>{
  const f=await fixture(),next=beginManagementCaptureQuarterHead(f.resume);
  assert.throws(()=>beginManagementCaptureQuarterHead({...f.resume,head:next,expectedHeadSha256:next.headSha256,
    runId:'run_3',checkpointFile:'capture-FA-333-latest.dpapi.json'}),/QUARTER_HEAD_NOT_RESUMABLE_REQUIRES_REVIEW/);
});
test('head não aceita repinning de histórico duplicado ou counters negativos',async()=>{
  const f=await fixture();
  for(const mutate of [h=>{h.runHistory[0].reviewId='unexpected';},h=>{h.counters.documents=-1;},
    h=>{h.batchNumber=2;},h=>{h.runHistory[0].documentEntriesAtStart=1;}]) {
    const bad=structuredClone(f.head);mutate(bad);const value=repin(bad);
    assert.throws(()=>validateManagementCaptureQuarterHead({head:value,expectedHeadSha256:value.headSha256,plan:f.plan}));
  }
});
test('checkpoint repetido exato é idempotente, alteração terminal é recusada',async()=>{
  const f=await fixture(),input={head:f.head,expectedHeadSha256:f.head.headSha256,plan:f.plan,
    checkpointFile:firstFile,coreState:f.state,nowMs:start+1000};
  assert.deepEqual(advanceManagementCaptureQuarterHead(input),f.head);
  const altered=structuredClone(f.state);altered.documents[0].fields.value.integerValue='999';
  assert.throws(()=>advanceManagementCaptureQuarterHead({...input,coreState:altered}),/QUARTER_HEAD_TERMINAL_CHECKPOINT_CHANGED/);
});
test('falha após checkpoint final degrada para INCOMPLETE e nunca reabre',async()=>{
  const f=await fixture(),failed={...structuredClone(f.state),status:'INCOMPLETE',errorCode:'CHECKPOINT_TIMEOUT',
    lastObservedAt:new Date(start+1000).toISOString(),finishedAt:new Date(start+1000).toISOString()};
  const head=advanceManagementCaptureQuarterHead({head:f.head,expectedHeadSha256:f.head.headSha256,plan:f.plan,
    checkpointFile:firstFile,coreState:failed,nowMs:start+1000});
  assert.equal(head.status,'INCOMPLETE');
  assert.throws(()=>beginManagementCaptureQuarterHead({...f.resume,head,expectedHeadSha256:head.headSha256}),
    /QUARTER_HEAD_NOT_RESUMABLE_REQUIRES_REVIEW/);
  assert.throws(()=>advanceManagementCaptureQuarterHead({head,expectedHeadSha256:head.headSha256,plan:f.plan,
    checkpointFile:firstFile,coreState:f.state,nowMs:start+2000}),/QUARTER_HEAD_CHECKPOINT_MOVED_BACKWARDS/);
});
test('adota apenas primeiro checkpoint final verificado e inventário único',async()=>{
  const f=await fixture(),input={plan:f.plan,runId:'adopted_first',checkpointFile:firstFile,coreState:f.state,
    checkpointInventory:[envelope(f)],nowMs:start+2000};
  const adopted=adoptInitialManagementCaptureQuarterHead(input);
  assert.equal(adopted.revision,1);assert.equal(adopted.previousHeadSha256,null);
  assert.equal(adopted.checkpointSha256,snapshotDigest(f.state));assert.equal(adopted.counters.documents,92);
  for(const mutate of [v=>{v.head=f.head;},v=>{v.checkpointInventory.push(envelope(f));},
    v=>{v.checkpointInventory=[];},v=>{v.checkpointInventory[0].coreStateSha256='0'.repeat(64);},
    v=>{v.coreState.batch.number=2;},v=>{v.coreState.status='INCOMPLETE';}]) {
    const bad=structuredClone(input);mutate(bad);assert.throws(()=>adoptInitialManagementCaptureQuarterHead(bad));
  }
});
test('getters, cycles, arrays esparsos e objetos customizados não são executados',async()=>{
  const f=await fixture();let called=0;
  const bad={get schemaVersion(){called++;return 1;}};
  assert.throws(()=>beginManagementCaptureQuarterHead({...f.resume,head:bad}));
  assert.equal(called,0);
  for(const invalid of [Object.create(f.head),[,,],(()=>{const a={};a.a=a;return a;})()])
    assert.throws(()=>validateManagementCaptureQuarterHead({head:invalid,expectedHeadSha256:f.head.headSha256,plan:f.plan}));
});
async function storeFixture(t) {
  const root=await mkdtemp(resolve(tmpdir(),'sahmt-quarter-head-'));
  t.after(async()=>{const target=resolve(root),allowed=resolve(tmpdir())+sep;
    assert.ok(target.startsWith(allowed)&&target.slice(allowed.length).startsWith('sahmt-quarter-head-'));
    await rm(target,{recursive:true,force:true});});
  const directory=resolve(root,'.local-preview/management-split');await mkdir(directory,{recursive:true});
  const lock=await open(resolve(directory,'backup-read-FA.lock'),'wx');t.after(()=>lock.close());
  return {directory,lock};
}
test('store exige lock e CAS, persiste head e recusa writer obsoleto',async t=>{
  const {directory,lock}=await storeFixture(t),f=await fixture();
  assert.equal(await readManagementCaptureQuarterHead({directory}),null);
  const input={directory,lockDescriptor:lock,head:f.initial,expectedHeadSha256:null,plan:f.plan};
  await assert.rejects(()=>persistManagementCaptureQuarterHead({...input,lockDescriptor:null}),/QUARTER_HEAD_CAPTURE_LOCK_REQUIRED/);
  await persistManagementCaptureQuarterHead(input);
  assert.deepEqual(await readManagementCaptureQuarterHead({directory}),f.initial);
  await assert.rejects(()=>persistManagementCaptureQuarterHead({...input,head:f.head,expectedHeadSha256:null}),
    /QUARTER_HEAD_CAS_MISMATCH/);
  await persistManagementCaptureQuarterHead({...input,head:f.head,expectedHeadSha256:f.initial.headSha256});
  await assert.rejects(()=>persistManagementCaptureQuarterHead({...input,head:f.head,expectedHeadSha256:f.initial.headSha256}),
    /QUARTER_HEAD_CAS_MISMATCH/);
  assert.deepEqual(await readManagementCaptureQuarterHead({directory}),f.head);
});
test('store bloqueia arquivo corrupto e abort não perde head anterior',async t=>{
  const {directory,lock}=await storeFixture(t),f=await fixture();
  await persistManagementCaptureQuarterHead({directory,lockDescriptor:lock,head:f.initial,expectedHeadSha256:null,plan:f.plan});
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>persistManagementCaptureQuarterHead({directory,lockDescriptor:lock,head:f.head,
    expectedHeadSha256:f.initial.headSha256,plan:f.plan,signal:controller.signal}),/QUARTER_HEAD_WRITE_ABORTED/);
  assert.deepEqual(await readManagementCaptureQuarterHead({directory}),f.initial);
  await writeFile(resolve(directory,'quarter-head-FA.json'),'{}');
  await assert.rejects(()=>persistManagementCaptureQuarterHead({directory,lockDescriptor:lock,head:f.head,
    expectedHeadSha256:f.initial.headSha256,plan:f.plan}),/QUARTER_HEAD_CAS_MISMATCH/);
});
test('store recusa links e lock pertencente a outro arquivo',async t=>{
  const {directory,lock}=await storeFixture(t),f=await fixture(),foreign=await open(resolve(directory,'other.lock'),'wx');
  t.after(()=>foreign.close());
  await assert.rejects(()=>persistManagementCaptureQuarterHead({directory,lockDescriptor:foreign,
    head:f.initial,expectedHeadSha256:null,plan:f.plan}),/QUARTER_HEAD_CAPTURE_LOCK_REQUIRED/);
  const target=resolve(directory,'real-directory');await mkdir(target);
  // Windows junctions exercise the same rejected link path without symlink privileges.
  await symlink(target,resolve(directory,'quarter-head-FA.json'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(()=>readManagementCaptureQuarterHead({directory}),/QUARTER_HEAD_FILE_INVALID/);
  assert.ok(lock);
});

test('clock posterior ao checkpoint final altera só lastObservedAt de forma controlada',async()=>{
  const f=await fixture(),observed={...structuredClone(f.state),lastObservedAt:new Date(start+1200).toISOString()};
  const next=advanceManagementCaptureQuarterHead({head:f.head,expectedHeadSha256:f.head.headSha256,plan:f.plan,
    checkpointFile:firstFile,coreState:observed,nowMs:start+1200});
  assert.equal(next.status,'PARTIAL_REVIEW');assert.equal(next.checkpointContentSha256,f.head.checkpointContentSha256);
  assert.notEqual(next.checkpointSha256,f.head.checkpointSha256);
});
test('falha preserva finishedAt real posterior ao último check sem criar retomada',async()=>{
  const f=await fixture(),failed={...structuredClone(f.state),status:'INCOMPLETE',errorCode:'TRANSPORT_FAILED',
    finishedAt:new Date(start+1300).toISOString()};
  const next=advanceManagementCaptureQuarterHead({head:f.head,expectedHeadSha256:f.head.headSha256,plan:f.plan,
    checkpointFile:firstFile,coreState:failed,nowMs:start+1400});
  assert.equal(next.status,'INCOMPLETE');assert.equal(next.checkpointObservedAt,failed.finishedAt);
  assert.equal(next.checkpointFinishedAt,failed.finishedAt);
});
test('store recusa regressão de counters, rewriting de run e prefixo histórico',async t=>{
  const {directory,lock}=await storeFixture(t),f=await fixture();
  await persistManagementCaptureQuarterHead({directory,lockDescriptor:lock,head:f.initial,expectedHeadSha256:null,plan:f.plan});
  await persistManagementCaptureQuarterHead({directory,lockDescriptor:lock,head:f.head,
    expectedHeadSha256:f.initial.headSha256,plan:f.plan});
  for(const mutate of [
    h=>{h.counters.documents--;},
    h=>{h.counters.reservedReads--;},
    h=>{h.activeRunId='rewritten';h.runHistory[0].runId='rewritten';},
    h=>{h.activeCheckpointFile=secondFile;h.runHistory[0].checkpointFile=secondFile;}
  ]) {
    const candidate=structuredClone(f.head);candidate.revision++;candidate.previousHeadSha256=f.head.headSha256;
    candidate.updatedAt=new Date(start+3000).toISOString();mutate(candidate);const forged=repin(candidate);
    await assert.rejects(()=>persistManagementCaptureQuarterHead({directory,lockDescriptor:lock,head:forged,
      expectedHeadSha256:f.head.headSha256,plan:f.plan}),/QUARTER_HEAD_CAS_MISMATCH/);
    assert.deepEqual(await readManagementCaptureQuarterHead({directory}),f.head);
  }
});
test('limite cumulativo quatro e estados terminais não reabrem sequência',async()=>{
  const f=await fixture();
  for(const status of ['COMPLETE','INCOMPLETE']) {
    const terminal=repin({...f.head,status});
    assert.throws(()=>beginManagementCaptureQuarterHead({...f.resume,head:terminal,expectedHeadSha256:terminal.headSha256}),
      /QUARTER_HEAD_NOT_RESUMABLE_REQUIRES_REVIEW/);
    assert.throws(()=>beginManagementCaptureQuarterHead({...f.resume,head:terminal,expectedHeadSha256:terminal.headSha256,
      resumeCheckpoint:null}),/QUARTER_SEQUENCE_ALREADY_EXISTS_REQUIRES_REVIEW/);
  }
  const exhausted=repin({...f.head,batchNumber:4,activeRunId:'run_4',activeCheckpointFile:'capture-FA-4-latest.dpapi.json',
    counters:{...f.head.counters,documents:368},
    runHistory:Array.from({length:4},(_,index)=>({runId:'run_'+(index+1),
      checkpointFile:index===0?firstFile:'capture-FA-'+(index+1)+'-latest.dpapi.json',
      batchNumber:index+1,reviewId:index===0?null:'review_'+index,documentEntriesAtStart:index*92}))});
  assert.throws(()=>beginManagementCaptureQuarterHead({...f.resume,head:exhausted,expectedHeadSha256:exhausted.headSha256}),
    /QUARTER_HEAD_NOT_RESUMABLE_REQUIRES_REVIEW/);
});
