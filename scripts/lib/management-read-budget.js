import {createHash} from 'node:crypto';
const SOURCE_PROJECT = 'sahmt-17a16';
const MANUAL_SOURCE = 'USER_CURRENT_USAGE_DASHBOARD_REVIEW';
const CAPTURE_SOURCE = 'HUMAN_USER_MESSAGE_ATTACHMENT';
const MANUAL_AUTHORITY = 'EXPLICIT_HUMAN_FA_BACKUP_REVIEW';
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const opaqueId = value => typeof value === 'string' && ID.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const manualFailure = () => {throw Error('MANUAL_SOURCE_USAGE_REVIEW_INVALID_OR_EXPIRED');};

/** Pure parsing of the displayed estimate, never an observation of actual usage.
 * Reserve above the display's rounding interval, then round upward to 1,000.
 * Unscaled numbers are also estimates; decimals require an explicit suffix.
 */
export function sourceUsageReviewUpperReads(displayedEstimate) {
  if (typeof displayedEstimate !== 'string' || displayedEstimate.length > 64) manualFailure();
  const match = /^(0|[1-9]\d{0,8})(?:([.,])(\d{1,2}))?\s*(k|mil|m|mi|milhão|milhões)?$/iu
    .exec(displayedEstimate.trim().replace(/\u00a0/g, ' '));
  if (!match || match[3] && !match[4]) manualFailure();
  const precision = match[3]?.length || 0, denominator = 10n ** BigInt(precision);
  const multiplier = !match[4] ? 1n : /^(k|mil)$/i.test(match[4]) ? 1000n : 1000000n;
  const mantissa = BigInt(match[1]) * denominator + BigInt(match[3] || '0');
  const roundedIntervalUpper = 2n * mantissa * multiplier + multiplier;
  const bucket = 2n * denominator * 1000n;
  const reads = Number(((roundedIntervalUpper + bucket - 1n) / bucket) * 1000n);
  if (!Number.isSafeInteger(reads) || reads < 0) manualFailure();
  return reads;
}

/** Integrity pin for the exact human capture and review fields. A hash is not
 * evidence of human authority: only a trusted review workflow may build proof.
 */
export function sourceUsageReviewObservationSha256(observation) {
  if (!plain(observation) || !plain(observation.captureProvenance)) manualFailure();
  const capture = observation.captureProvenance;
  const packet = Object.fromEntries(['observationSource', 'project', 'quotaDayStart', 'capturedAt',
    'reviewedAt', 'periodStart', 'periodKind', 'reads', 'displayedEstimate', 'evidenceSha256',
    'exactGlobalCutoff', 'totalUsageKnown', 'measuredTotalReads', 'evidenceId']
    .map(key => [key, observation[key]]));
  packet.captureProvenance = Object.fromEntries(['schemaVersion', 'source', 'humanMessageId',
    'evidenceId', 'evidenceSha256', 'capturedAt'].map(key => [key, capture[key]]));
  if (Object.values(packet).some(value => value === undefined)
    || Object.values(packet.captureProvenance).some(value => value === undefined)) manualFailure();
  return createHash('sha256').update(JSON.stringify(packet)).digest('hex');
}

function validateManualSourceUsageReview({projectId, nowMs, observation, policy, quotaDayStart, decisionAt}) {
  const capturedAt = Date.parse(observation.capturedAt), reviewedAt = Date.parse(observation.reviewedAt);
  const periodStart = Date.parse(observation.periodStart), quotaStart = Date.parse(quotaDayStart);
  const upper = sourceUsageReviewUpperReads(observation.displayedEstimate);
  const capture = observation.captureProvenance, authorization = policy.manualReviewAuthorization;
  const captureKeys = ['schemaVersion', 'source', 'humanMessageId', 'evidenceId', 'evidenceSha256', 'capturedAt'];
  const authorizationKeys = ['schemaVersion', 'authorized', 'authorizationSource', 'authorizationId',
    'humanDecisionMessageId', 'projectId', 'authorizedPurpose', 'dailyReadLimit', 'quotaDayStart',
    'approvedAt', 'reviewedAt', 'capturedAt', 'evidenceId', 'evidenceSha256', 'observationSha256',
    'captureHumanMessageId', 'captureSource'];
  if (projectId !== SOURCE_PROJECT || policy.dailyReadLimit !== 45000
    || !opaqueId(policy.manualReviewEvidence) || observation.evidenceId !== policy.manualReviewEvidence
    || observation.project !== projectId || observation.quotaDayStart !== quotaDayStart
    || !SHA.test(observation.evidenceSha256 || '') || policy.manualReviewSha256 !== observation.evidenceSha256
    || observation.periodKind !== 'LAST_24_HOURS' || !Number.isFinite(periodStart)
    || !Number.isFinite(capturedAt) || !Number.isFinite(reviewedAt)
    || periodStart !== capturedAt - 86400000 || periodStart > quotaStart || capturedAt < quotaStart
    || capturedAt > reviewedAt || reviewedAt > decisionAt || decisionAt > nowMs
    || nowMs - capturedAt > 300000 || !Number.isSafeInteger(observation.reads) || observation.reads !== upper
    || observation.exactGlobalCutoff !== false || observation.totalUsageKnown !== false
    || observation.measuredTotalReads !== null) manualFailure();
  if (!plain(capture) || Object.keys(capture).length !== captureKeys.length
    || !captureKeys.every(key => Object.hasOwn(capture, key)) || capture.schemaVersion !== 1
    || capture.source !== CAPTURE_SOURCE || !opaqueId(capture.humanMessageId)
    || capture.evidenceId !== observation.evidenceId || capture.evidenceSha256 !== observation.evidenceSha256
    || capture.capturedAt !== observation.capturedAt) manualFailure();
  if (!plain(authorization) || Object.keys(authorization).length !== authorizationKeys.length
    || !authorizationKeys.every(key => Object.hasOwn(authorization, key)) || authorization.schemaVersion !== 1
    || authorization.authorized !== true || authorization.authorizationSource !== MANUAL_AUTHORITY
    || !opaqueId(authorization.authorizationId) || !opaqueId(authorization.humanDecisionMessageId)
    || authorization.projectId !== SOURCE_PROJECT || authorization.authorizedPurpose !== 'MANAGEMENT_BACKUP_ONLY'
    || authorization.dailyReadLimit !== 45000 || authorization.quotaDayStart !== quotaDayStart
    || authorization.approvedAt !== policy.humanDecisionAt || authorization.reviewedAt !== observation.reviewedAt
    || authorization.capturedAt !== observation.capturedAt || authorization.evidenceId !== observation.evidenceId
    || authorization.evidenceSha256 !== observation.evidenceSha256
    || authorization.captureHumanMessageId !== capture.humanMessageId || authorization.captureSource !== CAPTURE_SOURCE
    || !SHA.test(authorization.observationSha256 || '')
    || authorization.observationSha256 !== sourceUsageReviewObservationSha256(observation)) manualFailure();
}
const METRIC = 'firestore.googleapis.com/document/read_ops_count';
const PROJECTS = new Set(['sahmt-17a16', 'sahmt-gestao-5ae66']);
const approvedLimit = (projectId, value) => value === 35000 || projectId === 'sahmt-17a16' && value === 45000;
const fail = code => { throw Error(code); };
const count = value => Number.isSafeInteger(value) && value >= 0;
export function firestoreQuotaDayStart(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail('INVALID_BUDGET_CLOCK');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(nowMs)).map(part => [part.type, part.value]));
  const utc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)); let start = utc;
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset'}).formatToParts(new Date(start)).find(part => part.type === 'timeZoneName').value;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(value);
    if (!match) fail('QUOTA_OFFSET_UNAVAILABLE');
    start = utc - (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) * 60000;
  }
  return new Date(start).toISOString();
}
/** Pure decision. No clock, credentials, measurement, policy mutation or renewal side effect. */
export function assessManagementReadBudget({projectId, nowMs, observation, policy, maximumReads, legacyReservedReads = 0}) {
  if (!PROJECTS.has(projectId) || !Number.isSafeInteger(nowMs) || nowMs < 0 || !count(maximumReads) || maximumReads < 1) fail('INVALID_BUDGET_OPERATION');
  if (policy?.schemaVersion !== 1 || policy.projectId !== projectId || !approvedLimit(projectId, policy.dailyReadLimit) || policy.quotaTimeZone !== 'America/Los_Angeles' || policy.renewalClearsPause !== false || typeof policy.pausedRequiresReview !== 'boolean') fail('INVALID_MANAGEMENT_READ_POLICY');
  if (policy.pausedRequiresReview) fail('MANAGEMENT_READ_PAUSED_REQUIRES_REVIEW');
  if (policy.dailyReadLimit === 45000 && policy.limitApprovalEvidence !== 'USER_FA_DAILY_LIMIT_45000_2026_10_08') fail('MANAGEMENT_LIMIT_INCREASE_NOT_AUTHORIZED');
  if (policy.authorizedPurpose !== 'MANAGEMENT_BACKUP_ONLY' || !Number.isFinite(Date.parse(policy.humanDecisionAt))) fail('BACKUP_PURPOSE_NOT_AUTHORIZED');
  const quotaDayStart = firestoreQuotaDayStart(nowMs);
  const decisionAt = Date.parse(policy.humanDecisionAt);
  if (decisionAt > nowMs || decisionAt < Date.parse(quotaDayStart)) fail('BACKUP_DECISION_NOT_FOR_CURRENT_DAY');
  const manualReview = observation?.observationSource === 'USER_CURRENT_USAGE_DASHBOARD_REVIEW';
  if (manualReview) {
    validateManualSourceUsageReview({projectId, nowMs, observation, policy, quotaDayStart, decisionAt});
  } else {
  const verifiedAt = Date.parse(observation?.verifiedAt), latestPoint = Date.parse(observation?.latestPoint);
  if (observation?.project !== projectId || observation.metric !== METRIC || observation.quotaDayStart !== quotaDayStart || observation.complete !== true || observation.fresh !== true || !count(observation.reads) || !Number.isFinite(verifiedAt) || !Number.isFinite(latestPoint) || verifiedAt > nowMs || latestPoint > verifiedAt || latestPoint < Date.parse(quotaDayStart) || nowMs - verifiedAt > 300000 || nowMs - latestPoint > 300000) fail('MANAGEMENT_READ_METRIC_STALE_OR_INCOMPLETE');
  }
  if (![policy.appTrafficReserve, policy.metricLagReserve, policy.maximumCaptureReserve, policy.reservedReads, legacyReservedReads].every(count) || policy.appTrafficReserve < 5000 || policy.metricLagReserve < 2000 || policy.maximumCaptureReserve < 1) fail('MANAGEMENT_READ_RESERVES_INVALID');
  if (policy.reservationQuotaDayStart !== quotaDayStart) fail('MANAGEMENT_READ_RESERVATION_DAY_REVIEW_REQUIRED');
  const reservedReads = policy.reservedReads + maximumReads;
  if (!count(reservedReads) || reservedReads > policy.maximumCaptureReserve) fail('MANAGEMENT_CAPTURE_RESERVE_LIMIT');
  const estimatedWithMargin = observation.reads + legacyReservedReads + reservedReads + policy.appTrafficReserve + policy.metricLagReserve;
  if (!count(estimatedWithMargin) || estimatedWithMargin >= policy.dailyReadLimit) fail('MANAGEMENT_DAILY_LIMIT_OR_MARGIN');
  return {allowed: true, projectId, quotaDayStart, reservedReads, estimatedWithMargin, remainingAfterMargin: policy.dailyReadLimit - estimatedWithMargin, localReservationOnly: true, exactGlobalCutoff: false, observationSource: manualReview ? observation.observationSource : 'CLOUD_MONITORING'};
}
/** Sanitized provenance; an estimate is never presented as an exact project total. */
export function describeManagementReadObservation(observation) {
 if (observation?.observationSource === "USER_CURRENT_USAGE_DASHBOARD_REVIEW") return {observationSource:observation.observationSource,totalUsageKnown:false,measuredTotalReads:null,estimatedUpperReads:sourceUsageReviewUpperReads(observation.displayedEstimate),evidenceId:observation.evidenceId,captureSource:observation.captureProvenance?.source??null,displayedEstimate:observation.displayedEstimate,capturedAt:observation.capturedAt,evidenceSha256:observation.evidenceSha256,periodKind:observation.periodKind,exactGlobalCutoff:false};
 return {observationSource:"CLOUD_MONITORING",totalUsageKnown:false,measuredTotalReads:observation?.reads??null,metric:observation?.metric??null,latestPoint:observation?.latestPoint??null,exactGlobalCutoff:false};
}
