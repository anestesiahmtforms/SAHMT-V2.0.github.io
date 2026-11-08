import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndicatorService} from '../worker-indicators/service.js';
import {createIndicatorWorker} from '../worker-indicators/worker.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
const time=Date.parse('2026-11-08T05:00:00Z');
const identity={uid:'member',email:'member@example.invalid',provider:'google.com',emailVerified:true};
const profile={...identity,active:true,access:true,role:'usuario',permissions:{}};
function fixture(){
 const store=vaccinationMemoryStore();store.seed('users',identity.uid,profile);
 const sources={profile:async()=>profile,load:async()=>{throw Error('MUST_NOT_READ_SOURCES');}};
 const service=createIndicatorService({store,sources,sahmtEnabled:true,now:()=>time+1000});return {service,store,sources};
}
test('approved common user can read own FD summary while institutional indicators remain restricted',async()=>{
 const {service}=fixture();assert.equal((await service.execute('GET_SAHMT_PERFORMANCE',{},identity)).status,'PREPARING');
 await assert.rejects(service.execute('BOOTSTRAP',{year:2026},identity),e=>e.status===403);
 await assert.rejects(service.execute('ADD_SAHMT_MANUAL',{},identity),e=>e.status===403);
});
test('public user cannot run a daily batch; signed internal action needs correct shape',async()=>{
 const {service}=fixture();await assert.rejects(service.execute('PERFORMANCE',{scheduledTime:time},identity));
 await assert.rejects(service.executeScheduled({action:'PERFORMANCE',issuedAt:time,scheduledTime:time,uid:'member'}),e=>e.code==='SAHMT_INPUT_INVALID');
});
test('worker preserves actionable SAHMT error code and never exposes source internals',async()=>{
 const worker=createIndicatorWorker({build:()=>({execute:async()=>{throw Object.assign(Error('SAHMT_BATCH_CHANGED'),{code:'SAHMT_BATCH_CHANGED',status:409});}}),verifyIdentity:async()=>identity});
 const result=await worker.fetch(new Request('https://fd.invalid/v1/indicators',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:'LIST_SAHMT_HISTORY',input:{category:'OPERATIONS'}})}),{INDICATORS_ENABLED:'true'});
 assert.equal(result.status,409);assert.equal((await result.json()).code,'SAHMT_BATCH_CHANGED');
});
