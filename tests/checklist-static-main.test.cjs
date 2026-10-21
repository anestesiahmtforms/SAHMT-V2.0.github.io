const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8');

test('pré-carregamento de login não inicia mais o relatório do Checklist', () => {
  const start = source.indexOf('function preloadStartupReports(');
  const end = source.indexOf('\nconst labelAiEnabled', start);
  assert.ok(start >= 0 && end > start);
  const preloaded = [];
  const context = vm.createContext({
    navigator: {onLine: true}, session: {offline: false, status: 'signed-in'},
    reportAllowed: () => true, makeReportScope: kind => ({key: kind}),
    startupReports: {holdLive: key => preloaded.push(key)},
    liveReports: {warm: kind => ({kind})}, window: {setTimeout() {}}
  });
  vm.runInContext(source.slice(start, end) + '\npreloadStartupReports({}, {explicit: true});', context);
  assert.deepEqual(preloaded, ['events', 'labels']);
});

test('após gravar um Checklist pelo QR não reabre automaticamente o relatório completo', () => {
  const start = source.indexOf('const saveAnswer = async (condition) =>');
  const end = source.indexOf("actions.querySelector('[data-checklist-banner-answer=\"SIM\"]')", start);
  assert.ok(start >= 0 && end > start);
  const saveFlow = source.slice(start, end);
  assert.match(saveFlow, /Checklist salvo/);
  assert.doesNotMatch(saveFlow, /loadDailyChecklist|loadChecklistView|ensureChecklistDailyReportOpen/);
});
