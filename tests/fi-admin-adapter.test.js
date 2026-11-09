import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiAdminAdapter} from '../src/fi-admin-adapter.js';
test('admin adapter carries the version that the user actually reviewed and surfaces pending projections',async()=>{
 const calls=[];let actor='admin-a';
 const adapter=createFiAdminAdapter({getActorUid:async()=>actor,request:async(action,input,uid)=>{calls.push({action,input,uid});if(action==='people.list')return [{sigla:'AA',name:'Ana',active:true,version:4}];if(action==='people.save')return {record:{...input,version:5},projection:{status:'pending',id:'job'}};throw Error('unexpected');}});
 await adapter.listContactCatalog();await assert.rejects(adapter.saveContact({sigla:'AA',name:'Ana updated',active:true},'admin-a'),/FI_PROJECTION_PENDING/);
 assert.equal(calls[1].input.expectedVersion,4);assert.equal(calls[1].uid,'admin-a');
 actor='admin-b';await assert.rejects(adapter.saveContact({sigla:'AA',name:'Ana',active:true},'admin-a'),/FI_SESSION_CHANGED/);
});
