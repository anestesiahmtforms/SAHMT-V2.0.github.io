const SAHMT_V2_CONFIG = Object.freeze({
  "station": "FI",
  "projectId": "sahmt-operacional-fi",
  "databaseId": "(default)",
  "ownerEmail": "anestesiahmtforms9@gmail.com",
  "reportsFolderId": "1ltCtUrtKCosmtYB3RapXvt12z8-jFIVM",
  "reportsSpreadsheetProperty": "FI_OPERATIONAL_SPREADSHEET_ID"
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
    throw new Error('Sincronização bloqueada: a planilha de relatórios não está na pasta oficial FI.');
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

/** Source-local folder policy; metadata reads never recurse or use cached grants. */
function sahmtFolderFailure_(code,status){const error=Error(code);error.safeCode=code;error.status=status||503;throw error;}
function sahmtFolderIdValid_(id){
  return typeof id==='string'&&!!id&&id.split('/').every(function(part){
    if(!part||part==='.'||part==='..')return false;
    try{const decoded=decodeURIComponent(part);return !/[\x00-\x1f\x7f]/.test(decoded)&&encodeURIComponent(decoded)===part;}catch(_){return false;}
  });
}
function sahmtRequireFolders_(ids){
  if(!Array.isArray(ids)||!ids.length)return;
  let document;
  try{document=firestoreRequest_(firestoreDocumentsUrl_('/runtimePolicy/folders'),{method:'get'});}
  catch(error){if(error.status===404)return;sahmtFolderFailure_('CONTROLE_POLITICA_INDISPONIVEL');}
  const policy=firestoreFieldsToJs_(document&&document.fields||{});
  if(policy.schemaVersion!==1||!Number.isSafeInteger(policy.revision)||policy.revision<1||
      !Array.isArray(policy.disabled)||!Array.from(policy.disabled).every(sahmtFolderIdValid_))sahmtFolderFailure_('CONTROLE_POLITICA_INVALIDA');
  ids.forEach(function(id){
    if(!sahmtFolderIdValid_(id))sahmtFolderFailure_('CONTROLE_POLITICA_INVALIDA');
    const parts=id.split('/');
    for(let n=1;n<=parts.length;n++)if(policy.disabled.indexOf(parts.slice(0,n).join('/'))>=0)sahmtFolderFailure_('CONTROLE_PASTA_DESATIVADA',403);
  });
}
function sahmtCollectionFolders_(collection){
  if(['runtimePolicy','migrationControl','users','documentAccessEmails','accessRequests'].includes(collection))return [];
  if(collection==='vacations')return ['operacao/escala/ferias'];
  if(collection==='scheduleDays')return ['operacao/escala'];
  if(['contacts','eventMembers','userCategories'].includes(collection))return ['operacao/pessoas'];
  if(['events','eventCatalogs','eventProjectionOutbox','eventProjections'].includes(collection))return ['operacao/eventos'];
  if(/^fgPerformance/.test(collection))return ['operacao/checklist/desempenho'];
  if(/^checklist|^stations$/.test(collection))return ['operacao/checklist'];
  if(/^label/.test(collection))return ['operacao/etiquetas'];
  return [{FG:'operacao/checklist',FH:'operacao/etiquetas',FI:'operacao/eventos',FJ:'operacao/eventos'}[SAHMT_V2_CONFIG.station]];
}
function sahmtGuardFirestoreRequest_(url,options){
  const suffix=url.slice(firestoreDocumentsUrl_('').length).split('?')[0];
  if(suffix==='/runtimePolicy/folders'||[':beginTransaction',':rollback'].includes(suffix))return;
  const collections=[];
  if(suffix.startsWith('/'))collections.push(decodeURIComponent(suffix.split('/')[1]));
  else if(options&&options.payload){
    let body;try{body=JSON.parse(options.payload);}catch(_){sahmtFolderFailure_('CONTROLE_POLITICA_INVALIDA');}
    (body.structuredQuery&&body.structuredQuery.from||[]).forEach(function(row){collections.push(row.collectionId);});
    (body.documents||[]).forEach(function(name){collections.push(String(name).split('/documents/')[1]?.split('/')[0]);});
    (body.writes||[]).forEach(function(write){const name=write.update&&write.update.name||write.delete||write.transform&&write.transform.document;collections.push(String(name).split('/documents/')[1]?.split('/')[0]);});
  }
  const ids=[];collections.forEach(function(collection){sahmtCollectionFolders_(collection).forEach(function(id){if(ids.indexOf(id)<0)ids.push(id);});});
  sahmtRequireFolders_(ids);
}

function firestoreRequest_(url, options) {
  const ownRoot = firestoreDocumentsUrl_('');
  if (!(url === ownRoot || url.startsWith(ownRoot + '/') || url.startsWith(ownRoot + ':'))) throw new Error('DESTINO_FIRESTORE_INVALIDO');
  sahmtGuardFirestoreRequest_(url,options);
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
