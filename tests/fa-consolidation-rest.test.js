import test from 'node:test';import assert from 'node:assert/strict';
import {createFaConsolidationRestAdapter} from '../scripts/lib/fa-consolidation-rest.js';
const op={path:'trainings/synthetic',action:'CREATE',fields:{title:{stringValue:'Synthetic'}},precondition:{exists:false}};
const plan={ready:true,sourceProjectId:'sahmt-gestao-5ae66',destinationProjectId:'sahmt-17a16',operations:[op]};
function setup(response={ok:true,status:200,text:async()=>JSON.stringify({writeResults:[{updateTime:'2026-10-15T10:00:00Z'}]})}){
 const calls=[];const adapter=createFaConsolidationRestAdapter({plan,getSourceAccessToken:async()=>'FB-token',getDestinationAccessToken:async()=>'FA-token',
  fetchImpl:async(url,options)=>{calls.push({url,options});return response;},assertBarrier:async()=>true});return {adapter,calls};
}
test('write adapter accepts only the exact pinned FA document and precondition',async()=>{
 const x=setup(),write={projectId:'sahmt-17a16',databaseId:'(default)',...op};await x.adapter.commit(write);
 assert.match(x.calls[0].url,/projects\/sahmt-17a16\/databases\/\(default\)\/documents:commit$/);
 assert.equal(x.calls[0].options.headers.Authorization,'Bearer FA-token');assert.deepEqual(JSON.parse(x.calls[0].options.body).writes[0].currentDocument,{exists:false});
 for(const patch of [{projectId:'sahmt-gestao-5ae66'},{path:'users/other'},{fields:{title:{stringValue:'changed'}}},{precondition:{exists:true}}])await assert.rejects(()=>x.adapter.commit({...write,...patch}));
 assert.equal(x.calls.length,1);
});
test('reads use the correct account and remain restricted to reviewed paths',async()=>{
 const x=setup({ok:false,status:404});assert.equal(await x.adapter.readSource(op.path),null);assert.equal(await x.adapter.readDestination(op.path),null);
 assert.equal(x.calls[0].options.headers.Authorization,'Bearer FB-token');assert.equal(x.calls[1].options.headers.Authorization,'Bearer FA-token');
 await assert.rejects(()=>x.adapter.readDestination('users/other'));assert.equal(x.calls.length,2);
});
test('HTTP failure never includes raw API response',async()=>{
 const x=setup({ok:false,status:403,text:async()=>{throw Error('private-response');}});
 await assert.rejects(()=>x.adapter.readSource(op.path),e=>e.message==='CONSOLIDATION_REST_HTTP_403');
});
