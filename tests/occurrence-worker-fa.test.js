import test from'node:test';import assert from'node:assert/strict';
import{createManagementAuthWorker}from'../worker-management-auth/worker.js';
test('retired secondary session endpoints never construct or call a broker',async()=>{
 let calls=0;const worker=createManagementAuthWorker({buildRuntime:()=>{calls++;throw Error('Forbidden');}});
 const response=await worker.fetch(new Request('https://worker.invalid/v1/management/session',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io'},body:'{}'}),{MANAGEMENT_SECONDARY_AUTH_RETIRED:'true'});
 assert.notEqual(response.status,200);assert.equal(calls,0);
});
test('FA occurrence admission needs no legacy auth targets, Gateway policy or signer configuration',async()=>{
 let brokerCalls=0,admissionBuilds=0,admissions=0;
 const worker=createManagementAuthWorker({buildRuntime:()=>{brokerCalls++;throw Error('Forbidden');},
  buildOperationalRuntime:()=>{admissionBuilds++;return {maxRequestMs:80000,admitRequest:async()=>{admissions++;return false;}};}});
 const env={OCCURRENCE_SCORING_ENABLED:'true',OCCURRENCE_SCORING_HMAC_SECRET:'s'.repeat(43),
  OCCURRENCE_SCORING_SCRIPT_URL:'https://script.google.com/macros/s/'+'synthetic'.repeat(4)+'/exec',MANAGEMENT_SECONDARY_AUTH_RETIRED:'true'};
 const request=()=>new Request('https://worker.invalid/v1/evaluation/occurrence',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io',Authorization:'Bearer '+'a'.repeat(120)},body:'{}'});
 for(let i=0;i<2;i++)assert.equal((await worker.fetch(request(),env)).status,429);
 assert.equal(brokerCalls,0);assert.equal(admissionBuilds,1);assert.equal(admissions,2);
});

test('all FA service routes survive explicitly disabled secondary authentication bindings',async()=>{
 let brokerCalls=0;const worker=createManagementAuthWorker({buildRuntime:()=>{brokerCalls++;throw Error('Forbidden');},
  buildOperationalRuntime:()=>({maxRequestMs:80000,admitRequest:async()=>false})});
 const env={MANAGEMENT_SECONDARY_AUTH_RETIRED:'true',MANAGEMENT_AUTH_ENABLED:'false',MANAGEMENT_AUTH_FB_ENABLED:'false',
  MANAGEMENT_AUTH_FC_ENABLED:'false',MANAGEMENT_DOMAIN_ENABLED:'false',MANAGEMENT_GATEWAY_ENABLED:'false',MANAGEMENT_FIRST_LOGIN_ENABLED:'false',
  QMENTUM_WRITE_ENABLED:'true',OPERATIONAL_SHEETS_ENABLED:'true',OCCURRENCE_SCORING_ENABLED:'true',
  OPERATIONAL_SHEETS_HMAC_SECRET:'s'.repeat(43),OPERATIONAL_SHEETS_SCRIPT_URL:'https://script.google.com/macros/s/'+'synthetic'.repeat(4)+'/exec',
  OCCURRENCE_SCORING_HMAC_SECRET:'s'.repeat(43),OCCURRENCE_SCORING_SCRIPT_URL:'https://script.google.com/macros/s/'+'synthetic'.repeat(4)+'/exec'};
 for(const path of ['/v1/qmentum/write','/v1/evaluation/occurrence','/v1/operational-sheets/notify']) {
  const headers={Origin:'https://anestesiahmtforms.github.io'};
  assert.equal((await worker.fetch(new Request('https://worker.invalid'+path,{method:'OPTIONS',headers}),env)).status,204,path);
  assert.equal((await worker.fetch(new Request('https://worker.invalid'+path,{method:'POST',headers,body:'{}'}),env)).status,401,path);
 }
 assert.equal(brokerCalls,0);
});
