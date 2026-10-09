import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createManagementBudgetLedger} from '../scripts/lib/management-budget-ledger.js';
import {createManagementSqliteStore} from '../scripts/lib/management-budget-sqlite-store.js';
const FA='sahmt-17a16',FB='sahmt-gestao-5ae66',ZONE='America/Los_Angeles';
const START=Date.parse('2026-10-08T19:00:00Z');
const day=time=>new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
const clone=value=>JSON.parse(JSON.stringify(value));
const basePolicy=()=>({schemaVersion:1,version:'synthetic_v1',dailyLimits:{[FA]:35000,[FB]:35000},quotaTimezone:ZONE,
  maxMeasurementAgeMs:5000,applicationReserveReads:100,metricLagReserveReads:100,reservationTtlMs:10000,
  transactionTimeoutMs:1000,maxApprovalAgeMs:5000,maxReservationRecords:200,maxDayRecords:30,maxApprovalRecords:100,
  maxSettlementRecords:400,maxObservationRecords:300,operationReadBounds:{readFaAuthorization:100,readFaSourceContext:100,
    readFbLease:10,writeFbLease:5,invalidateFbLease:5}});
function fixture({policy:overrides={},ledgerOptions={},storeOptions={},time:initial=START}={}) {
  let time=initial,sequence=0,sqlCalls=0;
  const policy={...basePolicy(),...overrides},db=new DatabaseSync(':memory:');
  const storage={sql:{exec(sql,...bindings){sqlCalls++;return db.prepare(sql).all(...bindings);}},
    transactionSync(work){db.exec('BEGIN');try{const result=work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const store=createManagementSqliteStore({storage,maxStateBytes:1024*1024,now:()=>time,...storeOptions});
  const options={enabled:true,store,policy,clock:()=>time,newReservationId:()=>`reservation_${++sequence}`,
    authorizeMeasurement:(measurement,context)=>context?.authority==='trusted-monitoring' && context.projectId===measurement.projectId,
    authorizeHumanReview:(review,context)=>context?.authority==='human' && context.projectId===review.projectId
      && context.quotaDay===review.quotaDay && context.dailyLimit===review.dailyLimit,...ledgerOptions};
  const ledger=createManagementBudgetLedger(options);
  const f={db,storage,store,policy,ledger,options,time:()=>time,setTime:next=>{time=next;},advance:delta=>{time+=delta;},sqlCalls:()=>sqlCalls,
    restart:extra=>createManagementBudgetLedger({...options,...extra}),close:()=>db.close(),
    snapshot:project=>JSON.parse(db.prepare('SELECT payload FROM sahmt_management_read_budget WHERE project_id = ?').get(project).payload),
    corrupt:(project,mutate)=>{const state=f.snapshot(project);mutate(state);db.prepare('UPDATE sahmt_management_read_budget SET payload=? WHERE project_id=?').run(JSON.stringify(state),project);}};
  f.measurement=(project=FA,overrides={})=>({projectId:project,quotaDay:day(time),metric:'read_count',totalReadCount:1000,
    measurementTimeMs:time,pointTimeMs:time,metricsComplete:true,observationId:`observation_${++sequence}`,
    observationHash:'a'.repeat(64),...overrides});
  f.measure=(project=FA,overrides={},target=ledger)=>target.recordMeasurement(f.measurement(project,overrides),
    {measurementContext:{authority:'trusted-monitoring',projectId:project}});
  f.review=async(project=FA,overrides={},target=ledger)=>{
    const status=await target.status({projectId:project});
    const review={projectId:project,quotaDay:status.quotaDay,dailyLimit:policy.dailyLimits[project],expectedPolicyHash:status.policyHash,
      expectedPauseEpoch:status.pauseEpoch,expectedRevision:status.revision,approvalId:`approval_${++sequence}`,approvedAtMs:time,
      decision:'continue',...overrides};
    return target.reviewPause(review,{approvalContext:{authority:'human',projectId:project,quotaDay:review.quotaDay,dailyLimit:review.dailyLimit}});
  };
  f.ready=async(project=FA,total=1000,target=ledger)=>{assert.equal((await f.measure(project,{totalReadCount:total},target)).ok,true);
    assert.equal((await f.review(project,{},target)).ok,true);};
  f.request=(project=FA,overrides={})=>{const operation=project===FA?'readFaAuthorization':'readFbLease';return {projectId:project,
    operation,maximumReads:policy.operationReadBounds[operation],dailyLimit:policy.dailyLimits[project],quotaTimezone:ZONE,
    quotaDay:day(time),applicationReserveReads:policy.applicationReserveReads,metricLagReserveReads:policy.metricLagReserveReads,...overrides};};
  f.reserve=(project=FA,overrides={},target=ledger)=>target.reserveFirestoreReads(f.request(project,overrides));
  f.settle=(receipt,outcome='consumed',overrides={},target=ledger)=>target.settleReservation({projectId:receipt.projectId,
    reservationId:receipt.reservationId,settlementId:`settlement_${++sequence}`,outcome,completedAtMs:outcome==='consumed'?time:null,...overrides});
  return f;
}
const denial=(promise,code)=>assert.rejects(promise,error=>error.code===code);

test('disabled factory has no store, metric, or authority side effect',()=>{
  const result=createManagementBudgetLedger({enabled:false,store:{transact(){throw Error('called');}}});
  assert.deepEqual(result,{enabled:false});
});
for(const [name,value] of [['maxMeasurementAgeMs',300001],['reservationTtlMs',120001],['transactionTimeoutMs',120001],
  ['applicationReserveReads',0],['metricLagReserveReads',0],['maxObservationRecords',0],['maxDayRecords',0]]) {
  test(`rejects explicit invalid policy ${name}`,()=>assert.throws(()=>fixture({policy:{[name]:value}}),error=>error.code==='LEDGER_POLICY_INVALID'));
}
test('requires independent caps and a measurement authority, accepts only 35k or 45k',()=>{
  assert.throws(()=>fixture({policy:{dailyLimits:{[FA]:45000}}}),error=>error.code==='LEDGER_POLICY_REQUIRED');
  assert.throws(()=>fixture({policy:{dailyLimits:{[FA]:50000,[FB]:35000}}}),error=>error.code==='LEDGER_POLICY_REQUIRED');
  assert.throws(()=>fixture({ledgerOptions:{authorizeMeasurement:undefined}}),error=>error.code==='LEDGER_MEASUREMENT_AUTHORITY_REQUIRED');
});
test('rejects unknown policy fields and unbounded or wrong operations',()=>{
  assert.throws(()=>fixture({policy:{unexpected:true}}),error=>error.code==='LEDGER_POLICY_REQUIRED');
  assert.throws(()=>fixture({policy:{operationReadBounds:{readEverything:1}}}),error=>error.code==='LEDGER_OPERATION_BOUND_INVALID');
  assert.throws(()=>fixture({policy:{operationReadBounds:{readFaAuthorization:34900}}}),error=>error.code==='LEDGER_OPERATION_BOUND_INVALID');
});
test('bootstrap is durable and paused; a new complete measurement never removes pause',async()=>{
  const f=fixture();try{
    const initial=await f.ledger.status({projectId:FA});assert.equal(initial.pausedRequiresReview,true);assert.equal(initial.pauseEpoch,1);
    assert.equal(initial.measurement,null);await f.measure();const next=await f.restart().status({projectId:FA});
    assert.equal(next.pausedRequiresReview,true);assert.equal(next.measurement.totalReadCount,1000);
    await denial(f.reserve(),'LEDGER_HUMAN_REVIEW_REQUIRED');
  }finally{f.close();}
});
test('FA pause never inherits into FB; FB own approval and debit remain independent',async()=>{
  const f=fixture();try{
    await f.measure(FA,{totalReadCount:50106});await f.ready(FB);const receipt=await f.reserve(FB);
    assert.equal(receipt.projectId,FB);assert.equal(receipt.outstandingReservedReads,10);
    assert.equal((await f.ledger.status({projectId:FA})).pausedRequiresReview,true);
    assert.equal((await f.ledger.status({projectId:FB})).pausedRequiresReview,false);
  }finally{f.close();}
});
test('45k is separately pinned to FA and its human approval, never raises FB cap',async()=>{
  const f=fixture({policy:{dailyLimits:{[FA]:45000,[FB]:35000}}});try{
    await f.ready(FA,40000);const receipt=await f.reserve();assert.equal(receipt.dailyLimit,45000);
    const fb=await f.measure(FB,{totalReadCount:40000});assert.equal(fb.pausedRequiresReview,true);assert.equal(fb.dailyLimit,35000);
    await denial(f.review(FA,{dailyLimit:35000}),'LEDGER_REVIEW_INVALID');
    await denial(f.review(FA,{expectedPolicyHash:'b'.repeat(64)}),'LEDGER_REVIEW_INVALID');
  }finally{f.close();}
});
test('private human authority and same project are mandatory',async()=>{
  const f=fixture();try{
    await f.measure();const s=await f.ledger.status({projectId:FA});const review={projectId:FA,quotaDay:s.quotaDay,dailyLimit:35000,
      expectedPolicyHash:s.policyHash,expectedPauseEpoch:s.pauseEpoch,expectedRevision:s.revision,approvalId:'approval_private',
      approvedAtMs:f.time(),decision:'continue'};
    await denial(f.ledger.reviewPause(review),'LEDGER_HUMAN_APPROVAL_REQUIRED');
    await denial(f.ledger.reviewPause(review,{approvalContext:{authority:'human',projectId:FB,quotaDay:s.quotaDay,dailyLimit:35000}}),'LEDGER_HUMAN_APPROVAL_REQUIRED');
    assert.equal((await f.ledger.status({projectId:FA})).pausedRequiresReview,true);
  }finally{f.close();}
});
for(const [label,overrides,code] of [
  ['incomplete',{metricsComplete:false},'LEDGER_MEASUREMENT_INCOMPLETE'],
  ['missing proof',{observationHash:''},'LEDGER_MEASUREMENT_INCOMPLETE'],
  ['query time used instead of point',{pointTimeMs:START-1},'LEDGER_MEASUREMENT_INCOMPLETE'],
  ['future',{measurementTimeMs:START+1,pointTimeMs:START+1},'LEDGER_MEASUREMENT_STALE'],
  ['stale',{measurementTimeMs:START-5001,pointTimeMs:START-5001},'LEDGER_MEASUREMENT_STALE'],
  ['wrong day',{quotaDay:'2026-10-07'},'LEDGER_MEASUREMENT_INCOMPLETE'],
  ['negative count',{totalReadCount:-1},'LEDGER_MEASUREMENT_INCOMPLETE'],
  ['unexpected raw data',{documents:[]},'LEDGER_MEASUREMENT_INCOMPLETE'],
]) test(`measurement ${label} persists a stop and fresh measurement cannot clear it`,async()=>{
  const f=fixture();try{
    await f.ready();const bad=await f.measure(FA,overrides);assert.equal(bad.ok,false);assert.equal(bad.code,code);
    assert.equal((await f.measure()).pausedRequiresReview,true);await denial(f.reserve(),'LEDGER_HUMAN_REVIEW_REQUIRED');
  }finally{f.close();}
});
test('metric count and timestamp regression pause; alternatives are never summed or switched',async()=>{
  const f=fixture();try{
    await f.ready();await f.measure(FA,{totalReadCount:30000});
    const lower=await f.measure(FA,{totalReadCount:1000});assert.equal(lower.code,'LEDGER_MEASUREMENT_REGRESSED');
    assert.equal((await f.ledger.status({projectId:FA})).measurement.totalReadCount,30000);
    const alternative=await f.measure(FA,{metric:'read_ops_count',totalReadCount:30000});assert.equal(alternative.code,'LEDGER_METRIC_CHANGED');
    f.advance(10);const older=await f.measure(FA,{totalReadCount:30000,measurementTimeMs:START-1,pointTimeMs:START-1});
    assert.equal(older.code,'LEDGER_MEASUREMENT_REGRESSED');
  }finally{f.close();}
});
test('untrusted observation and authority failure persist stop with sanitized code',async()=>{
  const f=fixture();try{
    await f.ready();const untrusted=await f.ledger.recordMeasurement(f.measurement());assert.equal(untrusted.code,'LEDGER_MEASUREMENT_AUTHORITY_INVALID');
    await f.measure();await f.review();const failure=f.restart({authorizeMeasurement(){throw Error('private-monitoring-secret');}});
    const failed=await failure.recordMeasurement(f.measurement());assert.deepEqual(failed,{ok:false,code:'LEDGER_MEASUREMENT_UNAVAILABLE'});
    assert.equal((await f.ledger.status({projectId:FA})).pausedRequiresReview,true);
  }finally{f.close();}
});
test('observation exact replay is harmless, changed ID payload stops, and proof is pinned across awaits',async()=>{
  const f=fixture();try{
    const observation=f.measurement();await f.ledger.recordMeasurement(observation,{measurementContext:{authority:'trusted-monitoring',projectId:FA}});
    assert.equal((await f.ledger.recordMeasurement(observation,{measurementContext:{authority:'trusted-monitoring',projectId:FA}})).ok,true);
    const conflict=await f.ledger.recordMeasurement({...observation,totalReadCount:1001},{measurementContext:{authority:'trusted-monitoring',projectId:FA}});
    assert.equal(conflict.code,'LEDGER_OBSERVATION_REPLAY_CONFLICT');
    const pinned=f.measurement();let unblock;const slow=f.restart({authorizeMeasurement:()=>new Promise(resolve=>{unblock=resolve;})});
    const pending=slow.recordMeasurement(pinned);await Promise.resolve();await Promise.resolve();pinned.projectId=FB;pinned.totalReadCount=35000;
    unblock(true);const result=await pending;assert.equal(result.projectId,FA);assert.equal(result.measurement.totalReadCount,1000);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sahmt_management_read_budget WHERE project_id=?').get(FB).n,0);
  }finally{f.close();}
});
test('approval pins revision and epoch, expires, and cannot be replayed after pause',async()=>{
  const f=fixture();try{
    await f.measure();const s=await f.ledger.status({projectId:FA});
    const changed=await f.review(FA,{expectedRevision:s.revision+1});assert.equal(changed.code,'LEDGER_REVIEW_CONTEXT_CHANGED');
    const stale=await f.review(FA,{approvedAtMs:START-5001});assert.equal(stale.code,'LEDGER_REVIEW_CONTEXT_CHANGED');
    await f.review(FA,{approvalId:'same_approval'});await f.measure(FA,{metricsComplete:false});await f.measure();
    const replay=await f.review(FA,{approvalId:'same_approval'});assert.equal(replay.code,'LEDGER_APPROVAL_REUSED');
    const oldEpoch=await f.review(FA,{expectedPauseEpoch:s.pauseEpoch});assert.equal(oldEpoch.code,'LEDGER_REVIEW_CONTEXT_CHANGED');
    assert.equal((await f.ledger.status({projectId:FA})).pausedRequiresReview,true);
  }finally{f.close();}
});
test('receipt is issued after atomic commit and matches existing guard fields',async()=>{
  const f=fixture();try{
    await f.ready();const receipt=await f.reserve();assert.equal(f.snapshot(FA).reservations.length,1);
    assert.deepEqual(Object.keys(receipt).sort(),['schemaVersion','projectId','operation','reservationId','quotaDay','quotaTimezone','dailyLimit',
      'pausedRequiresReview','metricsComplete','measurementTimeMs','expiresAtMs','reservedReads','totalReadCount','outstandingReservedReads',
      'unreportedConsumedReads','applicationReserveReads','metricLagReserveReads'].sort());
    assert.equal(receipt.outstandingReservedReads,100);assert.equal(receipt.unreportedConsumedReads,0);assert.equal(receipt.totalReadCount,1000);
    assert.equal(receipt.expiresAtMs,START+10000);assert.equal(receipt.pausedRequiresReview,false);
  }finally{f.close();}
});
for(const [label,overrides] of [['wrong project operation',{operation:'readFbLease'}],['understated cost',{maximumReads:1}],
  ['missing app margin',{applicationReserveReads:0}],['missing lag margin',{metricLagReserveReads:0}],['wrong cap',{dailyLimit:45000}],
  ['wrong zone',{quotaTimezone:'America/Sao_Paulo'}],['extra field',{token:'private'}]])
  test(`reservation rejects ${label} before persistent admission`,async()=>{
    const f=fixture();try{await f.ready();await denial(f.reserve(FA,overrides),'LEDGER_RESERVATION_REQUEST_INVALID');
      assert.equal(f.snapshot(FA).reservations.length,0);}finally{f.close();}
  });
test('fresh point required at admission; day or expired point persists pause',async()=>{
  const f=fixture();try{
    await f.ready();f.advance(5001);await denial(f.reserve(),'LEDGER_MEASUREMENT_STALE');
    assert.equal((await f.ledger.status({projectId:FA})).pausedRequiresReview,true);await f.measure();await denial(f.reserve(),'LEDGER_HUMAN_REVIEW_REQUIRED');
    await f.review();await denial(f.reserve(FA,{quotaDay:'2026-10-07'}),'LEDGER_REQUEST_DAY_CHANGED');
  }finally{f.close();}
});
test('two restarted callers serialize a near-cap admission without overspending',async()=>{
  const f=fixture();try{
    await f.ready(FA,34699);const other=f.restart();const result=await Promise.allSettled([f.reserve(),f.reserve(FA,{},other)]);
    assert.equal(result.filter(value=>value.status==='fulfilled').length,1);assert.equal(result.filter(value=>value.status==='rejected').length,1);
    const state=f.snapshot(FA);assert.equal(state.reservations.length,1);assert.equal(state.pausedRequiresReview,true);
    assert.equal(result.find(value=>value.status==='rejected').reason.code,'LEDGER_MARGIN_EXHAUSTED');
  }finally{f.close();}
});
test('a higher metric keeps every prior debit; no presumed metric absorption frees capacity',async()=>{
  const f=fixture();try{
    await f.ready();const receipt=await f.reserve();await f.settle(receipt);const high=await f.measure(FA,{totalReadCount:34650});
    assert.equal(high.unreportedConsumedReads,100);assert.equal(high.measurement.totalReadCount,34650);
    await denial(f.reserve(),'LEDGER_MARGIN_EXHAUSTED');assert.equal(f.snapshot(FA).reservations.length,1);
  }finally{f.close();}
});
test('unknown outcome and expired reservation retain full charge after restart',async()=>{
  const f=fixture();try{
    await f.ready();const receipt=await f.reserve();await f.settle(receipt,'unknown');f.advance(20000);await f.measure();await f.review();
    const restarted=f.restart();const status=await restarted.status({projectId:FA});assert.equal(status.outstandingReservedReads,100);
    const next=await f.reserve(FA,{},restarted);assert.equal(next.outstandingReservedReads,200);
    assert.notEqual(next.reservationId,receipt.reservationId);assert.equal(f.snapshot(FA).reservations[0].state,'unknown');
  }finally{f.close();}
});
test('settlement exact replay is idempotent, conflicts deny, and consumption never discounts cost',async()=>{
  const f=fixture();try{
    await f.ready();const receipt=await f.reserve();const settled=await f.settle(receipt,'unknown',{settlementId:'settlement_one'});
    assert.equal(settled.outstandingReservedReads,100);assert.equal(settled.unreportedConsumedReads,0);
    const replay=await f.settle(receipt,'unknown',{settlementId:'settlement_one'});assert.deepEqual(replay,{ok:true,alreadySettled:true});
    const conflict=await f.settle(receipt,'consumed',{settlementId:'settlement_one'});assert.equal(conflict.code,'LEDGER_SETTLEMENT_REPLAY_CONFLICT');
    const consumed=await f.settle(receipt);assert.equal(consumed.outstandingReservedReads,0);assert.equal(consumed.unreportedConsumedReads,100);
    assert.equal((await f.settle(receipt)).code,'LEDGER_SETTLEMENT_CONFLICT');
    assert.equal((await f.settle({...receipt,reservationId:'missing'})).code,'LEDGER_RESERVATION_UNKNOWN');
  }finally{f.close();}
});
test('negative or future settlement timestamps deny without modifying debits',async()=>{
  const f=fixture();try{
    await f.ready();const receipt=await f.reserve();assert.equal((await f.settle(receipt,'consumed',{completedAtMs:START+1})).code,'LEDGER_SETTLEMENT_CONFLICT');
    assert.equal((await f.settle(receipt,'consumed',{completedAtMs:START-1})).code,'LEDGER_SETTLEMENT_CONFLICT');
    await denial(f.settle(receipt,'unknown',{completedAtMs:START}),'LEDGER_SETTLEMENT_INVALID');
    assert.equal((await f.ledger.status({projectId:FA})).outstandingReservedReads,100);
  }finally{f.close();}
});
test('daily renewal pauses both only when each project is used; unknown debit crosses days',async()=>{
  const f=fixture({time:Date.parse('2026-10-09T06:59:59Z')});try{
    await f.ready();const unknown=await f.reserve();const consumed=await f.reserve();await f.settle(consumed);
    assert.equal(unknown.expiresAtMs,Date.parse('2026-10-09T07:00:00Z'));
    f.setTime(Date.parse('2026-10-09T07:00:01Z'));const next=await f.ledger.status({projectId:FA});
    assert.equal(next.quotaDay,'2026-10-09');assert.equal(next.pausedRequiresReview,true);assert.equal(next.outstandingReservedReads,100);
    assert.equal(next.unreportedConsumedReads,0);await f.measure();await denial(f.reserve(),'LEDGER_HUMAN_REVIEW_REQUIRED');await f.review();
    assert.equal((await f.reserve()).outstandingReservedReads,200);assert.equal(f.snapshot(FA).reservations.length,3);
  }finally{f.close();}
});
test('unknown operation completed the next day remains fully charged on that day',async()=>{
  const f=fixture({time:Date.parse('2026-10-09T06:59:59Z')});try{
    await f.ready();const receipt=await f.reserve();f.advance(2000);const state=await f.settle(receipt);
    assert.equal(state.pausedRequiresReview,true);assert.equal(state.unreportedConsumedReads,100);assert.equal(state.outstandingReservedReads,0);
  }finally{f.close();}
});
test('unique reservation tombstones survive expiry, completion, and restart; no ID reuse',async()=>{
  const f=fixture();try{
    await f.ready();const receipt=await f.reserve();await f.settle(receipt);f.advance(20000);await f.measure();await f.review();
    const restarted=f.restart({newReservationId:()=>receipt.reservationId});await denial(f.reserve(FA,{},restarted),'LEDGER_RESERVATION_REUSED');
    assert.equal(f.snapshot(FA).reservations.length,1);assert.equal(f.snapshot(FA).pausedRequiresReview,true);
  }finally{f.close();}
});
for(const [record,label] of [['maxReservationRecords','reservation'],['maxObservationRecords','observation'],
  ['maxApprovalRecords','approval'],['maxSettlementRecords','settlement'],['maxDayRecords','day']])
  test(`bounded ${label} retention fails closed and never deletes tombstones`,async()=>{
    const f=fixture({policy:{[record]:1}});try{
      await f.ready();let result;
      if(label==='reservation'){await f.reserve();await denial(f.reserve(),'LEDGER_RESERVATION_CAPACITY_EXCEEDED');}
      if(label==='observation'){result=await f.measure();assert.equal(result.code,'LEDGER_OBSERVATION_CAPACITY_EXCEEDED');}
      if(label==='approval'){result=await f.review();assert.equal(result.code,'LEDGER_APPROVAL_CAPACITY_EXCEEDED');}
      if(label==='settlement'){const receipt=await f.reserve();await f.settle(receipt,'unknown');result=await f.settle(receipt);assert.equal(result.code,'LEDGER_SETTLEMENT_CAPACITY_EXCEEDED');}
      if(label==='day'){f.advance(24*60*60*1000);result=await f.ledger.status({projectId:FA});assert.equal(result.pauseReason,'LEDGER_DAY_CAPACITY_EXCEEDED');}
      const state=f.snapshot(FA);assert.equal(state.pausedRequiresReview,true);
      assert.equal(state[{reservation:'reservations',observation:'observations',approval:'approvals',settlement:'settlements',day:'days'}[label]].length,1);
    }finally{f.close();}
  });
for(const [label,mutate] of [
  ['project',state=>{state.projectId=FB;}],['policy',state=>{state.policyHash='b'.repeat(64);}],
  ['unexpected key',state=>{state.credentials='private';}],['approval reference',state=>{state.days[0].approvalId='missing';}],
  ['observation proof',state=>{state.observations[0].observationHash='b'.repeat(64);}],
  ['observation count pin',state=>{state.days[0].measurement.totalReadCount=999;state.days[0].maximumObservedReadCount=999;}],
  ['duplicate observation',state=>{state.observations.push(clone(state.observations[0]));}],
]) test(`corrupt persisted ${label} is denied instead of reset`,async()=>{
  const f=fixture();try{
    await f.ready();f.corrupt(FA,mutate);const before=f.db.prepare('SELECT payload FROM sahmt_management_read_budget WHERE project_id=?').get(FA).payload;
    await denial(f.restart().status({projectId:FA}),'LEDGER_STORAGE_UNAVAILABLE');
    assert.equal(f.db.prepare('SELECT payload FROM sahmt_management_read_budget WHERE project_id=?').get(FA).payload,before);
  }finally{f.close();}
});
test('corrupt settlement state or unproved consumption cannot free a reservation',async()=>{
  const f=fixture();try{
    await f.ready();await f.reserve();f.corrupt(FA,state=>{state.reservations[0].state='consumed';state.reservations[0].completedAtMs=START;});
    await denial(f.restart().status({projectId:FA}),'LEDGER_STORAGE_UNAVAILABLE');
  }finally{f.close();}
});
test('existing SQLite JSON null cannot be treated as a new project ledger',async()=>{
  const f=fixture();try{
    await f.ledger.status({projectId:FA});f.db.prepare('UPDATE sahmt_management_read_budget SET payload=? WHERE project_id=?').run('null',FA);
    await denial(f.restart().status({projectId:FA}),'LEDGER_STORAGE_UNAVAILABLE');
    assert.equal(f.db.prepare('SELECT payload FROM sahmt_management_read_budget WHERE project_id=?').get(FA).payload,'null');
  }finally{f.close();}
});
test('policy cap change never overwrites an existing ledger or clears its pause',async()=>{
  const f=fixture();try{
    await f.ready();const changed=f.restart({policy:{...f.policy,dailyLimits:{[FA]:45000,[FB]:35000}}});
    await denial(changed.status({projectId:FA}),'LEDGER_STORAGE_UNAVAILABLE');assert.equal(f.snapshot(FA).dailyLimit,35000);
  }finally{f.close();}
});
test('pre-abort and expired context cause zero SQL admission',async()=>{
  const f=fixture();try{
    const controller=new AbortController();controller.abort();await denial(f.ledger.status({projectId:FA},{signal:controller.signal}),'LEDGER_OPERATION_CANCELLED');
    await denial(f.ledger.status({projectId:FA},{deadlineMs:START}),'LEDGER_OPERATION_CANCELLED');assert.equal(f.sqlCalls(),0);
  }finally{f.close();}
});
test('store hangs are bounded even with stationary logical clock',async()=>{
  const f=fixture({policy:{transactionTimeoutMs:20}});try{
    const hanging=f.restart({store:{transact:()=>new Promise(()=>{})}});const start=performance.now();
    await denial(hanging.status({projectId:FA}),'LEDGER_OPERATION_CANCELLED');assert.ok(performance.now()-start<250);
  }finally{f.close();}
});
test('timed-out storage result preserves late committed debit, never returns receipt',async()=>{
  const f=fixture({policy:{transactionTimeoutMs:20}});try{
    await f.ready();let committed;
    const late=f.restart({store:{async transact(project,transform,context){committed=await f.store.transact(project,transform,context);
      await new Promise(resolve=>setTimeout(resolve,40));return committed;}}});
    await denial(f.reserve(FA,{},late),'LEDGER_OPERATION_CANCELLED');assert.equal(f.snapshot(FA).reservations.length,1);
    assert.equal((await f.ledger.status({projectId:FA})).outstandingReservedReads,100);
  }finally{f.close();}
});
test('unconfirmed store result fails closed while committed debit remains',async()=>{
  const f=fixture();try{
    await f.ready();const lying=f.restart({store:{async transact(project,transform,context){const output=await f.store.transact(project,transform,context);
      return {...output,reservedReads:0};}}});
    await denial(f.reserve(FA,{},lying),'LEDGER_COMMIT_UNCONFIRMED');assert.equal(f.snapshot(FA).reservations.length,1);
  }finally{f.close();}
});
test('store cannot fabricate a receipt without invoking the transform',async()=>{
  const f=fixture();try{
    const fake=f.restart({store:{transact:async()=>({})}});await denial(fake.status({projectId:FA}),'LEDGER_COMMIT_UNCONFIRMED');assert.equal(f.sqlCalls(),0);
  }finally{f.close();}
});
test('inputs and authority copies cannot change a queued reservation or approval',async()=>{
  const f=fixture();try{
    await f.ready();let unblock;const delayed=f.restart({store:{async transact(project,transform,context){await new Promise(resolve=>{unblock=resolve;});return f.store.transact(project,transform,context);}}});
    const request=f.request(),pending=delayed.reserveFirestoreReads(request);await Promise.resolve();await Promise.resolve();
    request.projectId=FB;request.maximumReads=1;unblock();const receipt=await pending;assert.equal(receipt.projectId,FA);assert.equal(receipt.reservedReads,100);
    const status=await f.ledger.status({projectId:FA}),review={projectId:FA,quotaDay:status.quotaDay,dailyLimit:35000,
      expectedPolicyHash:status.policyHash,expectedPauseEpoch:status.pauseEpoch,expectedRevision:status.revision,approvalId:'approval_pinned',
      approvedAtMs:f.time(),decision:'continue'};
    const authorityMutates=f.restart({authorizeHumanReview:async proof=>{proof.projectId=FB;proof.dailyLimit=45000;return true;}});
    const result=await authorityMutates.reviewPause(review);assert.equal(result.ok,true);assert.equal(result.projectId,FA);
  }finally{f.close();}
});
test('accessor, sparse, and non-JSON inputs fail before authority or storage',async()=>{
  const f=fixture();try{
    let reads=0;const input={get projectId(){reads++;return FA;}};
    await denial(f.ledger.recordMeasurement(input),'LEDGER_MEASUREMENT_INCOMPLETE');assert.equal(reads,0);assert.equal(f.sqlCalls(),0);
    await denial(f.ledger.reserveFirestoreReads({...f.request(),untrusted:[,1]}),'LEDGER_RESERVATION_REQUEST_INVALID');
    await denial(f.ledger.reserveFirestoreReads({...f.request(),untrusted:Infinity}),'LEDGER_RESERVATION_REQUEST_INVALID');
  }finally{f.close();}
});
test('SQLite byte limit denies a reservation atomically, retains earlier state and approvals',async()=>{
  const f=fixture({storeOptions:{maxStateBytes:1300}});try{
    await f.ready();const before=f.snapshot(FA);await denial(f.reserve(),'LEDGER_STORAGE_UNAVAILABLE');
    assert.deepEqual(f.snapshot(FA),before);
  }finally{f.close();}
});

test('changing FA cap or costs does not invalidate FB durable policy, session approval, or budget',async()=>{
  const f=fixture();try{
    await f.ready();await f.ready(FB);const fbHash=(await f.ledger.status({projectId:FB})).policyHash;
    const changed=f.restart({policy:{...f.policy,dailyLimits:{[FA]:45000,[FB]:35000},
      operationReadBounds:{...f.policy.operationReadBounds,readFaAuthorization:120}}});
    assert.equal(changed.policyHashes[FB],fbHash);
    const fb=await changed.status({projectId:FB});assert.equal(fb.pausedRequiresReview,false);assert.equal(fb.dailyLimit,35000);
    assert.equal((await f.reserve(FB,{},changed)).reservedReads,10);
    await denial(changed.status({projectId:FA}),'LEDGER_STORAGE_UNAVAILABLE');
  }finally{f.close();}
});

for(const limit of [35000,45000])test(`projected total exactly ${limit} pauses instead of admitting the next unit`,async()=>{
  const f=fixture({policy:{dailyLimits:{[FA]:limit,[FB]:35000}}});try{
    await f.ready(FA,limit-300);await denial(f.reserve(),'LEDGER_MARGIN_EXHAUSTED');
    assert.equal(f.snapshot(FA).reservations.length,0);assert.equal(f.snapshot(FA).pausedRequiresReview,true);
  }finally{f.close();}
});

test('reservation TTL also expires monotonically while logical clock is stationary; debit remains',async()=>{
  const f=fixture({policy:{reservationTtlMs:5}});try{
    await f.ready();const delayed=f.restart({store:{async transact(project,transform,context){const output=await f.store.transact(project,transform,context);
      await new Promise(resolve=>setTimeout(resolve,20));return output;}}});
    await denial(f.reserve(FA,{},delayed),'LEDGER_RECEIPT_EXPIRED');
    assert.equal(f.snapshot(FA).reservations.length,1);assert.equal((await f.ledger.status({projectId:FA})).outstandingReservedReads,100);
  }finally{f.close();}
});
