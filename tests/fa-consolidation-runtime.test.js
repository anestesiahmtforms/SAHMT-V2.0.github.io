import test from 'node:test';import assert from 'node:assert/strict';
import {harness} from './evaluation-fb-harness.js';
test('management and performance producers use FA even with an obsolete FB property',()=>{
 const h=harness({project:'FA'});assert.equal(h.ctx.evaluationProject_(),'sahmt-17a16');
 for(const name of ['trainings','scores','managementAreas','scopedDocuments','evaluationLedger','evaluationAwards','evaluationSourceReceipts','evaluationLegacyScoreOutbox','users'])assert.equal(h.ctx.evaluationCollectionProject_(name),'sahmt-17a16');
 assert.equal(h.ctx.evaluationCursorProperty_('CURSOR'),'CURSOR_FA_CONSOLIDATED_V1');
 h.properties.set('SAHMT_V2_EVALUATION_PROJECT_ID','sahmt-gestao-5ae66');assert.equal(h.ctx.evaluationProject_(),'sahmt-17a16');
});
test('moving the ledger does not broaden management administrator permissions',()=>{
 const h=harness({project:'FA'}),profile={uid:'fixture',active:true,access:true,role:'administrador_app',permissions:{}};
 assert.equal(h.ctx.evaluationAdmin_(profile),false);profile.permissions.managementManage=true;assert.equal(h.ctx.evaluationAdmin_(profile),true);
});
test('legacy receipt identity is stable while new FA scores have truthful origin metadata',()=>{
 const h=harness(),score={id:'synthetic',uid:'member',sourceId:'activity',sourceType:'trainingCompletion',ruleId:'training-completion-v1',trainingVersion:1,points:1};
 const migrated=h.ctx.evaluationLegacyScoreAward_(score),fresh=h.ctx.evaluationLegacyScoreAward_({...score,originProjectId:'sahmt-17a16'});
 assert.equal(migrated.evidence.sourceProjectId,'sahmt-gestao-5ae66');assert.equal(fresh.evidence.sourceProjectId,'sahmt-17a16');
 assert.equal(migrated.sourceFingerprint,fresh.sourceFingerprint);assert.equal(h.ctx.evaluationAwardId_(migrated),h.ctx.evaluationAwardId_(fresh));
});
test('a prepared backend cannot write before the consolidation release is explicitly active',()=>{
 const h=harness();h.store.delete(h.ctx.evaluationDocumentName_('managementRuntime','faConsolidation'));
 assert.throws(()=>h.ctx.evaluationRunTransaction_(()=>({writes:[],result:true})),/CONSOLIDATION_INACTIVE/);
 assert.equal(h.commits.length,0);
});
