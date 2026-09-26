import {createHash} from 'node:crypto';

export const REPORT_SYNC_COLLECTIONS = Object.freeze([
  'events',
  'labels',
  'checklists',
  'trainings',
  'trainingReceipts',
  'trainingCompletions',
  'activities',
  'activityInteractions',
  'indicators',
  'indicatorMeasurements',
  'actionPlans',
  'actionPlanItems',
  'scores',
  'auditLogs'
]);

const REPORT_SYNC_COLLECTION_SET = new Set(REPORT_SYNC_COLLECTIONS);

export function buildReportSyncJob({collectionName, resourceId, eventId, beforeExists, afterExists, version, now}) {
  if (!REPORT_SYNC_COLLECTION_SET.has(collectionName)) {
    throw new Error('Coleção fora da integração de relatórios V2.');
  }
  if (typeof resourceId !== 'string' || !resourceId || resourceId.length > 1500 ||
      typeof eventId !== 'string' || !eventId || typeof beforeExists !== 'boolean' ||
      typeof afterExists !== 'boolean' || !Number.isInteger(version) || version < 1 ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('Metadados do job de relatório inválidos.');
  }
  if (!beforeExists && !afterExists) throw new Error('O evento de sincronização não contém registro.');

  const operation = afterExists ? 'upsert' : 'delete';
  const id = createHash('sha256')
    .update(`${collectionName}\u0000${resourceId}\u0000${eventId}`)
    .digest('hex');

  return {
    id,
    resourceType: collectionName,
    resourceId,
    operation,
    version,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    lastError: ''
  };
}
