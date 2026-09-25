const DB_NAME = 'sahmt-v2-local';
const DB_VERSION = 3;
const PROFILES = 'profiles';
const CACHE = 'cache';
const OUTBOX = 'outbox';
let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROFILES)) db.createObjectStore(PROFILES, {keyPath: 'uid'});
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, {keyPath: 'key'});
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, {keyPath: 'requestId'});
      const cache = request.transaction.objectStore(CACHE);
      const outbox = request.transaction.objectStore(OUTBOX);
      if (!cache.indexNames.contains('uid')) cache.createIndex('uid', 'uid', {unique: false});
      if (!outbox.indexNames.contains('uid')) outbox.createIndex('uid', 'uid', {unique: false});
      if (!outbox.indexNames.contains('uidStatus')) outbox.createIndex('uidStatus', ['uid', 'status'], {unique: false});
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

async function transact(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try { result = action(store); } catch (error) {
      try { tx.abort(); } catch {}
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function transactAcross(storeNames, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    try { result = action(tx); } catch (error) {
      try { tx.abort(); } catch {}
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function cacheProfile(uid, profile) {
  const safeProfile = {
    uid,
    email: profile.email || '',
    displayName: profile.displayName || '',
    sigla: profile.sigla || '',
    phone: profile.phone || '',
    active: profile.active === true,
    access: profile.access === true,
    role: profile.role || '',
    permissions: profile.permissions && typeof profile.permissions === 'object' ? profile.permissions : {},
    cachedAt: Date.now()
  };
  await transact(PROFILES, 'readwrite', (store) => store.put(safeProfile));
}

export async function readCachedProfile(uid, maxAgeMs = 24 * 60 * 60 * 1000) {
  const value = await transact(PROFILES, 'readonly', (store) => store.get(uid));
  if (!value || Date.now() - value.cachedAt > maxAgeMs) return null;
  return value;
}

function cacheKey(uid, kind, id) { return `${uid}::${kind}::${id}`; }

function getUserOperations(uid, status) {
  return transact(OUTBOX, 'readonly', (store) => store.index('uidStatus').getAll(IDBKeyRange.only([uid, status])));
}

function stableSerialize(value) {
  if (value instanceof Date) return JSON.stringify({$date: value.toISOString()});
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function writeSafeCache(uid, kind, id, data) {
  await transact(CACHE, 'readwrite', (store) => store.put({key: cacheKey(uid, kind, id), uid, kind, id, data: structuredClone(data), cachedAt: Date.now()}));
}

export async function readSafeCache(uid, kind, id) {
  return transact(CACHE, 'readonly', (store) => store.get(cacheKey(uid, kind, id)));
}

export async function pendingTrainingProgressCount(uid) {
  if (!uid) return 0;
  const cache = await readSafeCache(uid, 'trainingProgress', 'mine');
  return (cache?.data?.records || []).filter((item) => item.syncPending).length;
}

export async function listPendingTrainingProgress(uid) {
  if (!uid) return [];
  const cache = await readSafeCache(uid, 'trainingProgress', 'mine');
  return (cache?.data?.records || []).filter((item) => item.syncPending).sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
}

export async function updateCachedTrainingProgress(uid, trainingId, update, {requirePending = true} = {}) {
  if (!uid || !trainingId) return false;
  return transactAcross(CACHE, 'readwrite', (tx) => {
    const store = tx.objectStore(CACHE);
    const key = cacheKey(uid, 'trainingProgress', 'mine');
    let changed = false;
    const request = store.get(key);
    request.onsuccess = () => {
      const entry = request.result;
      if (!entry || !Array.isArray(entry.data?.records)) return;
      const records = entry.data.records.map((item) => {
        if (item.trainingId !== trainingId || (requirePending && !item.syncPending)) return item;
        changed = true;
        return {...item, ...update};
      });
      if (changed) store.put({...entry, data: {...entry.data, records}, cachedAt: Date.now()});
    };
    return () => changed;
  });
}

export async function discardCachedTrainingProgress(uid, trainingId) {
  if (!uid || !trainingId) return false;
  return transactAcross(CACHE, 'readwrite', (tx) => {
    const store = tx.objectStore(CACHE);
    const key = cacheKey(uid, 'trainingProgress', 'mine');
    let changed = false;
    const request = store.get(key);
    request.onsuccess = () => {
      const entry = request.result;
      if (!entry || !Array.isArray(entry.data?.records)) return;
      const records = entry.data.records.filter((item) => {
        const keep = item.trainingId !== trainingId || !item.syncPending;
        if (!keep) changed = true;
        return keep;
      });
      if (changed) store.put({...entry, data: {...entry.data, records}, cachedAt: Date.now()});
    };
    return () => changed;
  });
}

export async function readCachedSchedule(uid, day) {
  if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null;
  const cached = await readSafeCache(uid, 'scheduleDays', day);
  return cached?.data ? {...cached.data, stale: true} : null;
}

export async function enqueueOperation({uid, type, resourceId, payload, requestId = crypto.randomUUID(), coalesce = false}) {
  if (!uid || !type || !resourceId) throw new Error('A operação offline precisa de usuário, tipo e ID estável.');
  if (coalesce && type !== 'scheduleReleases') throw new Error('Somente liberações de escala podem coalescer operações offline.');
  const item = {requestId, uid, type, resourceId, payload: structuredClone(payload), createdAt: Date.now(), attempts: 0, status: 'queued', nextAttemptAt: 0, lastError: ''};
  const result = await transactAcross(OUTBOX, 'readwrite', (tx) => {
    const store = tx.objectStore(OUTBOX);
    let outcome = 'pending';
    let status = 'queued';
    const request = store.get(requestId);
    request.onsuccess = () => {
      const existing = request.result;
      if (!existing) {
        store.add(item);
        outcome = 'created';
        return;
      }
      if (existing.uid !== uid || existing.type !== type || existing.resourceId !== resourceId) {
        outcome = 'id-collision';
        status = existing.status;
        return;
      }
      if (coalesce) {
        store.put({...existing, payload: item.payload, status: 'queued', attempts: 0, nextAttemptAt: 0, lastError: '', lastErrorCode: ''});
        outcome = 'coalesced';
        status = 'queued';
        return;
      }
      if (stableSerialize(existing.payload) !== stableSerialize(item.payload)) {
        outcome = 'payload-conflict';
        status = existing.status;
        return;
      }
      outcome = 'existing';
      status = existing.status;
    };
    return () => ({outcome, status});
  });
  if (result.outcome === 'id-collision') throw new Error('O ID desta operação já pertence a outra ação ou sessão.');
  if (result.outcome === 'payload-conflict') throw new Error('O ID desta operação já foi usado com outro conteúdo; a ação existente foi preservada.');
  if (result.outcome === 'existing' && result.status !== 'queued') throw new Error('Esta operação já está em revisão e precisa ser tratada na área Offline.');
  if (result.status === 'queued' && typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sahmt-write-queued', {detail: {requestId, type}}));
  }
  return requestId;
}

export async function listQueuedOperations(uid) {
  const values = await getUserOperations(uid, 'queued');
  return (values || []).filter((item) => item.nextAttemptAt <= Date.now()).sort((a, b) => a.createdAt - b.createdAt);
}

export async function nextQueuedAttemptAt(uid) {
  if (!uid) return null;
  const values = await getUserOperations(uid, 'queued');
  if (!values?.length) return null;
  return Math.min(...values.map((item) => Number.isFinite(item.nextAttemptAt) ? item.nextAttemptAt : 0));
}

export async function listUnsettledOperations(uid) {
  if (!uid) return [];
  return transactAcross(OUTBOX, 'readonly', (tx) => {
    let queued = [];
    let failed = [];
    let conflict = [];
    const index = tx.objectStore(OUTBOX).index('uidStatus');
    const queuedRequest = index.getAll(IDBKeyRange.only([uid, 'queued']));
    const failedRequest = index.getAll(IDBKeyRange.only([uid, 'failed']));
    const conflictRequest = index.getAll(IDBKeyRange.only([uid, 'conflict']));
    queuedRequest.onsuccess = () => { queued = queuedRequest.result || []; };
    failedRequest.onsuccess = () => { failed = failedRequest.result || []; };
    conflictRequest.onsuccess = () => { conflict = conflictRequest.result || []; };
    return () => [...queued, ...failed, ...conflict].sort((a, b) => a.createdAt - b.createdAt);
  });
}

export async function updateQueuedOperation(uid, requestId, update) {
  if (!uid || !requestId || !update || typeof update !== 'object') return false;
  const changes = {};
  if (update.status === 'queued' || update.status === 'failed' || update.status === 'conflict') changes.status = update.status;
  if (Number.isInteger(update.attempts) && update.attempts >= 0) changes.attempts = update.attempts;
  if (Number.isFinite(update.nextAttemptAt) && update.nextAttemptAt >= 0) changes.nextAttemptAt = update.nextAttemptAt;
  if (typeof update.lastError === 'string') changes.lastError = update.lastError.slice(0, 300);
  if (typeof update.lastErrorCode === 'string') changes.lastErrorCode = update.lastErrorCode.slice(0, 80);
  if (Object.keys(changes).length === 0) return false;
  return transactAcross(OUTBOX, 'readwrite', (tx) => {
    let updated = false;
    const request = tx.objectStore(OUTBOX).get(requestId);
    request.onsuccess = () => {
      if (!request.result || request.result.uid !== uid) return;
      tx.objectStore(OUTBOX).put({...request.result, ...changes, uid, requestId});
      updated = true;
    };
    return () => updated;
  });
}

export async function removeQueuedOperation(uid, requestId) {
  if (!uid || !requestId) return false;
  return transactAcross(OUTBOX, 'readwrite', (tx) => {
    const store = tx.objectStore(OUTBOX);
    let removed = false;
    const request = store.get(requestId);
    request.onsuccess = () => {
      if (request.result?.uid !== uid) return;
      store.delete(requestId);
      removed = true;
    };
    return () => removed;
  });
}

export async function pendingOperationCount(uid) {
  const {queued, failed, conflict} = await operationCounts(uid);
  return queued + failed + conflict;
}

export async function operationCounts(uid) {
  if (!uid) return {queued: 0, failed: 0};
  return transactAcross(OUTBOX, 'readonly', (tx) => {
    let queued = 0;
    let failed = 0;
    let conflict = 0;
    const index = tx.objectStore(OUTBOX).index('uidStatus');
    const queuedRequest = index.count(IDBKeyRange.only([uid, 'queued']));
    const failedRequest = index.count(IDBKeyRange.only([uid, 'failed']));
    const conflictRequest = index.count(IDBKeyRange.only([uid, 'conflict']));
    queuedRequest.onsuccess = () => { queued = queuedRequest.result; };
    failedRequest.onsuccess = () => { failed = failedRequest.result; };
    conflictRequest.onsuccess = () => { conflict = conflictRequest.result; };
    return () => ({queued, failed, conflict});
  });
}

export async function retryFailedOperations(uid) {
  if (!uid) return 0;
  return transactAcross(OUTBOX, 'readwrite', (tx) => {
    let retried = 0;
    const request = tx.objectStore(OUTBOX).index('uidStatus').openCursor(IDBKeyRange.only([uid, 'failed']));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.update({...cursor.value, status: 'queued', nextAttemptAt: 0, lastError: '', lastErrorCode: ''});
      retried++;
      cursor.continue();
    };
    return () => retried;
  });
}

export async function retryFailedOperation(uid, requestId) {
  if (!uid || !requestId) return false;
  return transactAcross(OUTBOX, 'readwrite', (tx) => {
    let retried = false;
    const store = tx.objectStore(OUTBOX);
    const request = store.get(requestId);
    request.onsuccess = () => {
      const item = request.result;
      if (!item || item.uid !== uid || item.status !== 'failed') return;
      store.put({...item, status: 'queued', nextAttemptAt: 0, lastError: '', lastErrorCode: ''});
      retried = true;
    };
    return () => retried;
  });
}

export async function clearUserLocalData(uid, {clearOutbox = false} = {}) {
  const stores = clearOutbox ? [CACHE, PROFILES, OUTBOX] : [CACHE, PROFILES];
  await transactAcross(stores, 'readwrite', (tx) => {
    tx.objectStore(PROFILES).delete(uid);
    const deleteUidRows = (storeName, indexName) => {
      const request = tx.objectStore(storeName).index(indexName).openCursor(IDBKeyRange.only(uid));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    };
    deleteUidRows(CACHE, 'uid');
    if (clearOutbox) deleteUidRows(OUTBOX, 'uid');
  });
}
