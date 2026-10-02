function watchLimit(value, fallback) {
  const count = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count >= Number.MAX_SAFE_INTEGER) throw new Error('Informe um limite válido para acompanhar o relatório.');
  return count;
}

function timestampMillis(value) {
  const time = typeof value?.toMillis === 'function' ? value.toMillis()
    : typeof value?.toDate === 'function' ? value.toDate().getTime()
      : value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function recordChanges(previous, current) {
  const changes = [];
  for (const [id, data] of current) {
    const older = previous.get(id);
    if (!older) changes.push({type: 'added', id, data});
    else if (JSON.stringify(older) !== JSON.stringify(data)) changes.push({type: 'modified', id, data});
  }
  for (const [id, data] of previous) if (!current.has(id)) changes.push({type: 'removed', id, data});
  return changes;
}

async function realtimeFirestore() {
  const [{db}, sdk] = await Promise.all([import('./firebase.js'), import('firebase/firestore')]);
  if (!db) throw new Error('O Firestore não está disponível para atualizar o relatório.');
  return {db, sdk};
}

function subscribeReport(sdk, scopedQuery, onNext, onError, project) {
  let closed = false, unsubscribe = null, previous = new Map();
  const stop = () => {
    if (closed) return;
    closed = true;
    const release = unsubscribe;
    unsubscribe = null;
    previous.clear();
    release?.();
  };
  const fail = error => {
    if (closed) return;
    stop();
    onError?.(error);
  };
  try {
    const release = sdk.onSnapshot(scopedQuery, {includeMetadataChanges: true}, snapshot => {
      if (closed) return;
      const result = project(snapshot);
      const current = new Map(result.records.map(record => [record.id, record]));
      const changes = recordChanges(previous, current);
      previous = current;
      const fromCache = snapshot.metadata?.fromCache !== false;
      const hasPendingWrites = snapshot.metadata?.hasPendingWrites === true || snapshot.docs.some(doc => doc.metadata?.hasPendingWrites === true);
      onNext({...result, changes, fromCache, hasPendingWrites, serverConfirmed: !fromCache && !hasPendingWrites});
    }, fail);
    if (closed) release(); else unsubscribe = release;
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

/** A growing prefix keeps live edits from opening gaps between cursor pages. */
export async function watchEventRecords({from, to, uid, sigla = '', isAdmin = false, pageSize = 100, loadedLimit = null} = {}, onNext, onError) {
  if (!from || !to || from > to) throw new Error('Informe um período válido para consultar os eventos.');
  if (!uid) throw new Error('A sessão expirou. Entre novamente para consultar eventos.');
  if (typeof onNext !== 'function') throw new Error('O relatório de eventos não está disponível.');
  const page = Math.min(100, watchLimit(pageSize, 100));
  const count = watchLimit(loadedLimit, page);
  if (!Number.isSafeInteger(count + page)) throw new Error('Informe um limite válido para acompanhar o relatório.');
  const member = String(sigla || '').trim().toUpperCase();
  const admin = isAdmin === true;
  const {db, sdk} = await realtimeFirestore();
  const base = [sdk.where('active', '==', true), sdk.where('date', '>=', from), sdk.where('date', '<=', to)];
  // The full SDK requires field filters and an OR filter to be enclosed by one composite AND.
  const filters = admin ? base : member ? [sdk.and(...base, sdk.or(
    sdk.where('createdByUid', '==', uid), sdk.where('memberSigla', '==', member), sdk.where('scheduleSigla', '==', member)
  ))] : [...base, sdk.where('createdByUid', '==', uid)];
  const scopedQuery = sdk.query(sdk.collection(db, 'events'), ...filters,
    sdk.orderBy('date', 'desc'), sdk.limit(count + 1));
  return subscribeReport(sdk, scopedQuery, onNext, onError, snapshot => {
    const records = snapshot.docs.slice(0, count).map(doc => ({...doc.data(), id: doc.id, hasPendingWrites: doc.metadata?.hasPendingWrites === true}))
      .filter(record => record.active === true && typeof record.date === 'string' && record.date >= from && record.date <= to &&
        (admin || record.createdByUid === uid || (member && (record.memberSigla === member || record.scheduleSigla === member))))
      .sort((left, right) => String(right.date).localeCompare(String(left.date)) || timestampMillis(right.createdAt) - timestampMillis(left.createdAt) || String(left.id).localeCompare(String(right.id)));
    const hasMore = snapshot.docs.length > count;
    return {records, hasMore, loadedLimit: count, nextCursor: hasMore ? {live: true, loadedLimit: count, nextLimit: count + page} : null};
  });
}

/** Includes inactive stations so saved responses retain their catalog and maintenance context. */
export async function watchChecklistStations(onNext, onError) {
  if (typeof onNext !== 'function') throw new Error('O cadastro de arsenais não está disponível.');
  const {db, sdk} = await realtimeFirestore();
  const scopedQuery = sdk.query(sdk.collection(db, 'stations'), sdk.orderBy('order', 'asc'), sdk.limit(201));
  return subscribeReport(sdk, scopedQuery, onNext, onError, snapshot => ({
    records: snapshot.docs.slice(0, 200).map(doc => ({...doc.data(), id: doc.id, hasPendingWrites: doc.metadata?.hasPendingWrites === true})),
    truncated: snapshot.docs.length > 200
  }));
}
