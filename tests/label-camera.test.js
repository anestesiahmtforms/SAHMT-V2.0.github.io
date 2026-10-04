import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {bindLabelCamera} from '../src/label-camera.js';

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.disabled = false;
    this.textContent = '';
    this.isConnected = true;
  }
  click() { this.dispatchEvent(new Event('click')); }
}

class FakeDialog extends FakeElement {
  open = false;
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}

class FakeDataTransfer {
  constructor() {
    this._files = [];
    this.items = {add: (file) => this._files.push(file)};
  }
  get files() { return this._files; }
}

function installGlobals({getUserMedia, image = null, drawImage = () => {}, toBlob = (callback, type) => callback(new Blob(['camera-frame'], {type}))}) {
  const previous = new Map(['document', 'navigator', 'DataTransfer'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {mediaDevices: getUserMedia ? {getUserMedia} : undefined}});
  Object.defineProperty(globalThis, 'DataTransfer', {configurable: true, value: FakeDataTransfer});
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {createElement: (name) => {
      if (name === 'img' && image) return image;
      assert.equal(name, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext: () => ({drawImage}),
        toBlob(callback, type) { toBlob(callback, type); }
      };
    }}
  });
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

function createForm() {
  const elements = new Map([
    ['#label-camera-open', new FakeElement()],
    ['#label-camera-close', new FakeElement()],
    ['#label-camera-capture', new FakeElement()],
    ['#label-camera-dialog', new FakeDialog()],
    ['#label-camera-video', Object.assign(new FakeElement(), {videoWidth: 640, videoHeight: 480, play: async () => {}})],
    ['#label-camera-status', new FakeElement()],
    ['#label-image-file', new FakeElement()]
  ]);
  const form = {querySelector: (selector) => elements.get(selector)};
  return {form, elements};
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('A câmera simulada não concluiu a ação esperada.');
}

test('captura de Etiquetas cria JPEG em memória e libera a câmera ao capturar, fechar e desmontar', async () => {
  const streams = [];
  const restoreGlobals = installGlobals({getUserMedia: async () => {
    const track = {readyState: 'live', stop() { this.readyState = 'ended'; }};
    const stream = {getTracks: () => [track], track};
    streams.push(stream);
    return stream;
  }});
  try {
    const {form, elements} = createForm();
    const open = elements.get('#label-camera-open');
    const close = elements.get('#label-camera-close');
    const capture = elements.get('#label-camera-capture');
    const dialog = elements.get('#label-camera-dialog');
    const video = elements.get('#label-camera-video');
    const input = elements.get('#label-image-file');
    let changedFile = null;
    input.addEventListener('change', () => { changedFile = input.files?.[0] || null; });
    const cleanup = bindLabelCamera(form);

    open.click();
    await waitFor(() => capture.disabled === false);
    assert.equal(dialog.open, true);
    assert.equal(video.srcObject, streams[0]);
    assert.equal(streams[0].track.readyState, 'live');

    close.click();
    assert.equal(dialog.open, false);
    assert.equal(video.srcObject, null);
    assert.equal(streams[0].track.readyState, 'ended');

    open.click();
    await waitFor(() => capture.disabled === false);
    capture.click();
    assert.equal(changedFile?.type, 'image/jpeg');
    assert.ok(changedFile.size > 0);
    assert.equal(dialog.open, false);
    assert.equal(video.srcObject, null);
    assert.equal(streams[1].track.readyState, 'ended');

    open.click();
    await waitFor(() => capture.disabled === false);
    cleanup();
    assert.equal(dialog.open, false);
    assert.equal(video.srcObject, null);
    assert.equal(streams[2].track.readyState, 'ended');
  } finally {
    restoreGlobals();
  }
});

test('captura comunica indisponibilidade da câmera e mantém a alternativa por arquivo', () => {
  const restoreGlobals = installGlobals({getUserMedia: null});
  try {
    const {form, elements} = createForm();
    const cleanup = bindLabelCamera(form);
    elements.get('#label-camera-open').click();
    assert.match(elements.get('#label-camera-status').textContent, /não oferece câmera direta/i);
    assert.equal(elements.get('#label-camera-dialog').open, true);
    cleanup();
    assert.equal(elements.get('#label-camera-dialog').open, false);
  } finally {
    restoreGlobals();
  }
});

test('captura libera a câmera antes de entregar a imagem ao leitor automático', async () => {
  const track = {stopped: false, stop() {this.stopped = true;}};
  const restoreGlobals = installGlobals({getUserMedia: async () => ({getTracks: () => [track]})});
  try {
    const {form, elements} = createForm();
    const input = elements.get('#label-image-file');
    const dialog = elements.get('#label-camera-dialog');
    const video = elements.get('#label-camera-video');
    let captured = null;
    input.addEventListener('label-captured', () => {
      captured = {file: input.files?.[0], dialogOpen: dialog.open, stream: video.srcObject, stopped: track.stopped};
    });
    const cleanup = bindLabelCamera(form);
    elements.get('#label-camera-open').click();
    await waitFor(() => !elements.get('#label-camera-capture').disabled);
    elements.get('#label-camera-capture').click();
    assert.equal(captured?.file?.type, 'image/jpeg');
    assert.equal(captured.dialogOpen, false);
    assert.equal(captured.stream, null);
    assert.equal(captured.stopped, true);
    cleanup();
  } finally {restoreGlobals();}
});

test('fechar a câmera durante a preparação da foto cancela a leitura dessa captura', async () => {
  let finishCapture;
  const restoreGlobals = installGlobals({getUserMedia: async () => ({getTracks: () => [{stop() {}}]}), toBlob: callback => {finishCapture = callback;}});
  try {
    const {form, elements} = createForm();
    const input = elements.get('#label-image-file');
    let delivered = false;
    input.addEventListener('change', () => {delivered = true;});
    const cleanup = bindLabelCamera(form);
    elements.get('#label-camera-open').click();
    await waitFor(() => !elements.get('#label-camera-capture').disabled);
    elements.get('#label-camera-capture').click();
    elements.get('#label-camera-close').click();
    finishCapture(new Blob(['cancelled-frame'], {type: 'image/jpeg'}));
    assert.equal(delivered, false);
    assert.equal(elements.get('#label-camera-dialog').open, false);
    cleanup();
  } finally {restoreGlobals();}
});

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const aiBinding = mainSource.slice(mainSource.indexOf('function bindLabelAi('), mainSource.indexOf('function renderTrainingAdminList('))
  .replace("await import('./label-ai.js')", 'mockAi');
const editorBinding = mainSource.slice(mainSource.indexOf('function beginLabelEdit(item)'), mainSource.indexOf('function exportLabelReport('));

function createAiHarness({enabled = true, cameraElements = null, extract = async () => ({patientName: 'PACIENTE FICTÍCIO', encounterCode: '12345', type: 'Consulta Pré-anestésica', creditor: 'Caixa', uncertain: []})} = {}) {
  const elements = cameraElements || new Map();
  for (const selector of ['#label-image-file', '#label-camera-open', '#label-manual-open', '#label-ai-status']) {
    if (!elements.has(selector)) elements.set(selector, new FakeElement());
  }
  const label = new FakeElement();
  const open = elements.get('#label-camera-open');
  open.querySelector = () => label;
  open.setAttribute = () => {};
  const classes = new Set(['sr-only']);
  elements.get('#label-ai-status').classList = {add(name) {classes.add(name);}, remove(name) {classes.delete(name);}};
  const dialog = new FakeDialog();
  const formStatus = new FakeElement();
  const submit = new FakeElement();
  const controls = new Map([['[type="submit"]', submit], ['#label-form-status', formStatus], ['#label-edit-cancel', new FakeElement()], ['#label-conflict-refresh', new FakeElement()]]);
  const fields = ['date', 'patientName', 'insurance', 'procedureCode', 'encounterCode', 'type', 'creditor', 'editLabelId', 'editLabelVersion'];
  const form = {isConnected: true, dataset: {}, querySelector: selector => controls.get(selector), elements: Object.fromEntries(fields.map(name => [name, Object.assign(new FakeElement(), {value: '', focus() {}})]))};
  form.reset = () => {for (const field of Object.values(form.elements)) field.value = '';};
  const context = vm.createContext({
    labelAiEnabled: enabled, labelEntryGeneration: 0, labelReportMode: 'daily', session: {user: {uid: 'user-1'}},
    document: {querySelector(selector) {return selector === '#label-entry-dialog' ? dialog : selector === '#label-form-status' ? formStatus : selector === '[data-module-form="labels"]' ? form : null;}},
    mockAi: {extractLabelWithAi: extract},
    updateLabelEntryFields() {}, setLabelStaffSiglas() {},
    updateLabelCameraConfirmation() {}, todayInputValue: () => '2026-10-04',
    Event, AbortController
  });
  vm.runInContext(editorBinding, context);
  vm.runInContext(aiBinding, context);
  const cleanup = context.bindLabelAi({querySelector: selector => elements.get(selector)}, form);
  const input = elements.get('#label-image-file');
  input.files = [new File(['cropped-test-image'], 'captured.jpg', {type: 'image/jpeg'})];
  return {elements, input, form, dialog, context, formStatus, submit, cleanup, classes};
}

test('a imagem capturada inicia a leitura sem segundo clique e abre um rascunho para conferência', async () => {
  const {elements, input, form, dialog, cleanup} = createAiHarness();
  form.elements.insurance.value = 'valor antigo';
  form.elements.editLabelId.value = 'registro-antigo';
  input.dispatchEvent(new Event('change'));
  input.dispatchEvent(new Event('label-captured'));
  await waitFor(() => dialog.open);
  assert.equal(form.elements.patientName.value, 'PACIENTE FICTÍCIO');
  assert.equal(form.elements.encounterCode.value, '12345');
  assert.equal(form.elements.insurance.value, '');
  assert.equal(form.elements.editLabelId.value, '');
  assert.equal(form.elements.date.value, '2026-10-04');
  assert.equal(form.dataset.labelEntrySource, 'camera');
  assert.equal(elements.get('#label-camera-open').disabled, false);
  cleanup();
});

test('selecionar uma foto ainda não envia imagem: a leitura aguarda a captura do recorte', async () => {
  let requests = 0;
  const {input, dialog, cleanup} = createAiHarness({extract: async () => {requests++; return {};}});
  input.dispatchEvent(new Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests, 0);
  assert.equal(dialog.open, false);
  cleanup();
});

test('câmera nativa mostra a foto e envia somente o recorte confirmado, após fechar a câmera', async () => {
  const image = Object.assign(new FakeElement(), {
    naturalWidth: 1600, naturalHeight: 1200, removeAttribute() {},
    getBoundingClientRect: () => ({left: 20, top: 100, width: 320, height: 240})
  });
  let crop;
  const restoreGlobals = installGlobals({getUserMedia: null, image, drawImage: (...args) => {crop = args;}});
  let cleanup;
  let cleanupCamera;
  try {
    const camera = createForm();
    camera.elements.set('.label-camera-target', {
      parentElement: {insertBefore() {}},
      getBoundingClientRect: () => ({left: 100, top: 160, right: 260, bottom: 280, width: 160, height: 120})
    });
    let requests = 0;
    const harness = createAiHarness({cameraElements: camera.elements, extract: async file => {
      requests++;
      assert.equal(camera.elements.get('#label-camera-dialog').open, false);
      assert.equal(camera.elements.get('#label-camera-video').srcObject, null);
      assert.equal(file.type, 'image/jpeg');
      return {patientName: 'PACIENTE FICTÍCIO', uncertain: []};
    }});
    cleanup = harness.cleanup;
    cleanupCamera = bindLabelCamera(camera.form);
    camera.elements.get('#label-camera-open').click();
    harness.input.files = [new File(['native-test-photo'], 'foto.jpg', {type: 'image/jpeg'})];
    harness.input.dispatchEvent(new Event('change'));
    image.onload();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requests, 0);
    assert.equal(image.hidden, false);
    assert.equal(camera.elements.get('#label-camera-capture').disabled, false);
    camera.elements.get('#label-camera-capture').click();
    await waitFor(() => harness.dialog.open);
    assert.equal(requests, 1);
    assert.deepEqual(crop, [image, 400, 300, 800, 600, 0, 0, 800, 600]);
    assert.equal(harness.form.dataset.labelEntrySource, 'camera');
  } finally {
    cleanup?.();
    cleanupCamera?.();
    restoreGlobals();
  }
});

test('uma captura não dispara leituras duplicadas enquanto a leitura atual está em andamento', async () => {
  let finish;
  let requests = 0;
  const result = new Promise(resolve => {finish = resolve;});
  const {input, elements, dialog, cleanup} = createAiHarness({extract: async () => {requests++; return result;}});
  input.dispatchEvent(new Event('label-captured'));
  input.dispatchEvent(new Event('label-captured'));
  await waitFor(() => requests > 0);
  assert.equal(elements.get('#label-camera-open').disabled, true);
  assert.equal(requests, 1);
  finish({patientName: 'PACIENTE FICTÍCIO', uncertain: []});
  await waitFor(() => dialog.open);
  cleanup();
});

test('abrir Registro Manual durante a leitura impede que a resposta atrasada substitua o formulário', async () => {
  let finish;
  const result = new Promise(resolve => {finish = resolve;});
  const {input, elements, form, dialog, cleanup} = createAiHarness({extract: async () => result});
  input.dispatchEvent(new Event('label-captured'));
  assert.equal(elements.get('#label-camera-open').disabled, true);
  elements.get('#label-manual-open').click();
  form.elements.patientName.value = 'PREENCHIMENTO MANUAL';
  finish({patientName: 'RESPOSTA ATRASADA', uncertain: []});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(form.elements.patientName.value, 'PREENCHIMENTO MANUAL');
  assert.equal(dialog.open, false);
  assert.equal(elements.get('#label-camera-open').disabled, false);
  cleanup();
});

test('editar pelo relatório durante a leitura preserva a edição e descarta a resposta atrasada', async () => {
  let finish;
  let requests = 0;
  const result = new Promise(resolve => {finish = resolve;});
  const {input, elements, form, dialog, context, cleanup} = createAiHarness({extract: async () => {requests++; return result;}});
  input.dispatchEvent(new Event('label-captured'));
  await waitFor(() => requests === 1);
  context.beginLabelEdit({id: 'registro-existente', version: 3, patientName: 'PACIENTE EM EDIÇÃO', date: '2026-10-03', type: 'Consulta Pré-anestésica', creditor: 'Caixa'});
  form.elements.patientName.value = 'CORREÇÃO DO USUÁRIO';
  finish({patientName: 'RESPOSTA ATRASADA', uncertain: []});
  await waitFor(() => !elements.get('#label-camera-open').disabled);
  assert.equal(dialog.open, true);
  assert.equal(form.elements.patientName.value, 'CORREÇÃO DO USUÁRIO');
  assert.equal(form.elements.editLabelId.value, 'registro-existente');
  assert.equal(form.elements.editLabelVersion.value, '3');
  assert.equal(form.dataset.labelEntrySource, 'edit');
  cleanup();
});

test('abrir outro editor após fechar um salvamento libera o botão de salvar', () => {
  const {submit, context, cleanup} = createAiHarness();
  submit.disabled = true;
  context.resetLabelEditor({keepOpen: true});
  assert.equal(submit.disabled, false);
  submit.disabled = true;
  context.beginLabelEdit({id: 'registro-existente'});
  assert.equal(submit.disabled, false);
  cleanup();
});

test('sair do módulo descarta a resposta atrasada da leitura', async () => {
  let finish;
  const result = new Promise(resolve => {finish = resolve;});
  const {input, elements, form, dialog, cleanup} = createAiHarness({extract: async () => result});
  input.dispatchEvent(new Event('label-captured'));
  assert.equal(elements.get('#label-camera-open').disabled, true);
  cleanup();
  finish({patientName: 'RESPOSTA ATRASADA', uncertain: []});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(form.elements.patientName.value, '');
  assert.equal(dialog.open, false);
});

test('falha de leitura libera o botão e informa o erro sem abrir rascunho nem confirmar registro', async () => {
  const {input, elements, dialog, cleanup, classes} = createAiHarness({extract: async () => {throw new Error('Falha de leitura de teste');}});
  input.dispatchEvent(new Event('label-captured'));
  await waitFor(() => elements.get('#label-ai-status').textContent.includes('Falha de leitura de teste'));
  assert.equal(elements.get('#label-camera-open').disabled, false);
  assert.equal(dialog.open, false);
  assert.equal(classes.has('sr-only'), false);
  cleanup();
});
