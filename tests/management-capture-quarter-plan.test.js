import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareManagementCaptureQuarterPlan, validateManagementCaptureQuarterPlan, parseManagementCaptureCommand} from '../scripts/lib/management-capture-quarter-plan.js';
const FA='sahmt-17a16', time='2026-10-09T07:00:00Z';
const fixture=(count=365)=>({
  sourceSnapshot:{schemaVersion:1,projectId:FA,databaseId:'(default)',readTime:time,
    coverage:{complete:true,consistent:true,rootCollections:['managementAreas','users']},
    documents:Array.from({length:count},(_,index)=>({path:'managementAreas/item'+index,
      fields:{value:{integerValue:String(index)}},createTime:time,updateTime:time}))},
  scope:{schemaVersion:1,projectId:FA,databaseId:'(default)',rootCollections:['users','managementAreas']}
});
test('quarter plan usa toda a captura histórica, sem confundir os 134 COPY',()=>{
  const input=fixture(), plan=prepareManagementCaptureQuarterPlan(input);
  assert.equal(plan.baselineDocumentCount,365);assert.equal(plan.maxBatchDocuments,92);
  assert.equal(plan.maxBatches,4);assert.equal(plan.documentPageSize,25);assert.equal(plan.maxReservedReadsPerBatch,1500);
  assert.equal(plan.automaticNextBatch,false);assert.equal(plan.currentDocumentCountKnown,false);
  assert.equal(plan.partialSnapshotEligibleForMigration,false);
  assert.equal(plan.fourBatchesGuaranteeCompleteCapture,false);
  assert.equal(plan.firestoreReadsIssued,0);assert.equal(plan.firestoreWritesIssued,0);
  assert.deepEqual(validateManagementCaptureQuarterPlan({...input,plan}),plan);
});
for(const count of [1,2,3,4,5,91,92,93,134,365,6000]) {
  test('quarter plan limita documento e página para baseline '+count,()=>{
    const plan=prepareManagementCaptureQuarterPlan(fixture(count));
    assert.equal(plan.maxBatchDocuments,Math.ceil(count/4));
    assert.equal(plan.documentPageSize,Math.min(25,Math.ceil(count/4)));
  });
}
for(const field of ['maxBatchDocuments','maxBatches','maxReservedReadsPerBatch','automaticNextBatch','baselineDocumentCount','baselineSnapshotSha256','scopeSha256','planSha256']) {
  test('quarter plan recusa alteração de '+field,()=>{
    const input=fixture(), plan={...prepareManagementCaptureQuarterPlan(input)};
    plan[field]=typeof plan[field]==='boolean'?!plan[field]:typeof plan[field]==='number'?plan[field]+1:'a'.repeat(64);
    assert.throws(()=>validateManagementCaptureQuarterPlan({...input,plan}),/QUARTER_CAPTURE_PLAN_CHANGED/);
  });
}
test('quarter plan não aceita FB, roots duplicadas ou escopo reduzido',()=>{
  for(const change of [
    v=>{v.sourceSnapshot.projectId='sahmt-gestao-5ae66';},
    v=>{v.scope.rootCollections=['users','users','managementAreas'];},
    v=>{v.scope.rootCollections=['managementAreas'];}
  ]) {const input=fixture();change(input);assert.throws(()=>prepareManagementCaptureQuarterPlan(input));}
});
test('quarter plan recusa captura vazia ou incompleta',()=>{
  assert.throws(()=>prepareManagementCaptureQuarterPlan(fixture(0)),/QUARTER_CAPTURE_BASELINE_COUNT_INVALID/);
  const input=fixture();input.sourceSnapshot.coverage.complete=false;
  assert.throws(()=>prepareManagementCaptureQuarterPlan(input));
});
test('quarter plan não muda os dados históricos e invalida novo baseline',()=>{
  const input=fixture(), original=structuredClone(input), plan=prepareManagementCaptureQuarterPlan(input);
  assert.deepEqual(input,original);input.sourceSnapshot.documents[0].fields.value.integerValue='1000';
  assert.throws(()=>validateManagementCaptureQuarterPlan({...input,plan}),/QUARTER_CAPTURE_PLAN_CHANGED/);
});

test('captura FA completa foi substituída por um quarto com parada manual',()=>{
  assert.throws(()=>parseManagementCaptureCommand(['FA','--capture']),/FULL_FA_CAPTURE_REPLACED_BY_QUARTER_REVIEW/);
  assert.deepEqual(parseManagementCaptureCommand(['FA','--capture-quarter']),
    {reference:'FA',mode:'--capture-quarter',quarterCapture:true,resumeCheckpointName:undefined});
  assert.equal(parseManagementCaptureCommand(['FB','--capture-initial-fb']).quarterCapture,false);
});
for(const name of ['../saved-latest.dpapi.json','C:\\saved-latest.dpapi.json','saved.dpapi.json',
  'other/one-latest.dpapi.json','saved-latest.dpapi.json --capture','', 'a'.repeat(220)+'-latest.dpapi.json']) {
  test('retomada do quarto recusa nome inseguro '+name.slice(0,24),()=>{
    assert.throws(()=>parseManagementCaptureCommand(['FA','--resume-quarter',name]),/QUARTER_CHECKPOINT_NAME_INVALID/);
  });
}
test('retomada admite somente nome do checkpoint protegido e argumento explícito',()=>{
  assert.equal(parseManagementCaptureCommand(['FA','--resume-quarter','capture-FA-202610091234-latest.dpapi.json']).quarterCapture,true);
  for(const args of [
    ['FB','--capture-quarter'],['FB','--resume-quarter','a-latest.dpapi.json'],
    ['FA','--resume-quarter'],['FA','--capture-quarter','extra'],
    ['FA','--capture-initial-fb'],['FC','--capture-quarter'],['FA','--capture-quarter','a','b']
  ]) assert.throws(()=>parseManagementCaptureCommand(args));
});
