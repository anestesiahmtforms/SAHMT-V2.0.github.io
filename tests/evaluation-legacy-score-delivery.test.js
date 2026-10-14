import test from 'node:test';import assert from 'node:assert/strict';
import {harness} from './evaluation-fb-harness.js';
function setup(sourceType='trainingCompletion') {
 const h=harness();h.seed('users','member',{uid:'member',active:true,access:true});
 const score={id:'score-fixture',uid:'member',sourceType,sourceId:'source-fixture',ruleId:sourceType==='trainingStart'?'training-access-v1':sourceType==='trainingCompletion'?'training-completion-v1':'management-task-completion-v1',points:3,...(sourceType==='MANAGEMENT_TASK_COMPLETION'?{ruleVersion:1}:{trainingVersion:1})};
 h.seed('scores',score.id,score);h.seed('evaluationLegacyScoreOutbox',score.id,{id:score.id,sourceId:score.id,status:'PENDING',schemaVersion:1});return {h,score};
}
test('all validated legacy modalities enter the FB ledger once and publish the summary',()=>{
 for(const type of ['trainingStart','trainingCompletion','MANAGEMENT_TASK_COMPLETION']){
 const {h,score}=setup(type);h.ctx.evaluationDeliverLegacyScore_(score.id);h.ctx.evaluationDeliverLegacyScore_(score.id);
 assert.equal(h.values('evaluationLedger').length,1);assert.equal(h.data('evaluationSummaries','member').performanceTotal,3);
 assert.equal(h.data('evaluationLegacyScoreOutbox',score.id).status,'DELIVERED');assert.equal(h.data('scores',score.id).points,3);
 }
});
test('failed summary leaves a durable task and retry does not duplicate points',()=>{
 const {h,score}=setup(),publish=h.ctx.evaluationPublishCategorySummary_;h.ctx.evaluationPublishCategorySummary_=()=>{throw Error('synthetic');};
 assert.throws(()=>h.ctx.evaluationDeliverLegacyScore_(score.id));assert.equal(h.data('evaluationLegacyScoreOutbox',score.id).status,'PENDING');
 h.ctx.evaluationPublishCategorySummary_=publish;h.ctx.evaluationDeliverLegacyScore_(score.id);assert.equal(h.values('evaluationLedger').length,1);
});
test('forged legacy amount, rule or owner cannot be imported',()=>{
 for(const patch of [{points:1001},{points:-1},{ruleId:'forged'},{uid:'other'},{trainingVersion:0},{sourceType:'browser'}]){
 const {h,score}=setup();h.seed('scores',score.id,{...score,...patch});assert.throws(()=>h.ctx.evaluationDeliverLegacyScore_(score.id));assert.equal(h.values('evaluationLedger').length,0);
 }
});
test('task writes accompany only new validated score writes and are disabled on FA',()=>{
 const {h,score}=setup();const write={update:{name:h.ctx.evaluationDocumentName_('scores',score.id),fields:h.ctx.firestoreFieldsFromJs_(score)},currentDocument:{exists:false}};
 const tasks=h.ctx.evaluationLegacyScoreTaskWrites_([write]);assert.equal(tasks.length,1);assert.ok(tasks[0].update.name.includes('/sahmt-gestao-5ae66/'));assert.equal(tasks[0].currentDocument.exists,false);
 const fa=harness({project:'FA'});assert.equal(fa.ctx.evaluationLegacyScoreTaskWrites_([write]).length,0);
});
test('verified modality cannot be awarded through generic unverified input',()=>{
 const {h,score}=setup();const award=h.ctx.evaluationLegacyScoreAward_(score);
 assert.throws(()=>h.ctx.evaluationPlanAward_(null,award,{}),/VERIFICATION_REQUIRED/);
});
test('changed source after completed delivery is blocked without overwriting previous points',()=>{
 const {h,score}=setup();h.ctx.evaluationDeliverLegacyScore_(score.id);h.seed('scores',score.id,{...score,points:4});
 assert.throws(()=>h.ctx.evaluationDeliverLegacyScore_(score.id),/CONFLICT/);assert.equal(h.values('evaluationLedger').length,1);
});

test('historical score preview does not queue or credit; explicit application is idempotent',()=>{
 const {h,score}=setup();h.store.delete(h.ctx.evaluationDocumentName_('evaluationLegacyScoreOutbox',score.id));
 const preview=h.ctx.prepararPontuacoesHistoricasFbV1([score.id]);assert.equal(preview.eligible,1);assert.equal(preview.queued,0);assert.equal(h.values('evaluationLegacyScoreOutbox').length,0);
 const apply=h.ctx.prepararPontuacoesHistoricasFbV1([score.id],true);assert.equal(apply.queued,1);assert.equal(h.values('evaluationLedger').length,0);
 assert.equal(h.ctx.prepararPontuacoesHistoricasFbV1([score.id],true).existing,1);
 h.ctx.evaluationDeliverLegacyScore_(score.id);assert.equal(h.data('evaluationSummaries','member').performanceTotal,3);
});
test('historical score batches fail closed before any writes',()=>{
 for(const ids of [[],Array(21).fill('score-fixture'),['score-fixture','score-fixture'],['../scores'],['missing']]){
 const {h}=setup();assert.throws(()=>h.ctx.prepararPontuacoesHistoricasFbV1(ids,true));assert.equal(h.values('evaluationLedger').length,0);
 }
 const {h,score}=setup();h.seed('users','member',{uid:'member',active:false,access:true});assert.throws(()=>h.ctx.prepararPontuacoesHistoricasFbV1([score.id],true),/PROFILE_INVALID/);
});
