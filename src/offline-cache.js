import {isOfflineRuntimeForced} from './offline-runtime-mode.js';
import {operationalBackend} from './operational-backend.js';
import {firebaseFailureCode} from './firebase-failure.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function offlineCacheTtlFor(kind) {
  return ['labels','provisionalChannel'].includes(kind) ? DAY_MS : 7 * DAY_MS;
}

export function isFirestoreCacheFallbackError(error, {online = globalThis.navigator?.onLine !== false} = {}) {
  const code = firebaseFailureCode(error);
  if (['permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition'].includes(code)) return false;
  return ['unavailable', 'deadline-exceeded', 'network-request-failed', 'resource-exhausted'].includes(code) || (!online && !code);
}

export function isSafeCacheEntryFresh(entry, {uid, kind, now = Date.now(), maxAgeMs = offlineCacheTtlFor(kind)} = {}) {
  if (!uid || !kind || !entry || entry.uid !== uid || entry.kind !== kind || !Number.isFinite(entry.cachedAt) ||
      !Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0 || entry.cachedAt > now) return false;
  return now - entry.cachedAt <= maxAgeMs;
}

export async function readThroughSafeCache({uid, kind, id, fetchOnline, readCache, writeCache, mayFallback, localFirst = false, onRefresh, onRemoteError, backend = operationalBackend}) {
  const key = `${uid || ''}:${kind}:${id}`;
  if (localFirst) backend.assertCacheAllowed(key);
  if (isOfflineRuntimeForced() || globalThis.navigator?.onLine === false) {
    const cached = uid ? await readCache(uid, kind, id) : null;
    if (!cached || !isSafeCacheEntryFresh(cached, {uid, kind})) throw Object.assign(new Error('Sem uma cópia local recente deste dado.'), {code: 'unavailable'});
    return markStale(cached.data);
  }
  if (localFirst && uid) {
    const cached = await readCache(uid, kind, id);
    if (isSafeCacheEntryFresh(cached, {uid, kind})) {
      if (Date.now() - cached.cachedAt > 30000) {
        void backend.run(key, fetchOnline).then(async value => {
          if (value === null || value === undefined) return;
          await writeCache(uid, kind, id, value);
          onRefresh?.(value);
        }).catch(error => {
          onRemoteError?.(error);
          if (['permission-denied', 'unauthenticated'].includes(error?.code) && typeof globalThis.CustomEvent === 'function') {
            globalThis.dispatchEvent?.(new CustomEvent('sahmt-operational-access-denied', {detail: {uid, kind, code: error.code}}));
          }
        });
      }
      return markStale(cached.data);
    }
  }
  try {
    const value = await (localFirst ? backend.run(key, fetchOnline) : fetchOnline());
    if (uid && value !== null && value !== undefined) await writeCache(uid, kind, id, value);
    return value;
  } catch (error) {
    if (!uid || !mayFallback(error)) throw error;
    const cached = await readCache(uid, kind, id);
    if (!cached || !isSafeCacheEntryFresh(cached, {uid, kind})) throw error;
    return markStale(cached.data);
  }
}
function markStale(data) {
  if (Array.isArray(data)) {
    const items = data.map((item) => item && typeof item === 'object' ? {...item, stale: true} : item);
    Object.defineProperty(items, 'stale', {value: true});
    return items;
  }
  if (data && typeof data === 'object') return {...data, stale: true};
  throw Object.assign(new Error('A cópia local não contém dados válidos.'), {code: 'unavailable'});
}
