function setupSahmtV2Reporting() {
  const properties = sahmtV2Properties_();
  const folder = sahmtV2RequirePrivateFolder_();
  if (properties.getProperty(SAHMT_V2_CONFIG.destinationApprovalProperty) !== 'YES') {
    throw new Error('Antes da configuração, confirme que a pasta oficial de relatórios tem acesso restrito e defina SAHMT_V2_REPORTS_DESTINATION_APPROVED=YES nas propriedades do script.');
  }

  let spreadsheetId = properties.getProperty(SAHMT_V2_CONFIG.reportsSpreadsheetProperty);
  let spreadsheet;
  if (spreadsheetId) {
    sahmtV2RequirePrivateSpreadsheet_(spreadsheetId);
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create('SAHMT V2.0 - BASE DE RELATÓRIOS');
    DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
    spreadsheetId = spreadsheet.getId();
    sahmtV2RequirePrivateSpreadsheet_(spreadsheetId);
  }

  const tabConfigs = Object.keys(SAHMT_V2_REPORT_TABS).map(function (name) {
    return {name: name, fields: SAHMT_V2_REPORT_TABS[name].fields};
  });
  // Validate every existing destination tab before changing any tab.
  tabConfigs.forEach(function (config) {
    const existingSheet = spreadsheet.getSheetByName(config.name);
    if (!existingSheet) return;
    const existingHeaders = existingSheet.getRange(1, 1, 1, Math.max(1, existingSheet.getLastColumn())).getValues()[0];
    const hasExistingHeaders = existingSheet.getLastRow() > 0 && existingHeaders.some(function (value) { return String(value || '').trim() !== ''; });
    if (hasExistingHeaders && existingHeaders.join('\u001f') !== config.fields.join('\u001f')) {
      throw new Error('A aba ' + config.name + ' já possui cabeçalhos diferentes do contrato V2; nenhuma aba foi alterada.');
    }
  });
  tabConfigs.forEach(function (config, index) {
    let sheet = spreadsheet.getSheetByName(config.name);
    if (!sheet && index === 0 && spreadsheet.getSheets().length === 1 && spreadsheet.getSheets()[0].getLastRow() === 0) {
      sheet = spreadsheet.getSheets()[0].setName(config.name);
    }
    if (!sheet) sheet = spreadsheet.insertSheet(config.name);
    sheet.getRange(1, 1, 1, config.fields.length).setValues([config.fields]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, config.fields.length).setFontWeight('bold').setBackground('#0d3257').setFontColor('#ffffff');
    if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), config.fields.length).createFilter();
    applyReportColumnFormats_(sheet, config);
  });

  properties.setProperty(SAHMT_V2_CONFIG.reportsSpreadsheetProperty, spreadsheetId);

  return {spreadsheetId: spreadsheetId, tabs: tabConfigs.map(function (config) { return config.name; })};
}

function applyReportColumnFormats_(sheet, config) {
  const textFields = new Set(['syncKey', 'resourceType', 'idRegistro', 'uid', 'responsibleUid', 'responsibleUids', 'participantUids', 'createdByUid', 'updatedByUid', 'actorUid', 'resourceId', 'requestId', 'sourceId', 'trainingId', 'activityId', 'indicatorId', 'planId']);
  const timestampFields = new Set(['createdAt', 'updatedAt', 'startedAt', 'completedAt', 'dueAt', 'openedAt', 'timestamp']);
  const currencyFields = new Set(['amount', 'amountToPay']);
  const integerFields = new Set(['delayMultiple', 'version', 'lastPosition', 'duration', 'watchedPercent', 'points', 'pointsGenerated', 'completionPoints', 'ruleVersion', 'value']);
  config.fields.forEach(function (field, index) {
    const column = index + 1;
    if (textFields.has(field)) sheet.getRange(2, column, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('@');
    else if (timestampFields.has(field)) sheet.getRange(2, column, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
    else if (currencyFields.has(field)) sheet.getRange(2, column, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('"R$" #,##0.00;[Red]-"R$" #,##0.00');
    else if (integerFields.has(field)) sheet.getRange(2, column, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('0');
    else if (field === 'date') sheet.getRange(2, column, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('yyyy-mm-dd');
  });
}

function installSahmtV2SyncTrigger() {
  const spreadsheetId = sahmtV2SpreadsheetId_();
  sahmtV2RequirePrivateSpreadsheet_(spreadsheetId);
  // Probe Rules, IAM, and the composite index before scheduling recurring access.
  listDueSyncJobs_();
  const existing = ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === 'syncPendingReports'; });
  if (!existing.length) ScriptApp.newTrigger('syncPendingReports').timeBased().everyMinutes(5).create();
  return {installed: true, existing: existing.length > 0};
}

function upsertReportRow_(spreadsheet, job, record) {
  const tabName = SAHMT_V2_RESOURCE_TABS[job.resourceType];
  const config = tabName && SAHMT_V2_REPORT_TABS[tabName];
  if (!config) throw new Error('Tipo de recurso não habilitado para exportação.');
  const sheet = spreadsheet.getSheetByName(tabName);
  if (!sheet) throw new Error('Aba de relatório ausente: ' + tabName + '.');

  const syncKey = job.resourceType + '/' + job.resourceId;
  const keyCell = sheet.getRange('A:A').createTextFinder(syncKey).matchEntireCell(true).matchCase(true).findNext();
  const rowNumber = keyCell ? keyCell.getRow() : sheet.getLastRow() + 1;
  const row = config.fields.map(function (field) {
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
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
}

function removeReportRow_(spreadsheet, job) {
  const tabName = SAHMT_V2_RESOURCE_TABS[job.resourceType];
  if (!tabName) throw new Error('Tipo de recurso não habilitado para exportação.');
  const sheet = spreadsheet.getSheetByName(tabName);
  if (!sheet) throw new Error('Aba de relatório ausente: ' + tabName + '.');
  const syncKey = job.resourceType + '/' + job.resourceId;
  const keyCell = sheet.getRange('A:A').createTextFinder(syncKey).matchEntireCell(true).matchCase(true).findNext();
  if (keyCell && keyCell.getRow() > 1) sheet.deleteRow(keyCell.getRow());
}
