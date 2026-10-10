const SAHMT_V2_CHECKLIST_VALIDATION = Object.freeze({maxPendingPerRun: 20, maxStations: 200, maxDailyRecords: 1000});
const SAHMT_V2_DC_ALIASES = Object.freeze({
  segunda: ['CR', 'LH'], terca: ['CR', 'LH', 'AD'], quarta: ['CR', 'LH', 'AD'],
  quinta: ['CR', 'LH'], sexta: ['CR', 'LA']
});
const SAHMT_V2_DC_FALLBACK = Object.freeze(['AD', 'CR', 'LA', 'LH']);

function validatePendingChecklistSignatureRequests() {
  evaluationAssertOperator_(true);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {skipped: 'another run holds the lock'};
  try {
    const requests = listPendingChecklistSignatureRequests_();
    const result = {processed: 0, validated: 0, stale: 0, rejected: 0, retried: 0};
    requests.forEach(function (request) {
      try {
        const outcome = validateChecklistSignatureRequest_(request);
        result.processed++;
        if (outcome === 'VALIDATED' || outcome === 'DUPLICATE') result.validated++;
        else if (outcome === 'STALE') result.stale++;
        else if (outcome === 'REJECTED') result.rejected++;
      } catch (error) {
        result.retried++;
        console.error('Falha ao validar solicitação de Checklist ' + request.day + '/' + String(request.revision || '').slice(0, 12) + ': ' + String(error && error.message || error).slice(0, 300));
      }
    });
    return result;
  } finally {
    lock.releaseLock();
  }
}

function installChecklistValidationTrigger() {
  evaluationAssertOperator_(true);
  listPendingChecklistSignatureRequests_();
  const existing = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'validatePendingChecklistSignatureRequests';
  });
  if (!existing.length) ScriptApp.newTrigger('validatePendingChecklistSignatureRequests').timeBased().everyMinutes(5).create();
  return {installed: true, existing: existing.length > 0};
}

function listPendingChecklistSignatureRequests_() {
  const body = {structuredQuery: {
    from: [{collectionId: 'checklistSignatureRequests'}],
    where: {fieldFilter: {field: {fieldPath: 'status'}, op: 'EQUAL', value: {stringValue: 'PENDING_VALIDATION'}}},
    select: {fields: ['id', 'day', 'revision', 'signerUid', 'declaration', 'status', 'justification', 'recordKind'].map(function (fieldPath) {
      return {fieldPath: fieldPath};
    })},
    limit: SAHMT_V2_CHECKLIST_VALIDATION.maxPendingPerRun
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

function validateChecklistSignatureRequest_(request) {
  evaluationAssertOperator_(true);
  return evaluationRunTransaction_(function (transaction) {
    const current = evaluationGet_('checklistSignatureRequests', request.id, transaction);
    if (!current || current.status !== 'PENDING_VALIDATION') return {writes: [], result: 'DUPLICATE'};
    function reject(status, message) {
      return {writes: [evaluationWrite_('checklistSignatureRequests', current.id, {status: status, validationMessage: message}, current, ['validatedAt'])], result: status};
    }
    if (!current.day || !/^[a-f0-9]{64}$/.test(current.revision || '') || !current.signerUid ||
        current.id !== current.day + '_' + current.revision + '_' + current.signerUid || current.declaration !== true ||
        String(current.justification || '').trim().length < 8 || String(current.justification || '').length > 500) {
      return reject('REJECTED', 'Solicitação fora do contrato.');
    }
    if (current.recordKind && (current.recordKind !== 'ACKNOWLEDGEMENT' || current.justification !== 'Declaro que tomei ciência das informações deste relatório.')) return reject('REJECTED', 'Declaração de ciência inválida.');
    const signer = evaluationGet_('users', current.signerUid, transaction);
    if (!evaluationActiveProfile_(signer, current.signerUid) || !hasChecklistSignPermission_(signer)) {
      return reject('REJECTED', 'Perfil do solicitante inativo ou sem permissão atual.');
    }
    let snapshot;
    try { snapshot = readTrustedChecklistSnapshot_(current.day, transaction, {eventRotation: current.recordKind === 'ACKNOWLEDGEMENT'}); }
    catch (error) {
      if (error.status) throw error;
      return reject('NEEDS_REVIEW', String(error && error.message || 'Dados indisponíveis para validar.').slice(0, 300));
    }
    const projection = evaluationGet_('checklistResponsibilities', current.day, transaction);
    const projectionWrite = checklistResponsibilityProjectionWrite_(current.day, snapshot, projection);
    if (snapshot.fingerprint !== current.revision) {
      const result = reject('STALE', 'O Checklist mudou depois do pedido. Atualize e solicite nova revisão.');
      result.writes.push(projectionWrite); return result;
    }
    const signatureId = current.day + '_' + snapshot.revision;
    const existing = evaluationGet_('checklistSignatures', signatureId, transaction);
    if (existing) return {writes: [projectionWrite, evaluationWrite_('checklistSignatureRequests', current.id, {
      status: 'DUPLICATE', finalSignatureId: signatureId, pointsAwarded: 0, responsibleAdjustment: 0,
      validationMessage: 'Esta revisão já possui assinatura válida.'
    }, current, ['validatedAt'])], result: 'DUPLICATE'};
    const isAcknowledgement = current.recordKind === 'ACKNOWLEDGEMENT';
    const signature = {
      id: signatureId, date: current.day, checklistId: current.day,
      responsibleUid: snapshot.responsible.responsibleUid, responsibleName: snapshot.responsible.responsibleName,
      responsibleEmail: snapshot.responsible.responsibleEmail,
      signerUid: current.signerUid, signerName: signer.displayName || '', signerEmail: signer.email || '',
      declaration: true, revision: snapshot.revision, snapshot: snapshot.snapshot,
      missing: snapshot.missing, justification: current.justification,
      recordKind: isAcknowledgement ? 'ACKNOWLEDGEMENT' : 'LEGACY_SIGNATURE',
      declarationText: isAcknowledgement ? 'Declaro que tomei ciência das informações deste relatório.' : 'Confirmação do relatório conforme fluxo anterior'
    };
    let transfer;
    try { transfer = evaluationApplyChecklistTransfer_(current.day, snapshot.responsible.responsibleUid, current.signerUid, signatureId, {transaction: transaction}); }
    catch (error) {
      if (error.status) throw error;
      return reject('NEEDS_REVIEW', String(error && error.message || 'Pontuação pendente de revisão.').slice(0, 300));
    }
    const applied = transfer.status === 'APPLIED' && snapshot.responsible.responsibleUid !== current.signerUid;
    transfer.writes.push(evaluationWrite_('checklistSignatures', signatureId, signature, null, isAcknowledgement ? ['signedAt', 'acknowledgedAt'] : ['signedAt']));
    transfer.writes.push(projectionWrite);
    transfer.writes.push(evaluationWrite_('checklistSignatureRequests', current.id, {
      status: 'VALIDATED', finalSignatureId: signatureId, pointsAwarded: applied ? 1 : 0,
      responsibleAdjustment: applied ? -1 : 0, evaluationStatus: transfer.status, validationMessage: ''
    }, current, ['validatedAt']));
    return {writes: transfer.writes, result: 'VALIDATED'};
  });
}

function readTrustedChecklistSnapshot_(day, transaction, options) {
  options = options || {};
  if (day !== checklistSaoPauloDay_()) throw new Error('O pedido não corresponde ao dia atual em São Paulo.');
  const getTrusted = function (collectionId, id, fields) { return transaction ? evaluationGet_(collectionId, id, transaction) : getFirestoreDocument_(collectionId, id, fields); };
  const queryTrusted = function (collectionId, filters, order, maximum, fields) { return transaction ? evaluationQuery_(collectionId, filters, order, maximum, fields, transaction) : queryFirestore_(collectionId, filters, order, maximum, fields); };
  const schedule = getTrusted('scheduleDays', day, ['positions', 'vacationLabel', 'highlights']);
  if (!schedule) throw new Error('Escala do dia indisponível.');
  const stations = queryTrusted('stations', [
    firestoreFilter_('active', 'EQUAL', {booleanValue: true})
  ], [{fieldPath: 'order', direction: 'ASCENDING'}], SAHMT_V2_CHECKLIST_VALIDATION.maxStations + 1,
  ['active', 'start', 'end', 'order', 'name']);
  const vacations = queryTrusted('vacations', [
    firestoreFilter_('active', 'EQUAL', {booleanValue: true}),
    firestoreFilter_('start', 'LESS_THAN_OR_EQUAL', {stringValue: day}),
    firestoreFilter_('end', 'GREATER_THAN_OR_EQUAL', {stringValue: day})
  ], [{fieldPath: 'start', direction: 'ASCENDING'}], 101, ['active', 'start', 'end', 'siglas', 'label']);
  const events = options.eventRotation ? [] : queryTrusted('events', [
    firestoreFilter_('active', 'EQUAL', {booleanValue: true}),
    firestoreFilter_('date', 'EQUAL', {stringValue: day})
  ], [], 201, ['active', 'date', 'eventType', 'memberStatus', 'substitute']);
  const contacts = queryTrusted('contacts', [
    firestoreFilter_('active', 'EQUAL', {booleanValue: true})
  ], [], 201, ['active', 'sigla', 'name']);
  const records = queryTrusted('checklists', [
    firestoreFilter_('date', 'EQUAL', {stringValue: day})
  ], [{fieldPath: 'createdAt', direction: 'DESCENDING'}], SAHMT_V2_CHECKLIST_VALIDATION.maxDailyRecords + 1,
  ['date', 'createdAt', 'stationId', 'condition', 'occurrence']);
  if (stations.length > SAHMT_V2_CHECKLIST_VALIDATION.maxStations || vacations.length > 100 || events.length > 200 ||
      contacts.length > 200 || records.length > SAHMT_V2_CHECKLIST_VALIDATION.maxDailyRecords) {
    throw new Error('O volume excede os limites seguros de validação.');
  }
  const activeStations = stations.filter(function (station) { return (!station.start || station.start <= day) && (!station.end || station.end >= day); });
  if (!activeStations.length) throw new Error('Não há estações vigentes para o Checklist de hoje.');
  const responseByStation = new Map();
  records.forEach(function (record) {
    if (!responseByStation.has(record.stationId)) responseByStation.set(record.stationId, record);
  });
  const entries = activeStations.map(function (station) {
    const record = responseByStation.get(station.id) || null;
    return {
      stationId: station.id, stationName: station.name || station.id,
      condition: record && record.condition || null, occurrence: record && record.occurrence || '',
      responseId: record && record.id || null,
      responseAt: record && record.createdAt instanceof Date ? record.createdAt.getTime() : null
    };
  });
  const fingerprint = sha256Hex_(JSON.stringify({day: day, entries: entries.map(function (entry) {
    return {stationId: entry.stationId, stationName: entry.stationName, condition: entry.condition,
      occurrence: entry.occurrence, responseId: entry.responseId, responseAt: entry.responseAt};
  })}));
  const selection = options.eventRotation ? selectChecklistEventRotation_({schedule: schedule, day: day, vacations: vacations}) : selectChecklistResponsible_({schedule: schedule, day: day, vacations: vacations, events: events, contacts: contacts});
  if (!selection.ok) throw new Error(selection.reason);
  const matchedProfiles = queryTrusted('users', [firestoreFilter_('sigla', 'EQUAL', {stringValue: selection.sigla})], [], 2,
    ['uid', 'active', 'access', 'displayName', 'email']);
  if (matchedProfiles.length !== 1 || matchedProfiles[0].active !== true || matchedProfiles[0].access !== true || !matchedProfiles[0].uid ||
      transaction && matchedProfiles[0].uid !== matchedProfiles[0].id) {
    throw new Error('Não há perfil ativo e único para a sigla responsável ' + selection.sigla + '.');
  }
  const contactMatches = contacts.filter(function (contact) { return normalizeChecklistText_(contact.sigla) === selection.sigla; });
  const responsibleContact = contactMatches.length === 1
    ? getTrusted('contacts', contactMatches[0].id, ['name', 'email'])
    : null;
  const responsible = {
    responsibleUid: matchedProfiles[0].uid,
    responsibleName: responsibleContact ? responsibleContact.name : matchedProfiles[0].displayName,
    responsibleEmail: responsibleContact ? responsibleContact.email || '' : matchedProfiles[0].email || '',
    position: selection.position, sigla: selection.sigla
  };
  const trustedSnapshot = {date: day, responsibleUid: responsible.responsibleUid,
    responsibleName: responsible.responsibleName, responsibleEmail: responsible.responsibleEmail,
    position: responsible.position, sigla: responsible.sigla, entries: entries};
  return {fingerprint: fingerprint, revision: sha256Hex_(JSON.stringify(trustedSnapshot)),
    snapshot: trustedSnapshot, responsible: responsible, missing: entries.filter(function (entry) { return !entry.condition; }).length};
}

function selectChecklistResponsible_({schedule, day, vacations, events, contacts}) {
  const weekday = checklistWeekday_(day);
  const away = new Set(checklistSiglas_(schedule.vacationLabel || '', weekday));
  vacations.forEach(function (vacation) {
    const values = Array.isArray(vacation.siglas) && vacation.siglas.length ? vacation.siglas : [vacation.label || ''];
    values.forEach(function (value) { checklistSiglas_(value, weekday).forEach(function (sigla) { away.add(sigla); }); });
  });
  const replaced = new Set();
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.date !== day || event.active !== true || !String(event.substitute || '').trim()) continue;
    if (normalizeChecklistText_(event.eventType) === 'ATRASO' || normalizeChecklistText_(event.memberStatus) === 'SUPORTE') continue;
    const affected = eventMemberSiglas_(event, contacts, weekday);
    if (!affected) return {ok: false, reason: 'Há substituição sem membro identificável na escala.'};
    affected.forEach(function (sigla) { replaced.add(sigla); });
  }
  const positions = Array.isArray(schedule.positions) ? schedule.positions : [];
  for (let i = 0; i < positions.length; i++) {
    const item = positions[i];
    const token = typeof item === 'string' ? item : item && (item.sigla || item.name || item.label) || '';
    const available = checklistSiglas_(token, weekday).filter(function (sigla) { return !away.has(sigla) && !replaced.has(sigla); });
    if (available.length) return {ok: true, sigla: available[0], position: i + 1};
  }
  return {ok: false, reason: 'Não há uma pessoa disponível na primeira posição da escala.'};
}

function eventMemberSiglas_(event, contacts, weekday) {
  const value = String(event.memberStatus || '');
  const member = normalizeChecklistText_(value);
  const matched = contacts.filter(function (contact) { return normalizeChecklistText_(contact.name) === member; });
  if (matched.length === 1 && matched[0].sigla) return checklistSiglas_(matched[0].sigla, weekday);
  if (matched.length > 1) return null;
  if (/^(?:DC|L2|[A-Z]{2})(?:[/-](?:DC|L2|[A-Z]{2}))*$/.test(value.trim().toUpperCase())) return checklistSiglas_(value, weekday);
  return null;
}

function checklistSiglas_(value, weekday) {
  const tokens = String(value || '').split('(')[0].toUpperCase().match(/(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*/g) || [];
  const aliases = [];
  tokens.forEach(function (token) {
    token.split(/[/-]/).forEach(function (sigla) {
      (sigla === 'DC' ? SAHMT_V2_DC_ALIASES[weekday] || SAHMT_V2_DC_FALLBACK : [sigla]).forEach(function (value) {
        if (aliases.indexOf(value) < 0) aliases.push(value);
      });
    });
  });
  return aliases;
}

function checklistWeekday_(day) {
  return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][new Date(day + 'T12:00:00Z').getUTCDay()];
}

function checklistSaoPauloDay_() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd'); }
function normalizeChecklistText_(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase(); }
function sha256Hex_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function queryFirestore_(collectionId, filters, orderBy, limit, fieldPaths) {
  const structured = {from: [{collectionId: collectionId}], limit: limit};
  if (filters.length === 1) structured.where = {fieldFilter: filters[0]};
  else if (filters.length > 1) structured.where = {compositeFilter: {op: 'AND', filters: filters.map(function (filter) { return {fieldFilter: filter}; })}};
  if (orderBy.length) structured.orderBy = orderBy.map(function (item) { return {field: {fieldPath: item.fieldPath}, direction: item.direction}; });
  if (Array.isArray(fieldPaths) && fieldPaths.length) {
    structured.select = {fields: fieldPaths.map(function (fieldPath) { return {fieldPath: fieldPath}; })};
  }
  const response = firestoreRequest_(firestoreDocumentsUrl_(':runQuery'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({structuredQuery: structured})
  });
  return (Array.isArray(response) ? response : []).filter(function (item) { return item.document; }).map(function (item) {
    const document = item.document;
    const fields = firestoreFieldsToJs_(document.fields || {});
    const id = String(document.name || '').split('/').pop();
    return Object.assign(fields, {id: fields.id || id, _documentName: document.name, _updateTime: document.updateTime});
  });
}

function firestoreFilter_(fieldPath, op, value) { return {field: {fieldPath: fieldPath}, op: op, value: value}; }
function getFirestoreDocument_(collectionId, documentId, fieldPaths) {
  try {
    const path = '/' + encodeURIComponent(collectionId) + '/' + encodeURIComponent(documentId);
    const mask = Array.isArray(fieldPaths) ? fieldPaths.map(function (fieldPath) {
      return 'mask.fieldPaths=' + encodeURIComponent(fieldPath);
    }).join('&') : '';
    const url = firestoreDocumentsUrl_(path) + (mask ? '?' + mask : '');
    const document = firestoreRequest_(url, {method: 'get'});
    return Object.assign(firestoreFieldsToJs_(document.fields || {}), {id: documentId, _documentName: document.name, _updateTime: document.updateTime});
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function firestoreDocumentName_(collectionId, documentId) {
  return 'projects/' + SAHMT_V2_CONFIG.projectId + '/databases/' + SAHMT_V2_CONFIG.databaseId +
    '/documents/' + collectionId + '/' + documentId;
}

function hasChecklistSignPermission_(profile) {
  return profile.role === 'administrador_app' || profile.permissions &&
    (profile.permissions.admin === true || profile.permissions.checklistSign === true);
}

function updateChecklistRequestStatus_(request, status, extra) {
  const write = checklistRequestUpdateWrite_(request, Object.assign({status: status, validatedAt: new Date()}, extra || {}));
  firestoreRequest_(firestoreDocumentsUrl_(':commit'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({writes: [write]})
  });
  return status;
}

function checklistRequestUpdateWrite_(request, changes) {
  return {
    update: {name: request.name, fields: firestoreFieldsFromJs_(changes)},
    updateMask: {fieldPaths: Object.keys(changes)},
    currentDocument: {updateTime: request.updateTime}
  };
}

/** Same marker contract as checklist-rotation.js; source is the shared Eventos schedule document. */
function selectChecklistEventRotation_(input) {
  const schedule = input.schedule, weekday = checklistWeekday_(input.day);
  const markers = schedule.highlights && schedule.highlights.events || [];
  if (!Array.isArray(markers) || markers.length > 100) return {ok: false, reason: 'Destaques de Eventos incompletos.'};
  const events = [];
  function members(token, support) {
    if (typeof token !== 'string' || token.length > 240) return null;
    const value = token.split('(')[0].trim().toUpperCase();
    if (support && value === 'SUPORTE' || !value) return [];
    if (!/^(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*$/.test(value)) return null;
    return checklistSiglas_(value, weekday);
  }
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (typeof marker !== 'string' || !marker.trim() || marker.length > 400) return {ok: false, reason: 'Destaque de Eventos inválido.'};
    const parts = marker.trim().split(':');
    let affected;
    if (parts.length === 1) affected = members(parts[0], true);
    else {
      if (parts[0].toUpperCase() !== 'EVENTO' || parts.length < 2 || parts.length > 4 || !parts[1].trim()) return {ok: false, reason: 'Destaque de Eventos inválido.'};
      affected = members(parts[1], true);
      if (parts.length > 2 && !/^[A-Za-z0-9_-]{1,200}$/.test(parts[parts.length - 1])) return {ok: false, reason: 'Identificador de Evento inválido.'};
      if (affected !== null && parts.length === 4 && parts[1].trim().toUpperCase() !== 'SUPORTE' && parts[2].trim() !== '-') affected = parts[2].trim() ? members(parts[2], true) : null;
    }
    if (affected === null) return {ok: false, reason: 'Sigla do Evento inválida.'};
    affected.forEach(function (sigla) { events.push({date: input.day, active: true, eventType: 'ROTATION', memberStatus: sigla, substitute: 'EXCLUDED_BY_EVENT'}); });
  }
  return selectChecklistResponsible_({schedule: schedule, day: input.day, vacations: input.vacations, events: events, contacts: []});
}
