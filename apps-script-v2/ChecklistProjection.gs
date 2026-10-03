// Safe responsibility projections can be prepared independently of ledger activation.
// This file never accepts signatures or writes financial records.
// Firestore sorts map keys. Restore the original snapshot field order used by
// the accepted signature producer without changing any existing revision or ID.
function checklistStoredSnapshotRevision_(snapshot) {
  const snapshotFields = ['date', 'responsibleUid', 'responsibleName', 'responsibleEmail', 'position', 'sigla', 'entries'];
  const entryFields = ['stationId', 'stationName', 'condition', 'occurrence', 'responseId', 'responseAt'];
  if (!snapshot || !Array.isArray(snapshot.entries) || Object.keys(snapshot).some(function (key) { return !snapshotFields.includes(key); }) ||
      snapshot.entries.some(function (entry) { return !entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(function (key) { return !entryFields.includes(key); }); })) return null;
  const entries = snapshot.entries.map(function (entry) {
    return {stationId: entry.stationId, stationName: entry.stationName, condition: entry.condition,
      occurrence: entry.occurrence, responseId: entry.responseId, responseAt: entry.responseAt};
  });
  return sha256Hex_(JSON.stringify({date: snapshot.date, responsibleUid: snapshot.responsibleUid,
    responsibleName: snapshot.responsibleName, responsibleEmail: snapshot.responsibleEmail,
    position: snapshot.position, sigla: snapshot.sigla, entries: entries}));
}

function checklistResponsibilityProjectionWrite_(day, snapshot, previous) {
  return evaluationWrite_('checklistResponsibilities', day, {day: day, status: 'CONFIRMED', fingerprint: snapshot.fingerprint,
    revision: snapshot.revision, responsible: {uid: snapshot.responsible.responsibleUid, name: snapshot.responsible.responsibleName || '',
      sigla: snapshot.responsible.sigla, position: snapshot.responsible.position}, reason: ''}, previous, ['updatedAt']);
}

function refreshChecklistResponsibilityProjection() {
  evaluationAssertOperator_(true);
  return writeCurrentChecklistResponsibilityProjection_();
}

function writeCurrentChecklistResponsibilityProjection_() {
  return evaluationRunTransaction_(function (transaction) {
    const day = checklistSaoPauloDay_(), previous = evaluationGet_('checklistResponsibilities', day, transaction);
    try {
      const snapshot = readTrustedChecklistSnapshot_(day, transaction);
      return {writes: [checklistResponsibilityProjectionWrite_(day, snapshot, previous)], result: {day: day, status: 'CONFIRMED'}};
    } catch (error) {
      if (error.status) throw error;
      return {writes: [evaluationWrite_('checklistResponsibilities', day, {day: day, status: 'NEEDS_REVIEW', responsible: null,
        reason: String(error && error.message || 'Responsável não confirmado.').slice(0, 300)}, previous, ['updatedAt'])],
        result: {day: day, status: 'NEEDS_REVIEW'}};
    }
  });
}

function installChecklistResponsibilityTrigger() {
  evaluationAssertOperator_(true);
  const existing = ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === 'refreshChecklistResponsibilityProjection'; });
  if (!existing) ScriptApp.newTrigger('refreshChecklistResponsibilityProjection').timeBased().everyMinutes(5).create();
  return {installed: true, existing: existing};
}

// Prepare the current projection independently of signatures: participants must
// be able to see the trusted responsible person before requesting a signature.
// Historical projections use only accepted immutable snapshots, never live guesses.
function reconcileChecklistResponsibilities() {
  // Manual preparation is allowed before activation, but requires an allowlisted operator.
  // This function writes projections only; it never accepts signatures or changes points.
  evaluationAssertOperator_(false);
  const current = writeCurrentChecklistResponsibilityProjection_();
  const accepted = evaluationQuery_('checklistSignatureRequests', [firestoreFilter_('status', 'EQUAL', {stringValue: 'VALIDATED'})],
    [{fieldPath: 'validatedAt', direction: 'DESCENDING'}], SAHMT_V2_CHECKLIST_VALIDATION.maxPendingPerRun);
  const seen = new Set([checklistSaoPauloDay_()]);
  let projected = 0;
  accepted.forEach(function (request) {
    if (!request.day || seen.has(request.day) || !request.finalSignatureId) return;
    seen.add(request.day);
    const outcome = evaluationRunTransaction_(function (transaction) {
      const signature = evaluationGet_('checklistSignatures', request.finalSignatureId, transaction);
      if (!signature || signature.date !== request.day || signature.id !== request.finalSignatureId || signature.declaration !== true ||
          !signature.snapshot || !signature.signedAt || signature.revision !== checklistStoredSnapshotRevision_(signature.snapshot) ||
          signature.id !== request.day + '_' + signature.revision || signature.responsibleUid !== signature.snapshot.responsibleUid) return {writes: [], result: 'NEEDS_REVIEW'};
      const previous = evaluationGet_('checklistResponsibilities', request.day, transaction);
      return {writes: [evaluationWrite_('checklistResponsibilities', request.day, {day: request.day, status: 'CONFIRMED',
        fingerprint: request.revision, revision: signature.revision, responsible: {uid: signature.responsibleUid, name: signature.responsibleName || '',
          sigla: signature.snapshot.sigla || '', position: signature.snapshot.position || 0}, reason: ''}, previous, ['updatedAt'])], result: 'CONFIRMED'};
    });
    if (outcome === 'CONFIRMED') projected++;
  });
  return {current: current, historicalProjections: projected};
}
