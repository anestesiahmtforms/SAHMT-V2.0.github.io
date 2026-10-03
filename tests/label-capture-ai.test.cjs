const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const main = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
const featureSource = readFileSync(join(__dirname, '../src/feature-flags.js'), 'utf8').replaceAll('export ', '');
const start = main.indexOf('function bindLabelAi(workspace, form)');
const end = main.indexOf('function renderTrainingAdminList(', start);
assert.ok(start >= 0 && end > start);
const source = main.slice(start, end).replaceAll("await import('./label-ai.js')", 'await mockAiImport()');
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
class Element extends EventTarget {
  constructor(extra = {}) {
    super();
    Object.assign(this, {isConnected: true, disabled: false, textContent: '', value: '', dataset: {}, attributes: {}, focusCalls: [], files: []}, extra);
    this.classList = {add() {}, remove() {}, toggle() {}};
  }
  setAttribute(name, value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name] ?? null;}
  removeAttribute(name) {delete this.attributes[name];}
  dispatchEvent(event) {
    const delivered = super.dispatchEvent(event);
    if (event.bubbles && this.parent) this.parent.dispatchEvent(new Event(event.type));
    return delivered;
  }
  focus(options) {this.focusCalls.push(options);}
  click() {this.dispatchEvent(new Event('click'));}
}
class Dialog extends Element {
  constructor() {super({open: false, shows: 0});}
  showModal() {this.open = true; this.shows++; this.dispatchEvent(new Event('open'));}
  close() {this.open = false; this.dispatchEvent(new Event('close'));}
}
const aiResult = {patientName: 'PESSOA FICTÍCIA', insurance: 'CONVÊNIO FICTÍCIO', procedureCode: '1234', encounterCode: '5678', type: 'Convênio', creditor: 'Plantão', uncertain: ['encounterCode']};
function setup({enabled = true, importPromise, extract = async () => aiResult} = {}) {
  const status = new Element(), formStatus = new Element(), fileInput = new Element(), capture = new Element(), open = new Element(), manual = new Element(), cameraDialog = new Dialog(), entryDialog = new Dialog();
  const map = new Map([
    ['#label-ai-status', status], ['#label-image-file', fileInput], ['#label-camera-capture', capture],
    ['#label-camera-open', open], ['#label-manual-open', manual], ['#label-camera-dialog', cameraDialog],
    ['#label-entry-dialog', entryDialog], ['#label-form-status', formStatus]
  ]);
  const form = new Element({elements: Object.fromEntries(['patientName', 'insurance', 'procedureCode', 'encounterCode', 'type', 'creditor', 'date', 'editLabelId', 'editLabelVersion'].map(name => [name, new Element()]))});
  for (const field of Object.values(form.elements)) field.parent = form;
  const workspace = new Element();
  workspace.querySelector = selector => map.get(selector) || null;
  form.querySelector = selector => map.get(selector) || null;
  const calls = [], imports = [], updates = [];
  let route = 'labels', allowed = true;
  const ctx = vm.createContext({
    Blob, Event, AbortController, Promise, Error, Set, WeakSet, Date, String, Object, console,
    navigator: {onLine: true},
    labelAiEnabled: enabled,
    session: {status: 'signed-in', user: {uid: 'fictional-user'}, profile: {active: true, access: true, permissions: {labelsWrite: true}}},
    appFeatures: {labels: true},
    can: permission => allowed && ['labelsWrite', 'labelsManage'].includes(permission),
    currentRoute: () => route,
    todayInputValue: () => '2026-10-02',
    updateLabelEntryFields: value => updates.push(value),
    document: {querySelector: selector => selector === '.label-workspace' ? workspace : selector === '[data-module-form="labels"]' ? form : map.get(selector) || null},
    mockAiImport: () => {
      imports.push(true);
      return importPromise || Promise.resolve({extractLabelWithAi: async file => {calls.push(file); return extract(file);}});
    }
  });
  vm.runInContext(featureSource, ctx);
  vm.runInContext(source, ctx);
  const ai = ctx.bindLabelAi(workspace, form);
  assert.equal(typeof ai.readCapture, 'function');
  assert.equal(typeof ai.dispose, 'function');
  const file = new Blob(['FICTIONAL IMAGE ONLY'], {type: 'image/jpeg'});
  return {
    ctx, ai, form, workspace, status, formStatus, capture, open, manual, fileInput, cameraDialog, entryDialog, calls, imports, updates, file,
    setRoute: value => {route = value;},
    setAllowed: value => {allowed = value;},
    setFeature: value => {ctx.appFeatures.labels = value;},
    read: (value = file) => ai.readCapture(value)
  };
}
function flush() {return new Promise(resolve => setImmediate(resolve));}

test('captura confirmada lê automaticamente uma vez e preenche apenas um rascunho', async () => {
  const f = setup();
  assert.equal('DataTransfer' in f.ctx, false);
  await f.read();
  assert.equal(f.imports.length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0], f.file);
  for (const name of ['patientName', 'insurance', 'procedureCode', 'encounterCode', 'type', 'creditor']) assert.equal(f.form.elements[name].value, aiResult[name]);
  assert.equal(f.form.elements.date.value, '2026-10-02');
  assert.equal(f.form.dataset.labelEntrySource, 'camera');
  assert.equal(f.entryDialog.open, true);
  assert.equal(f.entryDialog.shows, 1);
  assert.equal(f.updates.length, 1);
  assert.match(f.status.textContent, /Confira/);
  assert.match(f.formStatus.textContent, /atendimento|incert/i);
  assert.doesNotMatch(source, /createOperationalRecord|updateLabelRecord|dispatchEvent\(new Event\(['"]submit|requestSubmit\(/);
});

test('cliques duplicados durante a leitura não geram segunda requisição', async () => {
  const pending = deferred(); const f = setup({extract: () => pending.promise});
  const first = f.read(); await flush();
  const duplicate = f.read(); await flush();
  assert.equal(f.imports.length, 1);
  assert.equal(f.calls.length, 1);
  pending.resolve(aiResult);
  await Promise.all([first, duplicate]);
  assert.equal(f.entryDialog.shows, 1);
});

test('IA desativada não importa nem envia imagem e mantém mensagem do registro manual', async () => {
  const f = setup({enabled: false});
  await f.read();
  assert.equal(f.imports.length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.entryDialog.open, false);
  assert.match(f.status.textContent, /desativada|manual/i);
});

test('arquivo bruto do seletor não inicia IA antes da confirmação de captura', async () => {
  const f = setup(); f.fileInput.files = [f.file];
  f.fileInput.dispatchEvent(new Event('change')); await flush();
  assert.equal(f.imports.length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.entryDialog.open, false);
});

const changes = {
  uid: f => {f.ctx.session.user.uid = 'another-fictional-user';},
  rota: f => f.setRoute('events'),
  permissao: f => f.setAllowed(false),
  sessao: f => {f.ctx.session.status = 'access-pending';},
  perfilOffline: f => {f.ctx.session.offline = true;},
  modulo: f => f.setFeature(false),
  perfilInativo: f => {f.ctx.session.profile.active = false;},
  acessoRevogado: f => {f.ctx.session.profile.access = false;},
  formularioRemovido: f => {f.form.isConnected = false;},
  workspaceRemovido: f => {f.workspace.isConnected = false;},
  descartado: f => f.ai.dispose()
};
for (const [name, change] of Object.entries(changes)) {
  test(`leitura recusada antes do envio quando ${name} muda durante importação`, async () => {
    const pending = deferred(); const calls = [];
    const f = setup({importPromise: pending.promise});
    const result = f.read(); await flush();
    change(f);
    pending.resolve({extractLabelWithAi: async file => {calls.push(file); return aiResult;}});
    await result;
    assert.equal(calls.length, 0);
    assert.equal(f.form.elements.patientName.value, '');
    assert.equal(f.entryDialog.open, false);
  });
  test(`resposta antiga não altera campos quando ${name} muda durante IA`, async () => {
    const pending = deferred(); const f = setup({extract: () => pending.promise});
    const result = f.read(); await flush(); assert.equal(f.calls.length, 1);
    change(f);
    const statusBefore = f.status.textContent;
    pending.resolve(aiResult); await result;
    assert.equal(f.form.elements.patientName.value, '');
    assert.equal(f.entryDialog.open, false);
    assert.equal(f.status.textContent, statusBefore);
  });
}

test('abrir registro manual enquanto IA lê impede substituição tardia do formulário', async () => {
  const pending = deferred(); const f = setup({extract: () => pending.promise});
  const result = f.read(); await flush();
  f.manual.click();
  f.form.dataset.labelEntrySource = 'manual';
  f.form.elements.patientName.value = 'RASCUNHO MANUAL FICTÍCIO';
  pending.resolve(aiResult); await result;
  assert.equal(f.form.elements.patientName.value, 'RASCUNHO MANUAL FICTÍCIO');
  assert.equal(f.entryDialog.shows, 0);
});

for (const eventName of ['input', 'change']) test(`alteração ${eventName} durante leitura mantém o preenchimento já feito`, async () => {
  const pending = deferred(); const f = setup({extract: () => pending.promise});
  const result = f.read(); await flush();
  f.form.elements.encounterCode.value = '9999';
  f.form.dispatchEvent(new Event(eventName));
  pending.resolve(aiResult); await result;
  assert.equal(f.form.elements.encounterCode.value, '9999');
  assert.equal(f.form.elements.patientName.value, '');
  assert.equal(f.entryDialog.shows, 0);
});

test('erro de IA mantém mensagem acessível e registro manual disponível para nova tentativa', async () => {
  let count = 0;
  const f = setup({extract: async () => {if (++count === 1) throw new Error('Falha fictícia: use o registro manual.'); return aiResult;}});
  await f.read();
  assert.match(f.status.textContent, /Falha fictícia/);
  assert.equal(f.manual.disabled, false);
  assert.equal(f.entryDialog.open, false);
  assert.match(main, /id="label-ai-status"[^>]*role="status"[^>]*aria-live="polite"/);
  await f.read(new Blob(['SECOND FICTIONAL FRAME'], {type: 'image/jpeg'}));
  assert.equal(f.calls.length, 2);
  assert.equal(f.entryDialog.open, true);
});

test('rejeição antiga não mostra erro nem substitui estado de outra sessão', async () => {
  const pending = deferred(); const f = setup({extract: () => pending.promise});
  const result = f.read(); await flush(); f.ctx.session.user.uid = 'another-fictional-user';
  f.status.textContent = 'ESTADO DA NOVA SESSÃO';
  pending.reject(new Error('ERRO ANTIGO')); await result;
  assert.equal(f.status.textContent, 'ESTADO DA NOVA SESSÃO');
  assert.equal(f.entryDialog.open, false);
});

test('captura sem rede não envia imagem e orienta o registro manual', async () => {
  const f = setup(); f.ctx.navigator.onLine = false;
  await f.read();
  assert.equal(f.imports.length, 0);
  assert.equal(f.calls.length, 0);
  assert.match(f.status.textContent, /Sem conexão|manual/i);
});

test('resposta antiga não libera o bloqueio visual de uma captura mais recente', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const f = setup({extract: () => ++count === 1 ? first.promise : second.promise});
  const oldRead = f.read(); await flush();
  f.manual.click();
  const newRead = f.read(new Blob(['NEW FICTIONAL FRAME'], {type: 'image/jpeg'})); await flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.open.disabled, true);
  first.resolve(aiResult); await oldRead;
  assert.equal(f.open.disabled, true);
  assert.equal(f.workspace.getAttribute('aria-busy'), 'true');
  assert.equal(f.entryDialog.open, false);
  second.resolve({...aiResult, patientName: 'SEGUNDA PESSOA FICTÍCIA'}); await newRead;
  assert.equal(f.open.disabled, false);
  assert.equal(f.workspace.getAttribute('aria-busy'), null);
  assert.equal(f.form.elements.patientName.value, 'SEGUNDA PESSOA FICTÍCIA');
});

for (const phase of ['importacao', 'resposta']) test(`abrir edição programaticamente durante ${phase} não substitui registro em edição`, async () => {
  const pending = deferred(), calls = [];
  const f = phase === 'importacao'
    ? setup({importPromise: pending.promise})
    : setup({extract: () => pending.promise});
  const result = f.read(); await flush();
  f.form.dataset.labelEntrySource = 'edit';
  f.form.elements.editLabelId.value = 'FICTIONAL-EXISTING-LABEL';
  f.form.elements.editLabelVersion.value = '7';
  f.form.elements.patientName.value = 'PESSOA FICTÍCIA EM EDIÇÃO';
  f.form.elements.encounterCode.value = '9999';
  f.entryDialog.showModal();
  if (phase === 'importacao') pending.resolve({extractLabelWithAi: async file => {calls.push(file); return aiResult;}});
  else pending.resolve(aiResult);
  await result;
  assert.equal(calls.length, 0);
  assert.equal(f.form.elements.patientName.value, 'PESSOA FICTÍCIA EM EDIÇÃO');
  assert.equal(f.form.elements.encounterCode.value, '9999');
  assert.equal(f.form.elements.editLabelId.value, 'FICTIONAL-EXISTING-LABEL');
  assert.equal(f.form.elements.editLabelVersion.value, '7');
  assert.equal(f.form.dataset.labelEntrySource, 'edit');
  assert.equal(f.entryDialog.shows, 1);
  assert.equal(f.updates.length, 0);
});

for (const key of ['source', 'id', 'version']) test(`mudança isolada de ${key} no editor invalida resposta sem eventos input/change`, async () => {
  const pending = deferred(); const f = setup({extract: () => pending.promise});
  const result = f.read(); await flush();
  if (key === 'source') f.form.dataset.labelEntrySource = 'edit';
  if (key === 'id') f.form.elements.editLabelId.value = 'ANOTHER-FICTIONAL-LABEL';
  if (key === 'version') f.form.elements.editLabelVersion.value = '8';
  pending.resolve(aiResult); await result;
  assert.equal(f.form.elements.patientName.value, '');
  assert.equal(f.entryDialog.open, false);
  assert.equal(f.updates.length, 0);
});

for (const editor of ['edicao', 'registroAberto']) test(`captura não inicia leitura quando ${editor} já ocupa o formulário`, async () => {
  const f = setup();
  if (editor === 'edicao') {
    f.form.dataset.labelEntrySource = 'edit';
    f.form.elements.editLabelId.value = 'FICTIONAL-EXISTING-LABEL';
    f.form.elements.editLabelVersion.value = '2';
  } else f.entryDialog.showModal();
  await f.read();
  assert.equal(f.imports.length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.form.elements.patientName.value, '');
});

test('editar e cancelar com reset não faz resposta antiga reabrir um novo registro', async () => {
  const pending = deferred(); const f = setup({extract: () => pending.promise});
  const result = f.read(); await flush();
  f.form.dataset.labelEntrySource = 'edit';
  f.form.elements.editLabelId.value = 'FICTIONAL-EXISTING-LABEL';
  f.form.elements.editLabelVersion.value = '7';
  f.entryDialog.showModal();
  f.form.dispatchEvent(new Event('reset'));
  delete f.form.dataset.labelEntrySource;
  f.form.elements.editLabelId.value = '';
  f.form.elements.editLabelVersion.value = '';
  f.entryDialog.close();
  pending.resolve(aiResult); await result;
  assert.equal(f.form.elements.patientName.value, '');
  assert.equal(f.form.elements.editLabelId.value, '');
  assert.equal(f.entryDialog.open, false);
  assert.equal(f.entryDialog.shows, 1);
  assert.equal(f.updates.length, 0);
});