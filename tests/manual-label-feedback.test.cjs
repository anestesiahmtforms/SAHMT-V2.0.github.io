const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const source = readFileSync(require('node:path').join(__dirname, '../src/main.js'), 'utf8');
const helper = source.slice(source.indexOf('function renderLabelManualConfirmation()'), source.indexOf('function actionForm(route)'));
const listener = source.indexOf("document.querySelector('[data-module-form]')?.addEventListener('submit'");
const start = source.indexOf('async (event) => {', listener);
const end = source.indexOf("\n  });\n  if (route === 'events')", start);
const callback = source.slice(start, end).replaceAll("await import('./data.js')", 'mockData') + '\n}';
function setup({pending = false, fail = false, origin = 'manual', editing = false} = {}) {
  const status = {textContent: ''};
  const button = {querySelector: () => null, classList: {toggle() {}}, insertAdjacentHTML() {}};
  const form = {dataset: {labelEntrySource: editing ? 'edit' : origin}, elements: {staffSiglas: {value: ''}, creditor: {value: 'Caixa'}}, querySelector: () => ({disabled: false})};
  const values = {date: '2026-09-30', type: 'Consulta Pré-anestésica', patientName: 'Paciente teste', encounterCode: '123', creditor: 'Caixa', insurance: '', editLabelId: editing ? 'label-1' : '', editLabelVersion: editing ? '1' : ''};
  const context = vm.createContext({
    session: {user: {uid: 'user-1', displayName: 'Teste'}, profile: {displayName: 'Teste'}},
    labelManualConfirmation: {uid: '', status: ''}, notice: '', route: 'labels',
    loadedLabelStaffSiglas: [], loadedLabelRecords: [],
    document: {querySelector: (selector) => selector === '#label-form-status' ? status : selector === '#label-manual-open' ? button : null},
    FormData: class {entries() {return Object.entries(values);}},
    mockData: {updateLabelRecord: async () => {if (fail) throw new Error('Edição não confirmada');}, createOperationalRecord: async () => {if (fail) throw new Error('Não confirmado'); return {id: 'record-1', pendingFirestore: pending};}},
    render: async () => {}, Intl, Date, Set, Object, Number, String, JSON, Error
  });
  vm.runInContext(helper, context);
  const submit = vm.runInContext('(' + callback + ')', context);
  return {context, status, submit: () => submit({preventDefault() {}, currentTarget: form})};
}
test('registro manual confirmado: V verde e sem aviso principal', async () => {
  const {context, submit} = setup(); await submit();
  assert.equal(context.labelManualConfirmation.status, 'confirmed');
  assert.equal(context.notice, '');
  const html = vm.runInContext('renderLabelManualConfirmation()', context);
  assert.match(html, /✓/); assert.match(html, /Confirmado/); assert.doesNotMatch(html, /--pending/);
});
test('registro não confirmado: X e Pendente, nunca Confirmado', async () => {
  const {context, submit} = setup({pending: true}); await submit();
  const html = vm.runInContext('renderLabelManualConfirmation()', context);
  assert.match(html, /✕/); assert.match(html, /Pendente/); assert.match(html, /--pending/); assert.doesNotMatch(html, />Confirmado</);
  assert.equal(context.notice, '');
});
test('falha: permanece Pendente e mostra erro somente no formulário', async () => {
  const {context, status, submit} = setup({fail: true}); await submit();
  assert.equal(context.labelManualConfirmation.status, 'pending');
  assert.equal(context.notice, ''); assert.match(status.textContent, /Não confirmado/);
});
test('leitura pela câmera não confirma o botão de registro manual', async () => {
  const {context, submit} = setup({origin: 'camera'}); await submit();
  assert.equal(context.labelManualConfirmation.status, '');
});
test('confirmação não aparece para outra conta', async () => {
  const {context, submit} = setup(); await submit(); context.session.user.uid = 'user-2';
  assert.equal(vm.runInContext('renderLabelManualConfirmation()', context), '');
});

test('campos do registro usam fonte de 16px, sem bloquear zoom manual', () => {
  const css = readFileSync(require('node:path').join(__dirname, '../src/styles.css'), 'utf8');
  assert.match(css, /\.label-entry-dialog \.form-grid select\{font-size:16px!important\}/);
  assert.match(css, /\.admin-user-actions button\{transform:none!important/);
  assert.match(css, /\.label-manual-confirmation>small\{[^}]*white-space:nowrap;overflow-wrap:normal;word-break:normal/);
  assert.doesNotMatch(source, /user-scalable=no/);
});
test('antes de salvar desfoca o campo; após confirmação devolve foco sem rolagem', () => {
  assert.ok(source.indexOf('focusedControl.blur()', listener) < source.indexOf('submit.disabled = true;', listener));
  assert.match(source, /if \(entryDialog\?\.open\) entryDialog.close\(\);/);
  assert.match(source, /#label-manual-open'\)\?\.focus\?\.\(\{preventScroll: true\}\)/);
});

test('edição confirmada: indicador no botão e nenhum aviso na página', async () => {
  const {context, submit} = setup({editing: true}); await submit();
  assert.equal(context.labelManualConfirmation.status, 'confirmed');
  assert.equal(context.notice, '');
  assert.match(vm.runInContext('renderLabelManualConfirmation()', context), /✓/);
  assert.doesNotMatch(source, /Etiqueta atualizada no Firestore/);
});
test('edição recusada: X Pendente e erro somente no modal', async () => {
  const {context, status, submit} = setup({editing: true, fail: true}); await submit();
  assert.equal(context.labelManualConfirmation.status, 'pending');
  assert.equal(context.notice, '');
  assert.match(status.textContent, /Edição não confirmada/);
  assert.match(vm.runInContext('renderLabelManualConfirmation()', context), /✕/);
});
