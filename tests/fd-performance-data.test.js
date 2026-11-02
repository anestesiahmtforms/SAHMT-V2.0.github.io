import test from 'node:test';
import assert from 'node:assert/strict';
import {createFdPerformanceRepository,fdPerformancePresentation} from '../src/fd-performance-data.js';

const valid={status:'READY',uid:'fd-user',summary:{uid:'fd-user',total:3},reference:{maxTotal:5},awards:[{uid:'fd-user',category:'PERFORMANCE',points:1,modality:'ACKNOWLEDGEMENT'}],suggestions:[],pendingSuggestions:[],indicators:[{id:'metric-a',year:2026,name:'Indicador A'}]};
test('FD repository reads only the bound user and uses the worker for actions without client point values',async()=>{
 const calls=[],repository=createFdPerformanceRepository({uid:'fd-user',request:async(action,input)=>{calls.push({action,input});return action==='GET_PERFORMANCE'?valid:action==='BOOTSTRAP'?{metrics:[{id:'metric-a',platform:'management',name:'Indicador A'}]}:{accepted:true};}});
 const data=await repository.loadSummary();assert.equal(data.summary.uid,'fd-user');assert.equal(data.indicators[0].id,'metric-a');
 await repository.acknowledge('metric-a',2026);assert.equal(calls[2].action,'ACKNOWLEDGE_INDICATOR');assert.equal(Object.hasOwn(calls[2].input,'points'),false);
});
test('FD presentation blocks a different UID and computes percentage from anonymous maximum only',()=>{
 assert.deepEqual(fdPerformancePresentation({...valid,uid:'other'}),{state:'blocked',total:null,percentage:null});
 assert.deepEqual(fdPerformancePresentation(valid),{state:'ready',total:3,percentage:60});
});
