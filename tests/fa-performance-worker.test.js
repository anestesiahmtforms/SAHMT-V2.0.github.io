import test from 'node:test';import assert from 'node:assert/strict';
import {createFaPerformanceWorker} from '../worker-fa-performance/worker.js';
const origin='https://anestesiahmtforms.github.io';
const request=()=>new Request('https://worker/v1/fa-performance',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'GET_PERFORMANCE',input:{subjectUid:'a'}})});
function fixture(role='administrador_app'){
 const records={users:{uid:'a',email:'a@example.com',role,active:true,access:true},faPerformanceRuntime:{enabled:true,projectId:'sahmt-17a16',schemaVersion:1,mode:'FA_ONLY',effectiveFrom:'2026-01-01T00:00:00Z',automaticExternalSync:false},faPerformanceReference:{status:'CONFIRMED',revision:1,maxPerformance:0},faPerformanceSummaries:{uid:'a',revision:1,total:-.5}};
 const db={get:async(c)=>records[c],list:async(c)=>c==='faPerformanceSummaries'?[records[c]]:[]};
 return {records,worker:createFaPerformanceWorker({verifyIdentity:async()=>({uid:'a',email:'a@example.com'}),getStore:()=>db})};
}
test('FA server denies ordinary users even reading their own points',async()=>{const {worker}=fixture('membro');assert.equal((await worker.fetch(request(),{FA_PERFORMANCE_ENABLED:'true'})).status,403);});
test('FA admin can read negative balances and server revalidates administrator',async()=>{const {worker,records}=fixture();const r=await worker.fetch(request(),{FA_PERFORMANCE_ENABLED:'true'});assert.equal(r.status,200);assert.equal((await r.json()).summary.total,-.5);records.users.role='membro';assert.equal((await worker.fetch(request(),{FA_PERFORMANCE_ENABLED:'true'})).status,403);});
test('FA hides partial revisions, disabled runtime and wrong origin',async()=>{const {worker,records}=fixture();records.faPerformanceReference.status='PENDING';assert.equal((await worker.fetch(request(),{FA_PERFORMANCE_ENABLED:'true'})).status,503);records.faPerformanceReference.status='CONFIRMED';records.faPerformanceSummaries.revision=2;assert.equal((await worker.fetch(request(),{FA_PERFORMANCE_ENABLED:'true'})).status,503);assert.equal((await worker.fetch(new Request('https://worker/v1/fa-performance'),{})).status,403);});
