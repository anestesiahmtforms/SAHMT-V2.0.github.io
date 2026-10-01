const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8').replace(/\r\n/g, '\n');

test('a entrada em Gestão não abre uma área; o clique abre o modal antes de consultar', async () => {
  const start = source.indexOf("    if (route === 'management') {\n      if (!items.some");
  const end = source.indexOf("    } else {\n      const heading", start);
  const handlers = new Map();
  const calls = [];
  const button = {dataset: {managementArea: 'area-1'}, classList: {toggle() {}}, setAttribute() {}, addEventListener: (event, fn) => handlers.set('click', fn)};
  const dialog = {open: false, showModal() {this.open = true; calls.push('modal');}, addEventListener: (event, fn) => handlers.set(event, fn)};
  const content = {innerHTML: '', querySelector: selector => selector === '#management-area-dialog' ? dialog : null, querySelectorAll: () => [button]};
  const context = vm.createContext({route: 'management', items: [{id: 'area-1', name: 'Gestão clínica'}], selectedManagementAreaId: '', content, can: () => false, MANAGEMENT_AREA_SEED: [], escapeHtml: String, actionForm: () => '<form data-module-form="management"></form>', populateSelect: async () => {}, document: {querySelector: () => null}, managementActivityLoad: 0, loadManagementAreaActivities: async area => {calls.push(area.id);}});
  await vm.runInContext('(async () => {\n' + source.slice(start, end) + '\n}\n})()', context);
  assert.deepEqual(calls, []);
  assert.match(content.innerHTML, /<dialog class="management-area-dialog"/);
  assert.match(content.innerHTML, /<form data-module-form="management">/);
  await handlers.get('click')();
  assert.deepEqual(calls, ['modal', 'area-1']);
  handlers.get('close')();
  assert.equal(context.managementActivityLoad, 1);
});
