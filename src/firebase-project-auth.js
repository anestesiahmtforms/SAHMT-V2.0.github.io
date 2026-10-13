import {FIREBASE_PROJECTS} from './firebase-projects.js';
import {sanitizedProjectBrokerFailure, sanitizedManagementPilotDiagnostic} from './firebase-project-broker-errors.js';

const FA = FIREBASE_PROJECTS.FA.projectId;
const DEFAULT_TARGETS = Object.freeze(['FB', 'FC']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s/\x00-\x1f]/.test(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const failure = code => Object.freeze({status: 'unavailable', code});
const TARGET_TIMEOUT = Symbol('TARGET_TIMEOUT');

function validTargetResult(value, projectId, faUid) {
  if (!plain(value) || value.projectId !== projectId) return failure('BROKER_TARGET_INVALID');
  if (value.status === 'DENIED' || value.status === 'UNAVAILABLE') {
    if(!exact(value, ['projectId', 'status', 'code', ...(Object.hasOwn(value,'diagnostic')?['diagnostic']:[])])
      || !/^[A-Z][A-Z0-9_]{1,79}$/.test(value.code)) return failure('BROKER_TARGET_INVALID');
    const diagnostic=sanitizedManagementPilotDiagnostic(value.diagnostic);
    return Object.freeze({...failure(value.code),...(diagnostic?{diagnostic}:{})});
  }
  if (!exact(value, ['projectId', 'status', 'uid', 'customToken']) || value.status !== 'READY'
    || value.uid !== faUid || typeof value.customToken !== 'string' || value.customToken.length < 1 || value.customToken.length > 16000)
    return failure('BROKER_TARGET_INVALID');
  return Object.freeze({status: 'ready', projectId: value.projectId, customToken: value.customToken});
}

/** One user action, one FA proof, target-specific tokens and independent Auth sessions. */
export function createFirebaseProjectAuthCoordinator({enabled = false, faAuth, targets = {}, broker,
  targetNames = DEFAULT_TARGETS, signInWithCustomToken, now = Date.now, timeoutMs = 20000} = {}) {
  if (enabled !== true) return Object.freeze({enabled: false, connect: async () => Object.freeze({status: 'disabled'}), dispose: () => {}});
  const names = Array.isArray(targetNames) ? [...targetNames] : [];
  if (!names.length || new Set(names).size !== names.length || names.some(name => typeof name !== 'string'
    || name === 'FA' || !FIREBASE_PROJECTS[name]?.projectId)) throw new Error('FIREBASE_PROJECT_TARGETS_INVALID');
  const projectIds = Object.freeze(Object.fromEntries(names.map(name => [name, FIREBASE_PROJECTS[name].projectId])));
  if (!faAuth || typeof broker?.exchangeTargets !== 'function' || typeof signInWithCustomToken !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000 || typeof now !== 'function')
    throw new Error('FIREBASE_PROJECT_AUTH_CONFIG_INVALID');

  let disposed = false, generation = 0, pending = null, targetAttemptSequence = 0;
  const latestTargetAttempt = new Map();
  const connect = (requestedTargetNames = names) => {
    if (disposed) return Promise.resolve(Object.freeze({status: 'unavailable', code: 'COORDINATOR_DISPOSED'}));
    const selectedNames = Array.isArray(requestedTargetNames) ? [...requestedTargetNames] : [];
    if (!selectedNames.length || new Set(selectedNames).size !== selectedNames.length
      || selectedNames.some(name => !names.includes(name)))
      return Promise.resolve(Object.freeze({status: 'blocked', code: 'FIREBASE_PROJECT_TARGETS_INVALID', targets: Object.freeze({})}));
    if (pending) return pending;
    const selectedProjectIds = Object.freeze(Object.fromEntries(selectedNames.map(name => [name, FIREBASE_PROJECTS[name].projectId])));
    const faUser = faAuth.currentUser;
    if (!faUser || !id(faUser.uid)) return Promise.resolve(Object.freeze({status: 'blocked', code: 'FA_SESSION_MISSING', targets: Object.freeze({})}));
    const myGeneration = ++generation, start = now();
    if (!Number.isSafeInteger(start) || start < 1) return Promise.resolve(Object.freeze({status: 'unavailable', code: 'CLOCK_INVALID', targets: Object.freeze({})}));
    const controller = new AbortController();
    let timer, phase = 'broker';
    const isCurrent = () => !disposed && generation === myGeneration && faAuth.currentUser === faUser;
    const work = (async () => {
      let faIdToken = null;
      try {
        const user = faAuth.currentUser;
        if (user !== faUser) return Object.freeze({status: 'blocked', code: 'FA_CONTEXT_CHANGED', targets: Object.freeze({})});
        faIdToken = await user.getIdToken(true);
        if (typeof faIdToken !== 'string' || !faIdToken.length || faAuth.currentUser !== faUser)
          return Object.freeze({status: 'blocked', code: 'FA_TOKEN_INVALID', targets: Object.freeze({})});
        const response = await broker.exchangeTargets(Object.freeze({faIdToken, sourceProjectId: FA,
          targetProjectIds: selectedProjectIds}), Object.freeze({signal: controller.signal, deadlineMs: start + timeoutMs}));
        faIdToken = null;
        if (!isCurrent())
          return Object.freeze({status: 'blocked', code: 'FA_CONTEXT_CHANGED', targets: Object.freeze({})});
        if (!exact(response, ['schemaVersion', 'sourceProjectId', 'faUid', 'targets']) || response.schemaVersion !== 1
          || response.sourceProjectId !== FA || response.faUid !== faUser.uid || !exact(response.targets, selectedNames))
          return Object.freeze({status: 'blocked', code: 'BROKER_RESPONSE_INVALID', targets: Object.freeze({})});

        clearTimeout(timer);
        phase = 'targets';
        const results = await Promise.all(selectedNames.map(async name => {
          const credential = validTargetResult(response.targets[name], selectedProjectIds[name], faUser.uid);
          if (credential.status !== 'ready') return credential;
          const target = targets[name], auth = target?.auth;
          if (!auth || auth.app?.options?.projectId !== projectIds[name]
            || typeof target.signOut !== 'function') return failure('TARGET_AUTH_UNAVAILABLE');
          const priorUser = auth.currentUser;
          if (priorUser && priorUser.uid !== faUser.uid) return failure('TARGET_UID_MISMATCH');
          if (!isCurrent()) return failure('SOURCE_SESSION_CHANGED');
          const attemptId = ++targetAttemptSequence;
          latestTargetAttempt.set(name, attemptId);
          let targetTimer, signed;
          const signIn = Promise.resolve().then(() => signInWithCustomToken(auth, credential.customToken));
          try {
            signed = await Promise.race([signIn, new Promise(resolve => {
              targetTimer = setTimeout(() => resolve(TARGET_TIMEOUT), timeoutMs);
            })]);
          } catch { clearTimeout(targetTimer); return failure('TARGET_SIGN_IN_FAILED'); }
          clearTimeout(targetTimer);
          if (signed === TARGET_TIMEOUT) {
            // A late SDK completion can clean only the session owned by this
            // attempt; a newer connection for this target wins the ownership.
            signIn.then(async late => {
              if (latestTargetAttempt.get(name) === attemptId && late?.user && auth.currentUser === late.user) {
                try { await target.signOut(auth); } catch { /* The target remains isolated; report reconciliation on next restore. */ }
              }
            }).catch(() => {});
            return failure('TARGET_SIGN_IN_TIMEOUT');
          }
          try {
            if (!isCurrent()
              || signed?.user?.uid !== faUser.uid || auth.currentUser !== signed.user) {
              // A timeout/dispose can win while Firebase Auth is still finishing.
              // Remove only the session created by this attempt, never a newer one.
              if (latestTargetAttempt.get(name) === attemptId && signed?.user && auth.currentUser === signed.user) {
                try { await target.signOut(auth); }
                catch { return failure('TARGET_RECONCILIATION_REQUIRED'); }
              }
              return failure('TARGET_SESSION_INVALID');
            }
            return Object.freeze({status: 'ready', projectId: projectIds[name], uid: signed.user.uid});
          } catch { return failure('TARGET_SIGN_IN_FAILED'); }
        }));
        const byTarget = Object.freeze(Object.fromEntries(selectedNames.map((name, index) => [name, results[index]])));
        return Object.freeze({status: results.every(value => value.status === 'ready') ? 'ready'
          : results.some(value => value.status === 'ready') ? 'partial' : 'blocked', targets: byTarget});
      } catch (error) {
        faIdToken = null;
        const diagnostic = controller.signal.aborted ? {code: 'CONNECT_TIMEOUT', httpStatus: null} : sanitizedProjectBrokerFailure(error);
        return Object.freeze({status: 'unavailable', ...diagnostic, targets: Object.freeze({})});
      } finally { faIdToken = null; }
    })();
    const timed = new Promise(resolve => { timer = setTimeout(() => {
      if (phase !== 'broker') return;
      if (generation === myGeneration) generation++;
      controller.abort(); resolve(Object.freeze({status: 'unavailable', code: 'CONNECT_TIMEOUT', targets: Object.freeze({})}));
    }, timeoutMs); });
    const attempt = Promise.race([work, timed]).finally(() => {
      clearTimeout(timer);
      if (pending === attempt) pending = null;
    });
    pending = attempt;
    return attempt;
  };
  return Object.freeze({enabled: true, connect, dispose: () => { disposed = true; generation++; }});
}
