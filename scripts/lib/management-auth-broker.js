import {createHash, randomUUID} from 'node:crypto';

// Server core only. This file has no Firebase SDK, network, credentials, storage,
// user import/create executor or HTTP endpoint. Every privileged action is an adapter.
const FA = 'sahmt-17a16';
const FB = 'sahmt-gestao-5ae66';
const QUOTA_TIMEZONE = 'America/Los_Angeles';
const DAILY_READ_LIMIT = 35000;
const firestoreOperations = {readFaAuthorization: FA, readFbLease: FB, writeFbLease: FB, invalidateFbLease: FB};
const quotaDay = time => new Intl.DateTimeFormat('en-CA', {timeZone: QUOTA_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(time));
const permissions = [
  'admin', 'managementRead', 'managementManage', 'managementActivityWrite',
  'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage',
  'documentsManage', 'equipmentManage', 'qualityManage', 'trainingsManage',
  'financeRead', 'financeWrite', 'financeManage'
];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\s/\x00-\x1f]/.test(value);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const same = (left, right) => canonical(left) === canonical(right);
const copy = value => JSON.parse(JSON.stringify(value));
class BrokerDenial extends Error { constructor(code) { super(code); this.code = code; } }
const deny = code => { throw new BrokerDenial(code); };
const demand = (condition, code) => { if (!condition) deny(code); };

function validatePolicy(policy) {
  demand(object(policy) && policy.schemaVersion === 1 && id(policy.version, 100), 'BROKER_POLICY_REQUIRED');
  demand(integer(policy.leaseDurationMs, 1) && integer(policy.maxSnapshotAgeMs, 1)
    && integer(policy.maxExecutionMs, 1) && policy.maxExecutionMs <= 2147483647
    && integer(policy.cleanupTimeoutMs, 1) && policy.cleanupTimeoutMs <= 2147483647
    && integer(policy.maxFutureSkewMs), 'BROKER_POLICY_INVALID');
  const budget = policy.readBudget;
  demand(object(budget) && budget.dailyLimit === DAILY_READ_LIMIT && budget.quotaTimezone === QUOTA_TIMEZONE
    && integer(budget.maxMeasurementAgeMs, 1) && integer(budget.applicationReserveReads, 1)
    && integer(budget.metricLagReserveReads, 1) && object(budget.operationReadBounds), 'BROKER_READ_BUDGET_POLICY_REQUIRED');
  const operationReadBounds = {};
  for (const name of Object.keys(firestoreOperations)) {
    demand(integer(budget.operationReadBounds[name], 1)
      && budget.operationReadBounds[name] + budget.applicationReserveReads + budget.metricLagReserveReads < DAILY_READ_LIMIT,
      'BROKER_READ_BUDGET_POLICY_INVALID');
    operationReadBounds[name] = budget.operationReadBounds[name];
  }
  return Object.freeze({schemaVersion: 1, version: policy.version, leaseDurationMs: policy.leaseDurationMs,
    maxSnapshotAgeMs: policy.maxSnapshotAgeMs, maxExecutionMs: policy.maxExecutionMs,
    cleanupTimeoutMs: policy.cleanupTimeoutMs, maxFutureSkewMs: policy.maxFutureSkewMs,
    readBudget: Object.freeze({...budget, operationReadBounds: Object.freeze(operationReadBounds)})});
}

function validateReservation(receipt, request, time, policy) {
  const budget = policy.readBudget;
  demand(object(receipt) && receipt.schemaVersion === 1 && receipt.projectId === request.projectId
    && receipt.operation === request.operation && id(receipt.reservationId, 200)
    && receipt.quotaDay === quotaDay(time) && receipt.quotaTimezone === QUOTA_TIMEZONE
    && receipt.dailyLimit === DAILY_READ_LIMIT && receipt.pausedRequiresReview === false
    && receipt.metricsComplete === true && integer(receipt.measurementTimeMs)
    && receipt.measurementTimeMs <= time && quotaDay(receipt.measurementTimeMs) === receipt.quotaDay
    && time - receipt.measurementTimeMs <= budget.maxMeasurementAgeMs
    && integer(receipt.expiresAtMs) && receipt.expiresAtMs > time
    && receipt.reservedReads === request.maximumReads
    && integer(receipt.totalReadCount) && integer(receipt.outstandingReservedReads, receipt.reservedReads)
    && integer(receipt.unreportedConsumedReads)
    && integer(receipt.applicationReserveReads, budget.applicationReserveReads)
    && integer(receipt.metricLagReserveReads, budget.metricLagReserveReads)
    && receipt.totalReadCount + receipt.outstandingReservedReads + receipt.unreportedConsumedReads + receipt.applicationReserveReads
      + receipt.metricLagReserveReads <= DAILY_READ_LIMIT, 'FIRESTORE_READ_BUDGET_DENIED');
  return Object.freeze({reservationId: receipt.reservationId, projectId: receipt.projectId,
    operation: receipt.operation, maximumReads: receipt.reservedReads, expiresAtMs: receipt.expiresAtMs,
    quotaDay: receipt.quotaDay});
}

function validateClaims(claims, time, policy) {
  demand(object(claims) && id(claims.uid, 128) && claims.sub === claims.uid, 'FA_TOKEN_IDENTITY_INVALID');
  demand(claims.aud === FA && claims.iss === 'https://securetoken.google.com/' + FA, 'FA_TOKEN_PROJECT_INVALID');
  demand(claims.firebase?.sign_in_provider === 'google.com' && claims.email_verified === true, 'FA_TOKEN_PROVIDER_INVALID');
  demand(integer(claims.auth_time, 1) && integer(claims.iat, 1) && integer(claims.exp, 1)
    && claims.auth_time <= claims.iat && claims.iat < claims.exp
    && claims.iat * 1000 <= time + policy.maxFutureSkewMs
    && claims.exp * 1000 > time, 'FA_TOKEN_TIME_INVALID');
  const googleIds = claims.firebase?.identities?.['google.com'];
  demand(Array.isArray(googleIds) && googleIds.length === 1 && id(googleIds[0], 128), 'FA_GOOGLE_IDENTITY_INVALID');
  return {uid: claims.uid, googleUid: googleIds[0], authTimeMs: claims.auth_time * 1000, expiresAtMs: claims.exp * 1000};
}

function fresh(snapshot, projectId, time, policy, code) {
  demand(object(snapshot) && snapshot.schemaVersion === 1 && snapshot.projectId === projectId
    && snapshot.fromCache === false && snapshot.hasPendingWrites === false
    && integer(snapshot.readTimeMs) && snapshot.readTimeMs <= time + policy.maxFutureSkewMs
    && time - snapshot.readTimeMs <= policy.maxSnapshotAgeMs, code);
}

function identifiers(values, maximum, code) {
  demand(Array.isArray(values) && values.length <= maximum && values.every(value => id(value, 128))
    && new Set(values).size === values.length, code);
  return [...values].sort();
}

function validateSource(snapshot, verified, time, policy) {
  fresh(snapshot, FA, time, policy, 'FA_AUTHORIZATION_NOT_FRESH');
  demand(snapshot.consistentRead === true && snapshot.coverageComplete === true, 'FA_AUTHORIZATION_INCOMPLETE');
  demand(snapshot.productionAuthorized === true && integer(snapshot.authorizationVersion, 1), 'FA_PRODUCTION_AUTHORIZATION_REQUIRED');
  const {profile, binding, authUser, areas, documentAccess} = snapshot;
  demand(object(authUser) && authUser.uid === verified.uid && authUser.disabled === false
    && authUser.emailVerified === true && authUser.googleUid === verified.googleUid, 'FA_AUTH_USER_INVALID');
  demand(integer(authUser.tokensValidAfterTimeMs) && verified.authTimeMs >= authUser.tokensValidAfterTimeMs, 'FA_SESSION_REVOKED');
  demand(object(profile) && profile.uid === verified.uid && id(profile.memberId)
    && profile.active === true && profile.access === true, 'FA_PROFILE_REVOKED_OR_MISSING');
  demand(object(binding) && binding.sourceProjectId === FA && binding.destinationProjectId === FB
    && binding.faUid === verified.uid && binding.fbUid === verified.uid
    && binding.memberId === profile.memberId, 'FA_MEMBER_BINDING_INVALID');
  demand(typeof profile.role === 'string' && profile.role.length <= 100 && object(profile.permissions), 'FA_PERMISSIONS_INVALID');
  const effectivePermissions = {};
  for (const key of permissions) {
    demand(profile.permissions[key] === undefined || typeof profile.permissions[key] === 'boolean', 'FA_PERMISSIONS_INVALID');
    effectivePermissions[key] = profile.permissions[key] === true;
  }
  // Match the current FA administrator predicate; no role comes from the request.
  effectivePermissions.admin = profile.role === 'administrador_app' || effectivePermissions.admin;
  demand(Array.isArray(areas) && areas.length <= 1000, 'FA_AREA_RELATIONS_INVALID');
  const memberAreaIds = [], managerAreaIds = [], seenAreas = new Set();
  for (const area of areas) {
    demand(object(area) && id(area.id) && !seenAreas.has(area.id) && typeof area.active === 'boolean'
      && integer(area.version, 1), 'FA_AREA_RELATIONS_INVALID');
    seenAreas.add(area.id);
    const members = identifiers(area.memberUids, 100, 'FA_AREA_RELATIONS_INVALID');
    const managers = identifiers(area.managerUids, 100, 'FA_AREA_RELATIONS_INVALID');
    if (area.active) {
      if (members.includes(verified.uid)) memberAreaIds.push(area.id);
      if (managers.includes(verified.uid)) managerAreaIds.push(area.id);
    }
  }
  demand(object(documentAccess) && typeof documentAccess.active === 'boolean' && Array.isArray(documentAccess.groups)
    && documentAccess.groups.length <= 2 && new Set(documentAccess.groups).size === documentAccess.groups.length
    && documentAccess.groups.every(group => ['GENERAL', 'RESTRICTED'].includes(group)), 'FA_DOCUMENT_ACCESS_INVALID');
  if (documentAccess.active) demand(documentAccess.googleUid === verified.googleUid, 'FA_DOCUMENT_ACCESS_IDENTITY_INVALID');
  const documentGroups = documentAccess.active ? [...documentAccess.groups].sort() : [];
  const managementAllowed = Object.values(effectivePermissions).some(value => value)
    || memberAreaIds.length > 0 || managerAreaIds.length > 0 || documentGroups.length > 0;
  demand(managementAllowed, 'FA_MANAGEMENT_DENIED');
  const source = {
    sourceProjectId: FA, destinationProjectId: FB, faUid: binding.faUid, fbUid: binding.fbUid, memberId: binding.memberId, authorizationVersion: snapshot.authorizationVersion,
    active: true, managementAllowed, role: profile.role, permissions: effectivePermissions,
    memberAreaIds: memberAreaIds.sort(), managerAreaIds: managerAreaIds.sort(), documentGroups,
    sourceAuthValidAfterTimeMs: authUser.tokensValidAfterTimeMs, googleUid: verified.googleUid
  };
  return {...source, sourceHash: digest(source)};
}

function validateDestinationUser(snapshot, verified, time, policy) {
  fresh(snapshot, FB, time, policy, 'FB_AUTH_USER_NOT_FRESH');
  demand(object(snapshot.user), 'FB_AUTH_USER_MISSING');
  const user = snapshot.user;
  demand(user.uid === verified.uid && user.disabled === false && user.emailVerified === true, 'FB_AUTH_USER_INVALID');
  demand(Array.isArray(user.providerData) && user.providerData.length === 1
    && user.providerData[0].providerId === 'google.com' && user.providerData[0].uid === verified.googleUid, 'FB_GOOGLE_IDENTITY_MISMATCH');
  return {uid: user.uid, disabled: user.disabled, emailVerified: user.emailVerified, googleUid: user.providerData[0].uid};
}

function validatePriorLease(snapshot, source, time, policy) {
  fresh(snapshot, FB, time, policy, 'FB_LEASE_NOT_FRESH');
  demand(typeof snapshot.exists === 'boolean', 'FB_LEASE_CURRENT_INVALID');
  if (!snapshot.exists) {
    demand(snapshot.revision === null && snapshot.lease === null, 'FB_LEASE_CURRENT_INVALID');
    return {revision: null, leaseVersion: 0};
  }
  const lease = snapshot.lease;
  demand(id(snapshot.revision, 200) && object(lease) && lease.schemaVersion === 1
    && lease.sourceProjectId === FA && lease.destinationProjectId === FB
    && lease.faUid === source.faUid && lease.fbUid === source.fbUid && lease.memberId === source.memberId
    && integer(lease.leaseVersion, 1) && integer(lease.sourceVersion, 1)
    && typeof lease.active === 'boolean' && typeof lease.revoked === 'boolean'
    && typeof lease.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(lease.sourceHash), 'FB_LEASE_CURRENT_INVALID');
  demand(lease.sourceVersion <= source.authorizationVersion, 'FA_AUTHORIZATION_VERSION_STALE');
  if (lease.sourceVersion === source.authorizationVersion) {
    demand(lease.sourceHash === source.sourceHash, 'FA_AUTHORIZATION_VERSION_INCONSISTENT');
    demand(lease.revoked !== true, 'FB_AUTHORIZATION_REVOKED');
  }
  demand(Number.isSafeInteger(lease.leaseVersion + 1), 'FB_LEASE_VERSION_EXHAUSTED');
  return {revision: snapshot.revision, leaseVersion: lease.leaseVersion};
}

/**
 * A disabled, unhosted server core. Its adapters must use FA/FB Admin clients
 * with exact project IDs and a coherent, fresh FA authorization projection.
 * Signing is not authorization: FB Rules must enforce this lease themselves.
 */
export function createManagementAuthBroker({enabled = false, policy: suppliedPolicy, adapters = {}, clock = Date.now, newGrantId = randomUUID, onAudit = () => {}} = {}) {
  // Local replay/accounting checks complement, never replace, the durable budget ledger.
  const usedReservations = new Map(), projectReadFloors = new Map();
  const audit = (outcome, code, phase) => {
    try {
      const pending = onAudit(Object.freeze({outcome, code, phase, sourceProjectId: FA, destinationProjectId: FB}));
      if (pending && typeof pending.then === 'function') Promise.resolve(pending).catch(() => {});
    }
    catch { /* Audit presentation must never alter an authorization decision. */ }
  };
  async function exchange(body) {
    if (enabled !== true) return Object.freeze({ok: false, code: 'BROKER_DISABLED'});
    let phase = 'preflight', verified, source, prior, lease, customToken = null, faIdToken = null;
    let policy, startedAtMs, deadlineMs, wallDeadlineMs, cleanupDeadlineMs, cleanupWallDeadlineMs;
    let writeAttempted = false;
    const readClock = (cleanup = false) => {
      const result = clock();
      demand(integer(result), 'BROKER_CLOCK_INVALID');
      if (startedAtMs !== undefined) {
        demand(result + policy.maxFutureSkewMs >= startedAtMs, 'BROKER_CLOCK_REGRESSION');
        if (!cleanup) demand(result <= deadlineMs && performance.now() <= wallDeadlineMs, 'BROKER_DEADLINE_EXCEEDED');
      }
      return result;
    };
    const time = () => readClock(false);
    const runAdapter = async (name, code, args, cleanup = false) => {
      const start = readClock(cleanup);
      if (cleanup && cleanupDeadlineMs === undefined) {
        cleanupDeadlineMs = start + policy.cleanupTimeoutMs;
        cleanupWallDeadlineMs = performance.now() + policy.cleanupTimeoutMs;
      }
      let limit = cleanup ? cleanupDeadlineMs : deadlineMs;
      let wallLimit = cleanup ? cleanupWallDeadlineMs : wallDeadlineMs;
      const remaining = Math.min(limit - start, wallLimit - performance.now());
      const timeoutCode = cleanup ? 'BROKER_CLEANUP_DEADLINE_EXCEEDED' : 'BROKER_DEADLINE_EXCEEDED';
      demand(remaining > 0, timeoutCode);
      demand(typeof adapters[name] === 'function', 'BROKER_ADAPTER_UNAVAILABLE');
      let reservation;
      if (firestoreOperations[name]) {
        const request = Object.freeze({projectId: firestoreOperations[name], operation: name,
          maximumReads: policy.readBudget.operationReadBounds[name], dailyLimit: DAILY_READ_LIMIT,
          quotaTimezone: QUOTA_TIMEZONE, quotaDay: quotaDay(start),
          applicationReserveReads: policy.readBudget.applicationReserveReads,
          metricLagReserveReads: policy.readBudget.metricLagReserveReads});
        const receipt = await runAdapter('reserveFirestoreReads', 'FIRESTORE_READ_BUDGET_UNAVAILABLE', [request], cleanup);
        const reservationTime = readClock(cleanup);
        reservation = validateReservation(receipt, request, reservationTime, policy);
        for (const [key, expiresAtMs] of usedReservations) if (expiresAtMs <= reservationTime) usedReservations.delete(key);
        const reservationKey = reservation.projectId + ':' + reservation.reservationId;
        demand(!usedReservations.has(reservationKey), 'FIRESTORE_RESERVATION_REUSED');
        const previousFloor = projectReadFloors.get(reservation.projectId);
        const sameQuotaDay = previousFloor?.quotaDay === reservation.quotaDay;
        demand(!sameQuotaDay || receipt.totalReadCount >= previousFloor.maximumObservedReadCount,
          'FIRESTORE_READ_MEASUREMENT_REGRESSED');
        const minimumAccountedReads = Math.max(sameQuotaDay ? previousFloor.minimumAccountedReads : 0,
          receipt.totalReadCount) + request.maximumReads;
        demand(receipt.totalReadCount + receipt.outstandingReservedReads + receipt.unreportedConsumedReads
          >= minimumAccountedReads, 'FIRESTORE_RESERVATION_ACCOUNTING_INCOMPLETE');
        usedReservations.set(reservationKey, reservation.expiresAtMs);
        projectReadFloors.set(reservation.projectId, {quotaDay: reservation.quotaDay, minimumAccountedReads,
          maximumObservedReadCount: Math.max(sameQuotaDay ? previousFloor.maximumObservedReadCount : 0, receipt.totalReadCount)});
      }
      const beforeInvocation = readClock(cleanup);
      if (reservation) {
        limit = Math.min(limit, reservation.expiresAtMs);
        wallLimit = Math.min(wallLimit, performance.now() + reservation.expiresAtMs - beforeInvocation);
      }
      demand(Math.min(limit - beforeInvocation, wallLimit - performance.now()) > 0, timeoutCode);
      const controller = new AbortController();
      let timer;
      const context = Object.freeze({signal: controller.signal, deadlineMs: limit, firestoreReservation: reservation});
      try {
        const bounded = new Promise((resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new BrokerDenial(timeoutCode)); },
            Math.max(1, Math.ceil(Math.min(limit - readClock(cleanup), wallLimit - performance.now()))));
          Promise.resolve().then(() => {
            if (name === 'writeFbLease') writeAttempted = true;
            return adapters[name](...args, context);
          }).then(resolve, reject);
        });
        const result = await bounded;
        const completedAtMs = readClock(cleanup);
        demand(completedAtMs <= limit && performance.now() <= wallLimit, timeoutCode);
        return result;
      } catch (error) { if (error instanceof BrokerDenial) throw error; deny(code); }
      finally { clearTimeout(timer); }
    };
    const invoke = (name, code, ...args) => runAdapter(name, code, args);
    try {
      policy = validatePolicy(suppliedPolicy);
      demand(object(body) && typeof body.faIdToken === 'string' && body.faIdToken.length > 0 && body.faIdToken.length <= 16000, 'FA_TOKEN_REQUIRED');
      // Client UIDs, roles, permissions, binding, project and expiry fields are ignored.
      faIdToken = body.faIdToken;
      startedAtMs = readClock(); deadlineMs = startedAtMs + policy.maxExecutionMs;
      wallDeadlineMs = performance.now() + policy.maxExecutionMs;
      demand(Number.isSafeInteger(deadlineMs), 'BROKER_POLICY_INVALID');
      for (const name of ['verifyFaIdToken', 'readFaAuthorization', 'getFbUser', 'readFbLease', 'writeFbLease', 'invalidateFbLease', 'createFbCustomToken', 'reserveFirestoreReads']) demand(typeof adapters[name] === 'function', 'BROKER_ADAPTER_UNAVAILABLE');
      phase = 'verify-fa';
      verified = validateClaims(await invoke('verifyFaIdToken', 'FA_TOKEN_REJECTED', faIdToken, true), time(), policy);
      phase = 'read-source';
      source = validateSource(await invoke('readFaAuthorization', 'FA_AUTHORIZATION_READ_FAILED', {uid: verified.uid, projectId: FA}), verified, time(), policy);
      phase = 'read-target';
      const target = validateDestinationUser(await invoke('getFbUser', 'FB_AUTH_USER_READ_FAILED', {uid: verified.uid, projectId: FB}), verified, time(), policy);
      prior = validatePriorLease(await invoke('readFbLease', 'FB_LEASE_READ_FAILED', {uid: verified.uid, projectId: FB}), source, time(), policy);
      const confirmedAtMs = time(), grantId = newGrantId();
      demand(id(grantId, 100), 'BROKER_GRANT_ID_INVALID');
      const validUntilMs = Math.min(confirmedAtMs + policy.leaseDurationMs, verified.expiresAtMs);
      demand(integer(validUntilMs) && validUntilMs > confirmedAtMs, 'BROKER_POLICY_INVALID');
      lease = {
        schemaVersion: 1, sourceProjectId: FA, destinationProjectId: FB,
        faUid: source.faUid, fbUid: source.fbUid, memberId: source.memberId,
        leaseVersion: prior.leaseVersion + 1, grantId, sourceVersion: source.authorizationVersion,
        policyVersion: policy.version, sourceHash: source.sourceHash,
        active: true, revoked: false, managementAllowed: source.managementAllowed,
        role: source.role, permissions: copy(source.permissions), memberAreaIds: [...source.memberAreaIds],
        managerAreaIds: [...source.managerAreaIds], documentGroups: [...source.documentGroups],
        sourceAuthValidAfterTimeMs: source.sourceAuthValidAfterTimeMs, confirmedAtMs, validUntilMs
      };
      const claims = {
        managementSourceProjectId: FA, managementMemberId: source.memberId,
        managementSourceVersion: source.authorizationVersion, managementSourceHash: source.sourceHash,
        managementPolicyVersion: policy.version, managementSourceAuthTimeMs: verified.authTimeMs
      };
      demand(Buffer.byteLength(JSON.stringify(claims), 'utf8') <= 1000, 'FB_TOKEN_CLAIMS_TOO_LARGE');
      phase = 'sign-token';
      // A signed token is kept local until its lease and all final checks succeed.
      customToken = await invoke('createFbCustomToken', 'FB_TOKEN_SIGN_FAILED', verified.uid, claims);
      demand(typeof customToken === 'string' && customToken.length > 0 && customToken.length <= 16000, 'FB_TOKEN_SIGN_INVALID');
      const revalidate = async () => {
        const nextVerified = validateClaims(await invoke('verifyFaIdToken', 'FA_TOKEN_REJECTED', faIdToken, true), time(), policy);
        demand(same(nextVerified, verified), 'FA_SESSION_CHANGED');
        const nextSource = validateSource(await invoke('readFaAuthorization', 'FA_AUTHORIZATION_READ_FAILED', {uid: verified.uid, projectId: FA}), nextVerified, time(), policy);
        demand(nextSource.authorizationVersion === source.authorizationVersion && nextSource.sourceHash === source.sourceHash, 'FA_AUTHORIZATION_CHANGED');
        const nextTarget = validateDestinationUser(await invoke('getFbUser', 'FB_AUTH_USER_READ_FAILED', {uid: verified.uid, projectId: FB}), nextVerified, time(), policy);
        demand(same(nextTarget, target), 'FB_AUTH_USER_CHANGED');
        demand(lease.validUntilMs > time(), 'FB_LEASE_EXPIRED');
      };
      phase = 'revalidate-before-write';
      await revalidate();
      phase = 'commit-lease';
      // runAdapter marks the possible write only after its read reservation succeeds.
      const committed = await invoke('writeFbLease', 'FB_LEASE_WRITE_FAILED', {uid: verified.uid, projectId: FB, expectedRevision: prior.revision, lease: copy(lease)});
      if (committed?.applied === false) { writeAttempted = false; deny('FB_LEASE_CAS_CONFLICT'); }
      demand(committed?.applied === true && committed.projectId === FB && id(committed.revision, 200), 'FB_LEASE_WRITE_UNCONFIRMED');
      phase = 'revalidate-after-write';
      await revalidate();
      const accepted = await invoke('readFbLease', 'FB_LEASE_READ_FAILED', {uid: verified.uid, projectId: FB});
      fresh(accepted, FB, time(), policy, 'FB_LEASE_NOT_FRESH');
      demand(accepted.exists === true && accepted.revision === committed.revision && same(accepted.lease, lease), 'FB_LEASE_COMMIT_CHANGED');
      demand(lease.validUntilMs > time(), 'FB_LEASE_EXPIRED');
      phase = 'return-token';
      audit('granted', 'LEASE_CONFIRMED', phase);
      return Object.freeze({ok: true, sourceProjectId: FA, destinationProjectId: FB,
        faUid: source.faUid, fbUid: source.fbUid, memberId: source.memberId,
        leaseVersion: lease.leaseVersion, policyVersion: policy.version, customToken});
    } catch (error) {
      let code = error instanceof BrokerDenial ? error.code : 'BROKER_OPERATION_FAILED';
      let requiresReconciliation = false;
      if (writeAttempted && verified && lease) {
        try {
          // Only this grant/version may be invalidated. Never revoke a newer grant.
          const invalidated = await runAdapter('invalidateFbLease', 'FB_LEASE_CLEANUP_UNCONFIRMED', [{uid: verified.uid, projectId: FB,
            expectedGrantId: lease.grantId, expectedLeaseVersion: lease.leaseVersion, reasonCode: code}], true);
          demand(invalidated?.fenced === true && (invalidated.applied === true
            || (invalidated.applied === false && invalidated.matched === false)), 'FB_LEASE_CLEANUP_UNCONFIRMED');
        } catch { code = 'FB_LEASE_CLEANUP_FAILED'; requiresReconciliation = true; }
      }
      audit('denied', code, phase);
      return Object.freeze({ok: false, code, requiresReconciliation});
    } finally { faIdToken = null; customToken = null; }
  }
  return Object.freeze({exchange});
}
