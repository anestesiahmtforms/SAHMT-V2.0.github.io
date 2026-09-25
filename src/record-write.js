const REPORT_COLLECTIONS = new Set(['events', 'labels', 'checklists']);
const OPERATIONAL_COLLECTIONS = new Set([...REPORT_COLLECTIONS, 'activities']);
const OFFLINE_QUEUED_COLLECTIONS = new Set(['events', 'checklists', 'activities']);

export function requiresReportSync(collectionName) {
  return REPORT_COLLECTIONS.has(collectionName);
}

export function mayQueueOffline(collectionName) {
  return OFFLINE_QUEUED_COLLECTIONS.has(collectionName);
}

export function createReportSyncJob({resourceType, resourceId, version, uid, jobId, now}) {
  if (!REPORT_COLLECTIONS.has(resourceType)) throw new Error('Coleção fora da integração de relatórios V2.');
  if (!resourceId || !uid || !jobId || !Number.isInteger(version) || version < 1) throw new Error('Metadados de sincronização inválidos.');
  return {
    id: jobId,
    resourceType,
    resourceId,
    operation: 'upsert',
    version,
    status: 'pending',
    attempts: 0,
    createdByUid: uid,
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    lastError: '',
    clientMutationId: jobId
  };
}

export function buildOperationalWrite({collectionName, data, uid, requestId, now}) {
  if (!OPERATIONAL_COLLECTIONS.has(collectionName)) throw new Error('Coleção operacional não permitida.');
  if (!data || typeof data !== 'object' || !uid || !requestId || now === undefined) throw new Error('Dados da gravação operacional incompletos.');
  const tracked = requiresReportSync(collectionName);
  const record = {
    ...data,
    active: data.active ?? true,
    id: requestId,
    clientMutationId: requestId,
    ...(tracked ? {syncJobId: requestId} : {}),
    createdByUid: uid,
    updatedByUid: uid,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  const syncJob = tracked ? createReportSyncJob({
    resourceType: collectionName,
    resourceId: requestId,
    version: 1,
    uid,
    jobId: requestId,
    now
  }) : null;
  return {record, syncJob};
}

export function stageOperationalWrite(batch, {collectionName, data, uid, requestId, now, recordRef, syncJobRef}) {
  const write = buildOperationalWrite({collectionName, data, uid, requestId, now});
  batch.set(recordRef, write.record);
  if (write.syncJob) {
    if (typeof syncJobRef !== 'function') throw new Error('Referência da fila de relatórios ausente.');
    batch.set(syncJobRef(write.syncJob.id), write.syncJob);
  }
  return write;
}
