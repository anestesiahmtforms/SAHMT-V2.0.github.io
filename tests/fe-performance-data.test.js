import test from 'node:test';
import assert from 'node:assert/strict';
import {createFePerformanceRepository,fePerformancePresentation} from '../src/fe-performance-data.js';

const valid={status:'READY',uid:'fe-user',summary:{uid:'fe-user',total:2},reference:{maxTotal:4},awards:[{uid:'fe-user',category:'PERFORMANCE',points:1,survey:'climate',cycle:'2026',createdAt:Date.parse('2026-10-01T00:00:00Z')}]};
test('FE repository returns self-scoped history through the authenticated survey service',async()=>{
 let calls=0;const repository=createFePerformanceRepository({uid:'fe-user',request:async()=>{calls++;return valid;}});
 const data=await repository.loadSummary();assert.equal(data.awards[0].uid,'fe-user');assert.equal(calls,1);
});
test('FE presentation rejects mismatched UID and computes percentage from anonymous maximum',()=>{
 assert.equal(fePerformancePresentation({...valid,uid:'other'}).state,'blocked');
 assert.deepEqual(fePerformancePresentation(valid),{state:'ready',total:2,percentage:50});
});
