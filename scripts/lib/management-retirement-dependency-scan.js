import {createHash} from 'node:crypto';

const PROJECTS = Object.freeze({FA: 'sahmt-17a16', FB: 'sahmt-gestao-5ae66', FC: 'indicadores---sahmt'});
const MAX_QUERY_RESULTS = 500;
const MAX_QUERY_COUNT = 180;
const UID = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
const OBJECT = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Static Firestore reference map derived from this checkout's data adapters and
 * FA Security Rules. It deliberately projects only the reference field and,
 * where needed, its audience discriminator. Collection names are fixed; no
 * caller-provided collection or field path is accepted by the scanner.
 *
 * OPERATIONAL references may grant or represent current access/work and block
 * retirement. TRAINING and AUDIT are historical references and are reported,
 * never deleted. OTHER means the relationship needs manual classification.
 */
const BASE_CATALOG = [
  ['evaluationActivities', 'eligibleUids', 'ARRAY', 'OPERATIONAL'],
  ['evaluationActivities', 'managerUid', 'UID', 'OPERATIONAL'],
  ['evaluationAssignments', 'uid', 'UID', 'OPERATIONAL'],
  ['evaluationParticipations', 'uid', 'UID', 'TRAINING', {stateField: 'status', activeStates: ['PENDING', 'PENDING_REVIEW', 'SUBMITTED'], historyStates: ['APPROVED', 'REJECTED']}],
  ['evaluationParticipations', 'managerUid', 'UID', 'OPERATIONAL'],
  ['evaluationRequests', 'actorUid', 'UID', 'AUDIT', {stateField: 'status', activeStates: ['PENDING'], historyStates: ['APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED', 'APPLIED']}],
  ['evaluationRequests', 'payload.managerUid', 'UID', 'OPERATIONAL'],
  ['evaluationRequests', 'payload.eligibleUids', 'ARRAY', 'OPERATIONAL'],
  ['managementAreas', 'memberUids', 'ARRAY', 'OPERATIONAL'],
  ['managementAreas', 'managerUids', 'ARRAY', 'OPERATIONAL'],
  ['notifications', 'audienceValue', 'UID', 'OPERATIONAL', {filter_audienceType: 'USER', stateField: 'active', activeBoolean: true, historyBoolean: false, historyCategory: 'AUDIT'}],
  ['notificationGroups', 'memberUids', 'ARRAY', 'OPERATIONAL'],
  ['learningActivities', 'audienceValue', 'UID', 'TRAINING', {filter_audienceType: 'USER', stateField: 'status', activeStates: ['ACTIVE'], historyStates: ['INACTIVE'], activeCategory: 'OPERATIONAL'}],
  ['actionPlanItems', 'responsibleUids', 'ARRAY', 'OPERATIONAL', {stateField: 'status', activeStates: ['OPEN', 'IN_PROGRESS'], historyStates: ['COMPLETED', 'CANCELLED'], historyCategory: 'AUDIT'}],
  ['actionPlans', 'responsibleUid', 'UID', 'OPERATIONAL', {stateField: 'status', activeStates: ['OPEN', 'IN_PROGRESS'], historyStates: ['COMPLETED', 'CANCELLED'], historyCategory: 'AUDIT'}],
  ['actionPlans', 'participantUids', 'ARRAY', 'OPERATIONAL', {stateField: 'status', activeStates: ['OPEN', 'IN_PROGRESS'], historyStates: ['COMPLETED', 'CANCELLED'], historyCategory: 'AUDIT'}],
  ['equipment', 'responsibleUid', 'UID', 'OPERATIONAL', {stateField: 'active', activeBoolean: true, historyBoolean: false, historyCategory: 'AUDIT'}],
  ['maintenanceRecords', 'responsibleUid', 'UID', 'OPERATIONAL', {stateField: 'status', activeStates: ['OPEN', 'IN_PROGRESS'], historyStates: ['COMPLETED', 'CANCELLED'], historyCategory: 'AUDIT'}],
  ['managementAuthorizationLeases', 'uid', 'UID', 'OPERATIONAL', {projects: ['FB']}],
  ['managementAuthorizationLeases', 'faUid', 'UID', 'OPERATIONAL', {projects: ['FB']}],
  ['managementAuthorizationLeases', 'fbUid', 'UID', 'OPERATIONAL', {projects: ['FB']}],

  ['activities', 'uid', 'UID', 'TRAINING'],
  ['activities', 'createdByUid', 'UID', 'AUDIT'],
  ['activities', 'updatedByUid', 'UID', 'AUDIT'],
  ['activities', 'responsibleUids', 'ARRAY', 'OPERATIONAL', {stateField: 'status', activeStates: ['OPEN', 'IN_PROGRESS'], historyStates: ['COMPLETED', 'CANCELLED'], historyCategory: 'AUDIT'}],
  ['activityInteractions', 'uid', 'UID', 'TRAINING'],
  ['activityScoreReviews', 'uid', 'UID', 'TRAINING'],
  ['activityScoreReviews', 'reviewerUid', 'UID', 'OPERATIONAL', {stateField: 'status', activeStates: ['PENDING_VALIDATION'], historyStates: ['APPROVED', 'REJECTED'], historyCategory: 'AUDIT'}],
  ['evaluationAwards', 'uid', 'UID', 'TRAINING'],
  ['evaluationLedger', 'uid', 'UID', 'TRAINING'],
  ['evaluationGovernanceRevisions', 'uid', 'UID', 'TRAINING'],
  ['learningActivityReceipts', 'uid', 'UID', 'TRAINING'],
  ['scores', 'uid', 'UID', 'TRAINING'],
  ['trainingProgress', 'uid', 'UID', 'TRAINING', {stateField: 'status', activeStates: ['STARTED', 'IN_PROGRESS'], historyStates: ['COMPLETED'], activeCategory: 'OPERATIONAL'}],
  ['trainingReceipts', 'uid', 'UID', 'TRAINING', {stateField: 'accessPointsStatus', activeStates: [], historyStates: ['VALIDATED', 'NOT_APPLICABLE'], historyCategory: 'TRAINING'}],
  ['trainingCompletions', 'uid', 'UID', 'TRAINING', {stateField: 'validationStatus', activeStates: [], historyStates: ['VALIDATED', 'NOT_APPLICABLE', 'REJECTED'], historyCategory: 'TRAINING'}],

  ['accessRequests', 'uid', 'UID', 'OPERATIONAL', {stateField: 'status', activeStates: ['PENDING'], historyStates: ['APPROVED', 'REJECTED'], historyCategory: 'AUDIT'}],
  ['accessRequests', 'resolvedByUid', 'UID', 'AUDIT'],
  ['checklistResponsibilities', 'responsibleUid', 'UID', 'OPERATIONAL'],
  ['users', 'createdByUid', 'UID', 'AUDIT'],
  ['users', 'updatedByUid', 'UID', 'AUDIT'],
  ['users', '__name__', 'DOC_ID', 'OPERATIONAL'],
  ['accessRequests', '__name__', 'DOC_ID', 'OPERATIONAL'],
  ['managementSourceContexts', '__name__', 'DOC_ID', 'OPERATIONAL', {projects: ['FA']}],
  ['evaluationSummaries', '__name__', 'DOC_ID', 'TRAINING'],
  ['notificationReads', 'uid', 'UID', 'AUDIT', {collectionGroup: true}],
  ['checklistSignatureRequests', 'signerUid', 'UID', 'OPERATIONAL', {stateField: 'status', activeStates: ['PENDING_VALIDATION'], historyStates: ['APPROVED', 'REJECTED', 'COMPLETED'], historyCategory: 'AUDIT'}],
  ['checklistSignatures', 'signerUid', 'UID', 'AUDIT'],
  ['auditLogs', 'actorUid', 'UID', 'AUDIT'],
  ['evaluationActivities', 'actorUid', 'UID', 'AUDIT'],
  ['evaluationAssignmentHistory', 'actorUid', 'UID', 'AUDIT'],
  ['evaluationGovernanceRevisions', 'actorUid', 'UID', 'AUDIT'],
  ['events', 'createdByUid', 'UID', 'AUDIT'],
  ['events', 'updatedByUid', 'UID', 'AUDIT'],
  ['labels', 'createdByUid', 'UID', 'AUDIT'],
  ['labels', 'updatedByUid', 'UID', 'AUDIT'],
  ['stations', 'createdByUid', 'UID', 'AUDIT'],
  ['stations', 'updatedByUid', 'UID', 'AUDIT'],
  ['scheduleDays', 'createdByUid', 'UID', 'AUDIT'],
  ['scheduleDays', 'updatedByUid', 'UID', 'AUDIT'],
  ['vacations', 'createdByUid', 'UID', 'AUDIT'],
  ['vacations', 'updatedByUid', 'UID', 'AUDIT'],
  ['eventCatalogs', 'createdByUid', 'UID', 'AUDIT'],
  ['eventCatalogs', 'updatedByUid', 'UID', 'AUDIT'],
  ['appConfig', 'createdByUid', 'UID', 'AUDIT'],
  ['appConfig', 'updatedByUid', 'UID', 'AUDIT'],
  ['scoringRules', 'createdByUid', 'UID', 'AUDIT'],
  ['scoringRules', 'updatedByUid', 'UID', 'AUDIT'],
  ['indicators', 'createdByUid', 'UID', 'AUDIT'],
  ['indicators', 'updatedByUid', 'UID', 'AUDIT'],
  ['indicatorMeasurements', 'createdByUid', 'UID', 'AUDIT'],
  ['trainings', 'createdByUid', 'UID', 'AUDIT'],
  ['trainings', 'updatedByUid', 'UID', 'AUDIT'],
  ['learningActivities', 'createdByUid', 'UID', 'AUDIT'],
  ['learningActivities', 'updatedByUid', 'UID', 'AUDIT'],
  ['documents', 'createdByUid', 'UID', 'AUDIT'],
  ['documents', 'updatedByUid', 'UID', 'AUDIT'],
  ['scopedDocuments', 'createdByUid', 'UID', 'AUDIT'],
  ['scopedDocuments', 'updatedByUid', 'UID', 'AUDIT'],
  ['equipment', 'createdByUid', 'UID', 'AUDIT'],
  ['equipment', 'updatedByUid', 'UID', 'AUDIT'],
  ['equipmentEvents', 'createdByUid', 'UID', 'AUDIT'],
  ['equipmentEvents', 'responsibleUid', 'UID', 'AUDIT'],
  ['maintenanceRecords', 'createdByUid', 'UID', 'AUDIT'],
  ['maintenanceRecords', 'updatedByUid', 'UID', 'AUDIT'],
  ['notifications', 'createdByUid', 'UID', 'AUDIT'],
  ['notifications', 'updatedByUid', 'UID', 'AUDIT'],
  ['notificationGroups', 'createdByUid', 'UID', 'AUDIT'],
  ['notificationGroups', 'updatedByUid', 'UID', 'AUDIT'],
  ['managementAreas', 'createdByUid', 'UID', 'AUDIT'],
  ['managementAreas', 'updatedByUid', 'UID', 'AUDIT'],
  ['contacts', 'createdByUid', 'UID', 'AUDIT'],
  ['contacts', 'updatedByUid', 'UID', 'AUDIT'],
  ['checklists', 'createdByUid', 'UID', 'AUDIT'],
  ['checklists', 'updatedByUid', 'UID', 'AUDIT'],
  ['actionPlans', 'createdByUid', 'UID', 'AUDIT'],
  ['actionPlans', 'updatedByUid', 'UID', 'AUDIT'],
  ['actionPlanItems', 'createdByUid', 'UID', 'AUDIT'],
  ['actionPlanItems', 'updatedByUid', 'UID', 'AUDIT'],
  ['history', 'createdByUid', 'UID', 'AUDIT', {collectionGroup: true}],
  ['history', 'updatedByUid', 'UID', 'AUDIT', {collectionGroup: true}],
  // A fence is a current revocation control; keep it critical until reviewed.
  ['managementAuthorizationFences', 'uid', 'UID', 'OPERATIONAL', {projects: ['FB']}]
].map(([collectionId, fieldPath, match, category, options = {}]) => Object.freeze({
  collectionId, fieldPath, match, category, ...options
}));

const CATEGORIES = Object.freeze(['OPERATIONAL', 'TRAINING', 'AUDIT', 'OTHER']);

function demand(condition, code) { if (!condition) throw new Error(code); }

/** Resolves only the two approved identities from a freshly protected FA index. */
export function resolveRetirementCandidateUidsFromProtectedFaIndex(index, {now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000} = {}) {
  demand(OBJECT(index) && index.schemaVersion === 1 && index.kind === 'FA_UID_COMPARISON_INDEX'
    && index.projectId === PROJECTS.FA && Array.isArray(index.users), 'RETIREMENT_FA_INDEX_INVALID');
  demand(typeof index.capturedAt === 'string' && Number.isFinite(Date.parse(index.capturedAt))
    && Date.parse(index.capturedAt) <= now && now - Date.parse(index.capturedAt) <= maxAgeMs, 'RETIREMENT_FA_INDEX_STALE');
  const markerToUids = new Map([
    ['HOMOLOGATION_CANDIDATE_1', []], ['HOMOLOGATION_CANDIDATE_2', []], ['STRUCTURAL_OWNER', []]
  ]);
  const seen = new Set();
  for (const user of index.users) {
    demand(OBJECT(user) && UID(user.uid) && !seen.has(user.uid), 'RETIREMENT_FA_INDEX_UID_INVALID');
    seen.add(user.uid);
    if (markerToUids.has(user.identityMarker)) markerToUids.get(user.identityMarker).push(user.uid);
  }
  for (const values of markerToUids.values()) demand(values.length === 1, 'RETIREMENT_FA_INDEX_IDENTITY_AMBIGUOUS');
  const candidateUids = [markerToUids.get('HOMOLOGATION_CANDIDATE_1')[0], markerToUids.get('HOMOLOGATION_CANDIDATE_2')[0]];
  const structuralUid = markerToUids.get('STRUCTURAL_OWNER')[0];
  demand(new Set(candidateUids).size === 2 && !candidateUids.includes(structuralUid), 'RETIREMENT_FA_INDEX_IDENTITY_AMBIGUOUS');
  return Object.freeze({candidateUids: Object.freeze(candidateUids), structuralUid});
}

function catalogForProject(alias) {
  demand(Object.hasOwn(PROJECTS, alias), 'RETIREMENT_PROJECT_NOT_ALLOWED');
  const specs = BASE_CATALOG.filter(spec => !spec.projects || spec.projects.includes(alias));
  const keys = specs.map(spec => `${spec.collectionId}\u0000${spec.fieldPath}\u0000${spec.match}`);
  demand(new Set(keys).size === keys.length, 'RETIREMENT_CATALOG_DUPLICATE_QUERY');
  return specs;
}

function queryGroups(specs) {
  // One fixed reference field per query avoids composite-index requirements.
  // Additional audience/state constraints are checked against the projected
  // fields in memory after the UID-filtered read.
  // Collection-group single-field indexes are not guaranteed to exist. Leave
  // those references explicit and unqueried instead of failing the full scan.
  return specs.filter(spec => spec.collectionGroup !== true).map(spec => [spec]);
}

/** Safe, identifier-free query plan for review; it never includes candidate UIDs. */
export function describeManagementRetirementReadPlan() {
  const projects = {};
  for (const alias of Object.keys(PROJECTS)) {
    const specs = catalogForProject(alias);
    const groups = queryGroups(specs);
    projects[alias] = Object.freeze({projectId: PROJECTS[alias], queryCount: groups.length, referenceFieldChecks: specs.length,
      unqueriedReferenceFields: Object.freeze(specs.filter(spec => spec.collectionGroup === true).map(spec => `${spec.collectionId}.${spec.fieldPath}`)),
      collections: Object.freeze([...new Set(specs.map(spec => spec.collectionId))].sort()),
      categories: Object.freeze(Object.fromEntries(CATEGORIES.map(category => [category, specs.filter(spec => spec.category === category).length])))});
  }
  return Object.freeze({schemaVersion: 1, mode: 'READ_ONLY_PLAN', endpoint: 'Firestore REST documents:runQuery',
    method: 'POST (read-only structured query)', queryLimit: MAX_QUERY_RESULTS + 1,
    projects: Object.freeze(projects), maximumQueries: Object.values(projects).reduce((sum, project) => sum + project.queryCount, 0),
    writes: 0, logsContainIdentifiers: false});
}

function firestoreValue(value) { return {stringValue: value}; }

function buildBranchFilter(projectId, spec, candidateUids) {
  const queryValues = spec.match === 'DOC_ID'
    ? candidateUids.map(uid => ({referenceValue: `projects/${projectId}/databases/(default)/documents/${spec.collectionId}/${encodeURIComponent(uid)}`}))
    : candidateUids.map(firestoreValue);
  const fieldFilter = spec.match === 'ARRAY'
    ? {field: {fieldPath: spec.fieldPath}, op: 'ARRAY_CONTAINS_ANY', value: {arrayValue: {values: queryValues}}}
    : {field: {fieldPath: spec.fieldPath}, op: 'IN', value: {arrayValue: {values: queryValues}}};
  return {fieldFilter};
}

function buildQuery(projectId, specs, candidateUids) {
  demand(specs.length > 0 && specs.length <= 30, 'RETIREMENT_SCAN_OR_FILTER_LIMIT');
  const projection = new Set();
  for (const spec of specs) {
    if (spec.match === 'DOC_ID') projection.add('__name__');
    else projection.add(spec.fieldPath);
    for (const [key] of Object.entries(spec).filter(([key]) => key.startsWith('filter_'))) projection.add(key.slice(7));
    if (spec.stateField) projection.add(spec.stateField);
  }
  const branches = specs.map(spec => buildBranchFilter(projectId, spec, candidateUids));
  const where = branches.length === 1 ? branches[0] : {compositeFilter: {op: 'OR', filters: branches}};
  return {
    url: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
    method: 'POST',
    body: {structuredQuery: {
      from: [{collectionId: specs[0].collectionId, ...(specs[0].collectionGroup ? {allDescendants: true} : {})}],
      where,
      select: {fields: [...projection].map(fieldPath => ({fieldPath}))},
      limit: MAX_QUERY_RESULTS + 1
    }}
  };
}

function responseDocuments(response) {
  demand(Array.isArray(response), 'RETIREMENT_QUERY_RESPONSE_INVALID');
  for (const row of response) {
    if (!row?.document) demand(OBJECT(row) && (row.readTime !== undefined || row.transaction !== undefined || row.skippedResults !== undefined), 'RETIREMENT_QUERY_RESPONSE_INVALID');
  }
  const documents = response.filter(row => row?.document);
  demand(documents.length <= MAX_QUERY_RESULTS, 'RETIREMENT_QUERY_TRUNCATED');
  return documents;
}

function readFirestoreValue(fields, path) {
  let current = fields;
  const parts = path.split('.');
  for (const part of parts.slice(0, -1)) current = current?.[part]?.mapValue?.fields;
  return current?.[parts.at(-1)];
}

function readFirestoreScalar(fields, path) {
  const value = readFirestoreValue(fields, path);
  if (typeof value?.stringValue === 'string') return value.stringValue;
  if (typeof value?.booleanValue === 'boolean') return value.booleanValue;
  return undefined;
}

function categoryFor(spec, fields) {
  if (!spec.stateField) return spec.category;
  const state = readFirestoreScalar(fields, spec.stateField);
  if (typeof state === 'boolean') {
    if (state === spec.activeBoolean) return spec.activeCategory || 'OPERATIONAL';
    if (state === spec.historyBoolean) return spec.historyCategory || spec.category;
    return 'OTHER';
  }
  if ((spec.activeStates || []).includes(state)) return spec.activeCategory || 'OPERATIONAL';
  if ((spec.historyStates || []).includes(state)) return spec.historyCategory || spec.category;
  return 'OTHER';
}

function matchesSpec(spec, document, candidateUids) {
  const fields = document?.fields;
  for (const [key, value] of Object.entries(spec).filter(([key]) => key.startsWith('filter_'))) {
    if (readFirestoreScalar(fields, key.slice(7)) !== value) return null;
  }
  if (spec.match === 'DOC_ID') return candidateUids.find(uid => document?.name?.endsWith('/' + encodeURIComponent(uid))) || null;
  const field = readFirestoreValue(fields, spec.fieldPath);
  if (spec.match === 'ARRAY') {
    if (field === undefined) return null;
    const values = field?.arrayValue?.values;
    demand(Array.isArray(values) && values.every(value => typeof value?.stringValue === 'string'), 'RETIREMENT_SCAN_FIELD_SCHEMA_AMBIGUOUS');
    const matches = values.map(value => value?.stringValue).filter(uid => candidateUids.includes(uid));
    return [...new Set(matches)];
  }
  if (field === undefined) return null;
  const uid = field?.stringValue;
  demand(typeof uid === 'string', 'RETIREMENT_SCAN_FIELD_SCHEMA_AMBIGUOUS');
  return candidateUids.includes(uid) ? uid : null;
}

/**
 * Runs only fixed, projected Firestore queries for the two UIDs supplied from
 * the protected FA index. Returned document names/fields are immediately
 * discarded; this function returns only UID/category/count tuples for joining
 * in memory with the protected inventory. The caller must never log this value.
 */
export async function scanManagementRetirementDependencies({projectAlias, protectedFaIndex, now = Date.now(),
  getAccessToken, fetchImpl = globalThis.fetch, onStage = () => {}} = {}) {
  demand(Object.hasOwn(PROJECTS, projectAlias), 'RETIREMENT_PROJECT_NOT_ALLOWED');
  const {candidateUids, structuralUid} = resolveRetirementCandidateUidsFromProtectedFaIndex(protectedFaIndex, {now});
  demand(typeof getAccessToken === 'function' && typeof fetchImpl === 'function' && typeof onStage === 'function', 'RETIREMENT_SCAN_DEPENDENCIES_INVALID');
  const specs = catalogForProject(projectAlias);
  const groups = queryGroups(specs);
  demand(groups.length <= MAX_QUERY_COUNT, 'RETIREMENT_SCAN_QUERY_LIMIT');
  let token;
  try {
    token = await getAccessToken({projectId: PROJECTS[projectAlias], scopes: ['https://www.googleapis.com/auth/cloud-platform'], purpose: 'RETIREMENT_DEPENDENCY_READ_ONLY'});
  } catch { throw new Error('RETIREMENT_SCAN_OAUTH_FAILED'); }
  demand(typeof token === 'string' && token.length >= 20, 'RETIREMENT_SCAN_TOKEN_UNAVAILABLE');
  const references = new Map(candidateUids.map(uid => [uid, Object.fromEntries(CATEGORIES.map(category => [category, new Set()]))]));
  const addReference = (uid, category, documentName) => {
    demand(typeof documentName === 'string' && documentName.length <= 2048, 'RETIREMENT_SCAN_DOCUMENT_NAME_INVALID');
    references.get(uid)[category].add(createHash('sha256').update(documentName).digest('hex'));
  };
  let queryIndex = 0;
  try {
    for (const group of groups) {
      onStage(`DEPENDENCY_QUERY_${queryIndex + 1}_${group[0].collectionId}_${group[0].fieldPath}`);
      let request = buildQuery(PROJECTS[projectAlias], group, candidateUids);
      let response;
      try {
        response = await fetchImpl(request.url, {method: request.method,
          headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
          body: JSON.stringify(request.body), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000)});
      } catch { throw new Error('RETIREMENT_SCAN_REQUEST_FAILED'); }
      if (!response || response.ok !== true) {
        const status = Number.isInteger(response?.status) ? response.status : 0;
        let category = 'UNKNOWN';
        try {
          const payload = await response.json();
          const apiStatus = payload?.error?.status;
          if (apiStatus === 'FAILED_PRECONDITION') category = 'FAILED_PRECONDITION';
          else if (apiStatus === 'INVALID_ARGUMENT') category = 'INVALID_ARGUMENT';
          else if (apiStatus === 'PERMISSION_DENIED') category = 'PERMISSION_DENIED';
          else if (apiStatus === 'UNAUTHENTICATED') category = 'UNAUTHENTICATED';
          else if (apiStatus === 'RESOURCE_EXHAUSTED') category = 'RESOURCE_EXHAUSTED';
          else if (apiStatus === 'NOT_FOUND') category = 'NOT_FOUND';
        } catch { /* preserve the fixed UNKNOWN category */ }
        response = null;
        throw new Error(category === 'UNKNOWN'
          ? `RETIREMENT_SCAN_HTTP_${status}` : `RETIREMENT_SCAN_HTTP_${status}_${category}`);
      }
      let rows;
      try { rows = await response.json(); response = null; }
      catch { throw new Error('RETIREMENT_SCAN_RESPONSE_INVALID'); }
      const documents = responseDocuments(rows);
      for (const row of documents) {
        let matched = false;
        for (const spec of group) {
          const uids = matchesSpec(spec, row.document, candidateUids);
          if (!uids || Array.isArray(uids) && !uids.length) continue;
          matched = true;
          const category = categoryFor(spec, row.document.fields);
          for (const uid of Array.isArray(uids) ? uids : [uids]) addReference(uid, category, row.document.name);
        }
        if (!matched) throw new Error('RETIREMENT_SCAN_RESULT_UID_UNEXPECTED');
      }
      rows.length = 0;
      rows = null;
      documents.length = 0;
      request.body = null;
      request = null;
      queryIndex++;
      if (queryIndex > MAX_QUERY_COUNT) throw new Error('RETIREMENT_SCAN_QUERY_LIMIT');
    }
  } finally { token = null; }
  return Object.freeze({schemaVersion: 1, projectId: PROJECTS[projectAlias], complete: true,
    coverageScope: 'STATIC_REPOSITORY_SCHEMA_ALLOWLIST', unmappedCollectionsReviewed: false,
    globalAbsenceConfirmed: false,
    collectionsScanned: new Set(groups.map(group => group[0].collectionId)).size, queriesCompleted: queryIndex, failures: 0,
    unqueriedReferenceFields: Object.freeze(specs.filter(spec => spec.collectionGroup === true).map(spec => `${spec.collectionId}.${spec.fieldPath}`)),
    references: Object.freeze([...references].flatMap(([uid, byCategory]) => CATEGORIES
      .filter(category => byCategory[category].size > 0).map(category => Object.freeze({uid, category, count: byCategory[category].size}))))});
}

/** Converts the private in-memory UID join into an identifier-free report. */
export function summarizeManagementRetirementDependencies(scan, protectedFaIndex, {now = Date.now()} = {}) {
  demand(OBJECT(scan) && scan.complete === true && scan.failures === 0 && Array.isArray(scan.references)
    && Object.values(PROJECTS).includes(scan.projectId), 'RETIREMENT_DEPENDENCY_SCAN_INCOMPLETE');
  const {candidateUids} = resolveRetirementCandidateUidsFromProtectedFaIndex(protectedFaIndex, {now});
  const labels = new Map([[candidateUids[0], 'candidateOne'], [candidateUids[1], 'candidateTwo']]);
  const byCandidate = Object.fromEntries([...labels.values()].map(label => [label, Object.fromEntries(CATEGORIES.map(category => [category, 0]))]));
  for (const row of scan.references) {
    demand(OBJECT(row) && labels.has(row.uid) && CATEGORIES.includes(row.category)
      && Number.isSafeInteger(row.count) && row.count >= 0, 'RETIREMENT_DEPENDENCY_SCAN_INVALID');
    byCandidate[labels.get(row.uid)][row.category] += row.count;
  }
  return Object.freeze({schemaVersion: 1, projectId: scan.projectId, complete: true,
    coverageScope: scan.coverageScope, unmappedCollectionsReviewed: false, globalAbsenceConfirmed: false,
    collectionsScanned: scan.collectionsScanned, queriesCompleted: scan.queriesCompleted,
    unqueriedReferenceFields: Object.freeze(Array.isArray(scan.unqueriedReferenceFields) ? scan.unqueriedReferenceFields : []),
    candidates: Object.freeze(Object.fromEntries(Object.entries(byCandidate).map(([label, counts]) => [label, Object.freeze(counts)]))),
    identifiersIncluded: false, deletionAllowed: false});
}

export const MANAGEMENT_RETIREMENT_DEPENDENCY_SCANNER_LIMITS = Object.freeze({maxResultsPerQuery: MAX_QUERY_RESULTS,
  maxQueriesPerProject: MAX_QUERY_COUNT, methods: Object.freeze(['POST']), writes: 0, deletes: 0,
  logsContainIdentifiers: false, projects: Object.freeze(PROJECTS)});
