const SAHMT_V2_CONFIG = Object.freeze({
  projectId: 'sahmt-17a16',
  databaseId: '(default)',
  reportsFolderId: '1sL1NPK-CkZHmWJO_39MLajU-VpJIOZ74',
  reportsSpreadsheetProperty: 'SAHMT_V2_REPORTS_SPREADSHEET_ID',
  destinationApprovalProperty: 'SAHMT_V2_REPORTS_DESTINATION_APPROVED'
});

const SAHMT_V2_REPORT_TABS = Object.freeze({
  CHECKLIST: Object.freeze({
    fields: ['syncKey', 'resourceType', 'idRegistro', 'date', 'stationId', 'condition', 'status', 'occurrence', 'createdByUid', 'createdAt', 'updatedAt', 'version']
  }),
  EVENTOS: Object.freeze({
    fields: ['syncKey', 'resourceType', 'idRegistro', 'date', 'memberStatus', 'eventType', 'description', 'delayMultiple', 'substitute', 'shift', 'payer', 'creditor', 'amountToPay', 'status', 'active', 'createdByUid', 'updatedByUid', 'createdAt', 'updatedAt', 'version']
  }),
  TREINAMENTOS: Object.freeze({
    fields: ['syncKey', 'resourceType', 'idRegistro', 'uid', 'trainingId', 'title', 'description', 'videoId', 'videoUrl', 'startedAt', 'lastPosition', 'duration', 'watchedPercent', 'status', 'sourceType', 'completionPoints', 'points', 'createdAt', 'updatedAt', 'completedAt', 'version']
  }),
  GESTAO_ATIVIDADES: Object.freeze({
    fields: ['syncKey', 'resourceType', 'idRegistro', 'managementAreaId', 'activityId', 'title', 'description', 'responsibleUid', 'responsibleUids', 'participantUids', 'priority', 'status', 'dueAt', 'completedAt', 'points', 'createdByUid', 'updatedByUid', 'createdAt', 'updatedAt', 'version', 'uid', 'type', 'pointsGenerated']
  }),
  GESTAO_INDICADORES: Object.freeze({
    fields: ['syncKey', 'resourceType', 'idRegistro', 'managementAreaId', 'indicatorId', 'name', 'description', 'unit', 'target', 'direction', 'frequency', 'ownerUid', 'period', 'value', 'status', 'createdByUid', 'createdAt', 'version']
  }),
  GESTAO_PLANOS_ACAO: Object.freeze({
    fields: ['syncKey', 'resourceType', 'idRegistro', 'managementAreaId', 'planId', 'title', 'description', 'origin', 'responsibleUid', 'responsibleUids', 'participantUids', 'priority', 'dueAt', 'openedAt', 'completedAt', 'status', 'createdByUid', 'updatedByUid', 'createdAt', 'updatedAt', 'version']
  }),
  PONTUACOES: Object.freeze({
    fields: ['syncKey', 'resourceType', 'idRegistro', 'uid', 'sourceType', 'sourceId', 'points', 'ruleVersion', 'createdAt']
  }),
  AUDITORIA: Object.freeze({
    fields: ['syncKey', 'resourceType', 'idRegistro', 'timestamp', 'actorUid', 'action', 'resourceId', 'requestId', 'deviceId', 'appVersion']
  })
});

const SAHMT_V2_RESOURCE_TABS = Object.freeze({
  checklists: 'CHECKLIST',
  events: 'EVENTOS',
  trainings: 'TREINAMENTOS',
  trainingReceipts: 'TREINAMENTOS',
  trainingCompletions: 'TREINAMENTOS',
  activities: 'GESTAO_ATIVIDADES',
  activityInteractions: 'GESTAO_ATIVIDADES',
  indicators: 'GESTAO_INDICADORES',
  indicatorMeasurements: 'GESTAO_INDICADORES',
  actionPlans: 'GESTAO_PLANOS_ACAO',
  actionPlanItems: 'GESTAO_PLANOS_ACAO',
  scores: 'PONTUACOES',
  auditLogs: 'AUDITORIA'
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
  const file = DriveApp.getFileById(spreadsheetId);
  const parents = file.getParents();
  let inReportsFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === SAHMT_V2_CONFIG.reportsFolderId) inReportsFolder = true;
  }
  if (!inReportsFolder) {
    throw new Error('Sincronização bloqueada: a planilha de relatórios não está na pasta oficial SAHMT V2.0.');
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

function sahmtFolderFailure_(code,status){const error=Error(code);error.safeCode=code;error.status=status||503;throw error;}
function sahmtFolderIdValid_(id){
  return typeof id==='string'&&!!id&&id.split('/').every(function(part){
    if(!part||part==='.'||part==='..')return false;
    try{const decoded=decodeURIComponent(part);return !/[\x00-\x1f\x7f]/.test(decoded)&&encodeURIComponent(decoded)===part;}catch(_){return false;}
  });
}
function sahmtRequireFolders_(ids,root,includeManagementChildren){
  if(!Array.isArray(ids)||!ids.length)return;
  let document;
  try{document=firestoreRequest_((root||firestoreDocumentsUrl_(''))+'/runtimePolicy/folders',{method:'get',followRedirects:false});}
  catch(error){if(error.status===404)return;sahmtFolderFailure_('CONTROLE_POLITICA_INDISPONIVEL');}
  const policy=firestoreFieldsToJs_(document&&document.fields||{});
  if(policy.schemaVersion!==1||!Number.isSafeInteger(policy.revision)||policy.revision<1||
      !Array.isArray(policy.disabled)||!Array.from(policy.disabled).every(sahmtFolderIdValid_))sahmtFolderFailure_('CONTROLE_POLITICA_INVALIDA');
  if(includeManagementChildren&&policy.disabled.some(id=>id.indexOf('gestao/')===0))sahmtFolderFailure_('CONTROLE_PASTA_DESATIVADA',403);
  ids.forEach(function(id){
    if(!sahmtFolderIdValid_(id))sahmtFolderFailure_('CONTROLE_POLITICA_INVALIDA');
    const parts=id.split('/');
    for(let n=1;n<=parts.length;n++)if(policy.disabled.indexOf(parts.slice(0,n).join('/'))>=0)sahmtFolderFailure_('CONTROLE_PASTA_DESATIVADA',403);
  });
}
function sahmtV2CollectionFolders_(collection) {
  if (/^qmentum/.test(collection)) return ['registros/qmentum'];
  if (/^occurrence/.test(collection)) return ['registros/ocorrencias'];
  if (/^fcPerformance/.test(collection)) return ['desempenho/fc','registros/ocorrencias','registros/qmentum'];
  if (/^fgPerformance/.test(collection)) return ['operacao/checklist/desempenho'];
  if (/^checklist/.test(collection) || collection === 'stations') return ['operacao/checklist'];
  if (collection === 'scheduleDays') return ['operacao/escala','operacao/escala/ferias','operacao/eventos'];
  if (collection === 'vacations') return ['operacao/escala/ferias'];
  if (['contacts','eventMembers'].includes(collection)) return ['operacao/pessoas'];
  if (/^event/.test(collection)) return ['operacao/eventos'];
  if (/^label/.test(collection)) return ['operacao/etiquetas'];
  if (['activities','activityInteractions','activityScoreReviews','indicators','indicatorMeasurements',
       'actionPlans','actionPlanItems','documents','scopedDocuments','equipment','equipmentEvents','maintenanceRecords'].includes(collection)) return ['gestao'];
  return [];
}

function sahmtV2GuardFirestore_(url,options) {
  const match=/^(https:\/\/firestore\.googleapis\.com\/v1\/projects\/[A-Za-z0-9_-]+\/databases\/\(default\)\/documents)([^?]*)/.exec(url);
  if (!match) return;
  const root=match[1],suffix=match[2];
  if (suffix==='/runtimePolicy/folders'||[':beginTransaction',':rollback'].includes(suffix)) return;
  const collections=[];
  function addPath(path) {
    const suffix=String(path).split('/documents/').pop();
    if(suffix)collections.push(decodeURIComponent(suffix.split('/')[0].split(':')[0]));
  }
  if(suffix.startsWith('/'))addPath(root+suffix);
  if(suffix==='/appConfig/labelStaff')collections.push('labelStaff');
  if(options&&options.payload){
    let body;
    try{body=JSON.parse(options.payload);}catch(error){sahmtFolderFailure_('CONTROLE_POLITICA_INVALIDA');}
    const query=body.structuredQuery||body.structuredAggregationQuery?.structuredQuery;
    for(const source of query?.from||[])collections.push(source.collectionId);
    for(const path of body.documents||[])addPath(path);
    for(const write of body.writes||[])addPath(write.update?.name||write.delete||write.transform?.document||write.verify||'');
  }
  const folders=[...new Set(collections.flatMap(sahmtV2CollectionFolders_))];
  sahmtRequireFolders_(folders,root,folders.includes('gestao'));
}

function firestoreRequest_(url, options) {
  sahmtV2GuardFirestore_(url,options);
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
