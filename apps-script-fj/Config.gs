const SAHMT_V2_CONFIG = Object.freeze({
  "station": "FJ",
  "projectId": "sahmt-escala-fj",
  "databaseId": "(default)",
  "ownerEmail": "anestesiahmtforms10@gmail.com",
  "reportsFolderId": "1NHw90utWs8odBv3N2shmGMv8w9MvWcBX",
  "reportsSpreadsheetProperty": "FJ_SOURCE_SPREADSHEET_ID"
});

function sahmtV2Properties_() {
  return PropertiesService.getScriptProperties();
}

function sahmtV2SpreadsheetId_() {
  const id = sahmtV2Properties_().getProperty(SAHMT_V2_CONFIG.reportsSpreadsheetProperty);
  if (!id || !/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    throw new Error('Execute a configuração inicial deste módulo antes de usar a planilha.');
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
  const file = DriveApp.getFileById(spreadsheetId);
  const parents = file.getParents();
  let inReportsFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === SAHMT_V2_CONFIG.reportsFolderId) inReportsFolder = true;
  }
  if (!inReportsFolder) {
    throw new Error('Sincronização bloqueada: a planilha de relatórios não está na pasta oficial FJ.');
  }
  const access = file.getSharingAccess();
  if (access !== DriveApp.Access.PRIVATE) {
    throw new Error('Sincronização bloqueada: a planilha de relatórios não está privada (acesso atual: ' + access + '). Restrinja o acesso no Drive e revise o destino antes de reativar.');
  }
}

function firestoreDocumentsUrl_(path) {
  return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(SAHMT_V2_CONFIG.projectId) +
    '/databases/' + encodeURIComponent(SAHMT_V2_CONFIG.databaseId) + '/documents' + path;
}

function firestoreRequest_(url, options) {
  const ownRoot = firestoreDocumentsUrl_('');
  if (!(url === ownRoot || url.startsWith(ownRoot + '/') || url.startsWith(ownRoot + ':'))) throw new Error('DESTINO_FIRESTORE_INVALIDO');
  const response = UrlFetchApp.fetch(url, Object.assign({
    muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}
  }, options || {}));
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    const error = new Error('Firestore REST respondeu HTTP ' + status + '.');
    error.status = status;
    throw error;
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
  if (Array.isArray(value)) return {arrayValue: {values: value.map(firestoreValueFromJs_)}};
  if (typeof value === 'object') return {mapValue: {fields: firestoreFieldsFromJs_(value)}};
  return {stringValue: String(value)};
}

function firestoreFieldsFromJs_(values) {
  return Object.fromEntries(Object.keys(values).map(function (key) {
    return [key, firestoreValueFromJs_(values[key])];
  }));
}

function sha256Hex_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function firestoreDocumentName_(collectionId, documentId) {
  return 'projects/' + SAHMT_V2_CONFIG.projectId + '/databases/' + SAHMT_V2_CONFIG.databaseId +
    '/documents/' + collectionId + '/' + documentId;
}

/** Initial setup only: restrict general access without changing individual grants. */
function sahmtPreparePrivateFolder_() {
  const expectedOwner = SAHMT_V2_CONFIG.ownerEmail.toLowerCase();
  if (String(Session.getEffectiveUser().getEmail()).toLowerCase() !== expectedOwner) throw new Error('EXECUTOR_PASTA_INVALIDO');
  const folder = DriveApp.getFolderById(SAHMT_V2_CONFIG.reportsFolderId);
  const owner = folder.getOwner();
  if (folder.getId() !== SAHMT_V2_CONFIG.reportsFolderId || !owner || String(owner.getEmail()).toLowerCase() !== expectedOwner) throw new Error('PROPRIETARIO_PASTA_INVALIDO');
  if (sahmtV2Properties_().getProperty(SAHMT_V2_CONFIG.reportsSpreadsheetProperty)) return sahmtV2RequirePrivateFolder_();
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
  const verified = sahmtV2RequirePrivateFolder_();
  const verifiedOwner = verified.getOwner();
  if (verified.getId() !== SAHMT_V2_CONFIG.reportsFolderId || !verifiedOwner || String(verifiedOwner.getEmail()).toLowerCase() !== expectedOwner) throw new Error('VERIFICACAO_PASTA_INVALIDA');
  return verified;
}

/** Run by the owner during first setup; uses this script's own Drive authorization. */
function sahmtPlaceScriptInFolder_() {
  const folder = sahmtV2RequirePrivateFolder_(), file = DriveApp.getFileById(ScriptApp.getScriptId());
  const parents = file.getParents(); let found = false;
  while (parents.hasNext()) if (parents.next().getId() === SAHMT_V2_CONFIG.reportsFolderId) found = true;
  if (!found) file.moveTo(folder);
  return folder;
}
