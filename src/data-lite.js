import {collection, doc, getDoc, getDocs, limit, orderBy, query, where} from 'firebase/firestore/lite';
import {db} from './firebase-lite.js';
import {readFreshSafeCache, readSafeCache, writeSafeCache, listUnsettledOperations} from './outbox.js';
import {isFirestoreCacheFallbackError, readThroughSafeCache} from './offline-cache.js';
import {DEFAULT_APP_FEATURES, normalizeAppFeatures} from './feature-flags.js';
import {projectPendingSchedule} from './offline-schedule-overlay.js';

function mayUseOfflineCache(error) {
  return isFirestoreCacheFallbackError(error);
}

export async function readAppFeatures(uid) {
  const result = await readThroughSafeCache({uid, kind: 'appConfig', id: 'app', localFirst: true, readCache: readSafeCache, writeCache: writeSafeCache, mayFallback: mayUseOfflineCache, fetchOnline: async () => {
    const snapshot = await getDoc(doc(db, 'appConfig', 'app'));
    const features = normalizeAppFeatures(snapshot.exists() ? snapshot.data().features : DEFAULT_APP_FEATURES);
    return {features};
  }});
  return normalizeAppFeatures(result.features);
}

export async function readSchedule(day, uid, {onRefresh} = {}) {
  const project = async value => projectPendingSchedule(value, uid ? await listUnsettledOperations(uid) : [], {uid, day});
  const value = await readThroughSafeCache({uid, kind: 'scheduleDays', id: day, localFirst: true, onRefresh: onRefresh ? value => {void project(value).then(onRefresh).catch(() => {});} : undefined, readCache: readSafeCache, writeCache: writeSafeCache, mayFallback: mayUseOfflineCache, fetchOnline: async () => {
    const snapshot = await getDoc(doc(db, 'scheduleDays', day));
    if (!snapshot.exists()) return null;
    return {id: snapshot.id, ...snapshot.data()};
  }});
  return project(value);
}

export async function listActiveContacts({uid, pageSize = 200, onRefresh} = {}) {
  return readThroughSafeCache({uid, kind: 'contacts', id: 'active', localFirst: true, onRefresh, readCache: readSafeCache, writeCache: writeSafeCache, mayFallback: mayUseOfflineCache, fetchOnline: async () => {
    const result = await getDocs(query(
      collection(db, 'contacts'),
      where('active', '==', true),
      orderBy('sigla', 'asc'),
      limit(Math.min(200, Math.max(1, pageSize)))
    ));
    return result.docs.map((item) => ({id: item.id, ...item.data()}));
  }});
}

export async function listVacationsForDate(day, {uid, pageSize = 100, onRefresh} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Informe uma data válida para consultar as férias.');
  return readThroughSafeCache({uid, kind: 'vacations', id: day, localFirst: true, onRefresh, readCache: readSafeCache, writeCache: writeSafeCache, mayFallback: mayUseOfflineCache, fetchOnline: async () => {
    const result = await getDocs(query(
      collection(db, 'vacations'),
      where('active', '==', true),
      where('start', '<=', day),
      where('end', '>=', day),
      orderBy('start', 'asc'),
      limit(Math.min(100, Math.max(1, pageSize)))
    ));
    return result.docs.map((item) => ({id: item.id, ...item.data()}));
  }});
}
