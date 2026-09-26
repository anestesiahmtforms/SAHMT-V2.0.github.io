const SAHMT_V2_SPARK_REPORT_SCAN = Object.freeze({
  resourcesPerRun: 4,
  recordsPerResource: 12,
  cursorPrefix: 'SAHMT_V2_SPARK_REPORT_CURSOR_',
  rotationProperty: 'SAHMT_V2_SPARK_REPORT_ROTATION',
  resources: Object.freeze([
    {type: 'checklists', changedAt: 'updatedAt'},
    {type: 'events', changedAt: 'updatedAt'},
    {type: 'trainings', changedAt: 'updatedAt'},
    {type: 'activities', changedAt: 'updatedAt'},
    {type: 'activityInteractions', changedAt: 'createdAt'},
    {type: 'indicators', changedAt: 'updatedAt'},
    {type: 'indicatorMeasurements', changedAt: 'createdAt'},
    {type: 'actionPlans', changedAt: 'updatedAt'},
    {type: 'actionPlanItems', changedAt: 'updatedAt'},
    {type: 'scores', changedAt: 'createdAt'},
    {type: 'auditLogs', changedAt: 'timestamp'}
  ])
});

function syncSparkReportsPeriodically() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {skipped: 'another run holds the lock'};
  try {
    const spreadsheetId = sahmtV2SpreadsheetId_();
    sahmtV2RequirePrivateSpreadsheet_(spreadsheetId);
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    requireSparkReportTabs_(spreadsheet);
    const properties = sahmtV2Properties_();
    const configs = SAHMT_V2_SPARK_REPORT_SCAN.resources;
    const start = Number(properties.getProperty(SAHMT_V2_SPARK_REPORT_SCAN.rotationProperty) || 0) % configs.length;
    const result = {processed: 0, resourcesScanned: 0};
    const pending = [];
    for (let offset = 0; offset < SAHMT_V2_SPARK_REPORT_SCAN.resourcesPerRun; offset++) {
      const config = configs[(start + offset) % configs.length];
      const documents = listSparkReportChanges_(config, SAHMT_V2_SPARK_REPORT_SCAN.recordsPerResource);
      result.resourcesScanned++;
      for (const document of documents) {
        pending.push({config: config, document: document, job: {
          resourceType: config.type,
          resourceId: document.id,
          operation: 'upsert',
          version: Number(document.version) || 1
        }});
        result.processed++;
      }
    }
    upsertSparkReportRows_(spreadsheet, pending);
    // Advance cursors only after every report row has been written successfully.
    // A retry after a partial cursor save is safe because row keys are idempotent.
    pending.forEach(function (item) { saveSparkReportCursor_(item.config, item.document); });
    properties.setProperty(SAHMT_V2_SPARK_REPORT_SCAN.rotationProperty, String((start + SAHMT_V2_SPARK_REPORT_SCAN.resourcesPerRun) % configs.length));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function upsertSparkReportRows_(spreadsheet, pending) {
  const batches = new Map();
  pending.forEach(function (item) {
    const tabName = SAHMT_V2_RESOURCE_TABS[item.job.resourceType];
    const config = tabName && SAHMT_V2_REPORT_TABS[tabName];
    if (!config) throw new Error('Tipo de recurso não habilitado para exportação.');
    if (!batches.has(tabName)) batches.set(tabName, {config: config, rows: []});
    batches.get(tabName).rows.push({job: item.job, record: item.document});
  });

  batches.forEach(function (batch, tabName) {
    const sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) throw new Error('Aba de relatório ausente: ' + tabName + '.');
    const lastRow = sheet.getLastRow();
    const keys = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat() : [];
    const rowByKey = new Map();
    keys.forEach(function (key, index) {
      if (key && !rowByKey.has(key)) rowByKey.set(key, index + 2);
    });

    const updates = [];
    const additions = [];
    batch.rows.forEach(function (entry) {
      const syncKey = entry.job.resourceType + '/' + entry.job.resourceId;
      const row = reportValuesForSpark_(batch.config, entry.job, entry.record);
      const existingRow = rowByKey.get(syncKey);
      if (existingRow) updates.push({rowNumber: existingRow, values: row});
      else {
        additions.push(row);
        rowByKey.set(syncKey, lastRow + additions.length);
      }
    });

    updates.sort(function (a, b) { return a.rowNumber - b.rowNumber; });
    let index = 0;
    while (index < updates.length) {
      let end = index + 1;
      while (end < updates.length && updates[end].rowNumber === updates[end - 1].rowNumber + 1) end++;
      sheet.getRange(updates[index].rowNumber, 1, end - index, batch.config.fields.length)
        .setValues(updates.slice(index, end).map(function (entry) { return entry.values; }));
      index = end;
    }
    if (additions.length) {
      sheet.getRange(lastRow + 1, 1, additions.length, batch.config.fields.length).setValues(additions);
    }
  });
}

function reportValuesForSpark_(config, job, record) {
  const syncKey = job.resourceType + '/' + job.resourceId;
  return config.fields.map(function (field) {
    let value;
    if (field === 'syncKey') value = syncKey;
    else if (field === 'resourceType') value = job.resourceType;
    else if (field === 'idRegistro') value = job.resourceId;
    else value = record[field];
    if (Array.isArray(value)) value = value.join(', ');
    if (value instanceof Date) return value;
    if (typeof value === 'string' && /^[=+@\-]/.test(value)) return "'" + value;
    return value === undefined || value === null ? '' : value;
  });
}

function installSahmtV2SparkReportTrigger() {
  const spreadsheetId = sahmtV2SpreadsheetId_();
  sahmtV2RequirePrivateSpreadsheet_(spreadsheetId);
  requireSparkReportTabs_(SpreadsheetApp.openById(spreadsheetId));
  // Probe the direct collection scan before creating recurring work.
  listSparkReportChanges_(SAHMT_V2_SPARK_REPORT_SCAN.resources[0], 1);
  const existing = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'syncSparkReportsPeriodically';
  });
  if (!existing.length) ScriptApp.newTrigger('syncSparkReportsPeriodically').timeBased().everyMinutes(5).create();
  return {installed: true, existing: existing.length > 0};
}

function resetSahmtV2SparkReportCursors() {
  const properties = sahmtV2Properties_();
  SAHMT_V2_SPARK_REPORT_SCAN.resources.forEach(function (config) {
    properties.deleteProperty(SAHMT_V2_SPARK_REPORT_SCAN.cursorPrefix + config.type);
  });
  properties.setProperty(SAHMT_V2_SPARK_REPORT_SCAN.rotationProperty, '0');
  return {reset: true, resources: SAHMT_V2_SPARK_REPORT_SCAN.resources.length};
}

function requireSparkReportTabs_(spreadsheet) {
  Object.keys(SAHMT_V2_REPORT_TABS).forEach(function (name) {
    const config = SAHMT_V2_REPORT_TABS[name];
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) throw new Error('Aba de relatório ausente: ' + name + '. Execute setupSahmtV2Reporting antes de instalar o gatilho.');
    const headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(function (value) { return String(value || '').trim(); });
    if (headers.join('\u001f') !== config.fields.join('\u001f')) throw new Error('Cabeçalhos divergentes na aba ' + name + '. Revise o contrato antes da sincronização.');
  });
}

function listSparkReportChanges_(config, limit) {
  const collectionConfig = SAHMT_V2_RESOURCE_TABS[config.type];
  const reportConfig = collectionConfig && SAHMT_V2_REPORT_TABS[collectionConfig];
  if (!reportConfig) throw new Error('Coleção sem projeção de relatório: ' + config.type + '.');
  const properties = sahmtV2Properties_();
  const saved = properties.getProperty(SAHMT_V2_SPARK_REPORT_SCAN.cursorPrefix + config.type);
  const cursor = saved ? JSON.parse(saved) : null;
  const fieldPaths = Array.from(new Set(['id', 'version', config.changedAt].concat(reportConfig.fields.filter(function (field) {
    return !['syncKey', 'resourceType', 'idRegistro'].includes(field);
  }))));
  const structured = {
    from: [{collectionId: config.type}],
    select: {fields: fieldPaths.map(function (fieldPath) { return {fieldPath: fieldPath}; })},
    orderBy: [
      {field: {fieldPath: config.changedAt}, direction: 'ASCENDING'},
      {field: {fieldPath: '__name__'}, direction: 'ASCENDING'}
    ],
    limit: limit
  };
  if (cursor) structured.startAt = {
    before: false,
    values: [
      {timestampValue: cursor.timestamp},
      {referenceValue: cursor.name}
    ]
  };
  const response = firestoreRequest_(firestoreDocumentsUrl_(':runQuery'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({structuredQuery: structured})
  });
  return (Array.isArray(response) ? response : []).filter(function (item) { return item.document; }).map(function (item) {
    const document = item.document;
    const value = firestoreFieldsToJs_(document.fields || {});
    const id = String(document.name || '').split('/').pop();
    return Object.assign(value, {id: value.id || id, _documentName: document.name,
      _cursorTimestamp: value[config.changedAt] instanceof Date ? value[config.changedAt].toISOString() : '',
      _cursorName: document.name});
  });
}

function saveSparkReportCursor_(config, document) {
  if (!document._cursorTimestamp || !document._cursorName) throw new Error('Documento sem cursor temporal válido: ' + config.type + '/' + document.id + '.');
  sahmtV2Properties_().setProperty(SAHMT_V2_SPARK_REPORT_SCAN.cursorPrefix + config.type, JSON.stringify({
    timestamp: document._cursorTimestamp, name: document._cursorName
  }));
}
