import test from 'node:test';
import assert from 'node:assert/strict';
import {planTrainingOrganization,applyTrainingOrganization} from '../scripts/lib/html-training-organization.js';
const training=()=>({id:'one',title:'Example',category:'Protocolos',subcategory:'',audienceGroup:'GENERAL',managerUid:'',status:'PUBLISHED',version:2,source:{folderId:'official'}});
const mapping=()=>[{folderId:'official',category:'Protocolos',subcategory:'Protocolos do SAHMT'}];
test('folder mapping uses official IDs and rejects unknown or ambiguous membership',()=>{
 assert.equal(planTrainingOrganization([training()],mapping()).length,1);
 assert.throws(()=>planTrainingOrganization([training()],[...mapping(),...mapping()]),/MAPPING_INVALID/);
 assert.throws(()=>planTrainingOrganization([{...training(),source:{folderId:'other'}}],mapping()),/UNMAPPED/);
 assert.throws(()=>planTrainingOrganization([],mapping()),/INCOMPLETE/);
 assert.deepEqual(planTrainingOrganization([{...training(),subcategory:'Protocolos do SAHMT'}],mapping()),[]);
});
function store(profile={active:true,access:true,role:'administrador_app'}){
 const data=new Map([['users/admin',profile],['htmlTrainings/one',training()],['htmlTrainingScores/user',{total:7}],['htmlTrainingStates/one_user',{attempts:[1]}]]),writes=[];
 return {data,writes,async transaction(fn){const pending=[];await fn({get:async(c,id)=>structuredClone(data.get(c+'/'+id)||null),set:(c,id,value)=>pending.push({c,id,value}),create:(c,id,value)=>pending.push({c,id,value})});for(const w of pending){data.set(w.c+'/'+w.id,structuredClone(w.value));writes.push(w);}}};
}
test('organization changes only presentation metadata and records history without changing scores, attempts, versions or permissions',async()=>{
 const s=store(),before=structuredClone(training()),plan=planTrainingOrganization([before],mapping());
 const result=await applyTrainingOrganization(s,plan,{uid:'admin',now:123});
 assert.equal(result.permissionChanges,0);assert.equal(result.organized,1);
 assert.deepEqual(s.data.get('htmlTrainings/one'),{...before,subcategory:'Protocolos do SAHMT',organizationUpdatedAt:123,organizationUpdatedByUid:'admin'});
 assert.deepEqual(s.data.get('htmlTrainingScores/user'),{total:7});assert.deepEqual(s.data.get('htmlTrainingStates/one_user'),{attempts:[1]});
 assert.equal(s.writes.length,2);assert.equal(s.writes[0].c,'htmlTrainingOrganizationHistory');
});
test('revoked administration or a concurrent edit prevents every staged organization write',async()=>{
 const plan=planTrainingOrganization([training()],mapping());
 for(const s of [store({active:true,access:true,role:'usuario'}),store()]){
  if(s.data.get('users/admin').role==='administrador_app')s.data.get('htmlTrainings/one').version=3;
  await assert.rejects(applyTrainingOrganization(s,plan,{uid:'admin'}),/ADMIN_REQUIRED|VERSION_CONFLICT/);assert.equal(s.writes.length,0);
 }
});
