import test from 'node:test';
import assert from 'node:assert/strict';
import {captureFirestoreSnapshot,validateFirestoreCaptureResume} from '../scripts/lib/firestore-snapshot-capture.js';
import {snapshotDigest,validateSplitSnapshot} from '../scripts/lib/management-split-plan.js';

const FA='sahmt-17a16',readTime='2026-10-09T12:00:00.123456Z',BASE=Date.parse('2026-10-09T12:00:01Z');
const document=path=>({name:'projects/'+FA+'/databases/(default)/documents/'+path,fields:{counter:{integerValue:'1'}},
  createTime:'2026-10-01T00:00:00Z',updateTime:readTime});
const clone=value=>structuredClone(value);
function harness(count=365,overrides={}){
  const calls=[],reserves=[],checkpoints=[],entries=Array.from({length:count},(_,i)=>document('managementAreas/item-'+String(i).padStart(4,'0')));
  let now=BASE;
  const options={projectId:FA,databaseId:'(default)',rootCollections:['managementAreas'],readTime,pageSize:25,collectionPageSize:25,
    maxBatchDocuments:92,maxBatches:4,
    limits:{maxPages:3000,maxDocuments:6000,maxDepth:30,maxBytes:12*1024*1024,maxDurationMs:180000,requestTimeoutMs:1000},
    clock:()=>now,reserveReads:async request=>{reserves.push(clone(request));return true;},
    checkpoint:async state=>{checkpoints.push(clone(state));},
    transport:async request=>{
      calls.push(clone(request));
      if(request.operation==='listCollectionIds')return {};
      const offset=Number(request.query.pageToken||0),end=Math.min(entries.length,offset+request.query.pageSize);
      return {documents:entries.slice(offset,end),...(end<entries.length?{nextPageToken:String(end)}:{})};
    },...overrides};
  return {options,calls,reserves,checkpoints,entries,setNow:value=>{now=value;},now:()=>now};
}
function resumed(h,result,reviewId='review-'+String(result.state.batch.number+1)){
  return {...h.options,resumeState:result.state,resumeStateSha256:snapshotDigest(result.state),resumeReviewId:reviewId};
}
function pureOptions(h,result,reviewId){
  const value=resumed(h,result,reviewId);delete value.clock;delete value.transport;delete value.reserveReads;delete value.checkpoint;
  return {...value,nowMs:h.now()};
}
const partial=result=>{
  assert.equal(result.status,'PARTIAL_REVIEW');assert.equal(result.snapshot,null);
  assert.equal(result.receipt.complete,false);assert.equal(result.receipt.consistent,false);assert.equal(result.requiresHumanReview,true);
  assert.equal(result.checkpointSaved,true);assert.equal(result.state.status,'PARTIAL_REVIEW');
  assert.equal(result.receipt.batch.documentEntriesCaptured,92);
  assert.throws(()=>validateSplitSnapshot({...result.state,coverage:{complete:false,consistent:false,rootCollections:result.state.rootCollections}}),/INCOMPLETE_SNAPSHOT/);
};

test('one invocation captures exactly 92 entries with wire pages 25/25/25/17 then stops before next reservation',async()=>{
  const h=harness(),result=await captureFirestoreSnapshot(h.options);partial(result);
  assert.deepEqual(h.calls.map(value=>value.query.pageSize),[25,25,25,17]);
  assert.equal(result.state.documents.length,92);assert.equal(h.calls.length,4);assert.equal(h.reserves.length,4);
  assert.equal(result.state.totalReservedReads,92);assert.equal(result.state.active.pageToken,'92');
  assert.equal(result.state.queue.length,92);assert.equal(result.receipt.batch.number,1);
  assert.deepEqual(h.checkpoints.at(-1),result.state);
  assert.ok(result.state.pages.every(page=>page.status==='COMPLETE' && Number.isSafeInteger(page.responseBytes)));
});

test('pure resume validator runs before credentials without reading clock/network and returns an isolated private state',async()=>{
  const h=harness(),first=await captureFirestoreSnapshot(h.options),input=pureOptions(h,first);
  const oldFetch=globalThis.fetch,oldNow=Date.now;globalThis.fetch=()=>{throw Error('network forbidden');};Date.now=()=>{throw Error('clock forbidden');};
  try{
    const result=validateFirestoreCaptureResume(input);assert.deepEqual(result,first.state);
    result.documents[0].fields.counter.integerValue='2';assert.equal(first.state.documents[0].fields.counter.integerValue,'1');
  }finally{globalThis.fetch=oldFetch;Date.now=oldNow;}
  assert.equal(h.calls.length,4);
});

test('explicit second invocation preserves readTime cursor counters and original startedAt',async()=>{
  const h=harness(),first=await captureFirestoreSnapshot(h.options),firstPin=snapshotDigest(first.state);
  h.setNow(BASE+60000);const result=await captureFirestoreSnapshot(resumed(h,first));partial(result);
  assert.equal(snapshotDigest(first.state),firstPin);assert.equal(result.state.documents.length,184);
  assert.equal(result.state.batch.number,2);assert.equal(result.state.active.pageToken,'184');
  assert.equal(result.state.startedAt,first.state.startedAt);assert.equal(result.state.readTime,readTime);
  assert.equal(result.state.batch.startedAt,new Date(BASE+60000).toISOString());
  assert.equal(result.state.totalReservedReads,184);assert.equal(result.state.pages.length,8);
  assert.equal(h.calls[4].query.pageToken,'92');assert.ok(h.calls.every(request=>(request.query||request.body).readTime===readTime));
  assert.ok(result.state.pages.every((page,index)=>page.attempt===index+1));
});

test('four separately reviewed batches finish 365 historical entries without a fifth automatic batch',async()=>{
  const h=harness();let result=await captureFirestoreSnapshot(h.options);
  for(let number=2;number<=4;number++){
    partial(result);assert.equal(result.state.batch.number,number-1);
    h.setNow(BASE+number*1000);result=await captureFirestoreSnapshot(resumed(h,result));
  }
  assert.equal(result.status,'COMPLETE');assert.equal(result.snapshot.documents.length,365);
  assert.equal(result.state.batch.number,4);assert.equal(result.snapshot.readTime,readTime);
  assert.equal(result.receipt.complete,true);assert.equal(result.receipt.consistent,true);
  assert.equal(validateSplitSnapshot(result.snapshot),result.snapshot);
  assert.deepEqual(result.state.batchHistory.map(row=>row.documentEntries),[92,92,92,89]);
  assert.deepEqual(result.state.batchHistory.map(row=>row.status),['PARTIAL_REVIEW','PARTIAL_REVIEW','PARTIAL_REVIEW','COMPLETE']);
  assert.equal(h.calls.filter(row=>row.operation==='listCollectionIds').length,365);
  assert.equal(result.state.totalReservedReads,h.reserves.reduce((sum,row)=>sum+row.maximumReads,0));
});

test('growth past the historical four batch plan remains partial and refuses a fifth before adapters',async()=>{
  const h=harness(370);let result=await captureFirestoreSnapshot(h.options);
  for(let number=2;number<=4;number++)result=await captureFirestoreSnapshot(resumed(h,result));
  partial(result);assert.equal(result.state.documents.length,368);
  assert.equal(result.batchPlanExhausted,true);assert.equal(result.receipt.batch.planExhausted,true);
  const before={calls:h.calls.length,reserves:h.reserves.length,checkpoints:h.checkpoints.length};
  assert.throws(()=>validateFirestoreCaptureResume(pureOptions(h,result)),/BATCH_CAPTURE_PLAN_EXHAUSTED_REQUIRES_NEW_PLAN/);
  await assert.rejects(captureFirestoreSnapshot(resumed(h,result)),/BATCH_CAPTURE_PLAN_EXHAUSTED_REQUIRES_NEW_PLAN/);
  assert.deepEqual({calls:h.calls.length,reserves:h.reserves.length,checkpoints:h.checkpoints.length},before);
});

test('missing parents consume the entry allowance and preserve orphan discovery for the next reviewed batch',async()=>{
  const h=harness(2,{maxBatchDocuments:1,pageSize:25});
  h.entries[0]={name:h.entries[0].name};
  const first=await captureFirestoreSnapshot(h.options);
  assert.equal(first.status,'PARTIAL_REVIEW');assert.equal(first.state.documents.length,0);
  assert.equal(first.state.missingDocumentPaths.length,1);assert.equal(h.calls[0].query.pageSize,1);
  validateFirestoreCaptureResume(pureOptions(h,first));
  const second=await captureFirestoreSnapshot(resumed(h,first));
  assert.equal(second.status,'PARTIAL_REVIEW');assert.equal(second.state.documents.length,1);
  const final=await captureFirestoreSnapshot(resumed(h,second));
  assert.equal(final.status,'COMPLETE');assert.equal(final.receipt.completedDiscoveryParents.length,2);
});

test('nested discovered collections survive a clean pause at the next collection page',async()=>{
  const h=harness(1,{maxBatchDocuments:1,pageSize:25});
  h.options.transport=async request=>{
    h.calls.push(clone(request));
    if(request.operation==='listCollectionIds')return request.parent.endsWith('/managementAreas/item-0000')?{collectionIds:['history']}:{};
    if(request.collectionId==='history')return {documents:[document('managementAreas/item-0000/history/revision')]};
    return {documents:[h.entries[0]]};
  };
  const first=await captureFirestoreSnapshot(h.options);
  assert.equal(first.status,'PARTIAL_REVIEW');
  const second=await captureFirestoreSnapshot(resumed(h,first));
  assert.equal(second.status,'PARTIAL_REVIEW');assert.ok(second.state.knownCollections.includes('managementAreas/item-0000/history'));
  assert.doesNotThrow(()=>validateFirestoreCaptureResume(pureOptions(h,second)));
  const final=await captureFirestoreSnapshot(resumed(h,second));
  assert.equal(final.status,'COMPLETE');assert.equal(final.snapshot.documents.length,2);
});

test('discovery pagination is retained and validated before the next descendant batch',async()=>{
  const h=harness(1,{maxBatchDocuments:1,pageSize:25});let discovery=0;
  h.options.transport=async request=>{
    h.calls.push(clone(request));
    if(request.operation==='listCollectionIds'){
      if(request.parent.endsWith('/managementAreas/item-0000')){
        discovery++;return request.body.pageToken ? {collectionIds:['two']} : {collectionIds:['one'],nextPageToken:'more'};
      }
      return {};
    }
    if(request.collectionId==='one')return {documents:[document('managementAreas/item-0000/one/a')]};
    if(request.collectionId==='two')return {documents:[document('managementAreas/item-0000/two/b')]};
    return {documents:[h.entries[0]]};
  };
  const first=await captureFirestoreSnapshot(h.options),second=await captureFirestoreSnapshot(resumed(h,first));
  assert.equal(second.status,'PARTIAL_REVIEW');assert.equal(discovery,2);
  assert.ok(second.state.knownCollections.includes('managementAreas/item-0000/one'));
  assert.ok(second.state.knownCollections.includes('managementAreas/item-0000/two'));
  validateFirestoreCaptureResume(pureOptions(h,second));
  const third=await captureFirestoreSnapshot(resumed(h,second)),final=await captureFirestoreSnapshot(resumed(h,third));
  assert.equal(final.status,'COMPLETE');assert.equal(final.snapshot.documents.length,3);
});

test('configuration changes and missing review evidence reject before any adapter',async t=>{
  const h=harness(),first=await captureFirestoreSnapshot(h.options),before=h.calls.length;
  const cases=[
    ['missing pin',value=>delete value.resumeStateSha256,/EXPLICIT_BATCH_RESUME_REVIEW_REQUIRED/],
    ['missing review',value=>delete value.resumeReviewId,/EXPLICIT_BATCH_RESUME_REVIEW_REQUIRED/],
    ['bad review',value=>value.resumeReviewId='../secret',/EXPLICIT_BATCH_RESUME_REVIEW_REQUIRED/],
    ['different state pin',value=>value.resumeStateSha256='0'.repeat(64),/RESUME_STATE_PIN_MISMATCH/],
    ['project',value=>value.projectId='sahmt-gestao-5ae66',/RESUME_CAPTURE_CONTEXT_CHANGED/],
    ['readTime',value=>value.readTime='2026-10-09T12:00:00.123457Z',/RESUME_CAPTURE_CONTEXT_CHANGED/],
    ['root scope',value=>value.rootCollections=['activities'],/RESUME_CAPTURE_CONTEXT_CHANGED/],
    ['page size',value=>value.pageSize=24,/RESUME_CAPTURE_CONTEXT_CHANGED/],
    ['collection size',value=>value.collectionPageSize=24,/RESUME_CAPTURE_CONTEXT_CHANGED/],
    ['limit',value=>value.limits={...value.limits,maxPages:2999},/RESUME_CAPTURE_CONTEXT_CHANGED/],
    ['document cap',value=>value.maxBatchDocuments=91,/RESUME_CAPTURE_CONTEXT_CHANGED/],
    ['batch plan',value=>value.maxBatches=3,/RESUME_CAPTURE_CONTEXT_CHANGED/],
    ['no explicit now',value=>delete value.nowMs,/RESUME_NOW_REQUIRED/],
    ['expired readTime',value=>value.nowMs=Date.parse('2026-10-09T13:00:00.124Z'),/READ_TIME_EXPIRED/],
    ['backward clock',value=>value.nowMs=BASE-1,/CLOCK_MOVED_BACKWARDS/]
  ];
  for(const [name,mutate,pattern]of cases)await t.test(name,()=>{
    const input=pureOptions(h,first);mutate(input);assert.throws(()=>validateFirestoreCaptureResume(input),pattern);
  });
  assert.equal(h.calls.length,before);assert.equal(h.reserves.length,4);
});

test('corrupt states are refused even if someone recomputes their outer hash',async t=>{
  const h=harness(),first=await captureFirestoreSnapshot(h.options);
  const cases=[
    ['failure state',state=>state.status='INCOMPLETE',/RESUME_REQUIRES_CLEAN_PARTIAL_REVIEW/],
    ['uncertain page',state=>state.pages[0].status='UNCERTAIN',/RESUME_PAGE_PROOFS_INVALID/],
    ['config pin',state=>state.captureConfigSha256='0'.repeat(64),/RESUME_CAPTURE_CONTEXT_CHANGED/],
    ['queue deletion',state=>state.queue.pop(),/RESUME_DISCOVERY_COVERAGE_INVALID/],
    ['queue duplicate',state=>state.queue.push(clone(state.queue[0])),/RESUME_QUEUE_INVALID/],
    ['task depth',state=>state.queue[0].depth++,/RESUME_TASK_INVALID/],
    ['task parent',state=>state.queue[0].parentPath='activities/foreign',/RESUME_TASK_INVALID/],
    ['cursor token',state=>state.active.pageToken='old-token',/RESUME_ACTIVE_CURSOR_INVALID/],
    ['cursor hash',state=>state.active.consumedTokenHashes[0]='0'.repeat(64),/RESUME_ACTIVE_CURSOR_INVALID/],
    ['unknown root',state=>state.knownCollections.push('foreign'),/RESUME_COLLECTION_COVERAGE_INVALID/],
    ['duplicate path',state=>state.documents[1]=clone(state.documents[0]),/RESUME_DOCUMENTS_INVALID/],
    ['counter',state=>state.totalReservedReads--,/RESUME_PAGE_COUNTER_INVALID/],
    ['bytes',state=>state.totalResponseBytes--,/RESUME_PAGE_COUNTER_INVALID/],
    ['attempt ordinal',state=>state.pages[0].attempt=2,/RESUME_PAGE_PROOFS_INVALID/],
    ['page chain',state=>state.pages[1].pageTokenSha256='0'.repeat(64),/RESUME_PAGE_CHAIN_INVALID/],
    ['batch counter',state=>state.batch.documentEntriesAtStart=1,/RESUME_BATCH_COUNTER_INVALID/],
    ['missing history',state=>state.batchHistory=[],/RESUME_BATCH_HISTORY_INVALID/],
    ['invented COMPLETE',state=>state.batchHistory[0].status='COMPLETE',/RESUME_BATCH_HISTORY_INVALID/],
    ['unknown field',state=>state.secret='never-log-this',/RESUME_REQUIRES_CLEAN_PARTIAL_REVIEW/]
  ];
  for(const [name,mutate,pattern]of cases)await t.test(name,()=>{
    const input=pureOptions(h,first);mutate(input.resumeState=clone(first.state));input.resumeStateSha256=snapshotDigest(input.resumeState);
    assert.throws(()=>validateFirestoreCaptureResume(input),pattern);
  });
  assert.equal(h.calls.length,4);
});

test('adversarial resume JSON never invokes accessors or admits nondata objects',async()=>{
  const h=harness(),first=await captureFirestoreSnapshot(h.options);
  let accessed=0;const input=pureOptions(h,first);input.resumeState=clone(first.state);
  Object.defineProperty(input.resumeState,'status',{enumerable:true,get(){accessed++;throw Error('private');}});
  assert.throws(()=>validateFirestoreCaptureResume(input),/RESUME_STATE_JSON_INVALID/);assert.equal(accessed,0);
  for(const mutate of [
    state=>Object.defineProperty(state,'hidden',{value:true}),
    state=>state[Symbol('hidden')]=true,
    state=>state.queue=new Array(2),
    state=>state.circular=state,
    state=>Object.setPrototypeOf(state,{status:'PARTIAL_REVIEW'}),
    state=>state.totalReservedReads=NaN
  ]){
    const value=pureOptions(h,first);value.resumeState=clone(first.state);mutate(value.resumeState);
    assert.throws(()=>validateFirestoreCaptureResume(value),/RESUME_STATE_JSON_INVALID/);
  }
});

test('failure after a reserved page preserves charges and cannot be resumed',async()=>{
  const h=harness();h.options.transport=async request=>{h.calls.push(clone(request));throw Error('private token must not escape');};
  const result=await captureFirestoreSnapshot(h.options);
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.state.totalReservedReads,25);
  assert.equal(result.state.pages[0].status,'UNCERTAIN');assert.equal(h.calls.length,1);
  assert.equal(JSON.stringify(result).includes('private token'),false);
  assert.throws(()=>validateFirestoreCaptureResume(pureOptions(h,result)),/RESUME_REQUIRES_CLEAN_PARTIAL_REVIEW/);
});

test('failed partial checkpoint becomes INCOMPLETE and never authorizes a next batch',async()=>{
  const h=harness();h.options.checkpoint=async state=>{h.checkpoints.push(clone(state));if(state.status==='PARTIAL_REVIEW')throw Error('disk failure');};
  const result=await captureFirestoreSnapshot(h.options);
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.errorCode,'CHECKPOINT_FAILED');
  assert.equal(result.state.documents.length,92);assert.equal(h.calls.length,4);
  assert.throws(()=>validateFirestoreCaptureResume(pureOptions(h,result)),/RESUME_REQUIRES_CLEAN_PARTIAL_REVIEW/);
});

test('a new batch has its own finite deadline while the original readTime is never renewed',async()=>{
  const h=harness(),first=await captureFirestoreSnapshot(h.options);
  h.setNow(BASE+200000);const second=await captureFirestoreSnapshot(resumed(h,first));
  assert.equal(second.status,'PARTIAL_REVIEW');assert.equal(second.state.readTime,readTime);
  const resumedInput=resumed(h,second);h.setNow(BASE+3600000);
  const before=h.calls.length,result=await captureFirestoreSnapshot(resumedInput);
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.errorCode,'READ_TIME_EXPIRED');assert.equal(h.calls.length,before);
});

test('same review ID cannot reopen another batch and no adapters are implicit',async()=>{
  const h=harness(),first=await captureFirestoreSnapshot(h.options),second=await captureFirestoreSnapshot(resumed(h,first,'unique-review'));
  assert.throws(()=>validateFirestoreCaptureResume(pureOptions(h,second,'unique-review')),/RESUME_BATCH_HISTORY_INVALID/);
  const input=resumed(h,first);delete input.transport;
  await assert.rejects(captureFirestoreSnapshot(input),/INJECTED_ADAPTERS_REQUIRED/);
});

test('invalid batch settings refuse before persistence or network',async()=>{
  for(const change of [{maxBatchDocuments:0},{maxBatchDocuments:1.5},{maxBatches:5},{maxBatches:0},{maxBatches:undefined},
    {maxBatchDocuments:7000},{limits:{maxDurationMs:180001}},{maxBatchDocuments:undefined,maxBatches:4}]){
    const h=harness(365,change);
    await assert.rejects(captureFirestoreSnapshot(h.options),/INVALID_BATCH_LIMITS|BATCH_DURATION_LIMIT_REQUIRED|BATCH_OPTIONS_REQUIRED_FOR_RESUME/);
    assert.equal(h.calls.length+h.reserves.length+h.checkpoints.length,0);
  }
});

test('a checkpoint completing after the batch deadline cannot return PARTIAL_REVIEW',async()=>{
  const h=harness();h.options.checkpoint=async state=>{
    h.checkpoints.push(clone(state));if(state.status==='PARTIAL_REVIEW')h.setNow(BASE+180000);
  };
  const result=await captureFirestoreSnapshot(h.options);
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.errorCode,'CAPTURE_TIME_LIMIT');
  assert.equal(result.snapshot,null);assert.equal(h.calls.length,4);assert.equal(result.state.totalReservedReads,92);
});

test('a final checkpoint completing after the batch deadline cannot return COMPLETE',async()=>{
  const h=harness(1);h.options.checkpoint=async state=>{
    h.checkpoints.push(clone(state));if(state.status==='COMPLETE')h.setNow(BASE+180000);
  };
  const result=await captureFirestoreSnapshot(h.options);
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.errorCode,'CAPTURE_TIME_LIMIT');assert.equal(result.snapshot,null);
});
