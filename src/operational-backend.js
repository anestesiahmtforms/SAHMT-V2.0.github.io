import {firebaseFailureCode} from './firebase-failure.js';
// Coordinates application reads. It does not create polling or background network traffic.
export function createOperationalBackend({now = Date.now, random = Math.random, timeoutMs = 7000, notify = () => {}} = {}) {
  const pending = new Map(), denied = new Map();
  let code = '', failures = 0, failureEpoch = 0, nextRetryAt = 0, calls = 0, documentsReceived = 0;
  const snapshot = () => ({code, failures, nextRetryAt, calls, documentsReceived, inFlight: pending.size});
  const publish = () => {try {notify(snapshot());} catch {}};
  const normalize = firebaseFailureCode;
  const failure = (error, key) => {
    const value = normalize(error);
    if (['permission-denied', 'unauthenticated'].includes(value)) denied.set(key, value);
    if (['resource-exhausted', 'unavailable', 'deadline-exceeded', 'network-request-failed'].includes(value)) {
      code = value; failures++; failureEpoch++;
      const base = value === 'resource-exhausted' ? 300000 : 5000;
      const delay = Math.min(3600000, base * 2 ** Math.min(failures - 1, 6));
      nextRetryAt = now() + Math.round(delay * (1 + Math.max(0, Math.min(1, random())) * .25));
      publish();
    }
  };
  const assertCacheAllowed = key => {
    if (denied.has(key)) throw Object.assign(new Error('O acesso remoto a este dado foi recusado.'), {code: denied.get(key)});
  };
  const run = (key, task, {force = false} = {}) => {
    if (pending.has(key)) return pending.get(key);
    if (!force) {
      try {assertCacheAllowed(key);} catch (error) {return Promise.reject(error);}
      if (nextRetryAt > now()) return Promise.reject(Object.assign(new Error('Atualização remota temporariamente suspensa.'), {code, retryAt: nextRetryAt, circuitOpen: true}));
    }
    let timer; const startedEpoch = failureEpoch;
    calls++;
    const operation = Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {timer = setTimeout(() => reject(Object.assign(new Error('Prazo de leitura encerrado.'), {code: 'deadline-exceeded'})), timeoutMs);})
    ]).then(value => {
      documentsReceived += Array.isArray(value?.docs) ? value.docs.length : Array.isArray(value) ? value.length : Array.isArray(value?.records) ? value.records.length : value === null ? 0 : 1;
      denied.delete(key);
      if (startedEpoch === failureEpoch) {code = ''; failures = 0; nextRetryAt = 0;}
      publish(); return value;
    }, error => {failure(error, key); throw error;}).finally(() => {clearTimeout(timer); pending.delete(key);});
    pending.set(key, operation);
    return operation;
  };
  return {run, snapshot, assertCacheAllowed, noteFailure: failure, reset() {code = ''; failures = 0; failureEpoch++; nextRetryAt = 0; denied.clear(); publish();}};
}

export const operationalBackend = createOperationalBackend({notify: detail => {
  if (typeof globalThis.CustomEvent === 'function') globalThis.dispatchEvent?.(new CustomEvent('sahmt-backend-status', {detail}));
}});
