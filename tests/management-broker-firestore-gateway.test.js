import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementBrokerFirestoreGatewayProtocol,createManagementBrokerFirestoreGatewayAdapters,
  createManagementBrokerFirestoreGatewayServer} from '../scripts/lib/management-broker-firestore-gateway.js';

import {createManagementBrokerFirestoreAdapter} from '../scripts/lib/management-broker-firestore-adapter.js';

// Synthetic JSON and callbacks only. No HTTP, OAuth, SDK, emulator or real data.
const FA='sahmt-17a16',FB='sahmt-gestao-5ae66',UID='synthetic-member',BASE=Date.parse('2026-10-09T12:00:00Z');
const operations=['readFaAuthorization','readFbLease','writeFbLease','invalidateFbLease'];
const clone=v=>JSON.parse(JSON.stringify(v));
const permissions=()=>Object.fromEntries(['admin','managementRead','managementManage','managementActivityWrite','managementIndicatorsRead',
  'managementIndicatorsWrite','managementPlansManage','documentsManage','equipmentManage','qualityManage','trainingsRead','trainingsManage','financeRead','financeWrite','financeManage'].map(k=>[k,k==='managementRead'||k==='trainingsRead']));
const policy=()=>({schemaVersion:1,keyId:'synthetic-key-v1',policyVersion:'synthetic-policy-v1',policySha256:'a'.repeat(64),maximumTtlMs:1000,
  operationTimeoutMs:1000,maxFutureSkewMs:0,maxEnvelopeBytes:65536,maxReservationRecords:100,maxMeasurementAgeMs:300000,
  maxSnapshotAgeMs:5000,leaseMaxDurationMs:10000,dailyLimits:{[FA]:45000,[FB]:35000},limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08',
  operationReadBounds:{readFaAuthorization:1,readFbLease:1,writeFbLease:2,invalidateFbLease:2},enabledOperations:Object.fromEntries(operations.map(k=>[k,true]))});
const lease=()=>({schemaVersion:1,sourceProjectId:FA,destinationProjectId:FB,faUid:UID,fbUid:UID,memberId:'synthetic-stable',leaseVersion:1,
  grantId:'synthetic-grant',sourceVersion:7,policyVersion:'synthetic-policy-v1',sourceHash:'b'.repeat(64),active:true,revoked:false,
  managementAllowed:true,role:'profissional',permissions:permissions(),memberAreaIds:[],managerAreaIds:[],documentGroups:['GENERAL'],
  sourceAuthValidAfterTimeMs:0,confirmedAtMs:BASE-100,validUntilMs:BASE+5000});
const source=()=>({schemaVersion:1,projectId:FA,fromCache:false,hasPendingWrites:false,readTimeMs:BASE,consistentRead:true,coverageComplete:true,
  productionAuthorized:true,authorizationVersion:7,sourceRevision:new Date(BASE).toISOString().replace('.000Z','.000000007Z'),
  authUser:{uid:UID,disabled:false,emailVerified:true,googleUid:'synthetic-google',tokensValidAfterTimeMs:0},
  profile:{uid:UID,memberId:'synthetic-stable',active:true,access:true,role:'profissional',permissions:permissions()},
  binding:{sourceProjectId:FA,destinationProjectId:FB,faUid:UID,fbUid:UID,memberId:'synthetic-stable'},areas:[],
  documentAccess:{active:true,groups:['GENERAL'],googleUid:'synthetic-google'}});
const body=op=>op==='readFaAuthorization'?{uid:UID,projectId:FA}:op==='writeFbLease'?{uid:UID,projectId:FB,expectedRevision:null,lease:lease()}
  :op==='invalidateFbLease'?{uid:UID,projectId:FB,expectedGrantId:'synthetic-grant',expectedLeaseVersion:1,reasonCode:'SYNTHETIC_CANCELLED'}:{uid:UID,projectId:FB};
const result=op=>op==='readFaAuthorization'?source():op==='readFbLease'?{schemaVersion:1,projectId:FB,fromCache:false,hasPendingWrites:false,readTimeMs:BASE,exists:false,revision:null,lease:null}
  :op==='writeFbLease'?{applied:true,projectId:FB,revision:new Date(BASE).toISOString().replace('.000Z','.000000009Z')}:{applied:false,matched:false,fenced:true,projectId:FB};
function fixture(options={}){
  let time=BASE,mono=0,reservations=0,sequence=0;const calls=[],claims=new Set(),p=options.policy??policy();
  const protocol=createManagementBrokerFirestoreGatewayProtocol({policy:p,secret:'synthetic-private-secret-only-32-bytes',now:()=>time,monotonicNow:()=>mono});
  const admission=async(meta,ctx)=>{
    calls.push('admission:'+meta.projectId);assert.ok(ctx.deadlineMs<=meta.expiresAtMs);assert.equal('firestoreReservation' in ctx,false);
    const value={...meta,kind:'PROTECTED_CURRENT_BROKER_ADMISSION',allowed:true,currentProtectedStateVerified:true,durable:true,pausedRequiresReview:false,
      authorityRevision:1,reservationId:'synthetic-reservation-'+(++reservations),reservationExpiresAtMs:meta.expiresAtMs,maximumReads:p.operationReadBounds[meta.operation],
      quotaTimezone:'America/Los_Angeles',quotaDay:'2026-10-09',dailyReadLimit:p.dailyLimits[meta.projectId],metricsComplete:true,measurementTimeMs:time,
      measurementEvidenceSha256:'c'.repeat(64),totalReadCount:1000,outstandingReservedReads:1000,unreportedConsumedReads:0,applicationReserveReads:5000,metricLagReserveReads:2000};
    return options.admit?options.admit(value,meta,ctx):value;
  };
  const claim=async(meta,ctx)=>{
    calls.push('claim:'+meta.direction);assert.ok(ctx.deadlineMs<=meta.expiresAtMs);
    for(const value of [meta.requestId,meta.nonce]){const key=meta.namespace+':'+meta.direction+':'+value;if(claims.has(key))return {...meta,status:'REPLAY',durable:true,atomic:true,retained:true};}
    for(const value of [meta.requestId,meta.nonce])claims.add(meta.namespace+':'+meta.direction+':'+value);
    return {...meta,status:'CLAIMED',durable:true,atomic:true,retained:true};
  };
  const adapters=Object.fromEntries(operations.map(op=>[op,async(value,ctx)=>{calls.push('dispatch:'+op);assert.deepEqual(value,body(op));
    assert.equal('firestoreReservation' in ctx,false);assert.equal('upstreamReservation' in ctx,false);assert.ok(ctx.deadlineMs<=time+1000);
    return options.dispatch?options.dispatch(op,value,ctx):result(op);} ]));
  const server=createManagementBrokerFirestoreGatewayServer({enabled:options.serverEnabled??true,protocol,claimRequest:options.claimRequest??claim,admitCurrentRequest:options.serverAdmission??admission,adapters});
  const client=createManagementBrokerFirestoreGatewayAdapters({enabled:options.clientEnabled??true,protocol,claimResponse:options.claimResponse??claim,
    admitCurrentRequest:options.clientAdmission??admission,requestPrivileged:options.transport??(async(req,ctx)=>{calls.push('transport');return server.receive(req,ctx);})});
  const request=(op='readFbLease',changes={})=>protocol.createRequest({operation:op,requestId:(++sequence).toString(16).padStart(32,'0'),
    nonce:(sequence+100).toString(16).padStart(32,'0'),issuedAtMs:time,expiresAtMs:time+1000,body:body(op),...changes});
  return {protocol,client,server,calls,claims,request,admission,advance:n=>{time+=n;mono+=n;},rewind:n=>{time-=n;},monoAdvance:n=>{mono+=n;},now:()=>time};
}
const code=value=>error=>error.code===value;

test('all four high-level methods round trip without OAuth in caller context',async t=>{
  for(const op of operations)await t.test(op,async()=>{const h=fixture(),value=await h.client[op](body(op));assert.deepEqual(value,result(op));
    assert.deepEqual(h.calls,['admission:'+body(op).projectId,'transport','claim:REQUEST','admission:'+body(op).projectId,'dispatch:'+op,'claim:RESPONSE']);});
});
test('default disabled client and server perform no callbacks',async()=>{
  const h=fixture({clientEnabled:false,serverEnabled:false});await assert.rejects(h.client.readFbLease(body('readFbLease')),code('FIRESTORE_GATEWAY_DISABLED'));
  await assert.rejects(h.server.receive(h.request()),code('FIRESTORE_GATEWAY_DISABLED'));assert.deepEqual(h.calls,[]);
});
test('operation flags deny before any callback',async()=>{
  const p=policy();p.enabledOperations.readFbLease=false;const h=fixture({policy:p});await assert.rejects(h.client.readFbLease(body('readFbLease')),code('FIRESTORE_GATEWAY_DISABLED'));assert.deepEqual(h.calls,[]);
});
test('signature, body hash, protocol and project pins reject before claim',async t=>{
  for(const change of [v=>v.body.uid='synthetic-other',v=>v.signature='0'.repeat(64),v=>v.audience='different',v=>v.protocolVersion='AUTH_GATEWAY',
    v=>v.sourceProjectId=FB,v=>v.policySha256='b'.repeat(64),v=>v.policyVersion='previous',v=>v.keyId='different',v=>v.nonce='0'.repeat(16)])await t.test('tamper',async()=>{
    const h=fixture(),v=clone(h.request());change(v);await assert.rejects(h.server.receive(v));assert.deepEqual(h.calls,[]);});
});
test('client snapshots body before its first await',async()=>{
  const h=fixture(),value=body('readFbLease'),pending=h.client.readFbLease(value);value.uid='synthetic-other';assert.deepEqual(await pending,result('readFbLease'));
});
test('wire bodies deny arbitrary URLs, tokens, e-mails, proofs and project override',async t=>{
  for(const changed of [{...body('readFbLease'),budgetAllowed:true},{...body('readFbLease'),upstreamReservation:{}},{...body('readFbLease'),accessToken:'synthetic-token'},
    {...body('readFbLease'),url:'https://example.invalid'},{...body('readFbLease'),email:'synthetic@invalid.example'},{uid:UID,projectId:FA}])await t.test('closed body',async()=>{
    const h=fixture();await assert.rejects(h.client.readFbLease(changed));assert.deepEqual(h.calls,[]);});
});
test('serialization never invokes request getters',async()=>{
  const h=fixture();let invoked=false;const value={projectId:FB};Object.defineProperty(value,'uid',{enumerable:true,get(){invoked=true;return UID;}});
  await assert.rejects(h.client.readFbLease(value));assert.equal(invoked,false);assert.deepEqual(h.calls,[]);
});
test('durable claim is required before server admission and dispatch',async()=>{
  const h=fixture({claimRequest:async meta=>({...meta,status:'CLAIMED',durable:false,atomic:true,retained:true})});const response=await h.server.receive(h.request());
  assert.equal(response.status,'DENIED');assert.equal(response.dispatched,false);assert.deepEqual(h.calls,[]);
});
test('response bound to different request is unusable',async()=>{
  const h=fixture(),a=h.request(),b=h.request();const response=await h.server.receive(a);assert.throws(()=>h.protocol.verifyResponse(response,b));
});
test('response claim failure discards a valid read result',async()=>{
  const h=fixture({claimResponse:async()=>null});await assert.rejects(h.client.readFbLease(body('readFbLease')));assert.equal(h.calls.filter(x=>x.startsWith('dispatch')).length,1);
});
test('server strips private exception strings from signed denial',async()=>{
  const h=fixture({dispatch:async()=>{throw new Error('private synthetic credential must not be printed');}}),response=await h.server.receive(h.request());
  assert.equal(response.status,'DENIED');assert.equal(response.body,null);assert.equal(JSON.stringify(response).includes('credential'),false);
});
test('source output cannot claim preview, cached, partial, stale or disabled identity',async t=>{
  for(const change of [v=>v.productionAuthorized=false,v=>v.fromCache=true,v=>v.coverageComplete=false,v=>v.consistentRead=false,
    v=>v.authorizationVersion=0,v=>v.authUser.emailVerified=false,v=>v.authUser.disabled=true,v=>v.binding.memberId='different',
    v=>v.readTimeMs=BASE-5001,v=>v.readTimeMs=BASE+1,v=>v.documentAccess.googleUid='different'])await t.test('source denied',async()=>{
    const value=source();change(value);const h=fixture({dispatch:async()=>value});const response=await h.server.receive(h.request('readFaAuthorization'));
    assert.equal(response.status,'DENIED');assert.equal(response.body,null);});
});
test('lease read keeps exact nanosecond revision and grants whole validated body',async()=>{
  const value={...result('readFbLease'),exists:true,revision:'2026-10-09T12:00:00.000000009Z',lease:lease()},h=fixture({dispatch:async()=>value});
  assert.deepEqual(await h.client.readFbLease(body('readFbLease')),value);
});
test('unknown mutation after transport loss requires reconciliation; no retry or refund',async()=>{
  let calls=0;const h=fixture({transport:async()=>{calls++;throw new Error('network lost');}});
  await assert.rejects(h.client.writeFbLease(body('writeFbLease')),error=>error.requiresReconciliation===true);assert.equal(calls,1);
});
test('known signed pre-dispatch denial has no mutation uncertainty',async()=>{
  const h=fixture({serverAdmission:async()=>({pausedRequiresReview:true})});
  await assert.rejects(h.client.writeFbLease(body('writeFbLease')),error=>error.requiresReconciliation===false);assert.equal(h.calls.filter(x=>x.startsWith('dispatch')).length,0);
});
test('failed durable response claim after write retains reconciliation requirement',async()=>{
  const h=fixture({claimResponse:async()=>null});await assert.rejects(h.client.writeFbLease(body('writeFbLease')),error=>error.requiresReconciliation===true);
  assert.equal(h.calls.filter(x=>x==='dispatch:writeFbLease').length,1);
});
test('server preserves uncertain mutation flag after dispatch failure',async()=>{
  const h=fixture({dispatch:async()=>{throw new Error('uncertain transaction');}}),request=h.request('invalidateFbLease'),response=await h.server.receive(request);
  assert.equal(response.status,'DENIED');assert.equal(response.dispatched,true);assert.equal(response.requiresReconciliation,true);
});
test('expired requests and backwards wall clock never start a callback',async()=>{
  const h=fixture(),request=h.request();h.advance(1000);await assert.rejects(h.server.receive(request));assert.deepEqual(h.calls,[]);
  const other=fixture(),valid=other.request();other.rewind(1);await assert.rejects(other.server.receive(valid),code('FIRESTORE_GATEWAY_CLOCK_INVALID'));assert.deepEqual(other.calls,[]);
});
test('monotonic deadline is enforced despite a stagnant wall clock',async()=>{
  const h=fixture({dispatch:async()=>{h.monoAdvance(1000);return result('readFbLease');}});await assert.rejects(h.client.readFbLease(body('readFbLease')));
});
test('reservation shortens the original deadline and cannot extend it',async()=>{
  const h=fixture({admit:async v=>({...v,reservationExpiresAtMs:BASE+20}),dispatch:async()=>new Promise(()=>{})});
  const start=performance.now();await assert.rejects(h.client.readFbLease(body('readFbLease')));assert.ok(performance.now()-start<500);
});
test('caller abort stops after admission while claims and debit stay retained',async()=>{
  const controller=new AbortController(),h=fixture({clientAdmission:async()=>{controller.abort();return {};}});
  await assert.rejects(h.client.readFbLease(body('readFbLease'),{signal:controller.signal}));assert.equal(h.calls.includes('transport'),false);
});
test('dispose during pending transport cannot deliver a positive result',async()=>{
  let release;const h=fixture({transport:async req=>{await new Promise(resolve=>{release=resolve;});return h.server.receive(req);}});
  const pending=h.client.readFbLease(body('readFbLease'));await new Promise(resolve=>setImmediate(resolve));h.client.dispose();release();await assert.rejects(pending,code('FIRESTORE_GATEWAY_DISABLED'));
});
test('protocol dispose rejects further signing and zeroes its private key copy',()=>{
  const h=fixture();h.protocol.dispose();assert.throws(()=>h.request(),code('FIRESTORE_GATEWAY_DISABLED'));
});
test('composition with the actual REST adapter keeps OAuth and its independent reservation only in the privileged port',async()=>{
  const events=[],requests=[];let reservation=0;
  const rest=createManagementBrokerFirestoreAdapter({enabled:true,clock:()=>BASE,policy:{schemaVersion:1,policyVersion:'synthetic-policy-v1',
    operationTimeoutMs:1000,maxResponseBytes:65536,maxResponseChunks:32,maxSnapshotAgeMs:5000,maxFutureSkewMs:0,sourceMaxAgeMs:5000,
    sourceMaxLeaseMs:10000,leaseMaxDurationMs:10000,maxReservationRecords:100,maxSourceVersions:100,
    readBudget:{dailyLimits:{[FA]:45000,[FB]:35000},limitApprovalEvidence:'USER_FA_DAILY_LIMIT_45000_2026_10_08',quotaTimezone:'America/Los_Angeles',
      maxMeasurementAgeMs:5000,applicationReserveReads:5000,metricLagReserveReads:2000,operationReadBounds:{readFaAuthorization:1,readFbLease:1,writeFbLease:2,invalidateFbLease:2}}},
    reserveFirestoreReads:async(req,ctx)=>{events.push('REST-reserve');assert.equal(ctx.upstreamReservation,undefined);return {
      schemaVersion:1,projectId:req.projectId,operation:req.operation,reservationId:'synthetic-rest-reserve-'+(++reservation),quotaTimezone:'America/Los_Angeles',
      quotaDay:'2026-10-09',dailyLimit:req.dailyLimit,pausedRequiresReview:false,metricsComplete:true,measurementTimeMs:BASE,expiresAtMs:ctx.deadlineMs,
      reservedReads:req.maximumReads,totalReadCount:1000,outstandingReservedReads:1000,unreportedConsumedReads:0,applicationReserveReads:5000,metricLagReserveReads:2000};},
    getAdminAccessToken:async(req,ctx)=>{events.push('REST-oauth');assert.equal(req.projectId,FB);return {credentialType:'google-oauth2',accessToken:'synthetic-server-only-oauth',
      expiresAtMs:BASE+10000,scopes:['https://www.googleapis.com/auth/datastore']};},
    readFaAuthUser:async()=>{throw new Error('FA not used by this synthetic composition');},
    fetchImpl:async(url,init)=>{
      events.push('REST-rpc');assert.equal(new URL(url).host,'firestore.googleapis.com');assert.equal(init.redirect,'error');
      assert.equal(init.headers.Authorization,'Bearer synthetic-server-only-oauth');const method=url.split(':').at(-1),data=JSON.parse(init.body);requests.push({method,data});
      const content=method==='beginTransaction'?{transaction:'c3ludGhldGljLXR4'}:method==='batchGet'?data.documents.map(name=>({missing:name,readTime:new Date(BASE).toISOString()}))
        :method==='commit'?{writeResults:data.writes.map(()=>({updateTime:'2026-10-09T12:00:00.000000009Z'})),commitTime:'2026-10-09T12:00:00.000000009Z'}:{};
      const response=new Response(JSON.stringify(content),{status:200,headers:{'content-type':'application/json'}});Object.defineProperty(response,'url',{value:url});return response;
    }});
  const h=fixture({dispatch:async(op,value,ctx)=>rest[op](value,ctx)});
  assert.deepEqual(await h.client.readFbLease(body('readFbLease')),result('readFbLease'));
  assert.deepEqual(await h.client.writeFbLease(body('writeFbLease')),result('writeFbLease'));
  assert.deepEqual(await h.client.invalidateFbLease(body('invalidateFbLease')),result('invalidateFbLease'));
  assert.equal(events[0],'REST-reserve');assert.equal(events.filter(x=>x==='REST-reserve').length,3);
  for(const call of requests.filter(x=>x.method==='batchGet'&&x.data.transaction)){
    assert.equal(call.data.documents.length,2);assert.match(call.data.documents[0],/\/managementAuthorizationLeases\//);
    assert.match(call.data.documents[1],/\/managementAuthorizationFences\//);
  }
  const commits=requests.filter(x=>x.method==='commit');assert.equal(commits.length,2);
  for(const call of commits){assert.equal(call.data.writes.length,1);assert.deepEqual(call.data.writes[0].currentDocument,{exists:false});
    assert.equal('updateMask' in call.data.writes[0],false);assert.equal('delete' in call.data.writes[0],false);}
  assert.equal(JSON.stringify(h.calls).includes('synthetic-server-only-oauth'),false);rest.dispose();
});
