import test from'node:test';import assert from'node:assert/strict';
import{prepareFcConsolidationPlan,FC_CONSOLIDATION_COLLECTIONS}from'../scripts/lib/fa-consolidation-plan.js';
const time='2026-10-15T10:00:00Z',id='10000000-0000-4000-8000-000000000001',s=stringValue=>({stringValue}),stamp={timestampValue:time};
function input(){
 const report={id:s(id),formId:s('F01'),anonymous:{booleanValue:true},authorLabel:s('Anônimo'),createdAt:stamp};
 const audit={reportId:s(id),uid:s('synthetic'),formId:s('F01'),anonymous:{booleanValue:true},createdAt:stamp};
 const claim={id:s(id),sourceId:s(id),uid:s('synthetic'),formId:s('F01'),createdAt:stamp};
 const docs=[['occurrenceReports/'+id,report],['occurrenceAudit/'+id,audit],['occurrenceScoreClaims/'+id,claim],['occurrenceCatalogs/current',{schemaVersion:{integerValue:'1'},catalogs:{mapValue:{fields:{}}}}]].map(([path,fields])=>({path,fields,createTime:time,updateTime:time}));
 const snapshot=(projectId,documents)=>({schemaVersion:1,projectId,databaseId:'(default)',readTime:time,coverage:{complete:true,consistent:true,rootCollections:FC_CONSOLIDATION_COLLECTIONS},documents});
 return{source:snapshot('indicadores---sahmt',docs),destination:snapshot('sahmt-17a16',[]),scope:FC_CONSOLIDATION_COLLECTIONS};
}
test('FC tuple and private identity remain separate with unchanged IDs and no score calculation',()=>{
 const plan=prepareFcConsolidationPlan(input());assert.equal(plan.ready,true);assert.equal(plan.counts.create,4);
 assert.equal(plan.operations.find(row=>row.path.startsWith('occurrenceReports/')).fields.uid,undefined);
 assert.equal(plan.scoreRecalculations,0);assert.equal(plan.identityChanges,0);
});
test('orphan, mismatched UID, timestamp drift or missing catalog blocks the entire FC copy',()=>{
 for(const change of [x=>x.source.documents.splice(1,1),x=>x.source.documents[1].fields.uid=s('other'),x=>x.source.documents[1].fields.createdAt={timestampValue:'2026-10-14T10:00:00Z'},x=>x.source.documents.pop()]){
  const x=input();change(x);const p=prepareFcConsolidationPlan(x);assert.equal(p.ready,false);assert.ok(p.counts.conflicts>0);
 }
 const x=input();x.scope=['users'];assert.throws(()=>prepareFcConsolidationPlan(x));
});
