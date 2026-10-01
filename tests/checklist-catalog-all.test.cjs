const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const data = readFileSync(join(__dirname, '../src/data.js'), 'utf8');
test('Checklist consulta os 28 arsenais ativos e inativos e usa cache próprio', async () => {
  let constraints, cacheKey;
  const stations = Array.from({length: 28}, (_, i) => ({id: String(i), active: i < 23}));
  const ctx = vm.createContext({
    moduleCollections: {checklist: {name: 'checklistStations', order: 'order', direction: 'asc'}, events: {name: 'events', order: 'date', direction: 'desc'}},
    MAX_PAGE_SIZE: 50, SAFE_CACHE_MODULES: new Set(['checklist']), db: {},
    where: (...args) => ({where: args}), orderBy: (...args) => ({order: args}), limit: value => ({limit: value}),
    collection: () => ({}), query: (_collection, ...args) => {constraints = args; return {};},
    getDocsFromServer: async () => ({docs: stations.map(item => ({id: item.id, data: () => item}))}),
    writeSafeCache: async (_uid, _name, key) => {cacheKey = key;}, mayUseOfflineCache: () => false
  });
  vm.runInContext(data.slice(data.indexOf('export async function listModuleRecords('), data.indexOf('export async function getManagementArea(')).replace('export ', ''), ctx);
  const items = await ctx.listModuleRecords('checklist', 'user', {pageSize: 200});
  assert.equal(items.length, 28);
  assert.equal(items.filter(item => !item.active).length, 5);
  assert.ok(!constraints.some(item => item.where));
  assert.equal(cacheKey, 'all');
  await ctx.listModuleRecords('events', 'user');
  assert.ok(constraints.some(item => item.where?.[0] === 'active'));
  const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
  assert.ok(main.includes('sortChecklistStationsForDisplay(stations, resolvedRecordFor)'));
  assert.ok(main.includes('const writableStations = applicableStations.filter((station) => stationIsValidOn(station, day));'));
});

test('botões sem Arsenal mantêm os nomes específicos e inativos ficam ao final', () => {
  const source = readFileSync(join(__dirname, '../src/checklist-display.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(source.replaceAll('export ', ''), ctx);
  assert.equal(ctx.checklistArsenalButtonLabel({id: '100170010', name: 'Arsenal 100170010'}), '100170010');
  assert.equal(ctx.checklistArsenalFunction({id: '100170010'}), 'Endoscopia');
  assert.equal(ctx.checklistArsenalFunction({id: '100170030'}), 'Hemod sl.1');
  assert.equal(ctx.checklistArsenalFunction({id: '100170015'}), 'Ressonância');
  const stations = [{id: '100170004', active: false}, {id: '100170010', active: true}, {id: '100170001', active: true}];
  const sorted = ctx.sortChecklistStationsForDisplay(stations, () => null).sort((left, right) => Number(right.active === true) - Number(left.active === true));
  assert.equal(sorted[sorted.length - 1].id, '100170004');
  const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
  assert.ok(main.includes('Number(right.active === true) - Number(left.active === true)'));
  assert.ok(main.includes('checklistArsenalButtonLabel(station)'));
});

test('Voltar permanece no rodapé visível do banner de arsenal com conteúdo longo', () => {
  const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
  const css = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');
  const banner = main.match(/<dialog class="checklist-station-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.match(banner, /class="checklist-station-footer"[\s\S]*id="checklist-station-close"[\s\S]*Voltar<\/button><\/form><\/dialog>$/);
  const footer = [...css.matchAll(/#checklist-station-dialog \.checklist-station-footer\s*\{([^}]+)\}/g)].at(-1)[1];
  assert.match(footer, /position:\s*sticky/);
  assert.match(footer, /bottom:\s*0(?:;|$)/);
  assert.match(footer, /z-index:\s*2(?:;|$)/);
  assert.match(footer, /background:\s*linear-gradient/);
});

test('banner organiza situação, manutenção e administração em blocos com Voltar fora deles', () => {
  const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
  const css = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');
  const banner = main.match(/<dialog class="checklist-station-dialog"[\s\S]*?<\/dialog>/)[0];
  assert.ok(!banner.includes('ARSENAL ANESTÉSICO'));
  assert.match(banner, /checklist-station-block--status[\s\S]*id="checklist-station-title"[\s\S]*id="checklist-station-result"[\s\S]*id="checklist-station-responses"[\s\S]*id="checklist-station-checker"[\s\S]*id="checklist-station-controls"/);
  assert.match(banner, /id="checklist-station-controls"><\/div><\/div><p id="checklist-station-status"[\s\S]*class="checklist-station-footer"/);
  assert.match(css, /\.checklist-station-block--status>header\s*\{text-align:center\}/);
  assert.ok(main.includes("const canManage = can('admin') && can('checklistManage');"));
});

test('calendários mantêm ano legível, fonte de toque e item em frente em telas estreitas', () => {
  const css = readFileSync(join(__dirname, '../src/styles.css'), 'utf8');
  assert.match(css, /\.checklist-maintenance-date\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(155px,\.85fr\)/);
  assert.match(css, /\.checklist-maintenance-date>span\{overflow-wrap:anywhere\}/);
  assert.match(css, /\.checklist-maintenance-date input\{[^}]*font-size:16px/);
  assert.match(css, /@media\(max-width:380px\)\{#checklist-station-dialog\{padding:12px\}#checklist-station-dialog \.checklist-station-block\{padding:8px\}\}/);
});
