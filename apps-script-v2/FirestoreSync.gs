function syncPendingReports() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {skipped: 'another run holds the lock'};
  try {
    const spreadsheetId = sahmtV2SpreadsheetId_();
    sahmtV2RequirePrivateSpreadsheet_(spreadsheetId);
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const jobs = listDueSyncJobs_();
    const results = {processed: 0, retried: 0, failed: 0};
    jobs.forEach(function (job) {
      try {
        processSyncJob_(spreadsheet, job);
        results.processed++;
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        const permanent = attempts >= SAHMT_V2_CONFIG.maxAttempts;
        const delay = Math.min(SAHMT_V2_CONFIG.retryMaxMs, SAHMT_V2_CONFIG.retryBaseMs * Math.pow(2, Math.min(attempts - 1, 8)));
        try {
          updateSyncJob_(job, {
            status: permanent ? 'error' : 'pending',
            attempts: attempts,
            updatedAt: new Date(),
            nextAttemptAt: new Date(Date.now() + delay),
            lastError: String(error && error.message || 'Falha de sincronização').slice(0, 300)
          });
        } catch (stateError) {
          console.error('Não foi possível atualizar o job ' + job.id + ': ' + String(stateError && stateError.message || stateError).slice(0, 200));
        }
        console.error('Falha no job ' + job.id + ': ' + String(error && error.message || error).slice(0, 300));
        if (permanent) results.failed++; else results.retried++;
      }
    });
    return results;
  } finally {
    lock.releaseLock();
  }
}

function listDueSyncJobs_() {
  const now = new Date().toISOString();
  const body = {structuredQuery: {
    from: [{collectionId: 'syncQueue'}],
    where: {compositeFilter: {op: 'AND', filters: [
      {fieldFilter: {field: {fieldPath: 'status'}, op: 'EQUAL', value: {stringValue: 'pending'}}},
      {fieldFilter: {field: {fieldPath: 'nextAttemptAt'}, op: 'LESS_THAN_OR_EQUAL', value: {timestampValue: now}}}
    ]}},
    orderBy: [{field: {fieldPath: 'nextAttemptAt'}, direction: 'ASCENDING'}],
    limit: SAHMT_V2_CONFIG.maxJobsPerRun
  }};
  const response = firestoreRequest_(firestoreDocumentsUrl_(':runQuery'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body)
  });
  return (Array.isArray(response) ? response : []).filter(function (item) { return item.document; }).map(function (item) {
    const document = item.document;
    const fields = firestoreFieldsToJs_(document.fields || {});
    return Object.assign(fields, {name: document.name, updateTime: document.updateTime});
  });
}

function processSyncJob_(spreadsheet, job) {
  const tabName = SAHMT_V2_RESOURCE_TABS[job.resourceType];
  if (!tabName || !['upsert', 'delete'].includes(job.operation) || !job.resourceId || !Number.isInteger(Number(job.version)) || Number(job.version) < 1) {
    throw new Error('Job fora do contrato de exportação.');
  }
  try {
    const recordDocument = firestoreRequest_(firestoreDocumentReadUrl_(job.resourceType, job.resourceId), {method: 'get'});
    const record = firestoreFieldsToJs_(recordDocument.fields || {});
    if (record.id !== job.resourceId || (Number.isFinite(Number(record.version)) && Number(record.version) < Number(job.version))) {
      throw new Error('A versão do registro ainda não corresponde ao job.');
    }
    // Read the current source and upsert it even for an older queued event. This
    // prevents a delayed job from replacing a newer row with an older snapshot.
    upsertReportRow_(spreadsheet, job, record);
  } catch (error) {
    if (job.operation !== 'delete' || error.status !== 404) throw error;
    removeReportRow_(spreadsheet, job);
  }
  updateSyncJob_(job, {status: 'synced', attempts: Number(job.attempts || 0), updatedAt: new Date(), nextAttemptAt: new Date(), lastError: ''});
}

function updateSyncJob_(job, changes) {
  const body = {writes: [{
    update: {name: job.name, fields: firestoreFieldsFromJs_(changes)},
    updateMask: {fieldPaths: Object.keys(changes)},
    currentDocument: {updateTime: job.updateTime}
  }]};
  firestoreRequest_(firestoreDocumentsUrl_(':commit'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body)
  });
}
