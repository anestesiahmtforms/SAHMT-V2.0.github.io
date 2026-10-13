import {snapshotDigest, validateSplitSnapshot} from './management-split-plan.js';

const FA = 'sahmt-17a16';
const demand = (ok, code) => {if (!ok) throw Error(code);};
const canonicalRoots = values => [...values].sort();

/** Planning only: the reviewed snapshot count is historical, never current usage.
 * Every invocation captures at most one quarter and then needs another review.
 */
export function prepareManagementCaptureQuarterPlan({sourceSnapshot, scope} = {}) {
  validateSplitSnapshot(sourceSnapshot);
  demand(sourceSnapshot.projectId === FA && sourceSnapshot.databaseId === '(default)',
    'QUARTER_CAPTURE_SOURCE_PROJECT_INVALID');
  demand(scope?.schemaVersion === 1 && scope.projectId === FA && scope.databaseId === '(default)'
    && Array.isArray(scope.rootCollections) && scope.rootCollections.length > 0
    && new Set(scope.rootCollections).size === scope.rootCollections.length
    && snapshotDigest(canonicalRoots(scope.rootCollections))
      === snapshotDigest(canonicalRoots(sourceSnapshot.coverage.rootCollections)),
    'QUARTER_CAPTURE_SCOPE_MISMATCH');
  const baselineDocumentCount = sourceSnapshot.documents.length;
  demand(Number.isSafeInteger(baselineDocumentCount) && baselineDocumentCount > 0
    && baselineDocumentCount <= 6000, 'QUARTER_CAPTURE_BASELINE_COUNT_INVALID');
  const maxBatchDocuments = Math.ceil(baselineDocumentCount / 4);
  const plan = {
    schemaVersion:1, kind:'MANAGEMENT_FOUR_MANUAL_CAPTURE_BATCHES',
    sourceProjectId:FA, databaseId:'(default)',
    baselineSnapshotSha256:snapshotDigest(sourceSnapshot),
    scopeSha256:snapshotDigest(scope), baselineDocumentCount,
    maxBatchDocuments, maxBatches:4, maxReservedReadsPerBatch:1500,
    documentPageSize:Math.min(25, maxBatchDocuments),
    maxDurationMs:180000, readTimeMaxAgeMs:3600000,
    automaticNextBatch:false, partialSnapshotEligibleForMigration:false,
    currentDocumentCountKnown:false, fourBatchesGuaranteeCompleteCapture:false,
    firestoreReadsIssued:0, firestoreWritesIssued:0
  };
  return Object.freeze({...plan, planSha256:snapshotDigest(plan)});
}

export function validateManagementCaptureQuarterPlan({plan, sourceSnapshot, scope} = {}) {
  const expected = prepareManagementCaptureQuarterPlan({sourceSnapshot, scope});
  demand(snapshotDigest(plan) === snapshotDigest(expected), 'QUARTER_CAPTURE_PLAN_CHANGED');
  return expected;
}

/** No credential or filesystem access. FA full capture is no longer admitted. */
export function parseManagementCaptureCommand(args) {
  demand(Array.isArray(args) && (args.length===2 || args.length===3), 'USE_CAPTURE_QUARTER_OR_REVIEWED_RESUME');
  const [reference,mode,resumeCheckpointName]=args;
  demand(['FA','FB'].includes(reference), 'CAPTURE_PROJECT_ALIAS_INVALID');
  if (reference==='FA' && mode==='--capture') throw Error('FULL_FA_CAPTURE_REPLACED_BY_QUARTER_REVIEW');
  const quarterCapture=mode==='--capture-quarter' || mode==='--resume-quarter';
  demand(['--preflight','--capture','--capture-initial-fb','--capture-quarter','--resume-quarter'].includes(mode),
    'USE_CAPTURE_QUARTER_OR_REVIEWED_RESUME');
  demand(!quarterCapture || reference==='FA','QUARTER_CAPTURE_ALLOWED_ONLY_FOR_FA');
  demand(mode!=='--capture-initial-fb' || reference==='FB','BOOTSTRAP_ALLOWED_ONLY_FOR_FB');
  if (mode==='--resume-quarter') {
    demand(args.length===3 && typeof resumeCheckpointName==='string'
      && /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}-latest\.dpapi\.json$/.test(resumeCheckpointName),
      'QUARTER_CHECKPOINT_NAME_INVALID');
  } else demand(args.length===2,'CAPTURE_ARGUMENTS_INVALID');
  return {reference,mode,quarterCapture,resumeCheckpointName};
}
