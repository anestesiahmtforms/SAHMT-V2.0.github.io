const SAHMT_V2_CHECKLIST_VALIDATION = Object.freeze({maxPendingPerRun: 20, maxStations: 200, maxDailyRecords: 1000});
const SAHMT_V2_DC_ALIASES = Object.freeze({
  segunda: ['CR', 'LH'], terca: ['CR', 'LH', 'AD'], quarta: ['CR', 'LH', 'AD'],
  quinta: ['CR', 'LH'], sexta: ['CR', 'LA']
});
const SAHMT_V2_DC_FALLBACK = Object.freeze(['AD', 'CR', 'LA', 'LH']);

function validatePendingChecklistSignatureRequests() {
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
  if (!request.day || !/^[a-f0-9]{64}$/.test(request.revision || '') || !request.signerUid ||
      request.id !== request.day + '_' + request.revision + '_' + request.signerUid || request.declaration !== true ||
      request.status !== 'PENDING_VALIDATION' || String(request.justification || '').trim().length < 8) {
    return updateChecklistRequestStatus_(request, 'REJECTED', {validationMessage: 'Solicitação fora do contrato.'});
  }
  const signer = getFirestoreDocument_('users', request.signerUid);
  if (!signer || signer.uid !== request.signerUid || signer.active !== true || signer.access !== true || !hasChecklistSignPermission_(signer)) {
    return updateChecklistRequestStatus_(request, 'REJECTED', {validationMessage: 'Perfil do solicitante inativo ou sem permissão atual.'});
  }
  let snapshot;
  try {
    snapshot = readTrustedChecklistSnapshot_(request.day);
  } catch (error) {
    if (error.status) throw error;
    return updateChecklistRequestStatus_(request, 'NEEDS_REVIEW', {
      validationMessage: String(error && error.message || 'Dados operacionais indisponíveis para validar.').slice(0, 300)
    });
  }
  if (snapshot.fingerprint !== request.revision) {
    return updateChecklistRequestStatus_(request, 'STALE', {validationMessage: 'O Checklist mudou depois do pedido. Atualize e solicite nova revisão.'});
  }
  const signatureId = request.day + '_' + snapshot.revision;
  const existingSignature = getFirestoreDocument_('checklistSignatures', signatureId);
  if (existingSignature) {
    return updateChecklistRequestStatus_(request, 'DUPLICATE', {
      finalSignatureId: signatureId, validatedAt: new Date(), pointsAwarded: 0, responsibleAdjustment: 0,
      validationMessage: 'Esta revisão já possui assinatura válida.'
    });
  }
  const now = new Date();
  const signature = {
    id: signatureId, date: request.day, checklistId: request.day,
    responsibleUid: snapshot.responsible.responsibleUid,
    responsibleName: snapshot.responsible.responsibleName,
    responsibleEmail: snapshot.responsible.responsibleEmail,
    signerUid: request.signerUid, signerName: signer.displayName || '', signerEmail: signer.email || '',
    declaration: true, revision: snapshot.revision, snapshot: snapshot.snapshot,
    missing: snapshot.missing, justification: request.justification, signedAt: now
  };
  const awarded = snapshot.missing === 0;
  const isSubstitute = snapshot.responsible.responsibleUid !== request.signerUid;
  const scoreEntries = awarded ? [
    {uid: snapshot.responsible.responsibleUid, ruleId: 'checklist-daily-responsible-v1', points: 1, suffix: 'responsible'},
    ...(isSubstitute ? [
      {uid: request.signerUid, ruleId: 'checklist-daily-substitute-v1', points: 1, suffix: 'substitute'},
      {uid: snapshot.responsible.responsibleUid, ruleId: 'checklist-daily-substitution-adjustment-v1', points: -1, suffix: 'substitution-adjustment'}
    ] : [])
  ] : [];
  const writes = [{
    update: {name: firestoreDocumentName_('checklistSignatures', signatureId), fields: firestoreFieldsFromJs_(signature)},
    currentDocument: {exists: false}
  }];
  scoreEntries.forEach(function (entry) {
    const scoreId = 'checklist-' + signatureId + '-' + entry.suffix;
    writes.push({
      update: {name: firestoreDocumentName_('scores', scoreId), fields: firestoreFieldsFromJs_({
        id: scoreId, uid: entry.uid, sourceType: 'checklistSignature', sourceId: signatureId,
        ruleId: entry.ruleId, points: entry.points, createdByUid: request.signerUid, createdAt: now
      })},
      currentDocument: {exists: false}
    });
  });
  writes.push(checklistRequestUpdateWrite_(request, {
    status: 'VALIDATED', validatedAt: now, finalSignatureId: signatureId,
    pointsAwarded: awarded ? 1 : 0, responsibleAdjustment: awarded && isSubstitute ? -1 : 0,
    validationMessage: ''
  }));
  try {
    firestoreRequest_(firestoreDocumentsUrl_(':commit'), {
      method: 'post', contentType: 'application/json', payload: JSON.stringify({writes: writes})
    });
    return 'VALIDATED';
  } catch (error) {
    const latest = getFirestoreDocument_('checklistSignatures', signatureId);
    if (latest) return updateChecklistRequestStatus_(request, 'DUPLICATE', {
      finalSignatureId: signatureId, validatedAt: new Date(), pointsAwarded: 0, responsibleAdjustment: 0,
      validationMessage: 'Esta revisão já possui assinatura válida.'
    });
    throw error;
  }
}

function readTrustedChecklistSnapshot_(day) {
  if (day !== checklistSaoPauloDay_()) throw new Error('O pedido não corresponde ao dia atual em São Paulo.');
  const schedule = getFirestoreDocument_('scheduleDays', day);
  if (!schedule) throw new Error('Escala do dia indisponível.');
  const stations = queryFirestore_('stations', [
    firestoreFilter_('active', 'EQUAL', {booleanValue: true})
  ], [{fieldPath: 'order', direction: 'ASCENDING'}], SAHMT_V2_CHECKLIST_VALIDATION.maxStations + 1);
  const vacations = queryFirestore_('vacations', [
    firestoreFilter_('active', 'EQUAL', {booleanValue: true}),
    firestoreFilter_('start', 'LESS_THAN_OR_EQUAL', {stringValue: day}),
    firestoreFilter_('end', 'GREATER_THAN_OR_EQUAL', {stringValue: day})
  ], [{fieldPath: 'start', direction: 'ASCENDING'}], 101);
  const events = queryFirestore_('events', [
    firestoreFilter_('active', 'EQUAL', {booleanValue: true}),
    firestoreFilter_('date', 'EQUAL', {stringValue: day})
  ], [], 201);
  const contacts = queryFirestore_('contacts', [
    firestoreFilter_('active', 'EQUAL', {booleanValue: true})
  ], [], 201);
  const records = queryFirestore_('checklists', [
    firestoreFilter_('date', 'EQUAL', {stringValue: day})
  ], [{fieldPath: 'createdAt', direction: 'DESCENDING'}], SAHMT_V2_CHECKLIST_VALIDATION.maxDailyRecords + 1);
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
  const selection = selectChecklistResponsible_({schedule: schedule, day: day, vacations: vacations, events: events, contacts: contacts});
  if (!selection.ok) throw new Error(selection.reason);
  const matchedProfiles = queryFirestore_('users', [firestoreFilter_('sigla', 'EQUAL', {stringValue: selection.sigla})], [], 2);
  if (matchedProfiles.length !== 1 || matchedProfiles[0].active !== true || matchedProfiles[0].access !== true || !matchedProfiles[0].uid) {
    throw new Error('Não há perfil ativo e único para a sigla responsável ' + selection.sigla + '.');
  }
  const contactMatches = contacts.filter(function (contact) { return normalizeChecklistText_(contact.sigla) === selection.sigla; });
  const responsible = {
    responsibleUid: matchedProfiles[0].uid,
    responsibleName: contactMatches.length === 1 ? contactMatches[0].name : matchedProfiles[0].displayName,
    responsibleEmail: contactMatches.length === 1 ? contactMatches[0].email || '' : matchedProfiles[0].email || '',
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

function queryFirestore_(collectionId, filters, orderBy, limit) {
  const structured = {from: [{collectionId: collectionId}], limit: limit};
  if (filters.length === 1) structured.where = {fieldFilter: filters[0]};
  else if (filters.length > 1) structured.where = {compositeFilter: {op: 'AND', filters: filters.map(function (filter) { return {fieldFilter: filter}; })}};
  if (orderBy.length) structured.orderBy = orderBy.map(function (item) { return {field: {fieldPath: item.fieldPath}, direction: item.direction}; });
  const response = firestoreRequest_(firestoreDocumentsUrl_(':runQuery'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({structuredQuery: structured})
  });
  return (Array.isArray(response) ? response : []).filter(function (item) { return item.document; }).map(function (item) {
    const document = item.document;
    const fields = firestoreFieldsToJs_(document.fields || {});
    const id = String(document.name || '').split('/').pop();
    return Object.assign(fields, {id: fields.id || id, _documentName: document.name});
  });
}

function firestoreFilter_(fieldPath, op, value) { return {field: {fieldPath: fieldPath}, op: op, value: value}; }
function getFirestoreDocument_(collectionId, documentId) {
  try {
    const path = '/' + encodeURIComponent(collectionId) + '/' + encodeURIComponent(documentId);
    const document = firestoreRequest_(firestoreDocumentsUrl_(path), {method: 'get'});
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
