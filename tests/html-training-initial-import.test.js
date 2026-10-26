import test from 'node:test';
import assert from 'node:assert/strict';
import {IMPORT_PROJECT,initialImportPlan,importInitialDrafts,verifyImportRules} from '../scripts/lib/html-training-initial-import.js';

const sha='a'.repeat(64);
const manifest=()=>({schemaVersion:1,projectId:IMPORT_PROJECT,trainings:[{trainingId:'demo',
 training:{title:'Training',category:'Protocols',audienceGroup:'GENERAL',managerUid:'',status:'DRAFT',source:{documentId:'official'}},
 sections:[{id:'intro',title:'Introduction',html:'<p>Read me.</p>'}],
 bank:Array.from({length:5},(_,i)=>({id:'q'+i,stem:'Question '+i,points:1,options:[{id:'a',text:'A'},{id:'b',text:'B'}],correctOptionId:'b'})),
 selectedQuestionIds:['q0','q1','q2','q3','q4'],pending:[{code:'SOURCE_REVIEW_REQUIRED'}]}]});
function memory(){
 const records=new Map(),writes=[];
 const get=async(c,id)=>structuredClone(records.get(c+'/'+id)??null);
 const getMany=(c,ids)=>Promise.all(ids.map(id=>get(c,id)));
 return {records,writes,get,getMany,async transaction(fn){
  const staged=[];const result=await fn({get,getMany,create:(c,id,data)=>staged.push({c,id,data:structuredClone(data)})});
  for(const w of staged){assert.equal(records.has(w.c+'/'+w.id),false);records.set(w.c+'/'+w.id,w.data);writes.push(w);}
  return result;
 }};
}
const plan=(now=100)=>initialImportPlan(manifest(),{manifestSha256:sha,now});

test('initial import dry-run validates drafts without writing any data',async()=>{
 const store=memory(),report=await importInitialDrafts(store,plan());
 assert.equal(report.mode,'DRY_RUN');assert.equal(report.documentsWritten,0);assert.equal(store.records.size,0);
});
test('apply creates private version and content with provenance, no users, scores or Drive queue',async()=>{
 const store=memory(),report=await importInitialDrafts(store,plan(),{apply:true});
 assert.equal(report.documentsWritten,3);assert.equal(store.records.size,3);
 const metadata=await store.get('htmlTrainings','demo');
 assert.equal(metadata.status,'DRAFT');assert.equal(metadata.managerUid,'');assert.equal(metadata.createdByUid,'');
 assert.equal(metadata.initialImportSha256,sha);assert.equal(metadata.importPending[0].code,'SOURCE_REVIEW_REQUIRED');
 assert.equal(store.writes.some(w=>/users|Scores|States|Sync/.test(w.c)),false);
 const version=await store.get('htmlTrainingVersions','demo_v1'),chunk=await store.get('htmlTrainingContent','demo_v1_p0');
 assert.equal(version.bank[0].correctOptionId,'b');assert.deepEqual(JSON.parse(chunk.part),manifest().trainings[0].sections);
});
test('rerun with a new timestamp skips imported items and preserves later edits',async()=>{
 const store=memory();await importInitialDrafts(store,plan(),{apply:true});
 store.records.get('htmlTrainings/demo').title='Manager edited';
 const report=await importInitialDrafts(store,plan(200),{apply:true});
 assert.equal(report.skipped,1);assert.equal(report.documentsWritten,0);assert.equal(store.records.get('htmlTrainings/demo').title,'Manager edited');
});
test('existing conflicting training or orphan content blocks import without overwrite',async()=>{
 for(const [key,value]of [['htmlTrainings/demo',{title:'Existing'}],['htmlTrainingContent/demo_v1_p0',{part:'Existing'}]]){
  const store=memory();store.records.set(key,value);
  await assert.rejects(importInitialDrafts(store,plan(),{apply:true}),/CONFLICT/);assert.equal(store.writes.length,0);
 }
});
test('published item, assigned manager, wrong project and unexpected collection are rejected',async()=>{
 for(const change of [m=>m.projectId='FA',m=>m.trainings[0].training.status='PUBLISHED',m=>m.trainings[0].training.managerUid='manager']){
  const m=manifest();change(m);assert.throws(()=>initialImportPlan(m,{manifestSha256:sha}),/IMPORT_/);
 }
 const p=plan();p[0].records.push({collection:'users',id:'victim',data:{}});
 const store=memory();await assert.rejects(importInitialDrafts(store,p,{apply:true}),/WRITE_SCOPE/);assert.equal(store.writes.length,0);
});
test('readback catches corrupted committed content',async()=>{
 const store=memory(),original=store.transaction;
 store.transaction=async fn=>{const value=await original(fn);if(store.records.has('htmlTrainingContent/demo_v1_p0'))store.records.get('htmlTrainingContent/demo_v1_p0').part='Corrupted';return value;};
 await assert.rejects(importInitialDrafts(store,plan(),{apply:true}),/READBACK_FAILED/);
});
test('rules preflight fails closed on changed rules or foreign ruleset',async()=>{
 const rules='deny all';
 const mock=(project=IMPORT_PROJECT,content=rules)=>async url=>({ok:true,json:async()=>url.endsWith('cloud.firestore')?
  {rulesetName:`projects/${project}/rulesets/current`}:{source:{files:[{content}]}}});
 assert.equal((await verifyImportRules('token',rules,{fetchImpl:mock()})).rulesetName,`projects/${IMPORT_PROJECT}/rulesets/current`);
 await assert.rejects(verifyImportRules('token',rules,{fetchImpl:mock('other')}),/PROJECT_INVALID/);
 await assert.rejects(verifyImportRules('token',rules,{fetchImpl:mock(IMPORT_PROJECT,'allow all')}),/CHANGED/);
});
