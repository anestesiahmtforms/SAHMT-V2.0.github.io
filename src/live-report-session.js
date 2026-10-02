// Coordinates in-memory report listeners. Firebase and DOM ownership stay in adapters.
export function createLiveReportSession({subscribe, onData = () => {}, onState = () => {}, isCurrent = () => true, isOnline = () => true} = {}) {
  if (typeof subscribe !== 'function') throw new TypeError('Informe o adaptador de atualização do relatório.');
  let active = null;
  let generation = 0;
  let onlineOverride;
  const online = () => onlineOverride ?? Boolean(isOnline());
  const copyScope = (scope) => ({...scope, sourceKeys: [...new Set(scope.sourceKeys || ['report'])]});
  const scopeUsable = (scope) => typeof scope?.key === 'string' && scope.key.length > 0 && typeof scope.uid === 'string' && scope.uid.length > 0 && scope.authorized !== false;
  const stop = (entry) => {
    const unsubscribe = entry?.unsubscribe;
    if (entry) entry.unsubscribe = null;
    if (typeof unsubscribe === 'function') { try { unsubscribe(); } catch { /* Invalidate ownership even if adapter cleanup throws. */ } }
  };
  const close = (reason = 'close') => {
    const previous = active;
    active = null;
    generation++;
    stop(previous);
    if (previous) { previous.data = null; previous.sources.clear(); previous.scope = null; }
    onState({state: 'closed', confirmed: false, ready: false, data: null, scope: null, key: null, fromCache: true, hasPendingWrites: false, localPending: false, error: null, reason});
  };
  const current = (entry) => {
    if (active !== entry || entry.generation !== generation || entry.failed) return false;
    if (!isCurrent(entry.scope)) { close('scope-changed'); return false; }
    return true;
  };
  const snapshot = () => {
    if (active && !isCurrent(active.scope)) close('scope-changed');
    if (!active) return {state: 'closed', confirmed: false, ready: false, data: null, scope: null, key: null, fromCache: true, hasPendingWrites: false, localPending: false, error: null};
    const entry = active;
    const sources = entry.scope.sourceKeys.map((key) => entry.sources.get(key));
    const ready = sources.every((source) => source?.complete === true);
    // Unknown metadata is not proof of a server confirmation.
    const fromCache = sources.some((source) => source?.fromCache !== false);
    const hasPendingWrites = sources.some((source) => source?.hasPendingWrites !== false);
    const state = !online() ? 'offline' : entry.error ? 'error' : entry.localPending || sources.some((source) => source?.hasPendingWrites === true) ? 'pending' : ready && !fromCache && !hasPendingWrites ? 'server' : 'awaiting';
    return {state, confirmed: state === 'server', ready, data: entry.data, scope: entry.scope, key: entry.scope.key, fromCache, hasPendingWrites, localPending: entry.localPending, error: entry.error, reason: entry.reason};
  };
  const publish = (entry, dataChanged = false) => {
    if (!current(entry)) return;
    onState(snapshot());
    if (dataChanged && current(entry)) onData(entry.data, entry.scope);
  };
  const attach = (entry, unsubscribe) => {
    if (typeof unsubscribe !== 'function') return;
    if (!current(entry)) { unsubscribe(); return; }
    entry.unsubscribe = unsubscribe;
  };
  const start = (scope, {force = false, reason = 'open'} = {}) => {
    if (!scopeUsable(scope)) { close('unauthorized-scope'); return false; }
    const nextScope = copyScope(scope);
    if (!nextScope.sourceKeys.length || nextScope.sourceKeys.some((key) => typeof key !== 'string' || !key)) throw new TypeError('Informe as consultas necessárias ao relatório.');
    if (!isCurrent(nextScope)) { close('scope-changed'); return false; }
    const same = active && active.scope.key === nextScope.key && active.scope.uid === nextScope.uid && active.scope.module === nextScope.module && active.scope.permissionKey === nextScope.permissionKey && JSON.stringify(active.scope.sourceKeys) === JSON.stringify(nextScope.sourceKeys);
    if (same && !force && !active.failed) {
      active.scope = nextScope;
      publish(active, active.data !== null);
      return false;
    }
    const previous = active;
    const retainedData = same ? previous.data : null;
    const retainedPending = same ? previous.localPending : false;
    active = null;
    generation++;
    stop(previous); // Close the prior period/user before creating its replacement.
    if (previous) { previous.data = null; previous.sources.clear(); previous.scope = null; }
    const entry = {scope: nextScope, generation, sources: new Map(), data: retainedData, localPending: retainedPending, failed: false, error: null, unsubscribe: null, reason};
    active = entry;
    const error = (failure) => {
      if (!current(entry)) return;
      entry.error = failure || new Error('Falha de atualização do relatório.');
      entry.failed = true;
      stop(entry);
      onState(snapshot());
    };
    const next = (sourceKey, event) => {
      if (event === undefined && typeof sourceKey === 'object' && sourceKey !== null) { event = sourceKey; sourceKey = 'report'; }
      if (!current(entry) || !entry.scope.sourceKeys.includes(sourceKey) || !event || typeof event !== 'object') return;
      entry.sources.set(sourceKey, {data: event.data, complete: event.complete !== false, fromCache: event.fromCache, hasPendingWrites: event.hasPendingWrites});
      const ready = entry.scope.sourceKeys.every((key) => entry.sources.get(key)?.complete === true);
      if (ready) entry.data = entry.scope.sourceKeys.length === 1 ? entry.sources.get(entry.scope.sourceKeys[0]).data : Object.fromEntries(entry.scope.sourceKeys.map((key) => [key, entry.sources.get(key).data]));
      publish(entry, ready);
    };
    publish(entry);
    if (!current(entry)) return true;
    try {
      const result = subscribe(entry.scope, {next, error, isCurrent: () => current(entry)});
      if (result && typeof result.then === 'function') Promise.resolve(result).then((unsubscribe) => attach(entry, unsubscribe), error);
      else attach(entry, result);
    } catch (failure) { error(failure); }
    return true;
  };
  return {
    start,
    close,
    refresh(reason = 'retry') { return active ? start(active.scope, {force: true, reason}) : false; },
    setOnline(value) {
      onlineOverride = Boolean(value);
      if (active && !active.failed) publish(active);
      else if (active) onState(snapshot());
    },
    setLocalPending(value, key) {
      if (!active || (key !== undefined && key !== active.scope.key)) return;
      active.localPending = Boolean(value);
      if (!active.failed) publish(active);
      else onState(snapshot());
    },
    snapshot,
    activeKey: () => active?.scope.key || null
  };
}

// Keep local drafts and SDK pending writes separate from accepted records.
export function confirmedLiveReportRecords(records = []) {
  return records.filter((record) => record && typeof record === 'object' && !record?.pendingSync && !record?.pendingFirestore && !record?.syncFailed && !record?.syncConflict && record?.hasPendingWrites !== true && record?.metadata?.hasPendingWrites !== true);
}
