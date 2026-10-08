import {createHash} from 'node:crypto';
import {prepareSplitPlan, snapshotDigest, validateSplitSnapshot} from './management-split-plan.js';
import {firestoreQuotaDayStart} from './management-read-budget.js';

const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66';
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const digestPattern = /^[a-f0-9]{64}$/;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const fail = code => { throw new Error(code); };
const assert = (condition, code) => { if (!condition) fail(code); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const freshTime = (value, nowMs, age) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= nowMs && nowMs - Date.parse(value) <= age;
const errorCode = error => /^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message || '') ? error.message : 'MIGRATION_ADAPTER_FAILED';
const pinsKeys = ['planSha256', 'sourceSnapshotSha256', 'manifestSha256', 'destinationSnapshotSha256', 'aclSha256', 'identitySha256'];
const forbidden = new Set(['evaluationRequests', 'evaluationRuntime', 'syncQueue', 'notifications', 'notificationGroups']);

/** Local validation only. Neither an approval nor an adapter is obtained here. */
export function validateManagementMigrationExecution({sourceSnapshot, manifest, destinationSnapshot, plan, approval, nowMs}) {
  assert(count(nowMs), 'MIGRATION_CLOCK_INVALID');
  const regenerated = prepareSplitPlan(sourceSnapshot, manifest, destinationSnapshot);
  assert(plan?.readyForReview === true && plan.destinationVerified === true && Array.isArray(plan.blockers) && plan.blockers.length === 0, 'MIGRATION_PLAN_BLOCKED');
  const {planSha256, ...unsigned} = plan;
  assert(digestPattern.test(planSha256 || '') && snapshotDigest(unsigned) === planSha256 && snapshotDigest(plan) === snapshotDigest(regenerated), 'MIGRATION_PLAN_HASH_MISMATCH');
  assert(plan.sourceProjectId === FA && plan.destinationProjectId === FB, 'MIGRATION_PROJECT_SCOPE_INVALID');
  const pins = {
    planSha256, sourceSnapshotSha256: snapshotDigest(sourceSnapshot),
    manifestSha256: snapshotDigest(manifest), destinationSnapshotSha256: snapshotDigest(destinationSnapshot),
    aclSha256: approval?.pins?.aclSha256, identitySha256: snapshotDigest(manifest.identityMappings)
  };
  assert(approval?.schemaVersion === 1 && approval.authorized === true && approval.purpose === 'MANAGEMENT_MIGRATION_CREATE_ONLY' && identifier(approval.requestId), 'MIGRATION_APPROVAL_REQUIRED');
  assert(approval.sourceProjectId === FA && approval.destinationProjectId === FB && approval.databaseId === '(default)', 'MIGRATION_APPROVAL_SCOPE_MISMATCH');
  assert(freshTime(approval.approvedAt, nowMs, 900000) && Date.parse(approval.expiresAt) > nowMs && Date.parse(approval.expiresAt) - Date.parse(approval.approvedAt) <= 900000, 'MIGRATION_APPROVAL_EXPIRED');
  assert(pinsKeys.every(key => digestPattern.test(pins[key] || '') && approval.pins?.[key] === pins[key]), 'MIGRATION_APPROVAL_PIN_MISMATCH');
  for (const operation of plan.operations) {
    assert(!forbidden.has(operation.path.split('/')[0]), 'MIGRATION_EXECUTABLE_REQUEST_OR_RUNTIME_FORBIDDEN');
    assert(['CREATE_DOCUMENT_AND_PROVENANCE', 'SKIP'].includes(operation.operation) && ['CREATE_ONLY', 'ALREADY_IDENTICAL'].includes(operation.result), 'MIGRATION_OPERATION_FORBIDDEN');
    assert(operation.precondition?.exists === false && operation.provenancePrecondition?.exists === false && Object.keys(operation.precondition).length === 1 && Object.keys(operation.provenancePrecondition).length === 1, 'MIGRATION_CREATE_PRECONDITION_REQUIRED');
  }
  return {pins, sourceProjectId: FA, destinationProjectId: FB, databaseId: '(default)'};
}

function validateFreshContext(context, pins, nowMs) {
  assert(context?.schemaVersion === 1 && context.sourceProjectId === FA && context.destinationProjectId === FB && context.databaseId === '(default)', 'MIGRATION_CONTEXT_SCOPE_MISMATCH');
  assert(freshTime(context.verifiedAt, nowMs, 300000) && Date.parse(context.expiresAt) > nowMs, 'MIGRATION_CONTEXT_STALE');
  assert(pinsKeys.every(key => context.pins?.[key] === pins[key]), 'MIGRATION_CONTEXT_PIN_MISMATCH');
  assert(['manifestVerified', 'aclVerified', 'identityVerified', 'sourceSnapshotVerified', 'destinationSnapshotVerified', 'sourceStillMatchesBackup'].every(key => context[key] === true), 'MIGRATION_CONTEXT_UNVERIFIED');
  assert(context.firestoreReadsIssued === 0, 'MIGRATION_CONTEXT_ADAPTER_MUST_NOT_READ');
  assert(context.destinationWriterState === 'STOPPED' && context.destinationClientAccess === 'DISABLED' && context.destinationNativeTriggersAbsent === true, 'MIGRATION_DESTINATION_NOT_ISOLATED');
}

/** This proof is local and conservative. It never certifies a global exact cutoff. */
function validateBudgetProof(proof, nowMs, maximumReads) {
  assert(proof?.schemaVersion === 1 && proof.projectId === FB && proof.authorizedPurpose === 'MANAGEMENT_MIGRATION_CREATE_ONLY' && proof.allowed === true, 'MIGRATION_BUDGET_PROOF_REQUIRED');
  assert(proof.pausedRequiresReview === false && proof.renewalClearsPause === false && proof.dailyReadLimit === 35000 && proof.quotaTimeZone === 'America/Los_Angeles', 'MIGRATION_BUDGET_PAUSED_OR_INVALID');
  const quotaDayStart = firestoreQuotaDayStart(nowMs);
  assert(proof.quotaDayStart === quotaDayStart && proof.reservationQuotaDayStart === quotaDayStart && Date.parse(proof.humanDecisionAt) >= Date.parse(quotaDayStart) && Date.parse(proof.humanDecisionAt) <= nowMs, 'MIGRATION_BUDGET_DAY_REVIEW_REQUIRED');
  assert(proof.metric === 'firestore.googleapis.com/document/read_ops_count' && proof.complete === true && proof.fresh === true && freshTime(proof.verifiedAt, nowMs, 300000) && freshTime(proof.latestPoint, nowMs, 300000) && Date.parse(proof.latestPoint) <= Date.parse(proof.verifiedAt) && Date.parse(proof.latestPoint) >= Date.parse(quotaDayStart), 'MIGRATION_BUDGET_STALE_OR_INCOMPLETE');
  assert([proof.reads, proof.reservedReads, proof.appTrafficReserve, proof.metricLagReserve, proof.maximumReads].every(count) && proof.maximumReads >= maximumReads && proof.reservedReads >= maximumReads && proof.appTrafficReserve >= 5000 && proof.metricLagReserve >= 2000 && identifier(proof.reservationId), 'MIGRATION_BUDGET_RESERVATION_INVALID');
  const total = proof.reads + proof.reservedReads + proof.appTrafficReserve + proof.metricLagReserve;
  assert(count(total) && total < proof.dailyReadLimit && proof.localReservationOnly === true && proof.exactGlobalCutoff === false, 'MIGRATION_BUDGET_MARGIN_UNRELIABLE');
  return {reservationId: proof.reservationId, estimatedWithMargin: total};
}

function orderOperations(plan, manifest) {
  const operations = new Map(plan.operations.map(operation => [operation.path, operation]));
  const entries = new Map(manifest.entries.map(entry => [entry.path, entry]));
  const single = {managementAreaId:'managementAreas', managerAreaId:'managementAreas', areaId:'managementAreas', indicatorId:'indicators', planId:'actionPlans', equipmentId:'equipment', assignmentId:'evaluationAssignments', awardId:'evaluationAwards', participationId:'evaluationParticipations', revisionId:'evaluationGovernanceRevisions', trainingId:'trainings'};
  const relations = fields => {
    const result = new Set();
    const visit = value => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== 'object') return;
      if (typeof value.referenceValue === 'string') {
        const prefix = 'projects/' + FB + '/databases/(default)/documents/';
        if (value.referenceValue.startsWith(prefix)) result.add(value.referenceValue.slice(prefix.length));
      }
      for (const [key, item] of Object.entries(value)) {
        if (single[key] && item?.stringValue) result.add(single[key] + '/' + item.stringValue);
        if (key === 'areaIds') for (const id of item.arrayValue?.values || []) if (id.stringValue) result.add('managementAreas/' + id.stringValue);
        if (key === 'activityId' && item?.stringValue) for (const collection of ['activities', 'evaluationActivities']) if (operations.has(collection + '/' + item.stringValue)) result.add(collection + '/' + item.stringValue);
        visit(item);
      }
      if (value.sourceCollection?.stringValue && value.sourceId?.stringValue) result.add(value.sourceCollection.stringValue + '/' + value.sourceId.stringValue);
    };
    visit(fields); return result;
  };
  const visiting = new Set(), visited = new Set(), result = [];
  const visit = path => {
    if (visited.has(path)) return;
    assert(!visiting.has(path), 'MIGRATION_DEPENDENCY_CYCLE_REQUIRES_BATCH');
    visiting.add(path);
    const deps = new Set([...(entries.get(path)?.dependencies || []), ...relations(operations.get(path).fields)]);
    for (const dependency of [...deps].sort()) {
      assert(operations.has(dependency), 'MIGRATION_DEPENDENCY_OUTSIDE_PLAN');
      visit(dependency);
    }
    visiting.delete(path); visited.add(path); result.push(operations.get(path));
  };
  for (const path of [...operations.keys()].sort()) visit(path);
  return result;
}

function validatePair(pair, operation, nowMs) {
  assert(pair && freshTime(pair.readTime, nowMs, 300000) && pair.consistent === true && Object.hasOwn(pair, 'document') && Object.hasOwn(pair, 'provenance'), 'MIGRATION_DESTINATION_READ_UNVERIFIED');
  assert(pair.document === null || pair.document.path === operation.path, 'MIGRATION_DESTINATION_PATH_MISMATCH');
  assert(pair.provenance === null || pair.provenance.path === operation.provenancePath, 'MIGRATION_DESTINATION_PATH_MISMATCH');
  const documents = [pair.document, pair.provenance].filter(Boolean);
  validateSplitSnapshot({schemaVersion:1, projectId:FB, databaseId:'(default)', readTime:pair.readTime, coverage:{complete:true, consistent:true, rootCollections:[operation.path.split('/')[0], 'migrationOrigins']}, documents});
  if (!pair.document && !pair.provenance) {
    assert(operation.operation !== 'SKIP', 'MIGRATION_DESTINATION_CHANGED_SINCE_PLAN');
    return 'CREATE';
  }
  assert(pair.document && pair.provenance, 'MIGRATION_DESTINATION_PARTIAL_PAIR_CONFLICT');
  assert(snapshotDigest(pair.document.fields) === operation.provenance.destinationFieldsSha256 && snapshotDigest(pair.provenance.fields) === snapshotDigest(operation.provenanceFields), 'MIGRATION_DESTINATION_DATA_OR_PROVENANCE_CONFLICT');
  return 'SKIP';
}

function validateCommit(result, operation, nowMs) {
  assert(result?.atomic === true && result.committed === true && freshTime(result.commitTime, nowMs, 300000), 'MIGRATION_COMMIT_UNVERIFIED');
  assert(Array.isArray(result.writeResults) && result.writeResults.length === 2, 'MIGRATION_COMMIT_UNVERIFIED');
  const paths = new Set(result.writeResults.map(write => write.path));
  assert(paths.size === 2 && paths.has(operation.path) && paths.has(operation.provenancePath) && result.writeResults.every(write => Number.isFinite(Date.parse(write.updateTime)) && Date.parse(write.updateTime) <= Date.parse(result.commitTime)), 'MIGRATION_COMMIT_UNVERIFIED');
}

/**
 * Sequential, injected execution. This module has no credentials, filesystem,
 * production CLI, Firebase client, networking, deletion or retry loop.
 */
export async function executeManagementMigration({
  sourceSnapshot, manifest, destinationSnapshot, plan, approval,
  adapters, now = Date.now, signal,
  limits = {}
}) {
  sourceSnapshot = copy(sourceSnapshot); manifest = copy(manifest); destinationSnapshot = copy(destinationSnapshot); plan = copy(plan); approval = copy(approval);
  const nowMs = now();
  const validated = validateManagementMigrationExecution({sourceSnapshot, manifest, destinationSnapshot, plan, approval, nowMs});
  for (const name of ['freshContext', 'reserveReadBudget', 'pauseReadBudget', 'readDestinationPair', 'commitCreatePair', 'checkpoint']) assert(typeof adapters?.[name] === 'function', 'MIGRATION_ADAPTER_REQUIRED');
  const maximumUnits = limits.maximumUnits ?? 100, maximumDurationMs = limits.maximumDurationMs ?? 180000, adapterTimeoutMs = limits.adapterTimeoutMs ?? 20000;
  const readReservation = limits.readReservation ?? 2, commitReservation = limits.commitReservation ?? 2;
  assert([maximumUnits, maximumDurationMs, adapterTimeoutMs, readReservation, commitReservation].every(value => Number.isSafeInteger(value) && value > 0) && maximumUnits <= 1000 && maximumDurationMs <= 300000 && adapterTimeoutMs <= 30000 && readReservation >= 2 && commitReservation >= 2, 'MIGRATION_LIMITS_INVALID');
  const operations = orderOperations(plan, manifest);
  assert(operations.length <= maximumUnits, 'MIGRATION_UNIT_LIMIT_REQUIRES_REVIEW');
  const runId = hash(approval.requestId + '\u0000' + validated.pins.planSha256);
  const receipts = [], completedPaths = [], reservations = new Set();
  let phase = 'START', currentPath = null, commitAttempted = false, currentCommitted = false, lastReservedReads = 0;
  const deadline = Math.min(nowMs + maximumDurationMs, Date.parse(approval.expiresAt));
  const clock = () => {
    const value = now();
    assert(count(value) && value >= nowMs, 'MIGRATION_CLOCK_INVALID');
    assert(!signal?.aborted, 'MIGRATION_ABORTED');
    assert(value < deadline, 'MIGRATION_DEADLINE_EXCEEDED');
    return value;
  };
  const call = async (name, payload, recovery = false) => {
    if (recovery) assert(['pauseReadBudget', 'checkpoint'].includes(name), 'MIGRATION_RECOVERY_ADAPTER_FORBIDDEN'); else clock();
    const controller = new AbortController();
    const parentAbort = () => controller.abort(); if (!recovery) signal?.addEventListener('abort', parentAbort, {once:true});
    let timer, abortListener;
    try {
      return await Promise.race([
        Promise.resolve().then(() => { assert(!controller.signal.aborted, 'MIGRATION_ABORTED'); return adapters[name](copy(payload), {signal:controller.signal}); }),
        new Promise((_, reject) => {
          timer = setTimeout(() => { reject(new Error('MIGRATION_ADAPTER_TIMEOUT')); controller.abort(); }, recovery ? adapterTimeoutMs : Math.min(adapterTimeoutMs, Math.max(1, deadline - now())));
          abortListener = () => reject(new Error('MIGRATION_ABORTED'));
          controller.signal.addEventListener('abort', abortListener, {once:true});
        })
      ]);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', parentAbort);
      controller.signal.removeEventListener('abort', abortListener);
    }
  };
  const base = {runId, approvalRequestId:approval.requestId, ...validated};
  const receipt = (operation, status, extra = {}) => ({
    path:operation.path, provenancePath:operation.provenancePath,
    operationId:hash(validated.pins.planSha256 + '\u0000' + operation.path),
    sourceSha256:operation.provenance.sourceSha256, destinationFieldsSha256:operation.provenance.destinationFieldsSha256,
    status, ...extra
  });
  const persist = async state => {
    const ack = await call('checkpoint', {schemaVersion:1, ...base, state, completedPaths:[...completedPaths], receipts:copy(receipts)}, state === 'INCOMPLETE');
    assert(ack?.persisted === true && ack.runId === runId && ack.state === state, 'MIGRATION_CHECKPOINT_NOT_PERSISTED');
  };
  const guard = async (operation, stage, maximumReads) => {
    phase = stage + '_BUDGET';
    const proof = await call('reserveReadBudget', {...base, projectId:FB, path:operation.path, stage, maximumReads});
    const budget = validateBudgetProof(proof, clock(), maximumReads);
    assert(!reservations.has(budget.reservationId), 'MIGRATION_BUDGET_RESERVATION_REUSED');
    assert(proof.reservedReads >= lastReservedReads + maximumReads, 'MIGRATION_BUDGET_RESERVATION_NOT_CUMULATIVE');
    lastReservedReads = proof.reservedReads;
    reservations.add(budget.reservationId);
    phase = stage + '_CONTEXT';
    const context = await call('freshContext', {...base, path:operation.path, stage});
    validateFreshContext(context, validated.pins, clock());
    validateBudgetProof(proof, clock(), maximumReads);
    return {...budget, context, proof, maximumReads};
  };
  try {
    await persist('STARTED');
    for (const operation of operations) {
      currentPath = operation.path; commitAttempted = false; currentCommitted = false;
      const readBudget = await guard(operation, 'READ_PAIR', readReservation);
      phase = 'READ_PAIR';
      const pair = await call('readDestinationPair', {...base, projectId:FB, path:operation.path, provenancePath:operation.provenancePath, maximumReads:readReservation, reservationId:readBudget.reservationId});
      const action = validatePair(pair, operation, clock());
      if (action === 'SKIP') {
        receipts.push(receipt(operation, 'SKIPPED_VERIFIED_IDENTICAL'));
        completedPaths.push(operation.path); phase = 'CHECKPOINT_SKIPPED'; await persist('PROGRESS'); continue;
      }
      const commitBudget = await guard(operation, 'COMMIT_PAIR', commitReservation);
      const intent = receipt(operation, 'CREATE_PAIR_INTENT', {reservationId:commitBudget.reservationId});
      receipts.push(intent); phase = 'CHECKPOINT_INTENT'; await persist('BEFORE_COMMIT');
      const documentBase = 'projects/' + FB + '/databases/(default)/documents/';
      const writes = [
        {update:{name:documentBase + operation.path, fields:copy(operation.fields)}, currentDocument:{exists:false}},
        {update:{name:documentBase + operation.provenancePath, fields:copy(operation.provenanceFields)}, currentDocument:{exists:false}}
      ];
      validateFreshContext(commitBudget.context, validated.pins, clock());
      validateBudgetProof(commitBudget.proof, clock(), commitBudget.maximumReads);
      phase = 'COMMIT_PAIR'; commitAttempted = true;
      const result = await call('commitCreatePair', {...base, projectId:FB, operationId:intent.operationId, reservationId:commitBudget.reservationId, writes});
      validateCommit(result, operation, clock()); currentCommitted = true;
      receipts[receipts.length - 1] = receipt(operation, 'COMMITTED_PAIR', {commitTime:result.commitTime});
      completedPaths.push(operation.path); phase = 'CHECKPOINT_COMMITTED'; await persist('PROGRESS');
    }
    currentPath = null; commitAttempted = false; currentCommitted = false;
    phase = 'CHECKPOINT_COMPLETE'; await persist('COMPLETE');
    return {schemaVersion:1, status:'COMPLETE', ...base, receipts, completedPaths, sourceChanged:false, sourceDeleted:false, rebuildExecuted:false, runtimeActivated:false, triggersExecuted:false, exactGlobalReadCutoff:false};
  } catch (error) {
    const code = errorCode(error);
    const uncertain = commitAttempted && !currentCommitted;
    const status = uncertain ? 'UNKNOWN_COMMIT_OUTCOME' : currentCommitted ? 'COMMITTED_CHECKPOINT_INCOMPLETE' : 'STOPPED';
    const operation = operations.find(item => item.path === currentPath);
    if (operation && !receipts.some(item => item.path === currentPath && item.status.startsWith('COMMITTED'))) {
      const item = receipt(operation, status, {code, phase});
      const index = receipts.findIndex(row => row.path === currentPath && row.status === 'CREATE_PAIR_INTENT');
      if (index >= 0) receipts[index] = item; else receipts.push(item);
    }
    let readPausePersisted = false;
    if (code.startsWith('MIGRATION_BUDGET_')) {
      try {
        const pause = await call('pauseReadBudget', {schemaVersion:1, ...base, projectId:FB, reason:code, pausedRequiresReview:true, renewalClearsPause:false}, true);
        readPausePersisted = pause?.persisted === true && pause.projectId === FB && pause.pausedRequiresReview === true && pause.renewalClearsPause === false;
      } catch { /* A failed latch leaves the run blocked; no subsequent unit is attempted. */ }
    }
    let checkpointPersisted = false;
    try { await persist('INCOMPLETE'); checkpointPersisted = true; } catch { /* The in-memory receipt still reports the durable checkpoint failure. */ }
    return {schemaVersion:1, status, ...base, code, phase, currentPath, receipts, completedPaths, checkpointPersisted, readPausePersisted, sourceChanged:false, sourceDeleted:false, rebuildExecuted:false, runtimeActivated:false, triggersExecuted:false, exactGlobalReadCutoff:false, requiresFreshReviewBeforeResume:true, pendingLocalActionsPreserved:true};
  }
}
