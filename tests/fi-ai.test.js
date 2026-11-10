import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiSearch} from '../worker-fi-control/search.js';
import {createMonthlyService} from '../worker-fi-control/monthly.js';
import {createAiBudget} from '../worker-fi-control/fi-ai-budget.js';
const actor = {uid:'u1',profile:{active:true,access:true},memberCategories:['EFETIVO']};
const admin = {...actor,profile:{...actor.profile,permissions:{admin:true}}};
const record = (id, extra={}) => ({id,schemaVersion:1,source:'FC',kind:'general',audience:'GENERAL',active:true,title:`Protocolo ${id}`,text:'Protocolo segurança anestesia',url:'/app.html#protocolo',version:'1',sourceAccess:'ACTIVE',...extra});
function memoryStore() {
 const data=new Map(); let queue=Promise.resolve();
 const get=async(c,id)=>structuredClone(data.get(`${c}/${id}`)??null);
 return {data,get,transaction(fn){const run=queue.then(async()=>{const writes=[];const result=await fn({get,getMany:keys=>Promise.all(keys.map(([c,id])=>get(c,id))),set:async(c,id,v)=>writes.push([`${c}/${id}`,structuredClone(v)]),create:async(c,id,v)=>{if(data.has(`${c}/${id}`))throw Error('EXISTS');writes.push([`${c}/${id}`,structuredClone(v)]);}});for(const [k,v]of writes)data.set(k,v);return result;});queue=run.catch(()=>{});return run;}};
}
const snapshot={schemaVersion:1,source:'FC',units:['a'],period:'2026-10',signature:'fc-v1',complete:true,missingSources:[],updatedAt:1793577600000,indicators:[{id:'i1',label:'Adesão',value:82,unit:'%',target:90,previous:80}],technicalMetrics:[]};
const plan={summary:'Adesão abaixo da meta.',actions:[{priority:'HIGH',ownerSuggested:'Coordenação',dueSuggested:'2026-11-30',evidence:['i1'],successMetric:'Adesão ≥90%',action:'Revisar treinamento.'}],technicalRecommendations:[]};
function setup({records=[record('public')],config={},provider,clock=()=>1794225600000,snap=snapshot}={}){
 const store=memoryStore();let calls=[];
 const modelProvider=provider??{enabled:true,async generate(input){calls.push(input);return {data:plan,usage:{inputTokens:100,outputTokens:100}};}};
 const sourceProvider={searchRecords:async()=>records,monthlySnapshot:async()=>snap};
 const search=createFiSearch({sourceProvider});
 const monthly=createMonthlyService({store,sourceProvider,modelProvider,now:clock,config:{monthlyBudgetMicros:100000,...config}});
 return {store,calls,service:{search,monthly}};
}
test('filters administrative, third party, notification author, unknown and ambiguous records before search',async()=>{
 const records=[record('public'),record('restricted',{kind:'document',audience:'RESTRICTED',category:'Documentos administrativos',sourceAccess:'EXPLICIT',sourceAllowedUids:['u1']}),record('legacy',{kind:'document',category:'Organograma',sourceAccess:'EXPLICIT',sourceAllowedUids:['u1']}),record('own',{kind:'operational',audience:'INVOLVED',authorUid:'u1'}),record('other',{kind:'operational',audience:'INVOLVED',authorUid:'u2',text:'Protocolo u1'}),record('notice',{kind:'notification',audience:'INVOLVED',authorUid:'u1',recipientUids:['u2']}),record('ambiguous',{kind:'operational',audience:'INVOLVED',participantUids:['u1'],identityAmbiguous:true}),record('unknown',{kind:'unknown'})];
 const {service,calls}=setup({records});
 const result=await service.search({...admin,memberCategories:['ADMINISTRADOR']},{query:'protocolo',uid:'u2',memberCategories:['EFETIVO']});
 assert.deepEqual(result.results.map(r=>r.id).sort(),['own','public']);
 assert.equal(calls.length,0);
 const effective=await service.search(actor,{query:'protocolo'});
 assert.deepEqual(effective.results.map(r=>r.id).sort(),['legacy','own','public','restricted']);
});
test('document source ACL and contradictory/unknown classification fail closed',async()=>{
 const records=[record('no-acl',{kind:'document',audience:'RESTRICTED',category:'Protocolo'}),record('wrong-acl',{kind:'document',audience:'RESTRICTED',category:'Protocolo',sourceAccess:'EXPLICIT',sourceAllowedUids:['u2']}),record('unknown-cat',{kind:'document',category:'unmapped'}),record('bad-source',{source:'INTERNET'})];
 const {service,calls}=setup({records});assert.deepEqual((await service.search(actor,{query:'protocolo'})).results,[]);assert.equal(calls.length,0);
});
test('inactive actor denied and source is never consulted',async()=>{const {service}=setup();await assert.rejects(service.search({...actor,profile:{active:false,access:true}},{query:'protocolo'}),/FORBIDDEN/);});

test('inactive documents and inactive folders remain discoverable read-only without training actions',async()=>{
 const {service}=setup({records:[record('inactive',{kind:'document',category:'Protocolos',active:false}),record('folder',{kind:'document',category:'Protocolos',folderActive:false})],provider:{enabled:false}});
 const result=await service.search(actor,{query:'protocolo'});assert.equal(result.results.length,2);assert.ok(result.results.every(r=>r.readOnly===true&&r.actionsAllowed===false));
});
test('search returns matches without an AI call or AI budget reservation',async()=>{
 const {service,calls,store}=setup({config:{monthlyBudgetMicros:0}});
 const result=await service.search(actor,{query:'segurança'});
 assert.equal(result.results.length,1);assert.equal(calls.length,0);assert.equal(store.data.size,0);
});
test('search prioritizes Regimento in the title and ignores incidental Portuguese words',async()=>{
 const records=[record('a',{title:'Ata da reunião',text:'Discussão sobre o regimento'}),record('b',{title:'Treinamento da equipe',text:'Ações de melhoria'}),record('c',{title:'Regimento Interno',text:'Regimento interno'}),record('d',{title:'Regimento',text:'Regimento'})];
 const {service}=setup({records,provider:{enabled:false}});
 assert.deepEqual((await service.search(actor,{query:'Regimento'})).results.map(r=>r.id),['d','c','a']);
 assert.deepEqual((await service.search(actor,{query:'Me mostre os regimentos'})).results.map(r=>r.id),['c','d','a']);
});
test('search includes every authorized match and ranks complete matches above partial words',async()=>{
 const records=Array.from({length:25},(_,i)=>record('doc-'+i));
 records.push(record('exact',{title:'Protocolo segurança anestesia',text:'Protocolo segurança anestesia'}));
 records.push(record('other-topic',{title:'Ficha de segurança',text:'Ficha de segurança'}));
 const {service}=setup({records});
 const result=await service.search(actor,{query:'protocolo segurança anestesia'});
 assert.equal(result.totalMatches,27);assert.equal(result.results.length,27);
 assert.equal(result.results[0].id,'exact');assert.equal(result.results.at(-1).id,'other-topic');
 assert.equal((await service.search(actor,{query:'anest'})).results.length,26);
});
test('parallel reservations cannot exceed budget and uncertain failures retain charged reservation',async()=>{
 const store=memoryStore(),budget=createAiBudget({store,now:()=>1794225600000,config:{monthlyBudgetMicros:10000}});
 const reservations=await Promise.all(Array.from({length:10},()=>budget.reserve(actor.uid)));
 assert.equal(reservations.filter(Boolean).length,1);
 await budget.settle(reservations.find(Boolean),undefined);
 const ledger=await store.get('fiAiBudget','2026-11');assert.ok(ledger.committedMicros<=10000&&ledger.committedMicros>0);
});
test('monthly requires admin and rejects incomplete data instead of treating missing as zero',async()=>{
 const {service,calls}=setup({snap:{...snapshot,complete:false,missingSources:['FH']}});
 await assert.rejects(service.monthly(actor,{period:'2026-10',requestId:'r1'}),/FORBIDDEN/);
 const result=await service.monthly(admin,{period:'2026-10',requestId:'r1'});assert.equal(result.status,'incomplete');assert.deepEqual(result.missingSources,['FH']);assert.equal(calls.length,0);
});
test('monthly is idempotent by QMENTUM signature and preserves proposed action structure',async()=>{
 const {service,calls}=setup();const results=await Promise.all([service.monthly(admin,{period:'2026-10',requestId:'r1'}),service.monthly(admin,{period:'2026-10',requestId:'r2'})]);
 assert.equal(calls.length,1);assert.ok(results.some(r=>r.status==='complete'));
 const cached=await service.monthly(admin,{period:'2026-10',requestId:'r3',indicators:[{id:'fake',value:0}]});assert.equal(cached.status,'complete');assert.deepEqual(cached.report.actions,plan.actions);assert.equal(calls.length,1);assert.equal(cached.signature,'fc-v1');
});
test('expired monthly lease cannot publish stale model output',async()=>{
 let time=1794225600000;const {service,store}=setup({clock:()=>time,config:{monthlyLeaseMs:1000},provider:{enabled:true,generate:async()=>{time+=2000;return {data:plan,usage:{inputTokens:10,outputTokens:10}};}}});
 const result=await service.monthly(admin,{period:'2026-10',requestId:'r1'});assert.equal(result.status,'lease_expired');assert.equal([...store.data.values()].some(x=>x.status==='complete'),false);
});
test('bounded input rejects empty/large queries and malformed periods',async()=>{const {service}=setup();await assert.rejects(service.search(actor,{query:' '}),/QUERY/);await assert.rejects(service.search(actor,{query:'x'.repeat(1001)}),/QUERY/);await assert.rejects(service.monthly(admin,{period:'2026-13',requestId:'r'}),/PERIOD/);});
export {memoryStore};
