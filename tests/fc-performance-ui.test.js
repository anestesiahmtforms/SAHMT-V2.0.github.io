import {test} from 'node:test';import assert from 'node:assert/strict';
import {fcPerformanceMarkup,mountFcPerformanceModule} from '../src/fc-performance-ui.js';
const snapshot={uid:'self',runtime:{enabled:true,mode:'FC_ONLY',release:'fc-performance-exclusive-v1',performanceRevision:1,performanceDirty:false},reference:{performanceStatus:'CONFIRMED',performanceRevision:1,maxPerformance:4,eligibleCount:2,allZero:false},summary:{uid:'self',status:'CONFIRMED',performanceRevision:1,performanceTotal:2},ledger:[{modality:'OCCURRENCE',points:2,createdAt:new Date(),sourceId:'private-id',evidence:{description:'PRIVATE_DETAILS'}}]};
test('FC view displays only confirmed personal totals and safe action labels',()=>{
 const html=fcPerformanceMarkup(snapshot);assert.match(html,/Desempenho FC/);assert.match(html,/50%/);assert.match(html,/Registro de ocorrência/);assert.doesNotMatch(html,/private-id|PRIVATE_DETAILS|Firebase|Firestore/);
 assert.doesNotMatch(fcPerformanceMarkup({...snapshot,fromCache:true}),/50%|<table>/);
 assert.doesNotMatch(fcPerformanceMarkup({...snapshot,pendingWrites:true}),/50%|<table>/);
});
test('FC view discards late callbacks on navigation and clears personal data on disposal',()=>{
 let callbacks,stopped=0,current=true;const root={innerHTML:'',replaceChildren(){this.innerHTML='';}};
 const cleanup=mountFcPerformanceModule(root,{repository:{watch(value){callbacks=value;return()=>stopped++;}},isCurrent:()=>current});
 callbacks.onData(snapshot);assert.match(root.innerHTML,/50%/);current=false;callbacks.onData({...snapshot,fromCache:true});assert.match(root.innerHTML,/50%/);
 cleanup();callbacks.onData(snapshot);assert.equal(root.innerHTML,'');assert.equal(stopped,1);
});
