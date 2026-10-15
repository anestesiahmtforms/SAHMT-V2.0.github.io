import test from 'node:test';import assert from 'node:assert/strict';
import {createConsolidationControls} from '../scripts/lib/fa-consolidation-controls.js';
test('runtime patches are masked, conditional, pinned and verified; user paths cannot be written',async()=>{
 const calls=[],fields={status:{stringValue:'PREPARING'}};
 const adapter=createConsolidationControls({getToken:async()=> 'synthetic',fetchImpl:async(url,options)=>{
  calls.push({url,options});return {ok:true,status:200,json:async()=>options.method==='POST'?{writeResults:[{}]}:{fields,updateTime:'next'}};
 }});
 const write={projectId:'sahmt-17a16',path:'managementRuntime/faConsolidation',fields};
 const prior={name:'projects/sahmt-17a16/databases/(default)/documents/managementRuntime/faConsolidation',updateTime:'2026-10-15T10:00:00Z'};
 await adapter.patch(write,prior);
 const payload=JSON.parse(calls[0].options.body);
 assert.deepEqual(payload.writes[0].currentDocument,{updateTime:prior.updateTime});
 assert.deepEqual(payload.writes[0].updateMask,{fieldPaths:['status']});
 assert.ok(!payload.writes[0].delete);
 await assert.rejects(()=>adapter.patch({...write,path:'users/private'},null));assert.equal(calls.length,2);
 for(const previous of [undefined,{}, {updateTime:prior.updateTime},{...prior,name:'wrong'},{...prior,updateTime:''}])await assert.rejects(()=>adapter.patch(write,previous));
 assert.equal(calls.length,2);
});
test('unknown commit outcomes and postcheck mismatches stop without retry',async()=>{
 for(const scenario of ['network','mismatch']){
  let calls=0;const adapter=createConsolidationControls({getToken:async()=> 'synthetic',fetchImpl:async(_,options)=>{
   calls++;if(scenario==='network')throw Error('synthetic');return {ok:true,status:200,json:async()=>options.method==='POST'?{writeResults:[{}]}:{fields:{}}};
  }});
  await assert.rejects(()=>adapter.patch({projectId:'sahmt-17a16',path:'managementRuntime/faConsolidation',fields:{status:{stringValue:'PREPARING'}}},null));
  assert.equal(calls,scenario==='network'?1:2);
 }
});
