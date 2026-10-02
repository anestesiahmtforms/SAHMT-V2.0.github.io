const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function checklistReportScope({uid, day, month, stationIds = [], pageSize, loadedLimit} = {}) {
  if (typeof uid !== 'string' || !uid.trim() || uid.length > 128 || Boolean(day) === Boolean(month)) {
    throw new Error('Informe a sessão e somente o dia ou mês do Checklist.');
  }
  if (day && (!DAY.test(day) || Number(day.slice(0, 4)) < 1 || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)) {
    throw new Error('Informe uma data válida para o Checklist.');
  }
  if (month && (!MONTH.test(month) || Number(month.slice(0, 4)) < 1)) throw new Error('Informe um mês válido para o Checklist.');
  if (!Array.isArray(stationIds) || stationIds.some((id) => typeof id !== 'string' || !/^[^/]{1,128}$/.test(id))) {
    throw new Error('Não foi possível identificar os arsenais do Checklist.');
  }
  const ids = [...new Set(stationIds)].sort();
  if (ids.length > 200) throw new Error('O catálogo do Checklist excede o limite de arsenais.');
  const maximum = day ? 1000 : 2000;
  if (pageSize != null && (!Number.isInteger(pageSize) || pageSize < 1)) throw new Error('Informe um limite válido para o relatório.');
  const page = Math.min(maximum, pageSize ?? maximum);
  const count = loadedLimit ?? page;
  if (!Number.isSafeInteger(count) || count < page || !Number.isSafeInteger(count + page + 1) || (day && count > maximum)) {
    throw new Error('Informe um limite válido para carregar o relatório.');
  }
  const from = day || `${month}-01`;
  const end = month ? new Date(`${month}-01T00:00:00Z`) : null;
  if (end) end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const to = day || end.toISOString().slice(0, 10);
  return {uid, day: day || null, month: month || null, from, to, stationIds: ids, pageSize: page, loadedLimit: count, cacheKey: day || `month:${month}`};
}

/** Uses the existing Checklist indexes; each historical query returns at most one record. */
export function buildChecklistReportQueries(options, sdk, db) {
  const scope = checklistReportScope(options);
  const {collection, query, where, orderBy, limit} = sdk;
  const base = collection(db, 'checklists');
  const period = scope.day
    ? [where('date', '==', scope.day), orderBy('createdAt', 'desc')]
    : [where('date', '>=', scope.from), where('date', '<=', scope.to), orderBy('date', 'asc'), orderBy('createdAt', 'desc')];
  const current = query(base, ...period, limit(scope.loadedLimit + 1));
  const prior = scope.stationIds.map((stationId) => ({stationId, query: query(base,
    where('stationId', '==', stationId), where('date', '<', scope.from),
    orderBy('date', 'desc'), orderBy('createdAt', 'desc'), limit(1))}));
  return {scope, current, prior};
}

function snapshotRecord(document) {
  const value = {...document.data(), id: document.id};
  if (document.metadata?.hasPendingWrites) return {...value, pendingSync: true, pendingFirestore: true};
  return value;
}

function recordTime(value) {
  const time = typeof value?.toMillis === 'function' ? value.toMillis() : typeof value?.toDate === 'function' ? value.toDate().getTime() : value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function compareRecordAge(left, right) {
  return String(left.date || '').localeCompare(String(right.date || '')) || recordTime(left.createdAt) - recordTime(right.createdAt) || Number(left.version || 0) - Number(right.version || 0);
}

function chooseProvisionalRecord(baseline, incoming) {
  return !baseline || incoming.pendingFirestore || compareRecordAge(incoming, baseline) >= 0 ? incoming : baseline;
}

function changedStations(before, after) {
  const ids = new Set();
  for (const [id, record] of before) if (after.get(id) !== record) {
    if (record.stationId) ids.add(record.stationId);
    if (after.get(id)?.stationId) ids.add(after.get(id).stationId);
  }
  for (const [id, record] of after) if (!before.has(id) && record.stationId) ids.add(record.stationId);
  return ids;
}

/** Injectable constructor for contract tests; watchChecklistReport supplies the real SDK. */
export function createChecklistReportListener(options, onNext, onError, {sdk, db, writeSafeCache} = {}) {
  if (typeof onNext !== 'function') throw new Error('Informe como atualizar o relatório do Checklist.');
  const {scope, current, prior} = buildChecklistReportQueries(options, sdk, db);
  let stopped = false, currentReady = false, currentRecords = [], truncated = false;
  let cacheSequence = 0, writtenCache = '';
  const currentKey = Symbol('current');
  const recordsById = new Map();
  const history = new Map();
  const states = new Map([[currentKey, {ready: false, fromCache: true, pending: false}]]);
  const errors = new Map();
  // The SDK's memory cache can be empty even when the existing safe offline cache has records.
  const confirmedSources = new Set();
  const stops = [];
  for (const {stationId} of prior) states.set(stationId, {ready: false, fromCache: true, pending: false});
  const initial = options.initial;
  if (initial) {
    currentRecords = (initial.records || []).map((record) => ({...record}));
    for (const record of currentRecords) recordsById.set(record.id, record);
    truncated = initial.truncated === true;
    for (const record of initial.priorRecords || []) if (scope.stationIds.includes(record.stationId)) history.set(record.stationId, {...record});
  }
  const publish = (changed = new Set()) => {
    if (stopped) return;
    const metadata = [...states.values()];
    const ready = metadata.every((state) => state.ready);
    const fromCache = metadata.some((state) => state.fromCache);
    const hasPendingWrites = metadata.some((state) => state.pending);
    const confirmed = ready && !fromCache && !hasPendingWrites && !errors.size && !truncated;
    const priorRecords = scope.stationIds.flatMap((id) => history.has(id) ? [history.get(id)] : []);
    const result = {records: [...currentRecords], priorRecords: [...priorRecords], stationIds: [...scope.stationIds],
      changedStationIds: [...changed].sort(), ready, confirmed, fromCache, hasPendingWrites,
      historyIncomplete: prior.some(({stationId}) => !states.get(stationId).ready || errors.has(stationId)),
      stale: !confirmed, truncated, hasMore: Boolean(scope.month && truncated), loadedLimit: scope.loadedLimit,
      nextLimit: scope.month && truncated ? scope.loadedLimit + scope.pageSize : null,
      nextCursor: scope.month && truncated ? {live: true, loadedLimit: scope.loadedLimit, nextLimit: scope.loadedLimit + scope.pageSize} : null,
      error: errors.values().next().value || null};
    onNext(result);
    if (confirmed && writeSafeCache) {
      const cache = {records: currentRecords, priorRecords, stationIds: scope.stationIds, ...(scope.month ? {truncated: false} : {})};
      const fingerprint = JSON.stringify(cache);
      if (fingerprint !== writtenCache) {
        writtenCache = fingerprint;
        const sequence = ++cacheSequence;
        Promise.resolve().then(() => {
          if (!stopped && sequence === cacheSequence) return writeSafeCache(scope.uid, 'checklists', scope.cacheKey, cache);
        }).catch(() => { /* Cache failure does not change server confirmation. */ });
      }
    }
  };
  const metadataFor = (key, snapshot) => {
    states.set(key, {ready: true, fromCache: snapshot.metadata?.fromCache !== false,
      pending: snapshot.metadata?.hasPendingWrites === true || snapshot.docs.some((document) => document.metadata?.hasPendingWrites === true)});
    errors.delete(key);
  };
  const fail = (key, error) => {
    if (stopped) return;
    errors.set(key, error);
    publish();
    onError?.(error);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cacheSequence++;
    stops.splice(0).forEach((unsubscribe) => unsubscribe());
    recordsById.clear(); history.clear(); states.clear(); errors.clear(); confirmedSources.clear(); currentRecords = [];
  };
  // A warm result is provisional until every live source receives server metadata.
  if (initial) publish(new Set(scope.stationIds));
  try {
    stops.push(sdk.onSnapshot(current, {includeMetadataChanges: true}, (snapshot) => {
      if (stopped) return;
      const previous = new Map(currentRecords.map((record) => [record.id, record]));
      const sourceConfirmed = snapshot.metadata?.fromCache === false && snapshot.metadata?.hasPendingWrites !== true && !snapshot.docs.some((document) => document.metadata?.hasPendingWrites === true);
      if (sourceConfirmed) confirmedSources.add(currentKey);
      if (initial && !confirmedSources.has(currentKey)) {
        // A partial SDK cache is not evidence that another saved record was deleted.
        for (const document of snapshot.docs) {
          const incoming = snapshotRecord(document);
          recordsById.set(document.id, chooseProvisionalRecord(recordsById.get(document.id), incoming));
        }
        const provisional = [...recordsById.values()].sort((left, right) => (scope.month
          ? String(left.date || '').localeCompare(String(right.date || ''))
          : String(right.date || '').localeCompare(String(left.date || ''))) || recordTime(right.createdAt) - recordTime(left.createdAt) || String(left.id).localeCompare(String(right.id)));
        truncated ||= snapshot.docs.length > scope.loadedLimit || provisional.length > scope.loadedLimit;
        currentRecords = provisional.slice(0, scope.loadedLimit);
        metadataFor(currentKey, snapshot);
        publish(changedStations(previous, new Map(currentRecords.map((record) => [record.id, record]))));
        return;
      }
      const changes = currentReady ? snapshot.docChanges({includeMetadataChanges: true}) : null;
      if (changes) {
        for (const change of changes) {
          if (change.type === 'removed') recordsById.delete(change.doc.id);
          else recordsById.set(change.doc.id, snapshotRecord(change.doc));
        }
      } else {
        recordsById.clear();
        for (const document of snapshot.docs) recordsById.set(document.id, snapshotRecord(document));
      }
      const returnedIds = new Set(snapshot.docs.map((document) => document.id));
      for (const id of recordsById.keys()) if (!returnedIds.has(id)) recordsById.delete(id);
      currentRecords = snapshot.docs.slice(0, scope.loadedLimit).map((document) => recordsById.get(document.id));
      truncated = snapshot.docs.length > scope.loadedLimit;
      currentReady = true;
      metadataFor(currentKey, snapshot);
      publish(changedStations(previous, new Map(currentRecords.map((record) => [record.id, record]))));
    }, (error) => fail(currentKey, error)));
    for (const {stationId, query} of prior) {
      stops.push(sdk.onSnapshot(query, {includeMetadataChanges: true}, (snapshot) => {
        if (stopped) return;
        const old = history.get(stationId);
        const document = snapshot.docs[0];
        const sourceConfirmed = snapshot.metadata?.fromCache === false && snapshot.metadata?.hasPendingWrites !== true && !document?.metadata?.hasPendingWrites;
        if (sourceConfirmed) confirmedSources.add(stationId);
        if (initial && !confirmedSources.has(stationId)) {
          // Keep the newer inherited failure from the safe cache while SDK history is incomplete.
          const incoming = document ? snapshotRecord(document) : null;
          if (incoming) history.set(stationId, chooseProvisionalRecord(old, incoming));
          metadataFor(stationId, snapshot);
          publish(new Set(history.get(stationId) !== old ? [stationId] : []));
          return;
        }
        if (document) history.set(stationId, snapshotRecord(document)); else history.delete(stationId);
        metadataFor(stationId, snapshot);
        publish(new Set(old || document ? [stationId] : []));
      }, (error) => fail(stationId, error)));
    }
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

export async function watchChecklistReport(options, onNext, onError) {
  checklistReportScope(options);
  const [sdk, {db}, {writeSafeCache}] = await Promise.all([
    import('firebase/firestore'), import('./firebase.js'), import('./outbox.js')
  ]);
  return createChecklistReportListener(options, onNext, onError, {sdk, db, writeSafeCache});
}
