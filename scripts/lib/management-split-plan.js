import {createHash} from 'node:crypto';

// This module handles local, typed snapshots only. It has no Firebase client,
// credential lookup, network access, source deletion or production apply path.
const OWNED = new Set(['managementAreas', 'activities', 'activityInteractions', 'activityScoreReviews', 'indicators', 'indicatorMeasurements', 'actionPlans', 'actionPlanItems', 'documents', 'scopedDocuments', 'equipment', 'equipmentEvents', 'maintenanceRecords']);
const MIXED = new Set(['scoringRules', 'scores', 'learningActivities', 'learningActivityReceipts', 'trainings', 'trainingProgress', 'trainingReceipts', 'trainingCompletions', 'evaluationActivities', 'evaluationFormConfigs', 'evaluationLinks', 'evaluationParticipations', 'evaluationAssignments', 'evaluationAssignmentHistory', 'evaluationGovernanceRevisions', 'evaluationRequests', 'evaluationAwards', 'evaluationLedger', 'auditLogs']);
const DERIVED = new Set(['evaluationSummaries', 'evaluationReference', 'evaluationRuntime']);
const SOURCE_ONLY = new Set(['users', 'roles', 'contacts', 'eventMembers', 'accessRequests', 'appConfig', 'documentAccessEmails', 'scheduleDays', 'vacations', 'events', 'labels', 'stations', 'checklists', 'checklistSignatures', 'checklistSignatureRequests', 'checklistResponsibilities', 'evaluationChecklistTransfers', 'notifications', 'notificationGroups', 'syncQueue']);
const actions = new Set(['COPY', 'KEEP_FA', 'REBUILD']);
const projectId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const clone = value => JSON.parse(JSON.stringify(value));
const assert = (condition, code) => { if (!condition) throw new Error(code); };
function timestampParts(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match || Number(value.slice(0,4)) < 1) return null;
  const millis = Date.parse(match[1]+'Z');
  // Date.parse normalizes impossible dates; compare the full calendar instead.
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0,19) !== match[1]) return null;
  return {seconds: millis/1000, nanos: Number((match[2] || '').padEnd(9,'0'))};
}
const timestamp = value => timestampParts(value) !== null;
const timestampBeforeOrEqual = (left, right) => {
  const a=timestampParts(left), b=timestampParts(right);
  return a !== null && b !== null && (a.seconds < b.seconds || a.seconds === b.seconds && a.nanos <= b.nanos);
};

function validPath(path) {
  if (typeof path !== 'string') return false;
  const parts = path.split('/');
  return parts.length >= 2 && parts.length % 2 === 0 && parts.every(part => part && part !== '.' && part !== '..' && part !== '*' && !/[\x00-\x1f\\]/.test(part));
}

function validateValue(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1, 'INVALID_FIRESTORE_VALUE');
  const [type, data] = Object.entries(value)[0];
  if (type === 'nullValue') assert(data === null || data === 'NULL_VALUE', 'INVALID_NULL');
  else if (type === 'booleanValue') assert(typeof data === 'boolean', 'INVALID_BOOLEAN');
  else if (type === 'integerValue') assert(typeof data === 'string' && /^-?\d+$/.test(data), 'INVALID_INTEGER');
  else if (type === 'doubleValue') assert(typeof data === 'number' && Number.isFinite(data) || ['NaN', 'Infinity', '-Infinity'].includes(data), 'INVALID_DOUBLE');
  else if (type === 'timestampValue') assert(timestamp(data), 'INVALID_TIMESTAMP');
  else if (type === 'stringValue' || type === 'bytesValue') assert(typeof data === 'string', 'INVALID_STRING');
  else if (type === 'referenceValue') assert(typeof data === 'string' && /^projects\/[^/]+\/databases\/[^/]+\/documents\/.+/.test(data) && validPath(data.split('/documents/')[1]), 'INVALID_REFERENCE');
  else if (type === 'geoPointValue') assert(data && Number.isFinite(data.latitude) && Math.abs(data.latitude) <= 90 && Number.isFinite(data.longitude) && Math.abs(data.longitude) <= 180, 'INVALID_GEOPOINT');
  else if (type === 'arrayValue') { assert(data && typeof data === 'object' && Object.keys(data).every(key => key === 'values') && (!Object.hasOwn(data, 'values') || Array.isArray(data.values)), 'INVALID_ARRAY'); (data.values || []).forEach(validateValue); }
  else if (type === 'mapValue') { assert(data && typeof data === 'object' && Object.keys(data).every(key => key === 'fields'), 'INVALID_MAP'); validateFields(data.fields || {}); }
  else throw new Error('UNSUPPORTED_FIRESTORE_VALUE');
}

function validateFields(fields) {
  assert(fields && typeof fields === 'object' && !Array.isArray(fields), 'INVALID_FIELDS');
  Object.values(fields).forEach(validateValue);
}

export function snapshotDigest(snapshot) { return sha256(canonical(snapshot)); }
export function documentDigest(document) { return sha256(canonical(document)); }

export function validateSplitSnapshot(snapshot) {
  assert(snapshot?.schemaVersion === 1 && projectId(snapshot.projectId) && snapshot.databaseId === '(default)' && timestamp(snapshot.readTime), 'INVALID_SNAPSHOT_HEADER');
  assert(snapshot.coverage?.complete === true && snapshot.coverage.consistent === true && Array.isArray(snapshot.coverage.rootCollections) && snapshot.coverage.rootCollections.length > 0 && new Set(snapshot.coverage.rootCollections).size === snapshot.coverage.rootCollections.length, 'INCOMPLETE_SNAPSHOT');
  assert(snapshot.coverage.rootCollections.every(name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(name)), 'INVALID_COVERAGE');
  assert(Array.isArray(snapshot.documents), 'INVALID_DOCUMENTS');
  const paths = new Set();
  for (const document of snapshot.documents) {
    assert(validPath(document?.path) && !paths.has(document.path), 'INVALID_OR_DUPLICATE_DOCUMENT_PATH');
    assert(snapshot.coverage.rootCollections.includes(document.path.split('/')[0]), 'DOCUMENT_OUTSIDE_COVERAGE');
    assert(timestampBeforeOrEqual(document.createTime,document.updateTime) && timestampBeforeOrEqual(document.updateTime,snapshot.readTime), 'INVALID_DOCUMENT_TIMES');
    validateFields(document.fields);
    paths.add(document.path);
  }
  return snapshot;
}

function references(value, result = []) {
  if (Array.isArray(value)) value.forEach(item => references(item, result));
  else if (value && typeof value === 'object') {
    if (typeof value.referenceValue === 'string') result.push(value.referenceValue);
    Object.values(value).forEach(item => references(item, result));
  }
  return result;
}

function rewriteReferences(value, replacements) {
  if (Array.isArray(value)) return value.map(item => rewriteReferences(item, replacements));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'referenceValue' && replacements.has(item) ? replacements.get(item) : rewriteReferences(item, replacements)]));
  return value;
}

// Relations expressed as string IDs must be checked as well as referenceValue.
// An evidence label in a manifest alone is not proof of a Gestão relationship.
function documentRelations(document, documents) {
  const result = new Set();
  const single = {managementAreaId:'managementAreas',managerAreaId:'managementAreas',areaId:'managementAreas',indicatorId:'indicators',planId:'actionPlans',equipmentId:'equipment',assignmentId:'evaluationAssignments',awardId:'evaluationAwards',participationId:'evaluationParticipations',revisionId:'evaluationGovernanceRevisions',trainingId:'trainings'};
  const inspect = fields => {
    for (const [key,value] of Object.entries(fields || {})) {
      const id=value?.stringValue;
      if (single[key] && id) result.add(`${single[key]}/${id}`);
      if (key==='areaIds') for (const item of value.arrayValue?.values || []) if(item.stringValue) result.add(`managementAreas/${item.stringValue}`);
      if (key==='activityId' && id) {
        const candidates=['activities','evaluationActivities'].map(collection=>`${collection}/${id}`).filter(path=>documents.has(path));
        if(candidates.length===1) result.add(candidates[0]);
        else result.add(`UNRESOLVED_ACTIVITY/${id}`);
      }
      if(value?.mapValue) inspect(value.mapValue.fields);
      if(value?.arrayValue) for(const item of value.arrayValue.values || []) if(item.mapValue) inspect(item.mapValue.fields);
    }
    const sourceCollection=fields?.sourceCollection?.stringValue,sourceId=fields?.sourceId?.stringValue;
    if(sourceCollection && sourceId) result.add(`${sourceCollection}/${sourceId}`);
  };
  inspect(document.fields);
  for(const reference of references(document.fields)) {
    const prefix=`projects/sahmt-17a16/databases/(default)/documents/`;
    if(reference.startsWith(prefix)) result.add(reference.slice(prefix.length));
  }
  return [...result];
}

/** Every document must be classified and pinned to the verified source hash.
 * COPY preserves IDs and UID-dependent hashes. Remapping UIDs requires another
 * reviewed adapter; this planner rejects it instead of guessing historical links.
 */
export function prepareSplitPlan(snapshot, manifest, destinationSnapshot = null) {
  validateSplitSnapshot(snapshot);
  assert(manifest?.schemaVersion === 1 && manifest.sourceProjectId === snapshot.projectId && snapshot.projectId === 'sahmt-17a16' && manifest.sourceDatabaseId === snapshot.databaseId, 'SOURCE_PROJECT_MISMATCH');
  assert(projectId(manifest.destinationProjectId) && manifest.destinationProjectId !== snapshot.projectId && manifest.destinationDatabaseId === '(default)', 'DESTINATION_PROJECT_INVALID');
  assert(manifest.backupSha256 === snapshotDigest(snapshot), 'BACKUP_HASH_MISMATCH');
  assert(Array.isArray(manifest.entries) && manifest.entries.length === snapshot.documents.length, 'CLASSIFICATION_INCOMPLETE');
  assert(Array.isArray(manifest.identityMappings), 'IDENTITY_MAPPING_REQUIRED');
  const memberIds = new Set(), sourceUids = new Set(), destinationUids = new Set();
  for (const mapping of manifest.identityMappings) {
    assert(mapping && Object.keys(mapping).every(key => ['memberId', 'faUid', 'fbUid'].includes(key)) && [mapping.memberId, mapping.faUid, mapping.fbUid].every(item => typeof item === 'string' && item.length > 0 && item.length <= 200 && !/[\s/]/.test(item)), 'INVALID_IDENTITY_MAPPING');
    assert(!memberIds.has(mapping.memberId) && !sourceUids.has(mapping.faUid) && !destinationUids.has(mapping.fbUid), 'IDENTITY_MAPPING_COLLISION');
    assert(mapping.faUid === mapping.fbUid, 'UID_REMAP_REQUIRES_REVIEWED_ADAPTER');
    memberIds.add(mapping.memberId); sourceUids.add(mapping.faUid); destinationUids.add(mapping.fbUid);
  }
  const documents = new Map(snapshot.documents.map(document => [document.path, document]));
  // Archived authors are explicit source attributions, never identity mappings.
  // Each exception is pinned to one original, top-level author field in a COPY.
  const historicalAttributions = new Map(), consumedAttributions = new Set();
  if (Object.hasOwn(manifest, 'historicalAttributions')) {
    assert(Array.isArray(manifest.historicalAttributions), 'INVALID_HISTORICAL_ATTRIBUTIONS');
    const exactKeys = (object, keys) => object !== null && typeof object === 'object' && !Array.isArray(object)
      && [Object.prototype, null].includes(Object.getPrototypeOf(object))
      && Reflect.ownKeys(object).length === keys.length && Reflect.ownKeys(object).every(key => {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        return keys.includes(key) && descriptor.enumerable === true && Object.hasOwn(descriptor, 'value');
      });
    for (const attribution of manifest.historicalAttributions) {
      assert(exactKeys(attribution, ['path', 'sourceSha256', 'field', 'sourceUid', 'actor']), 'INVALID_HISTORICAL_ATTRIBUTION');
      assert(validPath(attribution.path) && attribution.path.split('/').length === 2 && ['documents', 'scopedDocuments'].includes(attribution.path.split('/')[0]) && documents.has(attribution.path), 'HISTORICAL_ATTRIBUTION_PATH_MISMATCH');
      assert(['createdByUid', 'updatedByUid'].includes(attribution.field), 'HISTORICAL_ATTRIBUTION_FIELD_FORBIDDEN');
      assert(typeof attribution.sourceUid === 'string' && attribution.sourceUid.length > 0 && attribution.sourceUid.length <= 200 && !/[\s/\x00-\x1f]/.test(attribution.sourceUid), 'INVALID_HISTORICAL_ATTRIBUTION_UID');
      assert(!sourceUids.has(attribution.sourceUid), 'HISTORICAL_ATTRIBUTION_ALREADY_MAPPED');
      const sourceDocument = documents.get(attribution.path);
      assert(attribution.sourceSha256 === documentDigest(sourceDocument), 'HISTORICAL_ATTRIBUTION_HASH_MISMATCH');
      assert(Object.hasOwn(sourceDocument.fields, attribution.field) && sourceDocument.fields[attribution.field]?.stringValue === attribution.sourceUid, 'HISTORICAL_ATTRIBUTION_FIELD_MISMATCH');
      const actor = attribution.actor;
      assert(exactKeys(actor, ['sourceProjectId', 'sourceUid', 'status', 'active', 'access', 'memberId'])
        && actor.sourceProjectId === snapshot.projectId && actor.sourceUid === attribution.sourceUid
        && actor.status === 'ARCHIVED_UNRESOLVED' && actor.active === false && actor.access === false && actor.memberId === null, 'INVALID_HISTORICAL_ARCHIVED_ACTOR');
      const key = `${attribution.path}\u0000${attribution.field}`;
      assert(!historicalAttributions.has(key), 'DUPLICATE_HISTORICAL_ATTRIBUTION');
      historicalAttributions.set(key, attribution);
    }
  }
  const entries = new Map();
  for (const entry of manifest.entries) {
    assert(entry && documents.has(entry.path) && !entries.has(entry.path) && actions.has(entry.action) && typeof entry.reason === 'string' && entry.reason.trim().length >= 8, 'INVALID_MANIFEST_ENTRY');
    assert(entry.sourceSha256 === documentDigest(documents.get(entry.path)), 'DOCUMENT_HASH_MISMATCH');
    assert(Array.isArray(entry.dependencies) && entry.dependencies.every(path => documents.has(path)), 'DEPENDENCY_NOT_BACKED_UP');
    const collection = entry.path.split('/')[0];
    assert(OWNED.has(collection) || MIXED.has(collection) || DERIVED.has(collection) || SOURCE_ONLY.has(collection), 'UNCLASSIFIED_COLLECTION');
    assert(!SOURCE_ONLY.has(collection) || entry.action === 'KEEP_FA', 'OPERATIONAL_OR_AUTH_COPY_FORBIDDEN');
    assert(!DERIVED.has(collection) || entry.action === 'REBUILD' || entry.action === 'KEEP_FA', 'DERIVED_STATE_COPY_FORBIDDEN');
    if (MIXED.has(collection) && entry.action === 'COPY') assert(entry.scope === 'GESTAO' && entry.evidence === 'RELATION_VERIFIED', 'MIXED_DOCUMENT_NOT_PROVEN');
    const fields = documents.get(entry.path).fields;
    if (entry.action === 'COPY' && collection === 'scores') assert(fields.sourceType?.stringValue === 'MANAGEMENT_TASK_COMPLETION', 'LEGACY_SCORE_NOT_MANAGEMENT');
    if (entry.action === 'COPY' && collection === 'evaluationAwards') assert(['ACKNOWLEDGEMENT','ACK','SUGGESTION','TEST','MATERIAL','QUESTIONS'].includes(fields.modality?.stringValue), 'UNREVIEWED_OR_CHECKLIST_CREDIT_COPY_FORBIDDEN');
    if (entry.action === 'COPY' && collection === 'evaluationLedger') {
      const awardPath = `evaluationAwards/${fields.awardId?.stringValue}`;
      assert(entry.dependencies.includes(awardPath) && documents.has(awardPath), 'LEDGER_AWARD_DEPENDENCY_REQUIRED');
    }
    if (entry.action === 'COPY') {
      const inspectUids = (value, field = '', topLevel = false) => {
        if (!value || typeof value !== 'object') return;
        if ((field==='uid' || field.endsWith('Uid') || ['createdBy','updatedBy'].includes(field)) && typeof value.stringValue === 'string' && value.stringValue && !sourceUids.has(value.stringValue)) {
          const key = `${entry.path}\u0000${field}`;
          const attribution = topLevel ? historicalAttributions.get(key) : undefined;
          assert(attribution?.sourceUid === value.stringValue, 'UID_NOT_MAPPED');
          consumedAttributions.add(key);
        }
        if (field.endsWith('Uids')) for (const item of value.arrayValue?.values || []) assert(sourceUids.has(item.stringValue), 'UID_NOT_MAPPED');
        if (value.mapValue) Object.entries(value.mapValue.fields || {}).forEach(([key, item]) => inspectUids(item, key));
        if (value.arrayValue) for (const item of value.arrayValue.values || []) inspectUids(item);
      };
      Object.entries(fields).forEach(([key, value]) => inspectUids(value, key, true));
    }
    entries.set(entry.path, entry);
  }
  assert(consumedAttributions.size === historicalAttributions.size, 'HISTORICAL_ATTRIBUTION_UNCONSUMED');
  for (const entry of entries.values()) if (entry.action === 'COPY' && entry.path.startsWith('evaluationLedger/')) {
    const awardPath = `evaluationAwards/${documents.get(entry.path).fields.awardId.stringValue}`;
    assert(entries.get(awardPath)?.action === 'COPY', 'LEDGER_AWARD_NOT_MIGRATED');
  }
  const sourceBase = `projects/${snapshot.projectId}/databases/${snapshot.databaseId}/documents/`;
  const destinationBase = `projects/${manifest.destinationProjectId}/databases/${manifest.destinationDatabaseId}/documents/`;
  const replacements = new Map([...entries.values()].filter(entry => entry.action === 'COPY').map(entry => [sourceBase + entry.path, destinationBase + entry.path]));
  const relations = new Map([...documents.values()].map(document=>[document.path,documentRelations(document,documents)]));
  const reachesManagement = (path,seen=new Set()) => {
    if(seen.has(path) || entries.get(path)?.action!=='COPY') return false;
    if(OWNED.has(path.split('/')[0])) return true;
    seen.add(path);
    return (relations.get(path)||[]).some(dependency=>reachesManagement(dependency,seen));
  };
  const existing = new Map();
  if (destinationSnapshot) {
    validateSplitSnapshot(destinationSnapshot);
    assert(destinationSnapshot.projectId === manifest.destinationProjectId && destinationSnapshot.databaseId === manifest.destinationDatabaseId, 'DESTINATION_SNAPSHOT_MISMATCH');
    const requiredCollections=[...new Set([...entries.values()].filter(entry=>entry.action==='COPY').map(entry=>entry.path.split('/')[0])),'migrationOrigins'];
    assert(requiredCollections.every(collection=>destinationSnapshot.coverage.rootCollections.includes(collection)), 'DESTINATION_COVERAGE_INCOMPLETE');
    destinationSnapshot.documents.forEach(document => existing.set(document.path, document));
  }
  const operations = [], audit = [], blockers = [];
  if(!destinationSnapshot) blockers.push({code:'DESTINATION_SNAPSHOT_REQUIRED'});
  for (const entry of [...entries.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const document = documents.get(entry.path);
    const origin = {sourceProjectId: snapshot.projectId, sourcePath: entry.path};
    if (entry.action !== 'COPY') { audit.push({...origin, result: entry.action, sourceSha256: entry.sourceSha256}); continue; }
    if(MIXED.has(entry.path.split('/')[0]) && entry.path!=='scoringRules/management-task-completion-v1' && !reachesManagement(entry.path)) blockers.push({code:'MIXED_RELATION_NOT_DEMONSTRATED',path:entry.path});
    for(const dependency of relations.get(entry.path)||[]) if(!documents.has(dependency) || entries.get(dependency)?.action!=='COPY') blockers.push({code:'STRING_RELATION_NEEDS_BACKUP_OR_PROJECTION',path:entry.path,dependency});
    for (const reference of references(document.fields)) if (!replacements.has(reference)) blockers.push({code:'REFERENCE_NEEDS_PROJECTION_OR_ADAPTER', path: entry.path, reference});
    for (const dependency of entry.dependencies) if (entries.get(dependency).action !== 'COPY') blockers.push({code:'DEPENDENCY_NEEDS_PROJECTION_OR_ADAPTER', path: entry.path, dependency});
    const fields = rewriteReferences(document.fields, replacements);
    const copied = existing.get(entry.path);
    const fieldSha256 = sha256(canonical(fields));
    const sidecarId = sha256(`${snapshot.projectId}\u0000${snapshot.databaseId}\u0000${entry.path}`);
    const provenance = {...origin, sourceDatabaseId: snapshot.databaseId, destinationProjectId: manifest.destinationProjectId, destinationPath: entry.path, sourceSha256: entry.sourceSha256, destinationFieldsSha256: fieldSha256, originalCreateTime: document.createTime, originalUpdateTime: document.updateTime};
    const provenancePath=`migrationOrigins/${sidecarId}`;
    const provenanceFields=Object.fromEntries(Object.entries(provenance).map(([key,value])=>[key,{stringValue:value}]));
    const copiedProvenance=existing.get(provenancePath);
    const provenanceMatches=copiedProvenance && canonical(copiedProvenance.fields)===canonical(provenanceFields);
    let result=!copied ? 'CREATE_ONLY' : sha256(canonical(copied.fields))!==fieldSha256 ? 'CONFLICT' : provenanceMatches ? 'ALREADY_IDENTICAL' : 'IDENTICAL_WITHOUT_VERIFIED_PROVENANCE';
    if(copiedProvenance && !provenanceMatches) {result='CONFLICT'; blockers.push({code:'DESTINATION_PROVENANCE_CONFLICT',path:entry.path});}
    if(copiedProvenance && !copied) {result='CONFLICT'; blockers.push({code:'ORPHAN_DESTINATION_PROVENANCE',path:entry.path});}
    if (result === 'CONFLICT') blockers.push({code:'DESTINATION_CONFLICT', path: entry.path});
    if (result === 'IDENTICAL_WITHOUT_VERIFIED_PROVENANCE') blockers.push({code:'DESTINATION_PROVENANCE_NOT_PROVEN',path:entry.path});
    // Server createTime/updateTime cannot be copied. Preserve them as provenance;
    // business timestamps inside fields remain unchanged and typed.
    operations.push({path:entry.path, result, operation:result==='CREATE_ONLY'?'CREATE_DOCUMENT_AND_PROVENANCE':result==='ALREADY_IDENTICAL'?'SKIP':'REVIEW', writeRequired:result==='CREATE_ONLY', precondition:{exists:false}, fields:clone(fields), provenancePath, provenanceFields, provenancePrecondition:{exists:false}, provenance});
    audit.push({...provenance, result});
  }
  const result = {schemaVersion:1, mode:'OFFLINE_DRY_RUN', productionAuthorized:false, destinationVerified:Boolean(destinationSnapshot), sourceProjectId:snapshot.projectId, destinationProjectId:manifest.destinationProjectId, backupSha256:manifest.backupSha256, manifestSha256:snapshotDigest(manifest), readyForReview:blockers.length === 0, blockers, operations, audit, counts:{source:snapshot.documents.length, copy:operations.length, keepFa:audit.filter(row=>row.result==='KEEP_FA').length, rebuild:audit.filter(row=>row.result==='REBUILD').length, identical:operations.filter(row=>row.result==='ALREADY_IDENTICAL').length, conflicts:operations.filter(row=>row.result==='CONFLICT').length}, rollback:{sourceChanged:false, strategy:'STOP_FB_WRITERS_RESTORE_FA_ROUTING_AFTER_DRAINING_PENDING_OPERATIONS', deleteSource:false, deleteDestination:false}};
  return {...result, planSha256:snapshotDigest(result)};
}
