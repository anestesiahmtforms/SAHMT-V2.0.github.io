import {createHash} from 'node:crypto';

const PROJECTS = new Set(['sahmt-17a16', 'sahmt-gestao-5ae66']);
const CATEGORY = 'GOVERNANCE', MODALITY = 'MANAGER_REVIEW', POINTS = 2;
const SOURCE = 'MANAGER_MATERIAL_VERSION_REVIEW';
const decisions = new Set(['APPROVE', 'REJECT']);
const modes = new Set(['BACKEND_ONLY', 'INDEPENDENT_ADMIN']);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const version = value => Number.isSafeInteger(value) && value > 0 && value <= 1000000;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const points = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const equivalent = (left, right) => canonical(left) === canonical(right);
const ownKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0,19) !== value.slice(0,19)) return null;
  return milliseconds;
}
function origin(value) {
  return ownKeys(value, ['projectId', 'materialId']) && PROJECTS.has(value.projectId) && id(value.materialId)
    ? {projectId: value.projectId, materialId: value.materialId} : null;
}
const blocked = code => ({status: 'BLOCKED', reason: code, event: null, awardSpec: null});
const conflict = (code, eventId) => ({status: 'CONFLICT', reason: code, eventId, event: null, awardSpec: null});

/**
 * Pure trusted-backend planning only. Context is evidence assembled by the
 * adapter from current server reads, never a browser assertion. This function
 * obtains no credentials, reads no database and emits no production writes.
 *
 * existingEvent and existingAward must be read in the integration transaction.
 * READY requires event creation with exists:false and the normal ledger plan in
 * that SAME transaction. A caller must never apply the returned pieces alone.
 */
export function planManagementManagerReview({review, policy, context, existingEvent = null, existingAward = null} = {}) {
  // The confirmed unit does not select a decision policy or administrator role.
  if (!policy) return blocked('MANAGER_REVIEW_POLICY_UNDEFINED');
  const policyKeys = ['schemaVersion', 'id', 'version', 'confirmed', 'unit', 'category', 'modality', 'points', 'creditedDecisions', 'validationMode', 'eligibility', 'effectiveFrom', 'retroactive'];
  if (!ownKeys(policy, policyKeys) || policy.schemaVersion !== 1 || !id(policy.id) || !version(policy.version) || policy.confirmed !== true ||
      policy.unit !== 'MATERIAL_VERSION' || policy.category !== CATEGORY || policy.modality !== MODALITY || policy.points !== POINTS ||
      policy.eligibility !== 'CURRENT_DESIGNATED_MANAGER' || policy.retroactive !== false ||
      !Array.isArray(policy.creditedDecisions) || policy.creditedDecisions.length < 1 || policy.creditedDecisions.length > 2 ||
      new Set(policy.creditedDecisions).size !== policy.creditedDecisions.length || !policy.creditedDecisions.every(value => decisions.has(value)) ||
      !modes.has(policy.validationMode) || instant(policy.effectiveFrom) === null) return blocked('MANAGER_REVIEW_POLICY_INCOMPLETE');

  const reviewKeys = ['materialOrigin', 'materialVersion', 'activityId', 'areaId', 'managerUid', 'managerMemberId', 'assignmentId', 'assignmentVersion', 'decision', 'completedAt', 'sourceFingerprint', 'reviewFingerprint', 'requestId'];
  const materialOrigin = origin(review?.materialOrigin);
  if (!ownKeys(review, reviewKeys) || !materialOrigin || !version(review.materialVersion) ||
      !['activityId', 'areaId', 'managerUid', 'managerMemberId', 'assignmentId', 'requestId'].every(key => id(review[key])) ||
      !version(review.assignmentVersion) || !decisions.has(review.decision) || instant(review.completedAt) === null ||
      !digest(review.sourceFingerprint) || !digest(review.reviewFingerprint)) return blocked('MANAGER_REVIEW_INPUT_INVALID');

  // Origin is the original material identity, including after FA -> FB copies.
  // Rule version, request, decision, assignment and manager NEVER create units.
  const unit = {materialOrigin, materialVersion: review.materialVersion};
  const eventId = 'manager-review-' + hash(unit);
  const awardId = 'award-' + createHash('sha256').update(JSON.stringify([CATEGORY, review.managerUid, eventId, String(review.materialVersion), MODALITY])).digest('hex');
  const policyIdentity = {id: policy.id, version: policy.version, creditedDecisions: [...policy.creditedDecisions].sort(), validationMode: policy.validationMode, effectiveFrom: new Date(instant(policy.effectiveFrom)).toISOString()};
  const business = {
    unit, uid: review.managerUid, memberId: review.managerMemberId, activityId: review.activityId, areaId: review.areaId,
    assignmentId: review.assignmentId, assignmentVersion: review.assignmentVersion, decision: review.decision,
    completedAt: new Date(instant(review.completedAt)).toISOString(), sourceFingerprint: review.sourceFingerprint,
    reviewFingerprint: review.reviewFingerprint, policy: policyIdentity
  };
  const sourceFingerprint = hash(business);
  const evidence = {reviewEventId: eventId, materialOrigin: clone(materialOrigin), materialVersion: review.materialVersion,
    managerMemberId: review.managerMemberId, assignmentId: review.assignmentId, assignmentVersion: review.assignmentVersion,
    policyId: policy.id, policyVersion: policy.version};

  // Existing units cannot be reassigned, rewritten, repaired or paid again.
  if (existingEvent !== null || existingAward !== null) {
    if (!existingEvent || !existingAward) return conflict('MANAGER_REVIEW_EVENT_AWARD_PAIR_INCOMPLETE', eventId);
    if (existingEvent.id !== eventId || !equivalent(existingEvent.unit, unit)) return conflict('MANAGER_REVIEW_EXISTING_UNIT_CONFLICT', eventId);
    if (existingEvent.uid !== review.managerUid || existingEvent.memberId !== review.managerMemberId) return conflict('MANAGER_REVIEW_BENEFICIARY_FROZEN', eventId);
    if (!equivalent(existingEvent.business, business) || existingEvent.sourceFingerprint !== sourceFingerprint) return conflict('MANAGER_REVIEW_SOURCE_OR_RULE_CONFLICT', eventId);
    if (existingEvent.schemaVersion !== 1 || existingEvent.kind !== SOURCE || existingEvent.status !== 'CONFIRMED' ||
        existingEvent.category !== CATEGORY || existingEvent.modality !== MODALITY || existingEvent.points !== POINTS ||
        existingEvent.creditScopeId !== eventId || existingEvent.awardId !== awardId ||
        !modes.has(existingEvent.validationMode) || existingEvent.validationMode !== policy.validationMode ||
        instant(existingEvent.validatedAt) === null || instant(existingEvent.validatedAt) < instant(review.completedAt) ||
        instant(context?.now) !== null && instant(existingEvent.validatedAt) > instant(context.now) || !id(existingEvent.firstRequestId) ||
        (policy.validationMode === 'INDEPENDENT_ADMIN' ? !id(existingEvent.validatedByUid) || existingEvent.validatedByUid === review.managerUid : existingEvent.validatedByUid !== '')) return conflict('MANAGER_REVIEW_EVENT_CONTRACT_CONFLICT', eventId);
    if (existingAward.id !== awardId || existingAward.uid !== review.managerUid || existingAward.category !== CATEGORY ||
        existingAward.modality !== MODALITY || existingAward.creditScopeId !== eventId ||
        String(existingAward.version) !== String(review.materialVersion) || existingAward.activityId !== review.activityId ||
        existingAward.areaId !== review.areaId || existingAward.originalPoints !== POINTS ||
        !points(existingAward.points) || !version(existingAward.awardVersion) || existingAward.awardVersion > 50000 ||
        existingAward.sourceFingerprint !== sourceFingerprint || !equivalent(existingAward.evidence, evidence) ||
        existingAward.lastLedgerId !== awardId + '-v' + existingAward.awardVersion || typeof existingAward.adminOverride !== 'boolean') return conflict('MANAGER_REVIEW_AWARD_IDENTITY_CONFLICT', eventId);
    // The current ledger preserves the original source fingerprint/evidence in
    // ADMIN_CORRECTION. A correction changes balance; it never changes the unit.
    if (existingAward.adminOverride ? existingAward.sourceType !== 'ADMIN_CORRECTION' || !id(existingAward.sourceId) || !id(existingAward.approvedByUid) :
        existingAward.points !== POINTS || existingAward.sourceType !== SOURCE || existingAward.sourceId !== eventId) return conflict('MANAGER_REVIEW_AWARD_STATE_CONFLICT', eventId);
  }

  const now = instant(context?.now), checkedAt = instant(context?.checkedAt);
  if (!PROJECTS.has(context?.projectId) || now === null || checkedAt === null || checkedAt > now || now - checkedAt > 60000) return blocked('MANAGER_REVIEW_CURRENT_CONTEXT_REQUIRED');
  const profile = context.profile, assignment = context.assignment;
  if (!profile || profile.uid !== review.managerUid || profile.memberId !== review.managerMemberId || profile.active !== true ||
      profile.access !== true || context.reviewPermissionVerified !== true) return blocked('MANAGER_REVIEW_ACCESS_REVOKED_OR_UNVERIFIED');
  if (!assignment || assignment.active !== true || assignment.id !== review.assignmentId || assignment.version !== review.assignmentVersion ||
      assignment.uid !== review.managerUid || assignment.memberId !== review.managerMemberId || assignment.areaId !== review.areaId ||
      !equivalent(origin(assignment.materialOrigin), materialOrigin)) return blocked('MANAGER_REVIEW_CURRENT_DESIGNATION_REQUIRED');
  const validation = context.validation, completedAt = instant(review.completedAt), validatedAt = instant(validation?.validatedAt);
  if (!validation || validation.trustedBackend !== true || validation.status !== 'COMPLETE' ||
      validation.canonicalOriginVerified !== true || validation.contentVerified !== true ||
      !equivalent(origin(validation.materialOrigin), materialOrigin) || validation.materialVersion !== review.materialVersion ||
      validation.sourceFingerprint !== review.sourceFingerprint || validation.reviewFingerprint !== review.reviewFingerprint ||
      validation.managerUid !== review.managerUid || validation.decision !== review.decision ||
      instant(validation.completedAt) !== completedAt || completedAt > now || validatedAt === null || validatedAt < completedAt ||
      validatedAt > now || now - validatedAt > 60000) return blocked('MANAGER_REVIEW_COMPLETE_BACKEND_VALIDATION_REQUIRED');
  if (completedAt < instant(policy.effectiveFrom) || instant(policy.effectiveFrom) > now) return blocked('MANAGER_REVIEW_RETROACTIVE_CREDIT_FORBIDDEN');
  if (!policy.creditedDecisions.includes(review.decision)) return blocked('MANAGER_REVIEW_DECISION_NOT_IN_EXPLICIT_POLICY');

  let validatedByUid = '';
  if (policy.validationMode === 'INDEPENDENT_ADMIN') {
    const validator = context.validator;
    if (!validator || !id(validator.uid) || validator.uid === review.managerUid || validator.active !== true ||
        validator.access !== true || validator.adminVerified !== true || validation.validatorUid !== validator.uid) return blocked('MANAGER_REVIEW_INDEPENDENT_ADMIN_REQUIRED');
    validatedByUid = validator.uid;
  }
  if (existingEvent !== null) {
    if (policy.validationMode === 'INDEPENDENT_ADMIN' && existingEvent.validatedByUid !== validatedByUid) return conflict('MANAGER_REVIEW_VALIDATOR_CONFLICT', eventId);
    return {status: 'DUPLICATE', reason: 'EQUIVALENT_UNIT_ALREADY_CREDITED', eventId, awardId, event: null, awardSpec: null, administrativeCorrectionPreserved: existingAward.adminOverride === true};
  }

  const event = {
    schemaVersion: 1, id: eventId, kind: SOURCE, status: 'CONFIRMED', unit: clone(unit), business: clone(business),
    uid: review.managerUid, memberId: review.managerMemberId, category: CATEGORY, modality: MODALITY, points: POINTS,
    sourceFingerprint, creditScopeId: eventId, awardId, validationMode: policy.validationMode,
    validatedByUid, validatedAt: new Date(validatedAt).toISOString(), firstRequestId: review.requestId
  };
  const awardSpec = {
    id: awardId, uid: review.managerUid, category: CATEGORY, modality: MODALITY, creditScopeId: eventId,
    activityId: review.activityId, areaId: review.areaId, version: review.materialVersion, points: POINTS,
    sourceFingerprint, sourceType: SOURCE, sourceId: eventId, approvedByUid: validatedByUid,
    reason: 'Revisão completa do material e versão, confirmada conforme política explícita de governança.',
    evidence: clone(evidence)
  };
  return {status: 'READY', eventId, awardId, event, awardSpec, integration: {
    eventCollection: 'evaluationManagerReviewEvents', eventPrecondition: {exists: false},
    sameTransactionRequired: true, currentAuthorizationRecheckRequired: true, ledgerChangesInSingleCall: true,
    existingEventAndAwardReadRequired: true, sourceFingerprintRecheckRequired: true
  }};
}
