import {snapshotDigest} from './management-split-plan.js';
import {firestoreQuotaDayStart} from './management-read-budget.js';

const FB = 'sahmt-gestao-5ae66';
const MODE = 'USER_AUTHORIZED_BOUNDED_FB_MIGRATION';
const PURPOSE = 'MANAGEMENT_MIGRATION_CREATE_ONLY';
const PINS = ['planSha256', 'sourceSnapshotSha256', 'manifestSha256', 'destinationSnapshotSha256', 'aclSha256', 'identitySha256'];
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_DURATION = 300000, MAX_AUTHORIZATION = 900000, MAX_RESERVATIONS = 10000;
const forbidden = new Set(['evaluationRequests', 'evaluationRuntime', 'syncQueue', 'notifications', 'notificationGroups']);
const count = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = value => JSON.parse(JSON.stringify(value));
const check = (value, code) => { if (!value) throw new Error('MIGRATION_BUDGET_' + code); };
const id = value => typeof value === 'string' && ID.test(value);
const pathValue = value => typeof value === 'string' && value.length <= 6000
  && value.split('/').length >= 2 && value.split('/').length % 2 === 0
  && value.split('/').every(part => part && !['.', '..', '*'].includes(part) && !/[\x00-\x1f\\]/.test(part))
  && !forbidden.has(value.split('/')[0]);
const time = value => {
  check(typeof value === 'string', 'TIME_INVALID');
  const parsed = Date.parse(value);
  check(count(parsed) && new Date(parsed).toISOString() === value, 'TIME_INVALID');
  return parsed;
};
const iso = value => new Date(value).toISOString();
const pinsValue = value => plain(value) && Object.keys(value).length === PINS.length
  && PINS.every(key => typeof value[key] === 'string' && SHA.test(value[key]));
const samePins = (left, right) => pinsValue(left) && pinsValue(right)
  && PINS.every(key => left[key] === right[key]);

function validateScope(scope) {
  check(plain(scope) && scope.schemaVersion === 1 && scope.projectId === FB
    && scope.databaseId === '(default)' && typeof scope.runId === 'string' && SHA.test(scope.runId)
    && pinsValue(scope.pins) && Array.isArray(scope.unitPaths) && scope.unitPaths.length > 0
    && scope.unitPaths.length <= 1000 && scope.unitPaths.every(pathValue)
    && new Set(scope.unitPaths).size === scope.unitPaths.length, 'DESTINATION_SCOPE_INVALID');
  return snapshotDigest({schemaVersion: 1, projectId: FB, databaseId: '(default)',
    runId: scope.runId, pins: scope.pins, unitPaths: [...scope.unitPaths].sort()});
}

/** Digest for the caller's atomic, protected persistence acknowledgement. */
export function fbMigrationDestinationPolicySha256(policy) {
  check(plain(policy), 'DESTINATION_POLICY_INVALID');
  return snapshotDigest(policy);
}

function validatePolicy({projectId, scope, policy, nowMs, requireActive = true}) {
  check(projectId === FB && count(nowMs), 'DESTINATION_PROJECT_OR_CLOCK_INVALID');
  const scopeSha256 = validateScope(scope);
  check(plain(policy) && policy.schemaVersion === 1 && policy.mode === MODE && policy.projectId === FB
    && policy.databaseId === '(default)' && policy.authorizedPurpose === PURPOSE
    && policy.authorizationSource === 'EXPLICIT_HUMAN_CONTINUE_FB' && id(policy.authorizationId)
    && policy.runId === scope.runId && samePins(policy.pins, scope.pins)
    && policy.scopeSha256 === scopeSha256 && policy.maximumUnits === scope.unitPaths.length
    && policy.totalUsageKnown === false && policy.measuredTotalReads === null && policy.dailyReadLimit === null
    && policy.exactGlobalCutoff === false && policy.localReservationOnly === true
    && policy.renewalClearsPause === false && policy.quotaTimeZone === 'America/Los_Angeles',
  'DESTINATION_POLICY_INVALID');
  const approved = time(policy.humanDecisionAt), start = time(policy.startedAt);
  const authorizedUntil = time(policy.authorizedUntil), deadline = time(policy.deadlineAt);
  check(approved <= start && start <= nowMs && authorizedUntil > start
    && authorizedUntil - approved <= MAX_AUTHORIZATION && start - approved <= MAX_AUTHORIZATION
    && count(policy.maximumDurationMs) && policy.maximumDurationMs > 0 && policy.maximumDurationMs <= MAX_DURATION
    && deadline === Math.min(authorizedUntil, start + policy.maximumDurationMs)
    && policy.quotaDayStart === firestoreQuotaDayStart(start), 'DESTINATION_AUTHORIZATION_INVALID');
  check(count(policy.readPairMaximumReads) && policy.readPairMaximumReads >= 2 && policy.readPairMaximumReads <= 32
    && count(policy.commitPairMaximumReads) && policy.commitPairMaximumReads >= 2 && policy.commitPairMaximumReads <= 32
    && count(policy.maximumPostcheckReads) && policy.maximumPostcheckReads <= policy.maximumUnits * 4
    && count(policy.maximumReservedReads) && policy.maximumReservedReads > 0
    && policy.maximumReservedReads <= MAX_RESERVATIONS
    && policy.maximumReservedReads === policy.maximumUnits * (policy.readPairMaximumReads + policy.commitPairMaximumReads)
      + policy.maximumPostcheckReads, 'DESTINATION_BOUND_INVALID');
  check(typeof policy.pausedRequiresReview === 'boolean' && typeof policy.pauseReason === 'string'
    && ['AUTHORIZED', 'RESERVATION_PENDING', 'IN_PROGRESS', 'COMPLETE', 'INCOMPLETE', 'PAUSED'].includes(policy.status)
    && count(policy.reservedReads) && policy.reservedReads <= policy.maximumReservedReads
    && count(policy.reservationAttempts) && count(policy.confirmedReservations)
    && Array.isArray(policy.reservations) && policy.reservations.length === policy.reservationAttempts
    && policy.reservations.length <= policy.maximumUnits * 6, 'DESTINATION_RESERVATION_STATE_INVALID');
  let sum = 0, confirmed = 0, postcheckReads = 0;
  const ids = new Set(), unitStages = new Set(), postchecks = new Map();
  for (const [index, entry] of policy.reservations.entries()) {
    check(plain(entry) && id(entry.reservationId) && !ids.has(entry.reservationId)
      && entry.attempt === index + 1 && scope.unitPaths.includes(entry.path)
      && ['READ_PAIR', 'COMMIT_PAIR', 'POSTCHECK'].includes(entry.stage)
      && count(entry.maximumReads) && entry.maximumReads > 0
      && typeof entry.persisted === 'boolean' && time(entry.reservedAt) >= start
      && time(entry.reservedAt) <= nowMs, 'DESTINATION_RESERVATION_STATE_INVALID');
    ids.add(entry.reservationId); sum += entry.maximumReads;
    if (entry.persisted) confirmed++;
    else check(index === policy.reservations.length - 1, 'DESTINATION_RESERVATION_STATE_INVALID');
    if (entry.stage === 'POSTCHECK') {
      postcheckReads += entry.maximumReads;
      postchecks.set(entry.path, (postchecks.get(entry.path) || 0) + entry.maximumReads);
      check(postchecks.get(entry.path) <= 4, 'DESTINATION_POSTCHECK_BOUND_EXCEEDED');
    } else {
      const key = entry.path + '\u0000' + entry.stage;
      check(!unitStages.has(key) && entry.maximumReads === (entry.stage === 'READ_PAIR'
        ? policy.readPairMaximumReads : policy.commitPairMaximumReads), 'DESTINATION_RESERVATION_STATE_INVALID');
      if (entry.stage === 'COMMIT_PAIR') check(unitStages.has(entry.path + '\u0000READ_PAIR'),
        'DESTINATION_READ_RESERVATION_REQUIRED');
      unitStages.add(key);
    }
  }
  check(sum === policy.reservedReads && confirmed === policy.confirmedReservations
    && postcheckReads <= policy.maximumPostcheckReads, 'DESTINATION_RESERVATION_STATE_INVALID');
  if (policy.status === 'RESERVATION_PENDING') check(policy.reservations.length > 0
    && confirmed === policy.reservations.length - 1 && policy.pendingReservationId === policy.reservations.at(-1).reservationId,
  'DESTINATION_RESERVATION_STATE_INVALID');
  else check(confirmed === policy.reservations.length && policy.pendingReservationId === null,
    'DESTINATION_RESERVATION_STATE_INVALID');
  if (['COMPLETE', 'INCOMPLETE', 'PAUSED'].includes(policy.status)) check(policy.pausedRequiresReview === true,
    'DESTINATION_RESERVATION_STATE_INVALID');
  if (requireActive) {
    check(policy.pausedRequiresReview === false && ['AUTHORIZED', 'RESERVATION_PENDING', 'IN_PROGRESS'].includes(policy.status),
      'DESTINATION_PAUSED_REQUIRES_REVIEW');
    check(firestoreQuotaDayStart(nowMs) === policy.quotaDayStart && nowMs < deadline,
      'DESTINATION_DEADLINE_OR_DAY_EXPIRED');
  }
  return {scopeSha256, start, deadline};
}

/** Explicit bounded FB migration authorization. It never observes total usage,
 * clears an existing policy, authorizes FA, or enables a training/runtime path.
 * The caller may create this only in a new protected run record; existing latches
 * must be read and preserved rather than replaced with this initial state.
 */
export function createFbMigrationDestinationBudget({projectId, scope, authorization, nowMs} = {}) {
  check(projectId === FB && count(nowMs), 'DESTINATION_PROJECT_OR_CLOCK_INVALID');
  const scopeSha256 = validateScope(scope);
  check(plain(authorization) && authorization.schemaVersion === 1 && authorization.authorized === true
    && authorization.projectId === FB && authorization.databaseId === '(default)'
    && authorization.purpose === PURPOSE && authorization.authorizationSource === 'EXPLICIT_HUMAN_CONTINUE_FB'
    && id(authorization.authorizationId), 'DESTINATION_EXPLICIT_AUTHORIZATION_REQUIRED');
  const approved = time(authorization.approvedAt), expiry = time(authorization.expiresAt);
  check(count(authorization.maximumDurationMs) && authorization.maximumDurationMs > 0
    && authorization.maximumDurationMs <= MAX_DURATION, 'DESTINATION_BOUND_INVALID');
  const policy = {
    schemaVersion: 1, mode: MODE, projectId: FB, databaseId: '(default)', authorizedPurpose: PURPOSE,
    authorizationSource: authorization.authorizationSource, authorizationId: authorization.authorizationId,
    runId: scope.runId, pins: copy(scope.pins), scopeSha256, maximumUnits: scope.unitPaths.length,
    humanDecisionAt: iso(approved), authorizedUntil: iso(expiry), startedAt: iso(nowMs),
    maximumDurationMs: authorization.maximumDurationMs,
    deadlineAt: iso(Math.min(expiry, nowMs + authorization.maximumDurationMs)),
    quotaDayStart: firestoreQuotaDayStart(nowMs), quotaTimeZone: 'America/Los_Angeles',
    readPairMaximumReads: authorization.readPairMaximumReads,
    commitPairMaximumReads: authorization.commitPairMaximumReads,
    maximumPostcheckReads: authorization.maximumPostcheckReads,
    maximumReservedReads: authorization.maximumReservedReads,
    reservedReads: 0, reservationAttempts: 0, confirmedReservations: 0, reservations: [],
    pendingReservationId: null, status: 'AUTHORIZED', pausedRequiresReview: false, pauseReason: '',
    totalUsageKnown: false, measuredTotalReads: null, dailyReadLimit: null, exactGlobalCutoff: false,
    localReservationOnly: true, renewalClearsPause: false
  };
  validatePolicy({projectId, scope, policy, nowMs});
  return policy;
}

/** Pure admission only. Atomically persist nextPolicy under the FB run lock,
 * then acknowledge that digest and persist the confirmation BEFORE transport.
 * An uncertain/failed transport never releases this reservation.
 */
export function assessFbMigrationDestinationBudget({projectId, scope, policy, nowMs, reservation = null} = {}) {
  const {scopeSha256} = validatePolicy({projectId, scope, policy, nowMs});
  check(policy.status !== 'RESERVATION_PENDING', 'DESTINATION_RESERVATION_PENDING');
  if (reservation === null) return {
    allowed: true, mode: MODE, projectId: FB, runId: scope.runId, scopeSha256,
    reservedReads: policy.reservedReads, remainingLocalReservations: policy.maximumReservedReads - policy.reservedReads,
    totalUsageKnown: false, measuredTotalReads: null, exactGlobalCutoff: false, localReservationOnly: true
  };
  check(plain(reservation) && reservation.projectId === FB && reservation.databaseId === '(default)'
    && reservation.runId === scope.runId && samePins(reservation.pins, scope.pins)
    && scope.unitPaths.includes(reservation.path) && ['READ_PAIR', 'COMMIT_PAIR', 'POSTCHECK'].includes(reservation.stage)
    && count(reservation.maximumReads) && reservation.maximumReads > 0 && id(reservation.reservationId),
  'DESTINATION_RESERVATION_INVALID');
  check(!policy.reservations.some(entry => entry.reservationId === reservation.reservationId),
    'DESTINATION_RESERVATION_REUSED');
  if (reservation.stage === 'POSTCHECK') {
    const prior = policy.reservations.filter(entry => entry.stage === 'POSTCHECK');
    check(prior.reduce((sum, entry) => sum + entry.maximumReads, 0) + reservation.maximumReads <= policy.maximumPostcheckReads
      && prior.filter(entry => entry.path === reservation.path).reduce((sum, entry) => sum + entry.maximumReads, 0)
        + reservation.maximumReads <= 4, 'DESTINATION_POSTCHECK_BOUND_EXCEEDED');
  } else {
    check(reservation.maximumReads === (reservation.stage === 'READ_PAIR'
      ? policy.readPairMaximumReads : policy.commitPairMaximumReads), 'DESTINATION_UNIT_BOUND_INVALID');
    check(!policy.reservations.some(entry => entry.path === reservation.path && entry.stage === reservation.stage),
      'DESTINATION_UNIT_STAGE_REUSED');
    if (reservation.stage === 'COMMIT_PAIR') check(policy.reservations.some(entry => entry.path === reservation.path
      && entry.stage === 'READ_PAIR' && entry.persisted === true), 'DESTINATION_READ_RESERVATION_REQUIRED');
  }
  check(policy.reservedReads + reservation.maximumReads <= policy.maximumReservedReads, 'DESTINATION_BOUND_EXHAUSTED');
  const entry = {reservationId: reservation.reservationId, attempt: policy.reservationAttempts + 1,
    path: reservation.path, stage: reservation.stage, maximumReads: reservation.maximumReads,
    reservedAt: iso(nowMs), persisted: false};
  const nextPolicy = {...copy(policy), status: 'RESERVATION_PENDING', reservedReads: policy.reservedReads + entry.maximumReads,
    reservationAttempts: entry.attempt, pendingReservationId: entry.reservationId, reservations: [...copy(policy.reservations), entry]};
  validatePolicy({projectId, scope, policy: nextPolicy, nowMs});
  return {allowed: true, nextPolicy, policySha256: fbMigrationDestinationPolicySha256(nextPolicy)};
}

function proofValue(policy, entry, nowMs) {
  return {
    schemaVersion: 1, mode: MODE, projectId: FB, databaseId: '(default)', authorizedPurpose: PURPOSE,
    authorizationSource: policy.authorizationSource, authorizationId: policy.authorizationId,
    allowed: true, reservationPersisted: true, pausedRequiresReview: false, renewalClearsPause: false,
    runId: policy.runId, pins: copy(policy.pins), scopeSha256: policy.scopeSha256,
    path: entry.path, stage: entry.stage, reservationId: entry.reservationId, maximumReads: entry.maximumReads,
    reservedReads: policy.reservedReads, maximumReservedReads: policy.maximumReservedReads,
    remainingLocalReservations: policy.maximumReservedReads - policy.reservedReads,
    maximumUnits: policy.maximumUnits, readPairMaximumReads: policy.readPairMaximumReads,
    commitPairMaximumReads: policy.commitPairMaximumReads, maximumPostcheckReads: policy.maximumPostcheckReads,
    quotaTimeZone: policy.quotaTimeZone, quotaDayStart: policy.quotaDayStart,
    reservationQuotaDayStart: policy.quotaDayStart, humanDecisionAt: policy.humanDecisionAt,
    startedAt: policy.startedAt, authorizedUntil: policy.authorizedUntil, deadlineAt: policy.deadlineAt,
    maximumDurationMs: policy.maximumDurationMs, verifiedAt: iso(nowMs),
    totalUsageKnown: false, measuredTotalReads: null, dailyReadLimit: null,
    exactGlobalCutoff: false, localReservationOnly: true
  };
}

/** The first protected write must have completed and match the entire pending
 * state. Persist returned nextPolicy before using proof for any transport.
 */
export function acknowledgeFbMigrationDestinationReservation({projectId, scope, policy, nowMs, acknowledgement} = {}) {
  validatePolicy({projectId, scope, policy, nowMs});
  check(policy.status === 'RESERVATION_PENDING' && plain(acknowledgement) && acknowledgement.persisted === true
    && acknowledgement.reservationId === policy.pendingReservationId
    && acknowledgement.policySha256 === fbMigrationDestinationPolicySha256(policy),
  'DESTINATION_PERSISTENCE_REQUIRED');
  const reservations = copy(policy.reservations);
  reservations.at(-1).persisted = true;
  const nextPolicy = {...copy(policy), reservations, confirmedReservations: policy.confirmedReservations + 1,
    pendingReservationId: null, status: 'IN_PROGRESS'};
  validatePolicy({projectId, scope, policy: nextPolicy, nowMs});
  return {nextPolicy, proof: proofValue(nextPolicy, reservations.at(-1), nowMs)};
}

/** Revalidate scope, clock, deadline and the exact executor request before use. */
export function validateFbMigrationDestinationBudgetProof({proof, nowMs, maximumReads, expected} = {}) {
  check(count(nowMs) && count(maximumReads) && maximumReads > 0 && plain(expected)
    && typeof expected.runId === 'string' && SHA.test(expected.runId) && pinsValue(expected.pins)
    && pathValue(expected.path) && ['READ_PAIR', 'COMMIT_PAIR', 'POSTCHECK'].includes(expected.stage),
  'DESTINATION_EXPECTED_BINDING_REQUIRED');
  check(plain(proof) && proof.schemaVersion === 1 && proof.mode === MODE && proof.projectId === FB
    && proof.databaseId === '(default)' && proof.authorizedPurpose === PURPOSE
    && proof.authorizationSource === 'EXPLICIT_HUMAN_CONTINUE_FB' && id(proof.authorizationId)
    && proof.allowed === true && proof.reservationPersisted === true && proof.runId === expected.runId
    && samePins(proof.pins, expected.pins) && SHA.test(proof.scopeSha256 || '')
    && proof.path === expected.path && proof.stage === expected.stage, 'DESTINATION_PROOF_SCOPE_MISMATCH');
  check(proof.pausedRequiresReview === false && proof.renewalClearsPause === false
    && proof.totalUsageKnown === false && proof.measuredTotalReads === null && proof.dailyReadLimit === null
    && proof.exactGlobalCutoff === false && proof.localReservationOnly === true
    && !Object.hasOwn(proof, 'metric') && proof.quotaTimeZone === 'America/Los_Angeles',
  'DESTINATION_PROOF_POLICY_INVALID');
  const approved = time(proof.humanDecisionAt), start = time(proof.startedAt);
  const authorizedUntil = time(proof.authorizedUntil), deadline = time(proof.deadlineAt), verified = time(proof.verifiedAt);
  check(approved <= start && start <= verified && verified <= nowMs && nowMs - verified <= MAX_DURATION
    && authorizedUntil > start && authorizedUntil - approved <= MAX_AUTHORIZATION
    && count(proof.maximumDurationMs) && proof.maximumDurationMs > 0 && proof.maximumDurationMs <= MAX_DURATION
    && deadline === Math.min(authorizedUntil, start + proof.maximumDurationMs) && nowMs < deadline
    && proof.quotaDayStart === firestoreQuotaDayStart(start) && proof.quotaDayStart === firestoreQuotaDayStart(nowMs)
    && proof.reservationQuotaDayStart === proof.quotaDayStart, 'DESTINATION_PROOF_EXPIRED');
  check(count(proof.maximumUnits) && proof.maximumUnits > 0 && proof.maximumUnits <= 1000
    && count(proof.readPairMaximumReads) && proof.readPairMaximumReads >= 2 && proof.readPairMaximumReads <= 32
    && count(proof.commitPairMaximumReads) && proof.commitPairMaximumReads >= 2 && proof.commitPairMaximumReads <= 32
    && count(proof.maximumPostcheckReads) && proof.maximumPostcheckReads <= proof.maximumUnits * 4
    && count(proof.maximumReservedReads) && proof.maximumReservedReads > 0 && proof.maximumReservedReads <= MAX_RESERVATIONS
    && proof.maximumReservedReads === proof.maximumUnits * (proof.readPairMaximumReads + proof.commitPairMaximumReads)
      + proof.maximumPostcheckReads
    && count(proof.reservedReads) && proof.reservedReads >= maximumReads && proof.reservedReads <= proof.maximumReservedReads
    && proof.maximumReads === maximumReads && id(proof.reservationId)
    && proof.remainingLocalReservations === proof.maximumReservedReads - proof.reservedReads
    && (proof.stage === 'POSTCHECK' ? maximumReads <= 4
      : maximumReads === (proof.stage === 'READ_PAIR' ? proof.readPairMaximumReads : proof.commitPairMaximumReads)),
  'DESTINATION_PROOF_RESERVATION_INVALID');
  return {reservationId: proof.reservationId, estimatedWithMargin: null,
    boundedRunReservedReads: proof.reservedReads, totalUsageKnown: false};
}

/** No terminal transition clears reservations or a pause, including after a
 * quota day change or expired deadline. Unacknowledged reserves remain debited.
 */
export function pauseFbMigrationDestinationBudget({projectId, policy, nowMs, reason} = {}) {
  check(projectId === FB && count(nowMs) && plain(policy) && policy.projectId === FB
    && policy.schemaVersion === 1 && policy.mode === MODE && count(policy.reservedReads)
    && Array.isArray(policy.reservations) && /^[A-Z][A-Z0-9_]{2,100}$/.test(reason || ''),
  'DESTINATION_PAUSE_INVALID');
  return {...copy(policy), pausedRequiresReview: true,
    status: policy.status === 'RESERVATION_PENDING' ? 'RESERVATION_PENDING' : 'PAUSED',
    pauseReason: policy.pauseReason || reason, pausedAt: policy.pausedAt || iso(nowMs), renewalClearsPause: false};
}

export function finishFbMigrationDestinationBudget({projectId, policy, nowMs, status} = {}) {
  check(projectId === FB && count(nowMs) && plain(policy) && policy.projectId === FB
    && policy.schemaVersion === 1 && policy.mode === MODE && count(policy.reservedReads)
    && Array.isArray(policy.reservations) && ['COMPLETE', 'INCOMPLETE'].includes(status)
    && ['AUTHORIZED', 'IN_PROGRESS', 'RESERVATION_PENDING', 'PAUSED'].includes(policy.status),
  'DESTINATION_TERMINAL_TRANSITION_INVALID');
  const nextPolicy = {...copy(policy), pausedRequiresReview: true,
    status: policy.status === 'RESERVATION_PENDING' ? 'RESERVATION_PENDING' : status,
    outcome: status, finishedAt: iso(nowMs), renewalClearsPause: false};
  nextPolicy.pauseReason ||= status === 'COMPLETE' ? 'FB_MIGRATION_AUTHORIZATION_CONSUMED'
    : 'FB_MIGRATION_INCOMPLETE_REQUIRES_REVIEW';
  return nextPolicy;
}
