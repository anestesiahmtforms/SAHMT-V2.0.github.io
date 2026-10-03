import assert from 'node:assert/strict';
import test from 'node:test';
import {bindLabelCamera} from '../src/label-camera.js';

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.disabled = false;
    this.textContent = '';
    this.isConnected = true;
    this.hidden = false;
  }
  click() { this.dispatchEvent(new Event('click')); }
  removeAttribute(name) { delete this[name]; }
  getBoundingClientRect() { return {left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240}; }
}

class FakeDialog extends FakeElement {
  open = false;
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}

class FakeFileInput extends FakeElement {
  _files = [];
  rejectAssignment = false;
  get files() { return this._files; }
  set files(files) {
    if (this.rejectAssignment) throw new TypeError('FileList assignment unavailable');
    this._files = files;
  }
  set value(value) { if (!value) this._files = []; }
}

class FakeDataTransfer {
  constructor() {
    this._files = [];
    this.items = {add: (file) => this._files.push(file)};
  }
  get files() { return this._files; }
}

function installGlobals({getUserMedia, dataTransfer = FakeDataTransfer, deferredBlob = false, withPhotoPreview = false} = {}) {
  const previous = new Map(['document', 'navigator', 'DataTransfer'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousUrlMethods = {createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL};
  const canvases = [];
  const images = [];
  const objectUrls = [];
  const revokedUrls = [];
  URL.createObjectURL = (file) => {
    const url = `blob:test-${objectUrls.length}`;
    objectUrls.push({url, file});
    return url;
  };
  URL.revokeObjectURL = (url) => revokedUrls.push(url);
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {mediaDevices: getUserMedia ? {getUserMedia} : undefined}});
  Object.defineProperty(globalThis, 'DataTransfer', {configurable: true, value: dataTransfer});
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {createElement: (name) => {
      if (name === 'img' && withPhotoPreview) {
        const image = Object.assign(new FakeElement(), {naturalWidth: 640, naturalHeight: 480});
        images.push(image);
        return image;
      }
      assert.equal(name, 'canvas');
      const canvas = {
        width: 0,
        height: 0,
        drawArgs: [],
        getContext: () => ({drawImage: (...args) => { canvas.drawArgs = args; }}),
        toBlob(callback, type) {
          canvas.resolveBlob = (blob = new Blob(['confirmed-cropped-camera-frame'], {type})) => callback(blob);
          if (!deferredBlob) canvas.resolveBlob();
        }
      };
      canvases.push(canvas);
      return canvas;
    }}
  });
  return {
    canvases, images, objectUrls, revokedUrls,
    restore() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      Object.assign(URL, previousUrlMethods);
    }
  };
}

function createForm({withTarget = false} = {}) {
  const elements = new Map([
    ['#label-camera-open', new FakeElement()],
    ['#label-camera-close', new FakeElement()],
    ['#label-camera-capture', new FakeElement()],
    ['#label-camera-dialog', new FakeDialog()],
    ['#label-camera-video', Object.assign(new FakeElement(), {videoWidth: 640, videoHeight: 480, play: async () => {}})],
    ['#label-camera-status', new FakeElement()],
    ['#label-image-file', new FakeFileInput()]
  ]);
  if (withTarget) elements.set('.label-camera-target', Object.assign(new FakeElement(), {
    parentElement: {insertBefore() {}},
    getBoundingClientRect: () => ({left: 80, top: 80, width: 160, height: 80, right: 240, bottom: 160})
  }));
  const form = {querySelector: (selector) => elements.get(selector)};
  return {form, elements};
}

function makeStream() {
  const track = {readyState: 'live', stops: 0, stop() { this.readyState = 'ended'; this.stops++; }};
  return {getTracks: () => [track], track};
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('A câmera simulada não concluiu a ação esperada.');
}

async function openCamera(elements) {
  elements.get('#label-camera-open').click();
  await waitFor(() => elements.get('#label-camera-capture').disabled === false);
}

test('captura de Etiquetas entrega JPEG confirmado uma vez após fechar e liberar a câmera', async () => {
  const streams = [];
  const globals = installGlobals({getUserMedia: async () => {
    const stream = makeStream();
    streams.push(stream);
    return stream;
  }});
  try {
    const {form, elements} = createForm({withTarget: true});
    const dialog = elements.get('#label-camera-dialog');
    const video = elements.get('#label-camera-video');
    const input = elements.get('#label-image-file');
    let changedFile = null;
    const captures = [];
    input.addEventListener('change', () => { changedFile = input.files?.[0] || null; });
    const cleanup = bindLabelCamera(form, {onCaptured: (file) => {
      assert.equal(dialog.open, false);
      assert.equal(video.srcObject, null);
      assert.equal(streams.at(-1).track.readyState, 'ended');
      captures.push(file);
    }});

    await openCamera(elements);
    assert.equal(video.srcObject, streams[0]);
    elements.get('#label-camera-close').click();
    assert.equal(dialog.open, false);
    assert.equal(video.srcObject, null);
    assert.equal(streams[0].track.readyState, 'ended');

    await openCamera(elements);
    elements.get('#label-camera-capture').click();
    assert.equal(captures.length, 1);
    assert.equal(captures[0], changedFile);
    assert.equal(captures[0].type, 'image/jpeg');
    assert.ok(captures[0].size > 0);
    assert.deepEqual(globals.canvases[0].drawArgs.slice(1), [160, 160, 320, 160, 0, 0, 320, 160]);
    assert.equal(globals.canvases[0].width, 0);
    assert.equal(globals.canvases[0].height, 0);

    await openCamera(elements);
    cleanup();
    assert.equal(dialog.open, false);
    assert.equal(video.srcObject, null);
    assert.equal(streams[2].track.readyState, 'ended');
  } finally {
    globals.restore();
  }
});

test('captura comunica indisponibilidade da câmera e mantém a alternativa por arquivo', () => {
  const globals = installGlobals({getUserMedia: null});
  try {
    const {form, elements} = createForm();
    const cleanup = bindLabelCamera(form);
    elements.get('#label-camera-open').click();
    assert.match(elements.get('#label-camera-status').textContent, /não oferece câmera direta/i);
    assert.equal(elements.get('#label-camera-dialog').open, true);
    cleanup();
    assert.equal(elements.get('#label-camera-dialog').open, false);
  } finally {
    globals.restore();
  }
});

for (const transferFailure of ['DataTransfer ausente', 'FileList não atribuível']) {
  test(`captura envia o JPEG confirmado diretamente quando ${transferFailure}`, async () => {
    const stream = makeStream();
    const globals = installGlobals({getUserMedia: async () => stream, dataTransfer: transferFailure === 'DataTransfer ausente' ? null : FakeDataTransfer});
    try {
      const {form, elements} = createForm();
      const input = elements.get('#label-image-file');
      if (transferFailure === 'FileList não atribuível') input.rejectAssignment = true;
      const captures = [];
      const cleanup = bindLabelCamera(form, {onCaptured: (file) => captures.push(file)});
      await openCamera(elements);
      elements.get('#label-camera-capture').click();
      assert.equal(captures.length, 1);
      assert.equal(captures[0].type, 'image/jpeg');
      assert.equal(stream.track.readyState, 'ended');
      assert.equal(elements.get('#label-camera-dialog').open, false);
      cleanup();
    } finally {
      globals.restore();
    }
  });
}

test('foto do aparelho exige confirmação e entrega apenas o recorte, liberando a URL da prévia', () => {
  const globals = installGlobals({getUserMedia: null, dataTransfer: null, withPhotoPreview: true});
  try {
    const {form, elements} = createForm({withTarget: true});
    const captures = [];
    const cleanup = bindLabelCamera(form, {onCaptured: (file) => captures.push(file)});
    elements.get('#label-camera-open').click();
    const original = new File(['unconfirmed-original-image'], 'original.png', {type: 'image/png'});
    const input = elements.get('#label-image-file');
    input.files = [original];
    input.dispatchEvent(new Event('change'));
    assert.equal(captures.length, 0);
    assert.equal(elements.get('#label-camera-capture').disabled, true);
    globals.images[0].onload();
    assert.equal(captures.length, 0);
    assert.match(elements.get('#label-camera-status').textContent, /CAPTURAR E LER/);
    elements.get('#label-camera-capture').click();
    assert.equal(captures.length, 1);
    assert.notEqual(captures[0], original);
    assert.equal(captures[0].type, 'image/jpeg');
    assert.deepEqual(globals.canvases[0].drawArgs.slice(1), [160, 160, 320, 160, 0, 0, 320, 160]);
    assert.deepEqual(globals.revokedUrls, [globals.objectUrls[0].url]);
    assert.equal(input.files.length, 0);
    cleanup();
  } finally {
    globals.restore();
  }
});

test('fechar a prévia não envia nem mantém a foto original', () => {
  const globals = installGlobals({getUserMedia: null, withPhotoPreview: true});
  try {
    const {form, elements} = createForm({withTarget: true});
    const captures = [];
    const cleanup = bindLabelCamera(form, {onCaptured: (file) => captures.push(file)});
    elements.get('#label-camera-open').click();
    const input = elements.get('#label-image-file');
    input.files = [new File(['raw'], 'raw.png', {type: 'image/png'})];
    input.dispatchEvent(new Event('change'));
    const staleOnload = globals.images[0].onload;
    elements.get('#label-camera-close').click();
    staleOnload();
    assert.equal(captures.length, 0);
    assert.equal(input.files.length, 0);
    assert.equal(elements.get('#label-camera-capture').disabled, true);
    assert.deepEqual(globals.revokedUrls, [globals.objectUrls[0].url]);
    cleanup();
  } finally {
    globals.restore();
  }
});

for (const invalidation of ['fechar', 'fundo', 'reabrir', 'desmontar', 'campo removido']) {
  test(`captura pendente não envia resultado antigo após ${invalidation}`, async () => {
    const streams = [];
    const globals = installGlobals({deferredBlob: true, getUserMedia: async () => {
      const stream = makeStream();
      streams.push(stream);
      return stream;
    }});
    try {
      const {form, elements} = createForm();
      const captures = [];
      const cleanup = bindLabelCamera(form, {onCaptured: (file) => captures.push(file)});
      await openCamera(elements);
      elements.get('#label-camera-capture').click();
      const pending = globals.canvases[0];
      if (invalidation === 'fechar') elements.get('#label-camera-close').click();
      if (invalidation === 'fundo') elements.get('#label-camera-dialog').click();
      if (invalidation === 'reabrir') await openCamera(elements);
      if (invalidation === 'desmontar') cleanup();
      if (invalidation === 'campo removido') elements.get('#label-image-file').isConnected = false;
      pending.resolveBlob();
      assert.equal(captures.length, 0);
      assert.equal(pending.width, 0);
      assert.equal(pending.height, 0);
      if (invalidation === 'reabrir') {
        assert.equal(streams[0].track.readyState, 'ended');
        assert.equal(streams[1].track.readyState, 'live');
        elements.get('#label-camera-capture').click();
        globals.canvases[1].resolveBlob();
        assert.equal(captures.length, 1);
      }
      cleanup();
      assert.ok(streams.every((stream) => stream.track.readyState === 'ended'));
    } finally {
      globals.restore();
    }
  });
}

test('toques repetidos aguardam a mesma captura e uma falha no JPEG permite tentar de novo', async () => {
  const globals = installGlobals({deferredBlob: true, getUserMedia: async () => makeStream()});
  try {
    const {form, elements} = createForm();
    const captures = [];
    const cleanup = bindLabelCamera(form, {onCaptured: (file) => captures.push(file)});
    await openCamera(elements);
    const capture = elements.get('#label-camera-capture');
    capture.click();
    capture.click();
    assert.equal(globals.canvases.length, 1);
    assert.equal(captures.length, 0);
    globals.canvases[0].resolveBlob(null);
    assert.equal(capture.disabled, false);
    capture.click();
    globals.canvases[1].resolveBlob();
    capture.click();
    assert.equal(captures.length, 1);
    assert.equal(globals.canvases.length, 2);
    cleanup();
  } finally {
    globals.restore();
  }
});

test('permissão de câmera tardia após desmontar libera todos os tracks', async () => {
  let resolveStream;
  const globals = installGlobals({getUserMedia: () => new Promise((resolve) => { resolveStream = resolve; })});
  try {
    const {form, elements} = createForm();
    const captures = [];
    const cleanup = bindLabelCamera(form, {onCaptured: (file) => captures.push(file)});
    elements.get('#label-camera-open').click();
    cleanup();
    const stream = makeStream();
    resolveStream(stream);
    await waitFor(() => stream.track.readyState === 'ended');
    assert.equal(captures.length, 0);
    assert.equal(elements.get('#label-camera-video').srcObject, null);
  } finally {
    globals.restore();
  }
});

test('evento close atrasado não encerra uma câmera já reaberta', async () => {
  const streams = [];
  const globals = installGlobals({getUserMedia: async () => {
    const stream = makeStream();
    streams.push(stream);
    return stream;
  }});
  try {
    const {form, elements} = createForm();
    const dialog = elements.get('#label-camera-dialog');
    const queuedEvents = [];
    dialog.close = () => {
      dialog.open = false;
      queuedEvents.push(() => dialog.dispatchEvent(new Event('close')));
    };
    const captures = [];
    const cleanup = bindLabelCamera(form, {onCaptured: (file) => captures.push(file)});
    await openCamera(elements);
    elements.get('#label-camera-close').click();
    await openCamera(elements);
    queuedEvents.shift()();
    assert.equal(dialog.open, true);
    assert.equal(streams[1].track.readyState, 'live');
    assert.equal(elements.get('#label-camera-capture').disabled, false);
    elements.get('#label-camera-capture').click();
    assert.equal(captures.length, 1);
    cleanup();
    assert.ok(streams.every((stream) => stream.track.readyState === 'ended'));
  } finally {
    globals.restore();
  }
});
