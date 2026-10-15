/* Validated legacy score -> consolidated FA ledger. No browser input or timer.
 * Historical fb-legacy receipt IDs remain stable after the move. */
function evaluationLegacyScoreAward_(score) {
  const origin=score&&score.originProjectId||SAHMT_EVALUATION_FB;
  if(![SAHMT_V2_CONFIG.projectId,SAHMT_EVALUATION_FB].includes(origin))throw new Error('LEGACY_SCORE_ORIGIN_INVALID');
  const types={trainingStart:['TRAINING_ACCESS','training-access-v1'],trainingCompletion:['TRAINING_COMPLETION','training-completion-v1'],MANAGEMENT_TASK_COMPLETION:['MANAGEMENT_TASK','management-task-completion-v1']};
  const type=score&&types[score.sourceType];
  if(!type||!score.id||!score.uid||!score.sourceId||score.ruleId!==type[1]||
    !Number.isFinite(score.points)||score.points<0||score.points>1000||
    !Number.isInteger(score.trainingVersion===undefined?score.ruleVersion:score.trainingVersion)||
    (score.trainingVersion===undefined?score.ruleVersion:score.trainingVersion)<1)throw new Error('LEGACY_SCORE_EVIDENCE_INVALID');
  const evidence={id:score.id,uid:score.uid,sourceType:score.sourceType,sourceId:score.sourceId,ruleId:score.ruleId,
    version:score.trainingVersion===undefined?score.ruleVersion:score.trainingVersion,points:score.points};
  return {uid:score.uid,category:'PERFORMANCE',modality:type[0],creditScopeId:'legacy-score-'+score.id,
    activityId:score.sourceId,areaId:'',version:1,points:score.points,sourceType:origin===SAHMT_EVALUATION_FB?'VALIDATED_FB_SCORE':'VALIDATED_FA_SCORE',sourceId:score.id,
    sourceFingerprint:sha256Hex_(evaluationDeliveryCanonical_(evidence)),evidence:{sourceProjectId:origin,scoreId:score.id}};
}
function evaluationLegacyScoreTaskWrites_(writes) {
  evaluationProject_();
  const prefix=evaluationDocumentName_('scores','');
  return writes.filter(function(w){return w.update&&w.update.name.indexOf(prefix)===0;}).map(function(w){
    const id=w.update.name.slice(prefix.length),score=firestoreFieldsToJs_(w.update.fields);
    if(!/^[A-Za-z0-9_-]{1,200}$/.test(id)||score.id!==id)throw new Error('LEGACY_SCORE_ID_INVALID');
    evaluationLegacyScoreAward_(score);
    return evaluationWrite_('evaluationLegacyScoreOutbox',id,{id:id,sourceId:id,status:'PENDING',schemaVersion:1},null,['createdAt']);
  });
}
function evaluationDeliverLegacyScore_(id) {
  evaluationProject_();
  evaluationAssertOperator_(true);
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(id||''))throw new Error('LEGACY_SCORE_ID_INVALID');
  const result=evaluationRunTransaction_(function(tx){
    const task=evaluationGet_('evaluationLegacyScoreOutbox',id,tx),score=evaluationGet_('scores',id,tx);
    if(!task||task.id!==id||task.sourceId!==id||!['PENDING','DELIVERED'].includes(task.status))throw new Error('LEGACY_SCORE_TASK_INVALID');
    const award=evaluationLegacyScoreAward_(score),receiptId='fb-legacy-'+sha256Hex_(id),receipt=evaluationGet_('evaluationSourceReceipts',receiptId,tx);
    if(receipt){if(receipt.fingerprint!==award.sourceFingerprint||receipt.sourceProjectId!==award.evidence.sourceProjectId)throw new Error('LEGACY_SCORE_CONFLICT');return {writes:[],result:receipt.result};}
    const applied=evaluationApplyAwards_([award],{transaction:tx,legacyVerified:true});
    if(applied.status==='NEEDS_REVIEW')throw new Error('LEGACY_SCORE_REVIEW_REQUIRED');
    const result={fingerprint:award.sourceFingerprint,awardId:applied.awards[0].awardId};
    applied.writes.push(evaluationWrite_('evaluationSourceReceipts',receiptId,{id:receiptId,sourceId:id,sourceProjectId:award.evidence.sourceProjectId,fingerprint:award.sourceFingerprint,result:result},null,['createdAt']));
    return {writes:applied.writes,result:result};
  });
  const summary=evaluationPublishCategorySummary_('PERFORMANCE');
  if(!summary||!['CONFIRMED','DUPLICATE'].includes(summary.status))throw new Error('LEGACY_SCORE_SUMMARY_PENDING');
  evaluationRunTransaction_(function(tx){
    const task=evaluationGet_('evaluationLegacyScoreOutbox',id,tx),score=evaluationGet_('scores',id,tx);
    if(evaluationLegacyScoreAward_(score).sourceFingerprint!==result.fingerprint)throw new Error('LEGACY_SCORE_CONFLICT');
    return {writes:task.status==='DELIVERED'?[]:[evaluationWrite_('evaluationLegacyScoreOutbox',id,{status:'DELIVERED',awardId:result.awardId},task,['deliveredAt'])],result:true};
  });return {status:'DELIVERED'};
}
function recuperarPontuacoesValidadasFbV1() {
  evaluationProject_();
  evaluationAssertOperator_(true);
  const tasks=evaluationQuery_('evaluationLegacyScoreOutbox',[firestoreFilter_('status','EQUAL',{stringValue:'PENDING'})],[],20,['id']);
  const result={code:'LEGACY_SCORE_DELIVERY',delivered:0,pending:0};
  tasks.forEach(function(task){try{evaluationDeliverLegacyScore_(task.id);result.delivered++;}catch(_){result.pending++;}});return result;
}

/** Explicit bounded recovery of pre-cutover scores; preview is the default.
 * IDs come from the private verified inventory, never a browser payload. */
function prepararPontuacoesHistoricasFbV1(scoreIds, aplicar) {
  evaluationProject_();
  evaluationAssertOperator_(true);
  if(aplicar!==undefined&&typeof aplicar!=='boolean')throw new Error('LEGACY_SCORE_MODE_INVALID');
  if(!Array.isArray(scoreIds)||scoreIds.length<1||scoreIds.length>20||
    new Set(scoreIds).size!==scoreIds.length||scoreIds.some(function(id){return !/^[A-Za-z0-9_-]{1,200}$/.test(id);}))throw new Error('LEGACY_SCORE_BATCH_INVALID');
  return evaluationRunTransaction_(function(tx){
    const writes=[],result={code:aplicar===true?'LEGACY_SCORE_BACKFILL_PREPARED':'LEGACY_SCORE_BACKFILL_PREVIEW',eligible:0,existing:0,queued:0};
    scoreIds.forEach(function(id){
      const score=evaluationGet_('scores',id,tx),award=evaluationLegacyScoreAward_(score);
      if(!evaluationActiveProfile_(evaluationGet_('users',award.uid,tx),award.uid))throw new Error('LEGACY_SCORE_PROFILE_INVALID');
      const task=evaluationGet_('evaluationLegacyScoreOutbox',id,tx);
      if(task){
        if(task.id!==id||task.sourceId!==id||task.schemaVersion!==1||!['PENDING','DELIVERED'].includes(task.status))throw new Error('LEGACY_SCORE_TASK_INVALID');
        result.existing++;return;
      }
      result.eligible++;
      if(aplicar===true)writes.push(evaluationWrite_('evaluationLegacyScoreOutbox',id,{id:id,sourceId:id,status:'PENDING',schemaVersion:1},null,['createdAt']));
    });
    result.queued=writes.length;return {writes:writes,result:result};
  });
}
