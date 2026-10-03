import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmulatorReplay,fictionalReplayCapture,replayPrivateCapture,HOMOLOGATION_PROJECT} from '../scripts/evaluation-homologation.js';

const enabled=Boolean(process.env.FIRESTORE_EMULATOR_HOST);
test('unchanged trusted Apps Script engine reconciles evaluation over REAL Firestore emulator', {skip:!enabled,timeout:360000},async t=>{
  const h=createEmulatorReplay({projectId:HOMOLOGATION_PROJECT}),capture=fictionalReplayCapture(h), {participantUid:person,managerUid:manager,reviewerUid:admin}=capture.roles;
  assert.equal(h.values('users').length,0,'Run in a fresh demo-sahmt-v2 emulator, never reuse production or unrelated data.');
  let response=capture.responses[0];
  const report=replayPrivateCapture(h,capture);
  assert.equal(report.transport,'REAL_FIRESTORE_EMULATOR');assert.equal(report.productionTriggersActivated,false);assert.equal(report.remoteAppsScriptExecuted,false);
  await t.test('missing grade is pending and acknowledgement independently receives one point',()=>{
    const awards=h.values('evaluationAwards');assert.equal(awards.length,1);assert.equal(awards[0].modality,'ACKNOWLEDGEMENT');assert.equal(awards[0].points,1);
    assert.equal(h.values('evaluationParticipations')[0].test.status,'PENDING_GRADE');assert.equal(h.values('evaluationParticipations')[0].test.score,null);
    assert.equal(h.get('evaluationReference','team').maxPerformance,1);
  });
  await t.test('late corrected grade uses actual score and duplicate response creates no additional ledger',()=>{
    response={...response,totalScore:5};h.google.set(`https://forms.googleapis.com/v1/forms/${capture.formId}/responses/${response.responseId}`,response);
    h.ctx.formsEvaluationProcessResponse_(capture.formId,response.responseId);h.ctx.evaluationPublishCategorySummary_('PERFORMANCE');
    assert.equal(h.values('evaluationAwards').find(a=>a.modality==='TEST').points,5);assert.equal(h.get('evaluationSummaries',person).performanceTotal,6);
    const before=h.values('evaluationLedger').length;h.ctx.formsEvaluationProcessResponse_(capture.formId,response.responseId);assert.equal(h.values('evaluationLedger').length,before);
  });
  await t.test('suggestion requires an independent assigned reviewer; self approval fails without writes',()=>{
    const participation=h.values('evaluationParticipations')[0],payload={participationId:participation.id,decision:'APPROVE',note:'Contribuição fictícia original e pertinente conferida'};
    const before=h.values('evaluationLedger').length;assert.throws(()=>h.invoke('formsEvaluationReviewSuggestion_',payload,person),/autoaprovação/);assert.equal(h.values('evaluationLedger').length,before);
    assert.equal(h.invoke('formsEvaluationReviewSuggestion_',payload,manager).status,'APPROVED');h.ctx.evaluationPublishCategorySummary_('PERFORMANCE');assert.equal(h.get('evaluationSummaries',person).performanceTotal,8);
  });
  await t.test('administrative correction uses CAS and source replay cannot undo manual override',()=>{
    const award=h.values('evaluationAwards').find(a=>a.modality==='TEST');
    h.seed('evaluationRequests','fixture-correct-grade',{id:'fixture-correct-grade',status:'PENDING',type:'CORRECT_SCORE',actorUid:admin,payload:{awardId:award.id,category:'PERFORMANCE',expectedAwardVersion:award.awardVersion,correctedPoints:3,reason:'Nota conferida no exercício isolado de homologação'}});
    assert.equal(h.ctx.evaluationProcessScoreCorrection_({id:'fixture-correct-grade'}).status,'APPLIED');
    const current=h.get('evaluationAwards',award.id);assert.equal(current.originalPoints,5);assert.equal(current.points,3);assert.equal(current.adminOverride,true);
    const before=h.values('evaluationLedger').length;assert.equal(h.ctx.formsEvaluationProcessResponse_(capture.formId,response.responseId).status,'NEEDS_REVIEW');assert.equal(h.get('evaluationAwards',award.id).points,3);assert.equal(h.values('evaluationLedger').length,before);
    h.seed('evaluationRequests','fixture-stale',{id:'fixture-stale',status:'PENDING',type:'CORRECT_SCORE',actorUid:admin,payload:{awardId:award.id,category:'PERFORMANCE',expectedAwardVersion:1,correctedPoints:0,reason:'Versão deliberadamente antiga deve ser bloqueada'}});
    assert.throws(()=>h.ctx.evaluationProcessScoreCorrection_({id:'fixture-stale'}),/versão antiga/);assert.equal(h.values('evaluationLedger').length,before);
    h.ctx.evaluationPublishCategorySummary_('PERFORMANCE');assert.equal(h.get('evaluationSummaries',person).performanceTotal,6);
  });
  await t.test('real material/questions governance review grants only its category and preserves performance maximum',()=>{
    const before=h.get('evaluationReference','team'),cfg=h.get('evaluationFormConfigs',capture.formId),material='HomologationMaterial123456',url=`https://drive.google.com/file/d/${material}/view`;
    h.seed('evaluationFormConfigs',capture.formId,{...cfg,materialUrls:[url],materialSnapshot:[{fileId:material,contentHash:'fixture-old-material',contentHashFormat:'DRIVE_MD5_V1',contentVerified:true}]});
    const metadata=structuredClone(capture.metadata);metadata.items.at(-1).title='Questão fictícia efetivamente revisada';h.google.set(`https://forms.googleapis.com/v1/forms/${capture.formId}`,metadata);
    h.google.set(`https://www.googleapis.com/drive/v3/files/${capture.formId}?fields=id,modifiedTime,lastModifyingUser(emailAddress)`,{id:capture.formId,modifiedTime:new Date().toISOString(),lastModifyingUser:{emailAddress:capture.profiles[1].email}});
    h.google.set(`https://www.googleapis.com/drive/v3/files/${material}?fields=id,mimeType,modifiedTime,md5Checksum,description,lastModifyingUser(emailAddress),shortcutDetails(targetId,targetMimeType)`,{id:material,mimeType:'application/pdf',md5Checksum:'fixture-new-material',modifiedTime:new Date().toISOString(),lastModifyingUser:{emailAddress:capture.profiles[1].email}});
    const first=h.invoke('formsEvaluationGovernanceRequest_',{activityId:capture.formId,areaId:capture.area.id,assignmentId:capture.area.id,previousVersion:1,newVersion:2,summary:'Material fictício efetivamente revisado nesta homologação',components:['MATERIAL'],materialEvidence:[url],questionEvidence:[]},manager);
    assert.equal(first.status,'PENDING');assert.throws(()=>h.invoke('formsEvaluationReviewGovernance_',{revisionId:first.revisionId,decision:'APPROVE',note:'Autoaprovação precisa ser recusada'},manager),/distinto|administrador/);
    assert.equal(h.invoke('formsEvaluationReviewGovernance_',{revisionId:first.revisionId,decision:'APPROVE',note:'Material e evidência fictícios conferidos independentemente'},admin).status,'APPROVED');
    const second=h.invoke('formsEvaluationGovernanceRequest_',{activityId:capture.formId,areaId:capture.area.id,assignmentId:capture.area.id,previousVersion:1,newVersion:2,summary:'Questões fictícias efetivamente revistas nesta homologação',components:['QUESTIONS'],materialEvidence:[],questionEvidence:[`https://docs.google.com/forms/d/${capture.formId}/edit`]},manager);
    assert.equal(second.revisionId,first.revisionId);assert.equal(second.status,'PENDING');assert.equal(h.invoke('formsEvaluationReviewGovernance_',{revisionId:second.revisionId,decision:'APPROVE',note:'Questões e gabarito fictícios conferidos independentemente'},admin).status,'APPROVED');
    h.ctx.evaluationPublishCategorySummary_('GOVERNANCE');assert.equal(h.get('evaluationSummaries',manager).governanceTotal,2);
    const after=h.get('evaluationReference','team');for(const key of ['maxPerformance','allZero','eligibleCount','performanceRevision','performanceStatus'])assert.equal(after[key],before[key],key);
    const governance=h.values('evaluationAwards').filter(a=>a.category==='GOVERNANCE');assert.equal(governance.length,2);assert.equal(governance.reduce((sum,a)=>sum+a.points,0),2);
    for(const [index,award] of governance.entries()) {
      const requestId=`fictional-governance-zero-${index}`;
      h.seed('evaluationRequests',requestId,{id:requestId,type:'CORRECT_SCORE',status:'PENDING',actorUid:admin,payload:{awardId:award.id,category:'GOVERNANCE',expectedAwardVersion:award.awardVersion,correctedPoints:0,reason:'Estorno administrativo fictício de governança isolada'}});
      assert.equal(h.ctx.evaluationProcessScoreCorrection_({id:requestId}).status,'APPLIED');
    }
    h.ctx.evaluationPublishCategorySummary_('GOVERNANCE');assert.equal(h.get('evaluationSummaries',manager).governanceTotal,0);
    const final=h.get('evaluationReference','team');for(const key of ['maxPerformance','allZero','eligibleCount','performanceRevision','performanceStatus'])assert.equal(final[key],before[key],key);
    assert.equal(h.get('evaluationSummaries',person).performanceTotal,6);
  });
  await t.test('accepted own obligation is zero; actual incomplete signature transfers -1/+1 once per day and correction is atomic',()=>{
    const day=h.ctx.checklistSaoPauloDay_(),prior=new Date(`${day}T12:00:00Z`);prior.setUTCDate(prior.getUTCDate()-1);const ownDay=prior.toISOString().slice(0,10);
    assert.equal(h.ctx.evaluationApplyChecklistTransfer_(ownDay,person,person,'fictional-accepted-own-signature').status,'APPLIED');assert.equal(h.get('evaluationChecklistTransfers',ownDay).amount,0);
    h.seed('scheduleDays',day,{positions:['AA','BB','CC']});h.seed('contacts','AA',{active:true,sigla:'AA',name:'Pessoa fictícia 1'});h.seed('stations','fictional-station',{active:true,order:1,name:'Arsenal inteiramente fictício'});
    const snapshot=h.ctx.readTrustedChecklistSnapshot_(day),id=`${day}_${snapshot.fingerprint}_${manager}`;
    h.seed('checklistSignatureRequests',id,{id,day,revision:snapshot.fingerprint,signerUid:manager,declaration:true,status:'PENDING_VALIDATION',justification:'Revisão manual fictícia e controlada na homologação'});
    assert.equal(h.ctx.validateChecklistSignatureRequest_({id}),'VALIDATED');assert.equal(h.get('checklistSignatures',`${day}_${snapshot.revision}`).missing,1);
    const transfer=h.get('evaluationChecklistTransfers',day);assert.equal(transfer.members[person].points,-1);assert.equal(transfer.members[manager].points,1);
    const count=h.values('evaluationLedger').length;assert.equal(h.ctx.evaluationApplyChecklistTransfer_(day,person,manager,'accepted-revision-later').status,'DUPLICATE');assert.equal(h.values('evaluationLedger').length,count);
    const award=h.values('evaluationAwards').find(a=>a.transferId===`checklist-${day}` && a.leg==='CREDIT');
    h.seed('evaluationRequests','fixture-pair-zero',{id:'fixture-pair-zero',status:'PENDING',type:'CORRECT_SCORE',actorUid:admin,payload:{awardId:award.id,category:'PERFORMANCE',expectedAwardVersion:award.awardVersion,correctedPoints:0,reason:'Estorno pareado fictício na homologação isolada'}});
    assert.equal(h.ctx.evaluationProcessScoreCorrection_({id:'fixture-pair-zero'}).status,'APPLIED');assert.equal(h.get('evaluationChecklistTransfers',day).amount,0);
    const legs=h.values('evaluationAwards').filter(a=>a.transferId===`checklist-${day}`);assert.deepEqual(legs.map(a=>a.points),[0,0]);assert.equal(legs.length,2);
    const ledger=h.values('evaluationLedger').filter(a=>a.transferId===`checklist-${day}`);assert.equal(ledger.reduce((sum,a)=>sum+a.points,0),0);assert.equal(ledger.length,4);
  });
  await t.test('failed real emulator write precondition publishes no partial transaction',()=>{
    const profile=h.get('users',person),before=h.values('evaluationLedger').length;
    assert.throws(()=>h.ctx.evaluationRunTransaction_(tx=>({writes:[h.ctx.evaluationWrite_('evaluationProbe','must-not-exist',{value:'fictional'},null,[]),h.ctx.evaluationWrite_('users',person,{displayName:'Must not commit'}, {_updateTime:'2000-01-01T00:00:00.000000Z'},[])],result:'SHOULD_NOT_COMMIT'})),/emulator HTTP/);
    assert.equal(h.get('evaluationProbe','must-not-exist'),null);assert.equal(h.get('users',person).displayName,profile.displayName);assert.equal(h.values('evaluationLedger').length,before);
    assert.ok(h.requests.some(r=>r.path.endsWith(':commit') && r.status>=400));assert.ok(h.requests.some(r=>r.path.endsWith(':rollback')));
  });
  await t.test('all financial engine reads/transactions ran exclusively against demo emulator',()=>{
    assert.ok(h.requests.filter(r=>r.path.endsWith(':beginTransaction')).length>10);assert.ok(h.requests.filter(r=>r.path.endsWith(':commit') && r.status===200 && r.writeCount>1).length>8);
    assert.ok(h.requests.every(r=>r.path.startsWith('/v1/projects/demo-sahmt-v2/')));assert.equal(h.values('scores').length,0);
    assert.equal(h.properties.get('SAHMT_V2_EVALUATION_HOMOLOGATED'),'true');assert.equal(h.ctx.ScriptApp.getProjectTriggers().length,0);
  });
});
