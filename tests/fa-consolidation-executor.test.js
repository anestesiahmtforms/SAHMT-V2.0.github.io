import test from 'node:test';import assert from 'node:assert/strict';
import {prepareFaConsolidationPlan} from '../scripts/lib/fa-consolidation-plan.js';
import {executeFaConsolidation} from '../scripts/lib/fa-consolidation-executor.js';
const t='2026-10-15T10:00:00Z',fields={points:{integerValue:'2'}},row=id=>({path:'evaluationLedger/'+id,fields,createTime:t,updateTime:t});
function setup(){
 const snap=(projectId,documents)=>({schemaVersion:1,projectId,databaseId:'(default)',readTime:t,coverage:{complete:true,consistent:true,rootCollections:['evaluationLedger']},documents});
 const input={source:snap('sahmt-gestao-5ae66',[row('a'),row('b')]),destination:snap('sahmt-17a16',[]),scope:['evaluationLedger']};
 const plan=prepareFaConsolidationPlan(input),destination=new Map(),writes=[],checkpoints=[];
 const adapter={assertBarrier:async()=>true,readSource:async path=>input.source.documents.find(x=>x.path===path),readDestination:async path=>destination.get(path)||null,
  commit:async write=>{writes.push(write);destination.set(write.path,{path:write.path,fields:structuredClone(write.fields),updateTime:t});}};
 const approval={destinationProjectId:'sahmt-17a16',planSha256:plan.planSha256,expiresAt:Date.now()+60000,
  gates:{backupVerified:true,restorationVerified:true,sourceWritersStopped:true,destinationWritersStopped:true,quotaBudgetVerified:true,sharedDataReviewed:true,backendPrepared:true,oldClientsBlocked:true}};
 return {input,plan,adapter,approval,destination,writes,checkpoints,onCheckpoint:async checkpoint=>checkpoints.push(checkpoint)};
}
test('default dry-run never accesses an adapter; apply requires pinned gates and exact FA destination',async()=>{
 const x=setup();assert.equal((await executeFaConsolidation(x)).code,'FA_CONSOLIDATION_DRY_RUN');assert.equal(x.writes.length,0);
 for(const patch of [{approval:null},{destinationProjectId:'sahmt-gestao-5ae66'},{approval:{...x.approval,planSha256:'0'.repeat(64)}},{approval:{...x.approval,gates:{...x.approval.gates,backupVerified:false}}}])await assert.rejects(()=>executeFaConsolidation({...x,mode:'APPLY',...patch}));
 assert.equal(x.writes.length,0);
});
test('bounded execution checkpoints and resumes without duplicate ledger writes',async()=>{
 const x=setup(),first=await executeFaConsolidation({...x,mode:'APPLY',maxWrites:1});assert.equal(first.code,'FA_CONSOLIDATION_PARTIAL');assert.equal(x.writes.length,1);
 const done=await executeFaConsolidation({...x,mode:'APPLY',checkpoint:x.checkpoints.at(-1)});assert.equal(done.code,'FA_CONSOLIDATION_VERIFIED');assert.equal(x.writes.length,2);
 await executeFaConsolidation({...x,mode:'APPLY',checkpoint:x.checkpoints.at(-1)});assert.equal(x.writes.length,2);
 assert.ok(x.writes.every(w=>w.projectId==='sahmt-17a16'&&w.precondition.exists===false));
});
test('a lost commit response is reconciled by rereading rather than retried blindly',async()=>{
 const x=setup(),commit=x.adapter.commit;let lose=true;x.adapter.commit=async w=>{await commit(w);if(lose){lose=false;throw Error('private network exception');}};
 await assert.rejects(()=>executeFaConsolidation({...x,mode:'APPLY'}),/COMMIT_UNCERTAIN/);assert.equal(x.writes.length,1);
 await executeFaConsolidation({...x,mode:'APPLY'});assert.equal(x.writes.length,2);
});
test('source drift, destination conflict, barrier loss and forged plans prevent writes',async()=>{
 for(const scenario of ['source','destination','barrier','plan']){
  const x=setup();if(scenario==='source')x.adapter.readSource=async()=>({...row('a'),updateTime:'2026-10-15T11:00:00Z'});
  if(scenario==='destination')x.destination.set('evaluationLedger/a',{...row('a'),fields:{points:{integerValue:'9'}}});
  if(scenario==='barrier')x.adapter.assertBarrier=async()=>false;
  if(scenario==='plan')x.plan.operations[0].fields={points:{integerValue:'99'}};
  await assert.rejects(()=>executeFaConsolidation({...x,mode:'APPLY'}));assert.equal(x.writes.length,0);
 }
});
