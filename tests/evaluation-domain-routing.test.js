import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {harness} from './evaluation-fb-harness.js';

function setup(project='FB') {
  const h=harness({project});
  h.ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>h.properties.get(k)||null,
    setProperty:(k,v)=>h.properties.set(k,v),deleteProperty:k=>h.properties.delete(k)})};
  for(const file of ['TrainingValidation.gs','ManagementScoreValidation.gs'])
    vm.runInContext(readFileSync(new URL('../apps-script-v2/'+file,import.meta.url),'utf8'),h.ctx);
  return h;
}

test('legacy validators query the selected domain and never reuse an FA cursor in FB',()=>{
  for(const project of ['FA','FB']) {
    const h=setup(project),expected=project==='FB'?'sahmt-gestao-5ae66':'sahmt-17a16';
    h.properties.set('SAHMT_V2_TRAINING_VALIDATION_CURSOR','projects/sahmt-17a16/databases/(default)/documents/trainingCompletions/old');
    h.properties.set('SAHMT_V2_MANAGEMENT_SCORE_CURSOR','projects/sahmt-17a16/databases/(default)/documents/activityScoreReviews/old');
    h.ctx.listPendingTrainingCompletions_();h.ctx.listPendingManagementScoreReviews_();
    const reads=h.requests.filter(r=>r.body.structuredQuery);assert.ok(reads.length>=2);
    assert.ok(reads.every(r=>r.url.includes('/'+expected+'/')));
    if(project==='FB') assert.ok(reads.every(r=>!r.body.structuredQuery.startAt));
  }
});

test('training and management score writes resolve to FB while profiles remain authoritative FA',()=>{
  const h=setup();
  const write=h.ctx.trainingScoreCreateWrite_({id:'fixture-score',uid:'fixture',points:1});
  assert.match(write.update.name,/projects\/sahmt-gestao-5ae66\/.*\/scores\/fixture-score$/);
  assert.match(h.ctx.evaluationDocumentName_('users','fixture'),/projects\/sahmt-17a16\//);
  assert.match(h.ctx.evaluationDocumentName_('scopedDocuments','fixture'),/projects\/sahmt-gestao-5ae66\//);
});

test('backend refuses a foreign project write before making a commit request',()=>{
  const h=setup();
  assert.throws(()=>h.ctx.evaluationRunTransaction_(()=>({writes:[{update:{name:'projects/sahmt-17a16/databases/(default)/documents/scores/fixture',fields:{}}}],result:true})),/CROSS_PROJECT/);
  assert.equal(h.requests.filter(r=>r.url.endsWith(':commit')&&r.body.writes?.length).length,0);
});
