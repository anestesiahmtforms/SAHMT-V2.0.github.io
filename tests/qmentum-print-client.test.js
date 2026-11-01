import test from 'node:test';import assert from 'node:assert/strict';
import {createQmentumPrintClient} from '../src/qmentum-print-client.js';
const fixture=(fetchImpl,isCurrent=()=>true)=>createQmentumPrintClient({auth:{app:{options:{projectId:'indicadores---sahmt'}},currentUser:{uid:'manager',getIdToken:async()=>'synthetic-token'}},uid:'manager',isCurrent,endpoint:'https://example.test/old?private=discarded',fetchImpl});
test('print client fixes the endpoint, uses FC bearer and returns only confirmed server results',async()=>{
 let seen;const client=fixture(async(url,options)=>{seen={url,options};return new Response(JSON.stringify({code:'QMENTUM_PRINT_SCAN',result:{candidates:[]}}),{status:200});});
 assert.deepEqual(await client.scan({unitId:'synthetic',year:2026}),{candidates:[]});assert.equal(seen.url,'https://example.test/v1/qmentum/prints');assert.equal(seen.options.headers.Authorization,'Bearer synthetic-token');assert.equal(seen.options.credentials,'omit');assert.equal(JSON.parse(seen.options.body).operation,'SCAN');
});
test('print client rejects a stale session after token or network completion and never reports an unconfirmed save',async()=>{
 let active=true;const client=fixture(async()=>{active=false;return new Response(JSON.stringify({code:'QMENTUM_PRINT_APPLIED',result:{status:'CONFIRMED',version:1}}));},()=>active);
 await assert.rejects(()=>client.apply({unitId:'synthetic',period:'2026-07'}),/SESSION_CHANGED/);
 await assert.rejects(()=>fixture(async()=>new Response(JSON.stringify({code:'QMENTUM_PRINT_ERROR'}),{status:409})).apply({unitId:'synthetic',period:'2026-07'}),/PRINT_ERROR/);
});
