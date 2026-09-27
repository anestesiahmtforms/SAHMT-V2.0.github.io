/**
 * Manual, one-way publication from the compact ESCALA/FÉRIAS sheet to Firestore.
 * This file intentionally installs no trigger: every publication starts with an
 * explicit preview and a separate publish action by an allowlisted operator.
 */
const SAHMT_V2_SCHEDULE_SOURCE = Object.freeze({
  spreadsheetId: '1japh5sUW3QU5F3dknhS40VLFBj6SfZKDlrVan5ivzNM',
  scheduleTab: 'ESCALA',
  vacationTab: 'FÉRIAS',
  allowlistProperty: 'SAHMT_V2_SCHEDULE_SYNC_ALLOWED_EMAILS',
  previewProperty: 'SAHMT_V2_SCHEDULE_SYNC_PREVIEW',
  actor: 'migration:sheet-schedule-source',
  maxWrites: 450
});

/** Read and validate the source, compare with Firestore, and print a dry run. */
function previewScheduleSourceToFirestore() {
  requireScheduleSourceOperator_();
  const source = readScheduleSource_();
  const current = readScheduleFirestore_();
  const plan = buildScheduleSourcePlan_(source, current);
  const sourceFingerprint = sha256Hex_(JSON.stringify(source.records));
  const preview = {
    sourceFingerprint: sourceFingerprint,
    sourceModifiedAt: source.sourceModifiedAt,
    generatedAt: new Date().toISOString(),
    scheduleRows: source.schedule.length,
    vacationRows: source.vacations.length,
    skippedVacationRowsWithoutSiglas: source.skippedVacationRowsWithoutSiglas,
    createScheduleDays: plan.createScheduleDays,
    updateScheduleDays: plan.updateScheduleDays,
    unchangedScheduleDays: plan.unchangedScheduleDays,
    createVacations: plan.createVacations,
    updateVacations: plan.updateVacations,
    unchangedVacations: plan.unchangedVacations,
    deactivateVacations: plan.deactivateVacations.map(function (item) { return {id: item.id, start: item.start, end: item.end, label: item.label}; }),
    writes: plan.writes.length
  };
  if (preview.writes > SAHMT_V2_SCHEDULE_SOURCE.maxWrites) {
    throw new Error('Prévia excede o limite seguro de gravações por publicação (' + preview.writes + ').');
  }
  PropertiesService.getScriptProperties().setProperty(
    SAHMT_V2_SCHEDULE_SOURCE.previewProperty, JSON.stringify(preview)
  );
  console.log(JSON.stringify(preview, null, 2));
  return preview;
}

/** Publish only the exact source snapshot that was just previewed. */
function publishScheduleSourceToFirestore() {
  requireScheduleSourceOperator_();
  const properties = PropertiesService.getScriptProperties();
  const previousPreview = JSON.parse(properties.getProperty(SAHMT_V2_SCHEDULE_SOURCE.previewProperty) || 'null');
  if (!previousPreview) throw new Error('Execute previewScheduleSourceToFirestore e revise o resultado antes de publicar.');

  const source = readScheduleSource_();
  const fingerprint = sha256Hex_(JSON.stringify(source.records));
  if (fingerprint !== previousPreview.sourceFingerprint || source.sourceModifiedAt !== previousPreview.sourceModifiedAt) {
    throw new Error('A planilha mudou desde a prévia. Gere e confira uma nova prévia antes de publicar.');
  }

  const current = readScheduleFirestore_();
  const plan = buildScheduleSourcePlan_(source, current);
  if (plan.writes.length !== previousPreview.writes || plan.writes.length > SAHMT_V2_SCHEDULE_SOURCE.maxWrites) {
    throw new Error('O estado do Firestore mudou desde a prévia. Gere e confira uma nova prévia antes de publicar.');
  }
  if (!plan.writes.length) {
    console.log('Firestore já corresponde à planilha; nenhuma gravação necessária.');
    return {writes: 0, verified: true};
  }

  firestoreRequest_(firestoreDocumentsUrl_(':commit'), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({writes: plan.writes})
  });

  const after = readScheduleFirestore_();
  const verification = compareScheduleSourceWithFirestore_(source, after);
  if (verification.differences.length) {
    throw new Error('A publicação foi aceita, mas a releitura encontrou divergências: ' + JSON.stringify(verification.differences.slice(0, 10)));
  }
  properties.deleteProperty(SAHMT_V2_SCHEDULE_SOURCE.previewProperty);
  const result = {writes: plan.writes.length, verified: true, scheduleDays: source.schedule.length, vacations: source.vacations.length,
    deactivatedVacations: plan.deactivateVacations.length,
    skippedVacationRowsWithoutSiglas: source.skippedVacationRowsWithoutSiglas};
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function requireScheduleSourceOperator_() {
  const properties = PropertiesService.getScriptProperties();
  const allowed = String(properties.getProperty(SAHMT_V2_SCHEDULE_SOURCE.allowlistProperty) || '')
    .split(/[\s,;]+/).map(function (email) { return email.trim().toLowerCase(); }).filter(Boolean);
  const actor = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!actor || !allowed.length || allowed.indexOf(actor) < 0) {
    throw new Error('Publicação bloqueada. Configure SAHMT_V2_SCHEDULE_SYNC_ALLOWED_EMAILS com a conta Google autorizada e execute novamente.');
  }
  const file = DriveApp.getFileById(SAHMT_V2_SCHEDULE_SOURCE.spreadsheetId);
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error('Publicação bloqueada: a planilha ESCALA/FÉRIAS precisa permanecer restrita.');
  }
  return actor;
}

function readScheduleSource_() {
  const spreadsheet = SpreadsheetApp.openById(SAHMT_V2_SCHEDULE_SOURCE.spreadsheetId);
  const file = DriveApp.getFileById(SAHMT_V2_SCHEDULE_SOURCE.spreadsheetId);
  const scheduleSheet = spreadsheet.getSheetByName(SAHMT_V2_SCHEDULE_SOURCE.scheduleTab);
  const vacationSheet = spreadsheet.getSheetByName(SAHMT_V2_SCHEDULE_SOURCE.vacationTab);
  if (!scheduleSheet || !vacationSheet) throw new Error('A planilha precisa conter as abas ESCALA e FÉRIAS.');

  const schedule = readScheduleRows_(scheduleSheet);
  const vacationResult = readVacationRows_(vacationSheet);
  if (!schedule.length) throw new Error('A aba ESCALA não contém linhas válidas.');
  const dateSet = new Set();
  schedule.forEach(function (record) {
    if (dateSet.has(record.date)) throw new Error('Data duplicada na aba ESCALA: ' + record.date);
    dateSet.add(record.date);
  });
  const vacationIds = new Set();
  vacationResult.records.forEach(function (record) {
    if (vacationIds.has(record.id)) throw new Error('Período de férias duplicado: ' + record.id);
    vacationIds.add(record.id);
  });
  const records = {schedule: schedule, vacations: vacationResult.records};
  return {schedule: schedule, vacations: vacationResult.records,
    skippedVacationRowsWithoutSiglas: vacationResult.skippedWithoutSiglas,
    sourceModifiedAt: file.getLastUpdated().toISOString(), records: records};
}

function findHeaderRow_(sheet, requiredHeaders) {
  const rowCount = Math.min(20, Math.max(1, sheet.getLastRow()));
  const columnCount = Math.max(1, sheet.getLastColumn());
  const values = sheet.getRange(1, 1, rowCount, columnCount).getDisplayValues();
  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    const headers = values[rowIndex].map(function (item) { return String(item || '').trim().toLowerCase(); });
    if (requiredHeaders.every(function (header) { return headers.indexOf(header) >= 0; })) {
      const columns = {};
      requiredHeaders.forEach(function (header) {
        const matches = headers.reduce(function (list, value, index) { if (value === header) list.push(index); return list; }, []);
        if (matches.length !== 1) throw new Error('Cabeçalho duplicado na linha ' + (rowIndex + 1) + ': ' + header);
        columns[header] = matches[0];
      });
      return {row: rowIndex + 1, columns: columns};
    }
  }
  throw new Error('Cabeçalhos ausentes. Use: ' + requiredHeaders.join(', ') + '.');
}

function readScheduleRows_(sheet) {
  const required = ['date'].concat(Array.from({length: 17}, function (_, index) { return 'pos' + (index + 1); }));
  const header = findHeaderRow_(sheet, required);
  const lastRow = sheet.getLastRow();
  if (lastRow <= header.row) return [];
  const values = sheet.getRange(header.row + 1, 1, lastRow - header.row, sheet.getLastColumn()).getValues();
  const result = [];
  values.forEach(function (row, offset) {
    const rowNumber = header.row + 1 + offset;
    const dateValue = row[header.columns.date];
    const rawPositions = required.slice(1).map(function (key) { return String(row[header.columns[key]] || '').trim().toUpperCase(); });
    if (!dateValue) {
      if (rawPositions.some(Boolean)) throw new Error('Há sigla sem data na linha ' + rowNumber + ' da aba ESCALA.');
      return;
    }
    const date = scheduleSourceDate_(dateValue);
    const lastPosition = rawPositions.reduce(function (last, value, index) { return value ? index : last; }, -1);
    if (lastPosition < 0) throw new Error('A linha ' + rowNumber + ' da aba ESCALA não tem nenhuma sigla.');
    const positions = [];
    for (let index = 0; index <= lastPosition; index++) {
      const sigla = rawPositions[index];
      if (!sigla) throw new Error('Posição vazia antes de outra sigla na linha ' + rowNumber + '.');
      if (sigla.length > 30 || !/^(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*$/.test(sigla)) {
        throw new Error('Sigla inválida na linha ' + rowNumber + ', pos' + (index + 1) + ': ' + sigla);
      }
      positions.push({position: index + 1, sigla: sigla});
    }
    result.push({id: date, date: date, positions: positions});
  });
  return result;
}

function readVacationRows_(sheet) {
  const required = ['start', 'end', 'siglas', 'label'];
  const header = findHeaderRow_(sheet, required);
  const lastRow = sheet.getLastRow();
  if (lastRow <= header.row) return {records: [], skippedWithoutSiglas: 0};
  const values = sheet.getRange(header.row + 1, 1, lastRow - header.row, sheet.getLastColumn()).getValues();
  const result = [];
  const skippedWithoutSiglas = [];
  values.forEach(function (row, offset) {
    const rowNumber = header.row + 1 + offset;
    const startValue = row[header.columns.start];
    const endValue = row[header.columns.end];
    const rawSiglas = String(row[header.columns.siglas] || '').trim().toUpperCase();
    const label = String(row[header.columns.label] || '').trim();
    if (!startValue && !endValue && !rawSiglas && !label) return;
    if (!startValue || !endValue || !label) throw new Error('Período incompleto na linha ' + rowNumber + ' da aba FÉRIAS.');
    const start = scheduleSourceDate_(startValue);
    const end = scheduleSourceDate_(endValue);
    if (start > end) throw new Error('O início é posterior ao fim na linha ' + rowNumber + ' da aba FÉRIAS.');
    if (!rawSiglas) { skippedWithoutSiglas.push({row: rowNumber, start: start, end: end, label: label}); return; }
    const siglas = [...new Set(rawSiglas.split(/[,;\s]+/).filter(Boolean))];
    if (!siglas.length || siglas.some(function (sigla) { return sigla.length > 30 || !/^(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*$/.test(sigla); })) {
      throw new Error('Siglas inválidas na linha ' + rowNumber + ' da aba FÉRIAS.');
    }
    const seed = [start, end, siglas.join('|'), label].join('\n');
    const id = 'sheet_' + sha256Hex_(seed).slice(0, 32);
    result.push({id: id, start: start, end: end, siglas: siglas, label: label, notes: '', active: true});
  });
  return {records: result, skippedWithoutSiglas: skippedWithoutSiglas};
}

function scheduleSourceDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, 'America/Sao_Paulo', 'yyyy-MM-dd');
  const text = String(value || '').trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
  if (!match) throw new Error('Data inválida na planilha: ' + text);
  const parts = match[1].length === 4 ? [Number(match[1]), Number(match[2]), Number(match[3])] : [Number(match[3]), Number(match[2]), Number(match[1])];
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const normalized = date.toISOString().slice(0, 10);
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() + 1 !== parts[1] || date.getUTCDate() !== parts[2]) throw new Error('Data inválida na planilha: ' + text);
  return normalized;
}

function readScheduleFirestore_() {
  const scheduleDays = queryFirestore_('scheduleDays', [], [], 1000, ['id', 'date', 'positions', 'highlights', 'version', 'createdByUid', 'createdAt', 'updatedByUid', 'updatedAt']);
  const vacations = queryFirestore_('vacations', [], [], 1000, ['id', 'start', 'end', 'siglas', 'label', 'notes', 'active', 'createdByUid', 'createdAt', 'updatedByUid', 'updatedAt']);
  return {scheduleDays: scheduleDays, vacations: vacations};
}

function buildScheduleSourcePlan_(source, current) {
  const writes = [];
  const existingDays = new Map(current.scheduleDays.map(function (record) { return [record.id, record]; }));
  let createScheduleDays = 0, updateScheduleDays = 0, unchangedScheduleDays = 0;
  source.schedule.forEach(function (record) {
    const existing = existingDays.get(record.id);
    if (existing && JSON.stringify(existing.positions || []) === JSON.stringify(record.positions)) { unchangedScheduleDays++; return; }
    if (existing) {
      updateScheduleDays++;
      const changes = {positions: record.positions, version: Number(existing.version || 0) + 1, updatedByUid: SAHMT_V2_SCHEDULE_SOURCE.actor, updatedAt: new Date()};
      writes.push({update: {name: firestoreDocumentName_('scheduleDays', record.id), fields: firestoreFieldsFromJs_(changes)},
        updateMask: {fieldPaths: Object.keys(changes)}, currentDocument: {updateTime: existing._updateTime}});
    } else {
      createScheduleDays++;
      const now = new Date();
      const data = {id: record.id, date: record.date, positions: record.positions, highlights: {siglas: [], events: []}, version: 1,
        createdByUid: SAHMT_V2_SCHEDULE_SOURCE.actor, createdAt: now, updatedByUid: SAHMT_V2_SCHEDULE_SOURCE.actor, updatedAt: now};
      writes.push({update: {name: firestoreDocumentName_('scheduleDays', record.id), fields: firestoreFieldsFromJs_(data)}, currentDocument: {exists: false}});
    }
  });

  const existingVacations = new Map(current.vacations.map(function (record) { return [record.id, record]; }));
  let createVacations = 0, updateVacations = 0, unchangedVacations = 0;
  source.vacations.forEach(function (record) {
    const existing = existingVacations.get(record.id);
    if (existing && existing.start === record.start && existing.end === record.end && JSON.stringify(existing.siglas || []) === JSON.stringify(record.siglas) &&
        existing.label === record.label && existing.notes === '' && existing.active === true) { unchangedVacations++; return; }
    if (existing) {
      updateVacations++;
      const changes = {start: record.start, end: record.end, siglas: record.siglas, label: record.label, notes: '', active: true,
        updatedByUid: SAHMT_V2_SCHEDULE_SOURCE.actor, updatedAt: new Date()};
      writes.push({update: {name: firestoreDocumentName_('vacations', record.id), fields: firestoreFieldsFromJs_(changes)},
        updateMask: {fieldPaths: Object.keys(changes)}, currentDocument: {updateTime: existing._updateTime}});
    } else {
      createVacations++;
      const now = new Date();
      const data = Object.assign({}, record, {createdByUid: SAHMT_V2_SCHEDULE_SOURCE.actor, createdAt: now,
        updatedByUid: SAHMT_V2_SCHEDULE_SOURCE.actor, updatedAt: now});
      writes.push({update: {name: firestoreDocumentName_('vacations', record.id), fields: firestoreFieldsFromJs_(data)}, currentDocument: {exists: false}});
    }
  });
  const sourceVacationIds = new Set(source.vacations.map(function (record) { return record.id; }));
  const deactivateVacations = [];
  current.vacations.forEach(function (existing) {
    if (existing.createdByUid !== SAHMT_V2_SCHEDULE_SOURCE.actor || existing.active !== true || sourceVacationIds.has(existing.id)) return;
    deactivateVacations.push({id: existing.id, start: existing.start, end: existing.end, label: existing.label});
    const changes = {active: false, updatedByUid: SAHMT_V2_SCHEDULE_SOURCE.actor, updatedAt: new Date()};
    writes.push({update: {name: firestoreDocumentName_('vacations', existing.id), fields: firestoreFieldsFromJs_(changes)},
      updateMask: {fieldPaths: Object.keys(changes)}, currentDocument: {updateTime: existing._updateTime}});
  });
  return {writes: writes, createScheduleDays: createScheduleDays, updateScheduleDays: updateScheduleDays,
    unchangedScheduleDays: unchangedScheduleDays, createVacations: createVacations, updateVacations: updateVacations,
    unchangedVacations: unchangedVacations, deactivateVacations: deactivateVacations};
}

function compareScheduleSourceWithFirestore_(source, current) {
  const differences = [];
  const daysById = new Map(current.scheduleDays.map(function (record) { return [record.id, record]; }));
  source.schedule.forEach(function (record) {
    const actual = daysById.get(record.id);
    if (!actual || JSON.stringify(actual.positions || []) !== JSON.stringify(record.positions)) differences.push('scheduleDays/' + record.id);
  });
  const vacationsById = new Map(current.vacations.map(function (record) { return [record.id, record]; }));
  source.vacations.forEach(function (record) {
    const actual = vacationsById.get(record.id);
    if (!actual || actual.start !== record.start || actual.end !== record.end || JSON.stringify(actual.siglas || []) !== JSON.stringify(record.siglas) || actual.label !== record.label || actual.active !== true) {
      differences.push('vacations/' + record.id);
    }
  });
  const sourceVacationIds = new Set(source.vacations.map(function (record) { return record.id; }));
  current.vacations.forEach(function (record) {
    if (record.createdByUid === SAHMT_V2_SCHEDULE_SOURCE.actor && record.active === true && !sourceVacationIds.has(record.id)) {
      differences.push('vacations/' + record.id + ' (ainda ativa, ausente na fonte)');
    }
  });
  return {differences: differences};
}
