import {collection, getDocs, limit, orderBy, query, startAfter, where} from 'firebase/firestore/lite';
import {db} from './firebase-lite.js';

function dateSortValue(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
}

export async function listLabelRecords({from, to, uid, sigla = '', canManage = false, pageSize = 50, cursor = null} = {}) {
  if (!from || !to || from > to) throw new Error('Informe um período válido para consultar as etiquetas.');
  if (!uid) throw new Error('A sessão expirou. Entre novamente para consultar etiquetas.');
  const currentLimit = Math.min(100, Math.max(1, pageSize));
  const dateFilters = from === to ? [where('date', '==', from)] : [where('date', '>=', from), where('date', '<=', to)];
  const base = [where('active', '==', true), ...dateFilters];
  const cursorMode = canManage ? 'admin' : 'staff';
  if (cursor && cursor.mode !== cursorMode) cursor = null;
  const list = async (extra = [], after = null) => getDocs(query(
    collection(db, 'labels'), ...base, ...extra, orderBy('date', 'desc'), ...(after ? [startAfter(after)] : []), limit(currentLimit)
  ));
  let snapshots = [];
  let nextCursor = null;
  if (canManage) {
    const done = cursor?.adminDone === true;
    const snapshot = done ? null : await list([], cursor?.admin || null);
    if (snapshot) snapshots.push(snapshot);
    nextCursor = snapshot && snapshot.docs.length === currentLimit
      ? {mode: 'admin', admin: snapshot.docs[snapshot.docs.length - 1], adminDone: false}
      : null;
  } else {
    const ownDone = cursor?.ownDone === true;
    const staffDone = !sigla || cursor?.staffDone === true;
    const [own, staff] = await Promise.all([
      ownDone ? null : list([where('createdByUid', '==', uid)], cursor?.own || null),
      staffDone ? null : list([where('staffSiglas', 'array-contains', sigla)], cursor?.staff || null)
    ]);
    if (own) snapshots.push(own);
    if (staff) snapshots.push(staff);
    const nextOwnDone = ownDone || !own || own.docs.length < currentLimit;
    const nextStaffDone = staffDone || !staff || staff.docs.length < currentLimit;
    nextCursor = nextOwnDone && nextStaffDone ? null : {
      mode: 'staff',
      own: own?.docs.length ? own.docs[own.docs.length - 1] : cursor?.own || null,
      ownDone: nextOwnDone,
      staff: staff?.docs.length ? staff.docs[staff.docs.length - 1] : cursor?.staff || null,
      staffDone: nextStaffDone
    };
  }
  const records = new Map();
  for (const snapshot of snapshots) {
    for (const item of snapshot.docs) records.set(item.id, {id: item.id, ...item.data()});
  }
  return {
    records: [...records.values()].sort((left, right) => String(right.date).localeCompare(String(left.date)) || dateSortValue(right.createdAt) - dateSortValue(left.createdAt)),
    nextCursor
  };
}



function labelWatchLimit(value, fallback) {
  const count = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Informe um limite válido para acompanhar as etiquetas.');
  return count;
}

function labelWatchTime(value) {
  const time = dateSortValue(value);
  return Number.isFinite(time) && value ? time : 0;
}

function newerLabelWatchRecord(left, right) {
  if (!left) return right;
  const version = Number(right.version || 0) - Number(left.version || 0);
  if (version) return version > 0 ? right : left;
  const updated = labelWatchTime(right.updatedAt || right.createdAt) - labelWatchTime(left.updatedAt || left.createdAt);
  if (updated) return updated > 0 ? right : left;
  if (right.hasPendingWrites !== left.hasPendingWrites) return right.hasPendingWrites ? right : left;
  return right;
}

/** Watches a growing, bounded prefix for each authorized query. No patient data is persisted. */
export async function watchLabelRecords({from, to, uid, sigla = '', canManage = false, pageSize = 50, loadedLimit = null} = {}, onNext, onError) {
  if (!from || !to || from > to) throw new Error('Informe um período válido para consultar as etiquetas.');
  if (!uid) throw new Error('A sessão expirou. Entre novamente para consultar etiquetas.');
  if (typeof onNext !== 'function') throw new Error('O relatório de etiquetas não está disponível.');
  const page = Math.min(100, labelWatchLimit(pageSize, 50));
  const count = labelWatchLimit(loadedLimit, page);
  const [{db: realtimeDb}, realtime] = await Promise.all([import('./firebase.js'), import('firebase/firestore')]);
  if (!realtimeDb) throw new Error('O Firestore não está disponível para atualizar as etiquetas.');
  const dateFilters = from === to ? [realtime.where('date', '==', from)] : [realtime.where('date', '>=', from), realtime.where('date', '<=', to)];
  const base = [realtime.where('active', '==', true), ...dateFilters];
  const filters = canManage ? [[]] : [
    [realtime.where('createdByUid', '==', uid)],
    ...(sigla ? [[realtime.where('staffSiglas', 'array-contains', sigla)]] : [])
  ];
  const sources = filters.map(() => ({snapshot: null}));
  let closed = false;
  const unsubscribes = [];
  let previous = new Map();
  const stop = () => {
    if (closed) return;
    closed = true;
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    for (const source of sources) source.snapshot = null;
    previous.clear();
  };
  const fail = error => {
    if (closed) return;
    stop();
    onError?.(error);
  };
  const emit = () => {
    if (closed || sources.some(source => !source.snapshot)) return;
    const records = new Map();
    let hasMore = false, fromCache = false, hasPendingWrites = false;
    for (const source of sources) {
      const snapshot = source.snapshot;
      fromCache ||= snapshot.metadata?.fromCache !== false;
      hasPendingWrites ||= snapshot.metadata?.hasPendingWrites === true;
      hasMore ||= snapshot.docs.length > count;
      for (const item of snapshot.docs) hasPendingWrites ||= item.metadata?.hasPendingWrites === true;
      for (const item of snapshot.docs.slice(0, count)) {
        const value = item.data();
        // These guards also discard a late contribution after it leaves the selected scope.
        if (value.active !== true || typeof value.date !== 'string' || value.date < from || value.date > to ||
          (!canManage && value.createdByUid !== uid && !(sigla && value.staffSiglas?.includes(sigla)))) continue;
        const record = {...value, id: item.id, hasPendingWrites: item.metadata?.hasPendingWrites === true};
        records.set(item.id, newerLabelWatchRecord(records.get(item.id), record));
      }
    }
    const values = [...records.values()].sort((left, right) => String(right.date).localeCompare(String(left.date)) || dateSortValue(right.createdAt) - dateSortValue(left.createdAt) || String(left.id).localeCompare(String(right.id)));
    const changes = [];
    for (const value of values) {
      const older = previous.get(value.id);
      if (!older) changes.push({type: 'added', id: value.id, data: value});
      else if (JSON.stringify(older) !== JSON.stringify(value)) changes.push({type: 'modified', id: value.id, data: value});
    }
    for (const [id, value] of previous) if (!records.has(id)) changes.push({type: 'removed', id, data: value});
    previous = records;
    onNext({records: values, changes, hasMore, loadedLimit: count,
      nextCursor: hasMore ? {mode: canManage ? 'admin' : 'staff', live: true, loadedLimit: count, nextLimit: count + page} : null,
      fromCache, hasPendingWrites, serverConfirmed: !fromCache && !hasPendingWrites});
  };
  try {
    filters.forEach((extra, index) => {
      if (closed) return;
      const scopedQuery = realtime.query(realtime.collection(realtimeDb, 'labels'), ...base, ...extra, realtime.orderBy('date', 'desc'), realtime.limit(count + 1));
      const unsubscribe = realtime.onSnapshot(scopedQuery, {includeMetadataChanges: true}, snapshot => {
        if (closed) return;
        sources[index].snapshot = snapshot;
        emit();
      }, fail);
      if (closed) unsubscribe(); else unsubscribes.push(unsubscribe);
    });
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
