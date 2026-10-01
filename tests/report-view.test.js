import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {captureReportReadScope} from '../src/report-read-scope.js';
import {DEFAULT_APP_FEATURES, featureEnabledForRoute} from '../src/feature-flags.js';
import {labelReportPresentation, withLabelReportDeadline} from '../src/label-report-state.js';

// Use the actual loaders and renderers. Only asynchronous reader imports and
// Firestore responses are substituted; the scope guard remains the real helper.
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Trecho real encontrado: ${startMarker}`);
  return source.slice(start, end).replaceAll("await import('./data.js')", 'await fixtureImport()')
    .replaceAll("await import('./label-report-reader.js')", 'await fixtureImport()');
}
const canSource = extract('function can(permission)', 'function captureWriteSession(');
const reportScopeSource = extract('function captureReportScope(', 'function preloadStartupReports(');
const eventSource = extract('async function loadEventReport(', 'function beginEventEdit(');
const labelSource = extract('function updateLabelReportSync()', 'function beginLabelEdit(');

function reportTest(name, run) {
  test(name, {timeout: 2000}, run);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}
function signedIn() {
  return {
    status: 'signed-in',
    user: {uid: 'fictional-user', email: 'teste@nome.invalid'},
    profile: {active: true, access: true, role: 'anestesiologista', sigla: 'FX', displayName: 'Nome TESTE',
      permissions: {eventsRead: true, labelsRead: true}}
  };
}
function response(route, suffix, date = '2026-09-30') {
  const common = {id: `${route}-${suffix}`, date, createdByUid: 'fictional-user', createdByName: 'Nome TESTE'};
  const record = route === 'events'
    ? {...common, memberStatus: 'Membro TESTE', eventType: 'Férias', description: `EVENTO TESTE ${suffix}`, amountToPay: 0}
    : {...common, patientName: `PACIENTE TESTE ${suffix}`, encounterCode: 'TESTE', type: 'Consulta Pré-anestésica', creditor: 'Caixa', staffSiglas: []};
  return {records: [record], nextCursor: null, stale: false};
}
function makeTarget() {
  return {
    isConnected: true, hidden: false, innerHTML: '',
    querySelector: () => null, querySelectorAll: () => [],
    insertAdjacentHTML(position, html) { this.innerHTML += html; }
  };
}
function fixture(route, {responses, mode = 'daily'} = {}) {
  const imported = deferred();
  const importStarted = deferred();
  const readStarted = deferred();
  const secondReadStarted = deferred();
  const reads = [];
  const target = makeTarget();
  const dialog = {open: true, isConnected: true};
  target.closest = () => dialog;
  const day = {value: '2026-09-30'};
  const month = {value: '2026-09'};
  const pdf = {disabled: true};
  const exported = {disabled: true};
  const sync = {innerHTML: '', confirmed: false, classList: {toggle(name, value) { sync.confirmed = value; }}};
  const prefix = route === 'events' ? 'event' : 'label';
  const nodes = new Map([
    [`#${prefix}-report-results`, target], [`#${prefix}-report-dialog`, dialog],
    [`#${prefix}-report-day`, day], [`#${prefix}-report-month`, month],
    [`#share-${route}-pdf`, pdf], ['#export-labels', exported], ['#label-report-sync', sync]
  ]);
  const serverResponses = [...(responses || [Promise.resolve(response(route, 'CONFIRMADO'))])];
  const reader = (options) => {
    reads.push({...options});
    readStarted.resolve();
    if (reads.length === 2) secondReadStarted.resolve();
    assert.ok(serverResponses.length, 'A consulta real deve ter uma resposta fictícia definida');
    return serverResponses.shift();
  };
  const readers = {listEventRecords: reader, listLabelRecords: reader};
  const context = vm.createContext({
    session: signedIn(), appFeatures: {...DEFAULT_APP_FEATURES}, selectedManagementAreaId: '', route,
    currentRoute: () => context.route, featureEnabledForRoute, captureReportReadScope,
    eventReportOpen: true, eventReportLoad: 0, eventReportMode: mode, eventReportCursor: null,
    eventReportLoadingMore: false, loadedEventReportRecords: [], eventReportSourceRecords: [], eventReportStale: false,
    labelReportOpen: true, labelReportState: 'idle', labelReportLoad: 0, labelReportMode: mode, labelReportCursor: null,
    labelReportLoadingMore: false, loadedLabelRecords: [],
    document: {querySelector: selector => nodes.get(selector) || null}, navigator: {onLine: true},
    startupReports: {take: () => null}, startupReportKey: (...args) => JSON.stringify(args),
    fixtureImport: () => { importStarted.resolve(); return imported.promise; },
    labelReportPresentation, withLabelReportDeadline, reportTimestamp: () => 0,
    escapeHtml: value => String(value ?? ''), formatRecordDate: String, interactionDateTime: () => '',
    todayInputValue: () => '2026-09-30', CSS: {escape: String}, setTimeout, clearTimeout
  });
  vm.runInContext(canSource + reportScopeSource + (route === 'events' ? eventSource : labelSource), context);
  return {
    context, target, dialog, day, month, pdf, exported, sync, nodes, reads,
    importStarted: importStarted.promise, readStarted: readStarted.promise, secondReadStarted: secondReadStarted.promise,
    releaseImport: () => imported.resolve(readers),
    load: () => vm.runInContext(route === 'events' ? 'loadEventReport()' : 'loadLabelReport()', context),
    records: () => Array.from(route === 'events' ? context.eventReportSourceRecords : context.loadedLabelRecords, record => record.id),
    view: () => ({html: target.innerHTML, pdfDisabled: pdf.disabled, exportDisabled: exported.disabled,
      syncHtml: sync.innerHTML, syncConfirmed: sync.confirmed})
  };
}

const sessionChanges = [
  ['troca de UID', value => { value.context.session.user.uid = 'another-fictional-user'; }],
  ['sigla alterada no perfil', value => { value.context.session.profile.sigla = 'FY'; }],
  ['papel alterado no perfil', value => { value.context.session.profile.role = 'administrador_app'; }],
  ['permissão de leitura revogada', (value, route) => { value.context.session.profile.permissions[`${route}Read`] = false; }],
  ['permissão de consulta ampliada', (value, route) => { value.context.session.profile.permissions[route === 'events' ? 'admin' : 'labelsManage'] = true; }],
  ['acesso revogado', value => { value.context.session.profile.access = false; }],
  ['perfil inativo', value => { value.context.session.profile.active = false; }],
  ['logout', value => { value.context.session = {status: 'signed-out', user: null, profile: null}; }]
];

for (const route of ['events', 'labels']) {
  for (const [name, change] of sessionChanges) {
    reportTest(`${route}: ${name} durante importação impede consultar com o novo perfil`, async () => {
      const value = fixture(route);
      const loading = value.load();
      await value.importStarted;
      const view = value.view();
      change(value, route);
      value.releaseImport();
      assert.equal(await loading, false);
      assert.deepEqual(value.reads, []);
      assert.deepEqual(value.records(), []);
      assert.deepEqual(value.view(), view, 'Não deve publicar sucesso ou erro no contexto antigo');
    });
  }

  const viewChanges = [
    ...sessionChanges,
    ['diálogo fechado', value => { value.dialog.open = false; }],
    ['estado do relatório fechado', value => { value.context[route === 'events' ? 'eventReportOpen' : 'labelReportOpen'] = false; }],
    ['target removido', value => { value.target.isConnected = false; value.nodes.delete(`#${route === 'events' ? 'event' : 'label'}-report-results`); }],
    ['target substituído', value => { value.nodes.set(`#${route === 'events' ? 'event' : 'label'}-report-results`, makeTarget()); }],
    ['rota alterada', value => { value.context.route = 'home'; }],
    ['dia selecionado alterado sem outra consulta', value => { value.day.value = '2026-09-29'; }],
    ['modo alterado', value => { value.context[route === 'events' ? 'eventReportMode' : 'labelReportMode'] = 'monthly'; }]
  ];
  for (const [name, change] of viewChanges) {
    reportTest(`${route}: resposta tardia após ${name} não altera dados, conteúdo ou exportação`, async () => {
      const server = deferred();
      const value = fixture(route, {responses: [server.promise]});
      const loading = value.load();
      await value.importStarted;
      value.releaseImport();
      await value.readStarted;
      assert.equal(value.reads[0].uid, 'fictional-user');
      assert.equal(value.reads[0].sigla, 'FX');
      assert.equal(value.reads[0][route === 'events' ? 'isAdmin' : 'canManage'], false);
      const view = value.view();
      change(value, route);
      server.resolve(response(route, 'RESPOSTA ANTIGA'));
      assert.equal(await loading, false);
      assert.deepEqual(value.records(), []);
      assert.deepEqual(value.view(), view);
    });
  }

  reportTest(`${route}: erro tardio após perda de permissão não escreve no relatório anterior`, async () => {
    const server = deferred();
    const value = fixture(route, {responses: [server.promise]});
    const loading = value.load();
    await value.importStarted;
    value.releaseImport();
    await value.readStarted;
    const view = value.view();
    value.context.session.profile.permissions[`${route}Read`] = false;
    server.reject(new Error('Falha fictícia de rede'));
    assert.equal(await loading, false);
    assert.deepEqual(value.view(), view);
  });

  reportTest(`${route}: mês alterado invalida uma resposta mensal sem outra consulta`, async () => {
    const server = deferred();
    const value = fixture(route, {responses: [server.promise], mode: 'monthly'});
    const loading = value.load();
    await value.importStarted;
    value.releaseImport();
    await value.readStarted;
    const view = value.view();
    value.month.value = '2026-08';
    server.resolve(response(route, 'MÊS ANTIGO'));
    assert.equal(await loading, false);
    assert.deepEqual(value.records(), []);
    assert.deepEqual(value.view(), view);
  });

  reportTest(`${route}: perfil repetido ou nome atualizado preservam a resposta da mesma consulta`, async () => {
    for (const displayName of ['Nome TESTE', 'Nome TESTE atualizado']) {
      const server = deferred();
      const value = fixture(route, {responses: [server.promise]});
      const loading = value.load();
      await value.importStarted;
      value.context.session = {...value.context.session, profile: {...value.context.session.profile,
        displayName, permissions: {...value.context.session.profile.permissions}}};
      value.releaseImport();
      await value.readStarted;
      value.context.session.profile.displayName = `${displayName} sem mudança de acesso`;
      server.resolve(response(route, 'CONFIRMADO'));
      assert.equal(await loading, true);
      assert.equal(value.reads.length, 1);
      assert.equal(value.reads[0].uid, 'fictional-user');
      assert.equal(value.reads[0].sigla, 'FX');
      assert.deepEqual(value.records(), [`${route}-CONFIRMADO`]);
      assert.match(value.target.innerHTML, /TESTE/);
      assert.equal(value.pdf.disabled, false);
      if (route === 'labels') assert.equal(value.sync.confirmed, true);
    }
  });

  reportTest(`${route}: consulta diária A não substitui B quando A termina por último`, async () => {
    const first = deferred();
    const second = deferred();
    const value = fixture(route, {responses: [first.promise, second.promise]});
    const loadA = value.load();
    await value.importStarted;
    value.releaseImport();
    await value.readStarted;
    value.day.value = '2026-09-29';
    const loadB = value.load();
    await value.secondReadStarted;
    second.resolve(response(route, 'B', '2026-09-29'));
    assert.equal(await loadB, true);
    const viewB = value.view();
    first.resolve(response(route, 'A'));
    assert.equal(await loadA, false);
    assert.deepEqual(value.records(), [`${route}-B`]);
    assert.deepEqual(value.view(), viewB);
    assert.equal(value.reads[0].from, '2026-09-30');
    assert.equal(value.reads[1].from, '2026-09-29');
  });
}
