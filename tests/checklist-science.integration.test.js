import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmulatorReplay} from '../scripts/evaluation-homologation.js';

test('ciência isolada usa consultas e commits Firestore reais no emulador, preservando bloqueios globais',
 {skip:!process.env.FIRESTORE_EMULATOR_HOST,timeout:180000},()=>{
 const h=createEmulatorReplay(),day=h.ctx.checklistSaoPauloDay_();
 assert.equal(h.values('users').length,0,'Use a fresh demo emulator.');
 const profile=(uid,sigla)=>({uid,sigla,active:true,access:true,role:'usuario',displayName:`Synthetic ${sigla}`,email:`${sigla.toLowerCase()}@example.invalid`,permissions:{checklistSign:true}});
 h.seed('users','synthetic-a',profile('synthetic-a','AA'));
 h.seed('users','synthetic-b',profile('synthetic-b','BB'));
 h.seed('scheduleDays',day,{date:day,positions:[{position:1,sigla:'AA'},{position:2,sigla:'BB'}],highlights:{events:[]}});
 h.seed('stations','synthetic-station',{id:'synthetic-station',active:true,name:'Synthetic station',order:1});
 h.seed('checklistScienceRuntime','state',{enabled:true,release:'checklist-science-v1',activatedAt:new Date(Date.now()-60000)});
 h.seed('managementRuntime','faConsolidation',{schemaVersion:1,release:'fa-consolidation-v1',status:'ACTIVE',
  sourceProjectId:'sahmt-gestao-5ae66',destinationProjectId:'sahmt-17a16',planSha256:'a'.repeat(64),
  verifiedDocuments:1,plannedDocuments:1,migrationCode:'FA_CONSOLIDATION_VERIFIED'});
 h.properties.set('SAHMT_V2_CHECKLIST_SCIENCE_ENABLED','true');
 h.properties.set('SAHMT_V2_CHECKLIST_SCIENCE_OPERATOR','operator@example.invalid');
 assert.throws(()=>h.ctx.evaluationAssertOperator_(true));
 const snapshot=h.ctx.readTrustedChecklistSnapshot_(day,null,{eventRotation:true}),id=day;
 h.seed('checklistSignatureRequests',id,{id,day,revision:snapshot.fingerprint,signerUid:'synthetic-b',signerName:'Synthetic BB',declaration:true,
  recordKind:'ACKNOWLEDGEMENT',status:'PENDING_VALIDATION',justification:'Declaro que tomei ciência das informações deste relatório.',
  rotationSigla:'AA',rotationPosition:1,acknowledgedAt:new Date()});
 const pending=h.ctx.listPendingChecklistScienceRequests_(h.ctx.checklistScienceAssertOperator_().activatedAt);
 assert.deepEqual(JSON.parse(JSON.stringify(pending)),[{id}]);
 assert.equal(h.ctx.validateChecklistSignatureRequest_({id},{scienceOnly:true}),'VALIDATED');
 assert.equal(h.ctx.evaluationDrainChecklistDeliveries_({scienceOnly:true}).delivered,0);
 assert.equal(h.get('checklistSignatureRequests',id).pointsAwarded,1);
 assert.equal(h.get('checklistSignatureRequests',id).responsibleAdjustment,-1);
 const before=h.values('evaluationLedger').length;
 assert.equal(before,2);
 assert.equal(h.ctx.validateChecklistSignatureRequest_({id},{scienceOnly:true}),'DUPLICATE');
 assert.equal(h.values('evaluationLedger').length,before);
 const legacyId=`${day}_synthetic-a`;
 h.seed('checklistSignatureRequests',legacyId,{...h.get('checklistSignatureRequests',id),id:legacyId,signerUid:'synthetic-a',signerName:'Synthetic AA',status:'PENDING_VALIDATION',acknowledgedAt:new Date()});
 assert.equal(h.ctx.validateChecklistSignatureRequest_({id:legacyId},{scienceOnly:true}),'DUPLICATE');
 assert.equal(h.get('checklistSignatureRequests',id).signerUid,'synthetic-b');
 assert.equal(h.values('evaluationLedger').length,before);
 assert.equal(h.ctx.evaluationPublishCategorySummary_('PERFORMANCE',{scienceOnly:true}).status,'CONFIRMED');
 assert.equal(h.get('evaluationSummaries','synthetic-a').performanceTotal,-1);
 assert.equal(h.get('evaluationSummaries','synthetic-b').performanceTotal,1);
 assert.notEqual(h.get('evaluationRuntime','state').homologationVerified,true);
 assert.throws(()=>h.ctx.evaluationAssertOperator_(true));
 h.seed('checklistScienceRuntime','state',{enabled:false,release:'checklist-science-v1',activatedAt:new Date(Date.now()-60000)});
 assert.throws(()=>h.ctx.validateChecklistSignatureRequest_({id},{scienceOnly:true}),/DISABLED/);
 assert.ok(h.requests.every(r=>r.path.startsWith('/v1/projects/demo-sahmt-v2/')));
 assert.equal(h.values('scores').length,0);
});
