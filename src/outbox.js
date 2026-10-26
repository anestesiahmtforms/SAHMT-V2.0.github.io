import {isSafeCacheEntryFresh} from './offline-cache.js';
import {deployment} from './deployment-context.js';
const LOCAL_MANAGEMENT_PROJECT = deployment.target;
const DOMAIN_CACHE_GENERATION = deployment.generation;
const DOMAIN_CACHE_KINDS = new Set(['managementAreas','trainings','trainingProgress','scores']);

const DB_NAME = deployment.localDatabase;
const DB_VERSION = 4;
const PROFILES = 'profiles';
const CACHE = 'cache';
const OUTBOX = 'outbox';
const DRAFTS = 'operationalDrafts';
const ALLOWED_OUTBOX_TYPES = new Set(['events', 'labels', 'checklists', 'activities', 'eventEdits', 'labelEdits', 'scheduleReleases', 'occurrences']);
const CONFIRM_BEFORE_SEND_TYPES = new Set(['events', 'labels', 'checklists', 'eventEdits', 'labelEdits']);

export function requiresSendConfirmation(type) { return CONFIRM_BEFORE_SEND_TYPES.has(type); }
const MAX_OCCURRENCE_QUEUE_ITEMS_PER_UID = 20;
const MAX_OCCURRENCE_QUEUE_BYTES = 500_000;
let dbPromise;

const STORAGE_TIMEOUT_MS = 5000;
const storageTimeout = () => Object.assign(new Error('O armazenamento local não respondeu. Tente novamente.'), {code:'storage-timeout'});

function openDb() {
  if (dbPromise) return dbPromise;
  let entry;
  entry = new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (dbPromise === entry) dbPromise = null;
      reject(error);
    };
    const timer = setTimeout(() => fail(storageTimeout()), STORAGE_TIMEOUT_MS);
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      if (settled) {request.transaction.abort(); return;}
      const db = request.result;
      if (!db.objectStoreNames.contains(PROFILES)) db.createObjectStore(PROFILES, {keyPath: 'uid'});
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, {keyPath: 'key'});
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, {keyPath: 'requestId'});
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, {keyPath: 'key'});
      const drafts = request.transaction.objectStore(DRAFTS);
      if (!drafts.indexNames.contains('uid')) drafts.createIndex('uid', 'uid', {unique: false});
      const cache = request.transaction.objectStore(CACHE);
      const outbox = request.transaction.objectStore(OUTBOX);
      if (!cache.indexNames.contains('uid')) cache.createIndex('uid', 'uid', {unique: false});
      if (!outbox.indexNames.contains('uid')) outbox.createIndex('uid', 'uid', {unique: false});
      if (!outbox.indexNames.contains('uidStatus')) outbox.createIndex('uidStatus', ['uid', 'status'], {unique: false});
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {db.close(); return;}
      settled = true; clearTimeout(timer);
      const retire = () => {if (dbPromise === entry) dbPromise = null;};
      db.onclose = retire;
      db.onversionchange = () => {db.close(); retire();};
      resolve(db);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(Object.assign(new Error('Feche as outras abas do SAHMT para atualizar o armazenamento local.'), {code:'storage-blocked'}));
  });
  dbPromise = entry;
  void entry.catch(() => {if (dbPromise === entry) dbPromise = null;});
  return entry;
}

// WebKit may restore a page whose old IndexedDB transaction never completes.
// Abort only that transaction, retire the connection, and preserve all stores.
async function localTransaction(storeNames, mode, action, resultValue) {
  const connection = openDb();
  const db = await connection;
  return new Promise((resolve, reject) => {
    let tx, result, settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error);
      else {try {resolve(resultValue(result));} catch (error) {reject(error);}}
    };
    const timer = setTimeout(() => {
      const error = storageTimeout();
      finish(error);
      try {tx?.abort();} catch {}
      if (dbPromise === connection) dbPromise = null;
      db.close();
    }, STORAGE_TIMEOUT_MS);
    try {
      tx = db.transaction(storeNames, mode);
      tx.oncomplete = () => finish();
      tx.onerror = tx.onabort = () => finish(tx.error || Object.assign(new Error('Transação local interrompida.'), {code:'storage-aborted'}));
      result = action(tx);
    } catch (error) {
      finish(error);
      try {tx?.abort();} catch {}
      if (error.name === 'InvalidStateError') {if (dbPromise === connection) dbPromise = null; db.close();}
    }
  });
}

async function transact(storeName, mode, action) {
  return localTransaction(storeName, mode, tx => action(tx.objectStore(storeName)), result => result?.result);
}

async function transactAcross(storeNames, mode, action) {
  return localTransaction(storeNames, mode, action, result => typeof result === 'function' ? result() : result);
}

export async function cacheProfile(uid, profile, {validatedAt = Date.now()} = {}) {
  if (!Number.isSafeInteger(validatedAt) || validatedAt <= 0 || validatedAt > Date.now()) throw new Error('Invalid profile timestamp');
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
    cachedAt: validatedAt
  };
  await transact(PROFILES, 'readwrite', (store) => store.put(safeProfile));
}

// Local continuity only. Every remote send still requires a fresh server profile.
export async function readCachedProfile(uid, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const value = await transact(PROFILES, 'readonly', (store) => store.get(uid));
  const now = Date.now();
  if (!uid || !value || value.uid !== uid || !Number.isFinite(value.cachedAt) || value.cachedAt > now ||
      !Number.isFinite(maxAgeMs) || maxAgeMs < 0 || now - value.cachedAt > maxAgeMs) return null;
  return value;
}

function cacheKey(uid, kind, id) {
  const scoped = DOMAIN_CACHE_KINDS.has(kind) ? `${DOMAIN_CACHE_GENERATION}:${kind}` : kind;
  return `${uid}::${scoped}::${id}`;
}

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

const COMMIT_PROOF_TYPES = new Set(['events', 'labels', 'checklists']);
const COMMIT_PROOF_MAX_AGE_MS = 30 * 86400000;
async function payloadHash(payload) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableSerialize(payload)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function hasCommittedOperation(uid, requestId, payload) {
  if (!uid || !requestId) return false;
  const proof = await transact(CACHE, 'readonly', store => store.get(cacheKey(uid, 'operationCommits', requestId)));
  return Boolean(proof && proof.uid === uid && Date.now() - proof.cachedAt <= COMMIT_PROOF_MAX_AGE_MS && proof.data.payloadHash === await payloadHash(payload));
}

export async function writeSafeCache(uid, kind, id, data, {validatedAt} = {}) {
  const cachedAt=validatedAt??Date.now();
  if(!Number.isSafeInteger(cachedAt)||cachedAt<=0||cachedAt>Date.now())throw new Error('Invalid cache timestamp');
  const item={key:cacheKey(uid,kind,id),uid,kind,id,data:structuredClone(data),cachedAt};
  await transactAcross(CACHE,'readwrite',tx=>{
    const store=tx.objectStore(CACHE);
    if(validatedAt===undefined){store.put(item);return;}
    const request=store.get(item.key);
    request.onsuccess=()=>{if(!request.result||request.result.cachedAt<=cachedAt)store.put(item);};
  });
}

export async function readSafeCache(uid, kind, id, {localOnly=false} = {}) {
  const local=await transact(CACHE, 'readonly', (store) => store.get(cacheKey(uid, kind, id)));
  if(local||localOnly||globalThis.sahmtRemoteContinuityEnabled!==true)return local;
  try{const {recoverContinuityCache}=await import('./remote-continuity.js');return await recoverContinuityCache(uid,kind,id);}
  catch{return local;}
}

export async function pendingTrainingProgressCount(uid) {
  if (!uid) return 0;
  return (await listPendingTrainingProgress(uid)).length;
}

export async function listPendingTrainingProgress(uid) {
  if (!uid) return [];
  const cache = await readSafeCache(uid, 'trainingProgress', 'mine');
  const historical = await transact(CACHE, 'readonly', store=>store.index('uid').getAll(uid));
  const retained = historical.filter(entry=>entry.kind==='trainingProgress'&&entry.id==='mine'&&entry.key!==cacheKey(uid,'trainingProgress','mine'))
    .flatMap(entry=>(entry.data?.records||[]).filter(item=>item.syncPending).map(item=>({...item,
      sourceProject:entry.key.includes('::FB:')?'FB':'FA',destinationChanged:true,syncConflict:true,
      syncError:'Progresso anterior à mudança de base preservado. Precisa de conciliação antes de qualquer envio.'})));
  return [...(cache?.data?.records || []).filter((item) => item.syncPending), ...retained].sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
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

export async function readCachedSchedule(uid, day, {localOnly = false} = {}) {
  if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null;
  const cached = await readFreshSafeCache(uid, 'scheduleDays', day, {localOnly});
  return cached?.data ? {...cached.data, stale: true} : null;
}

export async function enqueueOperation({uid, type, resourceId, payload, requestId = crypto.randomUUID(), coalesce = false, createdAt = Date.now()}) {
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0 || createdAt > Date.now()+60000) throw new Error('Invalid operation timestamp');
  if (!uid || !type || !resourceId) throw new Error('A operação offline precisa de usuário, tipo e ID estável.');
  if (!ALLOWED_OUTBOX_TYPES.has(type)) throw new Error('Esta ação não está habilitada para sincronização offline.');
  if (coalesce && type !== 'scheduleReleases') throw new Error('Somente liberações de escala podem coalescer operações offline.');
  if (type === 'occurrences') validateOccurrenceQueuePayload(payload);
  if (type === 'activities') payload = {...payload, dataProject:payload.dataProject || LOCAL_MANAGEMENT_PROJECT};
  const item = {schemaVersion: 1, requestId, uid, type, resourceId, payload: structuredClone(payload), createdAt, attempts: 0, status: requiresSendConfirmation(type) ? 'awaiting-confirmation' : 'queued', nextAttemptAt: 0, lastError: ''};
  const hash = COMMIT_PROOF_TYPES.has(type) ? await payloadHash(item.payload) : null;
  const result = await transactAcross([OUTBOX, CACHE], 'readwrite', (tx) => {
    const store = tx.objectStore(OUTBOX);
    let outcome = 'pending';
    let status = 'queued';
    const proofRequest = tx.objectStore(CACHE).get(cacheKey(uid, 'operationCommits', requestId));
    proofRequest.onsuccess = () => {
      const proof = proofRequest.result;
      if (hash && proof && Date.now() - proof.cachedAt <= COMMIT_PROOF_MAX_AGE_MS) {
        outcome = proof.data.payloadHash === hash && proof.data.type === type && proof.data.resourceId === resourceId ? 'committed' : 'payload-conflict';
        status = 'committed';
        return;
      }
      const request = store.get(requestId);
      request.onsuccess = () => {
        const existing = request.result;
        if (!existing) {
          if (type !== 'occurrences') {
            store.add(item);
            outcome = 'created';
            return;
          }
          const userOperations = store.index('uid').getAll(uid);
          userOperations.onsuccess = () => {
            const unresolved = (userOperations.result || []).filter(operation => operation.type === 'occurrences'
              && ['queued', 'failed', 'conflict'].includes(operation.status));
            if (unresolved.length >= MAX_OCCURRENCE_QUEUE_ITEMS_PER_UID) {
              outcome = 'queue-full';
              status = 'failed';
              return;
            }
            store.add(item);
            outcome = 'created';
          };
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
    };
    return () => ({outcome, status});
  });
  if (result.outcome === 'queue-full') throw new Error('OCCURRENCE_QUEUE_FULL');
  if (result.outcome === 'id-collision') throw new Error('O ID desta operação já pertence a outra ação ou sessão.');
  if (result.outcome === 'payload-conflict') throw new Error('O ID desta operação já foi usado com outro conteúdo; a ação existente foi preservada.');
  if (result.outcome === 'existing' && !['queued', 'awaiting-confirmation'].includes(result.status)) throw new Error('Esta operação já está em revisão e precisa ser tratada na área Offline.');
  if (['queued', 'awaiting-confirmation'].includes(result.status) && typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sahmt-write-queued', {detail: {uid, requestId, type}}));
  }
  return requestId;
}

function validateOccurrenceQueuePayload(payload) {
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  if (!plain(payload) || !/^F(?:0[1-9]|10)$/.test(payload.formId || '') || !plain(payload.values)
    || typeof payload.displayName !== 'string' || payload.displayName.length > 120
    || typeof payload.anonymous !== 'boolean' || !Number.isFinite(payload.createdAtClient)
    || Object.values(payload.values).some(value => typeof value !== 'string')) {
    throw new Error('OCCURRENCE_QUEUE_INVALID');
  }
  if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_OCCURRENCE_QUEUE_BYTES) {
    throw new Error('OCCURRENCE_QUEUE_TOO_LARGE');
  }
}

export async function enqueueOccurrenceSubmission({uid, recordId, payload} = {}) {
  if (!uid || !/^[A-Fa-f0-9-]{36}$/.test(recordId || '')) throw new Error('OCCURRENCE_QUEUE_INVALID');
  return enqueueOperation({uid, type: 'occurrences', resourceId: recordId, requestId: recordId, payload});
}

export async function listQueuedOperations(uid) {
  if (!uid) return [];
  const values = await migrateUnconfirmedQueuedOperations(uid);
  return (values || []).filter((item) => item.status === 'queued' && item.nextAttemptAt <= Date.now()).sort((a, b) => a.createdAt - b.createdAt);
}

export async function nextQueuedAttemptAt(uid) {
  if (!uid) return null;
  const values = await getUserOperations(uid, 'queued');
  if (!values?.length) return null;
  return Math.min(...values.map((item) => Number.isFinite(item.nextAttemptAt) ? item.nextAttemptAt : 0));
}

export async function listUnsettledOperations(uid) {
  if (!uid) return [];
  await migrateUnconfirmedQueuedOperations(uid);
  return transactAcross(OUTBOX, 'readonly', (tx) => {
    let queued = [];
    let failed = [];
    let conflict = [];
    let awaitingConfirmation = [];
    let sending = [];
    const index = tx.objectStore(OUTBOX).index('uidStatus');
    const queuedRequest = index.getAll(IDBKeyRange.only([uid, 'queued']));
    const failedRequest = index.getAll(IDBKeyRange.only([uid, 'failed']));
    const conflictRequest = index.getAll(IDBKeyRange.only([uid, 'conflict']));
    const awaitingRequest = index.getAll(IDBKeyRange.only([uid, 'awaiting-confirmation']));
    const sendingRequest = index.getAll(IDBKeyRange.only([uid, 'sending']));
    queuedRequest.onsuccess = () => { queued = queuedRequest.result || []; };
    failedRequest.onsuccess = () => { failed = failedRequest.result || []; };
    conflictRequest.onsuccess = () => { conflict = conflictRequest.result || []; };
    awaitingRequest.onsuccess = () => { awaitingConfirmation = awaitingRequest.result || []; };
    sendingRequest.onsuccess = () => { sending = sendingRequest.result || []; };
    return () => [...queued, ...failed, ...conflict, ...awaitingConfirmation, ...sending].sort((a, b) => a.createdAt - b.createdAt);
  });
}

export async function updateQueuedOperation(uid, requestId, update) {
  if (!uid || !requestId || !update || typeof update !== 'object') return false;
  const changes = {};
  if (['queued', 'failed', 'conflict', 'awaiting-confirmation', 'sending'].includes(update.status)) changes.status = update.status;
  if (Number.isFinite(update.sendConfirmedAt) && update.sendConfirmedAt >= 0) changes.sendConfirmedAt = update.sendConfirmedAt;
  if (update.clearSendConfirmation === true) { changes.sendConfirmedAt = null; changes.sendClaimedAt = null; }
  if (Number.isFinite(update.sendClaimedAt) && update.sendClaimedAt >= 0) changes.sendClaimedAt = update.sendClaimedAt;
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

export async function confirmQueuedOperation(uid, requestId, now = Date.now()) {
  if (!uid || !requestId || !Number.isFinite(now)) return false;
  return transactAcross(OUTBOX, 'readwrite', (tx) => {
    let confirmed = false;
    const store = tx.objectStore(OUTBOX);
    const request = store.get(requestId);
    request.onsuccess = () => {
      const item = request.result;
      if (!item || item.uid !== uid || !requiresSendConfirmation(item.type)) return;
      const staleSend = item.status === 'sending' && Number.isFinite(item.sendClaimedAt)
        && now - item.sendClaimedAt >= 120000;
      if (!['awaiting-confirmation', 'queued', 'failed'].includes(item.status) && !staleSend) return;
      store.put({...item, status: 'queued', sendConfirmedAt: now, confirmedAt: now, sendClaimedAt: null,
        nextAttemptAt: 0, lastError: '', lastErrorCode: ''});
      confirmed = true;
    };
    return () => confirmed;
  });
}

export async function claimQueuedOperationForSend(uid, requestId, now = Date.now()) {
  if (!uid || !requestId || !Number.isFinite(now)) return null;
  return transactAcross(OUTBOX, 'readwrite', (tx) => {
    let claimed = null;
    const store = tx.objectStore(OUTBOX);
    const request = store.get(requestId);
    request.onsuccess = () => {
      const item = request.result;
      if (!item || item.uid !== uid || item.status !== 'queued' ||
          !requiresSendConfirmation(item.type) || !Number.isFinite(item.sendConfirmedAt)) return;
      if (Number.isFinite(item.sendClaimedAt) && now - item.sendClaimedAt < 120000) return;
      claimed = {...item, status: 'sending', sendClaimedAt: now, sendConfirmedAt: null, confirmedAt: null};
      store.put(claimed);
    };
    return () => claimed;
  });
}

export async function removeQueuedOperation(uid, requestId, {expectedPayload,throughOccurredAt,committed = false} = {}) {
  if (!uid || !requestId) return false;
  const snapshot = committed ? await transact(OUTBOX, 'readonly', store => store.get(requestId)) : null;
  if (committed && snapshot?.uid !== uid) return false;
  const hash = snapshot?.uid === uid && COMMIT_PROOF_TYPES.has(snapshot.type) ? await payloadHash(snapshot.payload) : null;
  return transactAcross([OUTBOX, CACHE], 'readwrite', (tx) => {
    const store = tx.objectStore(OUTBOX);
    let removed = false;
    const request = store.get(requestId);
    request.onsuccess = () => {
      if (request.result?.uid !== uid) return;
      if(expectedPayload!==undefined&&JSON.stringify(request.result.payload)!==JSON.stringify(expectedPayload))return;
      if(Number.isFinite(throughOccurredAt)&&request.result.payload?.occurredAt>throughOccurredAt)return;
      if (hash) {
        if (stableSerialize(snapshot.payload) !== stableSerialize(request.result.payload)) return;
        tx.objectStore(CACHE).put({key: cacheKey(uid, 'operationCommits', requestId), uid, kind: 'operationCommits', id: requestId,
          data: {type: snapshot.type, resourceId: snapshot.resourceId, payloadHash: hash}, cachedAt: Date.now()});
      }
      store.delete(requestId);
      removed = true;
    };
    return () => removed;
  });
}

export async function pendingOperationCount(uid) {
  const {queued, failed, conflict, awaitingConfirmation, sending} = await operationCounts(uid);
  return queued + failed + conflict + awaitingConfirmation + sending;
}

export async function operationCounts(uid) {
  if (!uid) return {queued: 0, failed: 0, conflict: 0, awaitingConfirmation: 0, sending: 0};
  await migrateUnconfirmedQueuedOperations(uid);
  return transactAcross(OUTBOX, 'readonly', (tx) => {
    let queued = 0;
    let failed = 0;
    let conflict = 0;
    let awaitingConfirmation = 0;
    let sending = 0;
    const index = tx.objectStore(OUTBOX).index('uidStatus');
    const queuedRequest = index.count(IDBKeyRange.only([uid, 'queued']));
    const failedRequest = index.count(IDBKeyRange.only([uid, 'failed']));
    const conflictRequest = index.count(IDBKeyRange.only([uid, 'conflict']));
    const awaitingRequest = index.count(IDBKeyRange.only([uid, 'awaiting-confirmation']));
    const sendingRequest = index.count(IDBKeyRange.only([uid, 'sending']));
    queuedRequest.onsuccess = () => { queued = queuedRequest.result; };
    failedRequest.onsuccess = () => { failed = failedRequest.result; };
    conflictRequest.onsuccess = () => { conflict = conflictRequest.result; };
    awaitingRequest.onsuccess = () => { awaitingConfirmation = awaitingRequest.result; };
    sendingRequest.onsuccess = () => { sending = sendingRequest.result; };
    return () => ({queued, failed, conflict, awaitingConfirmation, sending});
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
      if (cursor.value.lastErrorCode !== 'invalid-outbox-operation') {
        const status = requiresSendConfirmation(cursor.value.type) ? 'awaiting-confirmation' : 'queued';
        cursor.update({...cursor.value, status, sendConfirmedAt: null, sendClaimedAt: null, nextAttemptAt: 0, lastError: '', lastErrorCode: ''});
        retried++;
      }
      cursor.continue();
    };
    return () => retried;
  });
}

export async function retryableFailedOperationCount(uid) {
  if (!uid) return 0;
  const failed = await getUserOperations(uid, 'failed');
  return (failed || []).filter((item) => item.lastErrorCode !== 'invalid-outbox-operation' && !requiresSendConfirmation(item.type)).length;
}

export async function retryFailedOperation(uid, requestId) {
  if (!uid || !requestId) return false;
  return transactAcross(OUTBOX, 'readwrite', (tx) => {
    let retried = false;
    const store = tx.objectStore(OUTBOX);
    const request = store.get(requestId);
    request.onsuccess = () => {
      const item = request.result;
      if (!item || item.uid !== uid || item.status !== 'failed' || item.lastErrorCode === 'invalid-outbox-operation') return;
      const status = requiresSendConfirmation(item.type) ? 'awaiting-confirmation' : 'queued';
      store.put({...item, status, sendConfirmedAt: null, sendClaimedAt: null, nextAttemptAt: 0, lastError: '', lastErrorCode: ''});
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
        const pendingProgress = !clearOutbox && storeName === CACHE && cursor.value.kind === 'trainingProgress' && cursor.value.data?.records?.some(record => record.syncPending);
        const commitProof = !clearOutbox && storeName === CACHE && cursor.value.kind === 'operationCommits' && Date.now() - cursor.value.cachedAt <= COMMIT_PROOF_MAX_AGE_MS;
        if (!pendingProgress && !commitProof) cursor.delete();
        cursor.continue();
      };
    };
    deleteUidRows(CACHE, 'uid');
    if (clearOutbox) deleteUidRows(OUTBOX, 'uid');
  });
}


function draftKey(uid, module, id) {
  if (!uid || !['events', 'labels', 'checklists'].includes(module) || typeof id !== 'string' || !id || id.length > 200) throw new Error('Rascunho operacional inválido.');
  return `${uid}::${module}::${id}`;
}


export async function saveOperationalDraft(uid, module, id, input) {
  const key = draftKey(uid, module, id), fields = {};
  for (const [name, value] of Object.entries(input || {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(name) || /token|secret|password|credential|file/i.test(name)) continue;
    if (typeof value === 'string' && value.length <= 10000 || typeof value === 'boolean') fields[name] = value;
  }
  if (JSON.stringify(fields).length > 64000) throw new Error('O rascunho excedeu o espaço reservado para um formulário.');
  await transact(DRAFTS, 'readwrite', store => store.put({key, uid, module, id, schemaVersion: 1, fields, updatedAt: Date.now()}));
}


export async function readOperationalDraft(uid, module, id) {
  const draft = await transact(DRAFTS, 'readonly', store => store.get(draftKey(uid, module, id)));
  return draft?.uid === uid && draft.schemaVersion === 1 ? draft : null;
}


export async function removeOperationalDraft(uid, module, id) {
  await transact(DRAFTS, 'readwrite', store => store.delete(draftKey(uid, module, id)));
}


export async function listOperationalDrafts(uid) {
  if (!uid) return [];
  return transact(DRAFTS, 'readonly', store => store.index('uid').getAll(uid));
}


export async function pruneLocalReadCache(uid, {maxEntries = 240, maxBytes = 8 * 1024 * 1024, now = Date.now()} = {}) {
  if (!uid) return {removed: 0, remainingEntries: 0, estimatedBytes: 0};
  return transactAcross(CACHE, 'readwrite', tx => {
    let removed = 0, remainingEntries = 0, estimatedBytes = 0;
    const store = tx.objectStore(CACHE), request = store.index('uid').getAll(uid);
    request.onsuccess = () => {
      const protectedEntry = item => (item.kind === 'operationCommits' && now - item.cachedAt <= COMMIT_PROOF_MAX_AGE_MS) || (item.kind === 'trainingProgress' && item.data?.records?.some(record => record.syncPending));
      const priority = kind => ['stations', 'appConfig', 'labelStaff', 'eventMembers', 'eventCatalogs'].includes(kind) ? 1 : 0;
      const entries = request.result.sort((a, b) => priority(b.kind) - priority(a.kind) || b.cachedAt - a.cachedAt);
      for (const entry of entries) {
        if (protectedEntry(entry)) continue;
        const bytes = JSON.stringify(entry).length * 2;
        if (!isSafeCacheEntryFresh(entry, {uid, kind: entry.kind, now}) || remainingEntries >= maxEntries || estimatedBytes + bytes > maxBytes) {
          store.delete(entry.key); removed++;
        } else {remainingEntries++; estimatedBytes += bytes;}
      }
    };
    return () => ({removed, remainingEntries, estimatedBytes});
  });
}


export async function readFreshSafeCache(uid, kind, id, {now = Date.now(), maxAgeMs, localOnly = false} = {}) {
  if (!uid) return null;
  const entry = await readSafeCache(uid, kind, id, {localOnly});
  if (isSafeCacheEntryFresh(entry, {uid, kind, now, ...(maxAgeMs === undefined ? {} : {maxAgeMs})})) return entry;
  if (entry?.uid === uid && entry.kind === kind) await transact(CACHE, 'readwrite', (store) => store.delete(cacheKey(uid, kind, id)));
  return null;
}


export async function listAwaitingConfirmationOperations(uid) {
  if (!uid) return [];
  const values = await getUserOperations(uid, 'awaiting-confirmation');
  return (values || []).sort((a, b) => a.createdAt - b.createdAt);
}

async function migrateUnconfirmedQueuedOperations(uid) {
  return transactAcross(OUTBOX, 'readwrite', (tx) => {
    const values = [];
    const request = tx.objectStore(OUTBOX).index('uidStatus').openCursor(IDBKeyRange.only([uid, 'queued']));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const item = cursor.value;
      if (requiresSendConfirmation(item.type) && !Number.isFinite(item.sendConfirmedAt)) {
        cursor.update({...item, status: 'awaiting-confirmation', nextAttemptAt: 0});
        values.push({...item, status: 'awaiting-confirmation', nextAttemptAt: 0});
      } else values.push(item);
      cursor.continue();
    };
    return () => values;
  });
}
