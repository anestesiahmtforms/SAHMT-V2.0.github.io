/**
 * Checklist display only. It does not validate signatures, enable evaluation,
 * grant credits, release training or change the immutable responsibility snapshot.
 * Cloud Monitoring is delayed: this is an operational guard, not an exact app cap.
 */
const SAHMT_V2_CHECKLIST_DISPLAY = Object.freeze({
  projectId: 'sahmt-17a16', databaseId: '(default)',
  property: 'SAHMT_V2_CHECKLIST_RESP_DISPLAY_STATE_V1',
  handler: 'refreshExibicaoResponsavelChecklist', metric: 'firestore.googleapis.com/document/read_ops_count',
  quotaTimeZone: 'America/Los_Angeles', dailyLimit: 45000,
  appReserve: 5000, metricLagReserve: 2000, unitReserve: 2500,
  freshnessMs: 300000, displayLifetimeMs: 600000,
  maxAttempts: 4, maxPages: 10, maxPoints: 30000, maxStateBytes: 8500
});

/** Explicit operator activation/resumption of this display producer only. */
function ativarExibicaoResponsavelChecklist() { return checklistDisplayRun_(true); }

/** The time trigger is disabled until explicit native operator activation. */
function refreshExibicaoResponsavelChecklist() { return checklistDisplayRun_(false); }

/** Local properties only; no Firestore or Monitoring queries. */
function statusExibicaoResponsavelChecklist() {
  evaluationAssertOperator_(false);
  const state = checklistDisplayLoad_();
  const summary = checklistDisplaySummary_(state, 'STATUS');
  console.log(JSON.stringify(summary));
  return summary;
}

function checklistDisplayRun_(manual) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status: 'BUSY', firestoreDocumentReadsIssued: 0};
  let state = null, reservation = null;
  try {
    state = checklistDisplayLoad_();
    if (!manual && (!state.enabled || state.pausedRequiresReview)) {
      return checklistDisplaySummary_(state, state.pausedRequiresReview ? 'PAUSED_REQUIRES_REVIEW' : 'DISABLED');
    }
    // false checks the existing operator allowlist without reading runtime/ledger.
    evaluationAssertOperator_(false);
    checklistDisplayAssertConfiguration_();
    const startedAt = Date.now();
    checklistDisplayAssertClock_(state, startedAt);
    const observation = checklistDisplayMeasure_(state, startedAt);
    const now = Date.now();
    checklistDisplayAssertClock_(state, now);
    if (now < startedAt || now - observation.latestPointMs > SAHMT_V2_CHECKLIST_DISPLAY.freshnessMs ||
        observation.quotaDay !== checklistDisplayQuotaDay_(now)) checklistDisplayFail_('CRD_METRIC_STALE');
    const reserved = state.reservations.filter(function (entry) { return entry.quotaDay === observation.quotaDay; })
      .reduce(function (total, entry) { return total + entry.readReserve; }, 0);
    const required = observation.reads + reserved + SAHMT_V2_CHECKLIST_DISPLAY.unitReserve +
      SAHMT_V2_CHECKLIST_DISPLAY.appReserve + SAHMT_V2_CHECKLIST_DISPLAY.metricLagReserve;
    if (!Number.isSafeInteger(required) || required >= SAHMT_V2_CHECKLIST_DISPLAY.dailyLimit) checklistDisplayFail_('CRD_READ_MARGIN_UNAVAILABLE');
    // Never reclaim reservations based on a delayed metric or a manual resumption.
    // All four transaction attempts are charged before the first Firestore request.
    reservation = {id: Utilities.getUuid().replace(/-/g, '').toLowerCase(), quotaDay: observation.quotaDay,
      readReserve: SAHMT_V2_CHECKLIST_DISPLAY.unitReserve, startedAtMs: now, finishedAtMs: null, status: 'RESERVED'};
    if (!/^[a-f0-9]{32}$/.test(reservation.id)) checklistDisplayFail_('CRD_RESERVATION_ID_INVALID');
    state.reservations = state.reservations.filter(function (entry) {
      return entry.quotaDay === observation.quotaDay || entry.quotaDay === state.quotaDay;
    });
    if (state.reservations.length >= 32) checklistDisplayFail_('CRD_RESERVATION_CAPACITY');
    state.reservations.push(reservation);
    state.quotaDay = observation.quotaDay;
    state.metricReads = observation.reads;
    state.metricLatestPointMs = observation.latestPointMs;
    state.lastClockMs = now;
    // Only this explicit manual function may clear this module's own pause latch.
    if (manual) { state.pausedRequiresReview = false; state.pauseCode = ''; state.enabled = false; }
    checklistDisplaySave_(state);
    const result = checklistDisplayWriteCurrent_(now, state, startedAt + 120000);
    const finishedAt = Date.now();
    checklistDisplayAssertClock_(state, finishedAt);
    // UrlFetch is synchronous: check again after commit returns, never repeat the write.
    // This operational deadline is checked between requests; it cannot cancel an RPC in flight.
    checklistDisplayOperationClock_(state, startedAt + 120000, result.day);
    if (finishedAt < now || result.day !== checklistSaoPauloDay_()) checklistDisplayFail_('CRD_DAY_OR_CLOCK_CHANGED');
    reservation.status = 'FINISHED'; reservation.finishedAtMs = finishedAt;
    state.lastClockMs = finishedAt; state.lastProjectionDay = result.day; state.lastProjectionStatus = result.status;
    if (result.status !== 'CONFIRMED') checklistDisplayFail_('CRD_SOURCE_REQUIRES_REVIEW');
    if (manual) {
      checklistDisplayRemoveTriggers_();
      ScriptApp.newTrigger(SAHMT_V2_CHECKLIST_DISPLAY.handler).timeBased().everyMinutes(5).create();
      state.enabled = true;
    }
    checklistDisplaySave_(state);
    const summary = checklistDisplaySummary_(state, manual ? 'ENABLED' : 'REFRESHED');
    console.log(JSON.stringify(summary));
    return summary;
  } catch (error) {
    const code = error && /^CRD_[A-Z0-9_]{1,80}$/.test(error.message || '') ? error.message : 'CRD_OPERATION_FAILED';
    if (reservation) {
      reservation.status = 'FAILED';
      reservation.finishedAtMs = Math.max(reservation.startedAtMs, Date.now());
    }
    // If checkpointing fails after a write, the prewritten RESERVED journal remains charged.
    let persisted = false;
    if (state) {
      state.enabled = false; state.pausedRequiresReview = true; state.pauseCode = code;
      state.lastClockMs = Math.max(state.lastClockMs, Date.now());
      try { checklistDisplaySave_(state); persisted = true; } catch (_) {}
    }
    try { checklistDisplayRemoveTriggers_(); } catch (_) {}
    const summary = state ? checklistDisplaySummary_(state, 'PAUSED_REQUIRES_REVIEW') :
      {status: 'PAUSED_REQUIRES_REVIEW', pausedRequiresReview: true, enabled: false};
    summary.code = code; summary.pauseCheckpointPersisted = persisted;
    console.log(JSON.stringify(summary));
    return summary;
  } finally { lock.releaseLock(); }
}

function checklistDisplayAssertConfiguration_() {
  if (!SAHMT_V2_CONFIG || SAHMT_V2_CONFIG.projectId !== SAHMT_V2_CHECKLIST_DISPLAY.projectId ||
      SAHMT_V2_CONFIG.databaseId !== SAHMT_V2_CHECKLIST_DISPLAY.databaseId ||
      !SAHMT_V2_EVALUATION_LEDGER || SAHMT_V2_EVALUATION_LEDGER.maxAttempts !== SAHMT_V2_CHECKLIST_DISPLAY.maxAttempts) {
    checklistDisplayFail_('CRD_CONFIGURATION_MISMATCH');
  }
}
function checklistDisplayFail_(code) { throw new Error(code); }

function checklistDisplayLoad_() {
  const raw = sahmtV2Properties_().getProperty(SAHMT_V2_CHECKLIST_DISPLAY.property);
  if (raw === null) return {schemaVersion: 1, projectId: SAHMT_V2_CHECKLIST_DISPLAY.projectId, enabled: false,
    pausedRequiresReview: false, pauseCode: '', quotaDay: '', metricReads: 0, metricLatestPointMs: 0,
    lastClockMs: 0, lastProjectionDay: '', lastProjectionStatus: '', reservations: []};
  let value;
  try { value = JSON.parse(raw); } catch (_) { checklistDisplayFail_('CRD_STATE_INVALID'); }
  const required = ['schemaVersion','projectId','enabled','pausedRequiresReview','pauseCode','quotaDay','metricReads',
    'metricLatestPointMs','lastClockMs','lastProjectionDay','lastProjectionStatus','reservations'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== required.length ||
      !required.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); }) ||
      value.schemaVersion !== 1 || value.projectId !== SAHMT_V2_CHECKLIST_DISPLAY.projectId ||
      typeof value.enabled !== 'boolean' || typeof value.pausedRequiresReview !== 'boolean' ||
      value.pausedRequiresReview && value.enabled || typeof value.pauseCode !== 'string' ||
      value.pauseCode && !/^CRD_[A-Z0-9_]{1,80}$/.test(value.pauseCode) ||
      !['metricReads','metricLatestPointMs','lastClockMs'].every(function (key) { return Number.isSafeInteger(value[key]) && value[key] >= 0; }) ||
      !['quotaDay','lastProjectionDay'].every(function (key) { return typeof value[key] === 'string' && (!value[key] || /^\d{4}-\d{2}-\d{2}$/.test(value[key])); }) ||
      !['','CONFIRMED','NEEDS_REVIEW'].includes(value.lastProjectionStatus) || !Array.isArray(value.reservations) || value.reservations.length > 32) {
    checklistDisplayFail_('CRD_STATE_INVALID');
  }
  const ids = new Set();
  value.reservations.forEach(function (entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !==
        'finishedAtMs,id,quotaDay,readReserve,startedAtMs,status' || !/^[a-f0-9]{32}$/.test(entry.id || '') || ids.has(entry.id) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.quotaDay || '') || entry.readReserve !== SAHMT_V2_CHECKLIST_DISPLAY.unitReserve ||
        !Number.isSafeInteger(entry.startedAtMs) || entry.startedAtMs < 0 ||
        !(entry.finishedAtMs === null || Number.isSafeInteger(entry.finishedAtMs) && entry.finishedAtMs >= entry.startedAtMs) ||
        !['RESERVED','FINISHED','FAILED'].includes(entry.status)) checklistDisplayFail_('CRD_STATE_INVALID');
    ids.add(entry.id);
  });
  return value;
}
function checklistDisplaySave_(state) {
  const text = JSON.stringify(state);
  if (Utilities.newBlob(text).getBytes().length > SAHMT_V2_CHECKLIST_DISPLAY.maxStateBytes) checklistDisplayFail_('CRD_STATE_CAPACITY');
  const properties = sahmtV2Properties_();
  properties.setProperty(SAHMT_V2_CHECKLIST_DISPLAY.property, text);
  if (properties.getProperty(SAHMT_V2_CHECKLIST_DISPLAY.property) !== text) checklistDisplayFail_('CRD_CHECKPOINT_NOT_CONFIRMED');
}
function checklistDisplayAssertClock_(state, now) {
  if (!Number.isSafeInteger(now) || now < state.lastClockMs) checklistDisplayFail_('CRD_CLOCK_REVERSED');
  state.lastClockMs = now;
}
function checklistDisplayRemoveTriggers_() {
  ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === SAHMT_V2_CHECKLIST_DISPLAY.handler;
  }).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
}
function checklistDisplaySummary_(state, status) {
  return {status: status, projectId: state.projectId, enabled: state.enabled,
    pausedRequiresReview: state.pausedRequiresReview, pauseCode: state.pauseCode,
    quotaDay: state.quotaDay, dailyReadLimit: SAHMT_V2_CHECKLIST_DISPLAY.dailyLimit,
    measuredProjectReads: state.metricReads, reservedDisplayReads: state.reservations.filter(function (entry) {
      return entry.quotaDay === state.quotaDay;
    }).reduce(function (total, entry) { return total + entry.readReserve; }, 0),
    lastProjectionDay: state.lastProjectionDay, lastProjectionStatus: state.lastProjectionStatus,
    displayTriggerEnabled: state.enabled, nativeDisplayGuardPrepared: true, exactGlobalAppCutoff: false};
}

function checklistDisplayQuotaDay_(now) {
  return Utilities.formatDate(new Date(now), SAHMT_V2_CHECKLIST_DISPLAY.quotaTimeZone, 'yyyy-MM-dd');
}
function checklistDisplayQuotaStart_(now) {
  const day = checklistDisplayQuotaDay_(now), parts = day.split('-').map(Number);
  const midnight = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  let start = midnight;
  for (let i = 0; i < 3; i++) {
    const offset = Utilities.formatDate(new Date(start), SAHMT_V2_CHECKLIST_DISPLAY.quotaTimeZone, 'Z').match(/^([+-])(\d{2})(\d{2})$/);
    if (!offset) checklistDisplayFail_('CRD_QUOTA_TIME_ZONE_INVALID');
    start = midnight - (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000;
  }
  if (Utilities.formatDate(new Date(start), SAHMT_V2_CHECKLIST_DISPLAY.quotaTimeZone, 'yyyy-MM-dd HH:mm:ss') !== day + ' 00:00:00') {
    checklistDisplayFail_('CRD_QUOTA_TIME_ZONE_INVALID');
  }
  return start;
}
function checklistDisplayMetricIdentity_(series) {
  function ordered(value) {
    if (Array.isArray(value)) return value.map(ordered);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).sort().forEach(function (key) { result[key] = ordered(value[key]); });
    return result;
  }
  return JSON.stringify(ordered([series.metric, series.resource]));
}
function checklistDisplayMeasure_(state, startedAt) {
  const start = checklistDisplayQuotaStart_(startedAt), quotaDay = checklistDisplayQuotaDay_(startedAt);
  const tokens = new Set(), points = new Set(), intervals = {}, lastPoint = {value: 0};
  let token = '', pages = 0, reads = 0;
  do {
    const clock = Date.now();
    checklistDisplayAssertClock_(state, clock);
    if (clock < startedAt || clock - startedAt > 120000 || quotaDay !== checklistDisplayQuotaDay_(clock)) checklistDisplayFail_('CRD_METRIC_DEADLINE_OR_DAY');
    const params = {filter: 'metric.type="' + SAHMT_V2_CHECKLIST_DISPLAY.metric + '" AND resource.labels.project_id="' +
      SAHMT_V2_CHECKLIST_DISPLAY.projectId + '"', 'interval.startTime': new Date(start).toISOString(),
      'interval.endTime': new Date(startedAt).toISOString(), pageSize: '1000'};
    if (token) params.pageToken = token;
    const query = Object.keys(params).map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); }).join('&');
    const response = UrlFetchApp.fetch('https://monitoring.googleapis.com/v3/projects/' + SAHMT_V2_CHECKLIST_DISPLAY.projectId + '/timeSeries?' + query,
      {method: 'get', headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true, followRedirects: false});
    if (response.getResponseCode() !== 200) checklistDisplayFail_('CRD_MONITORING_UNAVAILABLE');
    let data;
    try {
      const text = response.getContentText();
      if (text.length > 3000000) checklistDisplayFail_('CRD_METRIC_MALFORMED');
      data = JSON.parse(text);
    } catch (_) { checklistDisplayFail_('CRD_METRIC_MALFORMED'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || ++pages > SAHMT_V2_CHECKLIST_DISPLAY.maxPages ||
        data.executionErrors !== undefined && (!Array.isArray(data.executionErrors) || data.executionErrors.length) ||
        data.error || !Array.isArray(data.timeSeries) || !data.timeSeries.length) checklistDisplayFail_('CRD_METRIC_INCOMPLETE');
    data.timeSeries.forEach(function (series) {
      if (!series || !series.metric || series.metric.type !== SAHMT_V2_CHECKLIST_DISPLAY.metric ||
          !series.resource || !series.resource.labels || series.resource.labels.project_id !== SAHMT_V2_CHECKLIST_DISPLAY.projectId ||
          series.metricKind !== 'DELTA' || series.valueType !== 'INT64' || !Array.isArray(series.points) || !series.points.length) checklistDisplayFail_('CRD_METRIC_MALFORMED');
      const identity = checklistDisplayMetricIdentity_(series);
      if (!intervals[identity]) intervals[identity] = [];
      series.points.forEach(function (point) {
        const begin = Date.parse(point && point.interval && point.interval.startTime), end = Date.parse(point && point.interval && point.interval.endTime);
        const value = point && point.value;
        if (!value || Object.keys(value).length !== 1 || typeof value.int64Value !== 'string' || !/^\d+$/.test(value.int64Value)) checklistDisplayFail_('CRD_METRIC_MALFORMED');
        const count = Number(value.int64Value), key = identity + ':' + begin + ':' + end;
        if (!Number.isFinite(begin) || !Number.isFinite(end) || begin < start || end > startedAt || end <= begin ||
            !Number.isSafeInteger(count) || count < 0 || points.has(key) || points.size >= SAHMT_V2_CHECKLIST_DISPLAY.maxPoints) checklistDisplayFail_('CRD_METRIC_MALFORMED');
        points.add(key); intervals[identity].push([begin, end]); reads += count;
        if (!Number.isSafeInteger(reads)) checklistDisplayFail_('CRD_METRIC_MALFORMED');
        lastPoint.value = Math.max(lastPoint.value, end);
      });
    });
    if (data.nextPageToken !== undefined && (typeof data.nextPageToken !== 'string' || data.nextPageToken.length > 4096)) checklistDisplayFail_('CRD_METRIC_INCOMPLETE');
    token = data.nextPageToken || '';
    if (token && tokens.has(token)) checklistDisplayFail_('CRD_METRIC_INCOMPLETE');
    if (token) tokens.add(token);
  } while (token);
  Object.keys(intervals).forEach(function (identity) {
    const values = intervals[identity].sort(function (a, b) { return a[0] - b[0]; });
    for (let i = 1; i < values.length; i++) if (values[i][0] < values[i - 1][1]) checklistDisplayFail_('CRD_METRIC_OVERLAP');
  });
  const finishedAt = Date.now();
  checklistDisplayAssertClock_(state, finishedAt);
  if (finishedAt < startedAt || !lastPoint.value || finishedAt - lastPoint.value > SAHMT_V2_CHECKLIST_DISPLAY.freshnessMs ||
      quotaDay !== checklistDisplayQuotaDay_(finishedAt)) checklistDisplayFail_('CRD_METRIC_STALE');
  if (state.quotaDay === quotaDay && (reads < state.metricReads || lastPoint.value < state.metricLatestPointMs)) checklistDisplayFail_('CRD_METRIC_REGRESSED');
  return {quotaDay: quotaDay, reads: reads, latestPointMs: lastPoint.value};
}

/** Masked get inside the same transaction used for the display field write. */
function checklistDisplayGet_(collectionId, id, fields, transaction) {
  const name = firestoreDocumentName_(collectionId, id);
  const response = firestoreRequest_(firestoreDocumentsUrl_(':batchGet'), {method: 'post', contentType: 'application/json',
    payload: JSON.stringify({documents: [name], mask: {fieldPaths: fields}, transaction: transaction})});
  const values = Array.isArray(response) ? response : [response];
  if (values.length !== 1 || !values[0]) checklistDisplayFail_('CRD_SOURCE_RESPONSE_INVALID');
  if (values[0].missing === name && !values[0].found) return null;
  if (!values[0].found || values[0].found.name !== name || !values[0].found.updateTime) checklistDisplayFail_('CRD_SOURCE_RESPONSE_INVALID');
  return evaluationDocument_(values[0].found);
}

function checklistDisplayOperationClock_(state, deadlineMs, day) {
  const now = Date.now();
  checklistDisplayAssertClock_(state, now);
  if (now >= deadlineMs) checklistDisplayFail_('CRD_OPERATION_DEADLINE');
  if (!state.metricLatestPointMs || now - state.metricLatestPointMs > SAHMT_V2_CHECKLIST_DISPLAY.freshnessMs) checklistDisplayFail_('CRD_METRIC_STALE');
  if (state.quotaDay !== checklistDisplayQuotaDay_(now) || day !== checklistSaoPauloDay_()) checklistDisplayFail_('CRD_DAY_OR_CLOCK_CHANGED');
}
function checklistDisplayWriteCurrent_(reservedAt, state, deadlineMs) {
  const day = checklistSaoPauloDay_();
  checklistDisplayOperationClock_(state, deadlineMs, day);
  return evaluationRunTransaction_(function (transaction) {
    function checkedGet(collectionId, id, fields) {
      checklistDisplayOperationClock_(state, deadlineMs, day);
      const result = checklistDisplayGet_(collectionId, id, fields, transaction);
      checklistDisplayOperationClock_(state, deadlineMs, day);
      return result;
    }
    function checkedQuery(collectionId, filters, order, limit, fields) {
      checklistDisplayOperationClock_(state, deadlineMs, day);
      const result = evaluationQuery_(collectionId, filters, order, limit, fields, transaction);
      checklistDisplayOperationClock_(state, deadlineMs, day);
      return result;
    }
    const previous = checkedGet('checklistResponsibilities', day, ['display']);
    const source = {day: day};
    let status = 'NEEDS_REVIEW', name = '', sigla = '', position = 0;
    try {
      source.schedule = checkedGet('scheduleDays', day, ['positions','vacationLabel']);
      if (!source.schedule) checklistDisplayFail_('CRD_SCHEDULE_UNAVAILABLE');
      source.vacations = checkedQuery('vacations', [
        firestoreFilter_('active', 'EQUAL', {booleanValue: true}), firestoreFilter_('start', 'LESS_THAN_OR_EQUAL', {stringValue: day}),
        firestoreFilter_('end', 'GREATER_THAN_OR_EQUAL', {stringValue: day})], [{fieldPath: 'start', direction: 'ASCENDING'}], 101,
        ['active','start','end','siglas','label']);
      source.events = checkedQuery('events', [firestoreFilter_('active', 'EQUAL', {booleanValue: true}),
        firestoreFilter_('date', 'EQUAL', {stringValue: day})], [], 201, ['active','date','eventType','memberStatus','substitute']);
      source.contacts = checkedQuery('contacts', [firestoreFilter_('active', 'EQUAL', {booleanValue: true})], [], 201,
        ['active','sigla','name']);
      if (source.vacations.length > 100 || source.events.length > 200 || source.contacts.length > 200) checklistDisplayFail_('CRD_SOURCE_VOLUME');
      const selection = selectChecklistResponsible_({schedule: source.schedule, day: day,
        vacations: source.vacations, events: source.events, contacts: source.contacts});
      if (!selection || selection.ok !== true || typeof selection.sigla !== 'string' || selection.sigla !== selection.sigla.trim() ||
          !selection.sigla || selection.sigla.length > 20 || /[\u0000-\u001f\u007f]/.test(selection.sigla) ||
          !Number.isInteger(selection.position) || selection.position < 1 || selection.position > 30) {
        checklistDisplayFail_('CRD_RESPONSIBILITY_UNCONFIRMED');
      }
      source.profiles = checkedQuery('users', [firestoreFilter_('sigla', 'EQUAL', {stringValue: selection.sigla})], [], 2,
        ['uid','active','access','displayName']);
      if (source.profiles.length !== 1 || source.profiles[0].active !== true || source.profiles[0].access !== true ||
          !source.profiles[0].uid || source.profiles[0].uid !== source.profiles[0].id) checklistDisplayFail_('CRD_PROFILE_NOT_UNIQUE');
      const contacts = source.contacts.filter(function (contact) { return normalizeChecklistText_(contact.sigla) === selection.sigla; });
      if (contacts.length > 1) checklistDisplayFail_('CRD_CONTACT_NOT_UNIQUE');
      const sourceName = contacts.length ? contacts[0].name : source.profiles[0].displayName;
      if (typeof sourceName !== 'string') checklistDisplayFail_('CRD_DISPLAY_NAME_INVALID');
      name = sourceName.trim();
      if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) checklistDisplayFail_('CRD_DISPLAY_NAME_INVALID');
      sigla = String(selection.sigla); position = selection.position; status = 'CONFIRMED';
    } catch (error) {
      if (error && (error.status || ['CRD_CLOCK_REVERSED','CRD_OPERATION_DEADLINE','CRD_DAY_OR_CLOCK_CHANGED','CRD_METRIC_STALE'].includes(error.message))) throw error;
      status = 'NEEDS_REVIEW'; name = ''; sigla = ''; position = 0;
    }
    checklistDisplayOperationClock_(state, deadlineMs, day);
    if (Date.now() < reservedAt) checklistDisplayFail_('CRD_CLOCK_REVERSED');
    const display = {schemaVersion: 1, day: day, status: status, name: name, sigla: sigla, position: position,
      sourceDigest: sha256Hex_(JSON.stringify(source)), validUntil: new Date(Date.now() + SAHMT_V2_CHECKLIST_DISPLAY.displayLifetimeMs).toISOString()};
    // Only the display map is updated. No version, fingerprint, revision or financial responsible fields are touched.
    const write = {update: {name: firestoreDocumentName_('checklistResponsibilities', day), fields: firestoreFieldsFromJs_({display: display})},
      updateMask: {fieldPaths: ['display']}, currentDocument: previous ? {updateTime: previous._updateTime} : {exists: false},
      updateTransforms: [{fieldPath: 'display.updatedAt', setToServerValue: 'REQUEST_TIME'}]};
    checklistDisplayOperationClock_(state, deadlineMs, day);
    return {writes: [write], result: {day: day, status: status}};
  });
}
