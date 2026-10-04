import './styles.css';
import './performance-ui.css';
import {createStartupReportCache} from './startup-report-cache.js';
import {createReportRuntime} from './report-runtime.js';
import {mergeReportPendingRecords} from './report-pending.js';
import {confirmedLiveReportRecords} from './live-report-session.js';
import {reconcileReportMarkup} from './report-dom.js';
import {firebaseConfigured} from './firebase-app.js';
import {retryAuthenticatedProfile, signInGoogle, watchSession} from './auth.js';
import {currentRoute, navigate} from './router.js';
import {discardCachedTrainingProgress, listPendingTrainingProgress, listUnsettledOperations, nextQueuedAttemptAt, operationCounts, pendingTrainingProgressCount, readCachedSchedule, removeQueuedOperation, retryFailedOperation, retryFailedOperations, retryableFailedOperationCount} from './outbox.js';
import {eventAmountToPay, eventFieldRules, validateEventForm} from './event-form.js';
import {localDateKey, shiftDateKey} from './schedule-date.js';
import {buildScheduleView} from './schedule-view.js';
import {checklistQrCrop, createChecklistQrConfirmation, decodeQrImageData, findStationForQr, stationIsInDateRange, stationIsValidOn} from './checklist-qr.js';
import {checklistArsenalFunction, checklistArsenalButtonLabel, sortChecklistStationsForDisplay} from './checklist-display.js';
import {normalizeChecklistMaintenance, checklistMaintenanceOverdue} from './checklist-maintenance.js';
import {CHECKLIST_NONCONFORMING_COMMITMENT, checklistCheckerSummary, shortChecklistCheckerName} from './checklist-checker.js';
import {hasFinanceOnlyManagementAccess, parseManagementUids} from './management-access.js';
import {checklistDayMode, resolveChecklistDayRecord, summarizeChecklistDay, summarizeChecklistMonth} from './checklist-date.js';
import {cacheOfflineScheduleImages, offlineScheduleGalleryMarkup} from './offline-schedule.js';
import {DEFAULT_APP_FEATURES, featureEnabledForRoute, normalizeAppFeatures} from './feature-flags.js';
import {contactActionLinks} from './contact-actions.js';
import {MANAGEMENT_AREA_SEED} from './management-seed.js';

const app = document.querySelector('#app');
const STARTUP_BANNER_DURATION_MS = 4000;
let startupBannerActive = firebaseConfigured;
const startupReports = createStartupReportCache();

function preloadStartupReports(user) {
  if (!navigator.onLine || session.offline || session.status !== 'signed-in') return;
  for (const kind of ['events', 'labels', 'checklist']) {
    if (!reportAllowed(kind)) continue;
    const scope = makeReportScope(kind, {warm: true});
    startupReports.holdLive(scope.key, liveReports.warm(kind, scope));
  }
  window.setTimeout(() => startupReports.clear(), 30000);
}
const labelAiEnabled = import.meta.env.VITE_LABEL_AI_ENABLED === 'true' &&
  import.meta.env.VITE_LABEL_AI_ENDPOINT?.trim() === 'https://sahmt-label-ai.anestesiahmtforms.workers.dev/v1/labels/extract' &&
  Boolean(import.meta.env.VITE_APP_CHECK_SITE_KEY?.trim());
const labels = {
  events: ['Operacional', 'Eventos, escala e férias'],
  labels: ['Etiquetas', 'Modelos e registros de etiquetas'],
  management: ['Gestão', 'Áreas, atividades e indicadores'],
  checklist: ['Checklist', 'Registro e acompanhamento operacional'],
  training: ['Desempenho', 'Pontuação, participações e atividades'],
  notifications: ['Notificações', 'Comunicados do SAHMT'],
  people: ['Pessoas', 'Contatos e cadastros da equipe'],
  admin: ['Administração', 'Usuários e configurações'],
  offline: ['Sincronização', 'Ações aguardando confirmação do Firestore']
};
const userRoles = [
  ['coordenador', 'Coordenador'], ['conselho_diretor', 'Conselho Diretor'], ['gestor', 'Gestor'],
  ['anestesiologista', 'Anestesiologista'], ['residente', 'Residente'], ['temporario', 'Temporário'],
  ['administrador_app', 'Administrador do App']
];
const userPermissions = [
  ['scheduleRead', 'Consultar escala'], ['scheduleWrite', 'Liberar siglas na escala'],
  ['eventsRead', 'Consultar eventos'], ['eventsWrite', 'Registrar eventos'], ['eventsCatalogManage', 'Gerenciar catálogo de Eventos'],
  ['labelsRead', 'Consultar etiquetas'], ['labelsWrite', 'Registrar etiquetas'], ['labelsManage', 'Gerenciar etiquetas'],
  ['checklistRead', 'Consultar checklist'], ['checklistWrite', 'Registrar checklist'], ['checklistSign', 'Assinar checklist'], ['checklistManage', 'Gerenciar estações'],
  ['managementRead', 'Consultar Gestão'], ['managementActivityWrite', 'Gerenciar atividades'], ['managementIndicatorsRead', 'Consultar indicadores'], ['managementIndicatorsWrite', 'Gerenciar indicadores'], ['managementPlansManage', 'Gerenciar planos de ação'], ['managementManage', 'Administrar áreas'],
  ['trainingsRead', 'Consultar desempenho'], ['trainingsManage', 'Gerenciar materiais legados'],
  ['documentsManage', 'Gerenciar documentos'], ['qualityManage', 'Gerenciar qualidade'], ['equipmentManage', 'Gerenciar equipamentos'], ['peopleManage', 'Gerenciar pessoas'],
  ['financeRead', 'Consultar financeiro'], ['financeWrite', 'Registrar financeiro'], ['financeManage', 'Administrar financeiro'],
  ['notificationsRead', 'Consultar notificações'], ['notificationsManage', 'Gerenciar notificações'],
  ['usersManage', 'Gerenciar acessos'], ['admin', 'Acesso administrativo total']
];
let session = {status: firebaseConfigured ? 'checking' : 'unconfigured'};
let notice = '';
let outboxRetryTimer = null;
let outboxRetryAt = 0;
let outboxRetryUid = '';
let selectedManagementAreaId = '';
let managementActivityLoad = 0;
let eventReportMode = 'daily';
let eventReportOpen = false;
let eventReportLoad = 0;
let loadedEventReportRecords = [];
let eventReportSourceRecords = [];
let eventReportStale = false;
let eventReportCursor = null;
let eventReportLoadingMore = false;
let loadedEventMembers = [];
let loadedEventCatalog = {payers: [], creditors: []};
let eventCatalogLoadSequence = 0;
let pendingEventPosition = null;
let labelReportMode = 'daily';
let labelReportOpen = false;
let labelReportLoad = 0;
let labelReportState = 'idle';
let loadedLabelRecords = [];
let labelReportCursor = null;
let labelReportLoadingMore = false;
let loadedLabelStaffSiglas = [];
let labelManualConfirmation = {uid: '', status: ''};
let labelCameraConfirmation = {uid: '', status: ''};
let labelEntryGeneration = 0;
let reportPdfPromise = null;
let checklistReportMode = 'daily';
let checklistReportOpen = false;
let checklistReportLoad = 0;
let checklistReportContext = null;
let stopChecklistQrScan = null;
let qrDecoderPromise = null;
let cleanupCurrentModule = null;
let evaluationModuleGeneration = 0;
let cleanupLabelMedia = null;
let loadedTrainingCatalog = [];
let loadedLearningActivityCatalog = [];
let offlineViewMode = 'sync';
let appFeatures = {...DEFAULT_APP_FEATURES};
let appFeaturesUid = '';
let appFeaturesLoadSequence = 0;

// Report state is transient and belongs to a single authenticated scope.
const reportStates = new Map();
const reportPayloads = new Map();
const reportPaintKeys = new Map();
const reportWaiters = new Map();
let checklistCatalogLive = null;
let checklistModuleStations = [];
let checklistResponsibilityLive = null;
let suspendedReportScopes = [];
const reportPermissions = {
  events: ['eventsRead', 'eventsWrite'], labels: ['labelsRead', 'labelsWrite', 'labelsManage'],
  checklist: ['checklistRead', 'checklistWrite', 'checklistSign', 'checklistManage']
};
function reportAllowed(kind) {
  return session.status === 'signed-in' && Boolean(session.user?.uid) && featureEnabledForRoute(kind, appFeatures) && reportPermissions[kind].some(can);
}
function reportPermissionKey(kind) {
  return JSON.stringify([session.profile?.role, session.profile?.active, session.profile?.access,
    String(session.profile?.sigla || '').trim().toUpperCase(), can('admin'), ...reportPermissions[kind].map(can)]);
}
function makeReportScope(kind, {warm = false, append = false, suppliedDay} = {}) {
  const mode = warm ? 'daily' : kind === 'events' ? eventReportMode : kind === 'labels' ? labelReportMode : checklistReportMode;
  const prefix = kind === 'events' ? 'event' : kind === 'labels' ? 'label' : 'checklist';
  const day = warm ? todayInputValue() : suppliedDay || document.querySelector('#' + prefix + '-report-day')?.value || todayInputValue();
  const month = warm ? todayInputValue().slice(0, 7) : document.querySelector(kind === 'checklist' ? '#checklist-month' : '#' + prefix + '-report-month')?.value || todayInputValue().slice(0, 7);
  if (mode === 'daily' && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) ||
      mode === 'monthly' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Selecione uma data ou mês válido.');
  if (kind === 'checklist' && (mode === 'daily' ? day > todayInputValue() : month > todayInputValue().slice(0, 7))) throw new Error('Não é possível consultar um Checklist futuro.');
  const from = mode === 'daily' ? day : month + '-01';
  const to = mode === 'daily' ? day : (() => { const [year, number] = month.split('-').map(Number); return month + '-' + String(new Date(year, number, 0).getDate()).padStart(2, '0'); })();
  const pageSize = kind === 'labels' ? 50 : kind === 'events' ? 100 : mode === 'monthly' ? 2000 : 1000;
  const previous = liveReports.get(kind)?.snapshot().scope;
  const cursor = kind === 'events' ? eventReportCursor : kind === 'labels' ? labelReportCursor : reportPayloads.get('checklist')?.report?.nextCursor;
  const permissionKey = reportPermissionKey(kind);
  const samePeriod = previous?.uid === session.user?.uid && previous.from === from && previous.to === to && previous.mode === mode && previous.permissionKey === permissionKey;
  const loadedLimit = append && samePeriod && cursor?.nextLimit ? cursor.nextLimit : samePeriod ? previous.loadedLimit : pageSize;
  const targetNode = warm ? null : document.querySelector(kind === 'checklist' ? '#module-content' : '#' + prefix + '-report-results');
  const scope = {kind, module: kind, uid: session.user.uid, mode, day: mode === 'daily' ? day : from, month: mode === 'monthly' ? month : day.slice(0, 7), from, to, pageSize, loadedLimit,
    sigla: String(session.profile?.sigla || '').trim().toUpperCase(), isAdmin: can('admin'), canManage: can('labelsManage'), canWrite: can('labelsWrite'),
    permissionKey, authorized: reportAllowed(kind), warm, targetNode, target: targetNode,
    sourceKeys: kind === 'checklist' ? ['catalog', 'report'] : ['report']};
  scope.key = JSON.stringify([kind, scope.uid, mode, from, to, permissionKey, loadedLimit]);
  return scope;
}
function reportScopeCurrent(scope) {
  if (!scope || !reportAllowed(scope.kind) || session.user.uid !== scope.uid || reportPermissionKey(scope.kind) !== scope.permissionKey) return false;
  if (scope.warm) return true;
  if (currentRoute() !== scope.kind || !scope.targetNode?.isConnected) return false;
  const prefix = scope.kind === 'events' ? 'event' : scope.kind === 'labels' ? 'label' : 'checklist';
  if (!document.querySelector('#' + prefix + '-report-dialog')?.open) return false;
  if ((scope.kind === 'events' ? eventReportMode : scope.kind === 'labels' ? labelReportMode : checklistReportMode) !== scope.mode) return false;
  const target = document.querySelector(scope.kind === 'checklist' ? '#module-content' : '#' + prefix + '-report-results');
  if (target !== scope.targetNode) return false;
  return scope.mode === 'daily' ? (document.querySelector('#' + prefix + '-report-day')?.value || todayInputValue()) === scope.day
    : (document.querySelector(scope.kind === 'checklist' ? '#checklist-month' : '#' + prefix + '-report-month')?.value || todayInputValue().slice(0, 7)) === scope.month;
}
function reportFingerprint(value) {
  return JSON.stringify(value, (key, item) => ['changes', 'changedStationIds', 'changedSources', 'fromCache', 'hasPendingWrites', 'serverConfirmed', 'confirmed', 'ready'].includes(key) ? undefined : item);
}
const liveReports = createReportRuntime({
  isCurrent: reportScopeCurrent,
  isOnline: () => navigator.onLine,
  readPending: listUnsettledOperations,
  mergePending: (kind, payload, operations, scope) => {
    const report = kind === 'checklist' ? payload.report : payload;
    const records = mergeReportPendingRecords(kind === 'checklist' ? 'checklists' : kind, report.records, operations, scope);
    const waiting = records.some(item => item.pendingSync || item.pendingFirestore || item.pendingEdit || item.syncFailed || item.syncConflict || item.hasPendingWrites);
    const merged = {...report, records, localPending: waiting};
    return kind === 'checklist' ? {...payload, report: merged} : merged;
  },
  subscribe: subscribeLiveReport,
  onData: receiveLiveReport,
  onState: (kind, state) => {
    reportStates.set(kind, state);
    updateReportSync(kind);
    if (state.state !== 'server' && kind === 'checklist') invalidateChecklistSignature('Aguarde a conferência atual do relatório.');
    if (state.state === 'error' && !state.scope?.warm && state.scope && reportScopeCurrent(state.scope)) {
      if (state.error?.code === 'permission-denied') {
        reportPayloads.delete(kind); reportPaintKeys.delete(kind);
        state.scope.targetNode.replaceChildren();
        if (kind === 'events') loadedEventReportRecords = [];
        if (kind === 'labels') loadedLabelRecords = [];
      }
      let retry = state.scope.targetNode.querySelector('[data-report-retry]');
      if (!retry) { retry = document.createElement('button'); retry.type = 'button'; retry.className = 'secondary-button'; retry.dataset.reportRetry = kind; retry.textContent = 'Tentar atualizar novamente'; state.scope.targetNode.append(retry); }
      retry.onclick = () => liveReports.refresh(kind, 'retry');
      settleReportWaiter(kind, state.scope.key, false);
    }
  }
});
function settleReportWaiter(kind, key, ok) {
  const waiter = reportWaiters.get(kind);
  if (!waiter || waiter.key !== key) return;
  clearTimeout(waiter.timer); reportWaiters.delete(kind); waiter.resolve(ok);
}
function updateReportSync(kind) {
  const state = reportStates.get(kind);
  if (!state?.scope || state.scope.warm || !reportScopeCurrent(state.scope)) return;
  const payload = state.data || reportPayloads.get(kind);
  const report = kind === 'checklist' ? payload?.report : payload;
  const incomplete = report?.historyIncomplete || report?.truncated || payload?.catalog?.truncated;
  const confirmed = state.confirmed && !report?.localPending && !incomplete;
  const text = state.state === 'offline' ? 'Sem conexão' : state.state === 'error' ? 'Falha de atualização' : report?.localPending || state.state === 'pending' ? 'Alterações pendentes de envio'
    : confirmed ? 'Confirmado pelo servidor' : incomplete && state.ready ? 'Relatório incompleto · carregar mais' : 'Atualizando';
  const prefix = kind === 'events' ? 'event' : kind === 'labels' ? 'label' : 'checklist';
  const indicator = document.querySelector('#' + prefix + '-report-sync');
  if (indicator) {
    indicator.classList.toggle('label-report-sync--synced', confirmed);
    indicator.classList.toggle('is-stale', !confirmed);
    indicator.textContent = (confirmed ? '✓ ' : '') + text;
  }
  if (kind === 'checklist') updateChecklistResponsibilityUI();
}
function closeReportLive(kind, reason = 'close') {
  liveReports.close(kind, reason);
  reportStates.delete(kind); reportPayloads.delete(kind); reportPaintKeys.delete(kind);
  const waiter = reportWaiters.get(kind); if (waiter) settleReportWaiter(kind, waiter.key, false);
  if (kind === 'labels') { loadedLabelRecords = []; if (reason === 'close') document.querySelector('#label-report-results')?.replaceChildren(); }
  if (kind === 'events') { loadedEventReportRecords = []; eventReportSourceRecords = []; if (reason === 'close') document.querySelector('#event-report-results')?.replaceChildren(); }
  if (kind === 'checklist') { checklistReportContext = null; checklistResponsibilityLive = null; }
}
function invalidateChecklistSignature(message) {
  const dialog = document.querySelector('#checklist-confirmation-dialog');
  if (dialog) dialog._checklistSignatureRequest = null;
  const confirm = document.querySelector('#checklist-signature-confirm');
  if (confirm) confirm.disabled = true;
  const prepare = document.querySelector('#checklist-signature-prepare');
  if (prepare) prepare.disabled = true;
  if (document.querySelector('#checklist-confirmation-dialog')?.open) {
    const status = document.querySelector('#checklist-signature-status');
    if (status) status.textContent = message;
  }
}
function checklistSignatureCurrent(scope, fingerprint, responsibilityFingerprint = null) {
  const state = liveReports.get('checklist')?.snapshot();
  const result = reportPayloads.get('checklist')?.report;
  return reportScopeCurrent(scope) && state?.confirmed && !result?.truncated && !result?.historyIncomplete && !result?.localPending &&
    !reportPayloads.get('checklist')?.catalog?.truncated && checklistResponsibilityLive?.key === scope.key && checklistResponsibilityLive?.confirmed === true &&
    checklistReportContext?.fingerprint === fingerprint && (responsibilityFingerprint === null || responsibilityFingerprint === reportFingerprint(checklistResponsibilityLive?.responsible)) && can('checklistSign') && scope.day === todayInputValue() && navigator.onLine;
}
function updateChecklistResponsibilityUI() {
  const state = reportStates.get('checklist'), scope = state?.scope;
  if (!scope || scope.warm || !reportScopeCurrent(scope) || scope.mode !== 'daily') return;
  const responsible = checklistResponsibilityLive?.key === scope.key ? checklistResponsibilityLive : null;
  const name = document.querySelector('#checklist-responsible-name');
  if (name) name.textContent = responsible?.responsible?.name || (responsible?.error ? 'Responsável não confirmado' : 'Consultando responsável…');
  const prepare = document.querySelector('#checklist-signature-prepare');
  if (prepare) prepare.disabled = !checklistSignatureCurrent(scope, checklistReportContext?.fingerprint);
}
async function subscribeLiveReport(kind, scope, callbacks) {
  if (kind === 'events' || kind === 'labels') {
    const module = kind === 'events' ? await import('./report-live-data.js') : await import('./label-report-reader.js');
    if (!callbacks.isCurrent()) return () => {};
    const watcher = kind === 'events' ? module.watchEventRecords : module.watchLabelRecords;
    return watcher(scope, payload => callbacks.next('report', {data: payload, complete: true, fromCache: payload.fromCache, hasPendingWrites: payload.hasPendingWrites}), callbacks.error);
  }
  const [{watchChecklistStations}, {watchChecklistReport}, {readSafeCache, writeSafeCache}] = await Promise.all([
    import('./report-live-data.js'), import('./checklist-report-listener.js'), import('./outbox.js')
  ]);
  if (!callbacks.isCurrent()) return () => {};
  let stopped = false, reportStop = null, catalogStop = null, responsibilityStop = null, sequence = 0, idsKey = null;
  const savedCatalog = checklistCatalogLive?.uid === scope.uid ? checklistCatalogLive.records : (await readSafeCache(scope.uid, 'stations', 'all').catch(() => null))?.data;
  const initialCatalog = Array.isArray(savedCatalog) ? savedCatalog : [];
  let catalogServerSeen = false, writtenCatalog = '', catalogWriteSequence = 0;
  const current = () => !stopped && callbacks.isCurrent();
  const stop = () => { stopped = true; sequence++; reportStop?.(); catalogStop?.(); responsibilityStop?.(); };
  const error = failure => { if (current()) { stop(); callbacks.error(failure); } };
  const acceptResponsibility = payload => {
    if (!current()) return;
    const previous = checklistResponsibilityLive;
    checklistResponsibilityLive = {...payload, key: scope.key};
    if (previous?.key === scope.key && reportFingerprint(previous.responsible) !== reportFingerprint(payload.responsible)) invalidateChecklistSignature('A escala ou a responsabilidade mudou. Revise o relatório antes de enviar.');
    updateChecklistResponsibilityUI();
  };
  if (scope.mode === 'daily' && can('checklistSign')) {
    if (scope.isAdmin) {
      void import('./checklist-responsibility-listener.js').then(module => current() ? module.watchChecklistResponsibility(scope, acceptResponsibility, failure => acceptResponsibility({confirmed: false, error: failure})) : null)
        .then(unsubscribe => { if (!current()) unsubscribe?.(); else responsibilityStop = unsubscribe; }).catch(failure => acceptResponsibility({confirmed: false, error: failure}));
    } else {
      void import('./checklist-responsibility-reader.js').then(module => current() ? module.getChecklistDayResponsible(scope) : null)
        .then(responsible => { if (responsible) acceptResponsibility({responsible, confirmed: true}); }).catch(failure => acceptResponsibility({confirmed: false, error: failure}));
    }
  }
  if (!current()) return stop;
  try {
    catalogStop = await watchChecklistStations(payload => {
      if (!current()) return;
      const serverConfirmed = payload.fromCache === false && payload.hasPendingWrites === false;
      if (serverConfirmed) catalogServerSeen = true;
      if (!catalogServerSeen && initialCatalog.length) {
        const merged = new Map(initialCatalog.map(station => [station.id, {...station}]));
        for (const station of payload.records) merged.set(station.id, station);
        payload = {...payload, records: [...merged.values()].sort((left, right) => Number(left.order || 0) - Number(right.order || 0)), fromCache: true, serverConfirmed: false};
      }
      if (serverConfirmed && !payload.truncated) {
        const fingerprint = JSON.stringify(payload.records);
        if (fingerprint !== writtenCatalog) {
          writtenCatalog = fingerprint; const ownWrite = ++catalogWriteSequence;
          void Promise.resolve().then(() => current() && ownWrite === catalogWriteSequence ? writeSafeCache(scope.uid, 'stations', 'all', payload.records) : null).catch(() => {});
        }
      }
      checklistCatalogLive = {...payload, uid: scope.uid};
      const stationIds = payload.records.filter(station => scope.mode === 'monthly' || stationIsInDateRange(station, scope.day)).map(station => station.id).sort();
      const key = JSON.stringify(stationIds);
      callbacks.next('catalog', {data: payload, complete: true, fromCache: payload.fromCache, hasPendingWrites: payload.hasPendingWrites});
      if (key === idsKey) return;
      idsKey = key;
      const ownSequence = ++sequence; reportStop?.(); reportStop = null;
      callbacks.next('report', {data: null, complete: false, fromCache: true, hasPendingWrites: false});
      void readSafeCache(scope.uid, 'checklists', scope.mode === 'daily' ? scope.day : 'month:' + scope.month).catch(() => null).then(cached => {
        if (!current() || sequence !== ownSequence) return null;
        const value = cached?.data || cached?.value || cached;
        const initial = value && JSON.stringify(value.stationIds || []) === key ? value : null;
        return watchChecklistReport({...scope, day: scope.mode === 'daily' ? scope.day : null, month: scope.mode === 'monthly' ? scope.month : null, stationIds, initial}, report => {
          if (!current() || sequence !== ownSequence) return;
          callbacks.next('report', {data: report, complete: true, fromCache: report.fromCache || !report.ready, hasPendingWrites: report.hasPendingWrites});
        }, error);
      }).then(unsubscribe => { if (!current() || sequence !== ownSequence) unsubscribe?.(); else reportStop = unsubscribe; }).catch(error);
    }, error);
    if (!current()) catalogStop?.();
    return stop;
  } catch (failure) { stop(); throw failure; }
}
function receiveLiveReport(kind, payload, scope) {
  if (!reportScopeCurrent(scope)) return;
  reportPayloads.set(kind, payload);
  if (kind === 'checklist' && payload?.catalog) {
    checklistCatalogLive = {...payload.catalog, uid: scope.uid};
    if (checklistModuleStations.length || currentRoute() === 'checklist') checklistModuleStations.splice(0, checklistModuleStations.length, ...payload.catalog.records);
  }
  if (scope.warm) return;
  const fingerprint = reportFingerprint(payload);
  updateReportSync(kind);
  if (reportPaintKeys.get(kind) !== fingerprint || kind === 'checklist' && checklistReportContext?.scopeKey !== scope.key) {
    reportPaintKeys.set(kind, fingerprint);
    if (kind === 'events') {
      eventReportSourceRecords = payload.records; eventReportStale = !navigator.onLine; eventReportCursor = payload.nextCursor;
      renderEventReportRecords();
    } else if (kind === 'labels') renderLiveLabelReport(payload, scope);
    else if (scope.mode === 'monthly') void loadMonthlyChecklist(checklistModuleStations, payload.report, scope);
    else void loadDailyChecklist(checklistModuleStations, scope.day, payload.report, scope);
  }
  updateReportSync(kind);
  if (!reportWaiters.get(kind)?.requireServer || liveReports.get(kind)?.snapshot().confirmed) settleReportWaiter(kind, scope.key, true);
}
async function startReportLive(kind, options = {}) {
  let scope;
  try { scope = makeReportScope(kind, options); }
  catch (error) { closeReportLive(kind, 'invalid-period'); const target = document.querySelector(kind === 'checklist' ? '#module-content' : kind === 'labels' ? '#label-report-results' : '#event-report-results'); if (target) target.innerHTML = '<p class="empty-state">' + escapeHtml(error.message) + '</p>'; return false; }
  if (!reportScopeCurrent(scope)) { closeReportLive(kind, 'scope-changed'); return false; }
  const previous = liveReports.get(kind)?.snapshot().scope;
  if (previous?.key !== scope.key) {
    reportPaintKeys.delete(kind); reportPayloads.delete(kind);
    if (!options.append) { scope.targetNode.innerHTML = '<p class="loading">Atualizando registros…</p>'; if (kind === 'events') loadedEventReportRecords = []; if (kind === 'labels') loadedLabelRecords = []; }
  }
  const lease = startupReports.takeLive(scope.key);
  // Runtime owns the same controller before and after the startup lease handoff.
  void lease;
  const pending = new Promise(resolve => {
    const old = reportWaiters.get(kind); if (old) settleReportWaiter(kind, old.key, false);
    const timer = setTimeout(() => { settleReportWaiter(kind, scope.key, false); }, 12000);
    reportWaiters.set(kind, {key: scope.key, resolve, timer, requireServer: options.force === true});
  });
  liveReports.open(kind, {...scope, warm: false}, {force: options.force === true});
  return pending;
}

const preloadedDataUsers = new Set();
const scheduledDataPreloads = new Set();

function preloadOperationalDataWhenIdle(user) {
  if (!user?.uid || !navigator.onLine || session.offline) return;
  const uid = user.uid;
  const profile = session.profile || {};
  const permissions = profile.permissions || {};
  const elevated = profile.role === 'administrador_app' || permissions.admin === true;
  const allows = (names) => elevated || names.some((name) => permissions[name] === true);
  const canUseData = allows([
    'scheduleWrite', 'eventsRead', 'eventsWrite', 'eventsCatalogManage', 'labelsRead', 'labelsWrite', 'labelsManage',
    'managementManage', 'managementRead', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite',
    'managementPlansManage', 'documentsManage', 'equipmentManage', 'qualityManage', 'financeRead', 'financeWrite', 'financeManage',
    'checklistRead', 'checklistWrite', 'checklistSign', 'checklistManage', 'trainingsRead', 'trainingsManage',
    'notificationsRead', 'notificationsManage', 'peopleManage', 'usersManage'
  ]);
  const modules = [];
  if (canUseData) modules.push('data');
  if (allows(['trainingsRead', 'trainingsManage'])) modules.push('training');
  if (allows(['equipmentManage'])) modules.push('equipment');
  if (allows(['labelsWrite', 'labelsManage'])) modules.push('label-camera');
  if (!modules.length) return;
  const preloadKey = `${uid}:${modules.join(',')}`;
  if (preloadedDataUsers.has(preloadKey) || scheduledDataPreloads.has(preloadKey)) return;
  scheduledDataPreloads.add(preloadKey);
  const preload = async () => {
    try {
      if (session.status !== 'signed-in' || session.user?.uid !== uid || session.offline || !navigator.onLine) return;
      if (import.meta.env.PROD && 'serviceWorker' in navigator && !navigator.serviceWorker.controller) {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => window.setTimeout(resolve, 2000))
        ]).catch(() => {});
        if (session.status !== 'signed-in' || session.user?.uid !== uid || session.offline || !navigator.onLine) return;
      }
      preloadedDataUsers.add(preloadKey);
      const imports = [];
      if (modules.includes('data')) imports.push(import('./data.js'));
      if (modules.includes('training')) imports.push(import('./performance-ui.js'));
      if (modules.includes('equipment')) imports.push(import('./equipment.js'));
      if (modules.includes('label-camera')) imports.push(import('./label-camera.js'));
      void Promise.all(imports).catch((error) => {
        preloadedDataUsers.delete(preloadKey);
        console.warn('[SAHMT] Pré-carregamento de ações adiado:', error.code || error.message);
      });
    } finally {
      scheduledDataPreloads.delete(preloadKey);
    }
  };
  if (startupBannerActive) void preload();
  else if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(preload, {timeout: 1800});
  else window.setTimeout(preload, 700);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

function loadReportPdfModule() {
  if (!reportPdfPromise) reportPdfPromise = import('./report-pdf.js').catch((error) => { reportPdfPromise = null; throw error; });
  return reportPdfPromise;
}

function loadQrDecoder() {
  const available = () => ['BinaryBitmap', 'HybridBinarizer', 'RGBLuminanceSource', 'QRCodeReader'].every((name) => typeof window.ZXing?.[name] === 'function');
  if (available()) return Promise.resolve();
  if (qrDecoderPromise) return qrDecoderPromise;
  const script = document.createElement('script');
  script.src = `${import.meta.env.BASE_URL}vendor/zxing.min.js`;
  let timeout;
  const promise = new Promise((resolve, reject) => {
    const fail = () => {
      clearTimeout(timeout);
      if (qrDecoderPromise === promise) qrDecoderPromise = null;
      script.remove();
      reject(new Error('Não foi possível carregar o leitor QR. Feche e abra o leitor para tentar novamente.'));
    };
    script.onload = () => {
      if (!available()) { fail(); return; }
      clearTimeout(timeout);
      resolve();
    };
    script.onerror = fail;
    timeout = window.setTimeout(fail, 10000);
  });
  qrDecoderPromise = promise;
  document.head.append(script);
  return promise;
}

function loginView() {
  const configMessage = session.status === 'unconfigured'
    ? '<p class="notice">Configure as variáveis públicas do Firebase do projeto SAHMT para habilitar o login.</p>'
    : '';
  const statusMessage = {
    'profile-missing': 'Esta conta Google ainda não tem um perfil SAHMT. Solicite o acesso por aqui.',
    'access-pending': 'Sua solicitação de acesso foi enviada. O administrador precisa revisar e configurar seu perfil.',
    blocked: 'Sua conta está autenticada, mas o perfil está inativo ou sem acesso ao SAHMT.',
    'profile-error': 'Não foi possível carregar o perfil e as permissões. Tente novamente quando houver conexão.',
    'auth-error': 'Não foi possível verificar sua sessão do Firebase.'
  }[session.status];
  const resultMessage = notice || statusMessage ? `<p class="notice" role="alert">${escapeHtml(notice || statusMessage)}</p>` : '';
  const accessRequest = session.status === 'profile-missing' && session.user ? '<button class="primary-button" id="request-access" type="button">Solicitar acesso ao SAHMT</button>' : '';
  const profileRetry = ['profile-error', 'access-pending'].includes(session.status) && session.user ? `<button class="primary-button" id="profile-retry" type="button">${session.status === 'access-pending' ? 'Verificar aprovação' : 'Tentar carregar perfil novamente'}</button>` : '';
  return `<main class="login-gate">
    <section class="login-card" aria-labelledby="login-title">
      <img class="brand-logo" src="${import.meta.env.BASE_URL}assets/icon-192.png" alt="SAHMT">
      <h1 id="login-title">SAHMT</h1>
      <p class="login-message">Entre com sua conta Google autorizada.</p>
      ${configMessage}${resultMessage}${accessRequest}
      ${profileRetry}
      <button class="primary-button google-button" id="google-login" type="button" ${!firebaseConfigured ? 'disabled' : ''}>Entrar com Google</button>
      <small>Uma única conta para acessar as áreas do SAHMT, conforme suas permissões.</small>
    </section>
  </main>`;
}

function moduleCards() {
  const permissionFor = {events: ['eventsRead', 'eventsWrite', 'eventsCatalogManage'], labels: ['labelsRead', 'labelsWrite', 'labelsManage'], management: ['managementManage', 'managementRead', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage', 'documentsManage', 'equipmentManage', 'qualityManage', 'financeRead', 'financeWrite', 'financeManage', 'peopleManage', 'usersManage', 'admin'], checklist: ['checklistRead', 'checklistWrite', 'checklistSign', 'checklistManage'], training: ['trainingsRead', 'trainingsManage'], notifications: ['notificationsRead', 'notificationsManage'], people: ['peopleManage'], admin: ['usersManage']};
  const commonModules = session.status === 'signed-in' && session.profile?.active === true && session.profile?.access === true ? ['training', 'notifications'] : [];
  const moduleIcons = {events: 'assets/modules/operacional.jpg', labels: 'assets/sahmt-logo.png', management: 'assets/selo-qga-accredited-qmentum-diamond.png', checklist: 'assets/modules/checklist.svg'};
  return Object.entries(labels).filter(([route]) => !['people', 'admin'].includes(route) && (commonModules.includes(route) || permissionFor[route]?.some(can)) && featureEnabledForRoute(route, appFeatures)).map(([route, [title, subtitle]]) => `<button class="module-card" data-route="${route}">
    ${moduleIcons[route] ? `<img class="module-icon" src="${import.meta.env.BASE_URL}${moduleIcons[route]}" alt="" width="40" height="40" loading="lazy" decoding="async">` : `<span class="module-mark" aria-hidden="true">${{training:'DE',notifications:'NO',people:'PS',admin:'AD'}[route]}</span>`}
    <span><strong>${title}</strong><small>${subtitle}</small></span><span class="arrow" aria-hidden="true">›</span>
  </button>`).join('');
}

function managementUtilityCards() {
  return [['people', 'peopleManage', 'PS'], ['admin', 'usersManage', 'AD']].filter(([route, permission]) => can(permission) && featureEnabledForRoute(route, appFeatures)).map(([route, , mark]) => {
    const [title, subtitle] = labels[route];
    return `<button class="module-card" data-route="${route}"><span class="module-mark" aria-hidden="true">${mark}</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span><span class="arrow" aria-hidden="true">›</span></button>`;
  }).join('');
}

function can(permission) {
  if (session.profile?.role === 'administrador_app' || session.profile?.permissions?.admin === true || session.profile?.permissions?.[permission] === true) return true;
  const qualityAreaPermissions = ['managementRead', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage', 'documentsManage'];
  return currentRoute() === 'management' && (!selectedManagementAreaId || selectedManagementAreaId === 'area-gestao-da-qualidade') &&
    session.profile?.permissions?.qualityManage === true && qualityAreaPermissions.includes(permission);
}

function vacationRankMarkup(sigla, classes, position) {
  return `<span class="sigla-token__vacation-rank"><span class="${classes.join(' ')}">${escapeHtml(sigla)}</span><small class="sigla-token__vacation-number" aria-label="Posição ${position} na escala de férias">${position}</small></span>`;
}

function renderScheduleSigla(sigla, vacationParts = [], checkedSiglas = [], vacationPositions = {}, showVacationRank = true) {
  const vacationSet = new Set(vacationParts.map((item) => String(item || '').toUpperCase()));
  const checkedSet = new Set(checkedSiglas.map((item) => String(item || '').toUpperCase()));
  return String(sigla || '—').toUpperCase().split(/([/-])/).map((part) => {
    if (part === '/' || part === '-') return escapeHtml(part);
    const onVacation = vacationSet.has(part);
    if (onVacation && !showVacationRank) return escapeHtml(part);
    const classes = [];
    if (onVacation) classes.push('sigla-token__vacation-part');
    if (checkedSet.has(part)) classes.push('sigla-token__released-part--checked');
    return onVacation
      ? vacationRankMarkup(part, classes, vacationPositions[part] || '')
      : `<span${classes.length ? ` class="${classes.join(' ')}"` : ''}>${escapeHtml(part)}</span>`;
  }).join('');
}

function renderScheduleAliases(siglas, vacationParts = [], checkedSiglas = [], vacationPositions = {}, showVacationRank = true) {
  const vacationSet = new Set(vacationParts.map((item) => String(item || '').toUpperCase()));
  const checkedSet = new Set(checkedSiglas.map((item) => String(item || '').toUpperCase()));
  return siglas.map((sigla) => {
    const onVacation = vacationSet.has(sigla);
    if (onVacation && !showVacationRank) return escapeHtml(sigla);
    const classes = [];
    if (onVacation) classes.push('sigla-token__vacation-part');
    if (checkedSet.has(sigla)) classes.push('sigla-token__released-part--checked');
    return onVacation
      ? vacationRankMarkup(sigla, classes, vacationPositions[sigla] || '')
      : `<span${classes.length ? ` class="${classes.join(' ')}"` : ''}>${escapeHtml(sigla)}</span>`;
  }).join(' · ');
}

function renderSchedulePositionGrid(scheduleView, {mode = 'home', schedule = {}, eventsWritable = false} = {}) {
  const highlightedSiglas = new Set(mode === 'events' ? [] : Array.isArray(schedule.highlights?.siglas) ? schedule.highlights.siglas : []);
  const isAdmin = can('admin');
  const ownSigla = String(session.profile?.sigla || '').trim().toUpperCase();
  const eventSiglas = new Set();
  for (const marker of Array.isArray(schedule.highlights?.events) ? schedule.highlights.events : []) {
    const parts = String(marker || '').trim().toUpperCase().replace(/^EVENTO:/, '').split(':');
    const scheduled = parts[0] || '';
    if (parts.length >= 3) {
      const memberSigla = parts.length >= 4 ? parts[2] : (scheduled.includes('/') || scheduled.includes('-') ? '' : scheduled);
      if (memberSigla && memberSigla !== '-' && (isAdmin || memberSigla === ownSigla)) eventSiglas.add(memberSigla);
      else if (isAdmin && !memberSigla) scheduled.split(/[/-]/).filter(Boolean).forEach((sigla) => eventSiglas.add(sigla));
    }
  }
  const eventMode = mode === 'events';
  return `<div class="siglas-grid schedule-siglas-grid">${scheduleView.positions.map((position, index) => {
    const hasContact = position.contacts?.length > 0;
    const canLaunchEvent = eventsWritable && featureEnabledForRoute('events', appFeatures);
    const singleSiglaOnVacation = position.siglas.length === 1 && position.vacationParts.length === 1;
    const hasEvent = eventMode && (eventSiglas.has(String(position.sigla || '').toUpperCase()) || position.siglas.some((sigla) => eventSiglas.has(String(sigla || '').toUpperCase())));
    const aliases = position.sigla === 'DC' && position.siglas.length
      ? `<small class="sigla-token__aliases">${renderScheduleAliases(position.siglas, position.vacationParts, [...highlightedSiglas], scheduleView.vacationPositions)}</small>`
      : '';
    const tokenLabel = position.sigla === 'DC' ? '<strong>DC</strong>'
      : `<strong>${renderScheduleSigla(position.sigla, position.vacationParts, position.siglas.filter((sigla) => highlightedSiglas.has(sigla)), scheduleView.vacationPositions)}</strong>`;
    const marked = !eventMode && highlightedSiglas.has(position.sigla);
    const showConfirmedDot = eventMode ? hasEvent : marked && !schedule.stale && schedule.pendingFirestore !== true;
    const confirmationLabel = eventMode ? 'Registro de evento confirmado no Firestore' : 'Liberação confirmada no Firestore';
    const vacationDescription = position.vacationParts.length
      ? `; em férias: ${position.vacationParts.map((sigla) => `${sigla}, posição ${position.vacationPositions[sigla]} na escala de férias`).join('; ')}`
      : '';
    const actionLabel = eventMode
      ? (eventsWritable ? `Lançar evento pela sigla ${position.sigla}` : `Sigla ${position.sigla}`)
      : (hasContact ? `Abrir contato da sigla ${position.sigla}` : canLaunchEvent ? `Lançar evento pela sigla ${position.sigla}` : `Contato não cadastrado para ${position.sigla}`);
    const title = eventMode
      ? (eventsWritable ? 'Lançar evento' : 'Somente consulta')
      : (hasContact ? 'Abrir contato' : canLaunchEvent ? 'Lançar evento' : 'Contato não cadastrado');
    const disabled = eventMode ? !eventsWritable : !hasContact && !canLaunchEvent;
    return `<div class="sigla-item"><button class="sigla-token sigla-button${position.sigla === 'DC' ? ' sigla-token--dc' : ''}${singleSiglaOnVacation ? ' sigla-token--vacation' : ''}${marked ? ' sigla-token--checked' : ''}${hasEvent ? ' sigla-token--event' : ''}" type="button" data-schedule-position-index="${index}" ${disabled ? 'disabled' : ''} aria-label="${escapeHtml(actionLabel)}${escapeHtml(vacationDescription)}" title="${escapeHtml(title)}">${tokenLabel}${aliases}${showConfirmedDot ? `<span class="sigla-confirmation-check" role="img" aria-label="${confirmationLabel}" title="${confirmationLabel}">✓</span>` : ''}</button><div class="sigla-index">${escapeHtml(position.function || position.position || String(index + 1))}</div></div>`;
  }).join('')}${eventMode ? renderEventSupportTile(eventsWritable) : ''}</div>`;
}

function renderEventSupportTile(eventsWritable) {
  return `<div class="sigla-item"><button class="sigla-token sigla-button sigla-token--support" type="button" data-event-support ${eventsWritable ? '' : 'disabled'} aria-label="Lançar evento de Suporte" title="Lançar Suporte"><strong>SUPORTE</strong></button><div class="sigla-index" aria-hidden="true"></div></div>`;
}

function renderLabelManualConfirmation() {
  if (labelManualConfirmation.uid !== session.user?.uid || !labelManualConfirmation.status) return '';
  const confirmed = labelManualConfirmation.status === 'confirmed';
  if (confirmed && labelManualConfirmation.expiresAt <= Date.now()) return '';
  return `<span class="label-manual-confirmation${confirmed ? ' label-confirmation--confirmed' : ' label-manual-confirmation--pending'}" ${confirmed ? labelConfirmationFadeStyle(labelManualConfirmation) : ''} data-label-manual-confirmation role="status" aria-label="${confirmed ? 'Registro manual confirmado no Firestore' : 'Registro manual pendente de confirmação'}"><span aria-hidden="true">${confirmed ? '✓' : '✕'}</span><small>${confirmed ? 'Confirmado' : 'Pendente'}</small></span>`;
}

function updateLabelManualConfirmation(status, uid) {
  clearTimeout(labelManualConfirmation.timer);
  labelManualConfirmation = timedLabelConfirmation(status, uid, (confirmation) => {
    if (labelManualConfirmation === confirmation) updateLabelManualConfirmation('', uid);
  });
  if (uid !== session.user?.uid) return;
  const button = document.querySelector('#label-manual-open');
  if (!button) return;
  button.querySelector('[data-label-manual-confirmation]')?.remove();
  const html = renderLabelManualConfirmation();
  button.classList.toggle('label-manual--has-status', Boolean(html));
  if (html) button.insertAdjacentHTML('beforeend', html);
}

function renderLabelCameraConfirmation() {
  if (labelCameraConfirmation.uid !== session.user?.uid || labelCameraConfirmation.status !== 'confirmed') return '';
  if (labelCameraConfirmation.expiresAt <= Date.now()) return '';
  return `<span class="label-camera-confirmation label-confirmation--confirmed" ${labelConfirmationFadeStyle(labelCameraConfirmation)} data-label-camera-confirmation role="status" aria-label="Registro de etiqueta concluído"><span aria-hidden="true">✓</span><small>Feito!</small></span>`;
}

function updateLabelCameraConfirmation(status, uid) {
  clearTimeout(labelCameraConfirmation.timer);
  labelCameraConfirmation = timedLabelConfirmation(status, uid, (confirmation) => {
    if (labelCameraConfirmation === confirmation) updateLabelCameraConfirmation('', uid);
  });
  if (uid !== session.user?.uid) return;
  const button = document.querySelector('#label-camera-open');
  if (!button) return;
  button.querySelector('[data-label-camera-confirmation]')?.remove();
  const html = renderLabelCameraConfirmation();
  button.classList.toggle('label-camera--has-status', Boolean(html));
  if (html) button.insertAdjacentHTML('beforeend', html);
}

function timedLabelConfirmation(status, uid, expire) {
  const confirmation = {uid, status, expiresAt: status === 'confirmed' ? Date.now() + 4000 : null};
  if (status === 'confirmed' && uid === session.user?.uid) {
    confirmation.timer = setTimeout(() => expire(confirmation), 4000);
  }
  return confirmation;
}

function labelConfirmationFadeStyle(confirmation) {
  return `style="--label-feedback-delay:${confirmation.expiresAt - Date.now() - 600}ms"`;
}

function actionForm(route) {
  if (route === 'events') {
    if (!can('eventsWrite')) return '';
    return `<dialog class="event-launch-dialog" id="event-launch-dialog" aria-labelledby="event-launch-title"><header><div><h3 id="event-launch-title" tabindex="-1" autofocus>LANÇAMENTO DO EVENTO</h3></div></header><form data-module-form="events" autocomplete="on" novalidate>
    <div class="form-grid"><label><span>Data do Evento</span><input name="eventDate" type="date" required value="${todayInputValue()}"></label>
    <div class="event-member-field" data-event-field="memberStatus"><input name="memberSigla" type="hidden"><label class="event-member-control"><span>MEMBRO AUSENTE/ATRASADO</span><input name="memberStatus" maxlength="160" readonly placeholder="Selecione uma sigla na escala"></label></div>
    <input name="scheduleSigla" type="hidden">
    <label class="event-type-field"><span>Tipo de Evento</span><select name="eventType" required><option value="">Selecione</option>${['Pessoal','Férias','ATRASO','Suporte','Gestão','Congresso','Saúde','Ausência','Outros'].map((value) => `<option>${value}</option>`).join('')}</select></label>
    <label data-event-field="description"><span>Descrição do evento</span><textarea name="description" rows="2" maxlength="1000" placeholder="Descreva o evento"></textarea></label>
    <label data-event-field="delayMultiple"><span>Múltiplo do atraso</span><select name="delayMultiple"><option value="">Selecione</option>${Array.from({length: 7}, (_, index) => `<option value="${index}">${index}</option>`).join('')}</select></label>
    <label data-event-field="substitute"><span>Substituto</span><select name="substitute"><option value="">Selecione</option></select></label><label data-event-field="shift"><span>Turno</span><select name="shift"><option value="">Selecione</option><option>Manhã</option><option>Tarde</option><option>Integral</option></select></label>
    <label><span>Pagador</span><select name="payer" required><option value="">Selecione</option></select></label><label><span>Credor</span><select name="creditor" required><option value="">Selecione</option></select></label>
    <label><span>Valor a pagar</span><input name="amountToPay" type="number" required min="0" step="0.01" inputmode="decimal" placeholder="R$ 0,00"></label></div>
    <p id="event-members-missing" class="empty-state" hidden>O catálogo de siglas está vazio. Cadastre siglas em Etiquetas ou sincronize contatos ativos em Pessoas.</p>
    <p id="event-catalog-stale" class="record-meta" role="status" hidden></p>
    <input name="editEventId" type="hidden"><input name="editEventVersion" type="hidden"><div class="admin-user-actions"><button class="primary-button" type="submit">Salvar evento</button><button class="secondary-button" id="event-edit-cancel" type="button" hidden>Cancelar edição</button></div><p id="event-form-status" class="record-meta" role="status" aria-live="polite"></p><button class="secondary-button" id="event-conflict-refresh" type="button" hidden>Atualizar relatório para comparar</button></form><footer class="event-launch-footer"><form method="dialog"><button class="secondary-button" id="event-launch-back" type="submit" aria-label="Voltar ao app">Voltar</button></form></footer></dialog>`;
  }
  if (route === 'admin' && can('eventsCatalogManage')) return `<details class="quick-form"><summary>Configurar opções de Eventos</summary><form id="event-catalog-form">
    <p class="record-meta">Pagadores e credores disponíveis no lançamento de Eventos.</p>
    <div class="form-grid"><label>Pagadores · um por linha<textarea name="payers" rows="4" maxlength="12000" placeholder="Uma opção por linha"></textarea></label><label>Credores · um por linha<textarea name="creditors" rows="4" maxlength="12000" placeholder="Uma opção por linha"></textarea></label></div>
    <button class="secondary-button" type="submit">Salvar opções</button><p id="event-catalog-status" class="record-meta" role="status" aria-live="polite"></p></form></details>`;
  if (route === 'training' && can('trainingsManage')) return `<details class="quick-form"><summary>Gerenciar catálogo de treinamentos</summary><form id="training-catalog-form">
    <div class="form-grid"><label>Título<input name="title" required maxlength="120"></label><label>Link do YouTube<input name="videoUrl" type="url" required maxlength="600" placeholder="https://youtu.be/…"></label>
    <label>Descrição<input name="description" maxlength="500"></label><label>Pontos de acesso<input name="accessPoints" type="number" min="0" max="1000" step="0.01" value="0" required></label>
    <label>Pontos de conclusão<input name="completionPoints" type="number" min="0" max="1000" step="0.01" value="0" required></label><label>Ordem<input name="order" type="number" min="0" max="9999" step="1" value="0" required></label>
    <label class="contact-active-field"><input name="active" type="checkbox" checked> Treinamento ativo</label></div><input name="trainingId" type="hidden">
    <div class="admin-user-actions"><button class="primary-button" type="submit">Salvar treinamento</button><button class="secondary-button" id="training-edit-cancel" type="button">Novo treinamento</button></div><p id="training-catalog-status" class="record-meta" role="status" aria-live="polite"></p></form>
    <div id="training-admin-list" class="module-content"><p class="loading">Carregando catálogo…</p></div></details><details class="quick-form"><summary>Gerenciar atividades de aprendizagem</summary><form id="learning-activity-form">
    <div class="form-grid"><label>Título<input name="title" required maxlength="120"></label><label>Categoria<input name="category" maxlength="60" placeholder="Comunicado, orientação…"></label>
    <label class="form-span">Descrição<textarea name="description" rows="3" maxlength="500"></textarea></label><label>Tipo de atividade<select name="sourceKind"><option value="EXTERNAL_LINK">Link externo</option><option value="GOOGLE_FORM">Formulário Google · sem validar envio</option><option value="SHEET">Planilha · somente abrir</option><option value="DOCUMENT">Documento do Drive · somente abrir</option><option value="PDF">PDF · somente abrir</option><option value="QUIZ">Quiz externo · sem validar resultado</option><option value="SURVEY">Pesquisa externa · sem validar resposta</option><option value="ACKNOWLEDGEMENT">Ciência SAHMT · sem link</option></select></label><label>Link HTTPS<input name="resourceUrl" type="url" maxlength="600" placeholder="https://…"></label>
    <label>Conclusão<select name="completionKind"><option value="NONE">Sem conclusão rastreada</option><option value="ACKNOWLEDGEMENT">Confirmar ciência</option></select></label><small class="record-meta form-span">Formulários, documentos, quizzes e pesquisas abrem no serviço de origem; respostas e resultados não são verificados neste fluxo.</small>
    <label>Público<select name="audienceType"><option value="ALL">Todos</option><option value="ROLE">Função</option><option value="USER">UID específico</option></select></label>
    <label class="learning-audience-value" hidden>Função ou UID<input name="audienceValue" maxlength="128"></label><label>Começa<input name="startAt" type="date" required value="${todayInputValue()}"></label><label>Termina<input name="endAt" type="date" required value="${todayInputValue()}"></label>
    <label>Recorrência<select name="recurrenceMode"><option value="ONCE">Uma vez</option><option value="ONCE_PER_VERSION">Uma vez por versão</option></select></label><label>Ordem<input name="order" type="number" min="0" max="9999" step="1" value="0" required></label>
    <label class="contact-active-field"><input name="showInTraining" type="checkbox" checked> Mostrar em Treinamentos</label><label class="contact-active-field"><input name="active" type="checkbox" checked> Publicada</label></div><input name="activityId" type="hidden">
    <div class="admin-user-actions"><button class="primary-button" type="submit">Salvar atividade</button><button class="secondary-button" id="learning-activity-reset" type="button">Nova atividade</button></div><p id="learning-activity-status" class="record-meta" role="status" aria-live="polite"></p></form>
    <div id="learning-activity-admin-list" class="module-content"><p class="loading">Carregando atividades…</p></div></details>`;
  if (route === 'labels' && (can('labelsWrite') || can('labelsManage'))) return `<section class="label-workspace" aria-label="Ações de Etiquetas"><div class="label-action-grid"><button class="primary-button${renderLabelCameraConfirmation() ? ' label-camera--has-status' : ''}" type="button" id="label-camera-open"><span class="label-camera-label">ABRIR CÂMERA</span>${renderLabelCameraConfirmation()}</button><input id="label-image-file" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" tabindex="-1" aria-label="Capturar imagem da etiqueta"><button class="secondary-button${renderLabelManualConfirmation() ? ' label-manual--has-status' : ''}" type="button" id="label-manual-open"><span>REGISTRO MANUAL</span>${renderLabelManualConfirmation()}</button></div><p id="label-ai-status" class="sr-only" role="status" aria-live="polite">${labelAiEnabled ? 'Abra a câmera e toque em Capturar e Ler Etiqueta.' : 'Leitura por IA desativada. Você pode continuar pelo registro manual.'}</p><dialog class="label-camera-dialog" id="label-camera-dialog" aria-labelledby="label-camera-title"><header><div><h3 id="label-camera-title">CAPTURAR ETIQUETA</h3></div><button class="secondary-button" id="label-camera-close" type="button">Fechar</button></header><p id="label-camera-status" role="status" aria-live="polite">Centralize a etiqueta na moldura.</p><div class="label-camera-stage"><video id="label-camera-video" playsinline muted></video><div class="label-camera-target" aria-hidden="true"><span>Centralize a etiqueta</span></div></div><button class="primary-button" id="label-camera-capture" type="button" disabled>CAPTURAR E LER ETIQUETA</button></dialog></section><dialog class="label-entry-dialog" id="label-entry-dialog" aria-labelledby="label-entry-title"><header><h3 id="label-entry-title">REGISTRO DE ETIQUETA</h3><button class="secondary-button" type="button" id="label-entry-close" aria-label="Fechar registro">Fechar</button></header><form data-module-form="labels" autocomplete="off" novalidate><div class="form-grid"><label class="label-entry-date"><input name="date" type="date" value="${todayInputValue()}" readonly required aria-readonly="true" aria-label="Data da leitura, preenchida automaticamente"></label><label class="label-entry-patient"><span>Nome do Paciente</span><input name="patientName" autocomplete="off" required maxlength="160"></label><label class="label-entry-insurance" data-label-field="insurance"><span>Convênio</span><input name="insurance" maxlength="120"></label><label class="label-entry-attendance"><span>Atendimento</span><input name="encounterCode" inputmode="numeric" required maxlength="80"></label><label class="label-entry-procedure" data-label-field="procedure"><span>Cirurgia</span><input name="procedureCode" inputmode="numeric" maxlength="80"></label><label class="label-entry-type"><span>Tipo</span><select name="type" required><option value="">Selecione</option><option>Particular</option><option>Complementação</option><option>Convênio</option><option>Consulta Pré-anestésica</option><option>SADT</option></select></label><label class="label-entry-creditor"><span>Credor</span><select name="creditor" required><option value="">Selecione</option><option>Caixa</option><option>Plantão</option><option>Plantão/Caixa</option></select></label><label class="label-entry-amount" data-label-field="amount" hidden><span>Valor em Real · opcional</span><input name="amount" inputmode="decimal" placeholder="R$ 0,00" maxlength="32"></label><div class="label-staff-field" data-label-field="staff"><label class="label-staff-heading"><span>PLANTONISTAS</span><input name="staffSiglas" type="text" readonly placeholder="Selecione abaixo" aria-label="Siglas dos plantonistas selecionados" aria-live="polite"></label><div id="label-staff-options" class="label-staff-options" role="group" aria-label="Selecionar plantonistas"></div></div></div><input name="editLabelId" type="hidden"><input name="editLabelVersion" type="hidden"><div class="admin-user-actions"><button class="primary-button" type="submit">Salvar registro</button><button class="secondary-button" id="label-edit-cancel" type="button" hidden>Cancelar edição</button></div><p id="label-form-status" class="record-meta" role="status" aria-live="polite"></p><button class="secondary-button" id="label-conflict-refresh" type="button" hidden>Atualizar relatório para comparar</button></form></dialog>`;  if (route === 'checklist' && (can('checklistRead') || can('checklistWrite') || can('checklistManage'))) return '';
  if (route === 'management' && (can('managementActivityWrite') || can('qualityManage'))) return `<details class="quick-form" open><summary>Nova atividade</summary><form data-module-form="activity">
    <div class="form-grid"><label>Área de Gestão<select name="managementAreaId" id="activity-area" required><option value="">Carregando áreas…</option></select></label><label>Título<input name="title" required maxlength="160"></label>
    <label>Prazo<input name="dueAt" type="date"></label><label>Prioridade<select name="priority"><option>Normal</option><option>Alta</option><option>Urgente</option></select></label>${can('managementManage') ? '<label>UID(s) de responsáveis da equipe · um por linha<textarea name="responsibleUids" rows="3" maxlength="2600" placeholder="UID Firebase cadastrado como membro da área" required></textarea></label><label>Participantes da equipe · um UID por linha<textarea name="participantUids" rows="2" maxlength="13000" placeholder="Opcional · podem comentar, não iniciar ou concluir"></textarea></label><label class="contact-active-field"><input name="pointsEnabled" type="checkbox"> Pontuar quando o responsável concluir (exige um único responsável)</label>' : ''}</div>
    <label>Descrição<textarea name="description" rows="3" maxlength="1200"></textarea></label><button class="primary-button" type="submit">Criar atividade</button></form></details>`;
  if (route === 'notifications' && can('notificationsManage')) return `<details class="quick-form" open><summary>Novo comunicado</summary><form data-module-form="notifications">
    <div class="form-grid"><label>Título<input name="title" required maxlength="120"></label><label>Tipo<select name="type"><option value="INFO">Informação</option><option value="WARNING">Atenção</option><option value="ACTION">Ação</option></select></label><label>Público<select name="audienceType" id="notification-audience"><option value="ALL">Todos</option><option value="ROLE">Função</option><option value="USER">UID</option><option value="SIGLA">Sigla</option><option value="MANAGEMENT_AREA">Área de Gestão</option><option value="GROUP">Grupo</option></select></label><label id="notification-audience-value-wrap" hidden>Identificador do público<input name="audienceValue" maxlength="128"></label><label>Início<input name="startAt" type="date" required value="${todayInputValue()}"></label><label>Fim<input name="endAt" type="date" required value="${todayInputValue()}"></label><label>Prioridade<select name="priority"><option value="0">Normal</option><option value="1">Baixa</option><option value="2">Média</option><option value="3">Alta</option><option value="4">Urgente</option><option value="5">Crítica</option></select></label><label>Ação ao abrir<select name="actionRoute"><option value="">Nenhuma</option><option value="events">Eventos</option><option value="labels">Etiquetas</option><option value="management">Gestão</option><option value="checklist">Checklist</option><option value="training">Desempenho</option></select></label></div>
    <label>Mensagem<textarea name="message" rows="3" required maxlength="1200"></textarea></label><button class="primary-button" type="submit">Publicar comunicado</button></form></details>`;
  if (route === 'people' && can('peopleManage')) return `<details class="quick-form" open><summary>Cadastro de contato</summary><form data-module-form="people">
    <div class="form-grid"><label>Sigla<input name="sigla" required pattern="(?:[A-Z]{2}|L2)" maxlength="2" autocomplete="off"></label><label>Nome<input name="name" required maxlength="120"></label>
    <label>Função<input name="role" maxlength="80"></label><label>Telefone<input name="phone" type="tel" maxlength="40"></label><label>E-mail<input name="email" type="email" maxlength="200"></label><label>Link WhatsApp<input name="whatsAppLink" type="url" maxlength="250" placeholder="https://wa.me/5511999999999"></label><label>CRM<input name="crm" maxlength="40"></label><label>Data de entrada<input name="entryDate" maxlength="32" placeholder="DD/MM/AAAA"></label></div>
    <label class="contact-active-field"><input name="active" type="checkbox" checked> Contato ativo</label><div class="admin-user-actions"><button class="primary-button" type="submit">Salvar contato</button><button class="secondary-button" id="contact-reset" type="button">Novo contato</button></div></form></details><details class="quick-form contact-import-panel"><summary>Atualizar cadastros da equipe</summary><p class="record-meta">Importa somente sigla, nome, e-mail, telefone e situação ativa. Os demais campos do contato e as permissões dos usuários são preservados.</p><label>Arquivo CSV com as cinco colunas selecionadas<input id="contact-import-file" type="file" accept=".csv,text/csv"></label><div class="admin-user-actions"><button class="secondary-button" id="contact-import-preview" type="button">Conferir arquivo</button><button class="primary-button" id="contact-import-confirm" type="button" hidden disabled>Atualizar cadastros no Firestore</button></div><p id="contact-import-status" class="record-meta" role="status" aria-live="polite"></p></details>`;
  return '';
}

function shellView() {
  const route = currentRoute();
  const profile = session.profile;
  const title = route === 'home' ? 'SAHMT' : labels[route]?.[0] || 'SAHMT';
  const checklistVisual = route === 'checklist' ? `<div class="checklist-visual-frame"><figure class="checklist-visual"><figcaption>Arsenal Anestésico</figcaption><img src="${import.meta.env.BASE_URL}assets/carrinho-anestesia-checklist-v2.jpg" alt="Arsenal anestésico com indicadores dos itens de verificação" loading="lazy" decoding="async"></figure></div>` : '';
  const utilityCards = route === 'management' ? managementUtilityCards() : '';
  const managementUtilities = utilityCards ? `<section class="management-utilities" aria-label="Outras áreas de Gestão"><div class="module-grid">${utilityCards}</div></section>` : '';
  const eventReport = route === 'events' && (can('eventsRead') || can('eventsWrite')) ? `<div class="event-report-launchers" aria-label="Abrir relatórios de eventos"><button type="button" data-event-report-launch="daily">RELATÓRIO DIÁRIO</button><button type="button" data-event-report-launch="monthly">RELATÓRIO MENSAL</button></div><dialog class="event-report event-report-dialog" id="event-report-dialog" aria-label="Relatórios de eventos"><header class="event-report-dialog__header"><h2 id="event-report-dialog-title">RELATÓRIO ${eventReportMode === 'daily' ? 'DIÁRIO' : 'MENSAL'}</h2><form method="dialog"><button class="secondary-button" type="submit">Fechar</button></form></header><p id="event-report-sync" class="label-report-sync" role="status" aria-live="polite">Atualizando</p><div id="event-day-control" class="report-period event-day-control" ${!eventReportOpen || eventReportMode !== 'daily' ? 'hidden' : ''}><label>Data do relatório<input type="date" id="event-report-day" value="${todayInputValue()}"></label></div><div id="event-month-control" class="report-period event-month-control" ${!eventReportOpen || eventReportMode !== 'monthly' ? 'hidden' : ''}><label>Mês<input type="month" id="event-report-month" value="${todayInputValue().slice(0, 7)}"></label></div><div id="event-report-results" class="module-content" aria-live="polite" ${eventReportOpen ? '' : 'hidden'}></div><footer class="monthly-report-footer event-report-footer" id="event-report-footer" ${!eventReportOpen || eventReportMode !== 'monthly' ? 'hidden' : ''}><button class="secondary-button" type="button" id="share-events-pdf" disabled>PDF / WhatsApp</button></footer></dialog>` : '';
  const eventSchedule = route === 'events' && (can('eventsRead') || can('eventsWrite')) ? `<section class="event-schedule panel" aria-label="Escala de Eventos"><header class="event-schedule-heading"><label class="date-picker">DATA<input type="date" id="event-schedule-date" value="${todayInputValue()}"></label></header><nav class="schedule-day-nav" aria-label="Navegar pela escala de Eventos"><button class="secondary-button" id="event-schedule-previous" type="button">Anterior</button><button class="primary-button" id="event-schedule-today" type="button">Hoje</button><button class="secondary-button" id="event-schedule-next" type="button">Próximo</button></nav><div id="event-schedule-content" class="schedule-content" aria-live="polite"><p class="loading">Carregando escala…</p></div></section>` : '';
  const checklistCalendar = '';
  const checklistQrLauncher = route === 'checklist' && can('checklistWrite') ? `<button class="checklist-qr-launcher" id="checklist-scan-qr" type="button" aria-label="Abrir leitor de QR Code"><svg viewBox="0 0 64 64" role="img" aria-label="Imagem de QR Code"><path d="M5 5h20v20H5zM39 5h20v20H39zM5 39h20v20H5zM31 31h8v8h-8zM43 31h6v6h-6zM53 31h6v12h-6zM31 43h6v6h-6zM41 41h8v8h-8zM53 49h6v10h-6zM31 53h6v6h-6zM39 53h10v6H39z" fill="currentColor"/><path d="M10 10h10v10H10zM44 10h10v10H44zM10 44h10v10H10z" fill="var(--paper,#fffaf0)"/></svg><span>LER QR Code</span></button>` : '';
  const checklistReportLaunchers = route === 'checklist' ? `<div class="event-report-launchers checklist-report-launchers" aria-label="Relatórios do Checklist"><button type="button" data-checklist-report-launch="daily">RELATÓRIO DIÁRIO</button><button type="button" data-checklist-report-launch="monthly">RELATÓRIO MENSAL</button></div>` : '';
  const checklistReportDialog = route === 'checklist' ? `<dialog class="checklist-report-dialog" id="checklist-report-dialog" aria-label="Relatórios do Checklist"><header class="checklist-report-dialog__header"><h2 id="checklist-report-title" tabindex="-1" autofocus>RELATÓRIO DIÁRIO - CHECKLIST</h2></header><div class="checklist-report-periods"><section class="checklist-report-calendar" id="checklist-day-control" ${checklistReportMode !== 'daily' ? 'hidden' : ''}><input id="checklist-report-day" type="date" value="${todayInputValue()}" max="${todayInputValue()}" aria-label="Data do relatório"><nav class="schedule-day-nav" aria-label="Navegar pelos dias do relatório"><button class="secondary-button" id="checklist-report-previous" type="button">Anterior</button><button class="primary-button" id="checklist-report-today" type="button">Hoje</button><button class="secondary-button" id="checklist-report-next" type="button">Próximo</button></nav></section><section class="checklist-report-month" id="checklist-month-control" ${checklistReportMode !== 'monthly' ? 'hidden' : ''}><label>MÊS DE REFERÊNCIA<input id="checklist-month" type="month" value="${todayInputValue().slice(0, 7)}" max="${todayInputValue().slice(0, 7)}"></label></section><p class="checklist-report-sync" id="checklist-report-sync" role="status" aria-live="polite"><span aria-hidden="true"></span> Aguardando relatório</p></div><div id="module-content" class="module-content checklist-report-content" aria-live="polite"><p class="loading">Abra o relatório para carregar as estações…</p></div><footer class="checklist-report-footer"><form method="dialog"><button class="secondary-button" type="submit">Voltar</button></form></footer></dialog>` : '';
  const labelReport = route === 'labels' ? `<div class="event-report-launchers label-report-launchers" aria-label="Abrir relatórios de Etiquetas"><button type="button" data-label-report-launch="daily">RELATÓRIO DIÁRIO</button><button type="button" data-label-report-launch="monthly">RELATÓRIO MENSAL</button></div><dialog class="event-report event-report-dialog label-report label-report-dialog" id="label-report-dialog" aria-label="Relatórios de Etiquetas"><header class="event-report-dialog__header label-report-header"><img src="${import.meta.env.BASE_URL}assets/sahmt-logo.png" alt="SAHMT" width="48" height="48"><div class="label-report-heading"><h2 id="label-report-dialog-title">RELATÓRIO ${labelReportMode === 'daily' ? 'DIÁRIO - ETIQUETAS' : 'MENSAL - ETIQUETAS'}</h2><p>${escapeHtml(session.profile?.displayName || session.user?.displayName || 'Usuário')}</p><div id="label-report-sync" class="label-report-sync" role="status" aria-live="polite">Verificando sincronização</div></div><form method="dialog"><button class="secondary-button" type="submit">Fechar</button></form></header><div id="label-day-control" class="report-period event-day-control label-day-control" ${!labelReportOpen || labelReportMode !== 'daily' ? 'hidden' : ''}><label>DATA DOS REGISTROS<input type="date" id="label-report-day" value="${todayInputValue()}"></label></div><div id="label-month-control" class="report-period event-month-control label-month-control" ${!labelReportOpen || labelReportMode !== 'monthly' ? 'hidden' : ''}><label>Mês<input type="month" id="label-report-month" value="${todayInputValue().slice(0, 7)}"></label></div><div id="label-report-results" class="module-content" aria-live="polite" ${labelReportOpen ? '' : 'hidden'}></div><footer class="monthly-report-footer label-report-footer" id="label-report-footer" ${!labelReportOpen || labelReportMode !== 'monthly' ? 'hidden' : ''}><button class="secondary-button" type="button" id="share-labels-pdf" disabled>PDF / WhatsApp</button></footer></dialog>` : '';  const view = route === 'home' ? `<section class="content-grid">
      <article class="schedule-card panel"><div class="schedule-date-block"><header class="panel-heading schedule-date-heading"><label class="date-picker"><span class="sr-only">Data da escala</span><input type="date" id="schedule-date"></label></header>
        <nav class="schedule-day-nav" aria-label="Navegar pela escala"><button class="secondary-button" id="schedule-previous" type="button" aria-label="Dia anterior">Anterior</button><button class="primary-button" id="schedule-today" type="button">Hoje</button><button class="secondary-button" id="schedule-next" type="button" aria-label="Próximo dia">Próximo</button></nav></div>
        <div id="schedule-content" class="schedule-content"><p class="loading">Carregando escala…</p></div>
      </article>
      <section class="modules-section"><div class="module-grid">${moduleCards()}</div></section>
    </section>` : `<section class="module-view panel${route === 'events' ? ' module-view--events' : route === 'labels' ? ' module-view--labels' : route === 'checklist' ? ' module-view--checklist' : ''}">${route === 'events' || route === 'labels' || route === 'checklist' || route === 'management' || route === 'training' ? '' : `<p class="eyebrow">SAHMT</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(labels[route]?.[1] || 'Área administrativa do SAHMT.')}</p>`}${route === 'checklist' ? checklistCalendar : ''}${route === 'checklist' ? '' : checklistVisual}${managementUtilities}${eventSchedule}${route === 'checklist' || route === 'labels' || route === 'management' || route === 'training' ? '' : actionForm(route)}${route === 'checklist' ? '' : eventReport}${route === 'checklist' || route === 'labels' ? '' : labelReport}${route === 'checklist' ? `${checklistVisual}${checklistQrLauncher}${checklistReportLaunchers}${checklistReportDialog}` : route === 'labels' ? `${actionForm(route)}${labelReport}` : '<div id="module-content" class="module-content"><p class="loading">Carregando informações…</p></div>'}<button class="secondary-button${route === 'events' ? ' events-home-button' : route === 'labels' ? ' labels-home-button' : route === 'checklist' ? ' checklist-home-button' : ''}" data-route="home">${route === 'events' || route === 'checklist' ? 'HOME' : route === 'labels' ? 'HOME' : 'Voltar para Home'}</button></section>`;
  return `<div class="app-shell${route === 'home' ? ' app-shell--home' : ''}${route === 'events' ? ' app-shell--events' : route === 'labels' ? ' app-shell--labels' : route === 'checklist' ? ' app-shell--checklist' : route === 'management' ? ' app-shell--management' : route === 'training' ? ' app-shell--training' : ''}">
    <header class="topbar"><div class="identity-card"><button class="brand" data-route="home" aria-label="Voltar ao início"><img src="${import.meta.env.BASE_URL}assets/sahmt-logo.png" alt=""><span>SAHMT</span></button><div class="identity-card__user-row"><div class="identity-card__user">${escapeHtml(profile.displayName || session.user.displayName || 'Usuário')}</div><div class="sync-pill" id="outbox-status" role="status"></div></div>${route === 'events' ? '<h2 class="events-header-operational"><span>EVENTOS</span><small>Operacional</small></h2>' : route === 'labels' ? '<h2 class="events-header-operational">ETIQUETAS</h2>' : route === 'checklist' ? '<h2 class="events-header-operational checklist-title">CHECKLIST</h2>' : route === 'training' ? '<h2 class="events-header-operational training-title">DESEMPENHO</h2>' : route === 'home' ? '<h2 class="home-header-scale">ESCALA</h2>' : route === 'management' ? '<h2 class="events-header-operational">GESTÃO</h2>' : ''}</div></header>
    <main class="main-content">${route === 'home' || route === 'events' || route === 'labels' || route === 'checklist' || route === 'management' || route === 'training' ? '' : `<div class="page-title${route === 'labels' ? ' page-title--labels' : route === 'checklist' ? ' page-title--checklist' : ''}">${route === 'labels' || route === 'checklist' ? '' : '<p class="eyebrow">GESTÃO RESPONSÁVEL</p>'}<h1>${route === 'checklist' ? 'CHECKLIST' : escapeHtml(title)}</h1></div>`}${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ''}${view}</main>
    <dialog class="checklist-qr-dialog" id="checklist-qr-dialog" aria-label="Leitor QR do Checklist"><div class="checklist-qr-container"><div class="checklist-qr-stage"><video id="checklist-qr-video" playsinline muted hidden></video><div class="checklist-qr-focus" id="checklist-qr-focus" hidden aria-hidden="true"></div></div><p id="checklist-qr-status" role="status" aria-live="polite" hidden></p><button class="secondary-button" id="checklist-qr-close" type="button" autofocus>Voltar</button></div></dialog><dialog class="checklist-station-dialog" id="checklist-station-dialog" aria-labelledby="checklist-station-title"><div id="checklist-station-actions" class="checklist-station-banner-actions"><section class="checklist-station-block checklist-station-block--status" aria-labelledby="checklist-station-title"><header><h3 id="checklist-station-title" tabindex="-1">Checklist da estação</h3></header><section id="checklist-station-result" class="checklist-station-result"></section><div id="checklist-station-responses"></div><div id="checklist-station-checker"></div></section><div id="checklist-station-controls"></div></div><p id="checklist-station-status" role="status" aria-live="polite"></p><form method="dialog" class="checklist-station-footer"><button class="secondary-button" id="checklist-station-close" type="submit">Voltar</button></form></dialog>
    <dialog class="schedule-contact-dialog" id="schedule-contact-dialog" aria-labelledby="schedule-contact-heading"><div id="schedule-contact-details"><h3 id="schedule-contact-heading">Contato</h3></div><form method="dialog"><button class="secondary-button" type="submit">Fechar</button></form></dialog>
    <dialog class="schedule-contact-dialog" id="event-schedule-choice-dialog" aria-labelledby="event-schedule-choice-title"><h3 id="event-schedule-choice-title">Escolha o anestesiologista</h3><p class="record-meta">Esta posição da escala reúne mais de uma sigla.</p><div id="event-schedule-choice-options" class="event-schedule-choice-options"></div><form method="dialog"><button class="secondary-button" type="submit" value="cancel">Cancelar</button></form></dialog>
    <footer class="app-footer">SAHMT · Hospital e equipe</footer>
  </div>`;
}

async function loadHome() {
  const dateInput = document.querySelector('#schedule-date');
  const content = document.querySelector('#schedule-content');
  if (!dateInput || !content) return;
  dateInput.value = localDateKey();
  let requestSequence = 0;
  let contacts = [];
  let contactsCacheAt = 0;
  let contactsRequest = null;
  const vacationsCache = new Map();
  const renderSchedule = (schedule, selectedDate, selectedVacations, selectedContacts, syncState = '') => {
    if (!schedule) {
      content.innerHTML = '<p class="empty-state">Nenhuma escala publicada para esta data.</p>';
      return;
    }
    const scheduleView = buildScheduleView(schedule, selectedDate, selectedVacations, selectedContacts);
    const grid = scheduleView.positions.length ? renderSchedulePositionGrid(scheduleView, {mode: 'home', schedule, eventsWritable: can('eventsWrite')}) : '';
    content.innerHTML = `${syncState}${schedule.stale ? '<p class="sync-state">Mostrando a última escala salva neste aparelho.</p>' : ''}${grid || '<p class="empty-state">A escala está publicada sem itens.</p>'}`;
    content.querySelectorAll('[data-schedule-position-index]').forEach((button) => button.addEventListener('click', () => {
      const position = scheduleView.positions[Number(button.dataset.schedulePositionIndex)];
      if (position) showScheduleContacts(position.contacts || [], {
        sigla: position.sigla,
        date: selectedDate,
        groupSiglas: position.contacts.map((contact) => String(contact.sigla || '').toUpperCase()),
        highlightedSiglas: Array.isArray(schedule.highlights?.siglas) ? schedule.highlights.siglas : [],
        canRelease: can('scheduleWrite'),
        onRelease: () => void render()
      });
    }));
  };
  const render = async () => {
    const requestId = ++requestSequence;
    const selectedDate = dateInput.value;
    if (!selectedDate) return;
    content.innerHTML = '<p class="loading">Carregando escala…</p>';
    let schedule = null;
    let selectedContacts = contacts;
    let selectedVacations = [];
    let schedulePending = true;
    let scheduleError = false;
    let contactsError = false;
    let vacationsError = false;
    const draw = () => {
      if (requestId !== requestSequence || !content.isConnected) return;
      const messages = [];
      if (schedulePending && schedule) messages.push('<p class="sync-state">Atualizando a escala…</p>');
      if (scheduleError && schedule) messages.push('<p class="sync-state">Não foi possível atualizar; exibindo a última escala salva.</p>');
      if (contactsError) messages.push('<p class="sync-state">Contatos indisponíveis; a escala continua acessível.</p>');
      else if (selectedContacts.stale || selectedContacts.some((contact) => contact.stale)) messages.push('<p class="sync-state">Contatos carregados do cache deste aparelho.</p>');
      if (vacationsError) messages.push('<p class="sync-state">Férias indisponíveis para esta data.</p>');
      else if (selectedVacations.stale || selectedVacations.some((vacation) => vacation.stale)) messages.push('<p class="sync-state">Férias carregadas do cache deste aparelho.</p>');
      if (!schedule && schedulePending) {
        content.innerHTML = `${messages.join('')}<p class="loading">Carregando escala…</p>`;
        return;
      }
      if (!schedule && scheduleError) {
        content.innerHTML = `${messages.join('')}<p class="empty-state">Não foi possível carregar a escala.</p>`;
        return;
      }
      renderSchedule(schedule, selectedDate, selectedVacations, selectedContacts, messages.join(''));
    };
    try {
      try {
        const cachedSchedule = await readCachedSchedule(session.user.uid, selectedDate);
        if (cachedSchedule && requestId === requestSequence && content.isConnected) {
          schedule = cachedSchedule;
          draw();
        }
      } catch {}
      const {readSchedule, listActiveContacts, listVacationsForDate} = await import('./data-lite.js');
      const readContacts = () => {
        if (contactsCacheAt && Date.now() - contactsCacheAt < 30_000) return Promise.resolve(contacts);
        if (!contactsRequest) contactsRequest = listActiveContacts({uid: session.user.uid, pageSize: 200})
          .then((items) => { contacts = items; contactsCacheAt = Date.now(); return items; })
          .finally(() => { contactsRequest = null; });
        return contactsRequest;
      };
      const readVacations = () => {
        const cached = vacationsCache.get(selectedDate);
        if (cached && Date.now() - cached.at < 30_000) return Promise.resolve(cached.items);
        return listVacationsForDate(selectedDate, {uid: session.user.uid}).then((items) => {
          vacationsCache.set(selectedDate, {items, at: Date.now()});
          if (vacationsCache.size > 40) vacationsCache.delete(vacationsCache.keys().next().value);
          return items;
        });
      };
      void readSchedule(selectedDate, session.user.uid).then((value) => {
        if (requestId !== requestSequence || !content.isConnected) return;
        schedule = value;
        schedulePending = false;
        draw();
      }).catch(() => {
        if (requestId !== requestSequence || !content.isConnected) return;
        schedulePending = false;
        scheduleError = true;
        draw();
      });
      void readContacts().then((items) => {
        if (requestId !== requestSequence || !content.isConnected) return;
        contacts = items;
        selectedContacts = items;
        draw();
      }).catch(() => {
        if (requestId !== requestSequence || !content.isConnected) return;
        contactsError = true;
        draw();
      });
      void readVacations().then((items) => {
        if (requestId !== requestSequence || !content.isConnected) return;
        selectedVacations = items;
        draw();
      }).catch(() => {
        if (requestId !== requestSequence || !content.isConnected) return;
        vacationsError = true;
        draw();
      });
    } catch (error) {
      if (requestId !== requestSequence || !content.isConnected) return;
      schedulePending = false;
      scheduleError = true;
      draw();
    }
  };
  document.querySelector('#schedule-previous')?.addEventListener('click', () => {
    dateInput.value = shiftDateKey(dateInput.value, -1);
    void render();
  });
  document.querySelector('#schedule-today')?.addEventListener('click', () => {
    dateInput.value = localDateKey();
    void render();
  });
  document.querySelector('#schedule-next')?.addEventListener('click', () => {
    dateInput.value = shiftDateKey(dateInput.value, 1);
    void render();
  });
  dateInput.addEventListener('change', render);
  await render();
}

function showScheduleContacts(contacts, context = {}) {
  const dialog = document.querySelector('#schedule-contact-dialog');
  const content = document.querySelector('#schedule-contact-details');
  if (!dialog || !content) return;
  const siglaLabel = context.sigla || '';
  const records = contacts.filter((contact, index, all) => all.findIndex((item) => item.sigla === contact.sigla) === index);
  const cards = records.map((contact) => {
    const links = contactActionLinks(contact);
    const actions = `${links.whatsApp ? `<a class="contact-action" href="${escapeHtml(links.whatsApp)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}${links.phone ? `<a class="contact-action" href="tel:${links.phone}">Ligar</a>` : ''}${links.email ? `<a class="contact-action" href="mailto:${encodeURIComponent(links.email)}">Enviar e-mail</a>` : ''}`;
    const released = (context.highlightedSiglas || []).includes(String(contact.sigla || '').toUpperCase());
    const release = context.canRelease ? `<button class="contact-action schedule-release${released ? ' is-released' : ''}" type="button" data-release-sigla="${escapeHtml(contact.sigla)}" aria-pressed="${released}" aria-label="Liberar ${escapeHtml(contact.name)}">LIBERAR</button>` : '';
    return `<article class="schedule-contact-record">${records.length > 1 ? `<h4>${escapeHtml(contact.name)}</h4>` : ''}<div class="contact-detail-actions">${actions}${release}</div></article>`;
  }).join('');
  content.innerHTML = `<h3 id="schedule-contact-heading">${records.length > 1 ? 'Contatos vinculados' : escapeHtml(records[0]?.name || 'Contato')}</h3><p class="schedule-release-status" data-release-status role="status" aria-live="polite"></p>${cards || '<p class="empty-state">Nenhum contato encontrado para esta sigla.</p>'}`;
  content.querySelectorAll('[data-release-sigla]').forEach((button) => button.addEventListener('click', async () => {
    const status = content.querySelector('[data-release-status]');
    const marked = button.getAttribute('aria-pressed') !== 'true';
    button.disabled = true;
    if (status) status.textContent = 'Salvando…';
    try {
      const {setScheduleSiglaRelease} = await import('./data.js');
      const updated = await setScheduleSiglaRelease(context.date, button.dataset.releaseSigla, marked, {
        groupSiglas: context.groupSiglas,
        tokenSigla: context.sigla,
        uid: session.user.uid,
        currentSiglas: context.highlightedSiglas
      });
      context.highlightedSiglas = updated.highlights?.siglas || [];
      content.querySelectorAll('[data-release-sigla]').forEach((item) => {
        const itemMarked = context.highlightedSiglas.includes(String(item.dataset.releaseSigla || '').toUpperCase());
        item.setAttribute('aria-pressed', String(itemMarked));
        item.textContent = 'LIBERAR';
        item.classList.toggle('is-released', itemMarked);
        item.disabled = false;
      });
      if (status) status.textContent = updated.pendingFirestore
        ? 'Liberação salva neste aparelho; aguardando confirmação do Firestore.'
        : marked ? '' : 'Liberação removida para esta data.';
      context.onRelease?.();
    } catch {
      button.disabled = false;
      if (status) status.textContent = 'Não foi possível salvar a liberação. Confira a conexão e sua permissão para editar a escala.';
    }
  }));
  dialog.showModal();
}

async function loadModule(route) {
  const content = document.querySelector('#module-content');
  if (!content && route !== 'labels') return;
  if (!featureEnabledForRoute(route, appFeatures)) {
    navigate('home');
    return;
  }
  const contentPermissions = {training: ['trainingsRead', 'trainingsManage'], notifications: ['notificationsRead', 'notificationsManage']};
  if (contentPermissions[route] && !contentPermissions[route].some(can)) {
    content.innerHTML = '<p class="empty-state" role="status">Seu perfil ainda não tem acesso ao conteúdo desta área. Peça ao administrador para liberar a consulta.</p>';
    return;
  }
  if (route === 'offline') {
    await loadOfflineView(content);
    return;
  }
  if (route === 'training') {
    const requestUid = session.user?.uid;
    const generation = evaluationModuleGeneration;
    const current = () => generation === evaluationModuleGeneration && content.isConnected && currentRoute() === 'training' &&
      session.status === 'signed-in' && session.user?.uid === requestUid && session.profile?.active === true && session.profile?.access === true &&
      featureEnabledForRoute('training', appFeatures) && (can('trainingsRead') || can('trainingsManage'));
    const {mountPerformanceModule} = await import('./performance-ui.js');
    if (!current()) return;
    cleanupCurrentModule = mountPerformanceModule(content, {uid: requestUid, profile: session.profile, isAdmin: () => can('admin'), canReviewSuggestions: () => can('managementManage') || can('qualityManage'), isCurrent: current,
      onOpenGovernance: () => { if (current() && featureEnabledForRoute('management', appFeatures)) navigate('management'); }});
    return;
  }
  if (route === 'management' && hasFinanceOnlyManagementAccess(session.profile)) {
    content.innerHTML = '<section class="management-area-detail"><header class="management-detail-heading"><div><p class="eyebrow">ACESSO RESTRITO</p><h3>Gestão Financeira</h3></div></header><p>Seu perfil tem acesso à área financeira. Os campos, relatórios e operações ainda não foram configurados; nenhum dado financeiro está disponível nesta versão.</p></section>';
    return;
  }
  if (route === 'events') {
    content.remove();
    if (can('eventsRead') || can('eventsWrite')) void loadReportPdfModule().catch(() => {});
    const reportDialog = document.querySelector('#event-report-dialog');
    reportDialog?.addEventListener('close', () => { eventReportOpen = false; closeReportLive('events'); });
    document.querySelectorAll('[data-event-report-launch]').forEach((button) => button.addEventListener('click', async () => {
      eventReportMode = button.dataset.eventReportLaunch;
      eventReportOpen = true;
      if (reportDialog && !reportDialog.open) reportDialog.showModal();
      const title = document.querySelector('#event-report-dialog-title');
      if (title) title.textContent = eventReportMode === 'daily' ? 'RELATÓRIO DIÁRIO' : 'RELATÓRIO MENSAL';
      const results = document.querySelector('#event-report-results');
      if (results) results.hidden = false;
      const reportDay = document.querySelector('#event-report-day');
      if (eventReportMode === 'daily' && reportDay) reportDay.value = document.querySelector('#event-schedule-date')?.value || todayInputValue();
      document.querySelector('#event-day-control').hidden = eventReportMode !== 'daily';
      document.querySelector('#event-month-control').hidden = eventReportMode !== 'monthly';
      document.querySelector('#event-report-footer').hidden = eventReportMode !== 'monthly';
      await loadEventReport();
    }));
    document.querySelector('#event-report-day')?.addEventListener('change', loadEventReport);
    document.querySelector('#event-report-month')?.addEventListener('change', loadEventReport);
    document.querySelector('#share-events-pdf')?.addEventListener('click', () => shareReportPdf('events'));
    document.querySelector('#event-edit-cancel')?.addEventListener('click', resetEventEditor);
    await loadEventEntryCatalog();
    bindEventSchedule();
    if (eventReportOpen) {
      if (reportDialog && !reportDialog.open) reportDialog.showModal();
      await loadEventReport();
    }
    else {
      const pdfButton = document.querySelector('#share-events-pdf');
      if (pdfButton) pdfButton.disabled = true;
    }
    if (pendingEventPosition) {
      const {day, position} = pendingEventPosition;
      pendingEventPosition = null;
      const scheduleDate = document.querySelector('#event-schedule-date');
      if (scheduleDate && scheduleDate.value !== day) {
        scheduleDate.value = day;
        scheduleDate.dispatchEvent(new Event('change'));
      }
      void launchEventFromSchedule(day, position);
    }
    return;
  }
  if (route === 'labels') {
    content?.remove();
    const reportDialog = document.querySelector('#label-report-dialog');
    reportDialog?.addEventListener('close', () => {
      labelReportOpen = false;
      closeReportLive('labels');
      labelReportLoad++;
      labelReportLoadingMore = false;
      labelReportState = 'idle';
      updateLabelReportSync();
    });
    document.querySelectorAll('[data-label-report-launch]').forEach((button) => button.addEventListener('click', async () => {
      labelReportMode = button.dataset.labelReportLaunch;
      labelReportOpen = true;
      if (reportDialog && !reportDialog.open) reportDialog.showModal();
      const title = document.querySelector('#label-report-dialog-title');
      if (title) title.textContent = labelReportMode === 'daily' ? 'RELATÓRIO DIÁRIO - ETIQUETAS' : 'RELATÓRIO MENSAL - ETIQUETAS';
      const results = document.querySelector('#label-report-results');
      if (results) results.hidden = false;
      const reportDay = document.querySelector('#label-report-day');
      if (labelReportMode === 'daily' && reportDay) reportDay.value = todayInputValue();
      document.querySelector('#label-day-control').hidden = labelReportMode !== 'daily';
      document.querySelector('#label-month-control').hidden = labelReportMode !== 'monthly';
      document.querySelector('#label-report-footer').hidden = labelReportMode !== 'monthly';
      await loadLabelReport();
    }));
    document.querySelector('#label-report-day')?.addEventListener('change', loadLabelReport);
    document.querySelector('#label-report-month')?.addEventListener('change', loadLabelReport);
    document.querySelector('#share-labels-pdf')?.addEventListener('click', () => shareReportPdf('labels'));
    if (labelReportOpen) {
      if (reportDialog && !reportDialog.open) reportDialog.showModal();
      await loadLabelReport();
    } else {
      const pdfButton = document.querySelector('#share-labels-pdf');
      if (pdfButton) pdfButton.disabled = true;
    }
    document.querySelector('#label-edit-cancel')?.addEventListener('click', resetLabelEditor);
    document.querySelector('#label-entry-close')?.addEventListener('click', resetLabelEditor);
    document.querySelector('#label-manual-open')?.addEventListener('click', () => {
      resetLabelEditor({keepOpen: true});
      const form = document.querySelector('[data-module-form="labels"]');
      if (form) form.dataset.labelEntrySource = 'manual';
      labelManualConfirmation = {uid: '', status: ''};
      const button = document.querySelector('#label-manual-open');
      button?.classList.remove('label-manual--has-status');
      button?.querySelector('[data-label-manual-confirmation]')?.remove();
      const dialog = document.querySelector('#label-entry-dialog');
      if (dialog?.showModal) dialog.showModal();
    });
    await loadLabelStaffCatalog();
    return;
  }
  if (route === 'admin') {
    await loadAdminModule(content);
    await loadEventEntryCatalog();
    bindEventCatalogForm();
    return;
  }
  if (route === 'people') {
    try {
      const {listContactCatalog} = await import('./data.js');
      const contacts = await listContactCatalog();
      content.innerHTML = `${contacts.length ? `<ul class="record-list">${contacts.map((item) => `<li><div class="contact-list-heading"><strong>${escapeHtml(item.sigla)} · ${escapeHtml(item.name)}</strong><button class="secondary-button" type="button" data-contact-edit="${escapeHtml(item.sigla)}">Editar</button></div><small>${escapeHtml(item.role || '')}${item.phone ? ` · ${escapeHtml(item.phone)}` : ''}</small><small class="record-meta">${item.active ? 'Ativo' : 'Inativo'}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhum contato cadastrado. Use o formulário acima para criar o catálogo inicial.</p>'}<button class="secondary-button" type="button" id="sync-event-members">Atualizar siglas de Eventos</button><p id="event-members-sync-status" class="record-meta" role="status" aria-live="polite"></p>`;
      content.querySelector('#sync-event-members')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const status = content.querySelector('#event-members-sync-status');
        button.disabled = true;
        if (status) status.textContent = 'Sincronizando somente sigla, nome e estado ativo…';
        try {
          const {syncEventMemberDirectory} = await import('./data.js');
          const count = await syncEventMemberDirectory(session.user.uid);
          if (status) status.textContent = `${count} contato(s) processado(s). O seletor de Eventos já pode usar as siglas ativas.`;
        } catch (error) {
          if (status) status.textContent = `Não foi possível atualizar o catálogo. ${error.message || ''}`;
          button.disabled = false;
        }
      });
      content.querySelectorAll('[data-contact-edit]').forEach((button) => button.addEventListener('click', () => {
        const contact = contacts.find((item) => item.sigla === button.dataset.contactEdit);
        const form = document.querySelector('[data-module-form="people"]');
        if (!contact || !form) return;
        for (const field of ['sigla', 'name', 'role', 'phone', 'email', 'whatsAppLink', 'crm', 'entryDate']) form.elements[field].value = contact[field] || '';
        form.elements.active.checked = contact.active === true;
        form.elements.sigla.readOnly = true;
        form.scrollIntoView({behavior: 'smooth', block: 'center'});
        form.elements.name.focus({preventScroll: true});
      }));
    } catch (error) {
      content.innerHTML = `<p class="empty-state">Não foi possível carregar os contatos. ${escapeHtml(error.message || '')}</p>`;
    }
    return;
  }
  if (route === 'notifications') {
    try {
      const {listNotifications} = await import('./data.js');
      const items = await listNotifications(session.profile, {canManage: can('notificationsManage')});
      const canAcknowledge = can('notificationsRead') && !can('notificationsManage');
      const unreadCount = items.filter((item) => !item.read).length;
      content.innerHTML = items.length ? `${canAcknowledge ? `<p class="sync-state" id="notification-read-summary">${unreadCount} comunicado(s) não lido(s).</p>` : ''}<ul class="record-list notification-list">${items.map((item) => `<li><div class="contact-list-heading"><strong>${escapeHtml(item.title)}</strong><small class="record-meta">${escapeHtml(item.type || 'INFO')} · prioridade ${escapeHtml(item.priority)}</small></div><p>${escapeHtml(item.message)}</p><small>${escapeHtml(interactionDateTime(item.createdAt))}${can('notificationsManage') ? ` · Público: ${escapeHtml(item.audienceType)}${item.audienceValue ? ` (${escapeHtml(item.audienceValue)})` : ''}` : ''}</small>${item.actionRoute ? `<button class="secondary-button" type="button" data-notification-route="${escapeHtml(item.actionRoute)}">Abrir área</button>` : ''}${canAcknowledge ? `<button class="secondary-button" type="button" data-notification-read="${escapeHtml(item.id)}" ${item.read ? 'disabled' : ''}>${item.read ? 'Lido' : 'Marcar como lido'}</button>` : ''}</li>`).join('')}</ul>` : '<p class="empty-state">Não há comunicados ativos para sua sessão.</p>';
      content.querySelectorAll('[data-notification-route]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.notificationRoute)));
      content.querySelectorAll('[data-notification-read]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const {markNotificationRead} = await import('./data.js');
          await markNotificationRead(button.dataset.notificationRead, session.user.uid);
          button.textContent = 'Lido';
          const remaining = content.querySelectorAll('[data-notification-read]:not(:disabled)').length;
          const summary = content.querySelector('#notification-read-summary');
          if (summary) summary.textContent = `${remaining} comunicado(s) não lido(s).`;
        } catch (error) {
          button.disabled = false;
          const message = document.createElement('small');
          message.className = 'form-error';
          message.textContent = error.message || 'Não foi possível confirmar a leitura.';
          button.after(message);
        }
      }));
    } catch (error) {
      content.innerHTML = `<p class="empty-state">Não foi possível carregar os comunicados. ${escapeHtml(error.message || '')}</p>`;
    }
    return;
  }
  try {
    const data = await import('./data.js');
    let items;
    if (route === 'management' && session.profile?.permissions?.qualityManage === true &&
      !['managementManage', 'managementRead', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage', 'documentsManage', 'equipmentManage'].some((permission) => session.profile?.permissions?.[permission] === true)) {
      const qualityArea = await data.getManagementArea('area-gestao-da-qualidade');
      items = qualityArea ? [qualityArea] : [];
    } else if (route === 'management' && !['managementManage', 'managementRead', 'managementActivityWrite', 'managementIndicatorsRead', 'managementIndicatorsWrite', 'managementPlansManage', 'documentsManage', 'equipmentManage', 'qualityManage', 'financeRead', 'financeWrite', 'financeManage'].some(can)) {
      items = [];
    } else {
      loadedTrainingCatalog = [];
      items = route === 'checklist' && checklistCatalogLive?.uid === session.user.uid ? [...checklistCatalogLive.records] : await data.listModuleRecords(route, session.user.uid, {pageSize: route === 'checklist' ? 200 : 50});
      if (route === 'checklist') checklistModuleStations = items;
    }
    if (route === 'checklist') {
      const reportDialog = document.querySelector('#checklist-report-dialog');
      reportDialog?.addEventListener('close', () => { checklistReportOpen = false; closeReportLive('checklist'); stopChecklistQrScanner(false); });
      const reportDay = document.querySelector('#checklist-report-day');
      const updateDayControls = (day) => {
        const value = day && day <= todayInputValue() ? day : todayInputValue();
        if (reportDay) reportDay.value = value;
        const next = document.querySelector('#checklist-report-next');
        if (next) next.disabled = value >= todayInputValue();
        const today = document.querySelector('#checklist-report-today');
        if (today) today.disabled = value === todayInputValue();
      };
      const setReportDay = (value) => {
        updateDayControls(value);
        if (checklistReportOpen && checklistReportMode === 'daily') void loadDailyChecklist(items, reportDay?.value || todayInputValue());
      };
      updateDayControls(todayInputValue());
      const scanButton = document.querySelector('#checklist-scan-qr');
      if (scanButton) scanButton.onclick = () => {
        const day = todayInputValue();
        const writableStations = items.filter((station) => stationIsInDateRange(station, day) && (can('checklistManage') || stationIsValidOn(station, day)));
        if (writableStations.length) void openChecklistQrScanner(writableStations, day);
        else {
          stopChecklistQrScanner();
          const status = document.querySelector('#checklist-qr-status');
          if (status) { status.hidden = false; status.textContent = 'Nenhuma estação disponível para leitura nesta data.'; }
          const dialog = document.querySelector('#checklist-qr-dialog');
          const close = document.querySelector('#checklist-qr-close');
          if (close) close.onclick = () => dialog?.close();
          dialog?.showModal();
        }
      };
      document.querySelectorAll('[data-checklist-report-launch]').forEach((button) => button.addEventListener('click', async () => {
        checklistReportMode = button.dataset.checklistReportLaunch === 'monthly' ? 'monthly' : 'daily';
        checklistReportOpen = true;
        updateDayControls(todayInputValue());
        if (reportDialog && !reportDialog.open) reportDialog.showModal();
        const title = document.querySelector('#checklist-report-title');
        title?.focus({preventScroll: true});
        if (title) title.textContent = checklistReportMode === 'monthly' ? 'RELATÓRIO MENSAL - CHECKLIST' : 'RELATÓRIO DIÁRIO - CHECKLIST';
        document.querySelector('#checklist-day-control').hidden = checklistReportMode !== 'daily';
        document.querySelector('#checklist-month-control').hidden = checklistReportMode !== 'monthly';
        updateDayControls(todayInputValue());
        await loadChecklistView(items);
      }));
      reportDay?.addEventListener('change', () => setReportDay(reportDay.value));
      document.querySelector('#checklist-report-previous')?.addEventListener('click', () => setReportDay(shiftDateKey(reportDay?.value || todayInputValue(), -1)));
      document.querySelector('#checklist-report-next')?.addEventListener('click', () => setReportDay(shiftDateKey(reportDay?.value || todayInputValue(), 1)));
      document.querySelector('#checklist-report-today')?.addEventListener('click', () => setReportDay(todayInputValue()));
      document.querySelector('#checklist-month')?.addEventListener('change', () => { if (checklistReportOpen && checklistReportMode === 'monthly') void loadMonthlyChecklist(items); });
      if (checklistReportOpen) {
        if (reportDialog && !reportDialog.open) reportDialog.showModal();
        await loadChecklistView(items);
      }
      return;
    }
    if (route === 'management') {
      if (!items.some((item) => item.id === selectedManagementAreaId)) selectedManagementAreaId = items[0]?.id || '';
      const areas = items.map((item) => `<button class="area-card${item.id === selectedManagementAreaId ? ' is-selected' : ''}" type="button" data-management-area="${escapeHtml(item.id)}" aria-pressed="${item.id === selectedManagementAreaId}"><span class="module-mark">${escapeHtml(item.shortName || item.icon || 'GE')}</span><span><strong>${escapeHtml(item.name || item.title || item.id)}</strong><small>${escapeHtml(item.description || '')}</small></span><span class="arrow" aria-hidden="true">›</span></button>`).join('');
      const existingAreaIds = new Set(items.map((item) => item.id));
      const seedPanel = can('managementManage') && MANAGEMENT_AREA_SEED.some((area) => !existingAreaIds.has(area.id))
        ? `<section class="management-seed-panel"><p>Catálogo-base V1: 12 nomes confirmados. Criar apenas áreas ausentes; gestores e membros ficam sem atribuição até configuração autorizada.</p><button class="secondary-button" id="seed-management-areas" type="button">Completar catálogo de Gestão</button></section>`
        : '';
      content.innerHTML = `<div id="management-evaluation-access"></div>${seedPanel}${areas ? `<div class="area-grid">${areas}</div><p class="area-footer">ESG e Inovação permanecem desativadas até existir conteúdo aprovado.</p><dialog class="management-area-dialog" id="management-area-dialog" aria-labelledby="management-area-dialog-title"><header class="management-area-dialog__header"><h2 id="management-area-dialog-title">ÁREA DE GESTÃO</h2><form method="dialog"><button class="secondary-button" type="submit" autofocus>Fechar</button></form></header><div class="management-area-dialog__body">${actionForm('management')}<section class="management-area-detail" id="management-area-detail" aria-live="polite"><p class="loading">Selecione uma área.</p></section></div></dialog>` : can('peopleManage') || can('usersManage') ? '<p class="empty-state">Use os atalhos de Gestão acima para acessar Pessoas e Administração.</p>' : '<p class="empty-state">As áreas de Gestão serão carregadas da configuração do Firestore.</p>'}`;
      const evaluationHost = content.querySelector('#management-evaluation-access');
      const requestUid = session.user?.uid;
      const generation = evaluationModuleGeneration;
      const evaluationCurrent = () => generation === evaluationModuleGeneration && content.isConnected && currentRoute() === 'management' &&
        session.status === 'signed-in' && session.user?.uid === requestUid && session.profile?.active === true && session.profile?.access === true && featureEnabledForRoute('management', appFeatures);
      const {mountManagementEvaluationAccess} = await import('./performance-ui.js');
      if (!evaluationCurrent()) return;
      cleanupCurrentModule = mountManagementEvaluationAccess(evaluationHost, {uid: requestUid, profile: session.profile, areas: items, isAdmin: () => can('admin'), canReviewSuggestions: () => can('managementManage') || can('qualityManage'), isCurrent: evaluationCurrent});
      const areaDialog = content.querySelector('#management-area-dialog');
      areaDialog?.addEventListener('close', () => { managementActivityLoad++; });
      content.querySelector('#seed-management-areas')?.addEventListener('click', async (event) => {
        if (!window.confirm('Criar no Firestore as áreas V1 ausentes? A ação não importará gestores, membros ou conteúdos.')) return;
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const {ensureManagementAreaCatalog} = await import('./data.js');
          const result = await ensureManagementAreaCatalog(session.user.uid);
          notice = result.created
            ? `${result.created} área(s) criada(s); ${result.existing} já existiam. Gestores e membros não foram atribuídos.`
            : `As 12 áreas já existem; nenhum dado foi alterado. Verifique se estão ativas.`;
          await render();
        } catch (error) {
          notice = `Não foi possível completar o catálogo. ${error.message || ''}`;
          await render();
        }
      });
      if (items.length) {
        await populateSelect('#activity-area', items, 'Selecione uma área');
        const areaSelect = document.querySelector('#activity-area');
        if (areaSelect) areaSelect.value = selectedManagementAreaId;
        content.querySelectorAll('[data-management-area]').forEach((button) => button.addEventListener('click', async () => {
          selectedManagementAreaId = button.dataset.managementArea;
          content.querySelectorAll('[data-management-area]').forEach((card) => {
            const selected = card.dataset.managementArea === selectedManagementAreaId;
            card.classList.toggle('is-selected', selected);
            card.setAttribute('aria-pressed', String(selected));
          });
          const select = document.querySelector('#activity-area');
          if (select) select.value = selectedManagementAreaId;
          if (areaDialog && !areaDialog.open) areaDialog.showModal();
          await loadManagementAreaActivities(items.find((area) => area.id === selectedManagementAreaId));
        }));
      }
    } else {
      const heading = (item) => route === 'events'
        ? `${item.memberName || 'Evento'}${item.date ? ` · ${item.date}` : ''}`
        : route === 'labels'
          ? `${item.patientName || 'Etiqueta'}${item.date ? ` · ${formatRecordDate(item.date)}` : ''}`
          : route === 'checklist'
            ? `${item.stationName || item.stationId || 'Checklist'}${item.date ? ` · ${item.date}` : ''}`
            : item.title || item.name || item.label || item.sigla || item.id;
    content.innerHTML = items.length ? `<ul class="record-list">${items.map((item) => `<li><strong>${escapeHtml(heading(item))}</strong>${route === 'labels' ? `<small>${escapeHtml(item.type || '')}${item.encounterCode ? ` · Atendimento ${escapeHtml(item.encounterCode)}` : ''}</small><small>${escapeHtml(item.creditor || '')}${item.staffSiglas?.length ? ` · ${escapeHtml(item.staffSiglas.join(', '))}` : ''}</small>` : item.description || item.occurrence ? `<small>${escapeHtml(item.description || item.occurrence)}</small>` : ''}${item.status ? `<small class="record-meta">${escapeHtml(item.status)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="empty-state">Nenhum registro disponível.</p>';
    }
    if (route === 'management') await populateSelect('#activity-area', items, 'Selecione uma área');
  } catch (error) {
    content.innerHTML = `<p class="empty-state">Não foi possível carregar esta área. ${escapeHtml(error.message || '')}</p>`;
  }
}

async function loadChecklistView(stations) {
  if (checklistReportMode === 'monthly') return loadMonthlyChecklist(stations);
  return loadDailyChecklist(stations);
}

async function loadOfflineView(target) {
  const uid = session.user.uid;
  try {
    const [counts, unsettled, pendingProgress] = await Promise.all([
      operationCounts(uid),
      listUnsettledOperations(uid),
      listPendingTrainingProgress(uid)
    ]);
    const labelsByType = {events: 'Evento', eventEdits: 'Edição de evento', labels: 'Etiqueta', checklists: 'Checklist', activities: 'Atividade', scheduleReleases: 'Liberação da escala'};
    const today = todayInputValue();
    const retryableFailed = unsettled.some((item) => item.status === 'failed' && item.lastErrorCode !== 'invalid-outbox-operation');
    const rows = unsettled.map((item) => {
      const dateDiffers = isChecklistDateDifferentFromLocalDay(item, today);
      const versionConflict = item.status === 'conflict' && item.type === 'eventEdits';
      const invalidLocalOperation = item.lastErrorCode === 'invalid-outbox-operation';
      const retryAt = Number(item.nextAttemptAt);
      const retryScheduled = item.status === 'queued' && Number.isFinite(retryAt) && retryAt > Date.now();
      const operationStatus = item.status === 'conflict'
        ? 'Conflito para comparar'
        : item.status === 'failed'
          ? 'Revisar'
          : !navigator.onLine
            ? 'Aguardando conexão'
            : retryScheduled
              ? 'Nova tentativa agendada'
              : 'Aguardando envio';
      const retryInfo = retryScheduled
        ? `<small class="record-meta">${item.lastError ? `Falha temporária: ${escapeHtml(item.lastError)} · ` : ''}Nova tentativa automática prevista às ${escapeHtml(new Date(retryAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}))}.</small>`
        : '';
      const resolution = item.status !== 'queued'
        ? `${dateDiffers
          ? `<small class="sync-error">A data do Checklist (${escapeHtml(formatRecordDate(item.payload.data.date))}) difere do dia atual exibido neste aparelho. O Firestore autoriza gravação apenas no dia do servidor. Se a verificação pertence a um dia anterior, faça uma nova verificação para hoje${can('checklistWrite') ? '' : ' e peça revisão ao administrador'}.</small>${can('checklistWrite') ? '<button class="secondary-button" type="button" data-open-current-checklist>Abrir Checklist de hoje</button>' : ''}`
          : versionConflict
            ? `<small class="sync-error">O evento mudou no Firestore desde a versão ${Number(item.payload.expectedVersion)}. O rascunho local foi preservado para comparação; abra Eventos, atualize o relatório e aplique manualmente suas alterações ao registro atual.</small>`
            : item.lastError ? `<small class="sync-error">${escapeHtml(item.lastError)}</small>` : ''}${!dateDiffers && !versionConflict && !invalidLocalOperation ? `<button class="secondary-button" type="button" data-retry-operation="${escapeHtml(item.requestId)}" ${navigator.onLine ? '' : 'disabled'}>Tentar esta ação novamente</button>` : ''}<button class="text-button" type="button" data-discard-operation="${escapeHtml(item.requestId)}">Descartar cópia local</button>`
        : '';
      const description = item.type === 'scheduleReleases'
        ? `${item.payload.sigla} · ${formatRecordDate(item.payload.day)}`
        : item.type === 'eventEdits'
          ? `Evento ${item.resourceId} · versão base ${Number(item.payload.expectedVersion)}`
        : `ID ${item.resourceId}`;
      return `<li><strong>${escapeHtml(labelsByType[item.type] || item.type)} · ${operationStatus}</strong><small>${escapeHtml(formatRecordDate(item.createdAt))} · ${escapeHtml(description)}</small>${retryInfo}${resolution}</li>`;
    }).join('');
    const trainingRows = pendingProgress.map((item) => {
      const percent = item.duration ? Math.min(100, Math.round((item.lastPosition / item.duration) * 100)) : 0;
      const remote = item.syncConflictRemote;
      const remoteWatched = (remote?.watchedRanges || []).reduce((total, range) => {
        const start = Number(range?.start);
        const end = Number(range?.end);
        return total + (Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0);
      }, 0);
      const remotePercent = remote?.duration ? Math.min(100, Math.round((remoteWatched / remote.duration) * 100)) : 0;
      const comparison = remote ? `<small class="sync-error">Firestore: ${remotePercent}% (${Math.floor(remote.lastPosition || 0)} s de ${Math.floor(remote.duration || 0)} s). Cópia local: ${percent}% (${Math.floor(item.lastPosition || 0)} s de ${Math.floor(item.duration || 0)} s). As durações diferem; o progresso não foi mesclado.</small>` : '';
      const retry = item.syncConflict ? '' : `<button class="secondary-button" type="button" data-retry-training="${escapeHtml(item.trainingId)}" ${navigator.onLine ? '' : 'disabled'}>Tentar este progresso novamente</button>`;
      const error = item.syncError ? `<small class="sync-error">Falha: ${escapeHtml(item.syncError)}${item.syncAttempts ? ` · ${item.syncAttempts} tentativa(s)` : ''}</small>${retry}` : '<small>Aguardando sincronização</small>';
      return `<li><strong>Treinamento · ${escapeHtml(item.trainingId)}</strong><small>${percent}% concluído · posição ${Math.floor(item.lastPosition || 0)} s</small>${comparison}${error}<button class="text-button" type="button" data-discard-training="${escapeHtml(item.trainingId)}">Descartar cópia local</button></li>`;
    }).join('');
    const failedTrainingCount = pendingProgress.filter((item) => item.syncError).length;
    target.innerHTML = `<nav class="offline-view-tabs" aria-label="Opções offline"><button type="button" id="offline-tab-sync" aria-pressed="${offlineViewMode === 'sync'}">Sincronização</button><button type="button" id="offline-tab-gallery" aria-pressed="${offlineViewMode === 'gallery'}">Escala/Férias 2026</button></nav><section id="offline-sync-panel"><section class="offline-panel" aria-live="polite"><header class="management-detail-heading"><div><p class="eyebrow">ESTADO DO DISPOSITIVO</p><h3>${navigator.onLine ? 'Conexão disponível' : 'Sem conexão'}</h3></div><button type="button" class="secondary-button" id="offline-refresh">Atualizar</button></header>
      <p>${counts.queued ? `${counts.queued} ação(ões) aguardando envio ao Firestore.` : 'Nenhuma ação operacional aguardando envio.'}${counts.failed ? ` ${counts.failed} ação(ões) falharam ou precisam de revisão.` : ''}${counts.conflict ? ` ${counts.conflict} edição(ões) têm conflito de versão e aguardam comparação manual.` : ''}${pendingProgress.length ? ` Progresso de ${pendingProgress.length} treinamento(s) ainda não confirmado pelo Firestore${failedTrainingCount ? `; ${failedTrainingCount} com falha` : ''}.` : ''}</p>
      ${retryableFailed ? `<button class="primary-button" type="button" id="offline-retry" ${navigator.onLine ? '' : 'disabled'}>Tentar sincronizar novamente</button>` : ''}
      ${unsettled.length ? `<ul class="record-list">${rows}</ul>` : ''}${trainingRows ? `<h4>Progresso de treinamento</h4><ul class="record-list">${trainingRows}</ul>` : ''}${!unsettled.length && !trainingRows ? '<p class="empty-state">As gravações online são confirmadas diretamente pelo Firestore.</p>' : ''}
      <p class="offline-footnote">Ações pendentes só ficam confirmadas depois que o Firestore aceitar a sincronização. O perfil em cache permite abrir o shell temporariamente; as Rules do Firestore continuam sendo a autorização efetiva.</p></section></section>${offlineScheduleGalleryMarkup(import.meta.env.BASE_URL)}`;
    target.querySelector('#offline-sync-panel').hidden = offlineViewMode !== 'sync';
    target.querySelector('.offline-schedule-gallery').hidden = offlineViewMode !== 'gallery';
    target.querySelector('#offline-tab-sync')?.addEventListener('click', () => setOfflineViewMode(target, 'sync'));
    target.querySelector('#offline-tab-gallery')?.addEventListener('click', () => setOfflineViewMode(target, 'gallery'));
    target.querySelectorAll('.offline-schedule-nav a').forEach((link) => link.addEventListener('click', (event) => {
      event.preventDefault();
      target.querySelector(link.getAttribute('href'))?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }));
    target.querySelectorAll('.offline-schedule-image-card img').forEach((image) => image.addEventListener('error', () => {
      const status = target.querySelector('#offline-schedule-cache-status');
      if (status) status.textContent = navigator.onLine
        ? 'Uma imagem não foi carregada. Use “Preparar imagens offline” e tente novamente.'
        : 'Esta imagem ainda não foi armazenada neste aparelho. Conecte-se e prepare o conjunto offline.';
    }, {once: true}));
    target.querySelector('#offline-schedule-prepare')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const status = target.querySelector('#offline-schedule-cache-status');
      if (!navigator.onLine) {
        if (status) status.textContent = 'Sem conexão. Só estarão disponíveis as imagens abertas ou preparadas anteriormente neste aparelho.';
        return;
      }
      button.disabled = true;
      if (status) status.textContent = 'Preparando cópia offline…';
      try {
        const imageCache = await caches.open('sahmt-v2-offline-schedule-v1');
        await cacheOfflineScheduleImages({
          baseUrl: import.meta.env.BASE_URL,
          fetchImage: async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await imageCache.put(url, response.clone());
            if (!(await imageCache.match(url))) throw new Error('A imagem não ficou disponível no cache local.');
          },
          onStatus: (message) => { if (status?.isConnected) status.textContent = message; }
        });
      } catch (error) {
        if (status?.isConnected) status.textContent = `Não foi possível preparar o cache offline. ${error.message || ''}`;
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
    target.querySelector('#offline-refresh')?.addEventListener('click', () => loadOfflineView(target));
    target.querySelector('#offline-retry')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      await retryFailedOperations(uid);
      await syncOutbox();
      if (document.querySelector('#module-content') === target) await loadOfflineView(target);
    });
    target.querySelectorAll('[data-open-current-checklist]').forEach((button) => button.addEventListener('click', () => navigate('checklist')));
    target.querySelectorAll('[data-retry-operation]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (await retryFailedOperation(uid, button.dataset.retryOperation)) {
          const {flushOutbox} = await import('./data.js');
          await flushOutbox(uid, {requestId: button.dataset.retryOperation});
        }
      } finally {
        await scheduleNextOutboxRetry(uid);
        if (document.querySelector('#module-content') === target) await loadOfflineView(target);
        await updateOutboxStatus();
      }
    }));
    target.querySelectorAll('[data-discard-operation]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Esta ação não foi confirmada pelo Firestore. Descartar permanentemente a cópia que existe somente neste aparelho?')) return;
      await removeQueuedOperation(uid, button.dataset.discardOperation);
      await loadOfflineView(target);
      await updateOutboxStatus();
    }));
    target.querySelectorAll('[data-retry-training]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      const {retryTrainingProgress} = await import('./data.js');
      await retryTrainingProgress(uid, button.dataset.retryTraining);
      if (document.querySelector('#module-content') === target) await loadOfflineView(target);
      await updateOutboxStatus();
    }));
    target.querySelectorAll('[data-discard-training]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Este progresso ainda não foi confirmado pelo Firestore. Descartar permanentemente a cópia que existe somente neste aparelho?')) return;
      await discardCachedTrainingProgress(uid, button.dataset.discardTraining);
      await loadOfflineView(target);
      await updateOutboxStatus();
    }));
  } catch (error) {
    target.innerHTML = `<p class="empty-state">Não foi possível ler as ações locais. ${escapeHtml(error.message || '')}</p>`;
  }
}

function setOfflineViewMode(target, mode) {
  offlineViewMode = mode === 'gallery' ? 'gallery' : 'sync';
  const syncButton = target.querySelector('#offline-tab-sync');
  const galleryButton = target.querySelector('#offline-tab-gallery');
  const syncPanel = target.querySelector('#offline-sync-panel');
  const gallery = target.querySelector('.offline-schedule-gallery');
  if (syncPanel) syncPanel.hidden = offlineViewMode !== 'sync';
  if (gallery) gallery.hidden = offlineViewMode !== 'gallery';
  syncButton?.setAttribute('aria-pressed', String(offlineViewMode === 'sync'));
  galleryButton?.setAttribute('aria-pressed', String(offlineViewMode === 'gallery'));
  if (offlineViewMode === 'gallery' && navigator.onLine) {
    const status = target.querySelector('#offline-schedule-cache-status');
    if (status && !status.textContent) status.textContent = 'Toque em “Preparar imagens offline” para guardar as sete imagens neste aparelho.';
  }
}

async function loadAdminModule(content) {
  if (!can('usersManage')) {
    content.innerHTML = '<p class="empty-state">Seu perfil não tem permissão para gerenciar acessos.</p>';
    return;
  }
  content.innerHTML = '<p class="loading">Carregando perfis da V2…</p>';
  try {
    const {listUserProfiles, listAccessRequests} = await import('./data.js');
    const [profiles, accessRequests] = await Promise.all([listUserProfiles(), listAccessRequests()]);
    let configuredFeatures = appFeatures;
    if (can('admin')) {
      try { configuredFeatures = normalizeAppFeatures(await (await import('./data-lite.js')).readAppFeatures(session.user.uid)); }
      catch { configuredFeatures = appFeatures; }
    }
    const permissions = userPermissions.map(([id, title]) => `<label class="permission-option"><input type="checkbox" name="permission" value="${id}" ${['trainingsRead', 'notificationsRead'].includes(id) ? 'checked' : ''} ${['admin', 'usersManage'].includes(id) && !can('admin') ? 'disabled' : ''}><span>${escapeHtml(title)}</span></label>`).join('');
    const featureSettings = can('admin') ? `<section class="admin-user-form panel"><h3>Disponibilidade dos módulos</h3><p>Ative ou oculte áreas na Home sem editar o código. As regras de acesso do Firestore continuam valendo mesmo para uma área oculta.</p><form id="app-feature-form"><fieldset><legend>Módulos do SAHMT</legend><div class="permission-grid">${[
      ['checklist', 'Checklist'], ['labels', 'Etiquetas'], ['trainings', 'Desempenho'], ['management', 'Gestão'], ['notifications', 'Notificações'],
      ['esg', 'ESG · preparado'], ['innovation', 'Inovação · preparada']
    ].map(([id, title]) => `<label class="permission-option"><input type="checkbox" name="feature" value="${id}" ${configuredFeatures[id] ? 'checked' : ''} ${['esg', 'innovation'].includes(id) ? 'disabled' : ''}><span>${escapeHtml(title)}</span></label>`).join('')}</div></fieldset><p class="record-meta">ESG e Inovação ficam desativadas enquanto não houver uma área publicada. Eventos, Pessoas, Administração, Home e Sincronização permanecem disponíveis conforme as permissões.</p><div class="admin-user-actions"><button class="secondary-button" type="submit">Salvar disponibilidade</button></div><p id="app-feature-status" class="record-meta" role="status" aria-live="polite"></p></form></section>` : '';
    const entries = profiles.map((profile) => {
      const active = profile.active === true && profile.access === true;
      const self = profile.uid === session.user.uid;
      const permissionSummary = Object.keys(profile.permissions || {}).filter((key) => profile.permissions[key] === true).length;
      const privileged = profile.role === 'administrador_app' || profile.permissions?.admin === true || profile.permissions?.usersManage === true;
      const editControl = self ? '<span class="record-meta">Perfil atual</span>' : privileged && !can('admin') ? '<span class="record-meta">Edição restrita a administrador</span>' : `<button type="button" class="secondary-button" data-edit-user="${escapeHtml(profile.uid)}">Editar</button>`;
      return `<article class="user-profile-row" data-admin-user-row data-search="${escapeHtml(`${profile.displayName || ''} ${profile.email || ''} ${profile.sigla || ''} ${profile.uid || ''}`.toLowerCase())}"><div><strong>${escapeHtml(profile.displayName || profile.email || profile.uid)}</strong><small>${escapeHtml([profile.sigla, profile.role, profile.email].filter(Boolean).join(' · '))}</small><small>${active ? 'Acesso ativo' : 'Acesso bloqueado'} · ${permissionSummary} permissões${self ? ' · sua conta' : ''}</small><code>${escapeHtml(profile.uid || '')}</code></div>${editControl}</article>`;
    }).join('');
    const requestEntries = accessRequests.map((request) => `<article class="user-profile-row"><div><strong>${escapeHtml(request.displayName || request.email)}</strong><small>${escapeHtml(request.email)} · Solicitação pendente</small></div><button type="button" class="secondary-button" data-review-access="${escapeHtml(request.uid)}">Configurar acesso</button></article>`).join('');
    content.innerHTML = `<p class="admin-auth-note">Este painel gerencia perfis e configurações SAHMT no Firestore. No fluxo normal, a pessoa entra com Google e toca em “Solicitar acesso ao SAHMT”; o pedido aparece abaixo com UID, e-mail e nome preenchidos. Não é necessário pedir nem copiar o UID por mensagem. Isso não cria contas Google nem senhas; nenhuma busca em planilha ou chamada ao Apps Script participa do acesso.</p>
      <section class="admin-user-list"><div class="admin-list-heading"><h3>Solicitações de acesso</h3></div><p class="record-meta">Pedidos feitos no login aparecem aqui. Eles não concedem acesso automaticamente; escolha função e permissões antes de provisionar.</p>${requestEntries || '<p class="empty-state">Nenhuma solicitação pendente.</p>'}</section>
      ${featureSettings}
      <details id="admin-user-editor" class="quick-form admin-user-form"><summary id="user-form-summary">Configurar um pedido ou editar perfil</summary><section class="panel"><h3 id="user-form-title">Provisionar perfil SAHMT</h3><p>Ao abrir um pedido, UID, e-mail e nome são preenchidos automaticamente. O cadastro manual sem pedido fica reservado a casos administrativos excepcionais.</p>
        <form id="admin-user-form"><div class="form-grid"><label>UID Firebase<input name="uid" required maxlength="128" autocomplete="off" placeholder="Preenchido pelo pedido ou manualmente"></label><label>E-mail do Google<input name="email" type="email" required maxlength="200" autocomplete="off"></label><label>Nome exibido<input name="displayName" required maxlength="120"></label><label>Sigla<input name="sigla" maxlength="20"></label><label>Telefone<input name="phone" type="tel" maxlength="40"></label><label>Função<select name="role" required>${userRoles.map(([id, title]) => `<option value="${id}" ${id === 'temporario' ? 'selected' : ''} ${id === 'administrador_app' && !can('admin') ? 'disabled' : ''}>${escapeHtml(title)}</option>`).join('')}</select></label></div>
          <fieldset><legend>Permissões SAHMT</legend><p class="record-meta">Desempenho e Notificações são liberados para todos os perfis aprovados. As demais permissões seguem a seleção abaixo.</p><div class="permission-grid">${permissions}</div></fieldset>
          <div class="admin-user-flags"><label><input type="checkbox" name="active" checked> Perfil ativo</label><label><input type="checkbox" name="access" checked> Acesso ao SAHMT</label></div>
          <div class="admin-user-actions"><button class="primary-button" type="submit">Salvar perfil</button><button class="secondary-button" id="cancel-user-edit" type="button" hidden>Cancelar edição</button></div><p id="admin-user-status" class="record-meta" role="status" aria-live="polite"></p>
        </form>
      </section></details>
      <section class="admin-user-list"><div class="admin-list-heading"><h3>Perfis V2</h3><label>Filtrar perfis<input id="admin-user-search" type="search" placeholder="Nome, sigla, e-mail ou UID"></label></div><p class="record-meta">Exibindo até 200 perfis, ordenados por nome. Para remover acesso, desative o perfil; o registro não é apagado.</p>${entries || '<p class="empty-state">Nenhum perfil provisionado foi encontrado.</p>'}</section>`;
    const featureForm = content.querySelector('#app-feature-form');
    featureForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = featureForm.querySelector('[type="submit"]');
      const status = featureForm.querySelector('#app-feature-status');
      submit.disabled = true;
      if (status) status.textContent = 'Salvando configurações…';
      const nextFeatures = {...configuredFeatures};
      featureForm.querySelectorAll('input[name="feature"]:not(:disabled)').forEach((input) => { nextFeatures[input.value] = input.checked; });
      try {
        const {saveAppFeatures} = await import('./data.js');
        appFeatures = await saveAppFeatures(nextFeatures, session.user.uid);
        notice = 'Disponibilidade dos módulos atualizada.';
        await render();
      } catch (error) {
        if (status) status.textContent = error.code === 'permission-denied'
          ? 'O Firestore recusou a alteração. Somente uma conta administradora pode mudar a disponibilidade.'
          : `Não foi possível salvar as configurações: ${error.message || error}`;
        submit.disabled = false;
      }
    });
    const form = content.querySelector('#admin-user-form');
    const status = content.querySelector('#admin-user-status');
    const resetForm = () => {
      form.reset();
      form.elements.uid.readOnly = false;
      form.elements.active.checked = true;
      form.elements.access.checked = true;
      form.dataset.editingUid = '';
      content.querySelector('#user-form-title').textContent = 'Provisionar perfil SAHMT';
      content.querySelector('#user-form-summary').textContent = 'Configurar um pedido ou editar perfil';
      form.querySelector('[type="submit"]').textContent = 'Salvar perfil';
      content.querySelector('#cancel-user-edit').hidden = true;
      status.textContent = '';
    };
    content.querySelector('#cancel-user-edit').addEventListener('click', resetForm);
    content.querySelectorAll('[data-edit-user]').forEach((button) => button.addEventListener('click', () => {
      const profile = profiles.find((item) => item.uid === button.dataset.editUser);
      if (!profile) return;
      form.elements.uid.value = profile.uid || '';
      form.elements.uid.readOnly = true;
      form.elements.email.value = profile.email || '';
      form.elements.displayName.value = profile.displayName || '';
      form.elements.sigla.value = profile.sigla || '';
      form.elements.phone.value = profile.phone || '';
      form.elements.role.value = userRoles.some(([id]) => id === profile.role) ? profile.role : 'temporario';
      form.elements.active.checked = profile.active === true;
      form.elements.access.checked = profile.access === true;
      form.dataset.editingUid = profile.uid;
      form.querySelectorAll('input[name="permission"]').forEach((input) => { input.checked = profile.permissions?.[input.value] === true || (profile.active === true && profile.access === true && ['trainingsRead', 'notificationsRead'].includes(input.value)); });
      content.querySelector('#user-form-title').textContent = `Editar perfil · ${profile.displayName || profile.uid}`;
      content.querySelector('#user-form-summary').textContent = 'Editando perfil existente';
      form.querySelector('[type="submit"]').textContent = 'Atualizar perfil';
      content.querySelector('#cancel-user-edit').hidden = false;
      content.querySelector('#admin-user-editor').open = true;
      form.scrollIntoView({behavior: 'smooth', block: 'start'});
    }));
    content.querySelectorAll('[data-review-access]').forEach((button) => button.addEventListener('click', () => {
      const request = accessRequests.find((item) => item.uid === button.dataset.reviewAccess);
      if (!request) return;
      resetForm();
      form.elements.uid.value = request.uid;
      form.elements.uid.readOnly = true;
      form.elements.email.value = request.email;
      form.elements.displayName.value = request.displayName || '';
      form.elements.role.value = 'temporario';
      content.querySelector('#user-form-summary').textContent = `Configurando pedido · ${request.displayName || request.email}`;
      status.textContent = 'Escolha a função e marque somente as permissões necessárias antes de salvar.';
      content.querySelector('#admin-user-editor').open = true;
      form.scrollIntoView({behavior: 'smooth', block: 'start'});
    }));
    content.querySelector('#admin-user-search').addEventListener('input', (event) => {
      const term = event.target.value.trim().toLowerCase();
      content.querySelectorAll('[data-admin-user-row]').forEach((row) => { row.hidden = !row.dataset.search.includes(term); });
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.textContent = 'Salvando perfil no Firestore…';
      const permissions = Object.fromEntries([...form.querySelectorAll('input[name="permission"]')].map((input) => [input.value, input.checked]));
      try {
        const {saveUserProfile} = await import('./data.js');
        await saveUserProfile({
          uid: form.elements.uid.value,
          email: form.elements.email.value,
          displayName: form.elements.displayName.value,
          sigla: form.elements.sigla.value,
          phone: form.elements.phone.value,
          role: form.elements.role.value,
          active: form.elements.active.checked,
          access: form.elements.access.checked,
          permissions
        }, session.user.uid);
        await loadAdminModule(content);
        const updatedStatus = document.querySelector('#admin-user-status');
        if (updatedStatus) updatedStatus.textContent = 'Perfil salvo no Firestore.';
      } catch (error) {
        status.textContent = error.code === 'permission-denied'
          ? 'O Firestore recusou a alteração. Seu perfil não pode conceder este nível de acesso.'
          : `Não foi possível salvar: ${error.message || error}`;
      }
    });
  } catch (error) {
    content.innerHTML = `<p class="empty-state">Não foi possível consultar os perfis V2. ${escapeHtml(error.message || '')}</p>`;
  }
}

async function loadDailyChecklist(stations, suppliedDay, suppliedResult = null, scope = null) {
  const content = document.querySelector('#module-content');
  if (!content) return;
  const day = suppliedDay || document.querySelector('#checklist-report-day')?.value || todayInputValue();
  const dayMode = checklistDayMode(day, todayInputValue());
  if (dayMode === 'invalid') return;
  if (dayMode === 'future') {
    content.innerHTML = '<p class="empty-state">Não é possível consultar um Checklist futuro.</p>';
    return;
  }
  const applicableStations = stations.filter((station) => stationIsInDateRange(station, day));
  const writableStations = applicableStations.filter((station) => stationIsValidOn(station, day));
  if (!suppliedResult) return startReportLive('checklist', {suppliedDay: day});
  if (!reportScopeCurrent(scope)) return;
  try {
    const uid = scope.uid;
    const result = suppliedResult;
    const records = result.records;
    const fingerprint = reportFingerprint({day, stations, records, priorRecords: result.priorRecords});
    const previousFingerprint = checklistReportContext?.fingerprint;
    if (previousFingerprint && previousFingerprint !== fingerprint) invalidateChecklistSignature('O relatório mudou. Revise os dados antes de enviar para validação.');
    const latestByStation = new Map();
    for (const record of records) if (!latestByStation.has(record.stationId)) latestByStation.set(record.stationId, record);
    const priorByStation = new Map();
    for (const record of result.priorRecords || []) if (!priorByStation.has(record.stationId)) priorByStation.set(record.stationId, record);
    checklistReportContext = {day, stations: applicableStations, latestByStation, priorByStation, fingerprint, scopeKey: scope.key};
    const summary = summarizeChecklistDay(day, todayInputValue(), applicableStations, records);
    const resolvedRecordFor = (station) => resolveChecklistDayRecord(station, latestByStation.get(station.id), priorByStation.get(station.id), day, todayInputValue());
    const displayStations = sortChecklistStationsForDisplay(stations, resolvedRecordFor)
      .sort((left, right) => Number(right.active === true) - Number(left.active === true));
    const cards = displayStations.map((station) => {
      const record = resolvedRecordFor(station);
      const stationStateClass = station.active !== true ? 'inactive' : record?.condition === 'SIM' ? 'complete' : record?.condition === 'NAO' ? 'nonconforming' : 'pending';
      const note = record?.inherited ? `<small>Não conformidade herdada de ${escapeHtml(formatRecordDate(record.date))}: ${escapeHtml(record.occurrence || '')}</small>` : record?.occurrence ? `<small>${escapeHtml(record.occurrence)}</small>` : '';
      const recordedAt = record?.createdAt ? `<small>Último registro: ${escapeHtml(interactionDateTime(record.createdAt))}</small>` : '';
      const action = '';
      const pending = record?.pendingSync ? '<small class="record-meta">Aguardando sincronização</small>' : record?.syncFailed ? `<small class="sync-error">Falha ao sincronizar: ${escapeHtml(record.syncError || 'revise as permissões e tente novamente')}</small>` : '';
      return `<article class="checklist-station checklist-station-${stationStateClass}" data-checklist-station="${escapeHtml(station.id)}" tabindex="-1"><div><button class="checklist-station-select" type="button" data-checklist-select="${escapeHtml(station.id)}" aria-label="Selecionar estação ${escapeHtml(station.name || station.id)}" aria-pressed="false">${checklistArsenalFunction(station) ? `<span class="checklist-arsenal-function">${escapeHtml(checklistArsenalFunction(station))}</span>` : ''}<span>${escapeHtml(checklistArsenalButtonLabel(station))}</span></button>${recordedAt}${note}${pending}</div>${action}</article>`;
    }).join('');
    const summaryCards = '';
    const stationGrid = cards ? `<section class="checklist-station-grid" aria-label="Estações do Checklist">${cards}</section>` : '<p class="empty-state">Nenhuma estação vigente está cadastrada para esta data.</p>';
    const pendingChecklistWrites = records.some((record) => record.pendingSync || record.pendingFirestore || record.syncFailed || record.syncConflict || record.hasPendingWrites);
    const signatureUnavailableReason = pendingChecklistWrites
      ? 'Resolva as respostas locais pendentes antes da assinatura.'
      : result.stale
        ? 'Assinaturas exigem conferência online do relatório.'
        : !applicableStations.length
          ? 'Cadastre ao menos uma estação vigente antes de revisar o relatório.'
          : '';
    const canPrepareSignature = dayMode === 'today' && applicableStations.length > 0 && !pendingChecklistWrites && !result.historyIncomplete && !result.truncated;
    const signatureMarkup = `<footer class="checklist-confirmation-footer"><button class="secondary-button checklist-confirmation-button" id="checklist-signature-prepare" type="button" disabled><span>Confirmação do Checklist</span><small id="checklist-responsible-name">Consultando responsável…</small></button></footer><dialog class="checklist-confirmation-dialog" id="checklist-confirmation-dialog" aria-labelledby="checklist-confirmation-title"><header><h3 id="checklist-confirmation-title" tabindex="-1">Confirmação do Checklist</h3><form method="dialog"><button class="secondary-button" type="submit">Fechar</button></form></header><p id="checklist-signature-status" class="record-meta" role="status" aria-live="polite">${signatureUnavailableReason}</p><div id="checklist-signature-preview"></div></dialog>`;
    reconcileReportMarkup(content, `<div class="checklist-daily-layout"><div class="checklist-daily-notices">${result.stale ? '<p class="sync-state">Sem conexão: exibindo os registros salvos neste aparelho.</p>' : ''}${result.historyIncomplete ? '<p class="sync-state">Sem conexão: o catálogo mudou desde a última consulta; algumas heranças podem estar ausentes.</p>' : ''}${dayMode === 'history' ? '<p class="sync-state">Data histórica: consulta somente; registros são feitos no Checklist de hoje.</p>' : ''}${summaryCards}</div>${stationGrid}${signatureMarkup}</div>`, {preserveSelectors: ['#checklist-confirmation-dialog[open]']});
    content.querySelectorAll('[data-checklist-select]').forEach((button) => button.onclick = () => {
      if (!reportScopeCurrent(scope)) return;
      const station = displayStations.find((item) => item.id === button.dataset.checklistSelect);
      if (station) showChecklistStationBanner(station, resolvedRecordFor(station), day, stations, {fromQr: false});
    });
    const prepareSignature = content.querySelector('#checklist-signature-prepare');
    const responsibleName = content.querySelector('#checklist-responsible-name');
    const confirmationDialog = content.querySelector('#checklist-confirmation-dialog');
    updateChecklistResponsibilityUI();
    if (prepareSignature) prepareSignature.title = signatureUnavailableReason || (dayMode !== 'today' ? 'Consulta histórica: a confirmação é feita no dia atual.' : '');
    if (prepareSignature) prepareSignature.onclick = async () => {
      if (!canPrepareSignature || !checklistSignatureCurrent(scope, fingerprint)) return;
      if (!confirmationDialog.open) confirmationDialog.showModal();
      content.querySelector('#checklist-confirmation-title')?.focus({preventScroll: true});
      const status = content.querySelector('#checklist-signature-status');
      const previewTarget = content.querySelector('#checklist-signature-preview');
      const previewToken = confirmationDialog._checklistSignatureRequest = {};
      const previewCurrent = () => confirmationDialog._checklistSignatureRequest === previewToken && confirmationDialog.isConnected && document.querySelector('#checklist-confirmation-dialog') === confirmationDialog && reportScopeCurrent(scope) && checklistReportContext?.fingerprint === fingerprint;
      prepareSignature.disabled = true;
      status.textContent = 'Preparando o pedido de validação do relatório…';
      try {
        if (!scope.isAdmin) {
          const {getChecklistDayResponsible} = await import('./checklist-responsibility-reader.js');
          const responsible = await getChecklistDayResponsible(scope);
          if (!reportScopeCurrent(scope)) return;
          checklistResponsibilityLive = {key: scope.key, responsible, confirmed: true};
        }
        const responsibilityFingerprint = reportFingerprint(checklistResponsibilityLive?.responsible);
        const {getChecklistSignaturePreview} = await import('./checklist-signature.js');
        if (!checklistSignatureCurrent(scope, fingerprint, responsibilityFingerprint)) return;
        const preview = await getChecklistSignaturePreview({day, stations: applicableStations, records, uid});
        if (!previewCurrent()) return;
        if (!checklistSignatureCurrent(scope, fingerprint, responsibilityFingerprint)) { invalidateChecklistSignature('O relatório mudou durante a conferência. Revise novamente.'); return; }
        if (preview.requestStatus === 'PENDING_VALIDATION') {
          previewTarget.innerHTML = '<p class="sync-state">Este pedido já está registrado e aguarda validação. O responsável, a assinatura e os pontos ainda não foram confirmados.</p>';
          status.textContent = 'Pedido de validação pendente.';
          prepareSignature.disabled = true;
          return;
        }
        if (['VALIDATED', 'DUPLICATE'].includes(preview.requestStatus)) {
          previewTarget.innerHTML = '<p class="sync-state">Esta revisão já foi validada e assinada.</p>';
          status.textContent = 'Assinatura validada.';
          prepareSignature.disabled = true;
          return;
        }
        if (['REJECTED', 'STALE', 'NEEDS_REVIEW'].includes(preview.requestStatus)) {
          previewTarget.innerHTML = `<p class="sync-state">O pedido anterior não foi validado. ${escapeHtml(preview.validationMessage || 'Confira o relatório e os dados atuais.')} Atualize antes de criar outro pedido.</p>`;
          status.textContent = 'Pedido anterior requer revisão.';
          prepareSignature.disabled = true;
          return;
        }
        previewTarget.innerHTML = `<div class="checklist-signature-review"><p>Relatório: ${preview.total - preview.missing}/${preview.total} estações respondidas.${preview.missing ? ` ${preview.missing} pendente(s).` : ''}</p><p>O responsável da primeira posição, as substituições e a revisão final serão conferidos pelo validador. Este envio ainda não é uma assinatura validada e não concede pontos.</p><label>Justificativa ou contexto para auditoria<textarea id="checklist-signature-justification" rows="3" maxlength="500" required></textarea></label><label class="checklist-declaration"><input type="checkbox" id="checklist-signature-declaration"> ${escapeHtml(preview.declaration)}</label><button class="primary-button" type="button" id="checklist-signature-confirm" disabled>Enviar para validação</button></div>`;
        status.textContent = 'Confira o relatório e registre o pedido. A validação será assíncrona.';
        const declaration = previewTarget.querySelector('#checklist-signature-declaration');
        const justification = previewTarget.querySelector('#checklist-signature-justification');
        const confirm = previewTarget.querySelector('#checklist-signature-confirm');
        const updateEnabled = () => { confirm.disabled = !declaration.checked || justification.value.trim().length < 8 || !checklistSignatureCurrent(scope, fingerprint, responsibilityFingerprint); };
        declaration.addEventListener('change', updateEnabled);
        justification?.addEventListener('input', updateEnabled);
        confirm.addEventListener('click', async () => {
          if (!previewCurrent() || !checklistSignatureCurrent(scope, fingerprint, responsibilityFingerprint)) return;
          confirm.disabled = true;
          status.textContent = 'Registrando o pedido de validação no Firestore…';
          try {
            const {signChecklistReport} = await import('./checklist-signature.js');
            if (!checklistSignatureCurrent(scope, fingerprint, responsibilityFingerprint)) return;
            await signChecklistReport({day, revision: preview.revision, declaration: declaration.checked, justification: justification.value, uid});
            if (!previewCurrent()) return;
            status.textContent = 'Pedido registrado. Assinatura e pontuação aguardam validação.';
            confirmationDialog.close();
            await loadDailyChecklist(stations, day);
          } catch (error) {
            if (!previewCurrent()) return;
            status.textContent = error.message || 'Não foi possível assinar. Atualize o relatório e tente novamente.';
            prepareSignature.disabled = !canPrepareSignature || !checklistSignatureCurrent(scope, fingerprint);
          }
        });
      } catch (error) {
        if (!previewCurrent()) return;
        status.textContent = error.message || 'Não foi possível conferir a revisão do relatório.';
      } finally {
        if (previewCurrent() && prepareSignature.isConnected) prepareSignature.disabled = !canPrepareSignature || !checklistSignatureCurrent(scope, fingerprint);
      }
    };
  } catch (error) {
    if (!reportScopeCurrent(scope)) return;
    content.innerHTML = `<p class="empty-state">Não foi possível carregar o checklist. ${escapeHtml(error.message || '')}</p>`;
  }
}

function revealChecklistStation(station, day, stations) {
  const record = checklistReportContext?.day === day
    ? resolveChecklistDayRecord(station, checklistReportContext.latestByStation.get(station.id), checklistReportContext.priorByStation.get(station.id), day, todayInputValue())
    : null;
  showChecklistStationBanner(station, record, day, stations, {fromQr: true});
}

function ensureChecklistDailyReportOpen(day) {
  checklistReportMode = 'daily';
  checklistReportOpen = true;
  const reportDay = document.querySelector('#checklist-report-day');
  if (reportDay) reportDay.value = day;
  const dayControl = document.querySelector('#checklist-day-control');
  const monthControl = document.querySelector('#checklist-month-control');
  if (dayControl) dayControl.hidden = false;
  if (monthControl) monthControl.hidden = true;
  const dialog = document.querySelector('#checklist-report-dialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function showChecklistStationBanner(station, record, day, stations, {fromQr = false} = {}) {
  const dialog = document.querySelector('#checklist-station-dialog');
  const title = document.querySelector('#checklist-station-title');
  const result = document.querySelector('#checklist-station-result');
  const actions = document.querySelector('#checklist-station-actions');
  const responses = document.querySelector('#checklist-station-responses');
  const controls = document.querySelector('#checklist-station-controls');
  const checker = document.querySelector('#checklist-station-checker');
  const status = document.querySelector('#checklist-station-status');
  if (!dialog || !result || !actions || !responses || !controls || !checker || !status) return;
  const active = station.active === true;
  const dayIsToday = checklistDayMode(day, todayInputValue()) === 'today';
  const canWriteToday = can('checklistWrite') && dayIsToday && active && stationIsValidOn(station, day);
  const canManage = can('admin') && can('checklistManage');
  const showAnswers = canWriteToday && (fromQr || canManage);
  dialog.dataset.manualChecklist = showAnswers ? 'true' : 'false';
  const resultLabel = !active ? 'Inativo' : record?.condition === 'SIM' ? 'Conforme' : record?.condition === 'NAO' ? 'Não conforme' : 'Pendente de checagem';
  if (title) title.textContent = station.name || station.id || 'Checklist da estação';
  const checkerSummary = checklistCheckerSummary(record, {uid: session.user?.uid, profileName: session.profile?.displayName, authName: session.user?.displayName});
  const checkerMarkup = checkerSummary ? `<div class="checklist-station-checker-summary"><span>${checkerSummary.pending ? 'Checagem local' : 'Última checagem'}</span><strong data-checklist-checker-name>${escapeHtml(checkerSummary.name || 'Nome não disponível')}</strong><small>${checkerSummary.pending ? 'Horário local: ' : ''}${escapeHtml(checkerSummary.dateTime || 'Data e hora não disponíveis')}</small>${checkerSummary.pending ? `<small>${checkerSummary.failed ? 'Falha na sincronização' : 'Aguardando sincronização'}</small>` : ''}</div>` : '';
  const inherited = record?.inherited ? `<small>Não conformidade herdada de ${escapeHtml(formatRecordDate(record.date))}.</small>` : '';
  const occurrence = record?.occurrence ? `<div class="checklist-station-justification"><strong>Justificativa</strong><p>${escapeHtml(record.occurrence)}</p></div>` : '';
  const activeLabel = active ? 'Arsenal ativo' : 'Arsenal inativo';
  const maintenanceFields = [['preventiveAnnual', 'Preventiva Anual'], ['electricalAnnual', 'Elétrica Anual'], ['calibrationSemiannual', 'Calibração Semestral']];
  const maintenance = normalizeChecklistMaintenance(station.maintenance);
  const overdueMaintenance = checklistMaintenanceOverdue(maintenance, todayInputValue());
  result.innerHTML = `<div class="checklist-station-result__heading checklist-station-result--${!active ? 'inactive' : record?.condition === 'SIM' ? 'complete' : record?.condition === 'NAO' ? 'nonconforming' : active ? 'pending' : 'inactive'}"><span>Situação atual do arsenal</span><strong>${resultLabel}</strong><span>${activeLabel}</span><span class="checklist-maintenance-alert" data-checklist-maintenance-alert ${Object.values(overdueMaintenance).some(Boolean) ? '' : 'hidden'}>MANUTENÇÃO EM ATRASO</span></div>`;
  const answerMarkup = showAnswers ? `<div class="checklist-station-response"><div class="checklist-station-response-options"><button class="checklist-answer-button checklist-answer-button--yes" type="button" data-checklist-banner-answer="SIM">Conforme</button><button class="checklist-answer-button checklist-answer-button--no" type="button" data-checklist-banner-answer="NAO">Não Conforme</button></div><label class="checklist-station-justification" data-checklist-justification hidden>Justificativa<textarea id="checklist-station-occurrence" rows="3" maxlength="500" placeholder="Descreva a não conformidade"></textarea></label><button class="primary-button" type="button" data-checklist-banner-save hidden>Salvar checklist</button></div>` : '';
  const maintenanceMarkup = `<section class="checklist-station-block checklist-maintenance" aria-labelledby="checklist-maintenance-title"><h4 id="checklist-maintenance-title">Manutenção deste Equipamento</h4>${maintenanceFields.map(([key, label]) => `<label class="checklist-maintenance-date${overdueMaintenance[key] ? ' is-overdue' : ''}" data-checklist-maintenance-row="${key}"><span>${label}</span><input type="date" data-checklist-maintenance-date="${key}" value="${escapeHtml(maintenance[key])}" disabled></label>`).join('')}${canManage ? '<button class="secondary-button" type="button" data-checklist-maintenance-edit>Editar Manutenção</button><button class="primary-button" type="button" data-checklist-maintenance-save hidden>Salvar Manutenção</button>' : ''}</section>`;
  const managementMarkup = canManage ? `<section class="checklist-station-block checklist-admin-actions" aria-label="Administração do arsenal"><button class="secondary-button" type="button" data-checklist-station-active="true" ${active ? 'disabled' : ''}>Ativar Arsenal</button><button class="secondary-button" type="button" data-checklist-station-active="false" ${!active ? 'disabled' : ''}>Desativar Arsenal</button></section>` : '';
  responses.innerHTML = answerMarkup;
  checker.innerHTML = `${inherited}${occurrence}${!record?.occurrence && record?.condition === 'NAO' ? '<p>Justificativa não informada neste registro.</p>' : ''}<p class="checklist-station-commitment" ${record?.condition === 'NAO' ? '' : 'hidden'}>${escapeHtml(CHECKLIST_NONCONFORMING_COMMITMENT)}</p>${checkerMarkup}`;
  controls.innerHTML = `${maintenanceMarkup}${managementMarkup}`;
  const maintenanceUid = session.user?.uid;
  const maintenanceBannerToken = {};
  dialog.checklistStationBannerToken = maintenanceBannerToken;
  const maintenanceBannerCurrent = () => dialog.open && currentRoute() === 'checklist' && document.querySelector('#checklist-station-dialog') === dialog && dialog.checklistStationBannerToken === maintenanceBannerToken && session.user?.uid === maintenanceUid;
  const maintenanceBannerWritable = () => maintenanceBannerCurrent() && can('admin') && can('checklistManage');
  const checklistBannerWritable = () => canWriteToday && checklistDayMode(day, todayInputValue()) === 'today' && maintenanceBannerCurrent() && can('checklistWrite') && (fromQr || (maintenanceBannerWritable() && dialog.dataset.manualChecklist === 'true'));
  const maintenanceInputs = maintenanceFields.map(([key]) => actions.querySelector(`[data-checklist-maintenance-date="${key}"]`));
  const maintenanceSave = actions.querySelector('[data-checklist-maintenance-save]');
  const updateMaintenanceDisplay = (value) => {
    const dates = normalizeChecklistMaintenance(value);
    const overdue = checklistMaintenanceOverdue(dates, todayInputValue());
    const alert = result.querySelector('[data-checklist-maintenance-alert]');
    if (alert) alert.hidden = !Object.values(overdue).some(Boolean);
    maintenanceFields.forEach(([key], index) => {
      maintenanceInputs[index].value = dates[key];
      maintenanceInputs[index].disabled = true;
      actions.querySelector(`[data-checklist-maintenance-row="${key}"]`)?.classList.toggle('is-overdue', overdue[key]);
    });
  };
  actions.querySelector('[data-checklist-maintenance-edit]')?.addEventListener('click', () => {
    if (!maintenanceBannerWritable()) return;
    maintenanceInputs.forEach((input) => { input.disabled = false; });
    maintenanceSave.hidden = false;
    maintenanceInputs[0]?.focus();
  });
  maintenanceSave?.addEventListener('click', async () => {
    if (!maintenanceBannerWritable()) return;
    const maintenanceValue = Object.fromEntries(maintenanceFields.map(([key], index) => [key, maintenanceInputs[index].value]));
    maintenanceSave.disabled = true;
    status.textContent = 'Salvando manutenção…';
    try {
      const {saveChecklistStationMaintenance} = await import('./data.js');
      if (!maintenanceBannerWritable()) return;
      const saved = await saveChecklistStationMaintenance(station.id, maintenanceValue, maintenanceUid);
      if (!maintenanceBannerWritable()) return;
      station.maintenance = saved.maintenance;
      updateMaintenanceDisplay(saved.maintenance);
      maintenanceSave.hidden = true;
      status.textContent = 'Manutenção salva.';
    } catch (error) {
      if (maintenanceBannerWritable()) status.textContent = error.code === 'permission-denied' ? 'Não foi possível salvar: confira a permissão administrativa e a publicação das regras do Firestore.' : error.message || 'Não foi possível salvar a manutenção.';
    } finally {
      if (maintenanceBannerWritable()) maintenanceSave.disabled = false;
    }
  });
  status.textContent = !dayIsToday ? 'Data histórica: consulta somente; alterações são feitas no Checklist de hoje.' : !active ? 'Arsenal inativo.' : '';
  const saveAnswer = async (condition) => {
    if (!checklistBannerWritable()) return;
    const textarea = actions.querySelector('#checklist-station-occurrence');
    const saveButton = actions.querySelector('[data-checklist-banner-save]');
    if (condition === 'NAO' && !textarea?.value.trim()) {
      status.textContent = 'Informe a justificativa antes de salvar a não conformidade.';
      textarea?.focus();
      return;
    }
    const answerButtons = actions.querySelectorAll('[data-checklist-banner-answer]');
    answerButtons.forEach((button) => { button.disabled = true; });
    if (saveButton) saveButton.disabled = true;
    status.textContent = 'Salvando checklist…';
    const outcome = await saveChecklistAnswer(station.id, condition, day, textarea?.value || '', {uid: maintenanceUid, isCurrent: checklistBannerWritable});
    if (!checklistBannerWritable()) return;
    if (!outcome.ok) {
      status.textContent = outcome.message;
      answerButtons.forEach((button) => { button.disabled = false; });
      if (saveButton) saveButton.disabled = false;
      return;
    }
    status.textContent = 'Checklist salvo.';
    dialog.close();
    ensureChecklistDailyReportOpen(day);
    await loadDailyChecklist(stations, day);
  };
  actions.querySelector('[data-checklist-banner-answer="SIM"]')?.addEventListener('click', () => void saveAnswer('SIM'));
  actions.querySelector('[data-checklist-banner-answer="NAO"]')?.addEventListener('click', () => {
    if (!checklistBannerWritable()) return;
    const commitment = checker.querySelector('.checklist-station-commitment');
    if (commitment) commitment.hidden = false;
    const justification = actions.querySelector('[data-checklist-justification]');
    const saveButton = actions.querySelector('[data-checklist-banner-save]');
    if (justification) justification.hidden = false;
    if (saveButton) saveButton.hidden = false;
    status.textContent = 'Descreva a ocorrência para continuar.';
    actions.querySelector('#checklist-station-occurrence')?.focus();
  });
  actions.querySelector('[data-checklist-banner-save]')?.addEventListener('click', () => void saveAnswer('NAO'));
  actions.querySelectorAll('[data-checklist-station-active]').forEach((toggleButton) => toggleButton.addEventListener('click', async () => {
    if (!maintenanceBannerWritable()) return;
    const nextActive = toggleButton.dataset.checklistStationActive === 'true';
    if (!nextActive && !window.confirm(`Confirma a inativação de ${station.name || station.id}?`)) return;
    toggleButton.disabled = true;
    status.textContent = nextActive ? 'Liberando arsenal…' : 'Inativando arsenal…';
    try {
      const {saveChecklistStation} = await import('./data.js');
      if (!maintenanceBannerWritable()) return;
      await saveChecklistStation({stationId: station.id, name: station.name, qrCode: station.qrCode, start: station.start || '', end: station.end || '', order: Number(station.order) || 0, active: nextActive}, maintenanceUid);
      if (!maintenanceBannerWritable()) return;
      station.active = nextActive;
      dialog.close();
      ensureChecklistDailyReportOpen(day);
      await loadDailyChecklist(stations, day);
    } catch (error) {
      if (maintenanceBannerWritable()) status.textContent = error.code === 'permission-denied' ? 'Seu perfil não tem permissão para alterar este arsenal.' : error.message || 'Não foi possível atualizar o arsenal.';
      if (maintenanceBannerWritable()) toggleButton.disabled = false;
    }
  }));
  document.querySelector('#checklist-station-close').onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
  title?.focus({preventScroll: true});
  if (checkerSummary?.creatorUid && !checkerSummary.name && !checkerSummary.pending && can('usersManage')) {
    void (async () => {
      try {
        const {getChecklistCreatorName} = await import('./data.js');
        if (!maintenanceBannerCurrent() || !can('usersManage')) return;
        const name = await getChecklistCreatorName(checkerSummary.creatorUid);
        if (!maintenanceBannerCurrent() || !can('usersManage')) return;
        const target = checker.querySelector('[data-checklist-checker-name]');
        if (target && name) target.textContent = shortChecklistCheckerName(name);
      } catch { /* O nome legado não é inferido quando a leitura não está disponível. */ }
    })();
  }
}

async function openChecklistQrScanner(stations, day) {
  const dialog = document.querySelector('#checklist-qr-dialog');
  const video = document.querySelector('#checklist-qr-video');
  const status = document.querySelector('#checklist-qr-status');
  const focus = document.querySelector('#checklist-qr-focus');
  if (!dialog || !video || !status || !focus) return;
  stopChecklistQrScanner();
  const scannerUid = session.user?.uid;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {willReadFrequently: true});
  let stream = null;
  let frame = 0;
  let timer = 0;
  let running = true;
  let detector = null;
  const cleanup = () => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    dialog.removeEventListener('close', handleClose);
    stream?.getTracks().forEach((track) => track.stop());
    if (stream && video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
      video.hidden = true;
      focus.hidden = true;
    }
    stream = null;
    if (stopChecklistQrScan === cleanup) stopChecklistQrScan = null;
  };
  const handleClose = () => {
    // close is queued: an earlier close must not stop a reopened dialog.
    if (!dialog.open && stopChecklistQrScan === cleanup) cleanup();
  };
  stopChecklistQrScan = cleanup;
  dialog.checklistQrScannerToken = cleanup;
  const scannerCurrent = () => running && dialog.open && stopChecklistQrScan === cleanup &&
    document.querySelector('#checklist-qr-dialog') === dialog && currentRoute() === 'checklist' &&
    Boolean(scannerUid) && session.user?.uid === scannerUid && can('checklistWrite') && day === todayInputValue();
  dialog.addEventListener('close', handleClose);
  document.querySelector('#checklist-qr-close').onclick = () => {
    if (document.querySelector('#checklist-qr-dialog') !== dialog || dialog.checklistQrScannerToken !== cleanup || (stopChecklistQrScan && stopChecklistQrScan !== cleanup)) return;
    cleanup();
    if (dialog.open) dialog.close();
  };
  const resolveChecklistQr = (raw) => {
    if (!scannerCurrent()) return;
    const station = findStationForQr(stations, raw, day, {includeInactive: can('checklistManage')});
    if (!station) { status.textContent = 'QR lido, mas não cadastrado no catálogo desta data.'; return; }
    cleanup();
    if (dialog.open) dialog.close();
    revealChecklistStation(station, day, stations);
  };
  const confirmQr = createChecklistQrConfirmation({maxGapMs: 5000});
  const captureGuide = (maxSize = 640) => {
    if (!context || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
    const crop = checklistQrCrop({videoWidth: video.videoWidth, videoHeight: video.videoHeight,
      videoRect: video.getBoundingClientRect(), focusRect: focus.getBoundingClientRect()});
    if (!crop) return false;
    const scale = Math.min(1, maxSize / Math.max(crop.width, crop.height));
    canvas.width = Math.max(1, Math.round(crop.width * scale));
    canvas.height = Math.max(1, Math.round(crop.height * scale));
    context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    return true;
  };
  const decodeWithFallback = () => window.ZXing && context
    ? decodeQrImageData(context.getImageData(0, 0, canvas.width, canvas.height), window.ZXing) : null;
  status.hidden = false;
  status.textContent = 'Solicitando acesso à câmera…';
  dialog.showModal();
  document.querySelector('#checklist-qr-close')?.focus({preventScroll: true});
  if (!scannerCurrent()) { cleanup(); return; }
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = 'A câmera exige HTTPS e permissão do navegador. Abra o app no Safari ou Chrome e autorize a câmera.';
    cleanup();
    return;
  }
  // Load the Safari decoder while the camera permission/stream is opening.
  const decoderReady = loadQrDecoder().then(() => null, (error) => error);
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}, audio: false});
    if (!scannerCurrent()) { stream.getTracks().forEach((track) => track.stop()); stream = null; return; }
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.hidden = false;
    focus.hidden = false;
    await video.play();
    if (!scannerCurrent()) { cleanup(); return; }
    // Autofocus is optional; device capability errors must not disable decoding.
    try {
      const cameraTrack = stream.getVideoTracks()[0];
      const capabilities = cameraTrack?.getCapabilities?.() || {};
      if (capabilities.focusMode?.includes('continuous') && typeof cameraTrack.applyConstraints === 'function') {
        void Promise.resolve(cameraTrack.applyConstraints({advanced: [{focusMode: 'continuous'}]})).catch(() => {});
      }
    } catch { /* Keep reading with the camera's supported settings. */ }
    if (!scannerCurrent()) { cleanup(); return; }
    if (typeof window.BarcodeDetector === 'function') {
      try { detector = new window.BarcodeDetector({formats: ['qr_code']}); } catch { detector = null; }
    }
    if (!detector) {
      const decoderError = await decoderReady;
      if (!scannerCurrent()) { cleanup(); return; }
      if (decoderError) throw decoderError;
    }
    status.textContent = 'Centralize o QR e mantenha a câmera estável.';
    let detecting = false;
    const scan = async () => {
      if (!scannerCurrent()) { cleanup(); return; }
      if (detecting) return;
      detecting = true;
      let raw = null;
      let ambiguous = false;
      try {
        if (!captureGuide()) throw new Error('Aguardando imagem da câmera…');
        if (detector) {
          try {
            const results = await detector.detect(canvas);
            if (!scannerCurrent()) { cleanup(); return; }
            const values = [...new Set(results.map(item => item.rawValue).filter(Boolean))];
            ambiguous = values.length > 1;
            raw = values.length === 1 ? values[0] : null;
          } catch {
            detector = null;
            const decoderError = await decoderReady;
            if (!scannerCurrent()) { cleanup(); return; }
            if (decoderError) throw decoderError;
          }
        }
        if (!raw && !ambiguous && window.ZXing) {
          raw = decodeWithFallback();
          // Keep a larger fallback for small or damaged codes without taxing every frame.
          if (!raw && captureGuide(1280)) raw = decodeWithFallback();
        }
      } catch (error) {
        if (scannerCurrent()) status.textContent = error.message || 'Não foi possível ler a imagem da câmera.';
      } finally {
        detecting = false;
      }
      if (!scannerCurrent()) { cleanup(); return; }
      const known = raw && findStationForQr(stations, raw, day, {includeInactive: can('checklistManage')});
      const confirmed = confirmQr(known ? raw : null, {reset: ambiguous || Boolean(raw && !known)});
      if (confirmed) { resolveChecklistQr(confirmed); return; }
      if (ambiguous) status.textContent = 'Há mais de um QR na moldura. Centralize somente o QR da estação desejada.';
      else if (raw && !known) status.textContent = 'QR lido, mas não cadastrado no catálogo desta data.';
      else if (known) status.textContent = 'QR reconhecido. Mantenha a câmera estável para confirmar.';
      timer = window.setTimeout(() => { frame = requestAnimationFrame(scan); }, 100);
    };
    frame = requestAnimationFrame(scan);
  } catch (error) {
    if (!scannerCurrent()) { cleanup(); return; }
    cleanup();
    status.textContent = error.name === 'NotAllowedError'
      ? 'Permissão da câmera negada. Autorize a câmera para este app nos ajustes do navegador.'
      : `Não foi possível iniciar o leitor. ${error.message || ''}`;
  }
}

function stopChecklistQrScanner(closeDialog = true) {
  stopChecklistQrScan?.();
  stopChecklistQrScan = null;
  const dialog = document.querySelector('#checklist-qr-dialog');
  if (closeDialog && dialog?.open) dialog.close();
}

async function loadMonthlyChecklist(stations, suppliedResult = null, scope = null) {
  const content = document.querySelector('#module-content');
  if (!content) return;
  const month = document.querySelector('#checklist-month')?.value || todayInputValue().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    content.innerHTML = '<p class="empty-state">Selecione um mês válido.</p>';
    return;
  }
  if (!suppliedResult) return startReportLive('checklist');
  if (!reportScopeCurrent(scope)) return;
  try {
    const result = suppliedResult;
    const today = todayInputValue();
    const days = summarizeChecklistMonth(month, today, stations, result.records, result.priorRecords);
    const rows = days.map((summary) => {
      const day = summary.day;
      const sync = summary.pendingSync ? '<small class="record-meta">Há ação(ões) aguardando sincronização</small>' : '';
      return `<button class="checklist-month-row" type="button" data-checklist-open-day="${day}" ${summary.mode === 'future' ? 'disabled' : ''}><strong>${escapeHtml(formatRecordDate(day))}</strong><span>${summary.text}</span>${sync}<span class="arrow" aria-hidden="true">›</span></button>`;
    }).join('');
      reconcileReportMarkup(content, `${result.stale ? '<p class="sync-state">Sem conexão: exibindo o resumo salvo neste aparelho.</p>' : ''}${result.truncated ? '<p class="sync-state">O volume do mês excede o limite desta consulta; este resumo pode estar incompleto.</p>' : ''}${result.historyIncomplete ? '<p class="sync-state">O histórico anterior não está completo neste cache; respostas herdadas podem faltar.</p>' : ''}<p class="checklist-report-note">Resumo dos registros encontrados no Firestore. Um NÃO anterior permanece indicado até nova resposta, conforme a regra do Checklist. A assinatura é feita no relatório diário do dia atual.</p><div class="checklist-month-list">${rows}</div>${result.nextCursor ? '<button class="secondary-button" type="button" id="checklist-report-more">Carregar mais registros do mês</button>' : ''}`);
    const more = content.querySelector('#checklist-report-more');
    if (more) more.onclick = () => void startReportLive('checklist', {append: true});
    content.querySelectorAll('[data-checklist-open-day]').forEach((button) => button.onclick = async () => {
      if (!reportScopeCurrent(scope)) return;
      checklistReportMode = 'daily';
      checklistReportOpen = true;
      const day = button.dataset.checklistOpenDay;
      const reportDayInput = document.querySelector('#checklist-report-day');
      if (reportDayInput) reportDayInput.value = day;
      const dialog = document.querySelector('#checklist-report-dialog');
      if (dialog && !dialog.open) dialog.showModal();
      const title = document.querySelector('#checklist-report-title');
      if (title) title.textContent = 'RELATÓRIO DIÁRIO - CHECKLIST';
      document.querySelector('#checklist-day-control').hidden = false;
      document.querySelector('#checklist-month-control').hidden = true;
      const next = document.querySelector('#checklist-report-next');
      if (next) next.disabled = day >= todayInputValue();
      const today = document.querySelector('#checklist-report-today');
      if (today) today.disabled = day === todayInputValue();
      await loadDailyChecklist(stations, day);
    });
  } catch (error) {
    if (!reportScopeCurrent(scope)) return;
    content.innerHTML = `<p class="empty-state">Não foi possível carregar o relatório mensal. ${escapeHtml(error.message || '')}</p>`;
  }
}

async function saveChecklistAnswer(stationId, condition, day, occurrenceValue = '', {uid = session.user?.uid, isCurrent = () => true} = {}) {
  const actorName = session.profile?.displayName;
  const namedAuthor = typeof actorName === 'string' && actorName.length > 0 && actorName.length <= 120 ? {createdByName: actorName} : {};
  const sessionCurrent = () => Boolean(uid) && session.user?.uid === uid && can('checklistWrite') && isCurrent();
  if (!sessionCurrent()) return {ok: false, message: 'A sessão ou a permissão do Checklist foi alterada.'};
  if (checklistDayMode(day, todayInputValue()) !== 'today') return {ok: false, message: 'O Checklist só pode ser registrado na data de hoje.'};
  const occurrence = condition === 'NAO' ? String(occurrenceValue || '').trim() : '';
  if (condition === 'NAO' && !occurrence) return {ok: false, message: 'Descreva a ocorrência antes de registrar a não conformidade.'};
  try {
    const {createOperationalRecord} = await import('./data.js');
    if (!sessionCurrent() || checklistDayMode(day, todayInputValue()) !== 'today') return {ok: false, message: 'A sessão, a permissão ou a data do Checklist foi alterada.'};
    // A atribuição do responsável só é definida após validação no servidor.
    const result = await createOperationalRecord('checklists', {...namedAuthor, stationId, date: day, condition, status: condition === 'SIM' ? 'COMPLETED' : 'MAINTENANCE', occurrence, responsibleUid: null, responsibleName: null, responsibleEmail: null}, {uid});
    return {ok: true, pendingFirestore: result.pendingFirestore === true};
  } catch (error) {
    return {ok: false, message: error.code === 'permission-denied' ? 'Seu perfil não tem permissão para registrar checklist.' : `Não foi possível salvar. ${error.message || ''}`};
  }
}

async function loadEventReport(options = {}) {
  return startReportLive('events', options);
}

function eventCreatedAtValue(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const date = value ? new Date(value).getTime() : 0;
  return Number.isFinite(date) ? date : 0;
}

function renderEventReportRecords({append = false} = {}) {
  const target = document.querySelector('#event-report-results');
  if (!target) return;
  const records = eventReportSourceRecords;
  const hasPending = eventReportSourceRecords.some((item) => item.pendingEdit || item.pendingSync || item.pendingFirestore || item.syncFailed || item.syncConflict || item.hasPendingWrites);
  loadedEventReportRecords = confirmedLiveReportRecords(records).filter(item => !item.pendingEdit);
  const pdfButton = document.querySelector('#share-events-pdf');
  if (pdfButton) pdfButton.disabled = loadedEventReportRecords.length === 0;
  const syncNotice = eventReportStale && eventReportSourceRecords.some((item) => !item.pendingFirestore && !item.syncFailed)
    ? '<p class="sync-state">A conexão caiu durante a consulta. Os registros confirmados já exibidos permanecem somente nesta tela; próximos blocos dependem da conexão e o histórico não é salvo localmente.</p>'
    : eventReportStale
      ? '<p class="sync-state">Sem conexão: esta lista mostra somente eventos locais que ainda aguardam confirmação. Registros confirmados anteriormente não ficam em cache.</p>'
    : hasPending
      ? '<p class="sync-state">Há eventos locais pendentes ou recusados. Eles ficam fora dos arquivos até o Firestore confirmar a gravação.</p>'
      : '';
  const empty = eventReportStale ? 'Não há eventos locais pendentes neste período.' : 'Nenhum evento neste período.';
  const heading = eventReportMode === 'daily'
    ? `<h3 class="event-report-period-heading">${escapeHtml(formatRecordDate(document.querySelector('#event-report-day')?.value || document.querySelector('#event-schedule-date')?.value || todayInputValue()))}</h3>`
    : `<h3 class="event-report-period-heading">${escapeHtml(new Intl.DateTimeFormat('pt-BR', {month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo'}).format(new Date(`${document.querySelector('#event-report-month')?.value || todayInputValue().slice(0, 7)}-15T12:00:00`)))}</h3>`;
  const recordMarkup = (item, index = records.indexOf(item)) => {
    const confirmed = !item.pendingEdit && !item.pendingSync && !item.pendingFirestore && !item.syncFailed && !item.syncConflict && !item.hasPendingWrites;
    const showHistory = eventReportMode === 'daily' && confirmed;
    const canEdit = eventReportMode === 'daily' && can('admin') && confirmed;
    const registration = eventReportMode === 'daily' ? `<small class="event-registration">Responsável pelo registro: ${escapeHtml(item.createdByName || item.createdByUid || 'Não informado')} · ${escapeHtml(interactionDateTime(item.createdAt) || 'Horário indisponível')}</small>` : '';
    const status = item.pendingEdit && item.syncFailed ? 'Rascunho de edição não confirmado' : item.pendingEdit ? 'Edição aguardando confirmação' : item.syncFailed ? 'Registro recusado pelo Firestore' : item.pendingFirestore ? 'Aguardando confirmação do Firestore' : '';
    const amount = item.amountToPay != null && item.amountToPay !== '' ? `<small class="record-meta">Valor: R$ ${Number(item.amountToPay).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</small>` : '';
    if (eventReportMode === 'daily') {
      const recordId = escapeHtml(item.id);
      const fields = [
        ['DATA', formatRecordDate(item.date)], ['MEMBRO / SITUAÇÃO', item.memberStatus],
        ['TIPO DE EVENTO', item.eventType], ['DESCRIÇÃO', item.description],
        ['TURNO', item.shift], ['SUBSTITUTO', item.substitute], ['PAGADOR', item.payer], ['CREDOR', item.creditor],
        ...(item.delayMultiple != null && item.delayMultiple !== '' ? [['MÚLTIPLO DO ATRASO', String(item.delayMultiple)]] : []),
        ...(item.amountToPay != null && item.amountToPay !== '' ? [['VALOR A PAGAR', 'R$ ' + Number(item.amountToPay).toLocaleString('pt-BR', {minimumFractionDigits: 2})]] : [])
      ];
      return `<li class="label-daily-record event-daily-record${confirmed ? '' : ' event-daily-record--pending'}" data-event-record="${recordId}" data-record-version="${Number(item.version) || 1}"><span class="label-record-index" aria-label="Registro ${index + 1}">${index + 1}</span><div class="label-record-fields">${fields.map(([label, value]) => `<div class="label-record-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('')}</div><div class="label-record-responsible"><span>RESPONSÁVEL PELO REGISTRO</span><strong>${escapeHtml(item.createdByName || item.createdByUid || 'Não informado')}</strong></div>${status ? `<small class="sync-state">${escapeHtml(status)}${item.syncError ? ` · ${escapeHtml(item.syncError)}` : ''}</small>` : ''}<div class="label-record-actions">${canEdit ? `<button class="secondary-button" type="button" data-event-edit="${recordId}">EDITAR REGISTRO</button>` : ''}${showHistory ? `<button class="secondary-button" type="button" data-event-history="${recordId}" aria-expanded="false" aria-controls="event-history-${recordId}">Histórico</button>` : ''}</div>${showHistory ? `<section class="label-history event-history" id="event-history-${recordId}" data-event-history-panel="${recordId}" aria-label="Histórico do evento" hidden></section>` : ''}</li>`;
    }
    return `<li class="event-record-banner${confirmed ? '' : ' event-record-banner--pending'}" data-event-record="${escapeHtml(item.id)}"><div class="event-record-banner__heading"><div><strong>${escapeHtml(item.memberStatus || 'Evento')}</strong><span>${escapeHtml(item.eventType || 'Outros')}</span></div></div><div class="event-record-banner__details"><small>${escapeHtml(formatRecordDate(item.date))}${item.shift ? ` · ${escapeHtml(item.shift)}` : ''}${item.substitute ? ` · Substituto: ${escapeHtml(item.substitute)}` : ''}</small>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}${amount}${registration}${status ? `<small class="sync-state">${escapeHtml(status)}${item.syncError ? ` · ${escapeHtml(item.syncError)}` : ''}</small>` : ''}${showHistory ? `<section class="event-history" data-event-history-panel="${escapeHtml(item.id)}" aria-label="Edições do evento">Carregando edições…</section>` : ''}</div></li>`;
  };
  const bannerList = records.length ? `<ul class="event-record-banner-list${eventReportMode === 'daily' ? ' record-list' : ''}">${records.map(recordMarkup).join('')}</ul>` : `<p class="empty-state">${empty}</p>`;
  const moreButton = eventReportCursor ? `<button class="secondary-button" type="button" id="event-report-more" ${navigator.onLine ? '' : 'disabled'}>${navigator.onLine ? 'Carregar mais registros' : 'Conecte-se para carregar mais'}</button>` : '';
  const scope = liveReports.get('events')?.snapshot().scope;
  const changedHistory = [...target.querySelectorAll('[data-event-record]')].filter(card => {
    const item = records.find(record => record.id === card.dataset.eventRecord);
    const panel = card.querySelector('[data-event-history-panel]');
    return item && (Number(card.dataset.recordVersion) !== (Number(item.version) || 1) || panel?.dataset.loading === 'true' && panel._eventHistoryScopeKey !== liveReports.get('events')?.snapshot().scope?.key);
  }).map(card => card.dataset.eventRecord);
  const incomplete = eventReportCursor ? '<p class="sync-state">Há mais registros. Totais e PDF correspondem somente aos registros carregados.</p>' : '';
  reconcileReportMarkup(target, `${heading}${syncNotice}${bannerList}${incomplete}${moreButton}`, {preserveSelectors: ['[data-event-history-panel]', '[data-event-history][aria-expanded="true"]', '.report-export-status']});
  target.querySelectorAll('[data-event-edit]').forEach((button) => button.onclick = () => { if (reportScopeCurrent(scope)) beginEventEdit(eventReportSourceRecords.find((item) => item.id === button.dataset.eventEdit)); });
  target.querySelectorAll('[data-event-history]').forEach((button) => {
    button.onclick = async () => {
      if (!reportScopeCurrent(scope)) return;
      const panel = target.querySelector(`[data-event-history-panel="${CSS.escape(button.dataset.eventHistory)}"]`);
      if (!panel) return;
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      button.textContent = panel.hidden ? 'Histórico' : 'Fechar histórico';
      if (panel.hidden || panel.dataset.loaded === 'true' || panel.dataset.loading === 'true') return;
      await loadDailyEventEditNotes(eventReportSourceRecords.filter(item => item.id === button.dataset.eventHistory), target);
    };
  });
  const more = target.querySelector('#event-report-more');
  if (more) more.onclick = event => { event.currentTarget.disabled = true; void loadEventReport({append: true}); };
  for (const id of changedHistory) { const panel = target.querySelector('[data-event-history-panel="' + CSS.escape(id) + '"]'); if (panel) { delete panel.dataset.loaded; delete panel.dataset.loading; if (!panel.hidden) void loadDailyEventEditNotes(records.filter(item => item.id === id), target); } }
}

function renderRecordEditHistory(history, labels, formatValue = (value) => value == null || value === '' ? '—' : Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value)) {
  return history.length ? `<ol>${history.map((entry) => `<li><strong>${escapeHtml(interactionDateTime(entry.createdAt) || 'Horário indisponível')}</strong><small>Responsável: ${escapeHtml(entry.actorName || entry.actorUid || 'Não informado')}</small><ul>${(entry.changedFields || []).map((field) => `<li><strong>${escapeHtml(labels[field] || field)}</strong><small>Antes: ${escapeHtml(formatValue(entry.before?.[field], field))}</small><small>Depois: ${escapeHtml(formatValue(entry.after?.[field], field))}</small></li>`).join('')}</ul></li>`).join('')}</ol>` : '<small>Nenhuma alteração registrada.</small>';
}

async function loadDailyEventEditNotes(records, target) {
  const scope = liveReports.get('events')?.snapshot().scope;
  const uid = session.user?.uid;
  const changed = confirmedLiveReportRecords(records).filter(item => !item.pendingEdit);
  if (!changed.length || !reportScopeCurrent(scope)) return;
  const labels = {date: 'Data', memberSigla: 'Sigla do membro', scheduleSigla: 'Sigla da escala', memberStatus: 'Membro / situação', eventType: 'Tipo de evento', description: 'Descrição', delayMultiple: 'Múltiplo do atraso', substitute: 'Substituto', shift: 'Turno', payer: 'Pagador', creditor: 'Credor', amountToPay: 'Valor', status: 'Status'};
  const value = item => item == null || item === '' ? '—' : typeof item === 'object' ? JSON.stringify(item) : String(item);
  await Promise.all(changed.map(async item => {
    const panel = target.querySelector('[data-event-history-panel="' + CSS.escape(item.id) + '"]');
    if (!panel) return;
    const token = {};
    panel._eventHistoryRequest = token;
    panel._eventHistoryScopeKey = scope.key;
    const current = () => panel._eventHistoryRequest === token && panel.isConnected && target.isConnected &&
      session.user?.uid === uid && reportScopeCurrent(scope) && liveReports.get('events')?.snapshot().scope?.key === scope.key &&
      Number(eventReportSourceRecords.find(record => record.id === item.id)?.version || 0) === Number(item.version || 1);
    panel.dataset.loading = 'true';
    panel.innerHTML = '<small class="loading">Carregando histórico…</small>';
    try {
      const {listEventHistory} = await import('./data.js');
      if (!current()) return;
      const history = await listEventHistory(item.id, {pageSize: 50});
      if (!current()) return;
      panel.innerHTML = renderRecordEditHistory(history, labels, value);
      panel.dataset.loaded = 'true';
    } catch (error) {
      if (current()) panel.innerHTML = '<small>Não foi possível carregar as edições. ' + escapeHtml(error.message || '') + '</small>';
    } finally {
      if (current()) panel.dataset.loading = 'false';
    }
  }));
}

function beginEventEdit(item) {
  if (eventReportMode !== 'daily' || !can('admin')) return;
  const form = document.querySelector('[data-module-form="events"]');
  if (!form || !item) return;
  const status = document.querySelector('#event-form-status');
  const conflictRefresh = document.querySelector('#event-conflict-refresh');
  if (status) status.textContent = '';
  if (conflictRefresh) conflictRefresh.hidden = true;
  for (const name of ['payer', 'creditor', 'substitute']) {
    const select = form.elements[name];
    const value = String(item[name] || '');
    if (value && ![...select.options].some((option) => option.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${value} · opção histórica`;
      select.append(option);
    }
  }
  setEventTypeContext(form, item.eventType === 'Suporte' ? 'support' : 'schedule');
  form.elements.editEventId.value = item.id;
  form.elements.editEventVersion.value = Number(item.version) || 1;
  for (const [name, value] of Object.entries({eventDate: item.date, memberSigla: item.memberSigla || '', scheduleSigla: item.scheduleSigla || '', memberStatus: item.memberStatus, eventType: item.eventType, delayMultiple: item.delayMultiple ?? '', substitute: item.substitute, shift: item.shift, payer: item.payer, creditor: item.creditor, amountToPay: item.amountToPay, description: item.description})) {
    if (form.elements[name]) form.elements[name].value = value ?? '';
  }
  form.elements.eventType.dispatchEvent(new Event('change', {bubbles: true}));
  form.querySelector('[type="submit"]').textContent = 'Atualizar evento';
  form.querySelector('#event-edit-cancel').hidden = false;
  form.elements.memberStatus.readOnly = false;
  const dialog = document.querySelector('#event-launch-dialog');
  dialog?.classList.add('event-launch-dialog--editing');
  const title = document.querySelector('#event-launch-title');
  if (title) {
    title.textContent = 'EDITAR EVENTO';
    title.setAttribute('tabindex', '-1');
    title.setAttribute('autofocus', '');
  }
  if (dialog && !dialog.open) dialog.showModal();
  title?.focus({preventScroll: true});
}

function resetEventEditor() {
  const form = document.querySelector('[data-module-form="events"]');
  if (!form) return;
  const status = document.querySelector('#event-form-status');
  const conflictRefresh = document.querySelector('#event-conflict-refresh');
  if (status) status.textContent = '';
  if (conflictRefresh) conflictRefresh.hidden = true;
  form.reset();
  setEventTypeContext(form, 'schedule');
  form.elements.memberStatus.readOnly = true;
  form.elements.editEventId.value = '';
  form.elements.editEventVersion.value = '';
  form.querySelector('[type="submit"]').textContent = 'Salvar evento';
  form.querySelector('#event-edit-cancel').hidden = true;
  updateEventEntryFields(form);
  const dialog = document.querySelector('#event-launch-dialog');
  dialog?.classList.remove('event-launch-dialog--editing');
  const title = document.querySelector('#event-launch-title');
  if (title) {
    title.textContent = 'LANÇAMENTO DO EVENTO';
    title.setAttribute('autofocus', '');
    title.setAttribute('tabindex', '-1');
  }
  if (dialog?.open) dialog.close();
}

function updateLabelReportSync() {
  updateReportSync('labels');
}

async function loadLabelReport(options = {}) {
  return startReportLive('labels', options);
}

function renderLiveLabelReport(result, scope) {
  const target = scope?.targetNode || scope?.target || document.querySelector('#label-report-results');
  if (!target || !target.isConnected || document.querySelector('#label-report-results') !== target || !reportScopeCurrent(scope) || session.user?.uid !== scope.uid) return false;
  const records = [...(result.records || [])].sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')) || reportTimestamp(right.createdAt) - reportTimestamp(left.createdAt));
  const confirmed = (item) => !item.pendingEdit && !item.pendingSync && !item.pendingFirestore && !item.syncFailed && !item.syncConflict && item.hasPendingWrites !== true && item.metadata?.hasPendingWrites !== true;
  const mayEdit = (item) => scope.mode === 'daily' && confirmed(item) && (scope.canWrite || scope.canManage) &&
    (item.createdByUid === scope.uid || scope.canManage || (scope.sigla && item.staffSiglas?.includes(String(scope.sigla).trim().toUpperCase())));
  const viewKey = JSON.stringify([scope.uid, scope.mode, scope.from, scope.to, scope.day, scope.month, scope.sigla, scope.canManage, scope.canWrite, scope.isAdmin]);
  const scopeChanged = target._labelReportScopeKey !== viewKey;
  const previousVersions = new Map([...target.querySelectorAll('[data-label-record]')].map(card => [card.dataset.labelRecord, card.dataset.recordVersion]));
  if (scopeChanged) {
    target.querySelectorAll('[data-label-history-content]').forEach(panel => {
      panel._labelHistoryRequest = null;
      delete panel.dataset.historyLoaded;
      delete panel.dataset.historyLoading;
    });
  }
  loadedLabelRecords = records.filter(confirmed);
  labelReportCursor = result.nextCursor || null;
  const exportButton = document.querySelector('#export-labels');
  const pdfButton = document.querySelector('#share-labels-pdf');
  if (exportButton) exportButton.disabled = loadedLabelRecords.length === 0;
  if (pdfButton) pdfButton.disabled = loadedLabelRecords.length === 0;
  const daily = scope.mode === 'daily';
  const reportHeading = daily ? `<h3 class="event-report-day-heading">Etiquetas · ${escapeHtml(formatRecordDate(scope.day || scope.from))}</h3>` : '';
  const markup = `${reportHeading}${records.length ? `<ul class="record-list">${records.map((item) => {
    const recordId = escapeHtml(item.id);
    const history = daily && confirmed(item) ? `<button class="secondary-button" type="button" data-label-history="${recordId}" aria-expanded="false" aria-controls="label-history-${recordId}">Histórico</button>` : '';
    const registration = daily ? `<div class="label-record-responsible"><span>RESPONSÁVEL PELO REGISTRO</span><strong>${escapeHtml(item.createdByName || 'Não informado')}</strong></div>` : '';
    const historyPanel = daily && confirmed(item) ? `<div id="label-history-${recordId}" class="label-history" data-label-history-content="${recordId}" hidden></div>` : '';
    const syncText = item.syncFailed || item.syncConflict ? 'Registro não confirmado · revisar sincronização' : !confirmed(item) ? 'Aguardando confirmação do Firestore' : '';
    const pending = syncText ? `<small class="sync-state">${escapeHtml(syncText)}</small>` : '';
    if (daily) {
      const fields = [
        ['DATA', formatRecordDate(item.date)], ['NOME DO PACIENTE', item.patientName], ['CONVÊNIO', item.insurance],
        ['CIRURGIA', item.procedureCode], ['ATENDIMENTO', item.encounterCode], ['TIPO', item.type],
        ['CREDOR', item.creditor], ['PLANTONISTA(S)', item.staffSiglas?.join(', ')],
        ...(item.amount != null ? [['VALOR EM REAL', `R$ ${Number(item.amount).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`]] : [])
      ];
      return `<li class="label-daily-record" data-label-record="${recordId}" data-record-version="${escapeHtml(item.version || 1)}"><span class="label-record-index" aria-label="Registro ${records.indexOf(item) + 1}">${records.indexOf(item) + 1}</span><div class="label-record-fields">${fields.map(([label, value]) => `<div class="label-record-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('')}</div>${registration}${pending}<div class="label-record-actions">${mayEdit(item) ? `<button class="secondary-button" type="button" data-label-edit="${recordId}">EDITAR REGISTRO</button>` : ''}${history}</div>${historyPanel}</li>`;
    }
    return `<li data-label-record="${recordId}" data-record-version="${escapeHtml(item.version || 1)}"><div class="contact-list-heading"><strong>${escapeHtml(item.patientName || 'Etiqueta')} · ${escapeHtml(formatRecordDate(item.date))}</strong></div><small>${escapeHtml(item.type || '')}${item.encounterCode ? ` · Atendimento ${escapeHtml(item.encounterCode)}` : ''}${item.procedureCode ? ` · Cirurgia ${escapeHtml(item.procedureCode)}` : ''}</small><small>${escapeHtml(item.creditor || '')}${item.staffSiglas?.length ? ` · ${escapeHtml(item.staffSiglas.join(', '))}` : ''}${item.insurance ? ` · ${escapeHtml(item.insurance)}` : ''}</small>${item.amount != null ? `<small class="record-meta">Valor: R$ ${Number(item.amount).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</small>` : ''}${pending}</li>`;
  }).join('')}</ul>` : '<p class="empty-state">Nenhuma etiqueta neste período.</p>'}${labelReportCursor ? `<p class="sync-state">Há mais registros. Totais e PDF correspondem somente aos registros carregados.</p><button class="secondary-button" type="button" id="label-report-more" ${navigator.onLine ? '' : 'disabled'}>${navigator.onLine ? 'Carregar mais registros' : 'Conecte-se para carregar mais'}</button>` : ''}`;
  reconcileReportMarkup(target, markup, {preserveSelectors: scopeChanged ? [] : ['[data-label-history-content]', '[data-label-history][aria-expanded="true"]']});
  target._labelReportScopeKey = viewKey;
  target.querySelectorAll('[data-label-edit]').forEach((button) => {
    button.onclick = () => {
      if (!reportScopeCurrent(scope) || session.user?.uid !== scope.uid || !button.isConnected) return;
      const item = loadedLabelRecords.find((record) => record.id === button.dataset.labelEdit);
      if (item && mayEdit(item)) beginLabelEdit(item);
    };
  });
  target.querySelectorAll('[data-label-history]').forEach((button) => {
    const recordId = button.dataset.labelHistory;
    const historyTarget = target.querySelector(`[data-label-history-content="${CSS.escape(recordId)}"]`);
    const card = target.querySelector(`[data-label-record="${CSS.escape(recordId)}"]`);
    const revision = String(records.find(item => item.id === recordId)?.version || 1);
    const current = () => reportScopeCurrent(scope) && session.user?.uid === scope.uid && target.isConnected && button.isConnected && historyTarget?.isConnected && document.querySelector('#label-report-results') === target && target.querySelector(`[data-label-history-content="${CSS.escape(recordId)}"]`) === historyTarget && card?.dataset.recordVersion === revision;
    const loadHistory = async () => {
      if (!current() || historyTarget.hidden || historyTarget.dataset.historyLoaded === 'true' || historyTarget.dataset.historyLoading === 'true') return;
      const request = historyTarget._labelHistoryRequest = {};
      historyTarget._labelHistoryScopeKey = scope.key;
      const ownsRequest = () => current() && historyTarget._labelHistoryRequest === request;
      historyTarget.dataset.historyLoading = 'true';
      historyTarget.innerHTML = '<small class="loading">Carregando histórico…</small>';
      try {
        const {listLabelHistory} = await import('./data.js');
        if (!ownsRequest()) return;
        const history = await listLabelHistory(recordId);
        if (!ownsRequest()) return;
        const labels = {date: 'Data', patientName: 'Nome do paciente', encounterCode: 'Atendimento', procedureCode: 'Cirurgia', type: 'Tipo de etiqueta', amount: 'Valor', insurance: 'Convênio', creditor: 'Credor', staffSiglas: 'Plantonistas', consultation: 'Consulta pré-anestésica', status: 'Status'};
        historyTarget.innerHTML = renderRecordEditHistory(history, labels, (value, field) => {
          if (value == null || value === '') return '—';
          if (field === 'amount') return 'R$ ' + Number(value).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
          if (field === 'date') return formatRecordDate(value);
          if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
          return Array.isArray(value) ? value.join(', ') || '—' : String(value);
        });
        historyTarget.dataset.historyLoaded = 'true';
      } catch (error) {
        if (ownsRequest()) historyTarget.innerHTML = `<small>Não foi possível carregar o histórico. ${escapeHtml(error.message || '')}</small>`;
      } finally {
        if (ownsRequest()) historyTarget.dataset.historyLoading = 'false';
      }
    };
    button.onclick = () => {
      if (!current()) return;
      historyTarget.hidden = !historyTarget.hidden;
      button.setAttribute('aria-expanded', String(!historyTarget.hidden));
      button.textContent = historyTarget.hidden ? 'Histórico' : 'Fechar histórico';
      if (!historyTarget.hidden) void loadHistory();
    };
    const historyOwnerChanged = historyTarget?.dataset.historyLoading === 'true' && historyTarget._labelHistoryScopeKey !== scope.key;
    if (!scopeChanged && historyTarget && (previousVersions.get(recordId) !== revision || historyOwnerChanged)) {
      historyTarget._labelHistoryRequest = null;
      delete historyTarget.dataset.historyLoaded;
      delete historyTarget.dataset.historyLoading;
      if (!historyTarget.hidden) void loadHistory();
    }
  });
  const moreButton = target.querySelector('#label-report-more');
  if (moreButton) moreButton.onclick = () => {
    if (!reportScopeCurrent(scope) || session.user?.uid !== scope.uid || !moreButton.isConnected || !labelReportCursor || !navigator.onLine) return;
    moreButton.disabled = true;
    void loadLabelReport({append: true});
  };
  updateLabelReportSync();
  return true;
}

function beginLabelEdit(item) {
  if (labelReportMode !== 'daily') return;
  const form = document.querySelector('[data-module-form="labels"]');
  if (!form || !item) return;
  labelEntryGeneration++;
  form.dataset.labelEntrySource = 'edit';
  form.elements.editLabelId.value = item.id;
  form.elements.editLabelVersion.value = String(Math.max(1, Number(item.version) || 1));
  form.elements.type.value = item.type || '';
  form.elements.creditor.value = item.creditor || '';
  updateLabelEntryFields(form);
  for (const [name, value] of Object.entries({date: item.date, patientName: item.patientName, procedureCode: item.procedureCode, encounterCode: item.encounterCode, amount: item.amount ?? '', insurance: item.insurance})) {
    if (form.elements[name]) form.elements[name].value = value ?? '';
  }
  setLabelStaffSiglas(item.staffSiglas || []);
  form.querySelector('[type="submit"]').textContent = 'Atualizar etiqueta';
  form.querySelector('[type="submit"]').disabled = false;
  const editorTitle = document.querySelector('#label-entry-title');
  if (editorTitle) editorTitle.textContent = 'EDITAR ETIQUETA';
  form.querySelector('#label-edit-cancel').hidden = false;
  form.querySelector('#label-form-status').textContent = '';
  form.querySelector('#label-conflict-refresh').hidden = true;
  document.querySelector('#label-entry-dialog')?.showModal();
  form.elements.patientName.focus({preventScroll: true});
}

function resetLabelEditor({keepOpen = false} = {}) {
  const form = document.querySelector('[data-module-form="labels"]');
  if (!form) return;
  labelEntryGeneration++;
  form.dataset.labelEntrySource = '';
  form.reset();
  setLabelStaffSiglas([]);
  form.elements.date.value = todayInputValue();
  form.elements.editLabelId.value = '';
  form.elements.editLabelVersion.value = '';
  form.querySelector('[type="submit"]').textContent = 'Salvar registro';
  form.querySelector('[type="submit"]').disabled = false;
  const editorTitle = document.querySelector('#label-entry-title');
  if (editorTitle) editorTitle.textContent = 'REGISTRO DE ETIQUETA';
  form.querySelector('#label-edit-cancel').hidden = true;
  form.querySelector('#label-form-status').textContent = '';
  form.querySelector('#label-conflict-refresh').hidden = true;
  updateLabelEntryFields(form);
  if (!keepOpen) {
    const dialog = document.querySelector('#label-entry-dialog');
    if (dialog?.open) dialog.close();
  }
}

function exportLabelReport() {
  const columns = ['Data', 'Nome do Paciente', 'Cirurgia', 'Atendimento', 'Tipo', 'Valor', 'Convênio', 'Credor', 'Plantonistas'];
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [columns, ...loadedLabelRecords.map((item) => [item.date, item.patientName, item.procedureCode, item.encounterCode, item.type, item.amount ?? '', item.insurance, item.creditor, item.staffSiglas?.join(', ') || ''])];
  const blob = new Blob(['\ufeff', rows.map((row) => row.map(cell).join(';')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SAHMT-Etiquetas-${labelReportMode === 'daily' ? document.querySelector('#label-report-day')?.value : document.querySelector('#label-report-month')?.value}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportTimestamp(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatReportMonth(value) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value || ''));
  return match ? `${match[2]}-${match[1]}` : value;
}

async function shareReportPdf(kind) {
  const isLabel = kind === 'labels';
  const button = document.querySelector(isLabel ? '#share-labels-pdf' : '#share-events-pdf');
  const target = document.querySelector(isLabel ? '#label-report-results' : '#event-report-results');
  const records = confirmedLiveReportRecords(isLabel ? loadedLabelRecords : loadedEventReportRecords);
  const reportScope = liveReports.get(kind)?.snapshot().scope;
  if (!reportScopeCurrent(reportScope)) return;
  const partial = Boolean((kind === 'labels' ? labelReportCursor : eventReportCursor));
  if (!button || !target || !records.length) return;
  const period = isLabel
    ? (labelReportMode === 'daily' ? document.querySelector('#label-report-day')?.value : document.querySelector('#label-report-month')?.value)
    : (eventReportMode === 'daily' ? document.querySelector('#event-schedule-date')?.value : document.querySelector('#event-report-month')?.value);
  const mode = isLabel ? labelReportMode : eventReportMode;
  const pdfRecords = isLabel && mode === 'monthly'
    ? [...records].sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')) || reportTimestamp(left.createdAt) - reportTimestamp(right.createdAt))
    : records;
  const labelDateGroups = [];
  if (isLabel && mode === 'monthly') {
    let previousDate = null;
    let groupIndex = -1;
    let rowInGroup = 0;
    for (const item of pdfRecords) {
      if (item.date !== previousDate) {
        previousDate = item.date;
        groupIndex += 1;
        rowInGroup = 0;
      }
      labelDateGroups.push({groupIndex, rowInGroup});
      rowInGroup += 1;
    }
  }
  const optionalLabelColumns = [
    ['Convênio', (item) => item.insurance], ['Cirurgia', (item) => item.procedureCode],
    ['Atendimento', (item) => item.encounterCode], ['Tipo', (item) => item.type],
    ['Valor', (item) => item.amount == null ? '' : `R$ ${Number(item.amount).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`],
    ['Credor', (item) => item.creditor], ['Plantonista(s)', (item) => item.staffSiglas?.join(', ')]
  ].filter(([, getValue]) => pdfRecords.some((item) => String(getValue(item) ?? '').trim()));
  const columns = isLabel
    ? ['#', 'Data', 'Nome do Paciente', ...optionalLabelColumns.map(([label]) => label)]
    : ['#', 'Data', 'Sigla da escala', 'Sigla do membro', 'Membro/Situação', 'Tipo', 'Descrição', 'Múltiplo', 'Substituto', 'Turno', 'Pagador', 'Credor', 'Valor (R$)'];
  const rows = isLabel
    ? pdfRecords.map((item, index) => [index + 1, item.date, item.patientName, ...optionalLabelColumns.map(([, getValue]) => getValue(item) || '')])
    : pdfRecords.map((item, index) => [index + 1, item.date, item.scheduleSigla || '', item.memberSigla || '', item.memberStatus, item.eventType, item.description, item.delayMultiple ?? '', item.substitute, item.shift, item.payer, item.creditor, Number(item.amountToPay || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})]);
  const alertRowIndexes = isLabel ? pdfRecords.flatMap((item, index) => ['Particular', 'Complementação'].includes(item.type) ? [index] : []) : [];
  const alertCount = alertRowIndexes.length;
  button.disabled = true;
  let status = target.querySelector('.report-export-status');
  if (!status) {
    status = document.createElement('p');
    status.className = 'report-export-status';
    status.setAttribute('role', 'status');
    target.prepend(status);
  }
  status.textContent = 'Preparando PDF…';
  try {
    const {createAndSharePdf} = await loadReportPdfModule();
    if (!reportScopeCurrent(reportScope)) return;
    const title = isLabel ? 'ETIQUETAS SAHMT' : 'SAHMT · EVENTOS';
    const periodLabel = isLabel && mode === 'monthly' ? formatReportMonth(period) : period;
    const reportPeriod = `${mode === 'daily' ? 'Relatório diário' : 'Relatório mensal'} de ${periodLabel} · ${pdfRecords.length} entrada(s)${isLabel ? ` · ${alertCount} alerta(s)` : ''}${partial ? ' · PARCIAL: há registros ainda não carregados' : ''}`;
    const result = await createAndSharePdf({title, period: reportPeriod, fileName: `SAHMT-${isLabel ? 'Etiquetas' : 'Eventos'}-${period}`, columns, rows, orientation: isLabel ? 'landscape' : undefined, alertRowIndexes, labelDateGroups});
    status.textContent = result === 'shared' ? 'PDF aberto no compartilhamento do aparelho.' : 'PDF gerado e baixado neste aparelho.';
  } catch (error) {
    status.textContent = error?.name === 'AbortError' ? 'Compartilhamento cancelado.' : `Não foi possível gerar o PDF. ${error?.message || ''}`;
  } finally {
    if (button.isConnected) button.disabled = !records.length;
  }
}

async function loadManagementAreaActivities(area) {
  const detail = document.querySelector('#management-area-detail');
  const loadId = ++managementActivityLoad;
  const requestUid = session.user?.uid;
  if (!detail) return;
  if (!area) { detail.innerHTML = '<p class="empty-state">Selecione uma área.</p>'; return; }
  detail.innerHTML = `<header class="management-detail-heading"><div><p class="eyebrow">ATIVIDADES</p><h3>${escapeHtml(area.name || area.title || area.id)}</h3></div>${can('managementActivityWrite') ? '<button class="secondary-button" type="button" id="new-area-activity">Nova atividade</button>' : ''}</header><p class="loading">Carregando atividades…</p>`;
  detail.querySelector('#new-area-activity')?.addEventListener('click', () => {
    const form = document.querySelector('#activity-area');
    if (form) form.value = area.id;
    document.querySelector('[data-module-form]')?.scrollIntoView({behavior: 'smooth', block: 'center'});
    document.querySelector('[data-module-form] input[name="title"]')?.focus({preventScroll: true});
  });
  try {
    const {listManagementActivities, listManagementIndicators, listIndicatorMeasurements, listManagementActionPlans, listManagementActionPlanItems, listManagementDocuments, getManagementTaskScoringRule, listManagementActivityScoreReviews} = await import('./data.js');
    const canReviewActivityPoints = can('managementManage') || (can('qualityManage') && area.id === 'area-gestao-da-qualidade') ||
      (can('managementRead') && Array.isArray(area.managerUids) && area.managerUids.includes(session.user.uid));
    const [activities, indicators, plans, documents, scoringRule, scoreReviews] = await Promise.all([
      ['managementRead', 'managementActivityWrite'].some(can) ? listManagementActivities(area.id) : Promise.resolve([]),
      ['managementRead', 'managementIndicatorsRead', 'managementIndicatorsWrite'].some(can) ? listManagementIndicators(area.id, {pageSize: 12}) : Promise.resolve([]),
      ['managementRead', 'managementPlansManage'].some(can) ? listManagementActionPlans(area.id, {pageSize: 20}) : Promise.resolve([]),
      ['managementRead', 'documentsManage'].some(can) ? listManagementDocuments(area.id, {includeInactive: can('documentsManage'), pageSize: 100}) : Promise.resolve([]),
      can('managementManage') ? getManagementTaskScoringRule() : Promise.resolve(null),
      canReviewActivityPoints ? listManagementActivityScoreReviews(area.id, {pageSize: 50}) : Promise.resolve([])
    ]);
    const scoreReviewByActivity = new Map(scoreReviews.map((review) => [review.activityId, review]));
    const measurements = await Promise.all(indicators.map((indicator) => listIndicatorMeasurements(indicator.id, {pageSize: 6})));
    const planItems = plans.length ? await listManagementActionPlanItems(plans.map((plan) => plan.id)) : [];
    const itemsByPlan = new Map();
    for (const item of planItems) {
      if (!itemsByPlan.has(item.planId)) itemsByPlan.set(item.planId, []);
      itemsByPlan.get(item.planId).push(item);
    }
    if (loadId !== managementActivityLoad || !detail.isConnected || session.user?.uid !== requestUid) return;
    const indicatorsView = indicators.length ? `<section class="management-indicators"><h4>Indicadores · ${indicators.length}</h4><div class="indicator-grid">${indicators.map((indicator, index) => {
      const recent = measurements[index] || [];
      const latest = recent[0];
      const trend = indicator.direction === 'MAX' ? 'Meta máxima' : indicator.direction === 'TARGET' ? 'Meta exata' : 'Meta mínima';
      const period = indicatorPeriodValue(indicator.frequency);
      return `<article class="indicator-card"><h5>${escapeHtml(indicator.name)}</h5><p>${escapeHtml(indicator.description || '')}</p><strong>Meta: ${escapeHtml(indicator.target)} ${escapeHtml(indicator.unit || '')}</strong><small class="record-meta">${trend} · ${escapeHtml(indicator.frequency || '')}</small>${latest ? `<small>Última medição (${escapeHtml(latest.period)}): ${escapeHtml(latest.value)} ${escapeHtml(indicator.unit || '')} · ${latest.status === 'MET' ? 'Meta atingida' : 'Meta pendente'}</small>${latest.notes ? `<small>${escapeHtml(latest.notes)}</small>` : ''}` : '<small>Sem medições registradas.</small>'}${can('managementIndicatorsWrite') ? `<form class="indicator-measure-form" data-indicator-id="${escapeHtml(indicator.id)}"><label>Período<input name="period" required maxlength="8" placeholder="2026-09" value="${period}"></label><label>Valor<input name="value" type="number" step="any" required></label><label>Observação<input name="notes" maxlength="800"></label><button class="secondary-button" type="submit">Registrar medição</button></form>` : ''}</article>`;
    }).join('')}</div></section>` : `<section class="management-indicators"><h4>Indicadores</h4><p class="empty-state">${can('managementIndicatorsWrite') ? 'Nenhum indicador cadastrado nesta área.' : 'Nenhum indicador disponível nesta área.'}</p></section>`;
    const indicatorForm = can('managementIndicatorsWrite') ? `<details class="quick-form indicator-create"><summary>Novo indicador</summary><form id="indicator-create-form"><input type="hidden" name="managementAreaId" value="${escapeHtml(area.id)}"><div class="form-grid"><label>Nome<input name="name" required maxlength="120"></label><label>Unidade<input name="unit" maxlength="40" placeholder="%, dias, unidades"></label><label>Meta<input name="target" type="number" step="any" required></label><label>Direção da meta<select name="direction"><option value="MIN">Atingir ou superar</option><option value="MAX">Manter até o limite</option><option value="TARGET">Atingir valor exato</option></select></label><label>Frequência<select name="frequency"><option value="MONTHLY">Mensal</option><option value="WEEKLY">Semanal</option><option value="QUARTERLY">Trimestral</option><option value="YEARLY">Anual</option></select></label></div><label>Descrição<textarea name="description" rows="2" maxlength="500"></textarea></label><button class="primary-button" type="submit">Criar indicador</button></form></details>` : '';
    const planForm = can('managementPlansManage') ? `<details class="quick-form"><summary>Novo plano de ação</summary><form id="action-plan-create-form"><input type="hidden" name="managementAreaId" value="${escapeHtml(area.id)}"><div class="form-grid"><label>Título<input name="title" required maxlength="160"></label><label>Prazo<input name="dueAt" type="date"></label><label>Prioridade<select name="priority"><option>Normal</option><option>Alta</option><option>Urgente</option></select></label></div><label>Descrição<textarea name="description" rows="2" maxlength="1200"></textarea></label><button class="primary-button" type="submit">Criar plano</button></form></details>` : '';
    const assignmentEditor = can('managementManage') ? `<details class="quick-form management-assignment-editor"><summary>Gestores e equipe</summary><p>Vincule contas pelos UIDs Firebase copiados na Administração. Use um UID por linha; nomes e e-mails não são armazenados aqui.</p><form id="management-assignment-form"><input type="hidden" name="version" value="${Number.isInteger(area.version) && area.version >= 0 ? area.version : 0}"><div class="form-grid"><label>UIDs de gestores<textarea name="managerUids" rows="3" maxlength="12999" placeholder="UID Firebase, um por linha">${escapeHtml((Array.isArray(area.managerUids) ? area.managerUids : []).join('\n'))}</textarea></label><label>UIDs da equipe<textarea name="memberUids" rows="3" maxlength="12999" placeholder="UID Firebase, um por linha">${escapeHtml((Array.isArray(area.memberUids) ? area.memberUids : []).join('\n'))}</textarea></label></div><button class="secondary-button" type="submit">Salvar vínculos</button><p class="record-meta" id="management-assignment-status" role="status" aria-live="polite"></p></form></details>` : '';
    const scoringRuleForm = can('managementManage') ? `<details class="quick-form" id="management-task-scoring"><summary>Pontuação por conclusão</summary><p>Concluir a tarefa não credita pontos automaticamente. Um gestor autorizado revisa cada solicitação; a alteração da regra afeta somente tarefas novas.</p><form id="management-task-scoring-form"><input type="hidden" name="version" value="${Number.isInteger(scoringRule?.version) ? scoringRule.version : 0}"><div class="form-grid"><label>Nome da regra<input name="name" required maxlength="120" value="${escapeHtml(scoringRule?.name || 'Conclusão de tarefa')}"></label><label>Pontos inteiros<input name="points" type="number" min="1" max="1000" step="1" required value="${escapeHtml(scoringRule?.points ?? 10)}"></label><label class="contact-active-field"><input name="active" type="checkbox" ${scoringRule?.active !== false ? 'checked' : ''}> Regra ativa</label></div><label>Descrição<textarea name="description" rows="2" maxlength="500">${escapeHtml(scoringRule?.description || 'Pontos concedidos após revisão independente da conclusão.')}</textarea></label><button class="secondary-button" type="submit">Salvar regra</button><p class="record-meta" id="management-task-scoring-status" role="status" aria-live="polite"></p></form></details>` : '';
    const plansView = `<section class="management-plans"><h4>Planos de ação · ${plans.length}</h4>${planItems.length >= 200 ? '<p class="sync-state">Exibindo até 200 ações detalhadas. Os planos continuam disponíveis.</p>' : ''}${plans.length ? `<ul class="record-list">${plans.map((plan) => {
      const items = itemsByPlan.get(plan.id) || [];
      const action = plan.responsibleUid === session.user.uid && plan.status === 'OPEN' ? `<button class="secondary-button" type="button" data-plan-id="${escapeHtml(plan.id)}" data-next-status="IN_PROGRESS">Iniciar plano</button>` : plan.responsibleUid === session.user.uid && plan.status === 'IN_PROGRESS' ? `<button class="secondary-button" type="button" data-plan-id="${escapeHtml(plan.id)}" data-next-status="COMPLETED">Concluir plano</button>` : '';
      const itemRows = items.length ? `<ul class="action-plan-item-list">${items.map((item) => {
        const responsibleUids = Array.isArray(item.responsibleUids) ? item.responsibleUids : [];
        const responsible = responsibleUids.includes(session.user.uid);
        return `<li><span>${escapeHtml(item.description)}${item.dueAt ? ` · Prazo ${escapeHtml(formatRecordDate(item.dueAt))}` : ''}</span><small>${item.status === 'COMPLETED' ? 'Concluída' : `${responsibleUids.length} responsável(is)`}</small>${item.status === 'OPEN' && responsible ? `<button class="secondary-button" type="button" data-plan-item-complete="${escapeHtml(item.id)}">Concluir ação</button>` : ''}</li>`;
      }).join('')}</ul>` : '<small class="record-meta">Nenhuma ação detalhada adicionada.</small>';
      const itemForm = can('managementPlansManage') && plan.responsibleUid === session.user.uid && plan.status !== 'COMPLETED' ? `<form class="action-plan-item-form" data-plan-item-form="${escapeHtml(plan.id)}"><label>Próxima ação<input name="description" required maxlength="500" placeholder="Descreva uma ação objetiva"></label><label>Prazo<input name="dueAt" type="date"></label><label>UIDs dos responsáveis · até 20 membros desta área<textarea name="responsibleUids" rows="2" maxlength="2600">${escapeHtml(session.user.uid)}</textarea></label><button class="secondary-button" type="submit">Adicionar ação</button></form>` : '';
      return `<li><strong>${escapeHtml(plan.title)}</strong>${plan.description ? `<small>${escapeHtml(plan.description)}</small>` : ''}<small class="record-meta">${escapeHtml(plan.status)} · ${escapeHtml(plan.priority)}${plan.dueAt ? ` · Prazo ${escapeHtml(formatRecordDate(plan.dueAt))}` : ''} · ${items.length} ação(ões)</small>${itemRows}${itemForm}${action}</li>`;
    }).join('')}</ul>` : '<p class="empty-state">Nenhum plano de ação nesta área.</p>'}</section>`;
    const documentForm = can('documentsManage') ? `<details class="quick-form" id="management-document-editor"><summary>Adicionar ou editar documento</summary><form id="management-document-form"><input type="hidden" name="managementAreaId" value="${escapeHtml(area.id)}"><input type="hidden" name="documentId"><input type="hidden" name="version" value="0"><div class="form-grid"><label>Título<input name="title" required maxlength="160"></label><label>Categoria<input name="category" required maxlength="80" placeholder="Protocolo, política, formulário…"></label><label>Link do Google Drive ou Docs<input name="driveUrl" type="url" required maxlength="800" placeholder="https://drive.google.com/file/d/…/view"></label><label class="contact-active-field"><input name="requiredReading" type="checkbox"> Leitura requerida</label><label class="contact-active-field"><input name="active" type="checkbox" checked> Documento ativo</label></div><label>Descrição<textarea name="description" rows="2" maxlength="1200"></textarea></label><div class="admin-user-actions"><button class="primary-button" type="submit">Salvar documento</button><button class="secondary-button" type="button" id="management-document-reset">Novo documento</button></div><p id="management-document-status" class="record-meta" role="status" aria-live="polite"></p></form></details>` : '';
    const documentsView = `<section class="management-documents"><h4>Documentos · ${documents.length}</h4>${documents.length ? `<ul class="record-list">${documents.map((item) => `<li><div class="contact-list-heading"><a class="management-document-link" href="${escapeHtml(item.driveUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>${can('documentsManage') ? `<button class="secondary-button" type="button" data-document-edit="${escapeHtml(item.id)}">Editar</button>` : ''}</div>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}<small class="record-meta">${escapeHtml(item.category)} · v${escapeHtml(item.version)} · ${item.active ? 'Ativo' : 'Inativo'}${item.requiredReading ? ' · Leitura requerida' : ''}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhum documento publicado nesta área.</p>'}</section>`;
    const equipmentView = area.id === 'area-gestao-de-equipamentos'
      ? can('equipmentManage') ? '<div id="equipment-management-root"></div>' : '<section class="equipment-manager"><h4>Equipamentos</h4><p class="empty-state">Esta área exige a permissão Gerenciar equipamentos.</p></section>'
      : '';
    detail.innerHTML = `<header class="management-detail-heading"><div><p class="eyebrow">${activities.length} ATIVIDADE(S)</p><h3>${escapeHtml(area.name || area.title || area.id)}</h3></div>${can('managementActivityWrite') ? '<button class="secondary-button" type="button" id="new-area-activity">Nova atividade</button>' : ''}</header>${assignmentEditor}${scoringRuleForm}${indicatorForm}${planForm}${documentsView}${documentForm}${equipmentView}${indicatorsView}${plansView}${activities.length ? `<ul class="record-list">${activities.map((item) => {
      const responsible = item.responsibleUids?.includes(session.user.uid);
      const scoreReview = scoreReviewByActivity.get(item.id);
      const action = responsible && item.status === 'OPEN' ? `<button class="secondary-button" type="button" data-activity-id="${escapeHtml(item.id)}" data-next-status="IN_PROGRESS">Iniciar</button>` :
        responsible && item.status === 'IN_PROGRESS' && !item.evidenceRequired ? `<button class="secondary-button" type="button" data-activity-id="${escapeHtml(item.id)}" data-next-status="COMPLETED">Concluir${item.pointsEnabled ? ` · ${escapeHtml(item.points)} pts a validar` : ''}</button>` : '';
      const scoreReviewLabel = ({PENDING_VALIDATION: 'Revisão de pontos aguardando processamento.', APPROVED: 'Pontuação aprovada e creditada.', REJECTED: 'Pontuação recusada.', NEEDS_REVIEW: 'Dados divergentes; solicite reconciliação da Administração.'})[scoreReview?.status] || '';
      const reviewAction = canReviewActivityPoints && !responsible && item.status === 'COMPLETED' && item.pointsEnabled === true && !scoreReview
        ? `<div class="activity-score-review-actions"><small>Pontos aguardam aprovação independente.</small><button class="secondary-button" type="button" data-activity-score-review="${escapeHtml(item.id)}" data-review-decision="APPROVE">Aprovar ${escapeHtml(item.points)} pts</button><button class="text-button" type="button" data-activity-score-review="${escapeHtml(item.id)}" data-review-decision="REJECT">Recusar</button></div>` : '';
      const scoreReviewNote = scoreReview?.validationMessage || scoreReview?.note ? `<small>${escapeHtml(scoreReview.validationMessage || scoreReview.note)}</small>` : '';
      const canCancel = (item.createdByUid === session.user.uid || can('managementManage')) && ['OPEN', 'IN_PROGRESS'].includes(item.status);
      const cancelAction = canCancel ? `<button class="text-button" type="button" data-cancel-activity="${escapeHtml(item.id)}">Cancelar</button>` : '';
      const overdue = item.dueAt && item.dueAt < todayInputValue() && ['OPEN', 'IN_PROGRESS'].includes(item.status);
      const evidenceNote = responsible && item.status === 'IN_PROGRESS' && item.evidenceRequired ? '<small>Conclusão aguarda a evidência obrigatória.</small>' : '';
      const participant = item.participantUids?.includes(session.user.uid);
      const canReadConversation = can('managementRead') || item.createdByUid === session.user.uid || responsible || participant;
      const interactions = canReadConversation ? `<details class="activity-interactions" data-activity-interactions="${escapeHtml(item.id)}" data-read-all="${canReadConversation}"><summary>Interações${participant && !responsible ? ' · Participante' : ''} · Ver ou comentar</summary><ul class="activity-interaction-list"><li class="loading">Carregando quando abrir…</li></ul><form class="activity-interaction-form"><label>Comentário<textarea name="content" rows="2" maxlength="1000" required></textarea></label><button class="secondary-button" type="submit">Enviar comentário</button></form></details>` : '';
      const assigneeCount = Array.isArray(item.responsibleUids) ? item.responsibleUids.length : 0;
      const participantCount = Array.isArray(item.participantUids) ? item.participantUids.length : 0;
      return `<li><strong>${escapeHtml(item.title || 'Atividade')}</strong>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}<small class="record-meta">${overdue ? 'Atrasada' : escapeHtml(item.status || 'OPEN')}${item.priority ? ` · ${escapeHtml(item.priority)}` : ''}${item.dueAt ? ` · Prazo ${escapeHtml(formatRecordDate(item.dueAt))}` : ''}${assigneeCount > 1 ? ` · Equipe responsável: ${assigneeCount}` : ''}${participantCount ? ` · Participantes: ${participantCount}` : ''}</small>${evidenceNote}${scoreReviewLabel ? `<small class="record-meta">${scoreReviewLabel}</small>${scoreReviewNote}` : ''}${action}${reviewAction}${cancelAction}${interactions}</li>`;
    }).join('')}</ul>` : '<p class="empty-state">Nenhuma atividade nesta área.</p>'}`;
    if (area.id === 'area-gestao-de-equipamentos' && can('equipmentManage')) {
      const {mountEquipmentManager} = await import('./equipment.js');
      await mountEquipmentManager(detail.querySelector('#equipment-management-root'), {managementAreaId: area.id, uid: session.user.uid});
    }
    detail.querySelector('#new-area-activity')?.addEventListener('click', () => {
      const form = document.querySelector('#activity-area');
      if (form) form.value = area.id;
      document.querySelector('[data-module-form]')?.scrollIntoView({behavior: 'smooth', block: 'center'});
      document.querySelector('[data-module-form] input[name="title"]')?.focus({preventScroll: true});
    });
    const assignmentForm = detail.querySelector('#management-assignment-form');
    assignmentForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[type="submit"]');
      const status = form.querySelector('#management-assignment-status');
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        const managers = parseManagementUids(values.managerUids);
        const members = parseManagementUids(values.memberUids);
        button.disabled = true;
        status.textContent = 'Salvando gestores e equipe no Firestore…';
        const {updateManagementAreaAssignments} = await import('./data.js');
        const updated = await updateManagementAreaAssignments(area.id, {
          managerUids: managers, memberUids: members, version: Number(values.version)
        }, session.user.uid);
        area.managerUids = updated.managerUids;
        area.memberUids = updated.memberUids;
        form.elements.managerUids.value = managers.join('\n');
        form.elements.memberUids.value = members.join('\n');
        form.elements.version.value = String(updated.version);
        status.textContent = `Vínculos atualizados · ${managers.length} gestor(es) · ${members.length} pessoa(s) na equipe.`;
      } catch (error) {
        status.textContent = error.message || 'Não foi possível salvar os vínculos.';
      } finally {
        button.disabled = false;
      }
    });
    const documentEditor = detail.querySelector('#management-document-form');
    const resetDocumentEditor = () => {
      documentEditor?.reset();
      if (!documentEditor) return;
      documentEditor.elements.documentId.value = '';
      documentEditor.elements.version.value = '0';
      documentEditor.elements.managementAreaId.value = area.id;
      documentEditor.dataset.mutationId = '';
      documentEditor.elements.active.checked = true;
      const status = documentEditor.querySelector('#management-document-status');
      if (status) status.textContent = '';
      const editor = detail.querySelector('#management-document-editor');
      if (editor) editor.open = false;
    };
    detail.querySelector('#management-document-reset')?.addEventListener('click', resetDocumentEditor);
    documentEditor?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      const status = form.querySelector('#management-document-status');
      submit.disabled = true;
      if (status) status.textContent = 'Salvando metadados no Firestore…';
      try {
        const {saveManagementDocument} = await import('./data.js');
        const values = Object.fromEntries(new FormData(form).entries());
        values.documentId = values.documentId || (form.dataset.mutationId ||= crypto.randomUUID());
        values.active = form.elements.active.checked;
        values.requiredReading = form.elements.requiredReading.checked;
        await saveManagementDocument(values, session.user.uid);
        resetDocumentEditor();
        notice = 'Documento vinculado à área no Firestore. O arquivo permanece no Drive.';
        await render();
      } catch (error) {
        submit.disabled = false;
        if (status) status.textContent = error.message || 'Não foi possível salvar o documento.';
      }
    });
    detail.querySelectorAll('[data-document-edit]').forEach((button) => button.addEventListener('click', () => {
      const item = documents.find((document) => document.id === button.dataset.documentEdit);
      if (!item || !documentEditor) return;
      documentEditor.elements.documentId.value = item.id;
      documentEditor.elements.version.value = String(item.version);
      documentEditor.elements.managementAreaId.value = item.managementAreaId;
      documentEditor.elements.title.value = item.title;
      documentEditor.elements.description.value = item.description || '';
      documentEditor.elements.driveUrl.value = item.driveUrl;
      documentEditor.elements.category.value = item.category;
      documentEditor.elements.active.checked = item.active === true;
      documentEditor.elements.requiredReading.checked = item.requiredReading === true;
      detail.querySelector('#management-document-editor').open = true;
      documentEditor.scrollIntoView({behavior: 'smooth', block: 'center'});
      documentEditor.elements.title.focus({preventScroll: true});
    }));
    detail.querySelector('#indicator-create-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const {createManagementIndicator} = await import('./data.js');
        await createManagementIndicator(Object.fromEntries(new FormData(form).entries()), session.user.uid);
        notice = 'Indicador criado no Firestore.';
        await loadManagementAreaActivities(area);
        const createPanel = document.querySelector('.indicator-create');
        if (createPanel) createPanel.open = true;
      } catch (error) {
        submit.disabled = false;
        notice = `Não foi possível criar o indicador. ${error.message || ''}`;
        await render();
      }
    });
    detail.querySelectorAll('.indicator-measure-form').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const indicator = indicators.find((item) => item.id === form.dataset.indicatorId);
        const {recordIndicatorMeasurement} = await import('./data.js');
        const result = await recordIndicatorMeasurement(indicator, Object.fromEntries(new FormData(form).entries()), session.user.uid);
        notice = result.status === 'MET' ? 'Medição registrada; meta atingida.' : 'Medição registrada; meta pendente.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        submit.disabled = false;
        notice = `Não foi possível registrar a medição. ${error.message || ''}`;
        await render();
      }
    }));
    detail.querySelector('#action-plan-create-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const {createManagementActionPlan} = await import('./data.js');
        await createManagementActionPlan(Object.fromEntries(new FormData(form).entries()), session.user.uid);
        notice = 'Plano de ação criado no Firestore e atribuído a você.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        submit.disabled = false;
        notice = `Não foi possível criar o plano. ${error.message || ''}`;
        await render();
      }
    });
    detail.querySelectorAll('[data-plan-id]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const {transitionManagementActionPlan} = await import('./data.js');
        await transitionManagementActionPlan(button.dataset.planId, button.dataset.nextStatus, session.user.uid);
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        const message = document.createElement('small');
        message.className = 'form-error';
        message.textContent = error.message || 'Não foi possível atualizar o plano.';
        button.after(message);
      }
    }));
    detail.querySelectorAll('[data-plan-item-form]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const {createManagementActionPlanItem} = await import('./data.js');
        form.dataset.itemId ||= crypto.randomUUID();
        await createManagementActionPlanItem({planId: form.dataset.planItemForm, itemId: form.dataset.itemId, ...Object.fromEntries(new FormData(form).entries())}, session.user.uid);
        notice = 'Ação adicionada ao plano.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        submit.disabled = false;
        const message = document.createElement('small');
        message.className = 'form-error';
        message.textContent = error.message || 'Não foi possível adicionar a ação.';
        form.append(message);
      }
    }));
    detail.querySelectorAll('[data-plan-item-complete]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const {completeManagementActionPlanItem} = await import('./data.js');
        await completeManagementActionPlanItem(button.dataset.planItemComplete, session.user.uid);
        notice = 'Ação concluída.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        const message = document.createElement('small');
        message.className = 'form-error';
        message.textContent = error.message || 'Não foi possível concluir a ação.';
        button.after(message);
      }
    }));
    detail.querySelectorAll('[data-activity-interactions]').forEach((panel) => {
      panel.addEventListener('toggle', () => {
        if (panel.open && panel.dataset.loaded !== 'true') void loadActivityInteractions(panel, panel.dataset.activityInteractions);
      });
      panel.querySelector('form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
          const {addActivityInteraction} = await import('./data.js');
          await addActivityInteraction(panel.dataset.activityInteractions, form.elements.content.value, session.user.uid);
          form.reset();
          panel.dataset.loaded = 'false';
          await loadActivityInteractions(panel, panel.dataset.activityInteractions);
          submit.disabled = false;
        } catch (error) {
          submit.disabled = false;
          const message = document.createElement('small');
          message.className = 'form-error';
          message.textContent = error.message || 'Não foi possível enviar o comentário.';
          form.after(message);
        }
      });
    });
    detail.querySelector('#management-task-scoring-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[type="submit"]');
      const status = form.querySelector('#management-task-scoring-status');
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        button.disabled = true;
        status.textContent = 'Salvando regra…';
        const {saveManagementTaskScoringRule} = await import('./data.js');
        await saveManagementTaskScoringRule({...values, active: values.active === 'on'}, session.user.uid);
        status.textContent = 'Regra salva. Tarefas novas usarão esta versão.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message || 'Não foi possível salvar a regra.';
      }
    });
    detail.querySelectorAll('[data-activity-id]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const data = await import('./data.js');
        if (button.dataset.nextStatus === 'COMPLETED') {
          const result = await data.completeManagementActivity(button.dataset.activityId, session.user.uid);
          notice = result.pointsPending ? 'Ação concluída. A pontuação ficou pendente de validação.' : 'Ação concluída.';
        } else {
          await data.transitionManagementActivity(button.dataset.activityId, button.dataset.nextStatus, session.user.uid);
        }
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        const notice = document.createElement('small');
        notice.className = 'form-error';
        notice.textContent = error.message || 'Não foi possível atualizar a atividade.';
        button.after(notice);
      }
    }));
    detail.querySelectorAll('[data-activity-score-review]').forEach((button) => button.addEventListener('click', async () => {
      const decision = button.dataset.reviewDecision;
      const promptText = decision === 'APPROVE'
        ? 'Observação da aprovação (opcional):'
        : 'Explique por que a pontuação foi recusada:';
      const note = window.prompt(promptText, decision === 'APPROVE' ? '' : '');
      if (note === null) return;
      if (decision === 'APPROVE' && !window.confirm(`Aprovar ${button.textContent.match(/\d+/)?.[0] || 'a'} pontos? O lançamento não pode ser revertido automaticamente.`)) return;
      button.disabled = true;
      try {
        const {submitManagementActivityScoreReview} = await import('./data.js');
        await submitManagementActivityScoreReview(button.dataset.activityScoreReview, session.user.uid, decision, note);
        notice = 'Decisão registrada. O Apps Script processará o ledger de pontos periodicamente.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        const message = document.createElement('small');
        message.className = 'form-error';
        message.textContent = error.message || 'Não foi possível registrar a revisão dos pontos.';
        button.after(message);
      }
    }));
    detail.querySelectorAll('[data-cancel-activity]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Cancelar esta atividade? O cancelamento ficará registrado no histórico.')) return;
      button.disabled = true;
      try {
        const {cancelManagementActivity} = await import('./data.js');
        await cancelManagementActivity(button.dataset.cancelActivity, session.user.uid);
        notice = 'Atividade cancelada.';
        await loadManagementAreaActivities(area);
      } catch (error) {
        button.disabled = false;
        const message = document.createElement('small');
        message.className = 'form-error';
        message.textContent = error.message || 'Não foi possível cancelar a atividade.';
        button.after(message);
      }
    }));
  } catch (error) {
    if (loadId !== managementActivityLoad || !detail.isConnected || session.user?.uid !== requestUid) return;
    detail.innerHTML = `<p class="empty-state">Não foi possível carregar as atividades. ${escapeHtml(error.message || '')}</p>`;
  }
}

async function loadActivityInteractions(panel, activityId) {
  const list = panel.querySelector('.activity-interaction-list');
  if (!list) return;
  list.innerHTML = '<li class="loading">Carregando interações…</li>';
  try {
    const {listActivityInteractions, getActivityScoreReview} = await import('./data.js');
    const [items, scoreReview] = await Promise.all([
      listActivityInteractions(activityId, session.user.uid, {canReadAll: panel.dataset.readAll === 'true', pageSize: 20}),
      getActivityScoreReview(activityId)
    ]);
    if (!panel.isConnected) return;
    panel.dataset.loaded = 'true';
    const reviewState = ({PENDING_VALIDATION: 'Solicitação de pontuação aguardando processamento.', APPROVED: 'Pontuação aprovada e creditada.', REJECTED: 'Pontuação recusada.', NEEDS_REVIEW: 'Dados divergentes; solicite reconciliação da Administração.'})[scoreReview?.status];
    const reviewNote = scoreReview?.validationMessage || scoreReview?.note ? ` ${escapeHtml(scoreReview.validationMessage || scoreReview.note)}` : '';
    const reviewMarkup = reviewState ? `<li><small class="record-meta">${reviewState}${reviewNote}</small></li>` : '';
    list.innerHTML = `${reviewMarkup}${items.length ? items.map((item) => {
      const pointStatus = item.pointsStatus === 'PENDING_VALIDATION'
        ? scoreReview?.status === 'APPROVED' ? ' · Pontuação aprovada e creditada' : scoreReview?.status === 'REJECTED' ? ' · Pontuação recusada pela Gestão' : ' · Pontuação pendente de aprovação'
        : '';
      return `<li><small class="record-meta">${escapeHtml(interactionDateTime(item.createdAt))} · ${item.uid === session.user.uid ? 'Você' : 'Equipe'}${pointStatus}</small><p>${escapeHtml(item.content)}</p></li>`;
    }).join('') : '<li class="empty-state">Nenhum comentário ainda.</li>'}`;
  } catch (error) {
    if (!panel.isConnected) return;
    panel.dataset.loaded = 'false';
    list.innerHTML = `<li class="empty-state">Não foi possível carregar os comentários. ${escapeHtml(error.message || '')}</li>`;
  }
}

function formatRecordDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo'}).format(date);
}

function interactionDateTime(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'}).format(date);
}

function todayInputValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function indicatorPeriodValue(frequency) {
  const month = todayInputValue();
  if (frequency === 'YEARLY') return month.slice(0, 4);
  if (frequency === 'QUARTERLY') return `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;
  if (frequency === 'WEEKLY') {
    const date = new Date(`${month}T12:00:00-03:00`);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return month.slice(0, 7);
}

function isChecklistDateDifferentFromLocalDay(item, today = todayInputValue()) {
  const day = item?.payload?.data?.date;
  return item?.type === 'checklists' && typeof day === 'string' && day !== today;
}

async function populateSelect(selector, items, prompt) {
  const select = document.querySelector(selector);
  if (!select) return;
  select.innerHTML = `<option value="">${escapeHtml(prompt)}</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.title || item.label || item.id)}</option>`).join('')}`;
}

async function bindModuleForm(route) {
  if (route === 'training') return; // Desempenho owns its request forms; legacy video editors remain preserved below.
  if (route === 'people') bindContactImport();
  if (route === 'training' && can('trainingsManage')) {
    const form = document.querySelector('#training-catalog-form');
    const status = document.querySelector('#training-catalog-status');
    const submit = form?.querySelector('[type="submit"]');
    const reset = () => {
      form?.reset();
      if (form) {
        form.elements.trainingId.value = '';
        form.elements.accessPoints.value = '0';
        form.elements.completionPoints.value = '0';
        form.elements.order.value = '0';
        form.elements.active.checked = true;
      }
      if (submit) submit.textContent = 'Salvar treinamento';
      if (status) status.textContent = '';
    };
    document.querySelector('#training-edit-cancel')?.addEventListener('click', reset);
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form || !submit) return;
      submit.disabled = true;
      if (status) status.textContent = 'Salvando treinamento…';
      try {
        const {saveTrainingCatalogRecord} = await import('./data.js');
        await saveTrainingCatalogRecord({
          trainingId: form.elements.trainingId.value,
          title: form.elements.title.value,
          description: form.elements.description.value,
          videoUrl: form.elements.videoUrl.value,
          accessPoints: form.elements.accessPoints.value,
          completionPoints: form.elements.completionPoints.value,
          order: form.elements.order.value,
          active: form.elements.active.checked
        }, session.user.uid);
        notice = 'Treinamento salvo no Firestore.';
        await render();
      } catch (error) {
        if (status) status.textContent = error.code === 'permission-denied'
          ? 'Seu perfil não tem permissão para gerenciar treinamentos.'
          : `Não foi possível salvar. ${error.message || ''}`;
        submit.disabled = false;
      }
    });
    document.querySelectorAll('[data-training-edit]').forEach((button) => button.addEventListener('click', () => {
      const item = loadedTrainingCatalog.find((record) => record.id === button.dataset.trainingEdit);
      if (!item || !form) return;
      for (const name of ['trainingId', 'title', 'description', 'videoUrl', 'accessPoints', 'completionPoints', 'order']) {
        form.elements[name].value = item[name] ?? '';
      }
      form.elements.active.checked = item.active === true;
      if (submit) submit.textContent = 'Atualizar treinamento';
      form.closest('details').open = true;
      form.scrollIntoView({behavior: 'smooth', block: 'center'});
      form.elements.title.focus({preventScroll: true});
    }));
    const activityForm = document.querySelector('#learning-activity-form');
    const activityStatus = document.querySelector('#learning-activity-status');
    const activitySubmit = activityForm?.querySelector('[type="submit"]');
    const setAudienceValue = () => {
      const wrapper = activityForm?.querySelector('.learning-audience-value');
      if (wrapper && activityForm) wrapper.hidden = activityForm.elements.audienceType.value === 'ALL';
    };
    const setLearningSource = () => {
      if (!activityForm) return;
      const kind = activityForm.elements.sourceKind.value;
      const linked = kind !== 'ACKNOWLEDGEMENT';
      const completion = activityForm.elements.completionKind;
      activityForm.elements.resourceUrl.required = linked;
      activityForm.elements.resourceUrl.disabled = !linked;
      if (!linked) activityForm.elements.resourceUrl.value = '';
      completion.querySelector('option[value="ACKNOWLEDGEMENT"]').disabled = kind !== 'EXTERNAL_LINK' && linked;
      if (!linked) completion.value = 'ACKNOWLEDGEMENT';
      else if (kind !== 'EXTERNAL_LINK') completion.value = 'NONE';
    };
    const resetActivity = () => {
      activityForm?.reset();
      if (activityForm) {
        activityForm.elements.activityId.value = '';
        activityForm.elements.startAt.value = todayInputValue();
        activityForm.elements.endAt.value = todayInputValue();
        activityForm.elements.order.value = '0';
        activityForm.elements.showInTraining.checked = true;
        activityForm.elements.active.checked = true;
        activityForm.elements.audienceType.value = 'ALL';
      }
      setAudienceValue();
      setLearningSource();
      if (activitySubmit) activitySubmit.textContent = 'Salvar atividade';
      if (activityStatus) activityStatus.textContent = '';
    };
    document.querySelector('#learning-activity-reset')?.addEventListener('click', resetActivity);
    activityForm?.elements.audienceType.addEventListener('change', setAudienceValue);
    activityForm?.elements.sourceKind.addEventListener('change', setLearningSource);
    setAudienceValue();
    setLearningSource();
    activityForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!activityForm || !activitySubmit) return;
      activitySubmit.disabled = true;
      if (activityStatus) activityStatus.textContent = 'Salvando atividade…';
      try {
        const {saveLearningActivity} = await import('./data.js');
        await saveLearningActivity({
          id: activityForm.elements.activityId.value,
          title: activityForm.elements.title.value,
          description: activityForm.elements.description.value,
          category: activityForm.elements.category.value,
          sourceKind: activityForm.elements.sourceKind.value,
          resourceUrl: activityForm.elements.resourceUrl.value,
          completionKind: activityForm.elements.completionKind.value,
          audienceType: activityForm.elements.audienceType.value,
          audienceValue: activityForm.elements.audienceValue.value,
          startAt: activityForm.elements.startAt.value,
          endAt: activityForm.elements.endAt.value,
          recurrenceMode: activityForm.elements.recurrenceMode.value,
          order: activityForm.elements.order.value,
          showInTraining: activityForm.elements.showInTraining.checked,
          active: activityForm.elements.active.checked
        }, session.user.uid);
        notice = 'Atividade de aprendizagem salva no Firestore.';
        await render();
      } catch (error) {
        if (activityStatus) activityStatus.textContent = error.code === 'permission-denied'
          ? 'Seu perfil não tem permissão para gerenciar atividades de aprendizagem.'
          : `Não foi possível salvar a atividade. ${error.message || ''}`;
        activitySubmit.disabled = false;
      }
    });
    document.querySelectorAll('[data-learning-activity-edit]').forEach((button) => button.addEventListener('click', () => {
      const item = loadedLearningActivityCatalog.find((record) => record.id === button.dataset.learningActivityEdit);
      if (!item || !activityForm) return;
      activityForm.elements.activityId.value = item.id;
      activityForm.elements.title.value = item.title || '';
      activityForm.elements.description.value = item.description || '';
      activityForm.elements.category.value = item.category || '';
      activityForm.elements.sourceKind.value = item.sourceKind || 'EXTERNAL_LINK';
      activityForm.elements.resourceUrl.value = item.resourceUrl || '';
      activityForm.elements.completionKind.value = item.completionKind || 'NONE';
      activityForm.elements.audienceType.value = item.audienceType || 'ALL';
      activityForm.elements.audienceValue.value = item.audienceValue || '';
      activityForm.elements.startAt.value = timestampInputDate(item.startAt);
      activityForm.elements.endAt.value = timestampInputDate(item.endAt);
      activityForm.elements.recurrenceMode.value = item.recurrenceMode || 'ONCE';
      activityForm.elements.order.value = String(item.order ?? 0);
      activityForm.elements.showInTraining.checked = item.showInTraining === true;
      activityForm.elements.active.checked = item.status === 'ACTIVE';
      setAudienceValue();
      setLearningSource();
      if (activitySubmit) activitySubmit.textContent = 'Atualizar atividade';
      if (activityStatus) activityStatus.textContent = '';
      activityForm.closest('details').open = true;
      activityForm.scrollIntoView({behavior: 'smooth', block: 'center'});
      activityForm.elements.title.focus({preventScroll: true});
    }));
    return;
  }
  document.querySelector('[data-module-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    // Release editable focus before saving; Safari must not restore input zoom.
    const focusedControl = document.activeElement;
    if (route === 'labels' && focusedControl?.matches?.('input, select, textarea') && form.contains(focusedControl)) focusedControl.blur();
    submit.disabled = true;
    const values = Object.fromEntries(new FormData(form).entries());
    const actorUid = session.user.uid;
    const entryGeneration = labelEntryGeneration;
    const currentLabelSave = () => session.user?.uid === actorUid && entryGeneration === labelEntryGeneration && form.isConnected;
    const manualLabelEntry = route === 'labels' && (form.dataset.labelEntrySource === 'manual' || Boolean(values.editLabelId));
    const cameraLabelEntry = route === 'labels' && !manualLabelEntry && form.dataset.labelEntrySource === 'camera';
    if (manualLabelEntry) updateLabelManualConfirmation('pending', actorUid);
    if (cameraLabelEntry) updateLabelCameraConfirmation('pending', actorUid);
    const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo'}).format(new Date());
    try {
      if (route === 'people') {
        const {saveContact} = await import('./data.js');
        await saveContact({...values, active: form.elements.active.checked}, session.user.uid);
        notice = 'Contato salvo no Firestore.';
        await render();
        return;
      }
      if (route === 'notifications') {
        const {createNotification} = await import('./data.js');
        await createNotification(values, session.user.uid);
        notice = 'Comunicado publicado no Firestore.';
        await render();
        return;
      }
      let collectionName; let record;
      if (route === 'events') {
        // FormData omits disabled controls. V1 locks automatically completed
        // controls, so read their values directly before validating/saving.
        for (const name of ['memberStatus', 'description', 'delayMultiple', 'substitute', 'shift', 'payer', 'creditor', 'amountToPay']) {
          values[name] = form.elements[name]?.value ?? '';
        }
        values.eventType = form.elements.eventType.value;
        validateEventForm(values);
        const actorName = String(session.profile?.displayName || '').trim().slice(0, 120);
        const eventRecord = {date: values.eventDate || today, memberSigla: values.memberSigla?.trim().toUpperCase() || '', scheduleSigla: values.scheduleSigla?.trim().toUpperCase() || '', memberStatus: values.memberStatus?.trim() || 'SUPORTE', eventType: values.eventType, description: values.description.trim(), delayMultiple: values.delayMultiple === '' ? null : Number(values.delayMultiple), substitute: values.substitute.trim(), shift: values.shift, payer: values.payer.trim(), creditor: values.creditor.trim(), amountToPay: Number(values.amountToPay || 0), createdByName: actorName, updatedByName: actorName, status: 'OPEN'};
        if (values.editEventId) {
          const {updateEventRecord} = await import('./data.js');
          const result = await updateEventRecord(values.editEventId, eventRecord, session.user.uid, Number(values.editEventVersion));
          notice = result.pendingFirestore
            ? 'Edição salva neste aparelho com a versão base. Será enviada quando a conexão voltar; se o registro mudar, o rascunho ficará para comparação.'
            : 'Evento atualizado no Firestore.';
          await render();
          return;
        }
        collectionName = 'events';
        record = eventRecord;
      } else if (route === 'labels') {
        values.staffSiglas = form.elements.staffSiglas?.value || '';
        values.creditor = form.elements.creditor?.value || '';
        collectionName = 'labels';
        const normalizedType = values.type.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
        const rawAmount = String(values.amount || '').trim().replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
        const amount = rawAmount ? Number(rawAmount) : null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date || '')) throw new Error('Informe a data da etiqueta.');
        if (!values.patientName?.trim()) throw new Error('Informe o nome do paciente.');
        if (!values.encounterCode?.trim()) throw new Error('Informe o número do atendimento.');
        if (!['particular', 'complementacao', 'convenio', 'consulta pre-anestesica', 'sadt'].includes(normalizedType)) throw new Error('Selecione o tipo de etiqueta.');
        if (rawAmount && !Number.isFinite(amount)) throw new Error('Informe um valor válido.');
        const selectedStaffSiglas = [...new Set((values.staffSiglas || '').split(',').map((sigla) => sigla.trim().toUpperCase()).filter(Boolean))];
        const existingLabel = values.editLabelId ? loadedLabelRecords.find((item) => item.id === values.editLabelId) : null;
        const historicStaffUnchanged = existingLabel && JSON.stringify([...(existingLabel.staffSiglas || [])].sort()) === JSON.stringify(selectedStaffSiglas.sort());
        selectedStaffSiglas.sort();
        if (!['Caixa', 'Plantão', 'Plantão/Caixa'].includes(values.creditor)) throw new Error('Selecione o credor.');
        if (values.creditor !== 'Caixa' && !selectedStaffSiglas.length) throw new Error('Informe as siglas dos plantonistas.');
        if (!['consulta pre-anestesica', 'sadt'].includes(normalizedType) && !(values.procedureCode || '').trim()) throw new Error('Informe o número da cirurgia.');
        const unknownStaff = values.creditor === 'Caixa' ? [] : selectedStaffSiglas.filter((sigla) => !loadedLabelStaffSiglas.includes(sigla));
        if (unknownStaff.length && !historicStaffUnchanged) throw new Error(`Sigla(s) fora do catálogo autorizado: ${unknownStaff.join(', ')}.`);
        if (normalizedType !== 'consulta pre-anestesica' && !values.insurance.trim()) throw new Error('Informe o convênio.');
        const creditor = normalizedType === 'consulta pre-anestesica' ? 'Caixa' : values.creditor;
        const actorName = String(session.profile?.displayName || session.user.displayName || '').trim().slice(0, 120);
        record = {date: values.date, patientName: values.patientName.trim(), procedureCode: (values.procedureCode || '').trim(), encounterCode: values.encounterCode.trim(), type: values.type, amount, insurance: normalizedType === 'consulta pre-anestesica' ? '' : (values.insurance || '').trim(), creditor, staffSiglas: creditor === 'Caixa' ? [] : selectedStaffSiglas, consultation: normalizedType === 'consulta pre-anestesica', status: 'CONFIRMED', createdByName: actorName, updatedByName: actorName};
        if (values.editLabelId) {
          const {updateLabelRecord} = await import('./data.js');
          await updateLabelRecord(values.editLabelId, record, session.user.uid, actorName, Number(values.editLabelVersion));
          if (!currentLabelSave()) return;
          updateLabelManualConfirmation('confirmed', actorUid);
          notice = '';
          const entryDialog = document.querySelector('#label-entry-dialog');
          if (entryDialog?.open) entryDialog.close();
          document.querySelector('#label-manual-open')?.focus?.({preventScroll: true});
          await render();
          return;
        }
      } else if (route === 'management') {
        collectionName = 'activities';
        const managementAreaId = String(values.managementAreaId || '').trim();
        const title = String(values.title || '').trim();
        if (!managementAreaId || !title) throw new Error('Selecione a área e informe o título da atividade.');
        const responsibleUids = can('managementManage') ? parseManagementUids(values.responsibleUids, {maxItems: 20}) : [session.user.uid];
        if (!responsibleUids.length) throw new Error('Informe pelo menos um UID responsável cadastrado na equipe da área.');
        const participantUids = can('managementManage') ? parseManagementUids(values.participantUids, {maxItems: 100}) : [];
        if (participantUids.some((uid) => responsibleUids.includes(uid))) throw new Error('Cada pessoa deve ser responsável ou participante; não use o mesmo UID nas duas listas.');
        const pointsEnabled = can('managementManage') && values.pointsEnabled === 'on';
        if (pointsEnabled && responsibleUids.length !== 1) throw new Error('A pontuação de conclusão exige um único responsável.');
        let scoringRule = null;
        if (pointsEnabled) {
          const {getManagementTaskScoringRule} = await import('./data.js');
          scoringRule = await getManagementTaskScoringRule();
          if (!scoringRule?.active) throw new Error('Configure uma regra de pontuação ativa na área Gestão antes de pontuar atividades.');
        }
        record = {
          title,
          description: String(values.description || '').trim(),
          contextType: 'MANAGEMENT_AREA',
          contextId: managementAreaId,
          managementAreaId,
          type: 'TASK',
          status: 'OPEN',
          priority: values.priority,
          responsibleUids,
          participantUids,
          dueAt: values.dueAt || null,
          completedAt: null,
          evidenceRequired: false,
          pointsEnabled,
          points: pointsEnabled ? scoringRule.points : 0,
          scoringRuleId: pointsEnabled ? scoringRule.id : '',
          scoringRuleVersion: pointsEnabled ? scoringRule.version : 0,
          visibility: 'AREA'
        };
      }
      delete record.sign;
      const {createOperationalRecord} = await import('./data.js');
      const result = await createOperationalRecord(collectionName, record, {uid: session.user.uid});
      if (route === 'labels' && !currentLabelSave()) return;
      notice = result.pendingFirestore
        ? 'Registro salvo neste aparelho; será enviado ao Firestore quando a conexão voltar.'
        : route === 'events' ? '' : 'Registro confirmado no Firestore.';
      if (manualLabelEntry || cameraLabelEntry) {
        if (manualLabelEntry) updateLabelManualConfirmation(result.pendingFirestore ? 'pending' : 'confirmed', actorUid);
        else updateLabelCameraConfirmation(result.pendingFirestore ? 'pending' : 'confirmed', actorUid);
        notice = '';
        const entryDialog = document.querySelector('#label-entry-dialog');
        if (entryDialog?.open) entryDialog.close();
        if (manualLabelEntry) document.querySelector('#label-manual-open')?.focus?.({preventScroll: true});
        else document.querySelector('#label-camera-open')?.focus?.({preventScroll: true});
      }
      await render();
    } catch (error) {
      if (route === 'labels' && !currentLabelSave()) return;
      notice = error.code === 'permission-denied' ? 'Seu perfil não tem permissão para esta ação.' : `Não foi possível salvar. ${error.message || ''}`;
      if (route === 'events') {
        const status = document.querySelector('#event-form-status');
        const refresh = document.querySelector('#event-conflict-refresh');
        if (error.code === 'stale-version') {
          if (status) status.textContent = `${error.message} Seus dados continuam no formulário. Atualize o relatório e compare antes de tentar novamente.`;
          if (refresh) refresh.hidden = false;
        } else if (status) status.textContent = notice;
        notice = '';
        submit.disabled = false;
        return;
      }
      if (route === 'labels') {
        const status = document.querySelector('#label-form-status');
        const refresh = document.querySelector('#label-conflict-refresh');
        if (error.code === 'stale-version') {
          if (status) status.textContent = `${error.message} Seus dados continuam no formulário. Atualize o relatório e compare antes de tentar novamente.`;
          if (refresh) refresh.hidden = false;
        } else if (status) status.textContent = notice;
        notice = '';
        submit.disabled = false;
        return;
      }
      submit.disabled = false;
      await render();
    }
  });
  if (route === 'events') {
    const form = document.querySelector('[data-module-form="events"]');
    const eventType = form?.elements.eventType;
    eventType?.addEventListener('input', () => updateEventEntryFields(form));
    eventType?.addEventListener('change', () => updateEventEntryFields(form));
    for (const name of ['eventDate', 'memberStatus', 'description', 'delayMultiple', 'substitute', 'shift', 'payer', 'creditor', 'amountToPay']) {
      form?.elements[name]?.addEventListener('input', () => updateEventEntryFields(form));
      form?.elements[name]?.addEventListener('change', () => updateEventEntryFields(form));
    }
    document.querySelector('#event-launch-back')?.addEventListener('click', resetEventEditor);
    document.querySelector('#event-launch-dialog')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) resetEventEditor();
    });
    document.querySelector('#event-launch-dialog')?.addEventListener('cancel', (event) => {
      event.preventDefault();
      resetEventEditor();
    });
    if (form) updateEventEntryFields(form);
    document.querySelector('#event-conflict-refresh')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const refreshed = await loadEventReport({force: true});
      const status = document.querySelector('#event-form-status');
      if (status) status.textContent = refreshed
        ? 'Relatório atualizado. Compare com os valores preservados no formulário antes de salvar novamente.'
        : 'Não foi possível atualizar o relatório. Seus dados continuam no formulário; verifique a conexão e tente novamente.';
      if (button.isConnected) button.disabled = false;
    });
    bindEventCatalogForm();
  }
  if (route === 'labels') {
    const form = document.querySelector('[data-module-form="labels"]');
    const workspace = document.querySelector('.label-workspace');
    form?.elements.type?.addEventListener('change', () => updateLabelEntryFields(form));
    form?.elements.creditor?.addEventListener('change', () => updateLabelEntryFields(form));
    form?.addEventListener('input', () => syncLabelFieldStates(form));
    form?.addEventListener('change', () => syncLabelFieldStates(form));
    if (form) updateLabelEntryFields(form);
    if (form && workspace) {
      const cleanupAi = bindLabelAi(workspace, form);
      const {bindLabelCamera} = await import('./label-camera.js');
      if (!form.isConnected) { cleanupAi(); return; }
      const cleanupCamera = bindLabelCamera(workspace);
      cleanupLabelMedia = () => { cleanupAi(); cleanupCamera(); };
    }
    const entryDialog = document.querySelector('#label-entry-dialog');
    entryDialog?.addEventListener('click', (event) => { if (event.target === entryDialog) resetLabelEditor(); });
    document.querySelector('#label-staff-options')?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-sigla]');
      if (!button) return;
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      syncLabelStaffSiglas();
    });
    document.querySelector('#label-conflict-refresh')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const refreshed = await loadLabelReport({force: true});
      const status = document.querySelector('#label-form-status');
      if (status) status.textContent = refreshed
        ? 'Relatório atualizado. Compare com os valores preservados no formulário antes de salvar novamente.'
        : 'Não foi possível atualizar o relatório. Seus dados continuam no formulário; verifique a conexão e tente novamente.';
      if (button.isConnected) button.disabled = false;
    });
  }
  if (route === 'notifications') {
    const form = document.querySelector('[data-module-form="notifications"]');
    const audience = form?.elements.audienceType;
    const updateAudience = () => {
      const isAll = audience?.value === 'ALL';
      const wrapper = form?.querySelector('#notification-audience-value-wrap');
      if (wrapper) wrapper.hidden = isAll;
      if (form?.elements.audienceValue) {
        form.elements.audienceValue.required = !isAll;
        form.elements.audienceValue.disabled = isAll;
        if (isAll) form.elements.audienceValue.value = '';
      }
    };
    audience?.addEventListener('change', updateAudience);
    updateAudience();
  }
  if (route === 'people') {
    const form = document.querySelector('[data-module-form="people"]');
    document.querySelector('#contact-reset')?.addEventListener('click', () => {
      form?.reset();
      if (form) { form.elements.sigla.readOnly = false; form.elements.sigla.focus(); }
    });
  }
}

function bindContactImport() {
  const fileInput = document.querySelector('#contact-import-file');
  const previewButton = document.querySelector('#contact-import-preview');
  const importButton = document.querySelector('#contact-import-confirm');
  const status = document.querySelector('#contact-import-status');
  if (!fileInput || !previewButton || !importButton || !status) return;
  let pendingRecords = null;
  let pendingFile = null;
  let previewGeneration = 0;
  const sameFile = (left, right) => Boolean(left && right && left.name === right.name && left.size === right.size && left.lastModified === right.lastModified && left.type === right.type);
  fileInput.addEventListener('change', () => {
    previewGeneration++;
    pendingRecords = null;
    pendingFile = null;
    importButton.hidden = true;
    importButton.disabled = true;
    status.textContent = fileInput.files?.[0] ? 'Arquivo alterado. Confira novamente antes de atualizar.' : '';
  });
  previewButton.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) { status.textContent = 'Selecione o CSV preparado com os campos aprovados.'; return; }
    const generation = ++previewGeneration;
    previewButton.disabled = true;
    importButton.hidden = true;
    importButton.disabled = true;
    status.textContent = 'Conferindo o arquivo e as siglas cadastradas no V2…';
    try {
      const {parseContactImportCsv, compareContactImportRows} = await import('./contact-import.js');
      const {listContactCatalog} = await import('./data.js');
      const parsed = parseContactImportCsv(await file.text());
      const contacts = await listContactCatalog();
      if (generation !== previewGeneration || !sameFile(fileInput.files?.[0], file)) throw new Error('O arquivo mudou durante a conferência. Confira novamente antes de atualizar.');
      const comparison = compareContactImportRows(parsed, contacts);
      if (comparison.missing.length) throw new Error(`Siglas sem cadastro correspondente no V2: ${comparison.missing.join(', ')}. Nenhum dado foi gravado.`);
      if (comparison.matched !== parsed.length) throw new Error('Não foi possível conferir todos os cadastros. Nenhum dado foi gravado.');
      pendingRecords = parsed;
      pendingFile = file;
      status.textContent = `${comparison.matched} siglas V2 conferidas · ${comparison.changes} com campos alterados · ${comparison.active} ativas · ${comparison.inactive} inativas. Somente os cinco campos selecionados serão atualizados.`;
      importButton.textContent = `Atualizar ${comparison.matched} cadastros no Firestore`;
      importButton.hidden = false;
      importButton.disabled = false;
    } catch (error) {
      if (generation === previewGeneration) {
        pendingRecords = null;
        pendingFile = null;
        status.textContent = error.message || 'Não foi possível conferir o arquivo.';
      }
    } finally {
      previewButton.disabled = false;
    }
  });
  importButton.addEventListener('click', async () => {
    if (!pendingRecords?.length) return;
    if (!sameFile(fileInput.files?.[0], pendingFile)) {
      pendingRecords = null;
      pendingFile = null;
      importButton.hidden = true;
      importButton.disabled = true;
      status.textContent = 'O arquivo mudou depois da conferência. Confira novamente antes de atualizar.';
      return;
    }
    importButton.disabled = true;
    previewButton.disabled = true;
    status.textContent = `Atualizando ${pendingRecords.length} cadastros no Firestore…`;
    try {
      const {updateContactRegistrationFields} = await import('./data.js');
      const result = await updateContactRegistrationFields(pendingRecords, session.user.uid);
      notice = `${result.updated} cadastros da equipe atualizados no Firestore. Os acessos V2 foram preservados.`;
      pendingRecords = null;
      pendingFile = null;
      fileInput.value = '';
      await render();
    } catch (error) {
      status.textContent = `Nenhuma confirmação de importação: ${error.message || 'verifique a conexão e tente novamente.'}`;
      importButton.disabled = false;
      previewButton.disabled = false;
    }
  });
}

function bindEventCatalogForm() {
  const catalogForm = document.querySelector('#event-catalog-form');
  catalogForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = catalogForm.querySelector('#event-catalog-status');
    const submit = catalogForm.querySelector('[type="submit"]');
    submit.disabled = true;
    status.textContent = 'Salvando opções no Firestore…';
    try {
      const {saveEventCatalog} = await import('./data.js');
      const saved = await saveEventCatalog({payers: catalogForm.elements.payers.value, creditors: catalogForm.elements.creditors.value}, session.user.uid);
      const loaded = await loadEventEntryCatalog();
      const latestStatus = document.querySelector('#event-catalog-status');
      if (latestStatus) latestStatus.textContent = loaded?.ok && loaded.catalog?.stale !== true &&
        loaded.catalog.version >= saved.version &&
        JSON.stringify(loaded.catalog.payers) === JSON.stringify(saved.payers) &&
        JSON.stringify(loaded.catalog.creditors) === JSON.stringify(saved.creditors)
        ? 'Opções confirmadas no Firestore.'
        : 'A gravação foi enviada, mas a leitura de confirmação não corresponde ao cadastro. Confira a conexão e tente novamente.';
    } catch (error) {
      status.textContent = error.code === 'permission-denied'
        ? 'Seu perfil não tem permissão para gerenciar o catálogo de Eventos.'
        : error.message || 'Não foi possível salvar as opções.';
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  });
}

async function loadEventEntryCatalog() {
  const form = document.querySelector('[data-module-form="events"]');
  const configForm = document.querySelector('#event-catalog-form');
  if (!form && !configForm) return;
  const uid = session.user.uid;
  const sequence = ++eventCatalogLoadSequence;
  const currentView = () => sequence === eventCatalogLoadSequence && session.user?.uid === uid && (form?.isConnected || configForm?.isConnected);
  const {getEventCatalog, listEventMembers} = await import('./data.js');
  const catalogTask = (async () => {
    try {
      const catalog = await getEventCatalog(uid);
      if (!currentView()) return;
      loadedEventCatalog = {payers: [...(catalog.payers || [])], creditors: [...(catalog.creditors || [])]};
      for (const [name, values] of [['payer', loadedEventCatalog.payers], ['creditor', loadedEventCatalog.creditors]]) {
        const select = form?.elements[name];
        if (!select) continue;
        const selected = select.value;
        select.replaceChildren(new Option(values.length ? 'Selecione' : `Nenhum ${name === 'payer' ? 'pagador' : 'credor'} cadastrado`, ''));
        for (const value of values) select.add(new Option(value, value));
        if (selected && !values.includes(selected)) select.add(new Option(`${selected} · opção histórica`, selected));
        select.value = selected;
        select.dataset.catalogEmpty = values.length === 0 ? 'true' : 'false';
      }
      if (form) populateEventSubstitutes(form);
      if (configForm) {
        configForm.elements.payers.value = loadedEventCatalog.payers.join('\n');
        configForm.elements.creditors.value = loadedEventCatalog.creditors.join('\n');
        const catalogStatus = configForm.querySelector('#event-catalog-status');
        if (catalogStatus) catalogStatus.textContent = loadedEventCatalog.payers.length && loadedEventCatalog.creditors.length
          ? `${loadedEventCatalog.payers.length} pagador(es) e ${loadedEventCatalog.creditors.length} credor(es) carregados do Firestore.`
          : 'Ainda não há Pagadores e Credores salvos para Eventos neste Firestore.';
      }
      const staleNote = form?.querySelector('#event-catalog-stale');
      if (staleNote) {
        const missing = [!loadedEventCatalog.payers.length && 'pagadores', !loadedEventCatalog.creditors.length && 'credores'].filter(Boolean);
        staleNote.textContent = missing.length
          ? `Sem ${missing.join(' e ')} no catálogo de Eventos. Abra Administração para configurar as opções.`
          : catalog.stale === true ? 'Opções carregadas do cache deste usuário. O Firestore validará cada lançamento ao sincronizar.' : '';
        staleNote.hidden = !staleNote.textContent;
      }
      const submit = form?.querySelector('[type="submit"]');
      if (submit) submit.disabled = !loadedEventCatalog.payers.length || !loadedEventCatalog.creditors.length;
      if (form) updateEventEntryFields(form);
      return {ok: true, catalog};
    } catch (error) {
      if (!currentView()) return;
      loadedEventCatalog = {payers: [], creditors: []};
      const submit = form?.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      const status = configForm?.querySelector('#event-catalog-status');
      if (status) status.textContent = `Não foi possível carregar as opções. ${error.message || ''}`;
      const staleNote = form?.querySelector('#event-catalog-stale');
      if (staleNote) {
        staleNote.hidden = false;
        staleNote.textContent = 'Não foi possível carregar as opções de Eventos. Verifique a conexão e abra Eventos novamente.';
      }
      return {ok: false, error};
    }
  })();
  const membersTask = form ? (async () => {
    const membersMissing = form.querySelector('#event-members-missing');
    try {
      const members = await listEventMembers();
      if (!currentView()) return;
      loadedEventMembers = members;
      if (membersMissing) {
        membersMissing.textContent = 'O catálogo de siglas está vazio. Cadastre siglas em Etiquetas ou sincronize contatos ativos em Pessoas.';
        membersMissing.hidden = members.length > 0;
      }
    } catch {
      if (!currentView()) return;
      loadedEventMembers = [];
      if (membersMissing) {
        membersMissing.hidden = false;
        membersMissing.textContent = 'Não foi possível carregar os nomes da equipe. Confira o membro antes de salvar.';
      }
    }
  })() : Promise.resolve();
  const [catalogResult] = await Promise.all([catalogTask, membersTask]);
  return catalogResult;
}

function populateEventSubstitutes(form) {
  const select = form?.elements.substitute;
  if (!select) return;
  const selected = select.value;
  const options = new Map();
  for (const raw of loadedEventCatalog.creditors) {
    const name = String(raw || '').trim().replace(/^[A-Z0-9]{2}\s*-\s*/, '').trim();
    if (name && name.toLocaleUpperCase('pt-BR') !== 'CAIXA DA EQUIPE') options.set(normalizeEventOption(name), name);
  }
  select.replaceChildren(new Option(options.size ? 'Selecione' : 'Nenhum substituto cadastrado', ''));
  for (const name of options.values()) select.add(new Option(name, name));
  if (selected && ![...options.values()].includes(selected)) select.add(new Option(`${selected} · opção histórica`, selected));
  select.value = selected;
}

async function loadLabelStaffCatalog() {
  const note = document.querySelector('#label-staff-catalog-note');
  try {
    const {listLabelStaffSiglas} = await import('./data.js');
    loadedLabelStaffSiglas = await listLabelStaffSiglas();
    const options = document.querySelector('#label-staff-options');
    if (options) {
      options.replaceChildren(...loadedLabelStaffSiglas.map((sigla) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'label-staff-option';
        button.dataset.sigla = sigla;
        button.setAttribute('aria-pressed', 'false');
        button.textContent = sigla;
        return button;
      }));
    }
    if (note) note.textContent = loadedLabelStaffSiglas.length
      ? 'Toque nas siglas para selecionar um ou mais plantonistas.'
      : 'Nenhuma sigla autorizada está disponível.';
  } catch (error) {
    loadedLabelStaffSiglas = [];
    if (note) note.textContent = `Não foi possível carregar o catálogo autorizado. ${error.message || ''}`;
  }
}

function syncLabelStaffSiglas() {
  const form = document.querySelector('[data-module-form="labels"]');
  const field = form?.elements.staffSiglas;
  const selected = [...document.querySelectorAll('#label-staff-options button[aria-pressed="true"]')].map((button) => button.dataset.sigla);
  if (field) field.value = selected.join(', ');
  if (form) syncLabelFieldStates(form);
}

function syncLabelFieldStates(form) {
  for (const field of form.querySelectorAll('[data-label-field], .form-grid > label')) {
    if (field.hidden) {
      field.classList.remove('label-field--required-empty', 'label-field--complete', 'label-field--inactive', 'label-field--optional-active');
      continue;
    }
    const controls = [...field.querySelectorAll('input:not([type="hidden"]), select, textarea')];
    if (!controls.length) continue;
    const activeControls = controls.filter((control) => !control.disabled);
    const requiredMissing = activeControls.some((control) => control.required && !String(control.value || '').trim());
    const requiredComplete = activeControls.some((control) => control.required) && !requiredMissing;
    const optionalAmount = field.dataset.labelField === 'amount' && activeControls.length > 0;
    field.classList.toggle('label-field--inactive', activeControls.length === 0 || (!requiredMissing && !requiredComplete && !optionalAmount && activeControls.every((control) => !String(control.value || '').trim())));
    field.classList.toggle('label-field--required-empty', requiredMissing);
    field.classList.toggle('label-field--complete', requiredComplete);
    field.classList.toggle('label-field--optional-active', optionalAmount);
  }
}

function setLabelStaffSiglas(values) {
  const selected = new Set(values.map((value) => String(value).trim().toUpperCase()).filter(Boolean));
  document.querySelectorAll('#label-staff-options button[data-sigla]').forEach((button) => {
    button.setAttribute('aria-pressed', String(selected.has(button.dataset.sigla.toUpperCase())));
  });
  syncLabelStaffSiglas();
}

function updateLabelEntryFields(form) {
  const normalize = (value) => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
  const type = normalize(form.elements.type.value);
  const consultation = type === 'consulta pre-anestesica';
  const sadt = type === 'sadt';
  const financial = ['particular', 'complementacao'].includes(type);
  const caixa = form.elements.creditor.value === 'Caixa' || consultation;
  const fields = {procedure: !consultation && !sadt, amount: financial || sadt, insurance: !consultation, staff: !caixa};
  const required = {procedure: !consultation && !sadt, amount: false, insurance: !consultation, staff: !caixa};
  for (const [name, visible] of Object.entries(fields)) {
    const label = form.querySelector(`[data-label-field="${name}"]`);
    const control = label?.querySelector('input');
    if (label) label.hidden = !visible;
    if (control) { control.disabled = !visible; control.required = required[name]; if (!visible) control.value = ''; }
    if (name === 'staff' && !visible) setLabelStaffSiglas([]);
  }
  const creditor = form.elements.creditor;
  if (consultation) creditor.value = 'Caixa';
  creditor.disabled = consultation;
  syncLabelFieldStates(form);
}

function bindLabelAi(workspace, form) {
  const fileInput = workspace.querySelector('#label-image-file');
  const openButton = workspace.querySelector('#label-camera-open');
  const manualButton = workspace.querySelector('#label-manual-open');
  const status = workspace.querySelector('#label-ai-status');
  const dialog = document.querySelector('#label-entry-dialog');
  if (!fileInput || !openButton) return () => {};
  const controller = new AbortController();
  const {signal} = controller;
  let generation = 0;
  let reading = false;
  const setBusy = (busy) => {
    reading = busy;
    openButton.disabled = busy;
    openButton.setAttribute('aria-busy', String(busy));
    const label = openButton.querySelector('.label-camera-label');
    if (label) label.textContent = busy ? 'LENDO ETIQUETA…' : 'ABRIR CÂMERA';
  };
  const setStatus = (message, visible = false) => {
    if (!status) return;
    status.textContent = message;
    if (visible) status.classList.remove('sr-only');
    else status.classList.add('sr-only');
  };
  const cancelRead = () => {
    generation++;
    setBusy(false);
  };
  openButton.addEventListener('click', () => {
    cancelRead();
    labelEntryGeneration++;
    updateLabelCameraConfirmation('', session.user?.uid || '');
    setStatus(labelAiEnabled ? 'Enquadre a etiqueta e toque em Capturar e Ler Etiqueta.' : 'Leitura por IA desativada. Você pode continuar pelo registro manual.');
  }, {signal});
  manualButton?.addEventListener('click', () => {
    cancelRead();
    setStatus('');
  }, {signal});
  fileInput.addEventListener('change', () => {
    cancelRead();
    setStatus('Ajuste o enquadramento e toque em Capturar e Ler Etiqueta.');
  }, {signal});
  fileInput.addEventListener('label-captured', async () => {
    const file = fileInput.files?.[0];
    const uid = session.user?.uid;
    if (!file || !uid || reading) return;
    if (!labelAiEnabled) {
      setStatus('Leitura por IA desativada. Use Registro Manual; a imagem não será enviada para a IA.', true);
      return;
    }
    const current = ++generation;
    const entryGeneration = labelEntryGeneration;
    const currentRequest = () => current === generation && form.isConnected && session.user?.uid === uid;
    const currentRead = () => currentRequest() && entryGeneration === labelEntryGeneration;
    updateLabelCameraConfirmation('', uid);
    setBusy(true);
    setStatus('Lendo a etiqueta…');
    try {
      const {extractLabelWithAi} = await import('./label-ai.js');
      if (!currentRead()) return;
      const result = await extractLabelWithAi(file);
      if (!currentRead()) return;
      resetLabelEditor({keepOpen: true});
      for (const name of ['patientName', 'insurance', 'procedureCode', 'encounterCode', 'type', 'creditor']) {
        if (result[name] && form.elements[name]) form.elements[name].value = result[name];
      }
      form.elements.type.dispatchEvent(new Event('change', {bubbles: true}));
      form.elements.creditor.dispatchEvent(new Event('change', {bubbles: true}));
      updateLabelEntryFields(form);
      form.elements.date.value = todayInputValue();
      form.dataset.labelEntrySource = 'camera';
      if (dialog && !dialog.open) dialog.showModal();
      const names = {patientName: 'nome', insurance: 'convênio', procedureCode: 'cirurgia', encounterCode: 'atendimento'};
      const uncertain = (result.uncertain || []).map((field) => names[field] || field);
      setStatus(uncertain.length
        ? `Rascunho lido por IA. Confira todos os campos; pendente ou incerto: ${uncertain.join(', ')}. Nada foi salvo ainda.`
        : 'Rascunho lido por IA. Confira os campos, especialmente os números, antes de salvar.');
      const formStatus = document.querySelector('#label-form-status');
      if (formStatus) formStatus.textContent = status?.textContent || '';
      form.elements.patientName.focus({preventScroll: true});
    } catch (error) {
      if (currentRead()) setStatus(error?.message || 'Não foi possível realizar a leitura por IA. Tente novamente ou preencha os campos manualmente.', true);
    } finally {
      if (currentRequest()) {
        fileInput.value = '';
        setBusy(false);
      }
    }
  }, {signal});
  return () => {
    controller.abort();
    cancelRead();
    fileInput.value = '';
  };
}

function renderTrainingAdminList(items) {
  const target = document.querySelector('#training-admin-list');
  if (!target) return;
  target.innerHTML = items.length ? `<ul class="record-list">${items.map((item) => `<li><div class="contact-list-heading"><strong>${escapeHtml(item.title || 'Treinamento')}</strong><button class="secondary-button" type="button" data-training-edit="${escapeHtml(item.id)}">Editar</button></div><small>${item.active === true ? 'Ativo' : 'Inativo'} · ordem ${escapeHtml(item.order ?? '—')} · ${escapeHtml(item.videoId || 'vídeo sem ID reconhecido')}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhum treinamento cadastrado. Use o formulário para publicar o primeiro.</p>';
}

function renderLearningActivityAdminList(items) {
  const target = document.querySelector('#learning-activity-admin-list');
  if (!target) return;
  target.innerHTML = items.length ? `<ul class="record-list">${items.map((item) => `<li><div class="contact-list-heading"><strong>${escapeHtml(item.title || 'Atividade')}</strong><button class="secondary-button" type="button" data-learning-activity-edit="${escapeHtml(item.id)}">Editar</button></div><small>${item.status === 'ACTIVE' ? 'Publicada' : 'Inativa'} · ${escapeHtml(item.sourceKind || 'EXTERNAL_LINK')} · ${escapeHtml(item.audienceType || '')}${item.audienceValue ? ` (${escapeHtml(item.audienceValue)})` : ''} · versão ${escapeHtml(item.version ?? '—')}</small><small class="record-meta">${escapeHtml(item.category || 'Sem categoria')} · ordem ${escapeHtml(item.order ?? '—')}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhuma atividade cadastrada. Use o formulário para publicar a primeira.</p>';
}

function timestampInputDate(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({type, value: part}) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

async function loadChecklistStationAdmin() {
  const form = document.querySelector('#checklist-station-form');
  const target = document.querySelector('#checklist-station-list');
  if (!form || !target) return;
  const status = document.querySelector('#checklist-station-status');
  const cancel = document.querySelector('#station-edit-cancel');
  const reset = () => {
    form.reset();
    form.elements.stationId.value = '';
    form.elements.order.value = '0';
    form.elements.active.checked = true;
    if (status) status.textContent = '';
  };
  cancel?.addEventListener('click', reset);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    if (status) status.textContent = 'Salvando estação…';
    try {
      const {saveChecklistStation, listModuleRecords} = await import('./data.js');
      await saveChecklistStation({
        stationId: form.elements.stationId.value,
        name: form.elements.name.value,
        qrCode: form.elements.qrCode.value,
        start: form.elements.start.value,
        end: form.elements.end.value,
        order: Number(form.elements.order.value),
        active: form.elements.active.checked
      }, session.user.uid);
      reset();
      if (status) status.textContent = 'Estação salva no Firestore.';
      await refresh();
      const activeStations = await listModuleRecords('checklist', session.user.uid, {pageSize: 200});
      await loadChecklistView(activeStations);
    } catch (error) {
      if (status) status.textContent = error.code === 'permission-denied'
        ? 'Seu perfil não tem permissão para manter o catálogo do Checklist.'
        : error.message || 'Não foi possível salvar a estação.';
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  async function refresh() {
    try {
      const {listChecklistStations} = await import('./data.js');
      const stations = await listChecklistStations();
      target.innerHTML = stations.length ? `<ul class="record-list">${stations.map((station) => `<li><div class="contact-list-heading"><strong>${escapeHtml(station.name || station.id)}</strong><button class="secondary-button" type="button" data-station-edit="${escapeHtml(station.id)}">Editar</button></div><small>${escapeHtml(station.qrCode || '')} · ordem ${escapeHtml(station.order ?? 0)} · ${station.active ? 'Ativa' : 'Inativa'}</small><small class="record-meta">${station.start ? `De ${escapeHtml(formatRecordDate(station.start))}` : 'Sem início'} · ${station.end ? `até ${escapeHtml(formatRecordDate(station.end))}` : 'sem fim'}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhuma estação cadastrada. Adicione a primeira estação para iniciar o Checklist.</p>';
      target.querySelectorAll('[data-station-edit]').forEach((button) => button.addEventListener('click', () => {
        const station = stations.find((item) => item.id === button.dataset.stationEdit);
        if (!station) return;
        form.elements.stationId.value = station.id;
        form.elements.name.value = station.name || '';
        form.elements.qrCode.value = station.qrCode || '';
        form.elements.start.value = station.start || '';
        form.elements.end.value = station.end || '';
        form.elements.order.value = String(station.order ?? 0);
        form.elements.active.checked = station.active === true;
        if (status) status.textContent = `Editando ${station.name || station.id}.`;
        form.scrollIntoView({behavior: 'smooth', block: 'center'});
        form.elements.name.focus({preventScroll: true});
      }));
    } catch (error) {
      target.innerHTML = `<p class="empty-state">Não foi possível carregar o catálogo de estações. ${escapeHtml(error.message || '')}</p>`;
    }
  }
  await refresh();
}

function bindEventSchedule() {
  const dateInput = document.querySelector('#event-schedule-date');
  const content = document.querySelector('#event-schedule-content');
  if (!dateInput || !content) return;
  const canLaunchSupport = can('eventsWrite') && featureEnabledForRoute('events', appFeatures);
  dateInput.value = localDateKey();
  let requestSequence = 0;
  const vacationCache = new Map();
  const render = async () => {
    const requestId = ++requestSequence;
    const day = dateInput.value;
    if (!day) return;
    content.innerHTML = '<p class="loading">Carregando escala…</p>';
    try {
      const {readSchedule, listVacationsForDate} = await import('./data-lite.js');
      const cachedVacations = vacationCache.get(day);
      const vacationsPromise = cachedVacations && Date.now() - cachedVacations.at < 30_000
        ? Promise.resolve({items: cachedVacations.items})
        : listVacationsForDate(day, {uid: session.user.uid}).then((items) => {
          vacationCache.set(day, {items, at: Date.now()});
          if (vacationCache.size > 40) vacationCache.delete(vacationCache.keys().next().value);
          return {items};
        }, (error) => ({error}));
      const schedule = await readSchedule(day, session.user.uid);
      if (requestId !== requestSequence || !content.isConnected) return;
      if (!schedule) {
        content.innerHTML = `<p class="empty-state">Nenhuma escala publicada para esta data.</p>${canLaunchSupport ? `<div class="siglas-grid schedule-siglas-grid event-support-only">${renderEventSupportTile(true)}</div>` : ''}`;
        bindEventSupportButton(content, day);
        return;
      }
      let vacations = [];
      let vacationsError = false;
      const draw = () => {
        if (requestId !== requestSequence || !content.isConnected) return;
        const view = buildScheduleView(schedule, day, vacations, []);
        if (!view.positions.length) {
          content.innerHTML = `<p class="empty-state">A escala está publicada sem posições para esta data.</p>${canLaunchSupport ? `<div class="siglas-grid schedule-siglas-grid event-support-only">${renderEventSupportTile(true)}</div>` : ''}`;
          bindEventSupportButton(content, day);
          return;
        }
        const vacationStatus = vacationsError ? '<p class="sync-state">Não foi possível consultar as férias deste dia.</p>' : vacations.some((vacation) => vacation.stale) ? '<p class="sync-state">Férias carregadas do cache deste aparelho.</p>' : '';
        const grid = renderSchedulePositionGrid(view, {mode: 'events', schedule, eventsWritable: canLaunchSupport});
        content.innerHTML = `${grid}${schedule.stale ? '<p class="sync-state">Mostrando a última escala salva neste aparelho.</p>' : ''}${vacationStatus}`;
        content.querySelectorAll('[data-schedule-position-index]').forEach((button) => button.addEventListener('click', () => {
          const position = view.positions[Number(button.dataset.schedulePositionIndex)];
          if (position) void launchEventFromSchedule(day, position);
        }));
        bindEventSupportButton(content, day);
      };
      draw();
      const vacationResult = await vacationsPromise;
      if (requestId !== requestSequence || !content.isConnected) return;
      vacations = vacationResult.items || [];
      vacationsError = Boolean(vacationResult.error);
      draw();
    } catch (error) {
      if (requestId !== requestSequence || !content.isConnected) return;
      content.innerHTML = `<p class="empty-state">${error.code === 'permission-denied' ? 'Seu perfil precisa de permissão para consultar a escala.' : 'Não foi possível carregar a escala. Verifique a conexão e tente novamente.'}</p>`;
    }
  };
  const renderSelectedScheduleDay = () => {
    void render();
    if (eventReportOpen && eventReportMode === 'daily') void loadEventReport();
  };
  document.querySelector('#event-schedule-previous')?.addEventListener('click', () => { dateInput.value = shiftDateKey(dateInput.value, -1); renderSelectedScheduleDay(); });
  document.querySelector('#event-schedule-today')?.addEventListener('click', () => { dateInput.value = localDateKey(); renderSelectedScheduleDay(); });
  document.querySelector('#event-schedule-next')?.addEventListener('click', () => { dateInput.value = shiftDateKey(dateInput.value, 1); renderSelectedScheduleDay(); });
  dateInput.addEventListener('change', renderSelectedScheduleDay);
  void render();
}

function bindEventSupportButton(content, day) {
  content.querySelector('[data-event-support]')?.addEventListener('click', () => launchEventSupport(day));
}

function launchEventSupport(day) {
  if (!can('eventsWrite') || !featureEnabledForRoute('events', appFeatures)) return;
  const form = document.querySelector('[data-module-form="events"]');
  if (!form) return;
  resetEventEditor();
  setEventTypeContext(form, 'support');
  form.elements.eventDate.value = day;
  form.elements.memberSigla.value = '';
  form.elements.scheduleSigla.value = 'SUPORTE';
  form.elements.memberStatus.value = 'SUPORTE';
  form.elements.eventType.value = 'Suporte';
  updateEventEntryFields(form);
  const status = document.querySelector('#event-form-status');
  if (status) status.textContent = 'Evento de Suporte iniciado. Selecione o substituto e o turno.';
  const dialog = document.querySelector('#event-launch-dialog');
  if (dialog && !dialog.open) dialog.showModal();
  document.querySelector('#event-launch-title')?.focus({preventScroll: true});
}

async function launchEventFromSchedule(day, position) {
  if (!can('eventsWrite')) return;
  const scheduleSigla = String(position.sigla || '').trim().toUpperCase();
  const scheduledSiglas = [...new Set((position.siglas?.length ? position.siglas : [scheduleSigla])
    .map((sigla) => String(sigla || '').trim().toUpperCase()).filter((sigla) => /^(?:[A-Z]{2}|L2)$/.test(sigla)))];
  const choices = scheduledSiglas.map((sigla) => loadedEventMembers.find((member) => member.sigla === sigla) || {sigla, name: sigla});
  let selected = choices[0] || {sigla: scheduleSigla, name: scheduleSigla};
  if (choices.length > 1) {
    selected = await chooseEventScheduleMember(scheduleSigla, choices);
    if (!selected) return;
  }
  const form = document.querySelector('[data-module-form="events"]');
  if (!form) return;
  resetEventEditor();
  setEventTypeContext(form, 'schedule');
  const memberSigla = String(selected.sigla || scheduleSigla).toUpperCase();
  form.elements.eventDate.value = day;
  form.elements.editEventId.value = '';
  form.elements.editEventVersion.value = '';
  form.elements.memberSigla.value = memberSigla;
  form.elements.scheduleSigla.value = scheduleSigla;
  form.elements.eventType.value = '';
  form.elements.delayMultiple.value = '';
  form.elements.substitute.value = '';
  form.elements.shift.value = '';
  form.elements.payer.value = '';
  form.elements.creditor.value = '';
  form.elements.amountToPay.value = '';
  form.elements.description.value = '';
  form.elements.memberStatus.value = selected.name && selected.name !== memberSigla ? selected.name : memberSigla;
  form.elements.memberStatus.readOnly = selected.name !== memberSigla;
  updateEventEntryFields(form);
  const status = document.querySelector('#event-form-status');
  status.textContent = selected.name === memberSigla
    ? `Sigla ${memberSigla} selecionada. O nome precisa ser conferido no cadastro de Pessoas.`
    : '';
  const dialog = document.querySelector('#event-launch-dialog');
  if (dialog && !dialog.open) dialog.showModal();
  // Não forçar foco programático no <select>: no Safari/iOS isso pode consumir o primeiro toque.
}

function setEventTypeContext(form, context) {
  const select = form?.elements.eventType;
  if (!select) return;
  const support = [...select.options].find((option) => option.value === 'Suporte');
  if (support) support.disabled = context !== 'support';
  select.disabled = context === 'support';
}

function chooseEventScheduleMember(scheduleSigla, choices) {
  const dialog = document.querySelector('#event-schedule-choice-dialog');
  const options = document.querySelector('#event-schedule-choice-options');
  if (!dialog || !options) return Promise.resolve(null);
  document.querySelector('#event-schedule-choice-title').textContent = `Escolha o anestesiologista · ${scheduleSigla}`;
  options.replaceChildren();
  let selected = null;
  for (const choice of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = choice.name && choice.name !== choice.sigla ? `${choice.name} · ${choice.sigla}` : `Sigla ${choice.sigla} · nome não cadastrado`;
    button.addEventListener('click', () => { selected = choice; dialog.close(); });
    options.append(button);
  }
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(selected), {once: true});
    dialog.showModal();
  });
}

function updateEventEntryFields(form) {
  if (!form?.elements?.eventType) return;
  const eventType = form.elements.eventType.value;
  const rules = eventFieldRules(eventType);
  const editing = Boolean(form.elements.editEventId?.value);
  for (const name of ['memberStatus', 'description', 'delayMultiple', 'substitute', 'shift']) {
    const visible = rules[name];
    const field = form.querySelector(`[data-event-field="${name}"]`);
    const control = form.elements[name];
    if (field) field.hidden = !visible;
    if (!control) continue;
    control.required = visible;
    if (!visible) control.value = '';
    control.disabled = (!visible && name === 'memberStatus') || (name === 'substitute' && rules.disableSubstitute === true);
  }

  // V1 completes payer, creditor and amount from the selected event type,
  // member, substitute, shift or delay. Keep those values inside V2's
  // authorized Firestore catalogs and leave a field editable if no match exists.
  const memberName = String(form.elements.memberStatus.value || '').trim();
  const substitute = String(form.elements.substitute.value || '').trim();
  const payerOptions = loadedEventCatalog.payers;
  const creditorOptions = loadedEventCatalog.creditors;
  const payerValue = rules.payerMode === 'team'
    ? findEventCatalogValue(payerOptions, 'CAIXA DA EQUIPE')
    : rules.payerMode === 'member' ? findEventPersonCatalogValue(payerOptions, memberName) : '';
  const creditorValue = rules.creditorMode === 'team'
    ? findEventCatalogValue(creditorOptions, 'CAIXA DA EQUIPE')
    : rules.creditorMode === 'substitute' ? findEventPersonCatalogValue(creditorOptions, substitute) : '';
  applyEventSelectAutofill(form.elements.payer, payerValue, editing);
  applyEventSelectAutofill(form.elements.creditor, creditorValue, editing);

  const amount = eventAmountToPay(eventType, form.elements.delayMultiple.value, form.elements.shift.value);
  applyEventAmountAutofill(form.elements.amountToPay, amount, editing, rules.amountMode !== 'manual');
  const requiredByType = {eventDate: true, eventType: true, memberStatus: rules.memberStatus, description: rules.description, delayMultiple: rules.delayMultiple, substitute: rules.substitute, shift: rules.shift, payer: true, creditor: true, amountToPay: true};
  for (const [name, required] of Object.entries(requiredByType)) {
    const control = form.elements[name];
    if (!control) continue;
    const wrapper = control.closest('label') || control.closest('[data-event-field]');
    const inactive = name !== 'eventDate' && name !== 'eventType' && (!eventType || (control.disabled && control.dataset.eventAutofilled !== 'true') || (['memberStatus', 'description', 'delayMultiple', 'substitute', 'shift'].includes(name) && !rules[name]));
    const complete = String(control.value || '').trim().length > 0;
    const state = inactive ? 'inactive' : required && complete ? 'complete' : required ? 'required' : 'optional';
    control.dataset.eventFieldState = state;
    wrapper?.classList.toggle('event-field--inactive', inactive);
    wrapper?.classList.toggle('event-field--required-empty', !inactive && required && !complete);
    wrapper?.classList.toggle('event-field--complete', !inactive && required && complete);
  }
}

function normalizeEventOption(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function findEventCatalogValue(options, desired) {
  const normalized = normalizeEventOption(desired);
  if (!normalized) return '';
  return options.find((value) => normalizeEventOption(value) === normalized) || '';
}

function findEventPersonCatalogValue(options, personName) {
  const normalized = normalizeEventOption(personName);
  if (!normalized) return '';
  return options.find((value) => {
    const candidate = String(value || '').trim().replace(/^[A-Z0-9]{2}\s*-\s*/, '');
    return normalizeEventOption(candidate) === normalized;
  }) || '';
}

function applyEventSelectAutofill(select, value, editing) {
  if (!select) return;
  const wasAutofilled = select.dataset.eventAutofilled === 'true';
  if (editing) {
    select.dataset.eventAutofilled = 'false';
    if (select.name !== 'substitute') select.disabled = select.dataset.catalogEmpty === 'true';
    return;
  }
  if (value) {
    select.value = value;
    select.dataset.eventAutofilled = 'true';
    select.disabled = true;
    return;
  }
  if (wasAutofilled) select.value = '';
  select.dataset.eventAutofilled = 'false';
  if (select.name !== 'substitute') select.disabled = select.dataset.catalogEmpty === 'true';
}

function applyEventAmountAutofill(input, value, editing, automatic = false) {
  if (!input) return;
  const wasAutofilled = input.dataset.eventAutofilled === 'true';
  if (automatic) {
    if (Number.isFinite(value)) {
      input.value = String(value);
      input.dataset.eventAutofilled = 'true';
      input.disabled = true;
    } else {
      if (wasAutofilled || editing) input.value = '';
      input.dataset.eventAutofilled = 'false';
      input.disabled = true;
    }
    return;
  }
  if (editing) {
    input.dataset.eventAutofilled = 'false';
    input.disabled = false;
    return;
  }
  if (Number.isFinite(value)) {
    input.value = String(value);
    input.dataset.eventAutofilled = 'true';
    input.disabled = true;
    return;
  }
  if (wasAutofilled) input.value = '';
  input.dataset.eventAutofilled = 'false';
  input.disabled = false;
}

async function render() {
  evaluationModuleGeneration++;
  for (const kind of ['events', 'labels', 'checklist']) { const scope = liveReports.get(kind)?.snapshot().scope; if (scope?.warm !== true && (scope || reportStates.has(kind) || reportPayloads.has(kind))) closeReportLive(kind, 'render'); }
  labelReportLoad++;
  labelReportLoadingMore = false;
  labelReportState = 'idle';
  if (cleanupLabelMedia) {
    cleanupLabelMedia();
    cleanupLabelMedia = null;
  }
  stopChecklistQrScanner();
  if (cleanupCurrentModule) {
    const cleanup = cleanupCurrentModule;
    cleanupCurrentModule = null;
    await cleanup();
  }
  if (startupBannerActive) {
    if (app.querySelector('.boot-screen')) return;
    app.innerHTML = `<main class="boot-screen" role="status" aria-live="polite"><div class="boot-card">
      <img src="${import.meta.env.BASE_URL}assets/icon-192.png" width="76" height="76" alt="SAHMT">
      <strong>SAHMT</strong><span class="boot-slogan" aria-label="Gestão responsável! Gestão eficiente! Gestão na palma da mão!"><span class="boot-slogan__phrase" aria-hidden="true">Gestão responsável!</span><span class="boot-slogan__phrase" aria-hidden="true">Gestão eficiente!</span><span class="boot-slogan__phrase" aria-hidden="true">Gestão na palma da mão!</span></span>
      <span class="boot-particles" aria-hidden="true">${[
        [-92, 48, '.02s', '#46d98b'], [-68, 66, '.10s', '#43a5ff'], [-43, 38, '.18s', '#ffc857'], [-21, 78, '.26s', '#ff7a59'],
        [4, 52, '.34s', '#b88cff'], [28, 72, '.42s', '#5ee7d2'], [53, 43, '.50s', '#ffd166'], [80, 64, '.58s', '#ff8fb3'],
        [-106, 88, '.66s', '#7ce38b'], [104, 82, '.74s', '#70b7ff'], [-57, 96, '.82s', '#ffb347'], [62, 98, '.90s', '#d59bff']
      ].map(([x, y, delay, color]) => `<i class="boot-particle" style="--x:${x}px;--y:${y}px;--d:${delay};--c:${color}"></i>`).join('')}</span>
      <i class="boot-spinner" aria-hidden="true"></i>
    </div></main>`;
    return;
  }
  if (session.status === 'checking' || session.status === 'loading-profile') {
    app.innerHTML = `<main class="login-gate"><section class="login-card" role="status" aria-live="polite"><h1>SAHMT</h1><p>Verificando acesso…</p><i class="boot-spinner" aria-hidden="true"></i></section></main>`;
    return;
  }
  if (session.status !== 'signed-in') {
    app.innerHTML = loginView();
    bindLogin();
    return;
  }
  const requestedRoute = currentRoute();
  if (!featureEnabledForRoute(requestedRoute, appFeatures)) {
    notice = `${labels[requestedRoute]?.[0] || 'Esta área'} está desativada pela Administração.`;
    navigate('home');
    return;
  }
  app.innerHTML = shellView();
  preloadOperationalDataWhenIdle(session.user);
  document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.route)));
  document.querySelector('#outbox-open')?.addEventListener('click', () => navigate('offline'));
  if (currentRoute() === 'home') await loadHome(); else {
    const route = currentRoute();
    if (route === 'events') await bindModuleForm(route);
    await loadModule(route);
    if (route !== 'events') await bindModuleForm(route);
  }
  void updateOutboxStatus();
  if (navigator.onLine) void syncOutbox();
}

async function updateOutboxStatus() {
  const target = document.querySelector('#outbox-status');
  if (!target || session.status !== 'signed-in') return;
  const [counts, pendingProgress, retryableFailures] = await Promise.all([
    operationCounts(session.user.uid),
    pendingTrainingProgressCount(session.user.uid),
    retryableFailedOperationCount(session.user.uid)
  ]);
  const count = counts.queued + counts.failed + counts.conflict;
  const details = [count ? `${count} ação(ões) ${counts.conflict ? 'para revisar' : counts.failed ? 'com falha' : 'pendente(s)'}` : '', pendingProgress ? `progresso de vídeo pendente (${pendingProgress})` : ''].filter(Boolean).join(' · ');
  const syncLabel = !navigator.onLine ? `Offline${details ? ` · ${details}` : ''}` : details || (session.offline ? 'Perfil local' : 'Sincronizado');
  const isSynced = syncLabel === 'Sincronizado';
  target.innerHTML = `<button type="button" id="outbox-open" class="sync-status-button${isSynced ? ' sync-status-button--synced' : ''}" aria-label="${escapeHtml(`${syncLabel} — abrir estado de sincronização`)}">${isSynced ? '<span class="sync-status-icon" aria-hidden="true">✓</span><span class="sr-only">Sincronizado</span>' : escapeHtml(syncLabel)}</button>${retryableFailures ? '<button type="button" id="retry-outbox">Tentar novamente</button>' : ''}`;
  updateLabelReportSync();
  target.querySelector('#outbox-open')?.addEventListener('click', () => navigate('offline'));
  target.querySelector('#retry-outbox')?.addEventListener('click', async () => {
    await retryFailedOperations(session.user.uid);
    await syncOutbox();
  });
}

function scheduleOutboxRetry(uid, attemptAt) {
  if (!uid || !Number.isFinite(attemptAt)) {
    if (!uid || outboxRetryUid === uid) {
      clearTimeout(outboxRetryTimer);
      outboxRetryTimer = null;
      outboxRetryAt = 0;
      outboxRetryUid = '';
    }
    return;
  }
  if (outboxRetryTimer && outboxRetryUid === uid && outboxRetryAt <= attemptAt) return;
  clearTimeout(outboxRetryTimer);
  outboxRetryUid = uid;
  outboxRetryAt = attemptAt;
  outboxRetryTimer = window.setTimeout(() => {
    outboxRetryTimer = null;
    outboxRetryAt = 0;
    outboxRetryUid = '';
    if (session.status === 'signed-in' && session.user.uid === uid && navigator.onLine) void syncOutbox();
  }, Math.max(0, attemptAt - Date.now()));
}

async function scheduleNextOutboxRetry(uid) {
  try {
    scheduleOutboxRetry(uid, await nextQueuedAttemptAt(uid));
  } catch (error) {
    console.warn('[SAHMT sync] Não foi possível agendar a próxima tentativa:', error.code || error.message);
  }
}

async function syncOutbox() {
  if (!navigator.onLine || session.status !== 'signed-in') return;
  const uid = session.user.uid;
  try {
    const [counts, pendingProgress] = await Promise.all([
      operationCounts(uid),
      pendingTrainingProgressCount(uid)
    ]);
    if (!counts.queued && !pendingProgress) return;
    const {flushOutbox, syncPendingTrainingProgress} = await import('./data.js');
    await flushOutbox(uid);
    await syncPendingTrainingProgress(uid);
    await updateOutboxStatus();
    if (currentRoute() === 'offline') {
      const content = document.querySelector('#module-content');
      if (content) await loadOfflineView(content);
    }
  } catch (error) {
    console.warn('[SAHMT sync] Outbox indisponível:', error.code || error.message);
  } finally {
    if (session.status === 'signed-in' && session.user.uid === uid) await scheduleNextOutboxRetry(uid);
  }
}

function bindLogin() {
  document.querySelector('#request-access')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Enviando solicitação…';
    notice = '';
    try {
      const {createAccessRequest} = await import('./data.js');
      await createAccessRequest(session.user);
      session = {...session, status: 'access-pending'};
      notice = 'Solicitação enviada. O administrador verá o pedido na área Administração.';
    } catch (error) {
      notice = error.code === 'permission-denied'
        ? 'O Firestore não autorizou o pedido. Entre com a conta Google correta e tente novamente.'
        : `Não foi possível enviar a solicitação: ${error.message || error}`;
    }
    await render();
  });
  document.querySelector('#profile-retry')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    notice = '';
    await retryAuthenticatedProfile();
  });
  document.querySelector('#google-login')?.addEventListener('click', async () => {
    try { notice = ''; await signInGoogle(); }
    catch { notice = 'Não foi possível entrar com Google. Verifique a conta e tente novamente.'; await render(); }
  });
}

function sessionChanged(next) {
  const preserveEvaluationModule = cleanupCurrentModule?.canPreserveSession?.(session, next) === true;
  const previousPresentation = JSON.stringify([session.status, session.user?.uid, session.profile?.displayName, session.profile?.sigla, session.profile?.role, session.profile?.active, session.profile?.access, Object.entries(session.profile?.permissions || {}).sort(([left], [right]) => left.localeCompare(right))]);
  const nextPresentation = JSON.stringify([next.status, next.user?.uid, next.profile?.displayName, next.profile?.sigla, next.profile?.role, next.profile?.active, next.profile?.access, Object.entries(next.profile?.permissions || {}).sort(([left], [right]) => left.localeCompare(right))]);
  const generalReadPermissions = ['trainingsRead', 'notificationsRead'];
  const presentationWithoutGeneralReads = (value) => JSON.stringify([value.status, value.user?.uid, value.profile?.displayName, value.profile?.sigla, value.profile?.role, value.profile?.active, value.profile?.access, Object.entries(value.profile?.permissions || {}).filter(([key]) => !generalReadPermissions.includes(key)).sort(([left], [right]) => left.localeCompare(right))]);
  const onlyGeneralReadGrant = session.status === 'signed-in' && next.status === 'signed-in' &&
    Boolean(session.user?.uid) && session.profile?.active === true && session.profile?.access === true &&
    presentationWithoutGeneralReads(session) === presentationWithoutGeneralReads(next) &&
    generalReadPermissions.some((key) => session.profile?.permissions?.[key] !== true && next.profile?.permissions?.[key] === true) &&
    generalReadPermissions.every((key) => session.profile?.permissions?.[key] === next.profile?.permissions?.[key] || next.profile?.permissions?.[key] === true);
  const preserveCurrentModule = onlyGeneralReadGrant && !['home', 'training', 'notifications'].includes(currentRoute());
  const unchangedPresentation = previousPresentation === nextPresentation;
  const userChanged = session.user?.uid !== next.user?.uid;
  if (userChanged || next.status !== 'signed-in') {
    startupReports.clear(); liveReports.clear('session-changed'); reportPayloads.clear(); reportPaintKeys.clear(); reportStates.clear(); suspendedReportScopes = []; checklistCatalogLive = null; checklistModuleStations = []; checklistResponsibilityLive = null; loadedLabelRecords = []; loadedEventReportRecords = []; eventReportSourceRecords = []; checklistReportContext = null;
    for (const [kind, waiter] of reportWaiters) settleReportWaiter(kind, waiter.key, false);
  }
  if (next.status !== 'signed-in' || userChanged) {
    labelManualConfirmation = {uid: '', status: ''};
    labelCameraConfirmation = {uid: '', status: ''};
    scheduleOutboxRetry('', null);
  }
  if (next.status !== 'signed-in') {
    appFeatures = {...DEFAULT_APP_FEATURES};
    appFeaturesUid = '';
    appFeaturesLoadSequence++;
  } else if (userChanged) {
    appFeatures = {...DEFAULT_APP_FEATURES};
    appFeaturesUid = '';
  }
  session = next;
  notice = '';
  if (startupBannerActive && next.status === 'signed-in') {
    if (userChanged) preloadStartupReports(next.user);
    preloadOperationalDataWhenIdle(next.user);
    if (navigator.onLine) {
      void syncOutbox();
      if (userChanged && can('scheduleRead')) {
        const uid = next.user.uid;
        void import('./data-lite.js').then(async ({readSchedule}) => {
          if (session.status === 'signed-in' && session.user.uid === uid) await readSchedule(todayInputValue(), uid);
        }).catch((error) => console.warn('[SAHMT] Escala inicial será carregada na tela:', error.code || error.message));
      }
    }
  }
  if (!unchangedPresentation && !preserveCurrentModule && !preserveEvaluationModule) void render();
  else if (preserveEvaluationModule) {
    cleanupCurrentModule?.revalidate?.(); cleanupCurrentModule?.updateProfile?.(next.profile);
    const identity = document.querySelector?.('.identity-card__user'); if (identity) identity.textContent = next.profile?.displayName || next.user?.displayName || 'Usuário';
  }
  else for (const kind of ['events', 'labels', 'checklist']) updateReportSync(kind);
  if (next.status === 'signed-in' && (userChanged || appFeaturesUid !== next.user.uid)) void refreshAppFeatures(next.user.uid);
}
async function refreshAppFeatures(uid, force = false) {
  if (!uid || (!force && appFeaturesUid === uid)) return;
  const sequence = ++appFeaturesLoadSequence;
  appFeaturesUid = uid;
  try {
    const {readAppFeatures} = await import('./data-lite.js');
    const features = normalizeAppFeatures(await readAppFeatures(uid));
    if (sequence !== appFeaturesLoadSequence || session.status !== 'signed-in' || session.user?.uid !== uid) return;
    const unchanged = JSON.stringify(appFeatures) === JSON.stringify(features);
    const preserveEvaluationModule = Boolean(cleanupCurrentModule?.canPreserveSession) && featureEnabledForRoute(currentRoute(), features);
    appFeatures = features;
    if (!unchanged && !preserveEvaluationModule) await render();
    else if (preserveEvaluationModule) cleanupCurrentModule?.revalidate?.();
  } catch (error) {
    if (sequence !== appFeaturesLoadSequence || session.status !== 'signed-in' || session.user?.uid !== uid) return;
    appFeatures = {...DEFAULT_APP_FEATURES};
    console.warn('[SAHMT] Configuração de módulos indisponível; usando padrões locais:', error.code || error.message);
  }
}
window.addEventListener('hashchange', () => { if (session.status === 'signed-in') void render(); });
window.addEventListener('online', () => {
  cleanupCurrentModule?.setOnline?.(true);
  liveReports.setOnline(true);
  if (session.status === 'signed-in') {
    for (const kind of ['events', 'labels', 'checklist']) if (liveReports.get(kind)?.snapshot().scope?.warm === false) liveReports.refresh(kind, 'reconnect');
    void refreshAppFeatures(session.user.uid, true);
    void syncOutbox();
  }
});
window.addEventListener('offline', () => { cleanupCurrentModule?.setOnline?.(false); liveReports.setOnline(false); invalidateChecklistSignature('Sem conexão. Aguarde a reconciliação antes de assinar.'); void updateOutboxStatus(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cleanupCurrentModule?.suspend?.();
    suspendedReportScopes = ['events', 'labels', 'checklist'].map(kind => liveReports.get(kind)?.snapshot().scope).filter(scope => scope && !scope.warm);
    for (const scope of suspendedReportScopes) { liveReports.close(scope.kind, 'suspend'); reportStates.set(scope.kind, {scope, state: navigator.onLine ? 'awaiting' : 'offline', confirmed: false}); updateReportSync(scope.kind); }
    startupReports.clear();
    invalidateChecklistSignature('O app foi suspenso. Aguarde a conferência ao retornar.');
  } else {
    cleanupCurrentModule?.resume?.();
    const scopes = suspendedReportScopes; suspendedReportScopes = [];
    for (const scope of scopes) if (reportScopeCurrent(scope)) liveReports.open(scope.kind, scope, {force: true});
  }
});
function refreshLivePending() {
  if (session.status === 'signed-in') void liveReports.invalidatePending(session.user.uid);
  void updateOutboxStatus();
}
window.addEventListener('sahmt-write-synced', (event) => {
  refreshLivePending();
  if (event.detail?.type === 'scheduleReleases' && currentRoute() === 'home') void render();
});
window.addEventListener('sahmt-write-queued', () => {
  refreshLivePending();
  if (navigator.onLine && session.status === 'signed-in') void syncOutbox();
});
window.addEventListener('sahmt-write-rejected', (event) => {
  notice = 'O Firestore recusou a gravação; ela não foi confirmada. ' + (event.detail?.message || '');
  refreshLivePending();
  if (!['events', 'labels', 'checklist'].includes(currentRoute())) void render();
});
void render();
if (startupBannerActive) window.setTimeout(() => {
  startupBannerActive = false;
  void render();
}, STARTUP_BANNER_DURATION_MS);
watchSession(sessionChanged);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, {scope: import.meta.env.BASE_URL}).catch((error) => console.error('[SAHMT PWA] Service Worker', error)));
}
