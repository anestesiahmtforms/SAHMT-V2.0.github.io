import test from 'node:test';import assert from 'node:assert/strict';
import {createFirestoreStore} from '../worker-indicators/store.js';import {createSourceReadBudget} from '../worker-indicators/read-budget.js';import {vaccinationMemoryStore} from './helpers/vaccination-memory-store.js';
test('real FD settlement accepts FG and FI and refunds only unused reservation once',async()=>{
 const writes=[];const remote=createFirestoreStore({getAccessToken:async()=>'test-token',fetchImpl:async(url,options)=>{writes.push({url,body:JSON.parse(options.body)});return Response.json({writeResults:[]});}});
 const memory=vaccinationMemoryStore(),budget=createSourceReadBudget({store:{...memory,finishReadReservation:remote.finishReadReservation},now:()=>Date.parse('2026-11-08T05:00:00Z')});
 for(const project of ['FG','FI']){const ticket=await budget.reserve(project,6000);await budget.settle(ticket,12);await budget.settle(ticket,12);}
 assert.equal(writes.length,2);for(const write of writes){assert.match(write.url,/:commit$/);assert.equal(write.body.writes[0].transform.fieldTransforms[0].increment.integerValue,'-5988');}
});
