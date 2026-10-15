/* Only the existing two-point claim is eligible. Browser amounts, anonymous
 * display labels and narrative content are never used as scoring evidence. */
function evaluationOccurrenceEvidence_(report, audit, claim) {
  const id = claim && claim.id;
  const stamp = function (value) { return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null; };
  if (!/^[A-Fa-f0-9-]{36}$/.test(id || '') || claim.schemaVersion !== 1 || claim.source !== 'REGISTRO_OCORRENCIA' ||
      claim.sourceId !== id || !claim.uid || claim.points !== 2 || !['PENDING_VALIDATION', 'VALIDATED'].includes(claim.status) ||
      !/^F(?:0[1-9]|10)$/.test(claim.formId || '') || !report || !audit || report.schemaVersion !== 1 || audit.schemaVersion !== 1 ||
      report.id !== id || audit.reportId !== id || audit.uid !== claim.uid || report.formId !== claim.formId || audit.formId !== claim.formId ||
      typeof report.anonymous !== 'boolean' || audit.anonymous !== report.anonymous || report.pointsClaimed !== 2 ||
      !['PENDING_VALIDATION', 'VALIDATED'].includes(report.pointsStatus) || !stamp(claim.createdAt) ||
      stamp(claim.createdAt) !== stamp(report.createdAt) || stamp(claim.createdAt) !== stamp(audit.createdAt))
    throw new Error('OCCURRENCE_SCORE_EVIDENCE_INVALID');
  const origin = claim.originProjectId || SAHMT_EVALUATION_FC;
  if (![SAHMT_V2_CONFIG.projectId,SAHMT_EVALUATION_FC].includes(origin)) throw new Error('OCCURRENCE_SCORE_EVIDENCE_INVALID');
  return {schemaVersion: 1, sourceProjectId: origin, sourceId: id, uid: claim.uid,
    formId: claim.formId, createdAt: stamp(claim.createdAt), points: 2};
}
function evaluationOccurrenceEnabled_() {
  return evaluationProject_() === SAHMT_V2_CONFIG.projectId && sahmtV2Properties_().getProperty('SAHMT_V2_OCCURRENCE_SCORING_ENABLED') === 'true';
}
function evaluationOccurrenceAssertOperator_() {
  if (!evaluationOccurrenceEnabled_()) throw new Error('OCCURRENCE_SCORING_DISABLED');
  const migration=evaluationGet_('occurrenceRuntime','faConsolidation');
  if(!migration || migration.status!=='ACTIVE' || migration.release!=='occurrence-fa-consolidation-v1' ||
      migration.sourceProjectId!==SAHMT_EVALUATION_FC || migration.destinationProjectId!==SAHMT_V2_CONFIG.projectId ||
      !/^[a-f0-9]{64}$/.test(migration.planSha256||'') || !Number.isSafeInteger(migration.verifiedDocuments) ||
      migration.verifiedDocuments<1 || migration.plannedDocuments!==migration.verifiedDocuments ||
      migration.migrationCode!=='FA_CONSOLIDATION_VERIFIED') throw new Error('OCCURRENCE_FA_CONSOLIDATION_INACTIVE');
  // Occurrence awards are independent of the Forms evaluation rollout. The
  // destination still requires an explicit server-side approval marker.
  evaluationAssertOperator_(false);
  const runtime = evaluationGet_('evaluationRuntime', 'state');
  if (!runtime || runtime.occurrenceScoringApproved !== true ||
      !Number.isInteger(runtime.performanceRevision) || runtime.performanceRevision < 0)
    throw new Error('OCCURRENCE_SCORING_NOT_APPROVED');
}
function evaluationDeliverOccurrence_(reportId, expectedUid) {
  evaluationOccurrenceAssertOperator_();
  if (!/^[A-Fa-f0-9-]{36}$/.test(reportId || '')) throw new Error('OCCURRENCE_SCORE_ID_INVALID');
  const receiptId = 'fc-occurrence-' + sha256Hex_(reportId);
  const result = evaluationRunTransaction_(function (transaction) {
    const claim = evaluationGet_('occurrenceScoreClaims', reportId, transaction);
    if (expectedUid && claim && claim.uid !== expectedUid) throw new Error('OCCURRENCE_SCORE_AUTHOR_MISMATCH');
    const report = evaluationGet_('occurrenceReports', reportId, transaction,
      ['schemaVersion', 'id', 'formId', 'anonymous', 'pointsClaimed', 'pointsStatus', 'createdAt']);
    const audit = evaluationGet_('occurrenceAudit', reportId, transaction,
      ['schemaVersion', 'reportId', 'uid', 'formId', 'anonymous', 'createdAt']);
    const evidence = evaluationOccurrenceEvidence_(report, audit, claim);
    const fingerprint = sha256Hex_(evaluationDeliveryCanonical_(evidence));
    const receipt = evaluationGet_('evaluationSourceReceipts', receiptId, transaction);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new Error('OCCURRENCE_SCORE_CONFLICT');
      return {writes: [], result: receipt.result};
    }
    const award = {uid: evidence.uid, category: 'PERFORMANCE', modality: 'OCCURRENCE', creditScopeId: 'fc-occurrence-' + reportId,
      activityId: 'fc-occurrence-' + reportId, areaId: '', version: 1, points: 2, sourceType: evidence.sourceProjectId===SAHMT_EVALUATION_FC?'FC_OCCURRENCE_VERIFIED':'FA_OCCURRENCE_VERIFIED',
      sourceId: reportId, sourceFingerprint: fingerprint, evidence: {sourceProjectId: evidence.sourceProjectId, reportId: reportId, formId: evidence.formId}};
    const applied = evaluationApplyAwards_([award], {transaction: transaction});
    if (applied.status === 'NEEDS_REVIEW') throw new Error('OCCURRENCE_SCORE_REVIEW_REQUIRED');
    const outcome = {status: applied.status, awardId: applied.awards[0].awardId, fingerprint: fingerprint};
    applied.writes.push(evaluationWrite_('evaluationSourceReceipts', receiptId,
      {id: receiptId, sourceProjectId: evidence.sourceProjectId, sourceId: reportId, fingerprint: fingerprint, result: outcome}, null, ['createdAt']));
    return {writes: applied.writes, result: outcome};
  });
  // Publish the performance summary before acknowledging the source. If this
  // fails, its pending claim remains recoverable and the receipt prevents a
  // second award. No unrelated Checklist timer is required for visibility.
  const summary = evaluationPublishCategorySummary_('PERFORMANCE');
  if (!summary || !['CONFIRMED', 'DUPLICATE'].includes(summary.status)) throw new Error('OCCURRENCE_SCORE_SUMMARY_PENDING');
  // Destination is already durable. A failed acknowledgement leaves a recoverable claim.
  evaluationRunTransaction_(function (transaction) {
    const claim = evaluationGet_('occurrenceScoreClaims', reportId, transaction);
    const report = evaluationGet_('occurrenceReports', reportId, transaction,
      ['schemaVersion', 'id', 'formId', 'anonymous', 'pointsClaimed', 'pointsStatus', 'createdAt']);
    const audit = evaluationGet_('occurrenceAudit', reportId, transaction);
    if (sha256Hex_(evaluationDeliveryCanonical_(evaluationOccurrenceEvidence_(report, audit, claim))) !== result.fingerprint) throw new Error('OCCURRENCE_SCORE_CONFLICT');
    if (claim.status === 'VALIDATED' && report.pointsStatus === 'VALIDATED') return {writes: [], result: true};
    return {writes: [evaluationWrite_('occurrenceScoreClaims', reportId,
      {status: 'VALIDATED', destinationProjectId: evaluationProject_(), awardId: result.awardId}, claim, ['validatedAt']),
      evaluationWrite_('occurrenceReports', reportId, {pointsStatus: 'VALIDATED'}, report, [])], result: true};
  }, {projectId: SAHMT_V2_CONFIG.projectId});
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
