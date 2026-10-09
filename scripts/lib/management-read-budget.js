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
    const capturedAt=Date.parse(observation.capturedAt), reviewedAt=Date.parse(observation.reviewedAt), periodStart=Date.parse(observation.periodStart);
    if (projectId !== 'sahmt-17a16' || policy.dailyReadLimit !== 45000 || policy.manualReviewEvidence !== 'USER_PROVIDED_FA_USAGE_CAPTURE_2026_10_08_220102' || observation.project !== projectId || observation.quotaDayStart !== quotaDayStart || !/^[a-f0-9]{64}$/.test(observation.evidenceSha256 || '') || policy.manualReviewSha256 !== observation.evidenceSha256 || observation.periodKind !== 'LAST_24_HOURS' || periodStart !== capturedAt-86400000 || periodStart > Date.parse(quotaDayStart) || capturedAt < Date.parse(quotaDayStart) || !Number.isFinite(reviewedAt) || reviewedAt < capturedAt || reviewedAt > nowMs || nowMs-capturedAt > 300000 || capturedAt > nowMs || observation.reads !== 5000 || observation.displayedEstimate !== '4.1k' || observation.exactGlobalCutoff !== false) fail('MANUAL_SOURCE_USAGE_REVIEW_INVALID_OR_EXPIRED');
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
 if (observation?.observationSource === "USER_CURRENT_USAGE_DASHBOARD_REVIEW") return {observationSource:observation.observationSource,totalUsageKnown:false,measuredTotalReads:null,estimatedUpperReads:observation.reads,displayedEstimate:observation.displayedEstimate,capturedAt:observation.capturedAt,evidenceSha256:observation.evidenceSha256,periodKind:observation.periodKind,exactGlobalCutoff:false};
 return {observationSource:"CLOUD_MONITORING",totalUsageKnown:false,measuredTotalReads:observation?.reads??null,metric:observation?.metric??null,latestPoint:observation?.latestPoint??null,exactGlobalCutoff:false};
}
