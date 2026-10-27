import {isOfflineRuntimeForced} from './offline-runtime-mode.js';
import {operationalBackend} from './operational-backend.js';
import {firebaseFailureCode} from './firebase-failure.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CATALOG_KINDS = new Set(['contacts', 'stations', 'eventMembers', 'eventCatalogs', 'vacations', 'labelStaff']);

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

// Local cache failure is distinct from Firestore authorization or connectivity.
// Server-confirmed data remains usable while WebKit reopens local storage.
async function optionalCache(action) {
  try {return await action();}
  catch (error) {
    if (['storage-timeout','storage-blocked','storage-aborted'].includes(error?.code) || error?.name === 'InvalidStateError') return null;
    throw error;
  }
}

export async function readThroughSafeCache({uid,kind,id,fetchOnline,localFirst=false,backend=operationalBackend}) {
  if(isOfflineRuntimeForced()||globalThis.navigator?.onLine===false)throw Object.assign(new Error('Conecte-se ao servidor para consultar os dados.'),{code:'online-required'});
  return localFirst?backend.run(`${uid||''}:${kind}:${id}`,fetchOnline):fetchOnline();
}
