/* Registration evidence comes from the three paired documents. Preserve
 * legacy two-point registrations and validate new three-point registrations. */
function evaluationOccurrenceEvidence_(report, audit, claim) {
  const id = claim && claim.id;
  const stamp = function (value) { return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null; };
  if (!/^[A-Fa-f0-9-]{36}$/.test(id || '') || claim.schemaVersion !== 1 || claim.source !== 'REGISTRO_OCORRENCIA' ||
      claim.sourceId !== id || !claim.uid || ![2, 3].includes(claim.points) || !['PENDING_VALIDATION', 'VALIDATED'].includes(claim.status) ||
      !/^F(?:0[1-9]|10)$/.test(claim.formId || '') || !report || !audit || report.schemaVersion !== 1 || audit.schemaVersion !== 1 ||
      report.id !== id || audit.reportId !== id || audit.uid !== claim.uid || report.formId !== claim.formId || audit.formId !== claim.formId ||
      typeof report.anonymous !== 'boolean' || audit.anonymous !== report.anonymous || report.pointsClaimed !== claim.points ||
      !['PENDING_VALIDATION', 'VALIDATED'].includes(report.pointsStatus) || !stamp(claim.createdAt) ||
      stamp(claim.createdAt) !== stamp(report.createdAt) || stamp(claim.createdAt) !== stamp(audit.createdAt))
    throw new Error('OCCURRENCE_SCORE_EVIDENCE_INVALID');
  const origin = claim.originProjectId || SAHMT_EVALUATION_FC;
  if (![SAHMT_V2_CONFIG.projectId,SAHMT_EVALUATION_FC].includes(origin)) throw new Error('OCCURRENCE_SCORE_EVIDENCE_INVALID');
  return {schemaVersion: 1, sourceProjectId: origin, sourceId: id, uid: claim.uid,
    formId: claim.formId, createdAt: stamp(claim.createdAt), points: claim.points};
}
function evaluationOccurrenceClaimEvidence_(claim, transaction) {
  if (!claim) throw Error('OCCURRENCE_SCORE_EVIDENCE_INVALID');
  if (claim.source === 'REGISTRO_OCORRENCIA') {
    const report = evaluationGet_('occurrenceReports', claim.id, transaction,
      ['schemaVersion','id','formId','anonymous','pointsClaimed','pointsStatus','createdAt']);
    const audit = evaluationGet_('occurrenceAudit', claim.id, transaction,
      ['schemaVersion','reportId','uid','formId','anonymous','createdAt']);
    return {evidence:evaluationOccurrenceEvidence_(report,audit,claim),report:report};
  }
  const stage = {ANALISE_OCORRENCIA:'analysis',CIENCIA_OCORRENCIA:'ack'}[claim.source];
  // FC Rules create this claim only in the first commit of the matching
  // response or acknowledgement. Use its immutable timestamp even if the
  // user later acknowledges a corrected result.
  if (evaluationProject_() !== SAHMT_EVALUATION_FC || !['analysis','ack'].includes(stage) ||
      claim.schemaVersion !== 1 || claim.id !== stage+'-'+claim.sourceId+'_'+claim.uid ||
      !/^(?:[A-Fa-f0-9-]{36}|gr-[1-9]\d{0,11})$/.test(claim.sourceId || '') ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(claim.uid || '') || claim.points !== 1 ||
      !['PENDING_VALIDATION','VALIDATED'].includes(claim.status) ||
      !(claim.createdAt instanceof Date) || !Number.isFinite(claim.createdAt.getTime()))
    throw Error('OCCURRENCE_SCORE_EVIDENCE_INVALID');
  return {report:null,evidence:{schemaVersion:1,sourceProjectId:SAHMT_EVALUATION_FC,sourceId:claim.sourceId,
    source:claim.source,uid:claim.uid,createdAt:claim.createdAt.toISOString(),points:1}};
}
function evaluationOccurrenceEnabled_() {
  return [SAHMT_V2_CONFIG.projectId, SAHMT_EVALUATION_FB].includes(evaluationProject_()) && sahmtV2Properties_().getProperty('SAHMT_V2_OCCURRENCE_SCORING_ENABLED') === 'true';
}
function evaluationOccurrenceAssertOperator_() {
  if (!evaluationOccurrenceEnabled_()) throw new Error('OCCURRENCE_SCORING_DISABLED');
  const migration=evaluationGet_('occurrenceRuntime','independentV1');
  if(!migration || migration.status!=='ACTIVE' || migration.release!=='occurrence-fc-independent-v1' ||
      migration.sourceProjectId!==SAHMT_V2_CONFIG.projectId || migration.destinationProjectId!==SAHMT_EVALUATION_FC ||
      !/^[a-f0-9]{64}$/.test(migration.planSha256||'') || !Number.isSafeInteger(migration.verifiedDocuments) ||
      migration.verifiedDocuments<1 || migration.plannedDocuments!==migration.verifiedDocuments ||
      migration.migrationCode!=='FC_INDEPENDENT_VERIFIED') throw new Error('OCCURRENCE_FC_RELEASE_INACTIVE');
  // Occurrence awards are independent of the Forms evaluation rollout. The
  // destination still requires an explicit server-side approval marker.
  evaluationAssertOperator_(false);
  const runtime = evaluationGet_('evaluationRuntime', 'state');
  if (!runtime || runtime.occurrenceScoringApproved !== true ||
      !Number.isInteger(runtime.performanceRevision) || runtime.performanceRevision < 0)
    throw new Error('OCCURRENCE_SCORING_NOT_APPROVED');
}
function evaluationDeliverOccurrence_(claimId, expectedUid) {
  evaluationOccurrenceAssertOperator_();
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(claimId || '')) throw new Error('OCCURRENCE_SCORE_ID_INVALID');
  const receiptId = 'fc-occurrence-' + sha256Hex_(claimId);
  const result = evaluationRunTransaction_(function (transaction) {
    const claim = evaluationGet_('occurrenceScoreClaims', claimId, transaction);
    if (expectedUid && claim && claim.uid !== expectedUid) throw new Error('OCCURRENCE_SCORE_AUTHOR_MISMATCH');
    const evidence = evaluationOccurrenceClaimEvidence_(claim, transaction).evidence;
    const fingerprint = sha256Hex_(evaluationDeliveryCanonical_(evidence));
    const receipt = evaluationGet_('evaluationSourceReceipts', receiptId, transaction);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new Error('OCCURRENCE_SCORE_CONFLICT');
      return {writes: [], result: receipt.result};
    }
    const sourceType = evidence.source==='ANALISE_OCORRENCIA'?'FC_OCCURRENCE_ANALYSIS':
      evidence.source==='CIENCIA_OCORRENCIA'?'FC_OCCURRENCE_ACKNOWLEDGEMENT':
      evidence.sourceProjectId===SAHMT_EVALUATION_FC?'FC_OCCURRENCE_VERIFIED':'FA_OCCURRENCE_VERIFIED';
    const creditScopeId = 'fc-occurrence-' + claimId;
    const award = {uid:evidence.uid,category:'PERFORMANCE',modality:'OCCURRENCE',creditScopeId:creditScopeId,
      activityId:creditScopeId,areaId:'',version:1,points:evidence.points,sourceType:sourceType,sourceId:claimId,sourceFingerprint:fingerprint,
      evidence:Object.assign({sourceProjectId:evidence.sourceProjectId,reportId:evidence.sourceId},evidence.formId?{formId:evidence.formId}:{})};
    const applied = evaluationApplyAwards_([award], {transaction: transaction});
    if (applied.status === 'NEEDS_REVIEW') throw new Error('OCCURRENCE_SCORE_REVIEW_REQUIRED');
    const outcome = {status: applied.status, awardId: applied.awards[0].awardId, fingerprint: fingerprint};
    applied.writes.push(evaluationWrite_('evaluationSourceReceipts', receiptId,
      {id: receiptId, sourceProjectId: evidence.sourceProjectId, sourceId: claimId, fingerprint: fingerprint, result: outcome}, null, ['createdAt']));
    return {writes: applied.writes, result: outcome};
  });
  // Publish the performance summary before acknowledging the source. If this
  // fails, its pending claim remains recoverable and the receipt prevents a
  // second award. No unrelated Checklist timer is required for visibility.
  const summary = evaluationPublishCategorySummary_('PERFORMANCE');
  if (!summary || !['CONFIRMED', 'DUPLICATE'].includes(summary.status)) throw new Error('OCCURRENCE_SCORE_SUMMARY_PENDING');
  // Destination is already durable. A failed acknowledgement leaves a recoverable claim.
  evaluationRunTransaction_(function (transaction) {
    const claim = evaluationGet_('occurrenceScoreClaims', claimId, transaction);
    const proof = evaluationOccurrenceClaimEvidence_(claim, transaction);
    if (sha256Hex_(evaluationDeliveryCanonical_(proof.evidence)) !== result.fingerprint) throw new Error('OCCURRENCE_SCORE_CONFLICT');
    if (claim.status === 'VALIDATED' && (!proof.report || proof.report.pointsStatus === 'VALIDATED')) return {writes:[],result:true};
    const writes = [evaluationWrite_('occurrenceScoreClaims', claimId,
      {status:'VALIDATED',destinationProjectId:evaluationProject_(),awardId:result.awardId},claim,['validatedAt'])];
    if (proof.report) writes.push(evaluationWrite_('occurrenceReports', proof.evidence.sourceId, {pointsStatus:'VALIDATED'}, proof.report, []));
    return {writes:writes,result:true};
  }, {projectId: SAHMT_EVALUATION_FC});
  return {status: result.status};
}
/** Bounded recovery tool only. Does not install a timer or scan report contents. */
function recuperarPontuacoesOcorrenciasFbV1() {
  if (!evaluationOccurrenceEnabled_()) return {code: 'OCCURRENCE_SCORING_DISABLED', delivered: 0, pending: 0};
  evaluationOccurrenceAssertOperator_();
  const claims = evaluationQuery_('occurrenceScoreClaims', [firestoreFilter_('status', 'EQUAL', {stringValue: 'PENDING_VALIDATION'})], [], 20, ['id']);
  const result = {code: 'OCCURRENCE_SCORE_RECOVERY', delivered: 0, pending: 0};
  claims.forEach(function (claim) { try { evaluationDeliverOccurrence_(claim.id); result.delivered++; } catch (_) { result.pending++; } });
  return result;
}
