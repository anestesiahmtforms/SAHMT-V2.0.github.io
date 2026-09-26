const SAHMT_V2_TRAINING_VALIDATION = Object.freeze({
  pageSize: 100,
  maxProcessedPerRun: 20,
  cursorProperty: 'SAHMT_V2_TRAINING_VALIDATION_CURSOR'
});

function validatePendingTrainingCompletions() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {skipped: 'another run holds the lock'};
  try {
    const page = listPendingTrainingCompletions_();
    const properties = PropertiesService.getScriptProperties();
    const result = {scanned: page.documents.length, processed: 0, validated: 0, rejected: 0, needsReview: 0, waiting: 0, retried: 0};
    page.documents.slice(0, SAHMT_V2_TRAINING_VALIDATION.maxProcessedPerRun).forEach(function (claim) {
      try {
        const outcome = validateTrainingCompletionClaim_(claim);
        if (outcome === 'WAITING') result.waiting++;
        else {
          result.processed++;
          if (outcome === 'VALIDATED') result.validated++;
          else if (outcome === 'REJECTED') result.rejected++;
          else if (outcome === 'NEEDS_REVIEW') result.needsReview++;
        }
      } catch (error) {
        result.retried++;
        console.error('Falha ao validar conclusão de treinamento ' + claim.trainingId + ': ' + String(error && error.message || error).slice(0, 300));
      }
    });
    if (page.documents.length) {
      properties.setProperty(SAHMT_V2_TRAINING_VALIDATION.cursorProperty, page.documents[page.documents.length - 1]._documentName);
    } else {
      properties.deleteProperty(SAHMT_V2_TRAINING_VALIDATION.cursorProperty);
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}

function installTrainingValidationTrigger() {
  listPendingTrainingCompletions_();
  const existing = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'validatePendingTrainingCompletions';
  });
  if (!existing.length) ScriptApp.newTrigger('validatePendingTrainingCompletions').timeBased().everyMinutes(5).create();
  return {installed: true, existing: existing.length > 0};
}

function listPendingTrainingCompletions_() {
  const properties = PropertiesService.getScriptProperties();
  const cursor = properties.getProperty(SAHMT_V2_TRAINING_VALIDATION.cursorProperty);
  const structured = {
    from: [{collectionId: 'trainingCompletions'}],
    where: {fieldFilter: {field: {fieldPath: 'validationStatus'}, op: 'EQUAL', value: {stringValue: 'PENDING_VALIDATION'}}},
    orderBy: [{field: {fieldPath: '__name__'}, direction: 'ASCENDING'}],
    limit: SAHMT_V2_TRAINING_VALIDATION.pageSize
  };
  if (cursor) structured.startAt = {before: false, values: [{referenceValue: cursor}]};
  const response = firestoreRequest_(firestoreDocumentsUrl_(':runQuery'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({structuredQuery: structured})
  });
  const documents = (Array.isArray(response) ? response : []).filter(function (item) { return item.document; }).map(function (item) {
    const document = item.document;
    const fields = firestoreFieldsToJs_(document.fields || {});
    return Object.assign(fields, {name: document.name, updateTime: document.updateTime, _documentName: document.name});
  });
  if (!documents.length && cursor) {
    // Wrap around so claims inserted before the saved document are not missed.
    properties.deleteProperty(SAHMT_V2_TRAINING_VALIDATION.cursorProperty);
    return listPendingTrainingCompletions_();
  }
  return {documents: documents};
}

function validateTrainingCompletionClaim_(claim) {
  if (!claim.uid || !claim.trainingId || /\//.test(claim.trainingId) ||
      claim.id !== 'complete-' + claim.uid + '_' + claim.trainingId ||
      claim.sourceType !== 'trainingCompletion' || claim.validationStatus !== 'PENDING_VALIDATION' ||
      !(claim.completedAt instanceof Date) || claim.ended !== true) {
    return updateTrainingValidationStatus_(claim, 'REJECTED', 'Solicitação fora do contrato de conclusão.');
  }

  const receiptId = claim.uid + '_' + claim.trainingId;
  const progressId = receiptId;
  const receipt = getFirestoreDocument_('trainingReceipts', receiptId);
  const progress = getFirestoreDocument_('trainingProgress', progressId);
  const profile = getFirestoreDocument_('users', claim.uid);
  if (!receipt || !progress || !profile) {
    return updateTrainingValidationStatus_(claim, 'NEEDS_REVIEW', 'Recibo, progresso ou perfil não está disponível para validação.');
  }
  if (!trainingProfileCanRead_(profile, claim.uid)) {
    return updateTrainingValidationStatus_(claim, 'REJECTED', 'Perfil inativo ou sem acesso atual a Treinamentos.');
  }
  if (receipt.uid !== claim.uid || receipt.trainingId !== claim.trainingId || receipt.sourceType !== 'trainingStart' ||
      receipt.id !== receiptId || !Number.isInteger(receipt.trainingVersion) ||
      !trainingValidPoints_(receipt.accessPointsClaimed) || !trainingValidPoints_(receipt.completionPointsClaimed)) {
    return updateTrainingValidationStatus_(claim, 'NEEDS_REVIEW', 'Recibo de início não corresponde ao contrato ou ao snapshot de pontos.');
  }
  if (progress.uid !== claim.uid || progress.trainingId !== claim.trainingId || progress.status !== 'COMPLETED' ||
      progress.completionStatus !== 'PENDING_VALIDATION' || !(progress.startedAt instanceof Date) ||
      !(progress.completedAt instanceof Date) || progress.completedAt.getTime() !== claim.completedAt.getTime()) {
    return updateTrainingValidationStatus_(claim, 'NEEDS_REVIEW', 'O progresso concluído não corresponde ao pedido.');
  }
  if (claim.trainingVersion !== receipt.trainingVersion || claim.points !== receipt.completionPointsClaimed ||
      progress.duration !== claim.duration) {
    return updateTrainingValidationStatus_(claim, 'REJECTED', 'Versão, duração ou pontos divergem do recibo imutável.');
  }

  const watched = trainingWatchedCoverage_(progress.watchedRanges, progress.duration);
  const claimedSeconds = Number(claim.watchedSeconds);
  const claimedPercent = Number(claim.watchedPercent);
  if (!watched || watched.percent < 95 || !Number.isFinite(claimedSeconds) || !Number.isFinite(claimedPercent) ||
      Math.abs(claimedSeconds - watched.seconds) > 0.11 || Math.abs(claimedPercent - watched.percent) > 0.11) {
    return updateTrainingValidationStatus_(claim, 'REJECTED', 'A cobertura recalculada não confirma o mínimo de 95% declarado.');
  }

  // A server timestamp can enforce elapsed time, but it cannot attest that a person watched the video.
  // Claims stay pending until enough wall-clock time has passed for the reported watched coverage.
  const earliestCompletion = receipt.startedAt instanceof Date ? receipt.startedAt.getTime() + watched.seconds * 1000 : 0;
  if (!earliestCompletion) return updateTrainingValidationStatus_(claim, 'NEEDS_REVIEW', 'O recibo não contém horário confiável de início.');
  if (Date.now() < earliestCompletion) return 'WAITING';

  const key = trainingScoreKey_(claim.uid, claim.trainingId);
  const scoreWrites = [];
  if (receipt.accessPointsClaimed > 0) {
    const accessScore = trainingScoreRecord_('training-access-' + key, claim.uid, 'trainingStart', receiptId,
      'training-access-v1', receipt.accessPointsClaimed, receipt.trainingVersion);
    const existingAccess = getFirestoreDocument_('scores', accessScore.id);
    if (existingAccess && !trainingSameScore_(existingAccess, accessScore)) {
      return updateTrainingValidationStatus_(claim, 'NEEDS_REVIEW', 'Já existe um lançamento de acesso divergente para esta conclusão.');
    }
    if (!existingAccess) scoreWrites.push(trainingScoreCreateWrite_(accessScore));
  }
  if (claim.points > 0) {
    const completionScore = trainingScoreRecord_('training-completion-' + key, claim.uid, 'trainingCompletion', claim.id,
      'training-completion-v1', claim.points, receipt.trainingVersion);
    const existingCompletion = getFirestoreDocument_('scores', completionScore.id);
    if (existingCompletion && !trainingSameScore_(existingCompletion, completionScore)) {
      return updateTrainingValidationStatus_(claim, 'NEEDS_REVIEW', 'Já existe um lançamento de conclusão divergente.');
    }
    if (!existingCompletion) scoreWrites.push(trainingScoreCreateWrite_(completionScore));
  }

  const now = new Date();
  const writes = scoreWrites.concat([
    trainingUpdateWrite_(claim.name, claim.updateTime, {validationStatus: 'VALIDATED', pointsStatus: claim.points > 0 ? 'VALIDATED' : 'NOT_APPLICABLE', validatedAt: now, validationMessage: ''}),
    trainingUpdateWrite_(progress._documentName, progress._updateTime, {completionStatus: 'VALIDATED', updatedAt: now}),
    trainingUpdateWrite_(receipt._documentName, receipt._updateTime, {accessPointsStatus: receipt.accessPointsClaimed > 0 ? 'VALIDATED' : 'NOT_APPLICABLE'})
  ]);
  firestoreRequest_(firestoreDocumentsUrl_(':commit'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({writes: writes})
  });
  return 'VALIDATED';
}

function trainingWatchedCoverage_(ranges, duration) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0 || total > 86400 || !Array.isArray(ranges) || ranges.length > 500) return null;
  const ordered = [];
  for (const range of ranges) {
    const start = Number(range && range.start);
    const end = Number(range && range.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > total + 2) return null;
    ordered.push([start, Math.min(end, total)]);
  }
  ordered.sort(function (left, right) { return left[0] - right[0]; });
  const merged = [];
  ordered.forEach(function (range) {
    const previous = merged.length ? merged[merged.length - 1] : null;
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push(range.slice());
  });
  const seconds = merged.reduce(function (sum, range) { return sum + range[1] - range[0]; }, 0);
  return {seconds: seconds, percent: Math.min(100, Math.round(seconds / total * 1000) / 10)};
}

function updateTrainingValidationStatus_(claim, status, message) {
  const now = new Date();
  const progress = getFirestoreDocument_('trainingProgress', claim.uid + '_' + claim.trainingId);
  const writes = [trainingUpdateWrite_(claim.name, claim.updateTime, {
    validationStatus: status, validatedAt: now, validationMessage: String(message || '').slice(0, 300),
    pointsStatus: claim.points > 0 ? status : 'NOT_APPLICABLE'
  })];
  const receipt = getFirestoreDocument_('trainingReceipts', claim.uid + '_' + claim.trainingId);
  if (receipt && receipt.accessPointsStatus === 'PENDING_VALIDATION') {
    writes.push(trainingUpdateWrite_(receipt._documentName, receipt._updateTime, {
      accessPointsStatus: status
    }));
  }
  if (progress && progress.status === 'COMPLETED' && progress.completionStatus === 'PENDING_VALIDATION') {
    writes.push(trainingUpdateWrite_(progress._documentName, progress._updateTime, {
      completionStatus: status, completionValidationMessage: String(message || '').slice(0, 300), updatedAt: now
    }));
  }
  firestoreRequest_(firestoreDocumentsUrl_(':commit'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({writes: writes})
  });
  return status;
}

function trainingProfileCanRead_(profile, uid) {
  const permissions = profile.permissions || {};
  return profile.uid === uid && profile.active === true && profile.access === true &&
    (profile.role === 'administrador_app' || permissions.admin === true || permissions.trainingsRead === true || permissions.trainingsManage === true);
}

function trainingValidPoints_(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000;
}

function trainingScoreKey_(uid, trainingId) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, uid + '\u0000' + trainingId, Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function trainingScoreRecord_(id, uid, sourceType, sourceId, ruleId, points, trainingVersion) {
  return {id: id, uid: uid, sourceType: sourceType, sourceId: sourceId, ruleId: ruleId,
    trainingVersion: trainingVersion, points: points, createdByUid: uid, createdAt: new Date()};
}

function trainingSameScore_(existing, expected) {
  return existing.id === expected.id && existing.uid === expected.uid && existing.sourceType === expected.sourceType &&
    existing.sourceId === expected.sourceId && existing.ruleId === expected.ruleId &&
    existing.trainingVersion === expected.trainingVersion && existing.points === expected.points;
}

function trainingScoreCreateWrite_(score) {
  return {update: {name: firestoreDocumentName_('scores', score.id), fields: firestoreFieldsFromJs_(score)}, currentDocument: {exists: false}};
}

function trainingUpdateWrite_(name, updateTime, changes) {
  return {update: {name: name, fields: firestoreFieldsFromJs_(changes)},
    updateMask: {fieldPaths: Object.keys(changes)}, currentDocument: {updateTime: updateTime}};
}
