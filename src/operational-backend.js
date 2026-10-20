import {firebaseFailureCode} from './firebase-failure.js';
// Coordinates application reads. It does not create polling or background network traffic.
export function createOperationalBackend({now = Date.now, random = Math.random, timeoutMs = 7000, notify = () => {}, storage = null} = {}) {
  const pending = new Map(), denied = new Map();
  let code = '', failures = 0, failureEpoch = 0, nextRetryAt = 0, calls = 0, documentsReceived = 0;
  let quotaRetryAt = 0;
  const storageKey = 'sahmt-firestore-read-backoff-v1';
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
  const run = (key, task, {force = false} = {}) => {
    if (pending.has(key)) return pending.get(key);
    // Reload, reconnect and explicit refresh do not bypass a known quota failure.
    if (quotaRetryAt > now()) return Promise.reject(Object.assign(new Error('Atualização remota aguardando a recuperação da cota.'), {code: 'resource-exhausted', retryAt: quotaRetryAt, circuitOpen: true}));
    if (!force) {
      try {assertCacheAllowed(key);} catch (error) {return Promise.reject(error);}
      if (nextRetryAt > now()) return Promise.reject(Object.assign(new Error('Atualização remota temporariamente suspensa.'), {code, retryAt: nextRetryAt, circuitOpen: true}));
    }
    let timer, timedOut = false; const startedEpoch = failureEpoch;
    calls++;
    const taskPromise = Promise.resolve().then(task);
    const operation = Promise.race([
      taskPromise,
      new Promise((_, reject) => {timer = setTimeout(() => {timedOut = true; reject(Object.assign(new Error('Prazo de leitura encerrado.'), {code: 'deadline-exceeded'}));}, timeoutMs);})
    ]).then(value => {
      documentsReceived += Array.isArray(value?.docs) ? value.docs.length : Array.isArray(value) ? value.length : Array.isArray(value?.records) ? value.records.length : value === null ? 0 : 1;
      denied.delete(key);
      if (startedEpoch === failureEpoch) {
        code = ''; failures = 0; nextRetryAt = 0; quotaRetryAt = 0;
        try { storage?.removeItem(storageKey); } catch {}
      }
      publish(); return value;
    }, error => {failure(error, key); throw error;}).finally(() => {clearTimeout(timer);});
    pending.set(key, operation);
    // A UI timeout does not cancel the SDK request. Keep it coalesced until it settles.
    const release = () => { if (pending.get(key) === operation) {pending.delete(key); publish();} };
    taskPromise.then(release, error => {if (timedOut) failure(error, key); release();});
    return operation;
  };
  return {run, snapshot, assertCacheAllowed, noteFailure: failure, reset() {code = quotaRetryAt > now() ? 'resource-exhausted' : ''; failures = 0; failureEpoch++; nextRetryAt = Math.max(0, quotaRetryAt); denied.clear(); publish();}};
}

const localBackoffStorage = (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
export const operationalBackend = createOperationalBackend({storage: localBackoffStorage, notify: detail => {
  if (typeof globalThis.CustomEvent === 'function') globalThis.dispatchEvent?.(new CustomEvent('sahmt-backend-status', {detail}));
}});
