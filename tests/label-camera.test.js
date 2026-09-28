import assert from 'node:assert/strict';
import test from 'node:test';
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

function installGlobals({getUserMedia}) {
  const previous = new Map(['document', 'navigator', 'DataTransfer'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {mediaDevices: getUserMedia ? {getUserMedia} : undefined}});
  Object.defineProperty(globalThis, 'DataTransfer', {configurable: true, value: FakeDataTransfer});
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {createElement: (name) => {
      assert.equal(name, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext: () => ({drawImage: () => {}}),
        toBlob(callback, type) { callback(new Blob(['camera-frame'], {type})); }
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
