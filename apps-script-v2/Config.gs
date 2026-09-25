const SAHMT_V2_CONFIG = Object.freeze({
  projectId: 'sahmt-17a16',
  databaseId: '(default)',
  reportsFolderId: '1sL1NPK-CkZHmWJO_39MLajU-VpJIOZ74',
  reportsSpreadsheetProperty: 'SAHMT_V2_REPORTS_SPREADSHEET_ID',
  destinationApprovalProperty: 'SAHMT_V2_REPORTS_DESTINATION_APPROVED',
  maxJobsPerRun: 40,
  maxAttempts: 8,
  retryBaseMs: 5 * 60 * 1000,
  retryMaxMs: 6 * 60 * 60 * 1000
});

const SAHMT_V2_REPORT_TABS = Object.freeze({
  checklists: Object.freeze({
    name: 'CHECKLIST',
    fields: ['syncKey', 'idRegistro', 'date', 'stationId', 'condition', 'status', 'occurrence', 'responsibleUid', 'responsibleName', 'responsibleEmail', 'createdAt', 'updatedAt', 'version']
  }),
  labels: Object.freeze({
    name: 'ETIQUETAS',
    fields: ['syncKey', 'idRegistro', 'date', 'patientName', 'procedureCode', 'encounterCode', 'type', 'amount', 'insurance', 'creditor', 'staffSiglas', 'consultation', 'status', 'createdByUid', 'createdAt', 'updatedAt', 'version']
  }),
  events: Object.freeze({
    name: 'EVENTOS',
    fields: ['syncKey', 'idRegistro', 'date', 'memberStatus', 'eventType', 'description', 'delayMultiple', 'substitute', 'shift', 'payer', 'creditor', 'amountToPay', 'status', 'active', 'createdByUid', 'updatedByUid', 'createdAt', 'updatedAt', 'version']
  })
});

function sahmtV2Properties_() {
  return PropertiesService.getScriptProperties();
}

function sahmtV2SpreadsheetId_() {
  const id = sahmtV2Properties_().getProperty(SAHMT_V2_CONFIG.reportsSpreadsheetProperty);
  if (!id || !/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    throw new Error('Configure SAHMT_V2_REPORTS_SPREADSHEET_ID após revisar o acesso da pasta oficial de relatórios.');
  }
  return id;
}

function sahmtV2RequirePrivateFolder_() {
  const folder = DriveApp.getFolderById(SAHMT_V2_CONFIG.reportsFolderId);
  const access = folder.getSharingAccess();
  if (access !== DriveApp.Access.PRIVATE) {
    throw new Error('Sincronização bloqueada: a pasta oficial de relatórios não está privada (acesso atual: ' + access + '). Restrinja o acesso no Drive e revise o destino antes de reativar.');
  }
  return folder;
}

function sahmtV2RequirePrivateSpreadsheet_(spreadsheetId) {
  sahmtV2RequirePrivateFolder_();
  const access = DriveApp.getFileById(spreadsheetId).getSharingAccess();
  if (access !== DriveApp.Access.PRIVATE) {
    throw new Error('Sincronização bloqueada: a planilha de relatórios não está privada (acesso atual: ' + access + '). Restrinja o acesso no Drive e revise o destino antes de reativar.');
  }
}

function firestoreDocumentsUrl_(path) {
  return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(SAHMT_V2_CONFIG.projectId) +
    '/databases/' + encodeURIComponent(SAHMT_V2_CONFIG.databaseId) + '/documents' + path;
}

function firestoreRequest_(url, options) {
  const response = UrlFetchApp.fetch(url, Object.assign({
    muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}
  }, options || {}));
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('Firestore REST respondeu HTTP ' + status + '.');
  }
  const text = response.getContentText();
  return text ? JSON.parse(text) : {};
}

function firestoreValueToJs_(value) {
  if (!value || value.nullValue !== undefined) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.timestampValue !== undefined) return new Date(value.timestampValue);
  if (value.referenceValue !== undefined) return value.referenceValue;
  if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(firestoreValueToJs_);
  if (value.mapValue !== undefined) return firestoreFieldsToJs_(value.mapValue.fields || {});
  return null;
}

function firestoreFieldsToJs_(fields) {
  return Object.fromEntries(Object.keys(fields || {}).map(function (key) {
    return [key, firestoreValueToJs_(fields[key])];
  }));
}

function firestoreValueFromJs_(value) {
  if (value === null || value === undefined) return {nullValue: null};
  if (value instanceof Date) return {timestampValue: value.toISOString()};
  if (typeof value === 'boolean') return {booleanValue: value};
  if (typeof value === 'number') return Number.isInteger(value) ? {integerValue: String(value)} : {doubleValue: value};
  return {stringValue: String(value)};
}

function firestoreFieldsFromJs_(values) {
  return Object.fromEntries(Object.keys(values).map(function (key) {
    return [key, firestoreValueFromJs_(values[key])];
  }));
}
