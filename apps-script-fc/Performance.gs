// Dedicated FC ledger. Never selects FA/FB from UID, request or old properties.
const FC_PERFORMANCE_PROJECT_ = 'indicadores---sahmt';
const FC_PERFORMANCE_RELEASE_ = 'fc-performance-exclusive-v1';
const FC_PERFORMANCE_COLLECTIONS_ = Object.freeze({
  evaluationRuntime: 'fcPerformanceRuntime', evaluationAwards: 'fcPerformanceAwards',
  evaluationLedger: 'fcPerformanceLedger', evaluationSummaries: 'fcPerformanceSummaries',
  evaluationReference: 'fcPerformanceReference', evaluationSourceReceipts: 'fcPerformanceSourceReceipts'
});
const FC_PERFORMANCE_SOURCES_ = Object.freeze(['users', 'occurrenceReports', 'occurrenceAudit', 'occurrenceScoreClaims',
  'occurrenceCatalogs', 'occurrenceRuntime', 'qmentumAccess', 'qmentumConfig', 'qmentumDefinitions', 'qmentumUnits',
  'qmentumParticipations', 'qmentumParticipationReviews', 'qmentumQuarterlyJobs', 'qmentumEvidence',
  'qmentumImprovementActions', 'qmentumAnalysisReviewRequests', 'qmentumQuarterlyQuota', 'qmentumWriteRequests']);

function fcPerformanceCollection_(name) {
  if (name === 'qmentumScoreOutbox') throw Error('FC_PERFORMANCE_FB_DELIVERY_DISABLED');
  if (Object.prototype.hasOwnProperty.call(FC_PERFORMANCE_COLLECTIONS_, name)) return FC_PERFORMANCE_COLLECTIONS_[name];
  if (Object.values(FC_PERFORMANCE_COLLECTIONS_).includes(name) || FC_PERFORMANCE_SOURCES_.includes(name)) return name;
  throw Error('FC_PERFORMANCE_COLLECTION_DENIED');
}

function evaluationProject_() { return FC_PERFORMANCE_PROJECT_; }
function evaluationCollectionProject_(collectionId) { fcPerformanceCollection_(collectionId); return FC_PERFORMANCE_PROJECT_; }
function evaluationDocumentName_(collectionId, documentId) {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(documentId || '')) throw Error('FC_PERFORMANCE_DOCUMENT_INVALID');
  return 'projects/' + FC_PERFORMANCE_PROJECT_ + '/databases/(default)/documents/' + fcPerformanceCollection_(collectionId) + '/' + documentId;
}

function fcAssertPerformanceFolder_(url, options) {
  const payload = options && options.payload ? JSON.parse(options.payload) : {};
  const paths = [url].concat(payload.documents || [], (payload.writes || []).map(function (write) {
    return (write.update || write.transform || {}).name || (write.transform || {}).document || '';
  }), ((payload.structuredQuery || payload.structuredAggregationQuery?.structuredQuery)?.from || []).map(function (source) {
    return '/' + source.collectionId + '/';
  }));
  const folders = [];
  if (paths.some(path => /\/fcPerformance[A-Za-z]+(?:\/|$)/.test(path))) {
    folders.push('desempenho/fc', 'registros/ocorrencias', 'registros/qmentum');
  }
  if (paths.some(path => /\/qmentum[A-Za-z]+(?:\/|$)/.test(path))) folders.push('registros/qmentum');
  if (paths.some(path => /\/occurrence[A-Za-z]+(?:\/|$)/.test(path))) folders.push('registros/ocorrencias');
  if (folders.length) fcRequireFolders_(folders);
}

function fcRequireFolders_(folders) {
  const policyUrl = 'https://firestore.googleapis.com/v1/projects/' + FC_PERFORMANCE_PROJECT_ + '/databases/(default)/documents/runtimePolicy/folders';
  let document;
  try {
    document = firestoreRequest_(policyUrl, {method:'get', followRedirects:false});
  } catch (error) {
    if (error.status === 404) return;
    throw error;
  }
  const policy = firestoreFieldsToJs_(document && document.fields || {});
  if (policy.schemaVersion !== 1 || !Number.isSafeInteger(policy.revision) || policy.revision < 1 ||
      !Array.isArray(policy.disabled) || policy.disabled.some(function (id) { return typeof id !== 'string'; })) {
    throw Error('FC_PERFORMANCE_FOLDER_POLICY_INVALID');
  }
  if (policy.disabled.some(id => folders.some(folder => folder === id || folder.indexOf(id + '/') === 0))) {
    throw Error('FC_PERFORMANCE_FOLDER_DISABLED');
  }
}

function fcAssertFirestoreDestination_(url, options) {
  if (typeof url !== 'string' || !/^https:\/\/firestore\.googleapis\.com\/v1\/projects\/indicadores---sahmt\/databases\/\(default\)\/documents(?:[/:?]|$)/.test(url) ||
      /(?:\/\.\.?\/|%2e|%2f|%5c|\\)/i.test(url)) throw Error('FC_PERFORMANCE_PROJECT_DENIED');
  const method = String(options && options.method || 'get').toLowerCase();
  if (method === 'delete') throw Error('FC_PERFORMANCE_DELETE_DENIED');
  if (options && options.payload) {
    const payload=JSON.parse(options.payload),prefix='projects/'+FC_PERFORMANCE_PROJECT_+'/databases/(default)/documents/';
    const documentNames=(payload.documents||[]).concat((payload.writes||[]).map(function(write){
      if(write.delete)throw Error('FC_PERFORMANCE_DELETE_DENIED');
      return write.update&&write.update.name||write.transform&&write.transform.document||'';
    }));
    documentNames.forEach(function(name){
      if(typeof name!=='string'||name.indexOf(prefix)!==0||/(?:\/\.\.?\/|%2e|%2f|%5c|\\)/i.test(name))throw Error('FC_PERFORMANCE_PROJECT_DENIED');
      fcPerformanceCollection_(name.slice(prefix.length).split('/')[0]);
    });
  }
  if (method !== 'get' && /(?:documents:commit|documents:batchWrite)(?:\?|$)/.test(url)) fcPerformanceRuntime_();
  return true;
}

function evaluationDocumentsUrl_(path, projectId) {
  if (projectId && projectId !== FC_PERFORMANCE_PROJECT_) throw Error('FC_PERFORMANCE_PROJECT_DENIED');
  if (typeof path !== 'string' || !/^(?:\/[A-Za-z0-9_/?=&.%()-]+|:[A-Za-z]+)$/.test(path)) throw Error('FC_PERFORMANCE_PATH_INVALID');
  const url = 'https://firestore.googleapis.com/v1/projects/' + FC_PERFORMANCE_PROJECT_ + '/databases/(default)/documents' + path;
  fcAssertFirestoreDestination_(url); return url;
}

function evaluationReadTransaction_(transaction, projectId) {
  const context = SAHMT_EVALUATION_TRANSACTIONS.get(transaction);
  if (!context || context.projectId !== FC_PERFORMANCE_PROJECT_ || projectId !== FC_PERFORMANCE_PROJECT_) throw Error('FC_PERFORMANCE_CROSS_PROJECT_TRANSACTION');
  return transaction;
}

function fcPerformanceRuntime_(transaction) {
  if (sahmtV2Properties_().getProperty('FC_PERFORMANCE_ENABLED') !== 'true') throw Error('FC_PERFORMANCE_DISABLED');
  const runtime = evaluationGet_('evaluationRuntime', 'state', transaction);
  return fcPerformanceValidateRuntime_(runtime);
}
function fcPerformanceValidateRuntime_(runtime) {
  if (!runtime || runtime.schemaVersion !== 1 || runtime.release !== FC_PERFORMANCE_RELEASE_ || runtime.mode !== 'FC_ONLY' ||
      runtime.projectId !== FC_PERFORMANCE_PROJECT_ || runtime.enabled !== true || runtime.automaticFbSync !== false ||
      runtime.legacyCentralStopped !== true || !(runtime.effectiveFrom instanceof Date) || !Number.isFinite(runtime.effectiveFrom.getTime()) ||
      runtime.occurrenceScoringApproved !== true || !Number.isSafeInteger(runtime.performanceRevision) || runtime.performanceRevision < 0)
    throw Error('FC_PERFORMANCE_RUNTIME_NOT_APPROVED');
  return runtime;
}

function fcPerformanceAssertRuntimeTransaction_(transaction) {
  evaluationReadTransaction_(transaction, FC_PERFORMANCE_PROJECT_); return fcPerformanceRuntime_(transaction);
}

function fcPerformanceAssertNewSource_(record, transaction) {
  const runtime = fcPerformanceRuntime_(transaction);
  if (!(record && record.createdAt instanceof Date) || !Number.isFinite(record.createdAt.getTime()) ||
      record.createdAt.getTime() < runtime.effectiveFrom.getTime()) throw Error('FC_PERFORMANCE_SOURCE_BEFORE_ACTIVATION');
  return true;
}
function fcPerformanceAssertAward_(input){
  if(!input||input.category!=='PERFORMANCE'||
    !(input.sourceType==='FC_OCCURRENCE_VERIFIED'&&input.modality==='OCCURRENCE'&&input.evidence&&input.evidence.sourceProjectId===FC_PERFORMANCE_PROJECT_||
      input.sourceType==='QMENTUM_PARTICIPATION'&&['ACKNOWLEDGEMENT','SUGGESTION'].includes(input.modality)))throw Error('FC_PERFORMANCE_SOURCE_DENIED');
}

function evaluationAssertConsolidationActive_() { return fcPerformanceRuntime_(); }
function evaluationIndependentFaSource_() { return false; }
function evaluationAssertOperator_() {
  const email = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  const allowed = String(sahmtV2Properties_().getProperty('SAHMT_V2_EVALUATION_ALLOWED_EMAILS') || '').split(/[;,\s]+/);
  if (email !== SAHMT_FC_EXECUTOR_EMAIL || !allowed.includes(email)) throw Error('FC_PERFORMANCE_EXECUTOR_DENIED');
  fcPerformanceRuntime_(); return email;
}
function evaluationOccurrenceEnabled_() {
  return sahmtV2Properties_().getProperty('FC_PERFORMANCE_ENABLED') === 'true' &&
    sahmtV2Properties_().getProperty('SAHMT_V2_OCCURRENCE_SCORING_ENABLED') === 'true';
}
function evaluationOccurrenceAssertOperator_() {
  if (!evaluationOccurrenceEnabled_()) throw Error('OCCURRENCE_SCORING_DISABLED');
  evaluationAssertOperator_();
}
function managementIndependentFbEnabled_() { return false; }
function qmParticipationUsesIndependentFb_() { return false; }
function managementIndependentFbAssert_() { throw Error('FC_PERFORMANCE_FB_DELIVERY_DISABLED'); }
function qmDeliverFbParticipation_() { throw Error('FC_PERFORMANCE_FB_DELIVERY_DISABLED'); }
function ocsMirrorCommitted_() { /* FC does not mirror points or business writes to FA/FB. */ }
function checklistScienceAssertOperator_() { throw Error('FC_PERFORMANCE_CATEGORY_DENIED'); }
