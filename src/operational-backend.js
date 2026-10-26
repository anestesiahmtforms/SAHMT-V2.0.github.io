import {firebaseFailureCode} from './firebase-failure.js';
import {deployment} from './deployment-context.js';
// Coordinates application reads. It does not create polling or background network traffic.
export function createOperationalBackend({now = Date.now, random = Math.random, timeoutMs = 7000, notify = () => {}, storage = null} = {}) {
  const pending = new Map(), denied = new Map(), lateObservers = new Map();
  let code = '', failures = 0, failureEpoch = 0, nextRetryAt = 0, calls = 0, documentsReceived = 0;
  let quotaRetryAt = 0;
  const storageKey = deployment.target === 'FB' ? 'sahmt-fb-firestore-read-backoff-v1' : 'sahmt-firestore-read-backoff-v1';
  try {
    const stored = JSON.parse(storage?.getItem(storageKey) || 'null');
    if (Number.isFinite(stored?.retryAt) && stored.retryAt > now() && stored.retryAt <= now() + 2 * 3600000) {
      quotaRetryAt = stored.retryAt; code = 'resource-exhausted'; nextRetryAt = quotaRetryAt;
    }
  } catch { /* Storage denial must not break startup. */ }
  const snapshot = () => ({code: quotaRetryAt > now() ? 'resource-exhausted' : code, failures, nextRetryAt: Math.max(nextRetryAt, quotaRetryAt), calls, documentsReceived, inFlight: pending.size});
  const publish = () => {try {notify(snapshot());} catch {}};
  const normalize = firebaseFailureCode;
  const failure = (error, key) => {
    const value = normalize(error);
    if (['permission-denied', 'unauthenticated'].includes(value)) denied.set(key, value);
    if (['resource-exhausted', 'unavailable', 'deadline-exceeded', 'network-request-failed'].includes(value)) {
      code = value; failures++; failureEpoch++;
      const base = value === 'resource-exhausted' ? 300000 : 5000;
      const delay = Math.min(3600000, base * 2 ** Math.min(failures - 1, 6));
      nextRetryAt = Math.max(quotaRetryAt, now() + Math.round(delay * (1 + Math.max(0, Math.min(1, random())) * .25)));
      if (value === 'resource-exhausted') {
        quotaRetryAt = nextRetryAt;
        try { storage?.setItem(storageKey, JSON.stringify({retryAt: quotaRetryAt})); } catch {}
      }
      publish();
    }
  };
  const assertCacheAllowed = key => {
    if (denied.has(key)) throw Object.assign(new Error('O acesso remoto a este dado foi recusado.'), {code: denied.get(key)});
  };
  const run = (key, task, {force = false, onLateResult} = {}) => {
    const observe = () => {if (typeof onLateResult === 'function') lateObservers.get(key)?.add(onLateResult);};
    const previous = pending.get(key);
    // A page departure can strand a request inside the browser/SDK. Only a
    // timed-out, interrupted read may be replaced, after the existing backoff.
    if (previous?.interrupted && previous.timedOut && nextRetryAt <= now() && quotaRetryAt <= now()) {
      pending.delete(key);lateObservers.delete(key);
    } else if (previous) {observe(); return previous.promise;}
    // Reload, reconnect and explicit refresh do not bypass a known quota failure.
    if (quotaRetryAt > now()) return Promise.reject(Object.assign(new Error('Atualização remota aguardando a recuperação da cota.'), {code: 'resource-exhausted', retryAt: quotaRetryAt, circuitOpen: true}));
    if (!force) {
      try {assertCacheAllowed(key);} catch (error) {return Promise.reject(error);}
      if (nextRetryAt > now()) return Promise.reject(Object.assign(new Error('Atualização remota temporariamente suspensa.'), {code, retryAt: nextRetryAt, circuitOpen: true}));
    }
    let timer, timedOut = false, rejectedEpoch; const startedEpoch = failureEpoch;
    const entry = {promise:null, timedOut:false, interrupted:false};
    const current = () => pending.get(key) === entry;
    lateObservers.set(key, new Set()); observe();
    calls++;
    const taskPromise = Promise.resolve().then(task);
    const operation = Promise.race([
      taskPromise,
      new Promise((_, reject) => {timer = setTimeout(() => {timedOut = true;entry.timedOut=true; reject(Object.assign(new Error('Prazo de leitura encerrado.'), {code: 'deadline-exceeded'}));}, timeoutMs);})
    ]).then(value => {
      documentsReceived += Array.isArray(value?.docs) ? value.docs.length : Array.isArray(value) ? value.length : Array.isArray(value?.records) ? value.records.length : value === null ? 0 : 1;
      denied.delete(key);
      if (startedEpoch === failureEpoch) {
        code = ''; failures = 0; nextRetryAt = 0; quotaRetryAt = 0;
        try { storage?.removeItem(storageKey); } catch {}
      }
      publish(); return value;
    }, error => {failure(error, key); rejectedEpoch = failureEpoch; throw error;}).finally(() => {clearTimeout(timer);});
    entry.promise=operation;pending.set(key, entry);
    // A UI timeout does not cancel the SDK request. Keep it coalesced until it settles.
    const notifyLate = (value, error) => {
      if (timedOut && current()) for (const listener of lateObservers.get(key) || []) {
        try {Promise.resolve(listener(value, error)).catch(() => {});} catch {}
      }
    };
    const release = () => { if (current()) {pending.delete(key); lateObservers.delete(key); publish();} };
    taskPromise.then(value => {
      if (timedOut) documentsReceived += Array.isArray(value?.docs) ? value.docs.length : Array.isArray(value) ? value.length : Array.isArray(value?.records) ? value.records.length : value === null ? 0 : 1;
      if (timedOut && current() && rejectedEpoch === failureEpoch && quotaRetryAt <= now()) {
        code = ''; failures = 0; nextRetryAt = 0;
      }
      notifyLate(value); release();
    }, error => {if (timedOut && (current() || normalize(error)==='resource-exhausted')) failure(error, key); notifyLate(undefined, error); release();});
    return operation;
  };
  return {run, snapshot, assertCacheAllowed, noteFailure: failure,
    interruptReads() {for(const entry of pending.values())entry.interrupted=true;},
    reset() {code = quotaRetryAt > now() ? 'resource-exhausted' : ''; failures = 0; failureEpoch++; nextRetryAt = Math.max(0, quotaRetryAt); denied.clear(); publish();}};
}

const localBackoffStorage = (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
export const operationalBackend = createOperationalBackend({storage: localBackoffStorage, notify: detail => {
  if (typeof globalThis.CustomEvent === 'function') globalThis.dispatchEvent?.(new CustomEvent('sahmt-backend-status', {detail}));
}});
