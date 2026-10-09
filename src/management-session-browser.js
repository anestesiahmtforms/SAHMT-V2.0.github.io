import {normalizeManagementFirebaseConfig} from './management-firebase-config.js';

const FA = 'sahmt-17a16', FB = 'sahmt-gestao-5ae66', FB_NAME = 'sahmt-management';
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s/\x00-\x1f]/.test(value);
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
class AdapterError extends Error { constructor(code) { super(code); this.code = code; } }
const check = (value, code) => { if (!value) throw new AdapterError(code); };
const quotaDay = time => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(time));
const project = value => value?.app?.options?.projectId;
const binding = value => value ? {sourceProjectId: value.sourceProjectId, destinationProjectId: value.destinationProjectId,
  faUid: value.faUid, fbUid: value.fbUid, memberId: value.memberId} : null;
const validBinding = (value, uid, memberId) => value?.sourceProjectId === FA && value.destinationProjectId === FB
  && value.faUid === uid && value.fbUid === uid && value.memberId === memberId && id(memberId);
const defaultSdkLoader = async () => Object.assign({}, ...await Promise.all([
  import('firebase/app'), import('firebase/auth'), import('firebase/firestore')
]));

/** Preparation only; no UI import, Google popup, outbox or automatic broker connection. */
export async function createManagementBrowserAdapters({enabled = false, faAuth, faFirestore, fbConfig,
  sourceReference, sdkLoader = defaultSdkLoader, reserveFirestoreReads, policy, brokerTransport,
  now = Date.now, isOnline = () => globalThis.navigator?.onLine === true} = {}) {
  if (enabled !== true) return Object.freeze({enabled: false, adapters: Object.freeze({}),
    observeAuth: () => () => {}, refreshContexts: async () => null, dispose: () => {}});
  check(integer(policy?.operationTimeoutMs, 1) && policy.operationTimeoutMs <= 120000
    && integer(policy.cleanupTimeoutMs, 1) && policy.cleanupTimeoutMs <= 120000
    && integer(policy.maxMeasurementAgeMs, 1) && integer(policy.applicationReserveReads, 1)
    && integer(policy.metricLagReserveReads, 1) && integer(policy.sourceReadMaximum, 1)
    && integer(policy.leaseReadMaximum, 1) && integer(policy.sourceMaxAgeMs, 1)
    && integer(policy.sourceMaxLeaseMs, 1) && integer(policy.maxReservationRecords, 1)
    && policy.maxReservationRecords <= 1000000, 'BROWSER_ADAPTER_POLICY_REQUIRED');
  check(project(faAuth) === FA && project(faFirestore) === FA && faAuth.app === faFirestore.app
    && faAuth.app.name === 'sahmt-v2', 'FA_INSTANCE_MISMATCH');
  check(typeof sourceReference === 'function' && typeof reserveFirestoreReads === 'function', 'BROWSER_DATA_ADAPTER_REQUIRED');
  const config = normalizeManagementFirebaseConfig(fbConfig); check(config.valid, 'FB_CONFIG_INVALID');
  let sdk;
  try { sdk = await sdkLoader(); } catch { throw new AdapterError('BROWSER_SDK_LOAD_FAILED'); }
  for (const name of ['getApps', 'initializeApp', 'initializeAuth', 'getAuth', 'initializeFirestore', 'getFirestore',
    'memoryLocalCache', 'onAuthStateChanged', 'getIdToken', 'signInWithCustomToken', 'signOut', 'doc', 'getDocFromServer'])
    check(typeof sdk[name] === 'function', 'BROWSER_SDK_UNAVAILABLE');
  check(sdk.inMemoryPersistence, 'BROWSER_SDK_UNAVAILABLE');
  const sdkCall = (operation, code) => { try { return operation(); } catch { throw new AdapterError(code); } };
  let fbApp = sdkCall(() => sdk.getApps().find(app => app.name === FB_NAME), 'FB_APP_INIT_FAILED');
  if (fbApp) check(fbApp.options?.projectId === FB && fbApp.options?.appId === config.appId
    && fbApp.options?.authDomain === config.authDomain, 'FB_INSTANCE_MISMATCH');
  else fbApp = sdkCall(() => sdk.initializeApp(config, FB_NAME), 'FB_APP_INIT_FAILED');
  let fbAuth, fbFirestore;
  try { fbAuth = sdk.initializeAuth(fbApp, {persistence: sdk.inMemoryPersistence}); }
  catch (error) { if (error?.code !== 'auth/already-initialized') throw new AdapterError('FB_AUTH_INIT_FAILED'); fbAuth = sdkCall(() => sdk.getAuth(fbApp), 'FB_AUTH_INIT_FAILED'); }
  try { fbFirestore = sdk.initializeFirestore(fbApp, {localCache: sdk.memoryLocalCache()}); }
  catch (error) { if (!['failed-precondition', 'already-exists'].includes(error?.code)) throw new AdapterError('FB_FIRESTORE_INIT_FAILED'); fbFirestore = sdkCall(() => sdk.getFirestore(fbApp), 'FB_FIRESTORE_INIT_FAILED'); }
  check(project(fbAuth) === FB && project(fbFirestore) === FB && fbAuth.app === fbFirestore.app
    && fbAuth.app.name === FB_NAME && typeof faAuth.authStateReady === 'function'
    && typeof fbAuth.authStateReady === 'function', 'AUTH_INSTANCE_MISMATCH');
  let disposed = false, generation = 0, reconciliationRequired = false;
  const expectedMutations = new Map();
  const expectMutation = (which, uid) => {
    const marker = {uid}; expectedMutations.set(which, marker);
    return () => { if (expectedMutations.get(which) === marker) expectedMutations.delete(which); };
  };
  let lastFaUid, lastFbUid;
  const active = new Set(), listeners = new Set(), pendingFb = new Set(), usedReservations = new Map(), floors = new Map(), sourceVersions = new Map(), expiryTimers = new Map();
  const emit = code => { for (const listener of listeners) { try { listener(Object.freeze({code,
    faUid: faAuth.currentUser?.uid || null, fbUid: fbAuth.currentUser?.uid || null})); } catch {} } };
  const scheduleExpiry = (which, validUntilMs) => {
    clearTimeout(expiryTimers.get(which));
    expiryTimers.set(which, setTimeout(() => {
      expiryTimers.delete(which); if (disposed) return;
      generation++; for (const controller of active) controller.abort(); emit('AUTHORIZATION_LEASE_EXPIRED');
    }, Math.max(1, Math.min(2147483647, validUntilMs - now()))));
  };
  const onAuth = (which, user) => {
    const uid = user?.uid || null, prior = which === 'fa' ? lastFaUid : lastFbUid;
    if (which === 'fa') lastFaUid = uid; else lastFbUid = uid;
    if (prior === undefined || prior === uid) return;
    if (expectedMutations.get(which)?.uid === uid) return;
    generation++; for (const controller of active) controller.abort(); emit('AUTH_CONTEXT_CHANGED');
  };
  const subscriptions = [];
  try {
    subscriptions.push(sdk.onAuthStateChanged(faAuth, user => onAuth('fa', user)));
    subscriptions.push(sdk.onAuthStateChanged(fbAuth, user => onAuth('fb', user)));
    check(subscriptions.every(unsubscribe => typeof unsubscribe === 'function'), 'AUTH_OBSERVER_INIT_FAILED');
  } catch {
    for (const unsubscribe of subscriptions) { try { unsubscribe?.(); } catch {} }
    throw new AdapterError('AUTH_OBSERVER_INIT_FAILED');
  }
  const context = () => {
    check(!disposed, 'BROWSER_ADAPTER_DISPOSED');
    const start = now(); check(integer(start), 'BROWSER_CLOCK_INVALID');
    const controller = new AbortController(); active.add(controller);
    return {generation, controller, deadline: start + policy.operationTimeoutMs,
      wallDeadline: performance.now() + policy.operationTimeoutMs};
  };
  const assertCurrent = ctx => check(!disposed && ctx.generation === generation && !ctx.controller.signal.aborted, 'BROWSER_CONTEXT_CHANGED');
  const bounded = async (work, ctx, code, maximumDeadline = ctx.deadline) => {
    assertCurrent(ctx);
    const deadline = Math.min(ctx.deadline, maximumDeadline);
    const wallDeadline = Math.min(ctx.wallDeadline, performance.now() + deadline - now());
    const remaining = Math.min(deadline - now(), wallDeadline - performance.now());
    check(remaining > 0, 'BROWSER_OPERATION_TIMEOUT');
    let timer, abort, timedOut = false;
    try {
      const cancelled = new Promise((_, reject) => {
        abort = () => reject(new AdapterError(timedOut ? 'BROWSER_OPERATION_TIMEOUT' : 'BROWSER_CONTEXT_CHANGED'));
        ctx.controller.signal.addEventListener('abort', abort, {once: true});
        timer = setTimeout(() => { timedOut = true; ctx.controller.abort(); reject(new AdapterError('BROWSER_OPERATION_TIMEOUT')); }, Math.max(1, Math.ceil(remaining)));
      });
      const result = await Promise.race([Promise.resolve().then(() => {
        assertCurrent(ctx);
        check(now() < deadline && performance.now() < wallDeadline, 'BROWSER_OPERATION_TIMEOUT');
        return work();
      }), cancelled]);
      assertCurrent(ctx); check(now() < deadline && performance.now() < wallDeadline, 'BROWSER_OPERATION_TIMEOUT');
      return result;
    } catch (error) { if (error instanceof AdapterError) throw error; throw new AdapterError(code); }
    finally { clearTimeout(timer); ctx.controller.signal.removeEventListener('abort', abort); }
  };
  const finish = ctx => { active.delete(ctx.controller); };
  const ready = ctx => bounded(() => Promise.all([faAuth.authStateReady(), fbAuth.authStateReady()]), ctx, 'AUTH_RESTORATION_FAILED');
  const expectedUser = (auth, uid, code) => {
    const user = auth.currentUser;
    check(user && user.uid === uid && id(uid) && uid.length <= 128, code); return user;
  };
  const guard = async (projectId, operation, maximumReads, ctx) => {
    const request = Object.freeze({projectId, operation, maximumReads, dailyLimit: 35000,
      quotaTimezone: 'America/Los_Angeles', quotaDay: quotaDay(now()),
      applicationReserveReads: policy.applicationReserveReads, metricLagReserveReads: policy.metricLagReserveReads});
    const receipt = await bounded(() => reserveFirestoreReads(request, {signal: ctx.controller.signal, deadlineMs: ctx.deadline}), ctx, 'FIRESTORE_BUDGET_UNAVAILABLE');
    const time = now();
    check(receipt?.schemaVersion === 1 && receipt.projectId === projectId && receipt.operation === operation
      && id(receipt.reservationId) && receipt.dailyLimit === 35000 && receipt.quotaTimezone === request.quotaTimezone
      && receipt.quotaDay === quotaDay(time) && receipt.pausedRequiresReview === false && receipt.metricsComplete === true
      && integer(receipt.measurementTimeMs) && receipt.measurementTimeMs <= time
      && quotaDay(receipt.measurementTimeMs) === receipt.quotaDay && time - receipt.measurementTimeMs <= policy.maxMeasurementAgeMs
      && integer(receipt.expiresAtMs) && receipt.expiresAtMs > time && receipt.reservedReads === maximumReads
      && integer(receipt.totalReadCount) && integer(receipt.outstandingReservedReads, maximumReads)
      && integer(receipt.unreportedConsumedReads) && integer(receipt.applicationReserveReads, policy.applicationReserveReads)
      && integer(receipt.metricLagReserveReads, policy.metricLagReserveReads)
      && receipt.totalReadCount + receipt.outstandingReservedReads + receipt.unreportedConsumedReads
        + receipt.applicationReserveReads + receipt.metricLagReserveReads <= 35000, 'FIRESTORE_BUDGET_DENIED');
    const key = projectId + ':' + receipt.reservationId, prior = floors.get(projectId), sameDay = prior?.quotaDay === receipt.quotaDay;
    check(!usedReservations.has(key), 'FIRESTORE_RESERVATION_REUSED');
    check(usedReservations.size < policy.maxReservationRecords, 'FIRESTORE_RESERVATION_CAPACITY_EXCEEDED');
    check(!sameDay || receipt.totalReadCount >= prior.maximumObservedReadCount, 'FIRESTORE_MEASUREMENT_REGRESSED');
    const minimum = Math.max(sameDay ? prior.minimumAccountedReads : 0, receipt.totalReadCount) + maximumReads;
    check(receipt.totalReadCount + receipt.outstandingReservedReads + receipt.unreportedConsumedReads >= minimum, 'FIRESTORE_ACCOUNTING_INCOMPLETE');
    usedReservations.set(key, receipt.expiresAtMs);
    floors.set(projectId, {quotaDay: receipt.quotaDay, minimumAccountedReads: minimum, maximumObservedReadCount: receipt.totalReadCount});
    return {expiresAtMs: receipt.expiresAtMs, quotaDay: receipt.quotaDay};
  };
  const read = async (ref, projectId, operation, maximumReads, uid, ctx) => {
    check(ref?.firestore === (projectId === FA ? faFirestore : fbFirestore)
      && ref.firestore.app?.options?.projectId === projectId && ref.id === uid, 'DOCUMENT_REFERENCE_MISMATCH');
    const receipt = await guard(projectId, operation, maximumReads, ctx);
    const snapshot = await bounded(() => {
      check(receipt.expiresAtMs > now() && receipt.quotaDay === quotaDay(now()), 'FIRESTORE_RESERVATION_EXPIRED');
      check((projectId === FA ? faAuth : fbAuth).currentUser?.uid === uid, 'DOCUMENT_UID_CHANGED');
      return sdk.getDocFromServer(ref);
    }, ctx, 'SERVER_DOCUMENT_UNAVAILABLE', receipt.expiresAtMs);
    check(receipt.expiresAtMs > now() && receipt.quotaDay === quotaDay(now()), 'FIRESTORE_RESERVATION_EXPIRED');
    check(snapshot?.metadata?.fromCache === false && snapshot.metadata.hasPendingWrites === false
      && snapshot.id === uid && snapshot.ref?.path === ref.path, 'SERVER_DOCUMENT_NOT_CONFIRMED');
    check(typeof snapshot.exists === 'function' && snapshot.exists() === true && typeof snapshot.data === 'function', 'SERVER_DOCUMENT_MISSING');
    return snapshot.data();
  };
  const sourceBody = async ctx => {
    await ready(ctx); const user = faAuth.currentUser;
    if (!user) return {restored: true, online: isOnline() === true, user: null};
    check(id(user.uid) && user.uid.length <= 128, 'FA_UID_INVALID');
    if (isOnline() !== true) return {restored: true, online: false, user: {uid: user.uid}};
    const data = await read(sourceReference({uid: user.uid, firestore: faFirestore, sdk}), FA, 'readFaSourceContext', policy.sourceReadMaximum, user.uid, ctx);
    check(faAuth.currentUser === user, 'FA_UID_CHANGED');
    check(data?.schemaVersion === 1 && data.sourceProjectId === FA && data.destinationProjectId === FB
      && data.productionAuthorized === true && integer(data.sourceVersion, 1)
      && data.profile?.uid === user.uid && id(data.profile.memberId)
      && typeof data.profile.active === 'boolean' && typeof data.profile.access === 'boolean'
      && typeof data.managementAllowed === 'boolean' && validBinding(data.binding, user.uid, data.profile.memberId)
      && typeof data.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(data.sourceHash)
      && integer(data.confirmedAtMs) && integer(data.validUntilMs), 'FA_PROJECTION_INVALID');
    check(data.confirmedAtMs <= now() && data.validUntilMs > now()
      && data.validUntilMs > data.confirmedAtMs && now() - data.confirmedAtMs <= policy.sourceMaxAgeMs
      && data.validUntilMs - data.confirmedAtMs <= policy.sourceMaxLeaseMs, 'FA_PROJECTION_EXPIRED');
    const previousVersion = sourceVersions.get(user.uid);
    check(!previousVersion || data.sourceVersion >= previousVersion.sourceVersion, 'FA_PROJECTION_VERSION_REGRESSED');
    check(!previousVersion || data.sourceVersion !== previousVersion.sourceVersion
      || data.sourceHash === previousVersion.sourceHash, 'FA_PROJECTION_VERSION_INCONSISTENT');
    sourceVersions.set(user.uid, {sourceVersion: data.sourceVersion, sourceHash: data.sourceHash});
    scheduleExpiry('fa', data.validUntilMs);
    return {restored: true, online: true, user: {uid: user.uid}, profile: {uid: user.uid,
      memberId: data.profile.memberId, active: data.profile.active, access: data.profile.access},
      managementAllowed: data.managementAllowed, binding: binding(data.binding), fromCache: false, hasPendingWrites: false,
      sourceEvidence: {sourceVersion: data.sourceVersion, sourceHash: data.sourceHash, confirmedAtMs: data.confirmedAtMs, validUntilMs: data.validUntilMs}};
  };
  let sourceInFlight = null;
  const source = ctx => {
    if (sourceInFlight?.generation === ctx.generation) {
      const shared = sourceInFlight.promise; return bounded(() => shared, ctx, 'FA_PROJECTION_UNAVAILABLE');
    }
    const holder = {generation: ctx.generation, promise: null};
    holder.promise = Promise.resolve().then(() => sourceBody(ctx)).finally(() => { if (sourceInFlight === holder) sourceInFlight = null; });
    sourceInFlight = holder; return holder.promise;
  };
  const target = async (ctx, suppliedUid) => {
    await ready(ctx); const user = fbAuth.currentUser, expectedUid = suppliedUid ?? faAuth.currentUser?.uid;
    check(pendingFb.size === 0 && !reconciliationRequired, 'FB_RECONCILIATION_REQUIRED');
    if (!user) return {restored: true, user: null, mirror: null};
    check(user.uid === expectedUid && id(user.uid) && user.uid.length <= 128, 'FB_UID_CHANGED');
    check(isOnline() === true, 'FB_OFFLINE');
    const sourceContext = await source(ctx);
    check(sourceContext.profile?.active === true && sourceContext.profile.access === true
      && sourceContext.managementAllowed === true && sourceContext.user?.uid === expectedUid, 'FA_SOURCE_DENIED');
    const ref = sdk.doc(fbFirestore, 'managementAuthorizationLeases', user.uid);
    const data = await read(ref, FB, 'readFbLease', policy.leaseReadMaximum, user.uid, ctx);
    check(fbAuth.currentUser === user && faAuth.currentUser?.uid === expectedUid, 'FB_UID_CHANGED');
    check(data?.schemaVersion === 1 && validBinding(data, expectedUid, data.memberId)
      && integer(data.sourceVersion, 1) && integer(data.leaseVersion, 1) && id(data.policyVersion)
      && data.sourceVersion === sourceContext.sourceEvidence.sourceVersion
      && data.sourceHash === sourceContext.sourceEvidence.sourceHash && data.memberId === sourceContext.profile.memberId
      && typeof data.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(data.sourceHash)
      && typeof data.active === 'boolean' && typeof data.revoked === 'boolean' && typeof data.managementAllowed === 'boolean'
      && integer(data.confirmedAtMs) && integer(data.validUntilMs) && data.confirmedAtMs <= now()
      && data.validUntilMs > data.confirmedAtMs, 'FB_LEASE_INVALID');
    check(data.validUntilMs > now() && sourceContext.sourceEvidence.validUntilMs > now(), 'FB_LEASE_EXPIRED');
    scheduleExpiry('fb', Math.min(data.validUntilMs, sourceContext.sourceEvidence.validUntilMs));
    return {restored: true, user: {uid: user.uid}, mirror: {...binding(data), active: data.active && !data.revoked,
      managementAllowed: data.managementAllowed, confirmedAtMs: data.confirmedAtMs, validUntilMs: data.validUntilMs,
      fromCache: false, hasPendingWrites: false}};
  };
  const execute = work => async (...args) => { let ctx;
    try { ctx = context(); return await work(ctx, ...args); }
    catch (error) { if (error instanceof AdapterError) throw error; throw new AdapterError('BROWSER_ADAPTER_FAILED'); }
    finally { if (ctx) finish(ctx); }
  };
  const cleanupOwned = async (user, repair = false) => {
    if (!user || fbAuth.currentUser !== user) return;
    const clearExpected = expectMutation('fb', null);
    const raw = Promise.resolve().then(() => {
      check(fbAuth.currentUser === user, 'FB_UID_CHANGED'); return sdk.signOut(fbAuth);
    }).then(() => { check(fbAuth.currentUser === null, 'FB_CLEANUP_UNCONFIRMED'); });
    pendingFb.add(raw);
    raw.finally(() => { pendingFb.delete(raw); clearExpected(); }).catch(() => {});
    let timer;
    try {
      await Promise.race([raw, new Promise((_, reject) => { timer = setTimeout(() => reject(new AdapterError('FB_CLEANUP_TIMEOUT')), policy.cleanupTimeoutMs); })]);
      if (repair) reconciliationRequired = false;
    } catch (error) { reconciliationRequired = true; throw error; }
    finally { clearTimeout(timer); }
  };
  const adapters = {
    restoreFa: execute(source), restoreFb: execute(target),
    getFaIdToken: execute(async (ctx, {expectedUid, forceRefresh}) => {
      await ready(ctx); check(forceRefresh === true && isOnline() === true, 'FA_TOKEN_REQUEST_INVALID');
      const user = expectedUser(faAuth, expectedUid, 'FA_UID_CHANGED');
      const token = await bounded(() => {
        check(faAuth.currentUser === user, 'FA_UID_CHANGED'); return sdk.getIdToken(user, true);
      }, ctx, 'FA_TOKEN_UNAVAILABLE');
      check(faAuth.currentUser === user && typeof token === 'string' && token.length > 0 && token.length <= 16000, 'FA_TOKEN_UNAVAILABLE'); return token;
    }),
    exchangeFaToken: execute(async (ctx, request) => {
      await ready(ctx);
      const user = expectedUser(faAuth, request?.faUid, 'FA_UID_CHANGED');
      check(brokerTransport && typeof brokerTransport.exchange === 'function', 'BROKER_UNAVAILABLE');
      const response = await bounded(() => {
        check(faAuth.currentUser === user, 'FA_UID_CHANGED');
        return brokerTransport.exchange(request, {signal: ctx.controller.signal});
      }, ctx, 'BROKER_EXCHANGE_FAILED');
      check(faAuth.currentUser === user && validBinding(response, user.uid, request.memberId)
        && typeof response.customToken === 'string' && response.customToken.length > 0 && response.customToken.length <= 16000, 'BROKER_RESPONSE_INVALID'); return response;
    }),
    signInFb: execute(async (ctx, {expectedUid, customToken}) => {
      await ready(ctx);
      const faUser = expectedUser(faAuth, expectedUid, 'FA_UID_CHANGED');
      check(pendingFb.size === 0 && !reconciliationRequired
        && (!fbAuth.currentUser || fbAuth.currentUser.uid === expectedUid), 'FB_RECONCILIATION_REQUIRED');
      check(typeof customToken === 'string' && customToken.length > 0 && customToken.length <= 16000, 'FB_TOKEN_INVALID');
      const clearExpected = expectMutation('fb', expectedUid);
      const raw = Promise.resolve().then(() => {
        assertCurrent(ctx);
        check(now() < ctx.deadline && performance.now() < ctx.wallDeadline, 'BROWSER_OPERATION_TIMEOUT');
        check(faAuth.currentUser === faUser && (!fbAuth.currentUser || fbAuth.currentUser.uid === expectedUid), 'FB_UID_CHANGED');
        return sdk.signInWithCustomToken(fbAuth, customToken);
      }); pendingFb.add(raw);
      let credential;
      try { credential = await bounded(() => raw, ctx, 'FB_SIGN_IN_FAILED'); }
      catch (error) {
        raw.then(async result => { try { await cleanupOwned(result.user); } catch { emit('FB_RECONCILIATION_REQUIRED'); } })
          .catch(() => {}).finally(() => { pendingFb.delete(raw); clearExpected(); });
        throw error;
      }
      pendingFb.delete(raw); clearExpected();
      try {
        check(credential?.user && credential.user.uid === expectedUid && fbAuth.currentUser === credential.user
          && faAuth.currentUser?.uid === expectedUid, 'FB_UID_CHANGED');
        return await target(ctx, expectedUid);
      } catch (error) { try { await cleanupOwned(credential?.user); } catch { throw new AdapterError('FB_CLEANUP_FAILED'); } throw error; }
    }),
    signOutFa: execute(async (ctx, {expectedUid}) => {
      await ready(ctx);
      const user = faAuth.currentUser; if (!user) return;
      check(user.uid === expectedUid, 'FA_UID_CHANGED'); const clearExpected = expectMutation('fa', null);
      try { await bounded(() => {
        check(faAuth.currentUser === user, 'FA_UID_CHANGED'); return sdk.signOut(faAuth);
      }, ctx, 'FA_SIGN_OUT_FAILED'); }
      finally { clearExpected(); }
    }),
    signOutFb: execute(async (ctx, {expectedUid}) => {
      await ready(ctx);
      const user = fbAuth.currentUser;
      check(pendingFb.size === 0, 'FB_RECONCILIATION_REQUIRED');
      if (!user) { reconciliationRequired = false; return; }
      check(user.uid === expectedUid, 'FB_UID_CHANGED'); await bounded(() => cleanupOwned(user, true), ctx, 'FB_SIGN_OUT_FAILED');
    })
  };
  return Object.freeze({enabled: true, adapters: Object.freeze(adapters),
    observeAuth: listener => { check(!disposed && typeof listener === 'function', 'AUTH_OBSERVER_INVALID'); listeners.add(listener); return () => listeners.delete(listener); },
    refreshContexts: async () => { const [fa, fb] = await Promise.all([adapters.restoreFa(), adapters.restoreFb()]); return Object.freeze({fa, fb}); },
    dispose: () => { disposed = true; generation++; for (const controller of active) controller.abort();
      for (const unsubscribe of subscriptions) unsubscribe(); for (const timer of expiryTimers.values()) clearTimeout(timer);
      expiryTimers.clear(); active.clear(); listeners.clear(); brokerTransport?.dispose?.(); }
  });
}
