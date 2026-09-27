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
    targetFingerprint: scheduleTargetFingerprint_(current),
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
  if (!previousPreview.targetFingerprint || scheduleTargetFingerprint_(current) !== previousPreview.targetFingerprint) {
    throw new Error('O Firestore mudou desde a prévia. Gere e confira uma nova prévia antes de publicar.');
  }
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
  const scanRows = Math.min(20, Math.max(1, sheet.getLastRow()));
  const scanColumns = Math.max(1, sheet.getLastColumn());
  const scan = sheet.getRange(1, 1, scanRows, scanColumns).getDisplayValues();
  const hasCompactHeaders = scan.some(function (row) {
    const headers = row.map(function (item) { return String(item || '').trim().toLowerCase(); });
    return required.every(function (key) { return headers.indexOf(key) >= 0; });
  });
  if (!hasCompactHeaders) return readVacationMatrixRows_(sheet);

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
    const rawSiglas = String(row[header.columns.siglas] || '').trim();
    const label = String(row[header.columns.label] || '').trim();
    if (!startValue && !endValue && !rawSiglas && !label) return;
    if (!startValue || !endValue || !label) throw new Error('Período incompleto na linha ' + rowNumber + ' da aba FÉRIAS.');
    const start = scheduleSourceDate_(startValue);
    const end = scheduleSourceDate_(endValue);
    if (start > end) throw new Error('O início é posterior ao fim na linha ' + rowNumber + ' da aba FÉRIAS.');
    const siglas = parseVacationSiglas_(rawSiglas, rowNumber);
    if (!siglas.length) { skippedWithoutSiglas.push({row: rowNumber, start: start, end: end, label: label}); return; }
    if (!siglas.length || siglas.some(function (sigla) { return sigla.length > 30 || !/^(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*$/.test(sigla); })) {
      throw new Error('Siglas inválidas na linha ' + rowNumber + ' da aba FÉRIAS.');
    }
    const seed = [start, end, siglas.join('|'), label].join('\n');
    const id = 'sheet_' + sha256Hex_(seed).slice(0, 32);
    result.push({id: id, start: start, end: end, siglas: siglas, label: label, notes: '', active: true});
  });
  return {records: result, skippedWithoutSiglas: skippedWithoutSiglas};
}

/** Read the printable month-by-month vacation matrix (two month blocks per row). */
function readVacationMatrixRows_(sheet) {
  const monthNumbers = {
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
    julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
  };
  const rowCount = Math.max(1, sheet.getLastRow());
  const columnCount = Math.max(15, sheet.getLastColumn());
  const rows = sheet.getRange(1, 1, rowCount, columnCount).getDisplayValues();
  const title = rows.slice(0, 3).map(function (row) { return row.join(' '); }).join(' ');
  const yearMatch = /\b(20\d{2})\b/.exec(title);
  if (!yearMatch) throw new Error('Não foi possível identificar o ano no título da aba FÉRIAS.');
  const year = Number(yearMatch[1]);
  const activeMonth = [0, 0];
  const result = [];
  const skippedWithoutSiglas = [];
  const periodPattern = /^(\d{1,2})\s*A\s*(\d{1,2})\s*\/\s*(\d{1,2})$/i;

  rows.forEach(function (row, rowIndex) {
    [0, 8].forEach(function (offset, groupIndex) {
      const monthName = String(row[offset] || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (monthNumbers[monthName]) {
        activeMonth[groupIndex] = monthNumbers[monthName];
        return;
      }

      const period = String(row[offset + 1] || '').trim().replace(/\s+/g, ' ');
      const match = periodPattern.exec(period);
      if (!match) return;
      const rowNumber = rowIndex + 1;
      const sectionMonth = activeMonth[groupIndex];
      const startDay = Number(match[1]);
      const endDay = Number(match[2]);
      const endMonth = Number(match[3]);
      if (!sectionMonth) throw new Error('Mês não identificado para o período na linha ' + rowNumber + ' da aba FÉRIAS.');
      if (endMonth < 1 || endMonth > 12 || startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) {
        throw new Error('Período inválido na linha ' + rowNumber + ' da aba FÉRIAS: ' + period + '.');
      }

      let startMonth = sectionMonth;
      let startYear = year;
      let endYear = year;
      if (sectionMonth === 12 && endMonth === 1) endYear++;
      else if (endMonth === sectionMonth && startDay > endDay) {
        startMonth = sectionMonth === 1 ? 12 : sectionMonth - 1;
        if (sectionMonth === 1) startYear--;
      } else if (endMonth !== sectionMonth && endMonth !== sectionMonth + 1) {
        throw new Error('O mês final não corresponde ao bloco mensal na linha ' + rowNumber + ' da aba FÉRIAS.');
      }

      const start = scheduleSourceDateParts_(startYear, startMonth, startDay, rowNumber);
      const end = scheduleSourceDateParts_(endYear, endMonth, endDay, rowNumber);
      const durationDays = (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000 + 1;
      if (durationDays !== 7) throw new Error('O período semanal na linha ' + rowNumber + ' não contém sete dias.');

      const rawSiglas = [];
      for (let column = offset + 2; column <= offset + 6; column++) {
        const value = String(row[column] || '').trim();
        if (value) rawSiglas.push(value);
      }
      const label = rawSiglas.join('-');
      if (rawSiglas.length === 1 && /^CONGRESSO$/i.test(rawSiglas[0])) {
        skippedWithoutSiglas.push({row: rowNumber, start: start, end: end, label: label});
        return;
      }

      const siglas = [];
      rawSiglas.forEach(function (value) {
        const normalized = value.replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (!normalized) return;
        parseVacationSiglas_(normalized, rowNumber).forEach(function (sigla) { siglas.push(sigla); });
      });
      const uniqueSiglas = [...new Set(siglas)];
      if (!uniqueSiglas.length) {
        skippedWithoutSiglas.push({row: rowNumber, start: start, end: end, label: label});
        return;
      }
      if (uniqueSiglas.some(function (sigla) { return sigla.length > 30 || !/^(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*$/.test(sigla); })) {
        throw new Error('Siglas inválidas na linha ' + rowNumber + ' da aba FÉRIAS.');
      }

      const seed = [start, end, uniqueSiglas.join('|'), label].join('\n');
      const id = 'sheet_' + sha256Hex_(seed).slice(0, 32);
      result.push({id: id, start: start, end: end, siglas: uniqueSiglas, label: label, notes: '', active: true});
    });
  });

  if (!result.length) throw new Error('A grade mensal da aba FÉRIAS não contém períodos com siglas válidas.');
  return {records: result, skippedWithoutSiglas: skippedWithoutSiglas};
}

function scheduleSourceDateParts_(year, month, day, rowNumber) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error('Data inválida na linha ' + rowNumber + ' da aba FÉRIAS.');
  }
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

/** Accept the compact sheet's JSON-array cells and ordinary comma/semicolon lists. */
function parseVacationSiglas_(value, rowNumber) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  let parts;
  if (raw.charAt(0) === '[') {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) {
      throw new Error('Lista de siglas inválida na linha ' + rowNumber + ' da aba FÉRIAS: use uma lista JSON ou siglas separadas por vírgula.');
    }
    if (!Array.isArray(parsed) || parsed.some(function (item) { return typeof item !== 'string'; })) {
      throw new Error('Lista de siglas inválida na linha ' + rowNumber + ' da aba FÉRIAS.');
    }
    parts = parsed;
  } else {
    parts = raw.split(/[,;\s]+/);
  }
  return [...new Set(parts.map(function (item) { return String(item || '').trim().toUpperCase(); }).filter(Boolean))];
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
  const scheduleDays = listFirestoreDocumentsPaged_('scheduleDays', ['id', 'date', 'positions', 'highlights', 'version', 'createdByUid', 'createdAt', 'updatedByUid', 'updatedAt']);
  const vacations = listFirestoreDocumentsPaged_('vacations', ['id', 'start', 'end', 'siglas', 'label', 'notes', 'active', 'createdByUid', 'createdAt', 'updatedByUid', 'updatedAt']);
  return {scheduleDays: scheduleDays, vacations: vacations};
}

function listFirestoreDocumentsPaged_(collectionId, fieldPaths) {
  const documents = [];
  let pageToken = '';
  do {
    const parameters = ['pageSize=1000'].concat((fieldPaths || []).map(function (fieldPath) {
      return 'mask.fieldPaths=' + encodeURIComponent(fieldPath);
    }));
    if (pageToken) parameters.push('pageToken=' + encodeURIComponent(pageToken));
    const path = '/' + encodeURIComponent(collectionId) + '?' + parameters.join('&');
    const page = firestoreRequest_(firestoreDocumentsUrl_(path), {method: 'get'});
    (page.documents || []).forEach(function (document) {
      const fields = firestoreFieldsToJs_(document.fields || {});
      const id = String(document.name || '').split('/').pop();
      documents.push(Object.assign(fields, {id: fields.id || id, _documentName: document.name, _updateTime: document.updateTime}));
    });
    pageToken = page.nextPageToken || '';
    if (documents.length > 10000) throw new Error('Leitura interrompida: a coleção ' + collectionId + ' excede o limite operacional de 10.000 documentos.');
  } while (pageToken);
  return documents;
}

function buildScheduleSourcePlan_(source, current) {
  const writes = [];
  const existingDays = new Map(current.scheduleDays.map(function (record) { return [record.id, record]; }));
  let createScheduleDays = 0, updateScheduleDays = 0, unchangedScheduleDays = 0;
  source.schedule.forEach(function (record) {
    const existing = existingDays.get(record.id);
    if (existing && schedulePositionsEqual_(existing.positions, record.positions)) { unchangedScheduleDays++; return; }
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

/** Compare the ordered position values, independent of Firestore map key order. */
function schedulePositionsEqual_(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (var index = 0; index < left.length; index++) {
    const leftPosition = left[index] || {};
    const rightPosition = right[index] || {};
    if (leftPosition.position !== rightPosition.position || leftPosition.sigla !== rightPosition.sigla) return false;
  }
  return true;
}

/** Bind publication to the exact target state that the operator reviewed. */
function scheduleTargetFingerprint_(current) {
  const scheduleDays = current.scheduleDays.map(function (record) {
    const highlights = record.highlights;
    return {
      id: record.id,
      updateTime: record._updateTime || '',
      positions: Array.isArray(record.positions) ? record.positions.map(function (item) {
        return {position: item && item.position, sigla: item && item.sigla};
      }) : null,
      highlights: highlights ? {
        siglas: Array.isArray(highlights.siglas) ? highlights.siglas.slice().sort() : [],
        events: Array.isArray(highlights.events) ? highlights.events.slice().sort() : []
      } : null
    };
  }).sort(function (left, right) { return left.id.localeCompare(right.id); });
  const vacations = current.vacations.map(function (record) {
    return {
      id: record.id,
      updateTime: record._updateTime || '',
      start: record.start || '', end: record.end || '',
      siglas: Array.isArray(record.siglas) ? record.siglas.slice() : [],
      label: record.label || '', notes: record.notes || '', active: record.active === true
    };
  }).sort(function (left, right) { return left.id.localeCompare(right.id); });
  return sha256Hex_(JSON.stringify({scheduleDays: scheduleDays, vacations: vacations}));
}

function compareScheduleSourceWithFirestore_(source, current) {
  const differences = [];
  const daysById = new Map(current.scheduleDays.map(function (record) { return [record.id, record]; }));
  source.schedule.forEach(function (record) {
    const actual = daysById.get(record.id);
    if (!actual || !schedulePositionsEqual_(actual.positions, record.positions)) differences.push('scheduleDays/' + record.id);
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
