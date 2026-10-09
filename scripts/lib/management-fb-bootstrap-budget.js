import {createHash} from 'node:crypto';
import {firestoreQuotaDayStart} from './management-read-budget.js';

const FB = 'sahmt-gestao-5ae66';
const MODE = 'FB_INITIAL_BACKUP_WITHOUT_COMPLETE_METRIC';
const ROOT = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SHA = /^[a-f0-9]{64}$/;
const HEX_ID = /^[a-f0-9]{32,64}$/;
const MAX_READS = 250;
const MAX_DURATION_MS = 120000;
const MAX_AUTHORIZATION_MS = 900000;
class BootstrapError extends Error { constructor(code) { super(code); this.code = code; } }
const requireValue = (value, code) => { if (!value) throw new BootstrapError(code); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const isoMs = value => {
  requireValue(typeof value === 'string', 'FB_BOOTSTRAP_TIME_INVALID');
  const time = Date.parse(value);
  requireValue(count(time) && new Date(time).toISOString() === value, 'FB_BOOTSTRAP_TIME_INVALID');
  return time;
};

/** This digest covers only the explicitly approved selected root trees. */
export function fbBootstrapScopeSha256(scope) {
  requireValue(plain(scope) && scope.schemaVersion === 1 && scope.projectId === FB
    && scope.databaseId === '(default)' && Array.isArray(scope.rootCollections)
    && scope.rootCollections.length > 0 && scope.rootCollections.length <= 64
    && scope.rootCollections.every(value => typeof value === 'string' && ROOT.test(value))
    && new Set(scope.rootCollections).size === scope.rootCollections.length,
  'FB_BOOTSTRAP_SCOPE_INVALID');
  return createHash('sha256').update(JSON.stringify({projectId: FB, databaseId: '(default)',
    rootCollections: [...scope.rootCollections].sort()})).digest('hex');
}

function validate({projectId, scope, policy, nowMs}) {
  requireValue(projectId === FB && count(nowMs), 'FB_BOOTSTRAP_PROJECT_OR_CLOCK_INVALID');
  const scopeSha256 = fbBootstrapScopeSha256(scope);
  requireValue(plain(policy) && policy.schemaVersion === 1 && policy.mode === MODE
    && policy.projectId === FB && policy.databaseId === '(default)'
    && policy.authorizedPurpose === 'MANAGEMENT_INITIAL_FB_BACKUP_ONLY'
    && policy.authorizationSource === 'EXPLICIT_HUMAN_CONTINUE_FB'
    && HEX_ID.test(policy.authorizationId) && policy.scopeSha256 === scopeSha256
    && policy.totalUsageKnown === false && policy.observationSource === 'NO_COMPLETE_CURRENT_OBSERVATION'
    && policy.exactGlobalCutoff === false && policy.renewalClearsPause === false,
  'FB_BOOTSTRAP_EXPLICIT_AUTHORIZATION_REQUIRED');
  requireValue(policy.pausedRequiresReview === false && ['AUTHORIZED', 'IN_PROGRESS'].includes(policy.status),
    'FB_BOOTSTRAP_CLOSED_OR_PAUSED');
  const humanDecisionAt = isoMs(policy.humanDecisionAt);
  const authorizedUntil = isoMs(policy.authorizedUntil);
  const startedAt = isoMs(policy.captureStartedAt);
  const readTime = isoMs(policy.captureReadTime);
  const quotaDayStart = firestoreQuotaDayStart(nowMs);
  requireValue(policy.quotaDayStart === quotaDayStart && humanDecisionAt >= Date.parse(quotaDayStart)
    && humanDecisionAt <= startedAt && startedAt <= nowMs && authorizedUntil > startedAt
    && authorizedUntil - startedAt <= MAX_AUTHORIZATION_MS
    && nowMs < authorizedUntil && nowMs - startedAt < MAX_DURATION_MS,
  'FB_BOOTSTRAP_AUTHORIZATION_OR_DAY_EXPIRED');
  requireValue(readTime <= startedAt && startedAt - readTime <= 10000,
    'FB_BOOTSTRAP_FIXED_READ_TIME_INVALID');
  requireValue(policy.maximumReservedReads === MAX_READS && count(policy.reservedReads)
    && policy.reservedReads <= MAX_READS && count(policy.reservationAttempts)
    && policy.reservationAttempts === policy.reservedReads,
  'FB_BOOTSTRAP_RESERVATION_STATE_INVALID');
  return {scopeSha256, quotaDayStart};
}

/** Pure local decision: no metric, credential, clock, persistence or API is obtained.
 * This is an explicit, bounded exception for initial FB backup, not a synthetic
 * measurement of total usage and never a fallback for measured FA operations.
 * The caller must atomically persist nextPolicy under the FB lock BEFORE transport.
 */
export function assessFbBootstrapReadBudget({projectId, scope, policy, nowMs, reservation = null} = {}) {
  const {scopeSha256, quotaDayStart} = validate({projectId, scope, policy, nowMs});
  if (reservation === null) requireValue(policy.status === 'AUTHORIZED' && policy.reservedReads === 0
    && policy.reservationAttempts === 0, 'FB_BOOTSTRAP_ALREADY_STARTED_REQUIRES_REVIEW');
  if (reservation === null) return {allowed: true, projectId: FB, quotaDayStart, scopeSha256,
    totalUsageKnown: false, measuredTotalReads: null, exactGlobalCutoff: false,
    localReservationOnly: true, boundedBootstrap: true, reservedReads: policy.reservedReads,
    remainingLocalReservations: MAX_READS - policy.reservedReads, authorizationId: policy.authorizationId};
  requireValue(plain(reservation) && reservation.projectId === FB && reservation.databaseId === '(default)'
    && reservation.readTime === policy.captureReadTime
    && ['listDocuments', 'listCollectionIds'].includes(reservation.operation)
    && reservation.maximumReads === 1 && reservation.attempt === policy.reservationAttempts + 1
    && SHA.test(reservation.requestSha256), 'FB_BOOTSTRAP_RESERVATION_INVALID');
  requireValue(policy.reservedReads < MAX_READS, 'FB_BOOTSTRAP_LOCAL_RESERVE_EXHAUSTED');
  const nextPolicy = {...policy, status: 'IN_PROGRESS', reservedReads: policy.reservedReads + 1,
    reservationAttempts: policy.reservationAttempts + 1,
    lastRequestSha256: reservation.requestSha256, lastReservedAt: new Date(nowMs).toISOString()};
  return {allowed: true, projectId: FB, quotaDayStart, scopeSha256, totalUsageKnown: false,
    measuredTotalReads: null, exactGlobalCutoff: false, localReservationOnly: true,
    boundedBootstrap: true, reservedReads: nextPolicy.reservedReads,
    remainingLocalReservations: MAX_READS - nextPolicy.reservedReads,
    authorizationId: policy.authorizationId, nextPolicy};
}

/** Parameters for the existing capture core; fixed readTime and no implicit retry. */
export function fbBootstrapCaptureConfiguration({projectId, scope, policy, nowMs} = {}) {
  validate({projectId, scope, policy, nowMs});
  return {projectId: FB, databaseId: '(default)', rootCollections: [...scope.rootCollections],
    readTime: policy.captureReadTime, pageSize: 1, collectionPageSize: 1,
    limits: {maxPages: MAX_READS, maxDocuments: 100, maxDepth: 30,
      maxBytes: 2 * 1024 * 1024, maxDurationMs: MAX_DURATION_MS, requestTimeoutMs: 15000}};
}

/** Terminal transition preserves every debit even when capture failed or expired. */
export function finishFbBootstrapReadBudget({projectId, policy, nowMs, status} = {}) {
  requireValue(projectId === FB && count(nowMs) && plain(policy) && policy.projectId === FB
    && policy.schemaVersion === 1 && policy.mode === MODE && HEX_ID.test(policy.authorizationId)
    && count(policy.reservedReads) && policy.reservedReads <= MAX_READS
    && count(policy.reservationAttempts) && policy.reservationAttempts === policy.reservedReads
    && ['AUTHORIZED', 'IN_PROGRESS'].includes(policy.status)
    && ['COMPLETE', 'INCOMPLETE'].includes(status), 'FB_BOOTSTRAP_TERMINAL_TRANSITION_INVALID');
  return {...policy, status, pausedRequiresReview: true, finishedAt: new Date(nowMs).toISOString(),
    pauseReason: status === 'COMPLETE' ? 'FB_INITIAL_BACKUP_AUTHORIZATION_CONSUMED'
      : 'FB_INITIAL_BACKUP_INCOMPLETE_REQUIRES_REVIEW'};
}
