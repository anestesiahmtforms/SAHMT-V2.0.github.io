import {createLiveReportSession} from './live-report-session.js';

function sameScope(left, right) {
  return left?.key === right?.key && left?.uid === right?.uid && left?.module === right?.module &&
    left?.permissionKey === right?.permissionKey &&
    JSON.stringify(left?.sourceKeys || ['report']) === JSON.stringify(right?.sourceKeys || ['report']) &&
    ['from', 'to', 'day', 'month', 'loadedLimit', 'sigla', 'isAdmin', 'canManage'].every(key => left?.[key] === right?.[key]) &&
    JSON.stringify(left?.stationIds || []) === JSON.stringify(right?.stationIds || []);
}

function reportRecords(payload) {
  if (Array.isArray(payload)) return payload;
  const report = payload?.report || payload;
  return [...(Array.isArray(report?.records) ? report.records : []), ...(Array.isArray(report?.priorRecords) ? report.priorRecords : [])];
}

function hasLocalPending(payload) {
  return reportRecords(payload).some(record => record && (record.pendingSync || record.pendingFirestore || record.pendingEdit ||
    record.syncFailed || record.syncConflict || record.hasPendingWrites === true || record.metadata?.hasPendingWrites === true));
}

/** Owns report listeners and a shared, session-scoped outbox read in memory. */
export function createReportRuntime({subscribe, isCurrent = () => true, isOnline = () => true,
  onData = () => {}, onState = () => {}, readPending = async () => [], mergePending = (_kind, payload) => payload} = {}) {
  if (typeof subscribe !== 'function') throw new TypeError('Informe o adaptador dos relatórios.');
  if (typeof readPending !== 'function' || typeof mergePending !== 'function') throw new TypeError('Informe como reconciliar as operações pendentes.');
  const entries = new Map(), pendingByUid = new Map();
  let onlineOverride;
  const owned = entry => entries.get(entry.kind) === entry;
  const current = (entry, scope = entry.scope) => owned(entry) && Boolean(scope) && isCurrent(scope);
  const detachPending = entry => {
    const pending = entry.pending;
    entry.pending = null;
    if (!pending) return;
    pending.owners.delete(entry);
    if (!pending.owners.size && pendingByUid.get(pending.uid) === pending) {
      pendingByUid.delete(pending.uid);
      pending.operations = [];
      pending.error = null;
    }
  };
  const forget = entry => {
    if (owned(entry)) entries.delete(entry.kind);
    detachPending(entry);
    entry.scope = null;
    entry.raw = null;
    entry.data = null;
    entry.projectedScope = null;
    entry.projectedRevision = -1;
    entry.mergeError = null;
  };
  const project = (entry, raw, scope) => {
    const pending = entry.pending;
    if (entry.raw === raw && entry.projectedScope === scope && entry.projectedRevision === pending?.revision) return entry.data;
    entry.raw = raw;
    entry.projectedScope = scope;
    entry.projectedRevision = pending?.revision;
    entry.mergeError = null;
    try {
      entry.data = mergePending(entry.kind, raw, pending?.operations || [], scope);
      if (entry.data && typeof entry.data.then === 'function') throw new TypeError('A reconciliação das operações deve ser síncrona.');
    }
    catch (error) { entry.mergeError = error; entry.data = null; }
    return entry.data;
  };
  const pendingFlag = entry => entry.pending?.status !== 'ready' || Boolean(entry.mergeError) || hasLocalPending(entry.data);
  const decorate = (entry, state) => {
    if (state.state === 'closed') return state;
    if (state.data !== null) project(entry, state.data, state.scope);
    const error = state.error || entry.mergeError || entry.pending?.error || null;
    const localPending = pendingFlag(entry);
    const status = state.state === 'offline' ? 'offline' : error ? 'error' : localPending ? 'pending' : state.state;
    return {...state, state: status, confirmed: status === 'server', localPending,
      data: state.data === null ? null : entry.data, error};
  };
  const publishPending = entry => {
    if (!owned(entry)) return;
    const state = entry.rawSnapshot(); // Also disposes externally revoked scopes.
    if (!owned(entry) || state.state === 'closed') return;
    if (state.data !== null) project(entry, state.data, state.scope);
    entry.controller.setLocalPending(pendingFlag(entry), state.key);
    if (state.data !== null && current(entry, state.scope) && !entry.mergeError) onData(entry.kind, entry.data, state.scope);
  };
  const publishOwners = pending => {
    for (const entry of [...pending.owners]) publishPending(entry);
  };
  const readSharedPending = pending => {
    if (pendingByUid.get(pending.uid) !== pending || !pending.owners.size) return Promise.resolve(false);
    if (pending.inFlight) return pending.inFlight;
    const task = Promise.resolve().then(async () => {
      do {
        if (pendingByUid.get(pending.uid) !== pending || !pending.owners.size) return false;
        pending.rerun = false;
        try {
          const operations = await readPending(pending.uid);
          if (pendingByUid.get(pending.uid) !== pending || !pending.owners.size) return false;
          if (!Array.isArray(operations)) throw new TypeError('A lista de operações pendentes não está disponível.');
          pending.operations = operations.filter(operation => operation?.uid === pending.uid);
          pending.status = pending.rerun ? 'loading' : 'ready';
          pending.error = null;
        } catch (error) {
          if (pendingByUid.get(pending.uid) !== pending || !pending.owners.size) return false;
          pending.status = pending.rerun ? 'loading' : 'error';
          pending.error = error;
        }
        pending.revision++;
        publishOwners(pending);
      } while (pending.rerun && pendingByUid.get(pending.uid) === pending && pending.owners.size);
      return pending.status === 'ready';
    });
    pending.inFlight = task.finally(() => { if (pending.inFlight === wrapped) pending.inFlight = null; });
    const wrapped = pending.inFlight;
    // Initial reads have no external caller; retain failures as state without an unhandled rejection.
    wrapped.catch(() => {});
    return wrapped;
  };
  const attachPending = entry => {
    let pending = pendingByUid.get(entry.scope.uid);
    if (!pending) {
      pending = {uid: entry.scope.uid, owners: new Set(), operations: [], status: 'loading', error: null, revision: 0, inFlight: null, rerun: false};
      pendingByUid.set(pending.uid, pending);
    }
    pending.owners.add(entry);
    entry.pending = pending;
    if (pending.status === 'loading' && !pending.inFlight) readSharedPending(pending);
  };
  const closeEntry = (entry, reason) => {
    if (!owned(entry)) return false;
    entry.closing = true;
    forget(entry);
    entry.controller.close(reason);
    entry.closing = false;
    return true;
  };
  const usable = scope => typeof scope?.key === 'string' && scope.key.length > 0 && typeof scope.uid === 'string' && scope.uid.length > 0 && scope.authorized !== false;
  const normalize = (kind, scope, warm) => ({...scope, module: scope.module || kind, warm,
    sourceKeys: [...new Set(scope.sourceKeys || ['report'])]});
  const createEntry = (kind, scope) => {
    const entry = {kind, scope, pending: null, raw: null, data: null, projectedScope: null, projectedRevision: -1, mergeError: null, closing: false};
    const controller = createLiveReportSession({
      subscribe: (value, hooks) => {
        // Set this before adapters can synchronously emit a server snapshot.
        entry.controller.setLocalPending(pendingFlag(entry), value.key);
        return subscribe(kind, value, hooks);
      },
      isCurrent: value => current(entry, value),
      isOnline: () => onlineOverride ?? isOnline(),
      onData: (payload, value) => {
        if (!current(entry, value)) return;
        const data = project(entry, payload, value);
        entry.controller.setLocalPending(pendingFlag(entry), value.key);
        if (current(entry, value) && !entry.mergeError) onData(kind, data, value);
      },
      onState: state => {
        if (state.state === 'closed') {
          const wasOwned = owned(entry);
          if (wasOwned) forget(entry);
          if (wasOwned || entry.closing) onState(kind, state);
          return;
        }
        if (!owned(entry)) return;
        onState(kind, decorate(entry, state));
      }
    });
    entry.controller = controller;
    entry.rawSnapshot = controller.snapshot;
    // Keep the controller's public snapshot consistent with the reconciled onData payload.
    controller.snapshot = () => decorate(entry, entry.rawSnapshot());
    entry.lease = {controller, close: () => {
      if (owned(entry) && entry.scope?.warm === true) closeEntry(entry, 'warm-expired');
    }};
    entries.set(kind, entry);
    attachPending(entry);
    if (onlineOverride !== undefined) controller.setOnline(onlineOverride);
    controller.start(scope);
    return entry;
  };
  const openEntry = (kind, scope, {force = false, warm = false} = {}) => {
    if (typeof kind !== 'string' || !kind) throw new TypeError('Informe qual relatório deve ser aberto.');
    const previous = entries.get(kind);
    if (!usable(scope)) { if (previous) closeEntry(previous, 'unauthorized-scope'); return null; }
    const value = normalize(kind, scope, warm);
    if (!isCurrent(value)) { if (previous) closeEntry(previous, 'scope-changed'); return null; }
    // Background preloads never displace an already opened report.
    if (warm && previous && previous.scope?.warm !== true) return previous;
    if (previous && sameScope(previous.scope, value)) {
      previous.scope = value;
      previous.controller.start(value, {force, reason: warm ? 'warm' : 'open'});
      return owned(previous) ? previous : null;
    }
    if (previous) closeEntry(previous, 'scope-changed');
    const entry = createEntry(kind, value);
    return owned(entry) ? entry : null;
  };
  return {
    open(kind, scope, options = {}) { return openEntry(kind, scope, options)?.controller || null; },
    warm(kind, scope) { return openEntry(kind, scope, {warm: true})?.lease || null; },
    get(kind) {
      const entry = entries.get(kind);
      if (entry && !current(entry)) { closeEntry(entry, 'scope-changed'); return null; }
      return entry?.controller || null;
    },
    refresh(kind, reason = 'retry') {
      const entry = entries.get(kind);
      if (!entry || !current(entry)) { if (entry) closeEntry(entry, 'scope-changed'); return false; }
      if (entry.pending?.status === 'error') {
        entry.pending.status = 'loading'; entry.pending.error = null; entry.pending.revision++;
        readSharedPending(entry.pending);
      }
      return entry.controller.refresh(reason);
    },
    close(kind, reason = 'close') { const entry = entries.get(kind); return entry ? closeEntry(entry, reason) : false; },
    clear(reason = 'clear') {
      for (const entry of [...entries.values()]) closeEntry(entry, reason);
      pendingByUid.clear();
    },
    setOnline(value) {
      onlineOverride = Boolean(value);
      for (const entry of [...entries.values()]) entry.controller.setOnline(onlineOverride);
    },
    invalidatePending(uid) {
      const pending = pendingByUid.get(uid);
      if (!pending) return Promise.resolve(false);
      pending.status = 'loading'; pending.error = null; pending.revision++;
      if (pending.inFlight) pending.rerun = true;
      publishOwners(pending);
      return readSharedPending(pending);
    }
  };
}
