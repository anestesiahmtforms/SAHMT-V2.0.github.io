const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
const stateSource = readFileSync(join(__dirname, '../src/label-report-state.js'), 'utf8').replaceAll('export ', '');
function deferred() {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};}
function setup(read, {online = true, timeout = 50} = {}) {
  const retry = {addEventListener(type, callback) {this.callback = callback;}, remove() {}};
  const target = {isConnected: true, innerHTML: '', querySelectorAll: () => [], querySelector: selector => selector === '#label-report-retry' ? retry : null, insertAdjacentHTML(position, html) {this.innerHTML += html;}};
  const sync = {innerHTML: '', classList: {toggle(name, value) {sync.confirmed = value;}}};
  const day = {value: '2026-09-30'};
  const ctx = vm.createContext({
    setTimeout, clearTimeout, Promise, Error, navigator: {onLine: online},
    labelReportState: 'idle', labelReportLoad: 0, labelReportMode: 'daily', labelReportCursor: null,
    labelReportLoadingMore: false, loadedLabelRecords: [], session: {user: {uid: 'user-1'}, profile: {}},
    document: {querySelector: selector => selector === '#label-report-results' ? target : selector === '#label-report-sync' ? sync : selector === '#label-report-day' ? day : null},
    escapeHtml: String, formatRecordDate: String, todayInputValue: () => '2026-09-30', can: () => true,
    mockReader: {listLabelRecords: read}, reportTimestamp: () => 0
  });
  vm.runInContext(stateSource, ctx);
  const deadline = vm.runInContext('withLabelReportDeadline', ctx);
  ctx.withLabelReportDeadline = operation => deadline(operation, timeout);
  const helper = main.slice(main.indexOf('function updateLabelReportSync()'), main.indexOf('async function loadLabelReport'));
  const loader = main.slice(main.indexOf('async function loadLabelReport'), main.indexOf('function beginLabelEdit'))
    .replaceAll("await import('./label-report-reader.js')", 'mockReader');
  vm.runInContext(helper + loader, ctx);
  return {ctx, target, sync, retry, day, load: () => vm.runInContext('loadLabelReport()', ctx)};
}
test('verde só após a resposta do servidor, inclusive relatório vazio', async () => {
  const pending = deferred(); const {ctx, sync, target, load} = setup(() => pending.promise);
  const loading = load(); await Promise.resolve();
  assert.equal(ctx.labelReportState, 'loading'); assert.equal(sync.confirmed, false);
  pending.resolve({records: [], nextCursor: null}); assert.equal(await loading, true);
  assert.equal(sync.confirmed, true); assert.match(target.innerHTML, /Nenhuma etiqueta/);
});
test('erro encerra o carregamento, não marca sincronizado e oferece nova tentativa', async () => {
  let attempts = 0;
  const {sync, target, retry, load} = setup(async () => {attempts++; if (attempts === 1) throw new Error('Falha de rede'); return {records: [], nextCursor: null};});
  assert.equal(await load(), false); assert.equal(sync.confirmed, false);
  assert.match(target.innerHTML, /Tentar novamente/); retry.callback();
  await new Promise(r => setTimeout(r, 1)); assert.equal(sync.confirmed, true);
});
test('tempo limite encerra a espera e ignora resposta tardia', async () => {
  const pending = deferred(); const {ctx, sync, target, load} = setup(() => pending.promise, {timeout: 5});
  assert.equal(await load(), false); assert.equal(ctx.labelReportState, 'error');
  assert.equal(sync.confirmed, false); assert.match(target.innerHTML, /12 segundos/);
  pending.resolve({records: [{id: 'late-record'}], nextCursor: null});
  await Promise.resolve(); assert.equal(ctx.loadedLabelRecords.length, 0);
});
test('offline falha imediatamente sem fazer consulta nem usar cache de pacientes', async () => {
  let queried = false; const {sync, target, load} = setup(() => {queried = true;}, {online: false});
  assert.equal(await load(), false); assert.equal(queried, false); assert.equal(sync.confirmed, false);
  assert.match(target.innerHTML, /internet/);
});
test('resposta de consulta anterior não sobrescreve a data mais recente', async () => {
  const first = deferred(); let calls = 0;
  const {ctx, day, load} = setup(() => ++calls === 1 ? first.promise : Promise.resolve({records: [], nextCursor: null}));
  const old = load(); await Promise.resolve(); day.value = '2026-09-29';
  assert.equal(await load(), true); first.resolve({records: [{id: 'old'}], nextCursor: null});
  assert.equal(await old, false); assert.equal(ctx.loadedLabelRecords.length, 0);
});
test('sincronização geral não força o V do relatório e PDF não é pré-carregado na abertura', () => {
  const outbox = main.slice(main.indexOf('async function updateOutboxStatus()'), main.indexOf('function scheduleOutboxRetry'));
  assert.doesNotMatch(outbox, /reportSync\.innerHTML/); assert.match(outbox, /updateLabelReportSync\(\)/);
  const entry = main.slice(main.indexOf("if (route === 'labels') {", main.indexOf('async function loadModule')), main.indexOf("if (route === 'admin')", main.indexOf('async function loadModule')));
  assert.doesNotMatch(entry, /loadReportPdfModule/);
});
test('leitor leve preserva filtros, deduplicação e paginação, sem persistência', async () => {
  const source = readFileSync(join(__dirname, '../src/label-report-reader.js'), 'utf8');
  const captured = []; let count = 0;
  const item = {id: 'label-1', data: () => ({date: '2026-09-30'})};
  const ctx = vm.createContext({
    db: {}, collection: () => 'labels', where: (...args) => ({where: args}), orderBy: (...args) => ({order: args}),
    startAfter: doc => ({cursor: doc}), limit: n => ({limit: n}), query: (...args) => args,
    getDocs: async q => {captured.push(q); count++; return {docs: [item]};}
  });
  vm.runInContext(source.split('\n').filter(line => !line.startsWith('import ')).join('\n').replaceAll('export ', ''), ctx);
  const result = await vm.runInContext("listLabelRecords({from:'2026-09-30',to:'2026-09-30',uid:'user-1',sigla:'FA'})", ctx);
  assert.equal(count, 2); assert.equal(result.records.length, 1);
  assert.ok(captured[0].some(x => x.where?.[0] === 'createdByUid'));
  assert.ok(captured[1].some(x => x.where?.[0] === 'staffSiglas'));
  assert.ok(captured.every(q => q.some(x => x.where?.[0] === 'date' && x.where[1] === '==')));
  assert.doesNotMatch(source, /writeSafeCache|localStorage|indexedDB|firebase\/firestore';/);
  const paged = await vm.runInContext("listLabelRecords({from:'2026-09-01',to:'2026-09-30',uid:'user-1',canManage:true,pageSize:1})", ctx);
  assert.equal(paged.nextCursor.mode, 'admin');
});
