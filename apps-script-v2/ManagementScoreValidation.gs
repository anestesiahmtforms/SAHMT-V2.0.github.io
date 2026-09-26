const SAHMT_V2_MANAGEMENT_SCORE_VALIDATION = Object.freeze({
  pageSize: 100,
  maxProcessedPerRun: 20,
  cursorProperty: 'SAHMT_V2_MANAGEMENT_SCORE_CURSOR'
});

function validatePendingManagementScoreReviews() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {skipped: 'another run holds the lock'};
  try {
    const page = listPendingManagementScoreReviews_();
    const properties = PropertiesService.getScriptProperties();
    const result = {scanned: page.documents.length, processed: 0, approved: 0, rejected: 0, needsReview: 0, retried: 0};
    const batch = page.documents.slice(0, SAHMT_V2_MANAGEMENT_SCORE_VALIDATION.maxProcessedPerRun);
    batch.forEach(function (review) {
      try {
        const outcome = validateManagementScoreReview_(review);
        result.processed++;
        if (outcome === 'APPROVED') result.approved++;
        else if (outcome === 'REJECTED') result.rejected++;
        else if (outcome === 'NEEDS_REVIEW') result.needsReview++;
      } catch (error) {
        result.retried++;
        console.error('Falha ao validar pontuação da atividade ' + review.activityId + ': ' + String(error && error.message || error).slice(0, 300));
      }
    });
    if (batch.length) properties.setProperty(SAHMT_V2_MANAGEMENT_SCORE_VALIDATION.cursorProperty, batch[batch.length - 1]._documentName);
    else properties.deleteProperty(SAHMT_V2_MANAGEMENT_SCORE_VALIDATION.cursorProperty);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function installManagementScoreValidationTrigger() {
  listPendingManagementScoreReviews_();
  const existing = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'validatePendingManagementScoreReviews';
  });
  if (!existing.length) ScriptApp.newTrigger('validatePendingManagementScoreReviews').timeBased().everyMinutes(5).create();
  return {installed: true, existing: existing.length > 0};
}

function listPendingManagementScoreReviews_() {
  const properties = PropertiesService.getScriptProperties();
  const cursor = properties.getProperty(SAHMT_V2_MANAGEMENT_SCORE_VALIDATION.cursorProperty);
  const structured = {
    from: [{collectionId: 'activityScoreReviews'}],
    where: {fieldFilter: {field: {fieldPath: 'status'}, op: 'EQUAL', value: {stringValue: 'PENDING_VALIDATION'}}},
    orderBy: [{field: {fieldPath: '__name__'}, direction: 'ASCENDING'}],
    limit: SAHMT_V2_MANAGEMENT_SCORE_VALIDATION.pageSize
  };
  if (cursor) structured.startAt = {before: false, values: [{referenceValue: cursor}]};
  const response = firestoreRequest_(firestoreDocumentsUrl_(':runQuery'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({structuredQuery: structured})
  });
  const documents = (Array.isArray(response) ? response : []).filter(function (item) { return item.document; }).map(function (item) {
    const document = item.document;
    return Object.assign(firestoreFieldsToJs_(document.fields || {}), {
      name: document.name, updateTime: document.updateTime, _documentName: document.name
    });
  });
  if (!documents.length && cursor) {
    properties.deleteProperty(SAHMT_V2_MANAGEMENT_SCORE_VALIDATION.cursorProperty);
    return listPendingManagementScoreReviews_();
  }
  return {documents: documents};
}

function validateManagementScoreReview_(review) {
  if (!review.activityId || /\//.test(review.activityId) || review.id !== review.activityId ||
      review.status !== 'PENDING_VALIDATION' || !review.reviewerUid || !['APPROVE', 'REJECT'].includes(review.decision) ||
      !(review.createdAt instanceof Date) || !managementScoreValidPoints_(review.points)) {
    return updateManagementScoreReview_(review, 'NEEDS_REVIEW', 'Solicitação de revisão fora do contrato.');
  }
  const activity = getFirestoreDocument_('activities', review.activityId);
  const completionId = 'completion-' + review.activityId;
  const completion = getFirestoreDocument_('activityInteractions', completionId);
  const reviewer = getFirestoreDocument_('users', review.reviewerUid);
  const area = getFirestoreDocument_('managementAreas', review.managementAreaId);
  if (!activity || !completion || !reviewer || !area) {
    return updateManagementScoreReview_(review, 'NEEDS_REVIEW', 'Atividade, conclusão, perfil ou área não está disponível.');
  }
  if (!managementScoreReviewerAllowed_(reviewer, area, review)) {
    return updateManagementScoreReview_(review, 'REJECTED', 'Perfil revisor inativo, sem permissão ou não vinculado à área.');
  }
  const responsibleUids = Array.isArray(activity.responsibleUids) ? activity.responsibleUids : [];
  if (review.managementAreaId !== activity.managementAreaId || activity.id !== review.activityId || activity.status !== 'COMPLETED' ||
      activity.active !== true || activity.evidenceRequired !== false || activity.pointsEnabled !== true || responsibleUids.length !== 1 ||
      responsibleUids[0] === review.reviewerUid || review.points !== activity.points ||
      review.scoringRuleId !== activity.scoringRuleId || review.scoringRuleVersion !== activity.scoringRuleVersion ||
      completion.id !== completionId || completion.activityId !== review.activityId || completion.type !== 'COMPLETION' ||
      completion.uid !== responsibleUids[0] || completion.pointsClaimed !== activity.points || completion.pointsStatus !== 'PENDING_VALIDATION' ||
      !managementScoreValidPoints_(activity.points) || !Number.isInteger(activity.scoringRuleVersion) ||
      activity.scoringRuleId !== 'management-task-completion-v1') {
    return updateManagementScoreReview_(review, 'NEEDS_REVIEW', 'Conclusão, responsável, regra ou snapshot não corresponde à solicitação.');
  }
  if (review.decision === 'REJECT' && String(review.note || '').trim().length < 8) {
    return updateManagementScoreReview_(review, 'NEEDS_REVIEW', 'A recusa precisa de uma justificativa registrada.');
  }

  const finalStatus = review.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const writes = [];
  if (review.decision === 'APPROVE' && review.points > 0) {
    const scoreId = managementActivityScoreId_(review.activityId, completion.uid);
    const expected = {
      id: scoreId, uid: completion.uid, sourceType: 'MANAGEMENT_TASK_COMPLETION', sourceId: completionId,
      ruleId: activity.scoringRuleId, ruleVersion: activity.scoringRuleVersion,
      points: activity.points, createdByUid: review.reviewerUid, approvedByUid: review.reviewerUid, createdAt: new Date()
    };
    const existing = getFirestoreDocument_('scores', scoreId);
    if (existing && !managementScoreMatches_(existing, expected)) {
      return updateManagementScoreReview_(review, 'NEEDS_REVIEW', 'Já existe um lançamento divergente para esta atividade.');
    }
    if (!existing) writes.push({
      update: {name: firestoreDocumentName_('scores', scoreId), fields: firestoreFieldsFromJs_(expected)},
      currentDocument: {exists: false}
    });
  }
  const now = new Date();
  writes.push(managementScoreReviewUpdateWrite_(review, {
    status: finalStatus, validationStatus: 'VALIDATED', validatedAt: now, validationMessage: ''
  }));
  firestoreRequest_(firestoreDocumentsUrl_(':commit'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({writes: writes})
  });
  return finalStatus;
}

function managementScoreReviewerAllowed_(profile, area, review) {
  const permissions = profile.permissions || {};
  const active = profile.uid === review.reviewerUid && profile.active === true && profile.access === true;
  if (!active) return false;
  const admin = profile.role === 'administrador_app' || permissions.admin === true;
  const managementManager = admin || permissions.managementManage === true;
  const qualityManager = (admin || permissions.qualityManage === true) && review.managementAreaId === 'area-gestao-da-qualidade';
  const assignedAreaManager = permissions.managementRead === true && Array.isArray(area.managerUids) && area.managerUids.includes(review.reviewerUid);
  return managementManager || qualityManager || assignedAreaManager;
}

function managementScoreValidPoints_(points) {
  return typeof points === 'number' && Number.isInteger(points) && points >= 1 && points <= 1000;
}

function managementActivityScoreId_(activityId, uid) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, activityId + '\u0000' + uid, Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
  return 'activity-' + digest;
}

function managementScoreMatches_(existing, expected) {
  return existing.id === expected.id && existing.uid === expected.uid && existing.sourceType === expected.sourceType &&
    existing.sourceId === expected.sourceId && existing.ruleId === expected.ruleId &&
    existing.ruleVersion === expected.ruleVersion && existing.points === expected.points;
}

function updateManagementScoreReview_(review, status, message) {
  const writes = [managementScoreReviewUpdateWrite_(review, {
    status: status, validationStatus: status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'VALIDATED',
    validatedAt: new Date(), validationMessage: String(message || '').slice(0, 300)
  })];
  firestoreRequest_(firestoreDocumentsUrl_(':commit'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({writes: writes})
  });
  return status;
}

function managementScoreReviewUpdateWrite_(review, changes) {
  return {update: {name: review.name, fields: firestoreFieldsFromJs_(changes)},
    updateMask: {fieldPaths: Object.keys(changes)}, currentDocument: {updateTime: review.updateTime}};
}
