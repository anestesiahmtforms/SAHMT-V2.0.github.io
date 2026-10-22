import {createHash} from 'node:crypto';

export const IDENTITY_PROJECT = 'sahmt-17a16';
export const MANAGEMENT_PROJECT = 'sahmt-gestao-5ae66';
export const INDEPENDENT_FB_COLLECTIONS = Object.freeze([
  'managementAreas', 'activities', 'activityInteractions', 'activityScoreReviews',
  'indicators', 'indicatorMeasurements', 'actionPlans', 'actionPlanItems',
  'documents', 'scopedDocuments', 'documentAccessEmails', 'equipment', 'equipmentEvents',
  'maintenanceRecords', 'scoringRules', 'scores', 'learningActivities', 'learningActivityReceipts',
  'trainings', 'trainingProgress', 'trainingReceipts', 'trainingCompletions',
  'documentReadingReceipts', 'evaluationActivities', 'evaluationFormConfigs', 'evaluationLinks',
  'evaluationParticipations', 'evaluationTrainingAttempts', 'evaluationAssignments',
  'evaluationAssignmentHistory', 'evaluationGovernanceRevisions', 'evaluationRequests',
  'evaluationAwards', 'evaluationLedger', 'evaluationSummaries', 'evaluationReference',
  'evaluationChecklistTransfers', 'evaluationSourceReceipts', 'evaluationLegacyScoreOutbox',
  'evaluationRuntime'
]);
export const EXCLUDED_FB_CONFIGURATION = Object.freeze([
  'managementAuthorizationLeases', 'managementAuthorizationFences', 'managementRuntime',
  'migrationOrigins', 'trainingTemplateMigrations', 'evaluationHomologationInputs'
]);
export function canonicalMigrationValue(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalMigrationValue).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonicalMigrationValue(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const independentMigrationHash = value => createHash('sha256').update(canonicalMigrationValue(value)).digest('hex');
const demand = (condition, code) => { if (!condition) throw Error(code); };

/** Pure plan: copies business data only. No OAuth, broker, lease, secret, delete or deployment. */
export function prepareIndependentFbMigration(source, destination) {
  demand(source?.projectId === IDENTITY_PROJECT && destination?.projectId === MANAGEMENT_PROJECT,
    'INDEPENDENT_MIGRATION_PROJECT_INVALID');
  demand(Array.isArray(source.documents) && Array.isArray(destination.documents), 'INDEPENDENT_MIGRATION_SNAPSHOT_INVALID');
  const allowed = new Set(INDEPENDENT_FB_COLLECTIONS);
  const sourcePaths = new Set(source.documents.map(row => row.path));
  const destinationRows = new Map(destination.documents.map(row => [row.path, row]));
  const excluded = [], operations = [], conflicts = [];
  const sourcePrefix = `projects/${IDENTITY_PROJECT}/databases/(default)/documents/`;
  const destinationPrefix = `projects/${MANAGEMENT_PROJECT}/databases/(default)/documents/`;
  const rewrite = value => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key === 'referenceValue' && typeof item === 'string' && item.startsWith(sourcePrefix)) {
        const path = item.slice(sourcePrefix.length), root = path.split('/')[0];
        // QMENTUM and operational references intentionally retain FA as authority.
        if (sourcePaths.has(path) && (allowed.has(root) || root === 'users')) return [key, destinationPrefix + path];
      }
      return [key, rewrite(item)];
    }));
  };
  for (const row of source.documents) {
    const root = row.path?.split('/')[0];
    demand(typeof row.path === 'string' && row.path.split('/').length % 2 === 0 && row.updateTime,
      'INDEPENDENT_MIGRATION_DOCUMENT_INVALID');
    if (!allowed.has(root) || root === 'evaluationRuntime' && row.path !== 'evaluationRuntime/state') {
      excluded.push(row.path); continue;
    }
    const fields = rewrite(row.fields || {}), existing = destinationRows.get(row.path);
    if (existing && independentMigrationHash(existing.fields || {}) !== independentMigrationHash(fields)) {
      conflicts.push(row.path); continue;
    }
    operations.push({path:row.path, action:existing ? 'EQUIVALENT' : 'CREATE', sourceUpdateTime:row.updateTime,
      sourceFieldsSha256:independentMigrationHash(row.fields || {}), fieldsSha256:independentMigrationHash(fields), fields});
  }
  return {schemaVersion:1, sourceProjectId:IDENTITY_PROJECT, destinationProjectId:MANAGEMENT_PROJECT,
    authentication:'INDEPENDENT_GOOGLE', brokerEnabled:false, qmentumProjectId:IDENTITY_PROJECT,
    sourceDeletionEnabled:false, protectedRoots:['users'], operations, excluded, conflicts,
    ready:conflicts.length === 0, counts:{create:operations.filter(row=>row.action==='CREATE').length,
      equivalent:operations.filter(row=>row.action==='EQUIVALENT').length, excluded:excluded.length, conflicts:conflicts.length}};
}
