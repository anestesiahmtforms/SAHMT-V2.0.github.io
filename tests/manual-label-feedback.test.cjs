const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const source = readFileSync(require('node:path').join(__dirname, '../src/main.js'), 'utf8');
test('contêiner principal de Eventos fixo e dimensionado à tela', () => {
  const css = readFileSync(require('node:path').join(__dirname, '../src/styles.css'), 'utf8');
  assert.match(css, /html:has\(\.app-shell--events\),body:has\(\.app-shell--events\)\{overflow:hidden;overscroll-behavior:none\}/);
  assert.match(css, /\.app-shell--events\{position:fixed;inset:0;width:100%;height:100dvh;[^}]*grid-template-rows:auto minmax\(0,1fr\) auto;overflow:hidden;overscroll-behavior:none/);
  assert.match(css, /\.app-shell--events \.main-content\{width:90%!important/);
});
test('contêiner principal de Etiquetas fixo sem bloquear a rolagem dos relatórios', () => {
  const css = readFileSync(require('node:path').join(__dirname, '../src/styles.css'), 'utf8');
  assert.match(css, /html:has\(\.app-shell--labels\),body:has\(\.app-shell--labels\)\{overflow:hidden;overscroll-behavior:none\}/);
  assert.match(css, /\.app-shell--labels\{position:fixed;inset:0;[^}]*width:100%;height:100dvh;[^}]*overflow:hidden;overscroll-behavior:none/);
  assert.match(css, /\.app-shell--labels #label-report-results\{[^}]*overflow:auto/);
});
test('botão principal de Etiquetas exibe HOME e mantém destino inicial', () => {
  assert.match(source, /data-route="home">\$\{route === 'events' \|\| route === 'checklist' \? 'HOME' : route === 'labels' \? 'HOME'/);
  assert.doesNotMatch(source, /route === 'labels' \? 'VOLTAR'/);
});
test('Gestão usa o mesmo cabeçalho responsivo de Etiquetas', () => {
  const css = readFileSync(require('node:path').join(__dirname, '../src/styles.css'), 'utf8');
  assert.ok(source.includes("route === 'management' ? ' app-shell--management'"));
  assert.ok(source.includes("route === 'management' ? '<h2 class=\"events-header-operational\">GESTÃO</h2>'"));
  assert.ok(css.includes(':is(.app-shell--labels,.app-shell--management) .identity-card{display:grid;'));
  assert.ok(css.includes(':is(.app-shell--labels,.app-shell--management) .identity-card{min-height:150px;'));
  assert.ok(css.includes(':is(.app-shell--labels,.app-shell--management) .identity-card{min-height:140px;'));
  assert.ok(css.includes(':is(.app-shell--labels,.app-shell--management) .identity-card{min-height:124px;'));
});
const helper = source.slice(source.indexOf('function renderLabelManualConfirmation()'), source.indexOf('function actionForm(route)'));
const listener = source.indexOf("document.querySelector('[data-module-form]')?.addEventListener('submit'");
const start = source.indexOf('async (event) => {', listener);
const end = source.indexOf("\n  });\n  if (route === 'events')", start);
const callback = source.slice(start, end).replaceAll("await import('./data.js')", 'mockData') + '\n}';
function setup({pending = false, fail = false, origin = 'manual', editing = false, commitGate = null} = {}) {
  const status = {textContent: ''};
  const button = {querySelector: () => null, classList: {toggle() {}}, insertAdjacentHTML() {}};
  const cameraButton = {focused: false, focus() {this.focused = true;}};
  const cameraResult = {innerHTML: ''};
  const dialog = {open: true, close() {this.open = false;}};
  const form = {isConnected: true, dataset: {labelEntrySource: editing ? 'edit' : origin}, elements: {staffSiglas: {value: ''}, creditor: {value: 'Caixa'}}, querySelector: () => ({disabled: false})};
  const values = {date: '2026-09-30', type: 'Consulta Pré-anestésica', patientName: 'Paciente teste', encounterCode: '123', creditor: 'Caixa', insurance: '', editLabelId: editing ? 'label-1' : '', editLabelVersion: editing ? '1' : ''};
  const context = vm.createContext({
    session: {user: {uid: 'user-1', displayName: 'Teste'}, profile: {displayName: 'Teste'}},
    labelManualConfirmation: {uid: '', status: ''}, labelCameraConfirmation: {uid: '', status: ''}, labelEntryGeneration: 0, notice: '', route: 'labels', renderCount: 0,
    loadedLabelStaffSiglas: [], loadedLabelRecords: [],
    document: {querySelector: (selector) => selector === '#label-form-status' ? status : selector === '#label-manual-open' ? button : selector === '#label-camera-open' ? cameraButton : selector === '#label-camera-result' ? cameraResult : selector === '#label-entry-dialog' ? dialog : null},
    FormData: class {entries() {return Object.entries(values);}},
    mockData: {updateLabelRecord: async () => {if (commitGate) await commitGate; if (fail) throw new Error('Edição não confirmada');}, createOperationalRecord: async () => {if (commitGate) await commitGate; if (fail) throw new Error('Não confirmado'); return {id: 'record-1', pendingFirestore: pending};}},
    render: async () => {context.renderCount++;}, Intl, Date, Set, Object, Number, String, JSON, Error
  });
  vm.runInContext(helper, context);
  const submit = vm.runInContext('(' + callback + ')', context);
  return {context, status, cameraButton, cameraResult, dialog, submit: () => submit({preventDefault() {}, currentTarget: form})};
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
test('registro pela câmera confirmado fecha o editor e sinaliza Feito na área liberada pela leitura', async () => {
  const {context, cameraButton, cameraResult, dialog, submit} = setup({origin: 'camera'});
  await submit();
  assert.equal(context.labelCameraConfirmation.status, 'confirmed');
  assert.equal(context.labelCameraConfirmation.uid, 'user-1');
  assert.equal(context.labelManualConfirmation.status, '');
  assert.equal(context.notice, '');
  assert.equal(dialog.open, false);
  assert.equal(cameraButton.focused, true);
  assert.match(cameraResult.innerHTML, /✓/);
  assert.match(cameraResult.innerHTML, /Feito!/);
});
test('registro pela câmera aguarda a confirmação do servidor antes de mostrar Feito', async () => {
  let confirm;
  const commitGate = new Promise(resolve => {confirm = resolve;});
  const {context, cameraResult, dialog, submit} = setup({origin: 'camera', commitGate});
  const saving = submit();
  assert.equal(context.labelCameraConfirmation.status, 'pending');
  assert.doesNotMatch(cameraResult.innerHTML, /Feito!/);
  assert.equal(dialog.open, true);
  confirm();
  await saving;
  assert.match(cameraResult.innerHTML, /Feito!/);
  assert.equal(dialog.open, false);
});
for (const options of [{origin: 'camera'}, {origin: 'manual'}, {editing: true}, {origin: 'camera', fail: true}]) {
  test(`salvamento atrasado não altera outro editor: ${JSON.stringify(options)}`, async () => {
    let confirm;
    const commitGate = new Promise(resolve => {confirm = resolve;});
    const {context, status, cameraResult, dialog, submit} = setup({...options, commitGate});
    const saving = submit();
    context.labelEntryGeneration++;
    context.labelCameraConfirmation = {uid: 'user-1', status: ''};
    context.labelManualConfirmation = {uid: 'user-1', status: ''};
    status.textContent = 'Dados do novo registro preservados';
    confirm();
    await saving;
    assert.equal(dialog.open, true);
    assert.equal(context.labelCameraConfirmation.status, '');
    assert.equal(context.labelManualConfirmation.status, '');
    assert.doesNotMatch(cameraResult.innerHTML, /Feito!/);
    assert.equal(status.textContent, 'Dados do novo registro preservados');
    assert.equal(context.notice, '');
    assert.equal(context.renderCount, 0);
  });
}
test('registro pela câmera pendente não exibe Feito nem aviso de confirmação', async () => {
  const {context, cameraResult, submit} = setup({origin: 'camera', pending: true});
  await submit();
  assert.equal(context.labelCameraConfirmation.status, 'pending');
  assert.doesNotMatch(cameraResult.innerHTML, /Feito!/);
  assert.equal(context.notice, '');
  assert.equal(context.labelManualConfirmation.status, '');
});
test('falha ao salvar pela câmera mantém o formulário e permite corrigir sem marcar Feito', async () => {
  const {context, status, cameraResult, dialog, submit} = setup({origin: 'camera', fail: true});
  await submit();
  assert.equal(context.labelCameraConfirmation.status, 'pending');
  assert.equal(dialog.open, true);
  assert.doesNotMatch(cameraResult.innerHTML, /Feito!/);
  assert.match(status.textContent, /Não confirmado/);
  assert.equal(context.notice, '');
});
test('o indicador da câmera não aparece para outra conta', async () => {
  const {context, submit} = setup({origin: 'camera'});
  await submit();
  context.session.user.uid = 'user-2';
  assert.equal(context.renderLabelCameraConfirmation?.() ?? 'helper ausente', '');
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

function reportRecordHtml(mode, allowed, {record = {}, access = {}} = {}) {
  const start = source.indexOf('function renderLiveLabelReport(');
  const end = source.indexOf('function beginLabelEdit(', start);
  assert.ok(start >= 0 && end > start);
  const records = [{id: 'label-1', createdByUid: 'user-1', patientName: 'Paciente fictício', date: '2026-09-30', staffSiglas: [], ...record}];
  const target = {isConnected: true, innerHTML: '', querySelectorAll: () => [], querySelector: () => null};
  const scope = {key: 'labels:test', mode, uid: 'user-1', sigla: 'AA', canWrite: allowed, canManage: false, day: '2026-09-30', from: '2026-09-30', to: '2026-09-30', month: '2026-09', targetNode: target, ...access};
  const context = vm.createContext({
    session: {user: {uid: 'user-1'}, profile: {}}, loadedLabelRecords: [], labelReportCursor: null,
    document: {querySelector: selector => selector === '#label-report-results' ? target : null},
    navigator: {onLine: true}, reportScopeCurrent: () => true, reportTimestamp: () => 0,
    escapeHtml: String, formatRecordDate: String, reconcileReportMarkup(node, markup) {node.innerHTML = markup;}, updateLabelReportSync() {}
  });
  vm.runInContext(source.slice(start, end), context);
  context.renderLiveLabelReport({records, nextCursor: null}, scope);
  return target.innerHTML;
}
test('relatório mensal não apresenta Editar para nenhum perfil', () => {
  for (const allowed of [true, false]) assert.doesNotMatch(reportRecordHtml('monthly', allowed), /data-label-edit|EDITAR REGISTRO|>Editar</);
});
test('relatório diário mantém Editar conforme as permissões', () => {
  assert.match(reportRecordHtml('daily', true), /data-label-edit/);
  assert.doesNotMatch(reportRecordHtml('daily', false), /data-label-edit/);
});
test('abertura da edição também fica bloqueada no modo mensal', () => {
  const fn = source.slice(source.indexOf('function beginLabelEdit(item)'), source.indexOf('function resetLabelEditor'));
  const ctx = vm.createContext({labelReportMode: 'monthly', document: {querySelector() {throw new Error('Não deveria abrir editor');}}});
  vm.runInContext(fn, ctx);
  vm.runInContext('beginLabelEdit({id: "label-1"})', ctx);
});

test('edição diária de Etiquetas exige envolvimento ou gestão e somente registros confirmados', () => {
  assert.doesNotMatch(reportRecordHtml('daily', true, {record: {createdByUid: 'outra-conta'}}), /data-label-edit/);
  assert.match(reportRecordHtml('daily', true, {record: {createdByUid: 'outra-conta', staffSiglas: ['AA']}}), /data-label-edit/);
  assert.match(reportRecordHtml('daily', false, {record: {createdByUid: 'outra-conta'}, access: {canManage: true}}), /data-label-edit/);
  for (const flags of [{pendingFirestore: true}, {pendingSync: true}, {pendingEdit: true}, {syncFailed: true}, {syncConflict: true}, {hasPendingWrites: true}, {metadata: {hasPendingWrites: true}}]) {
    assert.doesNotMatch(reportRecordHtml('daily', true, {record: flags}), /data-label-edit|data-label-history=/, JSON.stringify(flags));
  }
  assert.doesNotMatch(reportRecordHtml('monthly', true, {access: {canManage: true}}), /data-label-edit|data-label-history=/);
});
