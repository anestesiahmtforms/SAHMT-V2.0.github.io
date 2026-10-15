// Independent, opt-in activation for new Checklist acknowledgements only.
// No other evaluation gate, historical request or user profile is changed here.
const SAHMT_CHECKLIST_SCIENCE_RELEASE = 'checklist-science-v1';
const SAHMT_CHECKLIST_SCIENCE_ENABLED = 'SAHMT_V2_CHECKLIST_SCIENCE_ENABLED';
const SAHMT_CHECKLIST_SCIENCE_OPERATOR = 'SAHMT_V2_CHECKLIST_SCIENCE_OPERATOR';

function checklistScienceAssertOwner_() {
  const executor = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  const owner = DriveApp.getFileById(ScriptApp.getScriptId()).getOwner();
  if (!executor || !owner || executor !== String(owner.getEmail() || '').trim().toLowerCase()) throw new Error('CHECKLIST_SCIENCE_OWNER_REQUIRED');
  return executor;
}

function checklistScienceAssertOperator_(transaction) {
  const properties = sahmtV2Properties_();
  const executor = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (!executor || executor !== properties.getProperty(SAHMT_CHECKLIST_SCIENCE_OPERATOR) ||
      properties.getProperty(SAHMT_CHECKLIST_SCIENCE_ENABLED) !== 'true') throw new Error('CHECKLIST_SCIENCE_DISABLED');
  const state = evaluationGet_('checklistScienceRuntime', 'state', transaction);
  if (!state || state.enabled !== true || state.release !== SAHMT_CHECKLIST_SCIENCE_RELEASE ||
      !(state.activatedAt instanceof Date) || !Number.isFinite(state.activatedAt.getTime())) throw new Error('CHECKLIST_SCIENCE_DISABLED');
  return state;
}

function checklistScienceSelfTest_() {
  const input = {day: '2026-10-13', schedule: {positions: [{position: 1, sigla: 'AA'}, {position: 2, sigla: 'BB'}], highlights: {events: []}}, vacations: []};
  if (resolveChecklistRotationCore(input).sigla !== 'AA') throw new Error('CHECKLIST_SCIENCE_SELF_TEST_FAILED');
  input.schedule.highlights.events = ['EVENTO:AA:AA:synthetic'];
  const shifted = resolveChecklistRotationCore(input);
  if (shifted.sigla !== 'BB' || shifted.position !== 1) throw new Error('CHECKLIST_SCIENCE_SELF_TEST_FAILED');
  const own = evaluationPlanChecklistTransfer_(null, {day: input.day, responsibleUid: 'synthetic-a', signerUid: 'synthetic-a', signatureId: 'synthetic-self'});
  const other = evaluationPlanChecklistTransfer_(null, {day: input.day, responsibleUid: 'synthetic-a', signerUid: 'synthetic-b', signatureId: 'synthetic-other'});
  const again = evaluationPlanChecklistTransfer_(other.state, {day: input.day, responsibleUid: 'synthetic-a', signerUid: 'synthetic-b', signatureId: 'synthetic-repeat'});
  if (own.changes.length !== 1 || own.changes[0].points !== 0 || other.changes.length !== 2 ||
      other.changes[0].points !== -1 || other.changes[1].points !== 1 || again.changed !== false) throw new Error('CHECKLIST_SCIENCE_SELF_TEST_FAILED');
  return true;
}

function listPendingChecklistScienceRequests_(activatedAt) {
  const query = {from: [{collectionId: 'checklistSignatureRequests'}],
    where: {compositeFilter: {op: 'AND', filters: [
      {fieldFilter: firestoreFilter_('status', 'EQUAL', {stringValue: 'PENDING_VALIDATION'})},
      {fieldFilter: firestoreFilter_('recordKind', 'EQUAL', {stringValue: 'ACKNOWLEDGEMENT'})},
      {fieldFilter: firestoreFilter_('acknowledgedAt', 'GREATER_THAN_OR_EQUAL', {timestampValue: activatedAt.toISOString()})}
    ]}}, orderBy: [{field: {fieldPath: 'acknowledgedAt'}, direction: 'ASCENDING'}],
    select: {fields: [{fieldPath: 'id'}]}, limit: SAHMT_V2_CHECKLIST_VALIDATION.maxPendingPerRun};
  const response = firestoreRequest_(firestoreDocumentsUrl_(':runQuery'), {method: 'post', contentType: 'application/json', payload: JSON.stringify({structuredQuery: query})});
  return (Array.isArray(response) ? response : []).filter(function (item) { return item.document; }).map(function (item) {
    return {id: String(item.document.name).split('/').pop()};
  });
}

function verificarProntidaoCienciaChecklistV1() {
  checklistScienceAssertOwner_();
  checklistScienceSelfTest_();
  const state = evaluationGet_('checklistScienceRuntime', 'state');
  listPendingChecklistScienceRequests_(state && state.activatedAt instanceof Date ? state.activatedAt : new Date());
  const result = {code: 'CHECKLIST_SCIENCE_READY', syntheticChecks: true, firestoreRead: true,
    enabled: sahmtV2Properties_().getProperty(SAHMT_CHECKLIST_SCIENCE_ENABLED) === 'true' && !!state && state.enabled === true,
    triggerCount: ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === 'validatePendingChecklistScienceRequests'; }).length};
  console.log(JSON.stringify(result));
  return result;
}

function instalarCienciaChecklistV1() {
  const executor = checklistScienceAssertOwner_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('CHECKLIST_SCIENCE_BUSY');
  const properties = sahmtV2Properties_();
  try {
    verificarProntidaoCienciaChecklistV1();
    properties.setProperty(SAHMT_CHECKLIST_SCIENCE_ENABLED, 'false');
    checklistSourceTransaction_(function (transaction) {
      const previous = evaluationGet_('checklistScienceRuntime', 'state', transaction);
      if (previous && previous.release !== SAHMT_CHECKLIST_SCIENCE_RELEASE) throw new Error('CHECKLIST_SCIENCE_RELEASE_CONFLICT');
      return {writes: [evaluationWrite_('checklistScienceRuntime', 'state', {enabled: true, release: SAHMT_CHECKLIST_SCIENCE_RELEASE}, previous,
        previous && previous.activatedAt instanceof Date ? ['updatedAt'] : ['activatedAt', 'updatedAt'])], result: true};
    });
    properties.setProperty(SAHMT_CHECKLIST_SCIENCE_OPERATOR, executor);
    const triggers = ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === 'validatePendingChecklistScienceRequests'; });
    if (triggers.length > 1) throw new Error('CHECKLIST_SCIENCE_TRIGGER_CONFLICT');
    if (!triggers.length) ScriptApp.newTrigger('validatePendingChecklistScienceRequests').timeBased().everyMinutes(5).create();
    properties.setProperty(SAHMT_CHECKLIST_SCIENCE_ENABLED, 'true');
    checklistScienceAssertOperator_();
    const result = {code: 'CHECKLIST_SCIENCE_INSTALLED', enabled: true, intervalMinutes: 5, scope: 'NEW_CHECKLIST_ACKNOWLEDGEMENTS_ONLY'};
    console.log(JSON.stringify(result)); return result;
  } catch (error) {
    properties.setProperty(SAHMT_CHECKLIST_SCIENCE_ENABLED, 'false');
    const result = {code: 'CHECKLIST_SCIENCE_INSTALL_FAILED', enabled: false, httpStatus: Number.isInteger(error && error.status) ? error.status : null};
    console.log(JSON.stringify(result)); return result;
  } finally { lock.releaseLock(); }
}

function desativarCienciaChecklistV1() {
  checklistScienceAssertOwner_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('CHECKLIST_SCIENCE_BUSY');
  try {
    sahmtV2Properties_().setProperty(SAHMT_CHECKLIST_SCIENCE_ENABLED, 'false');
    checklistSourceTransaction_(function (transaction) {
      const previous = evaluationGet_('checklistScienceRuntime', 'state', transaction);
      return {writes: previous ? [evaluationWrite_('checklistScienceRuntime', 'state', {enabled: false}, previous, ['updatedAt'])] : [], result: true};
    });
    ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === 'validatePendingChecklistScienceRequests'; }).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    const result = {code: 'CHECKLIST_SCIENCE_DISABLED', enabled: false}; console.log(JSON.stringify(result)); return result;
  } finally { lock.releaseLock(); }
}

function validatePendingChecklistScienceRequests() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {code: 'CHECKLIST_SCIENCE_BUSY'};
  try {
    const activation = checklistScienceAssertOperator_();
    const result = {code: 'CHECKLIST_SCIENCE_PROCESSED', processed: 0, validated: 0, review: 0, rejected: 0, retried: 0};
    listPendingChecklistScienceRequests_(activation.activatedAt).forEach(function (request) {
      try {
        const outcome = validateChecklistSignatureRequest_(request, {scienceOnly: true}); result.processed++;
        if (outcome === 'VALIDATED' || outcome === 'DUPLICATE') result.validated++;
        else if (outcome === 'NEEDS_REVIEW') result.review++;
        else if (outcome === 'REJECTED') result.rejected++;
      } catch (_) { result.retried++; }
    });
    result.delivery = evaluationDrainChecklistDeliveries_({scienceOnly: true});
    const summary = evaluationPublishCategorySummary_('PERFORMANCE', {scienceOnly: true});
    result.summary = summary.status; console.log(JSON.stringify(result)); return result;
  } finally { lock.releaseLock(); }
}
