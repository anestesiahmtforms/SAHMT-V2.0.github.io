import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {captureReportReadScope} from '../src/report-read-scope.js';
import {sessionChangeRevokesAccess, sessionChangeRequiresRender, sessionChangeGrantsAccess} from '../src/session-refresh.js';
import {DEFAULT_APP_FEATURES, featureEnabledForRoute} from '../src/feature-flags.js';
import {labelReportPresentation, withLabelReportDeadline} from '../src/label-report-state.js';
import {createChecklistReportGate} from '../src/checklist-report-gate.js';
import {summarizeChecklistMonth} from '../src/checklist-date.js';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end).replaceAll("await import('./data.js')", 'await fixtureImport()')
    .replaceAll("await import('./label-report-reader.js')", 'await fixtureImport()');
}
const commonSource = extract('function captureReportScope(', 'function preloadStartupReports(') +
  extract('function can(permission)', 'function captureWriteSession(') +
  extract('function sessionChanged(next)', 'async function refreshAppFeatures');
const loaders = {
  events: extract('async function loadEventReport(', 'function beginEventEdit('),
  labels: extract('function updateLabelReportSync()', 'function beginLabelEdit('),
  checklist: extract('function selectedChecklistReportPeriod(', 'async function loadDailyChecklist(') +
    extract('async function loadMonthlyChecklist(', 'async function saveChecklistAnswer(') +
    extract('async function loadChecklistView(', 'async function loadOfflineView(')
};
function callbackSource(route) {
  const prefix = {events: 'event', labels: 'label', checklist: 'checklist'}[route];
  const start = source.indexOf(`const reportDialog = document.querySelector('#${prefix}-report-dialog');`, source.indexOf('async function loadModule('));
  const match = source.slice(start).match(/reloadOpenReportForScope = \(\) => \{[\s\S]*?\n\s*};/);
  assert.ok(match, `Callback real para ${route}`);
  return match[0];
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
function signedIn(overrides = {}) {
  return {status: 'signed-in', user: {uid: 'fictional-user'}, offline: false,
    profile: {active: true, access: true, role: 'anestesiologista', sigla: 'FX', displayName: 'Nome TESTE',
      permissions: {eventsRead: true, labelsRead: true, checklistRead: true}, ...overrides}};
}
function response(route, marker) {
  const records = route === 'checklist' ? [] : [{id: `${route}-${marker}`, date: '2026-09-30',
    patientName: `PACIENTE TESTE ${marker}`, memberStatus: `MEMBRO TESTE ${marker}`,
    encounterCode: 'TESTE', eventType: 'Férias', type: 'Consulta Pré-anestésica', creditor: 'Caixa',
    createdByName: 'Nome TESTE', createdByUid: 'fictional-user', amountToPay: 0, staffSiglas: []}];
  return {records, priorRecords: [], nextCursor: null, stale: false};
}
function fixture(route, initial = signedIn()) {
  const first = deferred();
  const started = deferred();
  const restarted = deferred();
  const reads = [];
  const target = {isConnected: true, innerHTML: '', querySelector: () => null, querySelectorAll: () => [],
    insertAdjacentHTML(position, html) { this.innerHTML += html; }};
  const reportDialog = {open: true, isConnected: true};
  const draft = {value: 'rascunho TESTE', photo: 'foto-local-TESTE', focused: true};
  const sync = {innerHTML: '', classList: {toggle() {}}};
  const prefix = {events: 'event', labels: 'label', checklist: 'checklist'}[route];
  const nodes = new Map([[`#${prefix}-report-results`, target], [`#${prefix}-report-dialog`, reportDialog],
    [`#${prefix}-report-day`, {value: '2026-09-30'}], [`#${prefix}-report-month`, {value: '2026-09'}],
    ['#module-content', target], ['#label-report-sync', sync], ['#export-labels', {disabled: true}],
    ['#share-labels-pdf', {disabled: true}], ['#share-events-pdf', {disabled: true}]]);
  let cacheClears = 0;
  let cacheAvailable = false;
  let replacements = 0;
  let latestLoad;
  const reader = options => {
    reads.push(options);
    if (reads.length === 1) { started.resolve(); return first.promise; }
    assert.equal(reads.length, 2);
    restarted.resolve();
    return Promise.resolve(response(route, 'NOVO ESCOPO'));
  };
  const context = vm.createContext({
    session: initial, appFeatures: {...DEFAULT_APP_FEATURES}, appFeaturesUid: 'fictional-user', appFeaturesLoadSequence: 0,
    DEFAULT_APP_FEATURES, featureEnabledForRoute, captureReportReadScope,
    sessionChangeRevokesAccess, sessionChangeRequiresRender, sessionChangeGrantsAccess,
    startupBannerActive: false, notice: '', labelManualConfirmation: {uid: '', status: ''}, selectedManagementAreaId: '',
    startupReports: {take: () => cacheAvailable ? Promise.resolve(response(route, 'CACHE ANTIGO')) : null,
      clear() { cacheClears++; cacheAvailable = false; }}, startupReportKey: (...args) => JSON.stringify(args),
    currentRoute: () => route, scheduleOutboxRetry() {}, refreshAppFeatures() {}, updateIdentityProfile() {},
    render() { replacements++; reportDialog.isConnected = false; target.isConnected = false; },
    app: {set innerHTML(value) { replacements++; reportDialog.isConnected = false; target.isConnected = false; }},
    eventReportOpen: true, eventReportLoad: 0, eventReportMode: 'daily', eventReportCursor: null,
    eventReportLoadingMore: false, loadedEventReportRecords: [], eventReportSourceRecords: [], eventReportStale: false,
    labelReportOpen: true, labelReportState: 'idle', labelReportLoad: 0, labelReportMode: 'daily', labelReportCursor: null,
    labelReportLoadingMore: false, loadedLabelRecords: [],
    checklistReportOpen: true, checklistReportMode: 'monthly', checklistReportGate: createChecklistReportGate(),
    reloadOpenReportForScope: null, reportDialog, items: [],
    document: {querySelector: selector => nodes.get(selector) || null}, navigator: {onLine: true},
    fixtureImport: async () => ({listEventRecords: reader, listLabelRecords: reader,
      listMonthlyChecklistRecords: (month, uid, options) => reader({month, uid, ...options})}),
    labelReportPresentation, withLabelReportDeadline, summarizeChecklistMonth, reportTimestamp: () => 0,
    escapeHtml: value => String(value ?? ''), formatRecordDate: String, interactionDateTime: () => '',
    todayInputValue: () => '2026-09-30', CSS: {escape: String}, setTimeout, clearTimeout
  });
  vm.runInContext(commonSource + loaders[route], context);
  const loaderName = {events: 'loadEventReport', labels: 'loadLabelReport', checklist: 'loadMonthlyChecklist'}[route];
  const original = context[loaderName];
  context[loaderName] = (...args) => { latestLoad = original(...args); return latestLoad; };
  vm.runInContext(callbackSource(route), context);
  return {context, target, reportDialog, draft, reads, started: started.promise, restarted: restarted.promise,
    first, latest: () => latestLoad, load: () => context[loaderName](route === 'checklist' ? [] : undefined),
    replacements: () => replacements, cacheClears: () => cacheClears, seedOldCache: () => { cacheAvailable = true; }};
}

for (const route of ['events', 'labels', 'checklist']) {
  test(`${route}: concessão durante leitura reinicia só relatório, descarta cache e ignora resposta antiga`, {timeout: 2000}, async () => {
    const value = fixture(route);
    const loading = value.load();
    await value.started;
    value.seedOldCache();
    const next = signedIn({permissions: {...value.context.session.profile.permissions,
      [route === 'events' ? 'admin' : route === 'labels' ? 'labelsManage' : 'checklistSign']: true}});
    value.context.sessionChanged(next);
    await value.restarted;
    await value.latest();
    const freshHtml = value.target.innerHTML;
    assert.equal(value.cacheClears(), 1);
    assert.equal(value.replacements(), 0);
    assert.deepEqual(value.draft, {value: 'rascunho TESTE', photo: 'foto-local-TESTE', focused: true});
    value.first.resolve(response(route, 'RESPOSTA ANTIGA'));
    await loading;
    assert.equal(value.target.innerHTML, freshHtml);
    assert.doesNotMatch(freshHtml, /CACHE ANTIGO|RESPOSTA ANTIGA|Carregando/);
    if (route !== 'checklist') assert.match(freshHtml, /NOVO ESCOPO/);
    assert.equal(value.reads.length, 2);
    if (route === 'events') assert.equal(value.reads[1].isAdmin, true);
    if (route === 'labels') assert.equal(value.reads[1].canManage, true);
  });

  test(`${route}: nome, offline e grant de outro módulo preservam consulta em andamento`, {timeout: 2000}, async () => {
    const value = fixture(route);
    const loading = value.load();
    await value.started;
    value.context.sessionChanged({...signedIn({displayName: 'Nome TESTE atualizado',
      permissions: {...value.context.session.profile.permissions, trainingsManage: true}}), offline: true});
    assert.equal(value.reads.length, 1);
    assert.equal(value.cacheClears(), 0);
    assert.equal(value.replacements(), 0);
    value.first.resolve(response(route, 'MESMO ESCOPO'));
    await loading;
    assert.doesNotMatch(value.target.innerHTML, /Carregando/);
  });

  test(`${route}: concessão com relatório fechado não inicia consulta`, {timeout: 2000}, async () => {
    const value = fixture(route);
    value.reportDialog.open = false;
    value.context.sessionChanged(signedIn({permissions: {...value.context.session.profile.permissions,
      [route === 'events' ? 'admin' : route === 'labels' ? 'labelsManage' : 'checklistSign']: true}}));
    assert.equal(value.reads.length, 0);
    assert.equal(value.cacheClears(), 1);
    assert.equal(value.replacements(), 0);
  });

  test(`${route}: revogação limpa imediatamente e não reinicia leitura`, {timeout: 2000}, async () => {
    const value = fixture(route);
    const loading = value.load();
    await value.started;
    value.context.sessionChanged(signedIn({access: false}));
    assert.equal(value.replacements(), 2);
    assert.equal(value.reads.length, 1);
    const closedHtml = value.target.innerHTML;
    value.first.resolve(response(route, 'RESPOSTA REVOGADA'));
    await loading;
    assert.equal(value.target.innerHTML, closedHtml);
  });

  test(`${route}: mudança de papel com mesmo acesso efetivo recarrega sem remover formulário`, {timeout: 2000}, async () => {
    const permissions = {admin: true};
    const value = fixture(route, signedIn({role: 'administrador_app', permissions}));
    const loading = value.load();
    await value.started;
    value.context.sessionChanged(signedIn({role: 'anestesiologista', permissions}));
    await value.restarted;
    await value.latest();
    assert.equal(value.reads.length, 2);
    assert.equal(value.replacements(), 0);
    assert.equal(value.cacheClears(), 1);
    value.first.resolve(response(route, 'PAPEL ANTIGO'));
    await loading;
    assert.doesNotMatch(value.target.innerHTML, /PAPEL ANTIGO|Carregando/);
  });
}
