import {collection, doc, getDoc, getDocs, limit, orderBy, query, where} from 'firebase/firestore/lite';
import {db} from './firebase-lite.js';
import {readSafeCache, writeSafeCache} from './outbox.js';
import {readThroughSafeCache} from './offline-cache.js';
import {DEFAULT_APP_FEATURES, normalizeAppFeatures} from './feature-flags.js';

function mayUseOfflineCache(error) {
  return ['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(error?.code) || (navigator.onLine === false && !error?.code);
}

export async function readAppFeatures(uid) {
  try {
    const snapshot = await getDoc(doc(db, 'appConfig', 'app'));
    const features = normalizeAppFeatures(snapshot.exists() ? snapshot.data().features : DEFAULT_APP_FEATURES);
    if (uid) await writeSafeCache(uid, 'appConfig', 'app', {features});
    return features;
  } catch (error) {
    if (!uid || !mayUseOfflineCache(error)) throw error;
    const cached = await readSafeCache(uid, 'appConfig', 'app');
    if (cached?.data?.features) return normalizeAppFeatures(cached.data.features);
    throw error;
  }
}

export async function readSchedule(day, uid) {
  return readThroughSafeCache({uid, kind: 'scheduleDays', id: day, readCache: readSafeCache, writeCache: writeSafeCache, mayFallback: mayUseOfflineCache, fetchOnline: async () => {
    const snapshot = await getDoc(doc(db, 'scheduleDays', day));
    if (!snapshot.exists()) return null;
    return {id: snapshot.id, ...snapshot.data()};
  }});
}

export async function listActiveContacts({uid, pageSize = 200} = {}) {
  return readThroughSafeCache({uid, kind: 'contacts', id: 'active', readCache: readSafeCache, writeCache: writeSafeCache, mayFallback: mayUseOfflineCache, fetchOnline: async () => {
    const result = await getDocs(query(
      collection(db, 'contacts'),
      where('active', '==', true),
      orderBy('sigla', 'asc'),
      limit(Math.min(200, Math.max(1, pageSize)))
    ));
    return result.docs.map((item) => ({id: item.id, ...item.data()}));
  }});
}

export async function listVacationsForDate(day, {uid, pageSize = 100} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new Error('Informe uma data válida para consultar as férias.');
  return readThroughSafeCache({uid, kind: 'vacations', id: day, readCache: readSafeCache, writeCache: writeSafeCache, mayFallback: mayUseOfflineCache, fetchOnline: async () => {
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
