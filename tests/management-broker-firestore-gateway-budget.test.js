import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createManagementBrokerFirestoreGatewayProtocol,
  createManagementBrokerFirestoreGatewayServer
} from '../scripts/lib/management-broker-firestore-gateway.js';

// Synthetic local admission/replay storage only: not a real protected deployment.
const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66';
const BASE = Date.parse('2026-10-09T18:00:00.000Z'), UID = 'synthetic-budget-user';
const operations = ['readFaAuthorization','readFbLease','writeFbLease','invalidateFbLease'];
const clone = value => structuredClone(value);
const day = time => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
const basePolicy = () => ({
  schemaVersion:1, keyId:'synthetic-budget-key', policyVersion:'synthetic-budget-v1',
  policySha256:'a'.repeat(64), maximumTtlMs:1000, operationTimeoutMs:1000,
  maxFutureSkewMs:0, maxEnvelopeBytes:65536, maxReservationRecords:100,
  maxMeasurementAgeMs:5000, maxSnapshotAgeMs:5000, leaseMaxDurationMs:10000,
  dailyLimits:{[FA]:45000,[FB]:35000},
  limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08',
  operationReadBounds:{readFaAuthorization:1,readFbLease:1,writeFbLease:2,invalidateFbLease:2},
  enabledOperations:Object.fromEntries(operations.map(operation => [operation,true]))
});
function fixture(changes = {}) {
  let now = BASE, monotonic = 1000, sequence = 0;
  const policy = {...basePolicy(),...changes};
  const protocol = createManagementBrokerFirestoreGatewayProtocol({
    policy,secret:Buffer.alloc(32,7),now:()=>now,monotonicNow:()=>monotonic
  });
  const request = (operation = 'readFbLease', body = null) => protocol.createRequest({
    operation,requestId:(++sequence).toString(16).padStart(32,'0'),
    nonce:(sequence+1000).toString(16).padStart(32,'0'),
    issuedAtMs:now,expiresAtMs:now+1000,
    body:body ?? {uid:UID,projectId:operation==='readFaAuthorization' ? FA : FB}
  });
  const metadata = envelope => protocol.metadata(envelope);
  const admission = meta => ({
    ...clone(meta),kind:'PROTECTED_CURRENT_BROKER_ADMISSION',allowed:true,
    currentProtectedStateVerified:true,durable:true,pausedRequiresReview:false,
    authorityRevision:1,policyVersion:policy.policyVersion,policySha256:policy.policySha256,
    reservationId:'synthetic-local-reservation-'+meta.requestId,
    reservationExpiresAtMs:meta.expiresAtMs,maximumReads:policy.operationReadBounds[meta.operation],
    quotaTimezone:'America/Los_Angeles',quotaDay:day(now),
    dailyReadLimit:policy.dailyLimits[meta.projectId],metricsComplete:true,
    measurementTimeMs:now,measurementEvidenceSha256:'b'.repeat(64),
    totalReadCount:1000,outstandingReservedReads:policy.operationReadBounds[meta.operation],
    unreportedConsumedReads:0,applicationReserveReads:5000,metricLagReserveReads:2000
  });
  const claims = new Set(), events = [], debits = new Map();
  const claimRequest = async meta => {
    events.push('claim');
    const requestKey='id:'+meta.requestId,nonceKey='nonce:'+meta.nonce;
    if (claims.has(requestKey)||claims.has(nonceKey)) return {...clone(meta),status:'REPLAY',durable:true,atomic:true,retained:true};
    claims.add(requestKey);claims.add(nonceKey);
    return {...clone(meta),status:'CLAIMED',durable:true,atomic:true,retained:true};
  };
  const admit = async meta => {
    events.push('admit');
    debits.set(meta.projectId,(debits.get(meta.projectId) ?? 0)+policy.operationReadBounds[meta.operation]);
    const receipt = admission(meta);receipt.outstandingReservedReads=debits.get(meta.projectId);
    return receipt;
  };
  const adapters = Object.fromEntries(operations.map(operation => [operation,async () => {
    events.push('dispatch:'+operation);
    throw Error('SYNTHETIC_REMOTE_FAILURE_NO_PRIVATE_DETAIL');
  }]));
  return {protocol,policy,request,metadata,admission,events,debits,claims,claimRequest,admit,adapters,
    advance:amount=>{now+=amount;monotonic+=amount;},now:()=>now};
}
const denied = result => {
  assert.equal(result.status,'DENIED');
  assert.equal(result.body,null);
};
test('gateway admission keeps FA45k and FB35k separate from bounded create-only migration', () => {
  const f=fixture();
  for (const operation of ['readFaAuthorization','readFbLease']) {
    const metadata=f.metadata(f.request(operation)),receipt=f.admission(metadata),before=clone(receipt);
    assert.doesNotThrow(()=>f.protocol.validateAdmission(receipt,metadata,f.now()));
    assert.equal(receipt.dailyReadLimit,operation==='readFaAuthorization' ? 45000 : 35000);
    assert.deepEqual(receipt,before);
  }
  const request=f.request(),metadata=f.metadata(request),receipt=f.admission(metadata);
  receipt.mode='USER_AUTHORIZED_BOUNDED_FB_MIGRATION';
  receipt.reservationPersisted=true;receipt.budgetAllowed=true;
  assert.throws(()=>f.protocol.validateAdmission(receipt,metadata,f.now()));
  assert.throws(()=>fixture({dailyLimits:{[FA]:45000,[FB]:45000}}));
});

for (const [label, change] of [
  ['source project',r=>{r.projectId=FA;}],
  ['different UID',r=>{r.uid='synthetic-other-user';}],
  ['different operation',r=>{r.operation='writeFbLease';}],
  ['different request hash',r=>{r.requestHash='c'.repeat(64);}],
  ['different envelope hash',r=>{r.envelopeHash='c'.repeat(64);}],
  ['different request ID',r=>{r.requestId='c'.repeat(32);}],
  ['different nonce',r=>{r.nonce='c'.repeat(32);}],
  ['unknown authority kind',r=>{r.kind='CLIENT_BUDGET_PROOF';}],
  ['client self assertion',r=>{r.currentProtectedStateVerified=false;}],
  ['non durable reservation',r=>{r.durable=false;}],
  ['pause currently active',r=>{r.pausedRequiresReview=true;}],
  ['missing protected revision',r=>{r.authorityRevision=0;}],
  ['wrong policy version',r=>{r.policyVersion='synthetic-other-policy';}],
  ['wrong policy pin',r=>{r.policySha256='c'.repeat(64);}],
  ['expired reservation',r=>{r.reservationExpiresAtMs=BASE;}],
  ['reservation beyond envelope deadline',r=>{r.reservationExpiresAtMs=BASE+1001;}],
  ['wrong per operation bound',r=>{r.maximumReads=0;}],
  ['wrong quota timezone',r=>{r.quotaTimezone='America/Sao_Paulo';}],
  ['old quota day',r=>{r.quotaDay='2026-10-08';}],
  ['FA limit reused for FB',r=>{r.dailyReadLimit=45000;}],
  ['incomplete metric',r=>{r.metricsComplete=false;}],
  ['old metric',r=>{r.measurementTimeMs=BASE-5001;}],
  ['future metric',r=>{r.measurementTimeMs=BASE+1;}],
  ['missing measurement pin',r=>{r.measurementEvidenceSha256='missing';}],
  ['no durable debit',r=>{r.outstandingReservedReads=0;}],
  ['app margin reduced',r=>{r.applicationReserveReads=4999;}],
  ['metric lag margin reduced',r=>{r.metricLagReserveReads=1999;}],
  ['limit reached',r=>{r.totalReadCount=28000;}],
  ['unreported consumption omitted',r=>{r.unreportedConsumedReads=-1;}],
  ['alternative metrics added together',r=>{r.read_ops_count=1;r.read_count=1;}]
]) test('admission denies '+label+' without mutating the receipt',()=>{
  const f=fixture(),metadata=f.metadata(f.request()),receipt=f.admission(metadata);
  change(receipt);const before=clone(receipt);
  assert.throws(()=>f.protocol.validateAdmission(receipt,metadata,f.now()));
  assert.deepEqual(receipt,before);
});

test('wire body cannot supply reservation proof or paused flags',()=>{
  const f=fixture();
  for (const extra of [
    {proof:{reservationPersisted:true,allowed:true}},
    {budgetAllowed:true},{pausedRequiresReview:false},
    {firestoreReservation:{reservationId:'self-declared',durable:true}}
  ]) assert.throws(()=>f.request('readFbLease',{uid:UID,projectId:FB,...extra}));
  assert.deepEqual(f.events,[]);
});

test('server requires an atomic retained claim before budget admission',async()=>{
  for (const extra of [{durable:false},{atomic:false},{retained:false}]) {
    const f=fixture(),server=createManagementBrokerFirestoreGatewayServer({
      enabled:true,protocol:f.protocol,adapters:f.adapters,admitCurrentRequest:f.admit,
      claimRequest:async meta=>({...clone(meta),status:'CLAIMED',durable:true,atomic:true,retained:true,...extra})
    });
    denied(await server.receive(f.request()));
    assert.deepEqual(f.events,[]);
    assert.equal(f.debits.size,0);
  }
});

test('server consults a protected current pause after claim and denies dispatch',async()=>{
  const f=fixture(),envelope=f.request();let paused=true;
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{const receipt=await f.admit(meta);receipt.pausedRequiresReview=paused;return receipt;}
  });
  denied(await server.receive(envelope));
  assert.deepEqual(f.events,['claim','admit']);
  assert.equal(f.debits.get(FB),1);
  paused=false;
  denied(await server.receive(envelope));
  assert.deepEqual(f.events,['claim','admit','claim']);
  assert.equal(f.debits.get(FB),1); // No refund or automatic retry/re-admission.
});

test('admission failure retains durable nonce and reserved debit across server restart',async()=>{
  const f=fixture(),envelope=f.request();
  const create=()=>createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{await f.admit(meta);throw Error('SYNTHETIC_PRIVATE_FAILURE');}
  });
  denied(await create().receive(envelope));
  assert.equal(f.debits.get(FB),1);
  denied(await create().receive(envelope));
  assert.deepEqual(f.events,['claim','admit','claim']);
  assert.equal(f.debits.get(FB),1);
});

test('source pause does not transfer into FB admission or clear itself',async()=>{
  const f=fixture(),pausedProjects=new Map([[FA,true],[FB,false]]);
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{const receipt=await f.admit(meta);receipt.pausedRequiresReview=pausedProjects.get(meta.projectId);return receipt;}
  });
  denied(await server.receive(f.request('readFaAuthorization')));
  assert.equal(f.events.some(event=>event==='dispatch:readFaAuthorization'),false);
  const fbMetadata=f.metadata(f.request('readFbLease'));
  assert.doesNotThrow(()=>f.protocol.validateAdmission(f.admission(fbMetadata),fbMetadata,f.now()));
  denied(await server.receive(f.request('readFbLease')));
  assert.equal(f.events.filter(event=>event==='dispatch:readFbLease').length,1);
  assert.equal(pausedProjects.get(FA),true);
  assert.equal(pausedProjects.get(FB),false);
});

test('retained claim denies reused request ID and nonce independently',async()=>{
  const f=fixture(),original=f.request();
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,admitCurrentRequest:f.admit
  });
  denied(await server.receive(original)); // Adapter failure after admitted dispatch remains retained.
  assert.equal(f.debits.get(FB),1);
  for (const [requestId,nonce] of [
    [original.requestId,'d'.repeat(32)],['e'.repeat(32),original.nonce]
  ]) {
    const repeated=f.protocol.createRequest({
      operation:original.operation,requestId,nonce,issuedAtMs:BASE,expiresAtMs:BASE+1000,
      body:{uid:UID,projectId:FB}
    });
    denied(await server.receive(repeated));
  }
  assert.equal(f.events.filter(event=>event==='admit').length,1);
  assert.equal(f.events.filter(event=>event.startsWith('dispatch:')).length,1);
  assert.equal(f.debits.get(FB),1);
});

test('transport failure never refunds debit or automatically re-dispatches',async()=>{
  const f=fixture(),request=f.request();
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,admitCurrentRequest:f.admit
  });
  const response=await server.receive(request);denied(response);
  assert.deepEqual(f.events,['claim','admit','dispatch:readFbLease']);
  assert.equal(response.dispatched,true);
  assert.equal(f.debits.get(FB),1);
  denied(await server.receive(request));
  assert.equal(f.events.filter(event=>event.startsWith('dispatch:')).length,1);
  assert.equal(f.debits.get(FB),1);
});

test('expiry during durable claim blocks admission and does not clear the claim',async()=>{
  const f=fixture(),request=f.request();
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,admitCurrentRequest:f.admit,
    claimRequest:async meta=>{const receipt=await f.claimRequest(meta);f.advance(1000);return receipt;}
  });
  await assert.rejects(server.receive(request),error=>error.code==='FIRESTORE_GATEWAY_DEADLINE_EXCEEDED');
  assert.deepEqual(f.events,['claim']);
  assert.equal(f.claims.size,2);
  assert.equal(f.debits.size,0);
});

test('expiry during admission preserves the debit but forbids dispatch',async()=>{
  const f=fixture(),request=f.request();
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{const receipt=await f.admit(meta);f.advance(1000);return receipt;}
  });
  await assert.rejects(server.receive(request),error=>error.code==='FIRESTORE_GATEWAY_DEADLINE_EXCEEDED');
  assert.deepEqual(f.events,['claim','admit']);
  assert.equal(f.claims.size,2);
  assert.equal(f.debits.get(FB),1);
});

test('reservation can expire during admission even while envelope remains live',async()=>{
  const f=fixture(),request=f.request();
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{
      const receipt=await f.admit(meta);receipt.reservationExpiresAtMs=BASE+100;f.advance(100);return receipt;
    }
  });
  const response=await server.receive(request);denied(response);
  assert.equal(response.dispatched,false);
  assert.deepEqual(f.events,['claim','admit']);
  assert.equal(f.debits.get(FB),1);
});

test('reservation deadline shortens the real timer without renewing the envelope',async()=>{
  const f=fixture(),request=f.request();
  let dispatchDeadline,observerTimer;
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{const receipt=await f.admit(meta);receipt.reservationExpiresAtMs=BASE+20;return receipt;},
    adapters:{...f.adapters,readFbLease:async (_body,ctx)=>{
      f.events.push('dispatch:readFbLease');dispatchDeadline=ctx.deadlineMs;
      return new Promise(()=>{}); // Synthetic lost RPC; no socket or remote work.
    }}
  });
  try {
    const observed=await Promise.race([
      server.receive(request).then(()=> 'UNEXPECTED_SUCCESS',error=>error.code),
      new Promise(resolve=>{observerTimer=setTimeout(()=>resolve('OBSERVER_EXPIRED'),100);})
    ]);
    assert.equal(observed,'FIRESTORE_GATEWAY_DEADLINE_EXCEEDED');
    assert.equal(dispatchDeadline,BASE+20);
    assert.equal(request.expiresAtMs,BASE+1000);
    assert.equal(f.debits.get(FB),1);
    assert.equal(f.claims.size,2);
  } finally {clearTimeout(observerTimer);f.protocol.dispose();}
});

test('clock regression after admission is denied without discarding reserved reads',async()=>{
  const f=fixture(),request=f.request();
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{const receipt=await f.admit(meta);f.advance(-1);return receipt;}
  });
  await assert.rejects(server.receive(request),error=>error.code==='FIRESTORE_GATEWAY_CLOCK_INVALID');
  assert.deepEqual(f.events,['claim','admit']);
  assert.equal(f.debits.get(FB),1);
});

test('LA day renewal does not adopt an old reservation or resume it implicitly',async()=>{
  const f=fixture();f.advance(Date.parse('2026-10-10T06:59:59.500Z')-BASE);
  const request=f.request();
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{const receipt=await f.admit(meta);f.advance(500);return receipt;}
  });
  const response=await server.receive(request);denied(response);
  assert.equal(response.dispatched,false);
  assert.deepEqual(f.events,['claim','admit']);
  assert.equal(f.debits.get(FB),1);
});

for (const [label,change] of [
  ['reservation reuse',(receipt,sequence)=>{receipt.reservationId='synthetic-fixed-reservation';}],
  ['measurement regression',(receipt,sequence)=>{if(sequence===2)receipt.totalReadCount=999;}],
  ['protected revision regression',(receipt,sequence)=>{receipt.authorityRevision=sequence===1 ? 2 : 1;}],
  ['forgotten earlier debit',(receipt,sequence)=>{receipt.outstandingReservedReads=1;}]
]) test('server detects '+label+' across distinct signed requests',async()=>{
  const f=fixture();let sequence=0;
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{const receipt=await f.admit(meta);change(receipt,++sequence);return receipt;}
  });
  const first=await server.receive(f.request());denied(first);assert.equal(first.dispatched,true);
  const next=await server.receive(f.request());denied(next);assert.equal(next.dispatched,false);
  assert.equal(f.events.filter(event=>event.startsWith('dispatch:')).length,1);
  assert.equal(f.debits.get(FB),2); // Denial cannot refund an uncertain prior debit.
});

test('admission capacity remains finite and denial does not refund its reservation',async()=>{
  const f=fixture({maxReservationRecords:1});
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,admitCurrentRequest:f.admit
  });
  const first=await server.receive(f.request());denied(first);assert.equal(first.dispatched,true);
  const next=await server.receive(f.request());denied(next);assert.equal(next.dispatched,false);
  assert.equal(f.debits.get(FB),2);
  assert.equal(f.events.filter(event=>event.startsWith('dispatch:')).length,1);
});

test('FA consumption floor does not contaminate FB current-state admission',async()=>{
  const f=fixture();
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,adapters:f.adapters,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{const receipt=await f.admit(meta);receipt.totalReadCount=meta.projectId===FA ? 20000 : 1000;return receipt;}
  });
  for (const operation of ['readFaAuthorization','readFbLease']) {
    const response=await server.receive(f.request(operation));denied(response);assert.equal(response.dispatched,true);
  }
  assert.equal(f.debits.get(FA),1);
  assert.equal(f.debits.get(FB),1);
  assert.equal(f.events.filter(event=>event.startsWith('dispatch:')).length,2);
});

test('privileged dispatch context never adopts proof supplied in external context',async()=>{
  const f=fixture();let contextKeys;
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,claimRequest:f.claimRequest,admitCurrentRequest:f.admit,
    adapters:{...f.adapters,readFbLease:async (_body,ctx)=>{
      contextKeys=Object.keys(ctx).sort();assert.equal(Object.hasOwn(ctx,'firestoreReservation'),false);
      throw Error('SYNTHETIC_FAILURE');
    }}
  });
  const response=await server.receive(f.request(),{
    firestoreReservation:{reservationPersisted:true,allowed:true},budgetAllowed:true
  });
  denied(response);assert.equal(response.dispatched,true);
  assert.deepEqual(contextKeys,['deadlineMs','signal']);
  assert.equal(f.debits.get(FB),1);
});

for (const mode of ['timeout','abort']) test('server '+mode+' after mutation dispatch retains reconciliation requirement',async()=>{
  const f=fixture(),controller=new AbortController();
  const request=f.request('invalidateFbLease',{
    uid:UID,projectId:FB,expectedGrantId:'synthetic-local-grant',expectedLeaseVersion:1,reasonCode:'SYNTHETIC_CANCELLED'
  });
  const server=createManagementBrokerFirestoreGatewayServer({
    enabled:true,protocol:f.protocol,claimRequest:f.claimRequest,
    admitCurrentRequest:async meta=>{
      const receipt=await f.admit(meta);receipt.reservationExpiresAtMs=BASE+20;return receipt;
    },
    adapters:{...f.adapters,invalidateFbLease:async()=>{
      f.events.push('dispatch:invalidateFbLease');
      if(mode==='abort')controller.abort();
      return new Promise(()=>{});
    }}
  });
  try {
    await assert.rejects(server.receive(request,{signal:controller.signal}),error=>
      error.code===(mode==='abort' ? 'FIRESTORE_GATEWAY_ABORTED' : 'FIRESTORE_GATEWAY_DEADLINE_EXCEEDED')
      &&error.requiresReconciliation===true);
    assert.equal(f.debits.get(FB),2);
    assert.equal(f.claims.size,2);
    assert.equal(f.events.filter(event=>event.startsWith('dispatch:')).length,1);
  } finally {f.protocol.dispose();}
});
