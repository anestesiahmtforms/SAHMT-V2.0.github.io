function reportTime(value) {
  const time = typeof value?.toMillis === 'function' ? value.toMillis()
    : typeof value?.toDate === 'function' ? value.toDate().getTime()
      : value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function latestRecord(previous, candidate) {
  if (!previous) return candidate;
  const version = Number(candidate.version || 0) - Number(previous.version || 0);
  if (version) return version > 0 ? candidate : previous;
  const updated = reportTime(candidate.updatedAt || candidate.createdAt) - reportTime(previous.updatedAt || previous.createdAt);
  if (updated) return updated > 0 ? candidate : previous;
  if (candidate.hasPendingWrites !== previous.hasPendingWrites) return candidate.hasPendingWrites ? candidate : previous;
  return candidate;
}

function eventVisible(record, scope) {
  const sigla = String(scope.sigla || '').trim().toUpperCase();
  return scope.isAdmin === true || record.createdByUid === scope.uid ||
    Boolean(sigla && (record.memberSigla === sigla || record.scheduleSigla === sigla));
}

/** Reconciles only the current user's in-memory outbox with the selected report period. */
export function mergeReportPendingRecords(kind, remote = [], operations = [], scope = {}) {
  if (!['events', 'checklists', 'labels'].includes(kind)) throw new Error('Relatório não permitido.');
  const from = scope.from || scope.day, to = scope.to || scope.day;
  if (!from || !to || from > to) throw new Error('Informe um período válido para o relatório.');
  if (!scope.uid) return [];
  const inPeriod = record => typeof record?.date === 'string' && record.date >= from && record.date <= to;
  const sdkPending = record => record.hasPendingWrites === true || record.metadata?.hasPendingWrites === true;
  const accepted = new Set(), represented = new Set(), originals = new Map(), records = new Map();
  for (const item of remote || []) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    originals.set(item.id, latestRecord(originals.get(item.id), item));
    for (const id of [item.id, item.clientMutationId]) if (id) represented.add(id);
    // Accepted IDs also suppress a stale local contribution that moved out of this period.
    if (!sdkPending(item)) for (const id of [item.id, item.clientMutationId, item.lastRequestId]) if (id) accepted.add(id);
    if (!inPeriod(item) || (kind === 'events' && (item.active === false || !eventVisible(item, scope)))) continue;
    const record = {...item};
    if (sdkPending(record)) record[kind === 'checklists' ? 'pendingSync' : 'pendingFirestore'] = true;
    records.set(record.id, latestRecord(records.get(record.id), record));
  }
  if (kind !== 'labels' && scope.uid) {
    const seen = new Set();
    const ordered = [...(operations || [])].sort((left, right) => reportTime(left.createdAt) - reportTime(right.createdAt));
    for (const operation of ordered) {
      const {requestId, payload, status} = operation || {};
      if (!requestId || seen.has(requestId) || accepted.has(requestId) || operation.uid !== scope.uid ||
        !['queued', 'failed', 'conflict'].includes(status) || payload?.collectionName !== kind || !payload.data || !inPeriod(payload.data)) continue;
      seen.add(requestId);
      const isEdit = kind === 'events' && operation.type === 'eventEdits';
      if (!isEdit && operation.type !== kind) continue;
      if (isEdit && (scope.isAdmin !== true || !payload.eventId || !Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 1)) continue;
      if (!isEdit && represented.has(requestId)) continue;
      if (kind === 'events' && !isEdit && !eventVisible({...payload.data, createdByUid: payload.data.createdByUid || operation.uid}, scope)) continue;
      if (isEdit && originals.get(payload.eventId)?.active === false) continue;
      const existing = records.get(isEdit ? payload.eventId : requestId);
      if (!isEdit && existing) continue;
      if (isEdit && existing?.lastRequestId === requestId) continue;
      const candidate = {...(isEdit ? existing || {} : {}), ...payload.data,
        id: isEdit ? payload.eventId : requestId, clientMutationId: isEdit ? existing?.clientMutationId : requestId,
        createdByUid: isEdit ? existing?.createdByUid || payload.data.createdByUid : scope.uid,
        createdAt: isEdit && existing?.createdAt ? existing.createdAt : new Date(operation.createdAt),
        pendingFirestore: kind !== 'checklists' && status === 'queued', pendingSync: kind === 'checklists' && status === 'queued',
        syncFailed: status === 'failed', syncConflict: status === 'conflict', syncError: operation.lastError || ''};
      if (candidate.active === false || (kind === 'events' && !eventVisible(candidate, scope))) continue;
      if (isEdit) {
        candidate.sourceEventId = payload.eventId;
        candidate.pendingEdit = true;
        candidate.version = payload.expectedVersion + 1;
        candidate.localRequestId = requestId;
        // A queued edit cannot demote a later accepted version while its outbox acknowledgment is arriving.
        const conflicting = status === 'conflict' || status === 'failed' || (existing && Number(existing.version || 1) !== payload.expectedVersion);
        if (conflicting) {
          candidate.id = `${payload.eventId}::draft::${requestId}`;
          candidate.syncConflict = status === 'conflict' || (status !== 'failed' && Boolean(existing && Number(existing.version || 1) !== payload.expectedVersion));
        }
      }
      records.set(candidate.id, candidate);
    }
  }
  return [...records.values()].sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')) || reportTime(right.createdAt) - reportTime(left.createdAt) || String(left.id).localeCompare(String(right.id)));
}
