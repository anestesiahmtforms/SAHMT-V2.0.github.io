function canonical(value) {
  if (value instanceof Date) return {$timestamp: value.getTime()};
  if (value && typeof value.toMillis === 'function') return {$timestamp: value.toMillis()};
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/** Returns local Checklist outbox IDs proven by an already-fetched server snapshot. */
export function confirmedChecklistOutboxRequestIds(serverRecords, unsettledOperations, uid) {
  if (!uid || !Array.isArray(serverRecords) || !Array.isArray(unsettledOperations)) return [];
  const byId = new Map(serverRecords.filter(record => record?.id).map(record => [record.id, record]));
  const confirmed = new Set();
  for (const operation of unsettledOperations) {
    if (operation?.uid !== uid || operation.type !== 'checklists' || operation.payload?.collectionName !== 'checklists') continue;
    const requestId = operation.requestId;
    const data = operation.payload.data;
    if (typeof requestId !== 'string' || !requestId || !data || typeof data !== 'object' || Array.isArray(data)) continue;
    const record = byId.get(requestId);
    if (!record || record.id !== requestId || record.clientMutationId !== requestId || record.createdByUid !== uid) continue;
    if (!Object.entries(data).every(([key, value]) => sameValue(record[key], value))) continue;
    confirmed.add(requestId);
  }
  return [...confirmed];
}

/** Removes only outbox entries whose exact commit is present in a fresh server result. */
export async function reconcileConfirmedChecklistOutbox(serverRecords, unsettledOperations, uid, removeQueuedOperation, onCommitted = () => {}) {
  if (typeof removeQueuedOperation !== 'function') return new Set();
  const reconciled = new Set();
  for (const requestId of confirmedChecklistOutboxRequestIds(serverRecords, unsettledOperations, uid)) {
    try {
      if (!await removeQueuedOperation(uid, requestId, {committed: true})) continue;
      reconciled.add(requestId);
      onCommitted(requestId);
    } catch { /* Keep the operation visible when local storage cannot remove it. */ }
  }
  return reconciled;
}
