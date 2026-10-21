import test from 'node:test';
import assert from 'node:assert/strict';
import {createReportRuntime} from '../src/report-runtime.js';
const scope={key:'synthetic-day',uid:'synthetic',module:'events',mode:'daily',day:'2026-10-20'};
const cached=records=>({data:{records},complete:true,fromCache:true,hasPendingWrites:false});
test('aviso remoto atualiza cópia em tela sem reabrir assinatura Firestore',async()=>{
 let subscriptions=0,hooks;const paints=[];
 const rt=createReportRuntime({subscribe:(_k,_s,h)=>{subscriptions++;hooks=h;h.next('report',cached([{id:'old'}]));return()=>{};},readPending:async()=>[],onData:(_k,p)=>paints.push(p)});
 rt.open('events',scope);await new Promise(r=>setImmediate(r));
 await rt.hydrateCached('events',async(_k,_s,h)=>h.next('report',cached([{id:'new'}])));
 assert.equal(subscriptions,1);assert.equal(paints.at(-1).records[0].id,'new');assert.equal(rt.get('events').snapshot().confirmed,false);
 hooks.next('report',{data:{records:[{id:'server'}]},complete:true,fromCache:false,hasPendingWrites:false});
 await rt.hydrateCached('events',async(_k,_s,h)=>h.next('report',cached([{id:'older-remote'}])));
 assert.equal(paints.at(-1).records[0].id,'server');rt.clear();
});
test('cache remoto não contorna revogação nem resposta tardia de outro período',async()=>{
 let hooks;const paints=[];
 const rt=createReportRuntime({subscribe:(_k,_s,h)=>{hooks=h;h.next('report',cached([]));return()=>{};},readPending:async()=>[],onData:(_k,p)=>paints.push(p)});
 rt.open('events',scope);await new Promise(r=>setImmediate(r));let deliver;
 const hydration=rt.hydrateCached('events',(_k,_s,h)=>new Promise(resolve=>{deliver=()=>{h.next('report',cached([{id:'stale'}]));resolve();};}));
 rt.open('events',{...scope,key:'next-day',day:'2026-10-21'});deliver();await hydration;
 assert.equal(paints.some(p=>p.records.some(r=>r.id==='stale')),false);
 hooks.error({code:'permission-denied'});let loaded=false;
 assert.equal(await rt.hydrateCached('events',async()=>{loaded=true;}),false);assert.equal(loaded,false);rt.clear();
});
