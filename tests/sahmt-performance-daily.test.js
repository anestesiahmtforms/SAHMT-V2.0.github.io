import test from 'node:test';
import assert from 'node:assert/strict';
import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
const cutoff=Date.parse('2026-11-08T05:00:00Z'),batchId='2026-11-08_02';
const stages=['FA','FG','FI','FB','FC','FE','ADMIN'];
const member=uid=>({uid,active:true,access:true,sourceUids:{FG:uid,FI:uid,FB:uid,FC:uid,FE:uid}});
const row=(uid='u0',points=4,extra={})=>({id:'credit',uid,source:'FG',category:'OPERATIONS',points,createdAt:cutoff-1,label:'Ciência',...extra});
async function fixture(count=2){
 const {createSahmtDailyProcessor}=await import('../worker-indicators/sahmt-performance-daily.js');
 const store=vaccinationMemoryStore(),calls={FA:0,FG:0,FI:0,FB:0,FC:0,FE:0};let clock=cutoff+1,sequence=0;
 store.seed('sahmtPerformanceRuntime','current',{schemaVersion:1,projectId:'rotinas-8a617',enabled:true,generation:1});
 for(let n=0;n<count;n++)store.seed('sahmtPerformanceMembers','u'+n,member('u'+n));
 const sources={async loadEligibility({members}){calls.FA++;return {members,eligibleUids:members.filter(m=>m.active&&m.access).map(m=>m.uid),readsByProject:{FA:count}};},async loadSource({source}){calls[source]++;return {complete:true,rows:source==='FG'?[row()]:[],readsByProject:{[source]:1},periodsBySource:{[source]:{cutoff}}};}};
 const engine=createSahmtDailyProcessor({store,sources,now:()=>clock,uuid:()=>String(++sequence)});
 return {engine,store,sources,calls,set clock(value){clock=value;}};
}
async function collect(f){const plan=await f.engine.execute(cutoff,'PREPARE');for(const stage of stages)await f.engine.execute(cutoff,stage);return plan;}
async function finish(f){const plan=await collect(f);for(const stage of plan.stages.filter(s=>s.startsWith('RENDER_')))await f.engine.execute(cutoff,stage);return f.engine.execute(cutoff,'PUBLISH');}

test('daily stages publish signed totals and sanitized history only after all source checkpoints',async()=>{
 const f=await fixture();f.store.seed('sahmtPerformanceManual','debit',{uid:'u0',category:'NOTIFICATIONS',kind:'INFRACTION',points:-2,createdAt:cutoff-2,reason:'private reason'});
 const plan=await collect(f);assert.deepEqual(plan.stages,[...stages,'RENDER_0','PUBLISH']);
 assert.equal(await f.store.get('sahmtPerformanceReference','current'),null);
 await f.engine.execute(cutoff,'RENDER_0');await f.engine.execute(cutoff,'PUBLISH');
 const reference=await f.store.get('sahmtPerformanceReference','current');assert.equal(reference.maxTotal,2);assert.equal(reference.eligibleCount,2);
 const summary=await f.store.get('sahmtPerformanceSummaries',batchId+'_u0');assert.equal(summary.total,2);assert.equal(summary.byCategory.OPERATIONS,4);assert.equal(summary.byCategory.NOTIFICATIONS,-2);
 const history=await f.store.get('sahmtPerformanceHistory',batchId+'_u0_NOTIFICATIONS_0');assert.equal(history.rows[0].label,'Infração');assert.equal(JSON.stringify(history).includes('private reason'),false);
 assert.deepEqual(await f.engine.execute(cutoff,'PREPARE'),{complete:true,stages:[]});
});

test('concurrent source stages and repeated completed stages never reread sources',async()=>{
 const f=await fixture();await f.engine.execute(cutoff,'PREPARE');await f.engine.execute(cutoff,'FA');
 await Promise.all([f.engine.execute(cutoff,'FG'),f.engine.execute(cutoff,'FG')]);await f.engine.execute(cutoff,'FG');assert.equal(f.calls.FG,1);
});

test('failed source preserves prior publication and successful checkpoints survive recovery',async()=>{
 const f=await fixture(),before={batchId:'old',cutoff:cutoff-86400000};f.store.seed('sahmtPerformanceReference','current',before);
 await f.engine.execute(cutoff,'PREPARE');await f.engine.execute(cutoff,'FA');await f.engine.execute(cutoff,'FG');
 const source=f.sources.loadSource;f.sources.loadSource=async input=>{if(input.source==='FI')throw Object.assign(Error('private secret'),{readsByProject:{FI:8}});return source(input);};
 await assert.rejects(f.engine.execute(cutoff,'FI'));assert.deepEqual(await f.store.get('sahmtPerformanceReference','current'),before);
 const failed=await f.store.get('sahmtDailyStages',batchId+'_FI');assert.equal(failed.status,'FAILED');assert.equal(failed.code,'SAHMT_SOURCE_UNAVAILABLE');assert.equal(failed.readsByProject.FI,8);
 assert.equal((await f.store.get('sahmtPerformanceRuns',batchId)).status,'PARTIAL');
 f.sources.loadSource=source;await finish(f);assert.equal(f.calls.FA,1);assert.equal(f.calls.FG,1);assert.equal((await f.store.get('sahmtPerformanceRuns',batchId)).status,'CONFIRMED');
});

test('more than forty users split render groups and the highest total includes later groups and zero users',async()=>{
 const f=await fixture(42);f.sources.loadSource=async({source})=>({complete:true,rows:source==='FG'?[row('u0',-4),row('u41',9,{id:'leader'})]:[],readsByProject:{}});
 const plan=await collect(f);assert.deepEqual(plan.stages.slice(-3),['RENDER_0','RENDER_1','PUBLISH']);
 await f.engine.execute(cutoff,'RENDER_0');assert.equal(await f.store.get('sahmtPerformanceSummaries',batchId+'_u41'),null);
 await assert.rejects(f.engine.execute(cutoff,'PUBLISH'),/SAHMT_STAGE_INCOMPLETE/);
 await f.engine.execute(cutoff,'RENDER_1');await f.engine.execute(cutoff,'PUBLISH');
 const reference=await f.store.get('sahmtPerformanceReference','current');assert.equal(reference.maxTotal,9);assert.equal(reference.eligibleCount,42);assert.equal((await f.store.get('sahmtPerformanceSummaries',batchId+'_u40')).total,0);
});

test('expired source owner cannot overwrite the recovered stage or publish its rows',async()=>{
 const f=await fixture();await f.engine.execute(cutoff,'PREPARE');await f.engine.execute(cutoff,'FA');
 let release,started;const ready=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>release=resolve);
 f.sources.loadSource=async()=>{started();await hold;return {complete:true,rows:[row('u0',999)],readsByProject:{FG:1}};};
 const stale=f.engine.execute(cutoff,'FG');await ready;f.clock=cutoff+600002;
 f.sources.loadSource=async()=>({complete:true,rows:[row('u0',5)],readsByProject:{FG:1}});
 await f.engine.execute(cutoff,'FG');release();await assert.rejects(stale,/SAHMT_STAGE_LEASE_LOST/);
 f.sources.loadSource=async()=>({complete:true,rows:[],readsByProject:{}});await finish(f);
 assert.equal((await f.store.get('sahmtPerformanceSummaries',batchId+'_u0')).total,5);
});

test('invalid windows, unknown stages and render before collection cannot publish',async()=>{
 const f=await fixture();for(const time of [cutoff-7200000,cutoff+36000000,cutoff+1,cutoff+1000])await assert.rejects(f.engine.execute(time,'PREPARE'));
 await assert.rejects(f.engine.execute(cutoff,'DELETE_ALL'),/SAHMT_STAGE_INVALID/);
 await f.engine.execute(cutoff,'PREPARE');await assert.rejects(f.engine.execute(cutoff,'RENDER_0'),/SAHMT_STAGE_INCOMPLETE/);
 assert.equal(await f.store.get('sahmtPerformanceReference','current'),null);
});

test('unmapped users, duplicate source ids, invalid categories and fractional cents fail publication',async()=>{
 for(const rows of [[row('missing')],[row(),row()],[row('u0',1,{category:'RECORDS'})],[row('u0',0.001)]]){
  const f=await fixture();f.sources.loadSource=async({source})=>({complete:true,rows:source==='FG'?rows:[],readsByProject:{}});
  await assert.rejects(finish(f),/SAHMT_SOURCE_ROW_INVALID/);assert.equal(await f.store.get('sahmtPerformanceReference','current'),null);
 }
});

test('central inactive users are ignored and administrative correction deltas support both signed extremes',async()=>{
 const f=await fixture();f.store.seed('sahmtPerformanceMembers','u1',{...member('u1'),active:false});
 f.sources.loadSource=async({source})=>({complete:true,rows:source==='FG'?[row('u1',30)]:[],readsByProject:{}});
 f.store.seed('sahmtPerformanceManual','original',{uid:'u0',category:'NOTIFICATIONS',kind:'PRAISE',points:1000000,createdAt:cutoff-3});
 f.store.seed('sahmtPerformanceManual','correction',{uid:'u0',category:'NOTIFICATIONS',kind:'PRAISE',points:-2000000,createdAt:cutoff-2});
 await finish(f);assert.equal((await f.store.get('sahmtPerformanceSummaries',batchId+'_u0')).total,-1000000);assert.equal((await f.store.get('sahmtPerformanceReference','current')).eligibleCount,1);
});

test('changed runtime generation and a newer publication stop publishing staged older work',async()=>{
 for(const change of ['generation','reference']){
  const f=await fixture();await collect(f);await f.engine.execute(cutoff,'RENDER_0');
  if(change==='generation')f.store.seed('sahmtPerformanceRuntime','current',{schemaVersion:1,projectId:'rotinas-8a617',enabled:true,generation:2});
  else f.store.seed('sahmtPerformanceReference','current',{batchId:'newer',cutoff:cutoff+86400000});
  await assert.rejects(f.engine.execute(cutoff,'PUBLISH'),change==='generation'?/SAHMT_RUNTIME_CHANGED/:/SAHMT_BATCH_SUPERSEDED/);
  assert.notEqual((await f.store.get('sahmtPerformanceReference','current'))?.batchId,batchId);
 }
});

test('bounded stages stay within fifty external requests for thirty thousand administrative rows',async t=>{
 const f=await fixture(),uid='u'.repeat(128),get=f.store.get.bind(f.store),list=f.store.list.bind(f.store),transaction=f.store.transaction.bind(f.store);let external=0;
 f.store.seed('sahmtPerformanceMembers',uid,member(uid));
 for(let index=0;index<29999;index++)f.store.seed('sahmtPerformanceManual','a'.repeat(120)+index,{uid,category:'CONTINUING_EDUCATION',kind:'CONTINUING_EDUCATION',points:1,createdAt:cutoff-1});
 f.store.get=async(...args)=>{external++;return get(...args);};
 f.store.getMany=async(collection,ids)=>{external++;return Promise.all(ids.map(id=>get(collection,id)));};
 f.store.list=async(...args)=>{external++;return list(...args);};
 f.store.listAll=async(collection,filters)=>{const result=await list(collection,filters);external+=Math.floor(result.length/2000)+1;return result;};
 f.store.transaction=callback=>transaction(async tx=>{
  external++;let rawBytes=0;
  const result=await callback({...tx,get:async(...args)=>{external++;return tx.get(...args);},set:(collection,id,value)=>{assert.ok(id.length<=512);if(collection==='sahmtDailyRows'){const bytes=new TextEncoder().encode(JSON.stringify(value)).length;assert.ok(bytes<=425000);rawBytes+=bytes;}tx.set(collection,id,value);}});
  assert.ok(rawBytes<=3000000,'raw staging commit exceeded bounded payload: '+rawBytes);external++;return result;
 });
 const plan=await f.engine.execute(cutoff,'PREPARE'),counts={};
 for(const stage of plan.stages){const before=external;await f.engine.execute(cutoff,stage);counts[stage]=external-before;assert.ok(external-before<=50,stage+' used '+(external-before)+' external requests');}
 t.diagnostic('External requests per stage with 29,999 manual rows: '+JSON.stringify(counts));
 const reference=await get('sahmtPerformanceReference','current');assert.equal(reference.maxTotal,29999);assert.equal(reference.eligibleCount,3);
});

test('publication rechecks stage ownership transactionally after a lease is replaced',async()=>{
 const f=await fixture();await collect(f);await f.engine.execute(cutoff,'RENDER_0');
 const transaction=f.store.transaction.bind(f.store);let replaced=false;
 f.store.transaction=callback=>transaction(tx=>callback({...tx,set:(collection,id,value)=>{
  if(collection==='sahmtPerformanceReference'&&!replaced){replaced=true;f.store.beforeCommit=async()=>{const stage=await f.store.get('sahmtDailyStages',batchId+'_PUBLISH');f.store.seed('sahmtDailyStages',batchId+'_PUBLISH',{...stage,owner:'replacement'});};}
  tx.set(collection,id,value);
 }}));
 await assert.rejects(f.engine.execute(cutoff,'PUBLISH'),/SAHMT_STAGE_LEASE_LOST/);
 assert.equal(await f.store.get('sahmtPerformanceReference','current'),null);
 assert.equal((await f.store.get('sahmtDailyStages',batchId+'_PUBLISH')).owner,'replacement');
});
