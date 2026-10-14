/* FA owns the accepted conference. FB owns scoring. The FA outbox is committed
 * with the signature; the FB receipt is committed with BOTH scoring legs.
 * Retrying after a lost response or failed FA acknowledgement never awards twice.
 * No new trigger, no browser endpoint, no arbitrary point amounts. */
function evaluationDeliveryCanonical_(value) {
  return value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(evaluationDeliveryCanonical_).join(',') + ']'
    : '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + evaluationDeliveryCanonical_(value[key]); }).join(',') + '}' : JSON.stringify(value);
}
function evaluationChecklistDeliveryPayload_(signature, requestId) {
  if (!signature || !/^\d{4}-\d{2}-\d{2}$/.test(signature.date || '') ||
      !/^[a-f0-9]{64}$/.test(signature.revision || '') || signature.id !== signature.date + '_' + signature.revision ||
      !signature.signerUid || !signature.responsibleUid || !requestId || signature.declaration !== true)
    throw new Error('CHECKLIST_DELIVERY_EVIDENCE_INVALID');
  return {schemaVersion: 1, sourceProjectId: SAHMT_V2_CONFIG.projectId, destinationProjectId: SAHMT_EVALUATION_FB,
    signatureId: signature.id, requestId: requestId, day: signature.date, revision: signature.revision,
    signerUid: signature.signerUid, responsibleUid: signature.responsibleUid};
}
function evaluationQueueChecklistDelivery_(signature, requestId, transaction) {
  const payload = evaluationChecklistDeliveryPayload_(signature, requestId);
  const id = 'checklist-' + sha256Hex_(signature.id);
  const fingerprint = sha256Hex_(evaluationDeliveryCanonical_(payload));
  const existing = evaluationGet_('checklistScoreOutbox', id, transaction);
  if (existing && existing.fingerprint !== fingerprint) throw new Error('CHECKLIST_DELIVERY_CONFLICT');
  return {status: 'PENDING_FB', writes: existing ? [] : [evaluationWrite_('checklistScoreOutbox', id,
    {id: id, status: 'PENDING', payload: payload, fingerprint: fingerprint}, null, ['createdAt', 'updatedAt'])]};
}
function evaluationDeliverChecklistEvent_(id, options) {
  options = options || {};
  if (evaluationProject_() !== SAHMT_EVALUATION_FB) throw new Error('CHECKLIST_FB_DELIVERY_DISABLED');
  if (options.scienceOnly === true) checklistScienceAssertOperator_(); else evaluationAssertOperator_(true);
  const result = evaluationRunTransaction_(function (transaction) {
    const event = evaluationGet_('checklistScoreOutbox', id, transaction);
    if (!event || !['PENDING', 'DELIVERED'].includes(event.status)) throw new Error('CHECKLIST_DELIVERY_EVENT_INVALID');
    const signature = evaluationGet_('checklistSignatures', event.payload && event.payload.signatureId, transaction);
    const expected = evaluationChecklistDeliveryPayload_(signature, event.payload.requestId);
    if (!(signature.signedAt instanceof Date) || !signature.snapshot ||
        signature.revision !== checklistStoredSnapshotRevision_(signature.snapshot) ||
        signature.snapshot.responsibleUid !== signature.responsibleUid ||
        evaluationDeliveryCanonical_(event.payload) !== evaluationDeliveryCanonical_(expected) || event.fingerprint !== sha256Hex_(evaluationDeliveryCanonical_(expected)))
      throw new Error('CHECKLIST_DELIVERY_EVIDENCE_INVALID');
    const request = evaluationGet_('checklistSignatureRequests', expected.requestId, transaction);
    if (!request || request.status !== 'VALIDATED' || request.finalSignatureId !== signature.id || request.signerUid !== signature.signerUid)
      throw new Error('CHECKLIST_DELIVERY_REQUEST_INVALID');
    const receipt = evaluationGet_('evaluationSourceReceipts', id, transaction);
    if (receipt) {
      if (receipt.fingerprint !== event.fingerprint) throw new Error('CHECKLIST_DELIVERY_CONFLICT');
      return {writes: [], result: receipt.result};
    }
    const transfer = evaluationApplyChecklistTransfer_(expected.day, expected.responsibleUid, expected.signerUid, expected.signatureId, {transaction: transaction});
    const awarded = transfer.status === 'APPLIED' && expected.responsibleUid !== expected.signerUid;
    const outcome = {status: transfer.status, pointsAwarded: awarded ? 1 : 0, responsibleAdjustment: awarded ? -1 : 0,
      fingerprint: event.fingerprint, transferVersion: transfer.state.transferVersion};
    transfer.writes.push(evaluationWrite_('evaluationSourceReceipts', id,
      {id: id, sourceProjectId: SAHMT_V2_CONFIG.projectId, signatureId: signature.id, fingerprint: event.fingerprint, result: outcome}, null, ['createdAt']));
    return {writes: transfer.writes, result: outcome};
  });
  // A lost FA acknowledgement is recoverable using the already committed FB receipt.
  checklistSourceTransaction_(function (transaction) {
    const event = evaluationGet_('checklistScoreOutbox', id, transaction);
    if (!event || event.fingerprint !== result.fingerprint) throw new Error('CHECKLIST_DELIVERY_CONFLICT');
    if (event.status === 'DELIVERED') return {writes: [], result: true};
    const request = evaluationGet_('checklistSignatureRequests', event.payload.requestId, transaction);
    if (!request || request.finalSignatureId !== event.payload.signatureId || request.status !== 'VALIDATED') throw new Error('CHECKLIST_DELIVERY_REQUEST_INVALID');
    return {writes: [evaluationWrite_('checklistScoreOutbox', id, {status: 'DELIVERED', result: result}, event, ['deliveredAt', 'updatedAt']),
      evaluationWrite_('checklistSignatureRequests', request.id, {evaluationStatus: result.status, pointsAwarded: result.pointsAwarded,
        responsibleAdjustment: result.responsibleAdjustment}, request, ['evaluationDeliveredAt'])], result: true};
  });
  return {status: result.status};
}
function evaluationDrainChecklistDeliveries_(options) {
  if (evaluationProject_() !== SAHMT_EVALUATION_FB) return {status: 'DISABLED', delivered: 0, pending: 0};
  const result = {status: 'COMPLETE', delivered: 0, pending: 0};
  const events = evaluationQuery_('checklistScoreOutbox', [firestoreFilter_('status', 'EQUAL', {stringValue: 'PENDING'})], [], 20, ['id']);
  events.forEach(function (event) {
    try { evaluationDeliverChecklistEvent_(event.id, options); result.delivered++; }
    catch (_) { result.pending++; result.status = 'PENDING'; }
  });
  return result;
}
