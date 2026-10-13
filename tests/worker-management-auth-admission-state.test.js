import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagementBrokerAdmissionState,createManagementAuthWorkerRuntime,createManagementGatewayResponseNonceClaimer} from '../worker-management-auth/admission-state.js';

function stateHarness(){
  const rows=new Map(),nonces=new Map();let schema=false;
  const sql={exec(statement,...values){
    if(statement.startsWith('CREATE TABLE')){schema=true;return {toArray:()=>[]};}
    assert.equal(schema,true);
    if(statement.startsWith('DELETE FROM active_requests WHERE expires_at_ms')){
      for(const [id,row] of rows)if(row.expiresAtMs<=values[0])rows.delete(id);return {toArray:()=>[]};
    }
    if(statement.startsWith('SELECT COUNT(*) AS count FROM gateway_response_nonces'))return {one:()=>({count:nonces.size})};
    if(statement.startsWith('SELECT COUNT(*)'))return {one:()=>({count:rows.size})};
    if(statement.startsWith('INSERT INTO active_requests')){
      if(rows.has(values[0]))throw new Error('duplicate slot');rows.set(values[0],{expiresAtMs:values[1]});return {toArray:()=>[]};
    }
    if(statement.startsWith('DELETE FROM active_requests WHERE slot_id')){rows.delete(values[0]);return {toArray:()=>[]};}
    if(statement.startsWith('DELETE FROM gateway_response_nonces WHERE retain_until_ms')){
      for(const [hash,expiresAt] of nonces)if(expiresAt<=values[0])nonces.delete(hash);return {toArray:()=>[]};
    }
    if(statement.startsWith('SELECT nonce_hash FROM gateway_response_nonces'))
      return {toArray:()=>nonces.has(values[0])?[{nonce_hash:values[0]}]:[]};
    if(statement.startsWith('INSERT INTO gateway_response_nonces')){
      if(nonces.has(values[0]))throw new Error('duplicate nonce');nonces.set(values[0],values[1]);return {toArray:()=>[]};
    }
    throw new Error('unrecognized query');
  }};
  const state=new ManagementBrokerAdmissionState({storage:{sql}});
  const binding={idFromName:name=>({name}),get:id=>({fetch:request=>state.fetch(request)})};
  return {state,rows,nonces,binding};
}
const request=(path,body)=>new Request('https://broker-state.internal'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('Durable Object admission is bounded, expires stale slots and releases idempotently',async()=>{
  const {state,rows}=stateHarness();
  const admit=body=>state.fetch(request('/admit',body));
  assert.equal((await admit({slotId:'slot_request_000001',nowMs:100,expiresAtMs:200,maxConcurrent:1})).status,200);
  assert.equal((await admit({slotId:'slot_request_000002',nowMs:100,expiresAtMs:200,maxConcurrent:1})).status,429);
  assert.equal((await admit({slotId:'slot_request_000003',nowMs:200,expiresAtMs:300,maxConcurrent:1})).status,200);
  assert.equal(rows.size,1);
  await state.fetch(request('/release',{slotId:'slot_request_000003'}));
  await state.fetch(request('/release',{slotId:'slot_request_000003'}));
  assert.equal(rows.size,0);
});

test('Durable Object accepts only fixed internal paths and bounded slot metadata',async()=>{
  const {state}=stateHarness();
  assert.equal((await state.fetch(new Request('https://broker-state.internal/admit',{method:'GET'}))).status,405);
  assert.equal((await state.fetch(request('/admin',{secret:'x'}))).status,404);
  assert.equal((await state.fetch(request('/admit',{slotId:'short',nowMs:1,expiresAtMs:2,maxConcurrent:1}))).status,400);
  assert.equal((await state.fetch(request('/admit',{slotId:'slot_request_000001',nowMs:1,expiresAtMs:999999,maxConcurrent:1}))).status,400);
});

test('production admission reserves at most 90 seconds including bounded cleanup',async()=>{
  const {binding,rows,state}=stateHarness();
  const runtime=createManagementAuthWorkerRuntime({broker:{exchange:async()=>({ok:false})},stateBinding:binding,
    now:()=>1000,newSlotId:()=> 'slot_request_000001',maxRequestMs:80000,cleanupDrainMs:10000});
  const ticket=await runtime.admitRequest();
  assert.equal(ticket.allowed,true);assert.equal(rows.get('slot_request_000001').expiresAtMs,91000);
  await ticket.release();assert.equal(rows.size,0);
  assert.equal((await state.fetch(request('/admit',{slotId:'slot_request_000002',nowMs:1000,expiresAtMs:91001,maxConcurrent:1}))).status,400);
  for(const limits of [{maxRequestMs:80001,cleanupDrainMs:10000},{maxRequestMs:80000,cleanupDrainMs:10001}])
    assert.throws(()=>createManagementAuthWorkerRuntime({broker:{exchange:async()=>({})},stateBinding:binding,...limits}),/BROKER_RUNTIME_CONFIG_INVALID/);
});

test('Gateway response nonce claims persist only digests, reject replay and fail closed at capacity',async()=>{
  const {state,nonces}=stateHarness();
  const claim=body=>state.fetch(request('/claim-gateway-response-nonce',body));
  const valid={nonceHash:'a'.repeat(64),nowMs:100,expiresAtMs:200,retainUntilMs:300,maxNonceRecords:1};
  assert.equal((await claim(valid)).status,200);
  assert.equal(JSON.parse(await (await claim(valid)).text()).status,'REPLAY');
  assert.equal((await claim({...valid,nonceHash:'b'.repeat(64)})).status,429);
  assert.equal(nonces.has('a'.repeat(64)),true);
  assert.equal((await claim({...valid,expiresAtMs:999999,retainUntilMs:1000000})).status,400);
  assert.equal((await claim({...valid,nonceHash:'c'.repeat(64),nowMs:300,expiresAtMs:400,retainUntilMs:500})).status,200);
  assert.equal(nonces.has('a'.repeat(64)),false);
});

test('Worker response nonce callback returns protocol receipt but Durable Object stores only nonce digest',async()=>{
  const {binding,nonces}=stateHarness();
  const claim=createManagementGatewayResponseNonceClaimer({stateBinding:binding,now:()=>1000,maxNonceRecords:4,retentionMs:300000});
  const metadata={schemaVersion:1,namespace:'SAHMT_MANAGEMENT_GATEWAY_V1:audience:APPS_SCRIPT_TO_WORKER',
    direction:'APPS_SCRIPT_TO_WORKER',requestHash:'a'.repeat(64),envelopeHash:'b'.repeat(64),requestId:'c'.repeat(32),
    nonce:'d'.repeat(32),operation:'AUTH_USER_LOOKUP_FA',keyId:'key-v1',sourceProjectId:'sahmt-17a16',
    destinationProjectId:'sahmt-17a16',issuedAtMs:900,expiresAtMs:2000};
  const receipt=await claim(metadata);
  assert.equal(receipt.status,'CLAIMED');assert.equal(receipt.durable,true);assert.equal(receipt.atomic,true);
  assert.deepEqual([...nonces.keys()], [nonces.keys().next().value]);
  assert.notEqual(nonces.keys().next().value,metadata.nonce);
  assert.equal((await claim(metadata)).status,'REPLAY');assert.equal(nonces.size,1);
});

test('Worker runtime fails closed on capacity/storage errors and releases only after supervision',async()=>{
  const {binding,rows}=stateHarness();let now=1000,sequence=0,supervised;
  const broker={exchange:async()=>({ok:true,sourceProjectId:'sahmt-17a16',faUid:'uid-a',targets:{FC:{projectId:'indicadores---sahmt',status:'READY',uid:'uid-a',customToken:'private-fc-token'}}})};
  const runtime=createManagementAuthWorkerRuntime({broker,stateBinding:binding,now:()=>now,newSlotId:()=>`slot_request_${String(++sequence).padStart(6,'0')}`,
    maxConcurrent:1,maxRequestMs:1000,cleanupDrainMs:500});
  const ticket=await runtime.admitRequest();assert.equal(ticket.allowed,true);assert.equal(rows.size,1);
  assert.equal(await runtime.admitRequest(),false);assert.equal(rows.size,1);
  assert.equal(runtime.superviseExchange(Promise.resolve({settled:true}),{releaseAdmission:ticket.release,
    executionContext:{waitUntil:promise=>{supervised=promise;}}}),true);
  await supervised;assert.equal(rows.size,0);
  now=2000;const next=await runtime.admitRequest();assert.equal(next.allowed,true);await next.release();assert.equal(rows.size,0);
});

test('supervisor refuses without waitUntil so the HTTP layer releases admission locally',async()=>{
  const {binding}=stateHarness(),runtime=createManagementAuthWorkerRuntime({broker:{exchange:async()=>({ok:false})},stateBinding:binding,
    newSlotId:()=> 'slot_request_000001'});
  const ticket=await runtime.admitRequest();assert.equal(runtime.superviseExchange(Promise.resolve(),{releaseAdmission:ticket.release}),false);
  await ticket.release();
});
