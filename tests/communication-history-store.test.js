import test from 'node:test';import assert from 'node:assert/strict';import {createStore} from '../worker-communication/store.js';
test('history snapshot query is bounded to detect oversize audiences and selects only needed identity fields',async()=>{
 const requests=[];const store=createStore({getToken:async()=> 'synthetic',administrator:true,fetchImpl:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return Response.json([]);}});
 assert.equal(typeof store.eligibleRecipients,'function');await store.eligibleRecipients();
 const query=requests[0].body.structuredQuery;assert.equal(query.limit,201);assert.deepEqual(query.select.fields.map(r=>r.fieldPath),['uid','email','displayName','institutionalGroup','role','active','access']);assert.ok(requests[0].url.includes('/sahmt-comunicacao-ff/'));
});
test('history cleanup emits a real FF-only transactional delete',async()=>{
 const bodies=[];const store=createStore({getToken:async()=> 'synthetic',administrator:true,fetchImpl:async(url,options)=>{const b=JSON.parse(options.body);bodies.push(b);return Response.json(url.endsWith(':beginTransaction')?{transaction:'test'}:{});}});
 await store.transaction(tx=>{assert.equal(typeof tx.delete,'function');tx.delete('communicationHistoryPending','notice-1');});
 assert.deepEqual(bodies.at(-1).writes,[{delete:'projects/sahmt-comunicacao-ff/databases/comunicacao/documents/communicationHistoryPending/notice-1'}]);
});
