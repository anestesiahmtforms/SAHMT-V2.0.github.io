const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
function setup({mode = 'daily', pending = false, admin = true} = {}) {
  const panel = {hidden: true, isConnected: true, dataset: {}, innerHTML: ''};
  const button = {dataset: {eventHistory: 'event-1'}, setAttribute(name, value) {this[name] = value;}, addEventListener(event, callback) {this.click = callback;}};
  const target = {innerHTML: '', querySelector: selector => selector.startsWith('[data-event-history-panel=') ? panel : null, querySelectorAll: selector => selector === '[data-event-history]' && target.innerHTML.includes('data-event-history=') ? [button] : []};
  let reads = 0;
  const ctx = vm.createContext({
    eventReportMode: mode, eventReportSourceRecords: [{id: 'event-1', date: '2026-09-30', version: 2, memberStatus: 'Membro', eventType: 'Férias', createdByName: 'Autor', payer: 'Pagador', creditor: 'Credor', amountToPay: 0, pendingFirestore: pending}], loadedEventReportRecords: [], eventReportStale: false, eventReportCursor: null,
    document: {querySelector: selector => selector === '#event-report-results' ? target : selector.includes('report-month') ? {value: '2026-09'} : null},
    navigator: {onLine: true}, can: () => admin, escapeHtml: String, formatRecordDate: String, interactionDateTime: () => '30/09/2026 12:00', todayInputValue: () => '2026-09-30', CSS: {escape: String}, beginEventEdit() {}, loadEventReport() {},
    mockData: {listEventHistory: async () => {reads++; return [{version: 2, actorName: 'Editor', changedFields: ['eventType'], before: {eventType: 'Pessoal'}, after: {eventType: 'Férias'}}];}}
  });
  const helpers = source.slice(source.indexOf('function renderEventReportRecords('), source.indexOf('function beginEventEdit(')).replaceAll("await import('./data.js')", 'mockData');
  vm.runInContext(helpers, ctx);
  vm.runInContext('renderEventReportRecords()', ctx);
  return {target, panel, button, reads: () => reads};
}
test('diário exibe campos e responsável no mesmo cartão de Etiquetas; histórico só abre no clique', async () => {
  const {target, panel, button, reads} = setup();
  assert.match(target.innerHTML, /label-daily-record event-daily-record/);
  assert.match(target.innerHTML, /RESPONSÁVEL PELO REGISTRO/);
  assert.match(target.innerHTML, /EDITAR REGISTRO/);
  assert.match(target.innerHTML, /R\$ 0,00/);
  assert.equal(reads(), 0); assert.equal(panel.hidden, true);
  await button.click(); assert.equal(reads(), 1); assert.equal(panel.hidden, false);
  assert.doesNotMatch(panel.innerHTML, /Versão/); assert.match(panel.innerHTML, /Responsável: Editor/);
  assert.match(panel.innerHTML, /Antes: Pessoal/); assert.match(panel.innerHTML, /Depois: Férias/);
  await button.click(); assert.equal(panel.hidden, true);
  await button.click(); assert.equal(reads(), 1); assert.equal(panel.hidden, false);
});
test('pendente não oferece edição nem histórico confirmado; usuário comum não recebe Editar', () => {
  const pending = setup({pending: true}).target.innerHTML;
  assert.match(pending, /Aguardando confirmação/); assert.doesNotMatch(pending, /data-event-edit=|data-event-history=/);
  assert.doesNotMatch(setup({admin: false}).target.innerHTML, /data-event-edit=/);
});
test('mensal preserva a apresentação compacta e não busca histórico', () => {
  const {target, reads} = setup({mode: 'monthly'});
  assert.match(target.innerHTML, /event-record-banner/);
  assert.doesNotMatch(target.innerHTML, /label-daily-record|data-event-history=|data-event-edit=/);
  assert.equal(reads(), 0);
});

test('histórico compartilhado apresenta campos antes/depois sem número de versão', () => {
  const ctx = vm.createContext({escapeHtml: String, interactionDateTime: () => '30/09/2026 12:00'});
  vm.runInContext(source.slice(source.indexOf('function renderRecordEditHistory('), source.indexOf('async function loadDailyEventEditNotes(')), ctx);
  const html = ctx.renderRecordEditHistory([{version: 2, actorName: 'Editor', changedFields: ['patientName', 'staffSiglas'], before: {patientName: 'Antes', staffSiglas: ['AB']}, after: {patientName: 'Depois', staffSiglas: ['AB', 'CD']}}], {patientName: 'Nome do paciente', staffSiglas: 'Plantonistas'});
  assert.match(html, /Nome do paciente/);
  assert.match(html, /Antes: Antes/);
  assert.match(html, /Depois: Depois/);
  assert.match(html, /Depois: AB, CD/);
  assert.match(html, /Responsável: Editor/);
  assert.doesNotMatch(html, /Versão/);
  assert.match(source, /historyTarget.innerHTML = renderRecordEditHistory\(history, labels,/);
});
