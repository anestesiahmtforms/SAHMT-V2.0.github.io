const OPERATIONAL_COLLECTIONS = new Set(['events', 'labels', 'checklists', 'activities']);
const OFFLINE_QUEUED_COLLECTIONS = new Set(['events', 'checklists', 'activities']);

export function mayQueueOffline(collectionName) {
  return OFFLINE_QUEUED_COLLECTIONS.has(collectionName);
}

export function buildOperationalWrite({collectionName, data, uid, requestId, now}) {
  if (!OPERATIONAL_COLLECTIONS.has(collectionName)) throw new Error('Coleção operacional não permitida.');
  if (!data || typeof data !== 'object' || !uid || !requestId || now === undefined) throw new Error('Dados da gravação operacional incompletos.');
  const record = {
    ...data,
    active: data.active ?? true,
    id: requestId,
    clientMutationId: requestId,
    createdByUid: uid,
    updatedByUid: uid,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  return {record};
}

export function stageOperationalWrite(batch, {collectionName, data, uid, requestId, now, recordRef, assertCurrent}) {
  assertCurrent?.();
  const write = buildOperationalWrite({collectionName, data, uid, requestId, now});
  batch.set(recordRef, write.record);
  return write;
}

export async function runGuardedOperationalWrite({write, confirmCommitted, queue, canQueue, assertCurrent = () => {}}) {
  assertCurrent();
  try {
    return await write();
  } catch (error) {
    assertCurrent();
    if (['stale-version', 'session-changed'].includes(error.code)) throw error;
    let confirmed;
    try {
      confirmed = await confirmCommitted();
    } catch { /* A failed confirmation must not create a second mutation ID. */ }
    assertCurrent();
    if (confirmed) return confirmed;
    if (!canQueue(error)) throw error;
    return queue(error);
  }
}
