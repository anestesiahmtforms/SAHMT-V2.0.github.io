import test from 'node:test';
import assert from 'node:assert/strict';
import {createSahmtDailyProcessor} from '../worker-indicators/sahmt-performance-daily.js';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
const time=Date.parse('2026-11-08T05:00:00Z');
async function fixture(){
 const {createSahmtPerformanceService}=await import('../worker-indicators/sahmt-performance-service.js');
 const store=vaccinationMemoryStore();let calls=0,clock=time+1000;
 const user={uid:'alice',admin:false},admin={uid:'admin',admin:true};
 store.seed('sahmtPerformanceRuntime','current',{schemaVersion:1,projectId:'rotinas-8a617',enabled:true});
 for(const uid of ['alice','bob'])store.seed('sahmtPerformanceMembers',uid,{uid,displayName:uid,active:true,access:true,sourceUids:{FG:uid,FI:uid,FB:uid,FC:uid,FE:uid}});
 const sources={async load(){calls++;return {complete:true,rows:[{id:'credit',uid:'alice',source:'FG',category:'OPERATIONS',points:4,createdAt:time-1000,label:'Ciência'},{id:'debit',uid:'alice',source:'FI',category:'OPERATIONS',points:-1,createdAt:time-1000,label:'Atraso'},{id:'leader',uid:'bob',source:'FB',category:'MANAGEMENT',points:6,createdAt:time-1000,label:'Treinamento'}],readsByProject:{FG:1,FI:1,FB:1,FC:1,FE:1}};}};
 const service=createSahmtPerformanceService({store,sources,authorize:async(identity,manage)=>{if(manage&&!identity.admin)throw Object.assign(Error('denied'),{status:403});return {canManage:identity.admin};},now:()=>clock,uuid:()=>crypto.randomUUID()});
 const cached=new Map();
 const daily=createSahmtDailyProcessor({store,now:()=>clock,sources:{
  loadEligibility:async({members})=>({members,eligibleUids:members.filter(m=>m.active&&m.access).map(m=>m.uid)}),
  loadSource:async({source,cutoff})=>{if(!cached.has(cutoff))cached.set(cutoff,sources.load());const input=await cached.get(cutoff);return {...input,rows:input.rows.filter(row=>row.source===source)};}
 }});
 const runDaily=async cutoff=>{const plan=await daily.execute(cutoff,'PREPARE');if(plan.complete||plan.status==='BUSY')return plan;for(const stage of plan.stages){const result=await daily.execute(cutoff,stage);if(result.status==='BUSY')return result;}};
 return {service:{...service,runDaily},store,user,admin,sources,get calls(){return calls;},set clock(v){clock=v;}};
}
test('daily batch preserves debits, computes maximum and opens without reading sources',async()=>{
 const f=await fixture();await f.service.runDaily(time);
 const result=await f.service.execute('GET_SAHMT_PERFORMANCE',{},f.user);
 assert.equal(result.summary.total,3);assert.equal(result.summary.percentage,50);assert.equal(result.summary.byCategory.OPERATIONS,3);assert.equal(f.calls,1);
 assert.equal((await f.store.get('sahmtPerformanceSummaries',result.batchId+'_alice')).historyPages.OPERATIONS,1);
 await f.service.execute('GET_SAHMT_PERFORMANCE',{},f.user);assert.equal(f.calls,1);
 const history=await f.service.execute('LIST_SAHMT_HISTORY',{category:'OPERATIONS',batchId:result.batchId},f.user);
 assert.deepEqual(history.rows.map(x=>x.points).sort(),[-1,4]);assert.equal(history.rows.every(x=>!('uid'in x)),true);
});
test('a stale history page from an abandoned attempt cannot escape the published page manifest',async()=>{
 const f=await fixture();await f.service.runDaily(time);const result=await f.service.execute('GET_SAHMT_PERFORMANCE',{},f.user);
 f.store.seed('sahmtPerformanceHistory',result.batchId+'_alice_OPERATIONS_1',{uid:'alice',batchId:result.batchId,rows:[{id:'stale',points:99}],hasMore:false});
 await assert.rejects(f.service.execute('LIST_SAHMT_HISTORY',{category:'OPERATIONS',batchId:result.batchId,cursor:result.batchId+':OPERATIONS:1'},f.user),e=>e.code==='SAHMT_HISTORY_PAGE_INVALID');
});
test('manual entries are admin-only, idempotent and pending until next daily batch',async()=>{
 const f=await fixture();await f.service.runDaily(time);
 const input={requestId:'manual-request-1',uid:'alice',category:'CONTINUING_EDUCATION',kind:'CONTINUING_EDUCATION',points:2.5,reason:'Curso comprovado pelo administrador'};
 await assert.rejects(f.service.execute('ADD_SAHMT_MANUAL',input,f.user),e=>e.status===403);
 await f.service.execute('ADD_SAHMT_MANUAL',input,f.admin);await f.service.execute('ADD_SAHMT_MANUAL',input,f.admin);
 assert.equal((await f.store.list('sahmtPerformanceManual')).length,1);
 assert.equal((await f.service.execute('GET_SAHMT_PERFORMANCE',{},f.user)).summary.total,3);
 f.clock=time+86400000+1000;await f.service.runDaily(time+86400000);
 assert.equal((await f.service.execute('GET_SAHMT_PERFORMANCE',{},f.user)).summary.total,5.5);
 await assert.rejects(f.service.execute('ADD_SAHMT_MANUAL',{...input,points:9},f.admin),e=>e.code==='SAHMT_MANUAL_REQUEST_CONFLICT');
});
test('manual correction appends audit delta and protects concurrent versions',async()=>{
 const f=await fixture();const input={requestId:'original-1',uid:'alice',category:'NOTIFICATIONS',kind:'PRAISE',points:3,reason:'Elogio registrado pela administração'};
 const saved=await f.service.execute('ADD_SAHMT_MANUAL',input,f.admin);
 await f.service.execute('CORRECT_SAHMT_MANUAL',{requestId:'correct-1',entryId:saved.entryId,expectedVersion:1,points:1,reason:'Correção da pontuação registrada'},f.admin);
 const rows=await f.store.list('sahmtPerformanceManual');assert.equal(rows.length,2);assert.equal(rows.reduce((s,r)=>s+r.points,0),1);assert.equal(rows.find(r=>r.id===saved.entryId).points,3);
 await assert.rejects(f.service.execute('CORRECT_SAHMT_MANUAL',{requestId:'correct-2',entryId:saved.entryId,expectedVersion:1,points:0,reason:'Outra tentativa de correção'},f.admin),e=>e.code==='SAHMT_MANUAL_VERSION_CONFLICT');
});
test('a correction between both valid signed extremes remains consolidatable',async()=>{
 const f=await fixture();const saved=await f.service.execute('ADD_SAHMT_MANUAL',{requestId:'max-manual',uid:'alice',category:'NOTIFICATIONS',kind:'PRAISE',points:1000000,reason:'Pontuação de teste no limite autorizado'},f.admin);
 await f.service.execute('CORRECT_SAHMT_MANUAL',{requestId:'min-correction',entryId:saved.entryId,expectedVersion:1,points:-1000000,reason:'Correção para o outro limite autorizado'},f.admin);
 f.clock=time+86400000+1000;await f.service.runDaily(time+86400000);
 assert.equal((await f.service.execute('GET_SAHMT_PERFORMANCE',{},f.user)).summary.total,-999997);
});
test('completed batch and concurrent delivery do not duplicate reads or replace publication on failure',async()=>{
 const f=await fixture();await Promise.all([f.service.runDaily(time),f.service.runDaily(time)]);assert.equal(f.calls,1);
 await f.service.runDaily(time);assert.equal(f.calls,1);
 const before=await f.store.get('sahmtPerformanceReference','current');f.sources.load=async()=>{throw Error('SOURCE_UNAVAILABLE');};f.clock=time+86400000+1000;
 await assert.rejects(f.service.runDaily(time+86400000));assert.deepEqual(await f.store.get('sahmtPerformanceReference','current'),before);
 assert.equal((await f.service.execute('GET_SAHMT_PERFORMANCE',{},f.user)).stale,true);
});
test('source incompleteness, duplicates and unmapped users cannot publish',async()=>{
 for(const change of [r=>({...r,complete:false}),r=>({...r,rows:[...r.rows,r.rows[0]]}),r=>({...r,rows:[...r.rows,{...r.rows[0],id:'orphan',uid:'unknown'}]})]){
  const f=await fixture(),load=f.sources.load;f.sources.load=async()=>change(await load());await assert.rejects(f.service.runDaily(time));assert.equal(await f.store.get('sahmtPerformanceReference','current'),null);
 }
});
test('own history requires matching batch and never accepts another subject UID',async()=>{
 const f=await fixture();await f.service.runDaily(time);
 await assert.rejects(f.service.execute('GET_SAHMT_PERFORMANCE',{uid:'bob'},f.user),e=>e.status===400);
 await assert.rejects(f.service.execute('LIST_SAHMT_HISTORY',{category:'OPERATIONS',batchId:'other'},f.user),e=>e.code==='SAHMT_BATCH_CHANGED');
 await assert.rejects(f.service.execute('LIST_SAHMT_PEOPLE',{},f.user),e=>e.status===403);
});
test('without a positive reference percentage is unavailable; legacy schedule is rejected',async()=>{
 const f=await fixture();f.sources.load=async()=>({complete:true,rows:[{id:'debit',uid:'alice',source:'FG',category:'OPERATIONS',points:-1,createdAt:time-1000,label:'Débito'}]});
 await f.service.runDaily(time);const result=await f.service.execute('GET_SAHMT_PERFORMANCE',{},f.user);assert.equal(result.summary.total,-1);assert.equal(result.summary.percentage,null);
 await assert.rejects(f.service.runDaily(Date.parse('2026-11-08T03:00:00Z')));
});
