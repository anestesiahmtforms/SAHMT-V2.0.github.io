/* Trusted Spark ledger. Browser requests are never a source of points.
 * Legacy scores are imported only through the verified delivery adapter. */
const SAHMT_V2_EVALUATION_LEDGER = Object.freeze({maxWrites: 450, maxUsers: 400, maxAwards: 10000, maxAttempts: 4});

// The verified release property selects independent FB for this domain.
// Operational source records and QMENTUM keep FA as their authority.
const SAHMT_EVALUATION_FB = 'sahmt-gestao-5ae66';
const SAHMT_EVALUATION_FC = 'indicadores---sahmt';
const SAHMT_MANAGEMENT_DOMAIN_COLLECTIONS = Object.freeze([
  'managementAreas', 'activities', 'activityInteractions', 'activityScoreReviews',
  'indicators', 'indicatorMeasurements', 'actionPlans', 'actionPlanItems',
  'documents', 'scopedDocuments', 'documentAccessEmails', 'documentReadingReceipts', 'documentReadingGrants', 'equipment', 'equipmentEvents', 'maintenanceRecords',
  'scoringRules', 'scores', 'learningActivities', 'learningActivityReceipts',
  'trainings', 'trainingProgress', 'trainingReceipts', 'trainingCompletions'
]);
const SAHMT_EVALUATION_TRANSACTIONS = new Map();
function evaluationAssertConsolidationActive_() {
  if (typeof managementIndependentFbEnabled_ === 'function' && managementIndependentFbEnabled_()) return managementIndependentFbAssert_();
  const state=evaluationGet_('managementRuntime','faConsolidation');
  if (!state || state.schemaVersion!==1 || state.release!=='fa-consolidation-v1' || state.status!=='ACTIVE' ||
      state.sourceProjectId!==SAHMT_EVALUATION_FB || state.destinationProjectId!==SAHMT_V2_CONFIG.projectId ||
      !/^[a-f0-9]{64}$/.test(state.planSha256||'') || !Number.isSafeInteger(state.verifiedDocuments) || state.verifiedDocuments<1 ||
      state.plannedDocuments!==state.verifiedDocuments || state.migrationCode!=='FA_CONSOLIDATION_VERIFIED')
    throw new Error('EVALUATION_FA_CONSOLIDATION_INACTIVE');
}
function evaluationProject_() {
  if (typeof managementIndependentFbEnabled_ === 'function' && managementIndependentFbEnabled_()) return SAHMT_EVALUATION_FB;
  const configured = sahmtV2Properties_().getProperty('SAHMT_V2_EVALUATION_PROJECT_ID');
  if (configured && configured !== SAHMT_V2_CONFIG.projectId && configured !== SAHMT_EVALUATION_FB)
    throw new Error('EVALUATION_PROJECT_INVALID');
  // Old routing properties cannot enable a destination. Without the new
  // explicit release property, the previous FA consolidation remains active.
  return SAHMT_V2_CONFIG.projectId;
}
function evaluationCollectionProject_(collectionId, transaction) {
  if (collectionId === 'users' && typeof managementIndependentFbEnabled_ === 'function' && managementIndependentFbEnabled_()) {
    const context = transaction && SAHMT_EVALUATION_TRANSACTIONS.get(transaction);
    return context ? context.projectId : SAHMT_EVALUATION_FB;
  }
  if (['occurrenceReports', 'occurrenceAudit', 'occurrenceScoreClaims'].includes(collectionId)) return SAHMT_V2_CONFIG.projectId;
  return /^evaluation[A-Z]/.test(collectionId) || SAHMT_MANAGEMENT_DOMAIN_COLLECTIONS.includes(collectionId)
    ? evaluationProject_() : SAHMT_V2_CONFIG.projectId;
}
function evaluationCursorProperty_(base) {
  evaluationProject_();
  return base + (evaluationProject_() === SAHMT_EVALUATION_FB ? '_FB_INDEPENDENT_V1' : '_FA_CONSOLIDATED_V1');
}
function evaluationDocumentsUrl_(path, projectId) {
  projectId = projectId || evaluationProject_();
  if ((path === ':commit' || path === ':batchWrite') && !evaluationIndependentFaSource_(projectId)) evaluationAssertConsolidationActive_();
  if (![SAHMT_V2_CONFIG.projectId, SAHMT_EVALUATION_FB, SAHMT_EVALUATION_FC].includes(projectId)) throw new Error('EVALUATION_PROJECT_INVALID');
  return 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents' + path;
}
function evaluationIndependentFaSource_(projectId) {
  return projectId === SAHMT_V2_CONFIG.projectId && typeof managementIndependentFbEnabled_ === 'function' && managementIndependentFbEnabled_();
}
function evaluationDocumentName_(collectionId, documentId) {
  return 'projects/' + evaluationCollectionProject_(collectionId) + '/databases/(default)/documents/' + collectionId + '/' + documentId;
}
function evaluationReadTransaction_(transaction, projectId) {
  const context = SAHMT_EVALUATION_TRANSACTIONS.get(transaction);
  if (!context || context.projectId === projectId) return transaction;
  if (!((context.projectId === SAHMT_V2_CONFIG.projectId && projectId === SAHMT_EVALUATION_FC) ||
      (context.projectId === SAHMT_EVALUATION_FB && [SAHMT_V2_CONFIG.projectId, SAHMT_EVALUATION_FC].includes(projectId)))) throw new Error('EVALUATION_CROSS_PROJECT_TRANSACTION');
  // Source authorization/evidence is read from FA, never from a copied user profile.
  // It is validated before the destination commit; this is not a cross-project atomic transaction.
  if (!context.sourceTransactions[projectId]) context.sourceTransactions[projectId] = firestoreRequest_(evaluationDocumentsUrl_(':beginTransaction', projectId),
    {method: 'post', contentType: 'application/json', payload: '{}'}).transaction;
  return context.sourceTransactions[projectId];
}
function checklistSourceTransaction_(callback) {
  return evaluationRunTransaction_(callback, {projectId: SAHMT_V2_CONFIG.projectId});
}
function evaluationGetProjected_(collectionId, documentId, fieldPaths) {
  const projectId = evaluationCollectionProject_(collectionId);
  if (projectId === SAHMT_V2_CONFIG.projectId) return getFirestoreDocument_(collectionId, documentId, fieldPaths);
  const mask = (fieldPaths || []).map(function (field) { return 'mask.fieldPaths=' + encodeURIComponent(field); }).join('&');
  try {
    return evaluationDocument_(firestoreRequest_(evaluationDocumentsUrl_('/' + encodeURIComponent(collectionId) + '/' + encodeURIComponent(documentId), projectId) + (mask ? '?' + mask : ''), {method: 'get'}));
  } catch (error) { if (error.status === 404) return null; throw error; }
}

function evaluationCategoryFields_(category) {
  if (category === 'PERFORMANCE') return {prefix: 'performance', total: 'performanceTotal', count: 'performanceCount', revision: 'performanceRevision', dirty: 'performanceDirty', status: 'performanceStatus'};
  if (category === 'GOVERNANCE') return {prefix: 'governance', total: 'governanceTotal', count: 'governanceCount', revision: 'governanceRevision', dirty: 'governanceDirty', status: 'governanceStatus'};
  throw new Error('Categoria de avaliação inválida.');
}

function evaluationValidPoints_(value) { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000; }
function evaluationActiveProfile_(profile, uid) { return !!profile && profile.uid === uid && profile.active === true && profile.access === true; }
function evaluationAdmin_(profile) {
  return !!profile && (profile.role === 'administrador_app' || profile.permissions && profile.permissions.admin === true) &&
    !!profile.permissions && profile.permissions.managementManage === true;
}
function evaluationClean_(value) {
  const result = {};
  Object.keys(value || {}).forEach(function (key) { if (key[0] !== '_' && value[key] !== undefined) result[key] = value[key]; });
  return result;
}

function evaluationAwardId_(input) {
  evaluationCategoryFields_(input.category);
  if (!input.uid || !input.creditScopeId || !input.modality || !String(input.version || '')) throw new Error('Crédito sem identidade, matéria, versão ou modalidade.');
  return 'award-' + sha256Hex_(JSON.stringify([input.category, input.uid, input.creditScopeId, String(input.version), input.modality]));
}

// Pure planning function: no time, identity, network or side effects.
function evaluationPlanAward_(previous, input, options) {
  options = options || {};
  const id = input.id || evaluationAwardId_(input);
  const category = evaluationCategoryFields_(input.category);
  const allowed = input.category === 'PERFORMANCE' ? ['ACKNOWLEDGEMENT', 'SUGGESTION', 'TEST', 'CHECKLIST', 'OCCURRENCE', 'TRAINING_ACCESS', 'TRAINING_COMPLETION', 'MANAGEMENT_TASK'] : ['MATERIAL', 'QUESTIONS'];
  if (!allowed.includes(input.modality) || !evaluationValidPoints_(input.points)) throw new Error('Modalidade ou pontuação inválida.');
  if (!options.correction && ['TRAINING_ACCESS','TRAINING_COMPLETION','MANAGEMENT_TASK'].includes(input.modality) &&
      (options.legacyVerified !== true || input.points < 0 || input.points > 1000)) throw new Error('LEGACY_SCORE_VERIFICATION_REQUIRED');
  if (!options.correction) {
    const defaults = {ACKNOWLEDGEMENT: [0, 1], SUGGESTION: [0, 2], MATERIAL: [0, 1], QUESTIONS: [0, 1], CHECKLIST: [-1, 0, 1], OCCURRENCE: [2]};
    if (defaults[input.modality] && !defaults[input.modality].includes(input.points)) throw new Error('Pontuação fora da regra da modalidade.');
    if (input.modality === 'TEST' && (input.points < 0 || !Number.isFinite(input.maxTestScore) || input.maxTestScore < input.points)) throw new Error('Nota corrigida ou máximo não confirmado.');
  }
  if (previous && (previous.uid !== input.uid || previous.category !== input.category || previous.modality !== input.modality ||
      previous.creditScopeId !== input.creditScopeId || String(previous.version) !== String(input.version))) throw new Error('A identidade imutável do crédito não corresponde à fonte.');
  if (previous && (!evaluationValidPoints_(previous.points) || !Number.isInteger(previous.awardVersion) || previous.awardVersion < 1)) throw new Error('Estado do crédito inconsistente.');
  if (options.correction && (!previous || options.expectedAwardVersion !== previous.awardVersion || String(input.reason || '').trim().length < 8)) throw new Error('Correção desatualizada ou sem justificativa.');
  if (previous && previous.adminOverride === true && !options.correction && input.points !== previous.points) {
    return {status: 'NEEDS_REVIEW', awardId: id, awardVersion: previous.awardVersion, points: previous.points, changed: false, categoryFields: category};
  }
  if (previous && input.points === previous.points && (previous.adminOverride === true && !options.correction ||
      previous.sourceFingerprint === input.sourceFingerprint && !options.correction && !options.forceAudit)) {
    return {status: 'DUPLICATE', awardId: id, awardVersion: previous.awardVersion, points: previous.points, changed: false, categoryFields: category};
  }
  const awardVersion = previous ? previous.awardVersion + 1 : 1;
  const pointsBefore = previous ? previous.points : 0;
  const originalPoints = previous ? previous.originalPoints : input.points;
  const award = Object.assign({}, previous ? evaluationClean_(previous) : {}, evaluationClean_(input), {
    id: id, awardVersion: awardVersion, originalPoints: originalPoints,
    adminOverride: options.correction ? true : previous ? previous.adminOverride === true : false,
    lastLedgerId: id + '-v' + awardVersion
  });
  const ledger = {
    id: award.lastLedgerId, awardId: id, uid: input.uid, category: input.category, modality: input.modality,
    activityId: input.activityId || '', areaId: input.areaId || '', version: input.version,
    creditScopeId: input.creditScopeId, points: input.points - pointsBefore, originalPoints: originalPoints,
    correctedPoints: input.points, pointsBefore: pointsBefore, correctsId: previous ? previous.lastLedgerId || '' : '',
    transferId: input.transferId || '', sourceType: input.sourceType || '', sourceId: input.sourceId || '',
    evidence: input.evidence || {}, approvedByUid: input.approvedByUid || '', reason: String(input.reason || '').trim(),
    awardVersion: awardVersion
  };
  return {status: 'APPLIED', awardId: id, awardVersion: awardVersion, points: input.points, changed: true, award: award, ledger: ledger, categoryFields: category};
}

function evaluationPlanChecklistTransfer_(previous, input) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day || '') || !input.responsibleUid || !input.signerUid || !input.signatureId) throw new Error('Obrigação sem assinatura aceita e responsável confiável.');
  if (previous && (previous.day !== input.day || previous.transferId !== 'checklist-' + input.day || !previous.members ||
      !evaluationValidPoints_(previous.amount) || previous.amount < 0 || !Number.isInteger(previous.transferVersion) || previous.transferVersion < 1 ||
      Object.keys(previous.members).some(function (uid) { return !evaluationValidPoints_(previous.members[uid].points); }) ||
      Object.keys(previous.members).reduce(function (sum, uid) { return sum + previous.members[uid].points; }, 0) !== 0)) throw new Error('Estado anterior do par de Checklist inconsistente.');
  if (previous && !input.correction) return {status: 'DUPLICATE', changed: false, state: previous, changes: []};
  if (previous && (!Number.isInteger(previous.transferVersion) || input.expectedTransferVersion !== previous.transferVersion)) throw new Error('A transferência foi alterada. Atualize antes de corrigir.');
  const amount = input.amount === undefined ? 1 : input.amount;
  if (!evaluationValidPoints_(amount) || amount < 0) throw new Error('Valor do par de Checklist inválido.');
  const same = input.responsibleUid === input.signerUid;
  if (same && amount !== 0 && input.correction) throw new Error('Assinatura própria não pode gerar crédito individual.');
  const desired = {};
  if (same) desired[input.signerUid] = {points: 0, leg: 'SELF'};
  else { desired[input.responsibleUid] = {points: -amount, leg: 'DEBIT'}; desired[input.signerUid] = {points: amount, leg: 'CREDIT'}; }
  Object.keys(previous && previous.members || {}).forEach(function (uid) { if (!desired[uid]) desired[uid] = {points: 0, leg: 'REVERSED'}; });
  const transferId = 'checklist-' + input.day;
  const transferVersion = previous ? previous.transferVersion + 1 : 1;
  const changes = Object.keys(desired).sort().map(function (uid) {
    return {uid: uid, category: 'PERFORMANCE', modality: 'CHECKLIST', creditScopeId: transferId, activityId: transferId,
      areaId: '', version: 1, points: desired[uid].points, transferId: transferId, transferVersion: transferVersion, leg: desired[uid].leg,
      sourceType: input.correction ? 'CHECKLIST_CORRECTION' : 'CHECKLIST_SIGNATURE', sourceId: input.signatureId,
      sourceFingerprint: input.signatureId + ':' + transferVersion, evidence: {day: input.day, signatureId: input.signatureId, responsibleUid: input.responsibleUid, signerUid: input.signerUid},
      approvedByUid: input.actorUid || '', reason: input.reason || ''};
  });
  const net = changes.reduce(function (sum, item) { return sum + item.points; }, 0);
  if (net !== 0) throw new Error('A transferência do Checklist não preserva a soma zero.');
  return {status: 'APPLIED', changed: true, changes: changes, state: {
    id: input.day, day: input.day, transferId: transferId, transferVersion: transferVersion,
    responsibleUid: input.responsibleUid, signerUid: input.signerUid, signatureId: input.signatureId,
    amount: same ? 0 : amount, members: desired, adminOverride: !!input.correction || !!(previous && previous.adminOverride),
    correctedByUid: input.correction ? input.actorUid : '', reason: input.reason || ''
  }};
}

function evaluationSummarizeCategory_(category, profiles, awards) {
  const fields = evaluationCategoryFields_(category);
  if (profiles.some(function (profile) { return profile.active === true && profile.access === true && profile.id && profile.uid !== profile.id; })) throw new Error('Perfil elegível não corresponde ao UID do documento.');
  const eligible = profiles.filter(function (profile) { return evaluationActiveProfile_(profile, profile.id || profile.uid); });
  const unique = new Set();
  eligible.forEach(function (profile) { if (unique.has(profile.uid)) throw new Error('Identidade elegível duplicada.'); unique.add(profile.uid); });
  const totals = {};
  eligible.forEach(function (profile) { totals[profile.uid] = {total: 0, count: 0}; });
  awards.forEach(function (award) {
    if (award.category !== category) return;
    if (!evaluationValidPoints_(award.points)) throw new Error('Pontuação inconsistente no recálculo.');
    if (!totals[award.uid]) return;
    totals[award.uid].total += award.points;
    totals[award.uid].count++;
    if (!evaluationValidPoints_(totals[award.uid].total)) throw new Error('Saldo excede o limite de reconciliação.');
  });
  const values = Object.keys(totals).map(function (uid) { return totals[uid].total; });
  const result = {fields: fields, totals: totals, eligibleCount: values.length};
  if (category === 'PERFORMANCE') {
    result.maxPerformance = values.length ? Math.max.apply(null, values) : null;
    result.allZero = values.length > 0 && values.every(function (value) { return value === 0; });
  }
  return result;
}

function evaluationAssertOperator_(activation) {
  const properties = sahmtV2Properties_();
  const allowed = String(properties.getProperty('SAHMT_V2_EVALUATION_ALLOWED_EMAILS') || '').split(/[;,\s]+/).map(function (value) { return value.toLowerCase(); }).filter(Boolean);
  const email = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!email || !allowed.includes(email)) throw new Error('Operador não autorizado para a avaliação. Configure a allowlist explicitamente.');
  evaluationAssertConsolidationActive_();
  if (activation) {
    const runtime = evaluationGet_('evaluationRuntime', 'state');
    if (properties.getProperty('SAHMT_V2_EVALUATION_ENABLED') !== 'true' || properties.getProperty('SAHMT_V2_EVALUATION_HOMOLOGATED') !== 'true' ||
        !runtime || runtime.homologationVerified !== true) throw new Error('Ativação bloqueada: homologação e habilitação explícitas são necessárias.');
  }
  return email;
}

function evaluationGet_(collectionId, documentId, transaction, fieldPaths) {
  if (!transaction) {
    const result = evaluationGetProjected_(collectionId, documentId, fieldPaths);
    return result ? Object.assign(result, {_name: result._documentName}) : null;
  }
  const projectId = evaluationCollectionProject_(collectionId, transaction);
  const response = firestoreRequest_(evaluationDocumentsUrl_(':batchGet', projectId), {method: 'post', contentType: 'application/json',
    payload: JSON.stringify(Object.assign({documents: ['projects/' + projectId + '/databases/(default)/documents/' + collectionId + '/' + documentId], transaction: evaluationReadTransaction_(transaction, projectId)},
      fieldPaths ? {mask: {fieldPaths: fieldPaths}} : {}))});
  const document = (Array.isArray(response) ? response : [response]).find(function (item) { return item.found; });
  if (!document) return null;
  return evaluationDocument_(document.found);
}

function evaluationDocument_(document) {
  const id = String(document.name).split('/').pop();
  return Object.assign(firestoreFieldsToJs_(document.fields || {}), {id: id, _documentName: document.name, _name: document.name, _updateTime: document.updateTime, _createTime: document.createTime});
}

function evaluationQuery_(collectionId, filters, orderBy, maximum, fieldPaths, transaction, cursor) {
  const query = {from: [{collectionId: collectionId}], limit: maximum || 100};
  filters = filters || []; orderBy = orderBy || [];
  if (filters.length === 1) query.where = {fieldFilter: filters[0]};
  if (filters.length > 1) query.where = {compositeFilter: {op: 'AND', filters: filters.map(function (filter) { return {fieldFilter: filter}; })}};
  if (orderBy.length) query.orderBy = orderBy.map(function (item) { return {field: {fieldPath: item.fieldPath}, direction: item.direction}; });
  if (fieldPaths && fieldPaths.length) query.select = {fields: fieldPaths.map(function (field) { return {fieldPath: field}; })};
  if (cursor) query.startAt = cursor;
  const projectId = evaluationCollectionProject_(collectionId, transaction);
  const body = {structuredQuery: query}; if (transaction) body.transaction = evaluationReadTransaction_(transaction, projectId);
  const response = firestoreRequest_(evaluationDocumentsUrl_(':runQuery', projectId), {method: 'post', contentType: 'application/json', payload: JSON.stringify(body)});
  return (Array.isArray(response) ? response : []).filter(function (item) { return item.document; }).map(function (item) { return evaluationDocument_(item.document); });
}

function evaluationWrite_(collectionId, documentId, changes, previous, serverTimeFields) {
  const fields = evaluationClean_(changes);
  (serverTimeFields || []).forEach(function (field) { delete fields[field]; });
  const write = {update: {name: evaluationDocumentName_(collectionId, documentId), fields: firestoreFieldsFromJs_(fields)},
    currentDocument: previous ? previous._updateTime ? {updateTime: previous._updateTime} : previous : {exists: false}};
  if (previous && previous.exists !== false) write.updateMask = {fieldPaths: Object.keys(fields)};
  if (serverTimeFields && serverTimeFields.length) write.updateTransforms = serverTimeFields.map(function (field) { return {fieldPath: field, setToServerValue: 'REQUEST_TIME'}; });
  return write;
}

function evaluationRunTransaction_(callback, options) {
  const projectId = options && options.projectId || evaluationProject_();
  // Operational acceptance in FA must not wait for the FB points ledger.
  // Each source processor validates its own authorization/evidence; the
  // transaction below still rejects every write outside its chosen project.
  if (!evaluationIndependentFaSource_(projectId)) evaluationAssertConsolidationActive_();
  const endpoint = function (operation) { return evaluationDocumentsUrl_(operation, projectId); };
  for (let attempt = 0; attempt < SAHMT_V2_EVALUATION_LEDGER.maxAttempts; attempt++) {
    const started = firestoreRequest_(endpoint(':beginTransaction'), {method: 'post', contentType: 'application/json', payload: '{}'});
    const context = {projectId: projectId, sourceTransactions: {}};
    SAHMT_EVALUATION_TRANSACTIONS.set(started.transaction, context);
    try {
      const planned = callback(started.transaction);
      if (!planned || !Array.isArray(planned.writes) || planned.writes.length > SAHMT_V2_EVALUATION_LEDGER.maxWrites) throw new Error('O commit excede o orçamento seguro ou não foi planejado.');
      const prefix = 'projects/' + projectId + '/databases/(default)/documents/';
      if (planned.writes.some(function (write) { return !write.update || !write.update.name.startsWith(prefix); })) throw new Error('EVALUATION_CROSS_PROJECT_WRITE');
      Object.keys(context.sourceTransactions).sort().forEach(function (sourceProject) {
        firestoreRequest_(evaluationDocumentsUrl_(':commit', sourceProject), {method: 'post', contentType: 'application/json', payload: JSON.stringify({transaction: context.sourceTransactions[sourceProject], writes: []})});
        delete context.sourceTransactions[sourceProject];
      });
      firestoreRequest_(endpoint(':commit'), {method: 'post', contentType: 'application/json', payload: JSON.stringify({transaction: started.transaction, writes: planned.writes})});
      return planned.result;
    } catch (error) {
      try { firestoreRequest_(endpoint(':rollback'), {method: 'post', contentType: 'application/json', payload: JSON.stringify({transaction: started.transaction})}); } catch (_) {}
      Object.keys(context.sourceTransactions).forEach(function (sourceProject) {
        try { firestoreRequest_(evaluationDocumentsUrl_(':rollback', sourceProject), {method: 'post', contentType: 'application/json', payload: JSON.stringify({transaction: context.sourceTransactions[sourceProject]})}); } catch (_) {}
      });
      if ((error.status !== 409 && error.status !== 412) || attempt + 1 === SAHMT_V2_EVALUATION_LEDGER.maxAttempts) throw error;
    } finally { SAHMT_EVALUATION_TRANSACTIONS.delete(started.transaction); }
  }
}

function evaluationApplyAwards_(changes, options) {
  options = options || {};
  if (!options.transaction) {
    evaluationAssertOperator_(true);
    return evaluationRunTransaction_(function (transaction) {
      const result = evaluationApplyAwards_(changes, Object.assign({}, options, {transaction: transaction}));
      return {writes: result.writes, result: result};
    });
  }
  const transaction = options.transaction, writes = (options.extraWrites || []).slice(), plans = [], touched = {}, ids = new Set();
  const runtime = evaluationGet_('evaluationRuntime', 'state', transaction);
  const reference = evaluationGet_('evaluationReference', 'team', transaction);
  changes.forEach(function (input) {
    const id = input.id || evaluationAwardId_(input);
    if (ids.has(id)) throw new Error('Crédito duplicado no mesmo commit.'); ids.add(id);
    const previous = evaluationGet_('evaluationAwards', id, transaction);
    const beneficiary = evaluationGet_('users', input.uid, transaction);
    // An administrator may correct an existing historical credit even after access is revoked.
    // A new credit always requires a currently approved identity.
    const historicalCorrection = options.correction && previous;
    if (!evaluationActiveProfile_(beneficiary, input.uid) && !historicalCorrection) throw new Error('Beneficiário sem perfil ativo e autorizado.');
    const planOptions = Object.assign({}, options);
    if (options.pairedCorrection) {
      planOptions.correction = !!previous;
      planOptions.expectedAwardVersion = previous && previous.awardVersion;
    }
    const plan = evaluationPlanAward_(previous, Object.assign({}, input, {id: id}), planOptions);
    if (options.pairedCorrection && plan.changed) plan.award.adminOverride = true;
    plans.push(plan);
    if (!plan.changed) return;
    writes.push(evaluationWrite_('evaluationAwards', id, plan.award, previous, ['updatedAt']));
    writes.push(evaluationWrite_('evaluationLedger', plan.ledger.id, plan.ledger, null, ['createdAt']));
    touched[input.category] = true;
  });
  const runtimePatch = {}, referencePatch = {};
  Object.keys(touched).forEach(function (category) {
    const fields = evaluationCategoryFields_(category);
    const revision = runtime && runtime[fields.revision] || 0;
    if (!Number.isInteger(revision) || revision < 0) throw new Error('Revisão global inconsistente.');
    runtimePatch[fields.revision] = revision + 1; runtimePatch[fields.dirty] = true;
    referencePatch[fields.revision] = revision + 1; referencePatch[fields.status] = 'PENDING';
  });
  if (Object.keys(touched).length) {
    writes.push(evaluationWrite_('evaluationRuntime', 'state', runtimePatch, runtime, ['updatedAt']));
    writes.push(evaluationWrite_('evaluationReference', 'team', referencePatch, reference, ['updatedAt']));
  }
  return {status: plans.some(function (plan) { return plan.status === 'NEEDS_REVIEW'; }) ? 'NEEDS_REVIEW' : plans.some(function (plan) { return plan.changed; }) ? 'APPLIED' : 'DUPLICATE',
    awards: plans.map(function (plan) { return {awardId: plan.awardId, awardVersion: plan.awardVersion, points: plan.points, status: plan.status, changed: plan.changed}; }), writes: writes};
}

function applyEvaluationAwardDesired_(input, options) {
  const result = evaluationApplyAwards_([input], options);
  return Object.assign({}, result, result.awards[0]);
}

function evaluationApplyChecklistTransfer_(day, responsibleUid, signerUid, signatureId, options) {
  options = options || {};
  if (!options.transaction) {
    evaluationAssertOperator_(true);
    return evaluationRunTransaction_(function (transaction) {
      const result = evaluationApplyChecklistTransfer_(day, responsibleUid, signerUid, signatureId, Object.assign({}, options, {transaction: transaction}));
      return {writes: result.writes, result: result};
    });
  }
  const previous = evaluationGet_('evaluationChecklistTransfers', day, options.transaction);
  if (previous && previous.members) Object.keys(previous.members).forEach(function (uid) {
    const id = evaluationAwardId_({uid: uid, category: 'PERFORMANCE', modality: 'CHECKLIST', creditScopeId: 'checklist-' + day, version: 1});
    const award = evaluationGet_('evaluationAwards', id, options.transaction);
    if (!award || award.uid !== uid || award.category !== 'PERFORMANCE' || award.modality !== 'CHECKLIST' || award.points !== previous.members[uid].points) throw new Error('Lados do par de Checklist inconsistentes.');
  });
  const plan = evaluationPlanChecklistTransfer_(previous, {day: day, responsibleUid: responsibleUid, signerUid: signerUid, signatureId: signatureId,
    amount: options.amount, correction: options.correction, expectedTransferVersion: options.expectedTransferVersion, actorUid: options.actorUid, reason: options.reason});
  if (!plan.changed) return {status: 'DUPLICATE', state: previous, awards: [], writes: (options.extraWrites || []).slice()};
  const result = evaluationApplyAwards_(plan.changes, Object.assign({}, options, {forceAudit: !!options.correction, pairedCorrection: !!options.correction}));
  if (result.status === 'NEEDS_REVIEW') throw new Error('Par de Checklist inconsistente com correção administrativa anterior.');
  result.writes.push(evaluationWrite_('evaluationChecklistTransfers', day, plan.state, previous, ['updatedAt']));
  result.state = plan.state;
  return result;
}

// A new category remains unconfirmed until a complete trusted summary is read.
// Initialize its revision only after homologation; never invent a confirmed zero.
function initializeEvaluationCategoryState_(category) {
  evaluationAssertOperator_(true);
  const fields = evaluationCategoryFields_(category);
  return evaluationRunTransaction_(function (transaction) {
    const runtime = evaluationGet_('evaluationRuntime', 'state', transaction);
    if (!runtime || runtime.homologationVerified !== true) throw new Error('Homologação vigente necessária para iniciar a categoria.');
    if (Object.prototype.hasOwnProperty.call(runtime, fields.revision)) {
      if (!Number.isInteger(runtime[fields.revision]) || runtime[fields.revision] < 0) throw new Error('Revisão da categoria inconsistente; revisão administrativa necessária.');
      return {writes: [], result: {status: 'DUPLICATE', category: category, revision: runtime[fields.revision]}};
    }
    const patch = {}; patch[fields.revision] = 0; patch[fields.dirty] = true;
    return {writes: [evaluationWrite_('evaluationRuntime', 'state', patch, runtime, ['updatedAt'])],
      result: {status: 'PENDING', category: category, revision: 0}};
  });
}

// A short audit lease skips only clean, already-confirmed scheduled projections.
// It never supplies profiles for a write, replaces authorization, or renews itself on a cache hit.
function evaluationEligibilityAuditCache_() {
  try { return typeof CacheService === 'undefined' ? null : CacheService.getScriptCache(); } catch (_) { return null; }
}
function evaluationReadEligibilityAudit_(cache) {
  try {
    const audit = cache && JSON.parse(cache.get('SAHMT_ELIGIBILITY_AUDIT_V1_' + SAHMT_V2_CONFIG.projectId) || 'null');
    const age = audit && Date.now() - audit.checkedAt;
    return audit && Number.isFinite(age) && age >= 0 && age < 3600000 && /^[a-f0-9]{64}$/.test(audit.fingerprint) ? audit : null;
  } catch (_) { return null; }
}
function evaluationPublishCategorySummary_(category, options) {
  const scienceOnly = options && options.scienceOnly === true;
  if (scienceOnly) {
    if (category !== 'PERFORMANCE') throw new Error('CHECKLIST_SCIENCE_CATEGORY_DENIED');
    checklistScienceAssertOperator_();
  } else evaluationAssertOperator_(false);
  const auditCache = options && options.reuseEligibilityAudit === true ? evaluationEligibilityAuditCache_() : null;
  const recentAudit = evaluationReadEligibilityAudit_(auditCache);
  let freshAudit = null;
  const result = evaluationRunTransaction_(function (transaction) {
    freshAudit = null;
    if (scienceOnly) checklistScienceAssertOperator_(transaction);
    const fields = evaluationCategoryFields_(category), runtime = evaluationGet_('evaluationRuntime', 'state', transaction);
    if (!runtime || !Number.isInteger(runtime[fields.revision])) return {writes: [], result: {status: 'PENDING', reason: 'Categoria ainda não reconciliada.'}};
    const reference = evaluationGet_('evaluationReference', 'team', transaction);
    function incomplete(reason) {
      const refPatch = {}; refPatch[fields.status] = 'PENDING'; refPatch[fields.prefix + 'Reason'] = reason;
      const statePatch = {}; statePatch[fields.dirty] = true;
      return {writes: [evaluationWrite_('evaluationReference', 'team', refPatch, reference, ['updatedAt']),
        evaluationWrite_('evaluationRuntime', 'state', statePatch, runtime, ['updatedAt'])], result: {status: 'PENDING', category: category, reason: reason}};
    }
    const eligibilityField = fields.prefix + 'EligibilityFingerprint';
    if (recentAudit && Date.now() - recentAudit.checkedAt < 3600000 && runtime[fields.dirty] === false && runtime[eligibilityField] === recentAudit.fingerprint &&
        reference && reference[fields.status] === 'CONFIRMED' && reference[fields.revision] === runtime[fields.revision]) {
      return {writes: [], result: {status: 'DUPLICATE', category: category, revision: runtime[fields.revision]}};
    }
    const checkedAt = Date.now();
    const profiles = evaluationQuery_('users', [firestoreFilter_('active', 'EQUAL', {booleanValue: true}), firestoreFilter_('access', 'EQUAL', {booleanValue: true})], [], SAHMT_V2_EVALUATION_LEDGER.maxUsers + 1, ['uid', 'active', 'access'], transaction);
    if (profiles.length > SAHMT_V2_EVALUATION_LEDGER.maxUsers) return incomplete('Recálculo incompleto: orçamento seguro excedido.');
    const eligibilityFingerprint = sha256Hex_(JSON.stringify(profiles.map(function (profile) { return [profile.id, profile.uid]; }).sort(function (a, b) { return a[0].localeCompare(b[0]); })));
    freshAudit = {checkedAt: checkedAt, fingerprint: eligibilityFingerprint};
    if (runtime[fields.dirty] === false && runtime[eligibilityField] === eligibilityFingerprint && reference && reference[fields.status] === 'CONFIRMED' && reference[fields.revision] === runtime[fields.revision]) {
      return {writes: [], result: {status: 'DUPLICATE', category: category, revision: runtime[fields.revision]}};
    }
    const awards = evaluationQuery_('evaluationAwards', [firestoreFilter_('category', 'EQUAL', {stringValue: category})], [], SAHMT_V2_EVALUATION_LEDGER.maxAwards + 1, ['uid', 'category', 'points'], transaction);
    if (profiles.length > SAHMT_V2_EVALUATION_LEDGER.maxUsers || awards.length > SAHMT_V2_EVALUATION_LEDGER.maxAwards) return incomplete('Recálculo incompleto: orçamento seguro excedido.');
    let summary;
    try { summary = evaluationSummarizeCategory_(category, profiles, awards); } catch (error) { return incomplete(String(error.message).slice(0, 300)); }
    const revision = runtime[fields.revision] + (runtime[eligibilityField] && runtime[eligibilityField] !== eligibilityFingerprint ? 1 : 0), writes = [];
    Object.keys(summary.totals).forEach(function (uid) {
      const previous = evaluationGet_('evaluationSummaries', uid, transaction), changes = {uid: uid, status: 'CONFIRMED'};
      changes[fields.total] = summary.totals[uid].total; changes[fields.count] = summary.totals[uid].count; changes[fields.revision] = revision;
      writes.push(evaluationWrite_('evaluationSummaries', uid, changes, previous, ['confirmedAt']));
    });
    const refPatch = {}; refPatch[fields.revision] = revision; refPatch[fields.status] = 'CONFIRMED'; refPatch[fields.prefix + 'Reason'] = '';
    if (category === 'PERFORMANCE') { refPatch.maxPerformance = summary.maxPerformance; refPatch.eligibleCount = summary.eligibleCount; refPatch.allZero = summary.allZero; }
    writes.push(evaluationWrite_('evaluationReference', 'team', refPatch, reference, ['updatedAt']));
    const statePatch = {}; statePatch[fields.dirty] = false; statePatch[fields.revision] = revision; statePatch[eligibilityField] = eligibilityFingerprint;
    writes.push(evaluationWrite_('evaluationRuntime', 'state', statePatch, runtime, ['updatedAt']));
    return {writes: writes, result: {status: 'CONFIRMED', category: category, revision: revision, summaries: Object.keys(summary.totals).length}};
  });
  if (auditCache && freshAudit && ['CONFIRMED', 'DUPLICATE'].includes(result.status)) {
    try { auditCache.put('SAHMT_ELIGIBILITY_AUDIT_V1_' + SAHMT_V2_CONFIG.projectId, JSON.stringify(freshAudit), 3600); } catch (_) {}
  }
  return result;
}

function evaluationProcessScoreCorrection_(request) {
  evaluationAssertOperator_(true);
  return evaluationRunTransaction_(function (transaction) {
    const currentRequest = evaluationGet_('evaluationRequests', request.id, transaction);
    if (!currentRequest || currentRequest.status !== 'PENDING') return {writes: [], result: {status: 'DUPLICATE'}};
    if (currentRequest.type !== 'CORRECT_SCORE') throw new Error('Solicitação não corresponde a uma correção de pontuação.');
    const payload = currentRequest.payload || {}, actor = evaluationGet_('users', currentRequest.actorUid, transaction);
    if (!evaluationActiveProfile_(actor, currentRequest.actorUid) || !evaluationAdmin_(actor)) throw new Error('Somente administrador ativo pode corrigir pontuação.');
    const award = evaluationGet_('evaluationAwards', payload.awardId, transaction);
    if (!award || award.category !== payload.category || award.awardVersion !== payload.expectedAwardVersion || !evaluationValidPoints_(payload.correctedPoints) ||
        String(payload.reason || '').trim().length < 8) throw new Error('Crédito inexistente, versão antiga, categoria diferente ou correção inválida.');
    let result;
    if (award.modality === 'CHECKLIST') {
      const day = String(award.transferId || '').replace(/^checklist-/, ''), transfer = evaluationGet_('evaluationChecklistTransfers', day, transaction);
      if (!transfer || transfer.transferId !== award.transferId || transfer.members[award.uid].points !== award.points) throw new Error('Par de Checklist inconsistente.');
      if (award.leg === 'SELF' && payload.correctedPoints !== 0 || award.leg === 'DEBIT' && payload.correctedPoints > 0 || award.leg === 'CREDIT' && payload.correctedPoints < 0 || !['SELF', 'DEBIT', 'CREDIT'].includes(award.leg)) throw new Error('Correção deve preservar os lados do par do Checklist.');
      result = evaluationApplyChecklistTransfer_(day, transfer.responsibleUid, transfer.signerUid, transfer.signatureId, {transaction: transaction, correction: true,
        amount: Math.abs(payload.correctedPoints), expectedTransferVersion: transfer.transferVersion, actorUid: actor.uid, reason: payload.reason,
        expectedAwardVersion: undefined});
    } else {
      result = evaluationApplyAwards_([Object.assign(evaluationClean_(award), {points: payload.correctedPoints, reason: payload.reason, sourceType: 'ADMIN_CORRECTION', sourceId: currentRequest.id, approvedByUid: actor.uid})],
        {transaction: transaction, correction: true, expectedAwardVersion: payload.expectedAwardVersion});
    }
    result.writes.push(evaluationWrite_('evaluationRequests', currentRequest.id, {status: 'PROCESSED', result: {status: 'APPLIED', awardId: award.id, category: award.category}}, currentRequest, ['processedAt']));
    return {writes: result.writes, result: {status: 'APPLIED', awardId: award.id}};
  });
}

// Backend administrative API only: the replacement must be an accepted, trusted signature.
function evaluationCorrectChecklistSignature_(day, signatureId, expectedTransferVersion, reason, actorUid) {
  evaluationAssertOperator_(true);
  return evaluationRunTransaction_(function (transaction) {
    const actor = evaluationGet_('users', actorUid, transaction), signature = evaluationGet_('checklistSignatures', signatureId, transaction);
    if (!evaluationActiveProfile_(actor, actorUid) || !evaluationAdmin_(actor) || String(reason || '').trim().length < 8) throw new Error('Correção de assinatura exige administrador e justificativa.');
    if (!signature || signature.id !== signatureId || signature.date !== day || signature.declaration !== true || !signature.signedAt || !signature.snapshot ||
        signatureId !== day + '_' + signature.revision || signature.revision !== checklistStoredSnapshotRevision_(signature.snapshot) ||
        signature.snapshot.responsibleUid !== signature.responsibleUid || !signature.signerUid) throw new Error('A assinatura substituta não foi aceita com snapshot confiável.');
    const result = evaluationApplyChecklistTransfer_(day, signature.responsibleUid, signature.signerUid, signatureId, {transaction: transaction, correction: true,
      amount: signature.responsibleUid === signature.signerUid ? 0 : 1, expectedTransferVersion: expectedTransferVersion, actorUid: actorUid, reason: reason});
    return {writes: result.writes, result: {status: result.status, transferVersion: result.state.transferVersion}};
  });
}
