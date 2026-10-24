// Local counters for automatic work. These are estimates, never a project billing meter.
// No user identity, query filter, document ID or response content is persisted here.
var SAHMT_BACKGROUND_READ_CONTEXT_V1 = null;

function faBackgroundReadRunV1_(handler, operation) {
  if (SAHMT_BACKGROUND_READ_CONTEXT_V1) return operation();
  SAHMT_BACKGROUND_READ_CONTEXT_V1 = {handler: handler, units: 0};
  try { return operation(); }
  catch (error) {
    if (error && ['FA_BACKGROUND_READ_PAUSED','SAHMT_URLFETCH_DAILY_QUOTA'].includes(error.code)) {
      const result = {code: error.code, pending: true, handler: handler};
      console.log(JSON.stringify(result)); return result;
    }
    throw error;
  } finally { SAHMT_BACKGROUND_READ_CONTEXT_V1 = null; }
}

function faBackgroundReadKindV1_(url, options) {
  const parsed = String(url).match(/^https:\/\/firestore\.googleapis\.com\/v1\/projects\/sahmt-17a16\/databases\/[^/]+\/documents(.*)$/);
  if (!parsed) return '';
  const path = parsed[1].split('?')[0], method = String(options && options.method || 'get').toLowerCase();
  if (method === 'get') return 'GET';
  if (method === 'post' && [':runQuery', ':batchGet', ':listCollectionIds'].includes(path)) return path;
  return '';
}

function faBackgroundReadUnitsV1_(kind, response, options) {
  // Missing documents and empty queries still reserve at least one unit.
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) return 1;
  try {
    const value = JSON.parse(response.getContentText() || '{}');
    if (kind === ':runQuery') return Math.max(1, value.filter(function (row) { return !!row.document; }).length);
    if (kind === ':batchGet') return Math.max(1, JSON.parse(options.payload || '{}').documents.length);
    if (Array.isArray(value.documents)) return Math.max(1, value.documents.length);
    return 1;
  } catch (_) { throw new Error('FA_BACKGROUND_READ_ACCOUNTING_FAILED'); }
}

function faBackgroundReadFetchV1_(url, options, fetchOperation) {
  return sahmtUrlFetchRun_(function(){return faBackgroundReadBudgetFetchV1_(url,options,fetchOperation);});
}
function faBackgroundReadBudgetFetchV1_(url, options, fetchOperation) {
  const context = SAHMT_BACKGROUND_READ_CONTEXT_V1, kind = faBackgroundReadKindV1_(url, options);
  if (!context || !kind) return fetchOperation();
  const paused = function () {
    const error = new Error('Tarefa automática pausada; registros pendentes preservados.');
    error.code = 'FA_BACKGROUND_READ_PAUSED'; error.status = 429; return error;
  };
  // User lock is separate from the script locks already held by ledger transactions.
  // Counters are per executor; this does not claim to cap all clients in the project.
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) throw paused();
  try {
    const props = PropertiesService.getUserProperties(), key = 'SAHMT_FA_BACKGROUND_READ_BUDGET_V1';
    const now = Date.now(), day = Utilities.formatDate(new Date(now), 'America/Los_Angeles', 'yyyy-MM-dd');
    let state = JSON.parse(props.getProperty(key) || 'null');
    if (state && (typeof state.day !== 'string' || !Number.isSafeInteger(state.units) || state.units < 0 || !Number.isFinite(state.pauseUntil))) throw new Error('FA_BACKGROUND_READ_STATE_INVALID');
    if (state && state.day > day) throw paused();
    if (!state || state.day < day) state = {day: day, units: 0, pauseUntil: 0};
    if (state.units >= 8000 || context.units >= 2000 || state.pauseUntil > now) throw paused();
    // One response can cross the threshold. Index-entry reads are not measured here.
    // Query semantics are never truncated to fit the budget.
    // Reserve one unit before sending; an ambiguous network failure is not free.
    state.units++; context.units++;
    props.setProperty(key, JSON.stringify(state));
    const response = fetchOperation(), units = faBackgroundReadUnitsV1_(kind, response, options || {});
    state.units += units - 1; context.units += units - 1;
    if (response.getResponseCode() === 429) state.pauseUntil = now + 60 * 60 * 1000;
    props.setProperty(key, JSON.stringify(state));
    console.log(JSON.stringify({code: 'FA_BACKGROUND_READ_ACCOUNTED', handler: context.handler,
      units: units, executionUnits: context.units, dailyUnits: state.units, httpStatus: response.getResponseCode()}));
    return response;
  } finally { lock.releaseLock(); }
}
