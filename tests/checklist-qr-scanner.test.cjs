const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../src/main.js'), 'utf8');
const qrHelpers = readFileSync(join(__dirname, '../src/checklist-qr.js'), 'utf8').replaceAll('export ', '');
function extract(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Trecho de produção ausente: ${start}`);
  return source.slice(first, last);
}
const loaderSource = extract('function loadQrDecoder(', 'function loginView(').replaceAll('import.meta.env.BASE_URL', "'/SAHMTV2/'");
const scannerSource = extract('async function openChecklistQrScanner(', 'async function loadMonthlyChecklist(');
const day = '2026-10-01';
const station = {id: 'arsenal-ficticio', qrCode: 'SAHMT:CHK:FICTICIO', active: true};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
const drain = async () => {for (let index = 0; index < 10; index++) await Promise.resolve();};
const decoderApi = () => ({BinaryBitmap: class {}, HybridBinarizer: class {}, RGBLuminanceSource: class {}, QRCodeReader: class {}});

class Element {
  constructor() {this.listeners = new Map(); this.hidden = false; this.textContent = ''; this.isConnected = true;}
  addEventListener(name, listener, options = {}) {
    const listeners = this.listeners.get(name) || new Map(); listeners.set(listener, options); this.listeners.set(name, listeners);
  }
  removeEventListener(name, listener) {this.listeners.get(name)?.delete(listener);}
  fire(name) {
    for (const [listener, options] of [...(this.listeners.get(name) || [])]) {
      if (options.once) this.removeEventListener(name, listener);
      listener({type: name, target: this});
    }
  }
  focus() {}
  getBoundingClientRect() {return {left: 40, top: 80, width: 200, height: 200};}
}

function harness({decoder = true, nativeDetect, capabilities} = {}) {
  let nextId = 0;
  const timers = new Map(), frames = new Map(), closeEvents = [], scripts = [], streams = [], reveals = [], draws = [], decoded = [];
  const mediaQueue = [], playQueue = [], decodeValues = [];
  const setTimeout = (callback, delay) => {const id = ++nextId; timers.set(id, {callback, delay}); return id;};
  const clearTimeout = id => timers.delete(id);
  const requestAnimationFrame = callback => {const id = ++nextId; frames.set(id, callback); return id;};
  const cancelAnimationFrame = id => frames.delete(id);
  const dialog = new Element(); dialog.open = false;
  dialog.showModal = () => {dialog.open = true;};
  // close is a queued browser event: it dispatches the listeners present when the event runs.
  dialog.close = () => {if (dialog.open) {dialog.open = false; closeEvents.push(() => dialog.fire('close'));}};
  const video = new Element(), focus = new Element(), status = new Element(), close = new Element();
  status.hidden = true; video.hidden = true; focus.hidden = true;
  Object.assign(video, {videoWidth: 1080, videoHeight: 1920, readyState: 4, srcObject: null, paused: true, pauseCount: 0});
  video.play = () => {video.paused = false; return playQueue.length ? playQueue.shift() : Promise.resolve();};
  video.pause = () => {video.paused = true; video.pauseCount++;};
  const nodes = {'#checklist-qr-dialog': dialog, '#checklist-qr-video': video, '#checklist-qr-focus': focus, '#checklist-qr-status': status, '#checklist-qr-close': close};
  const createStream = () => {
    const track = {stopped: false, stopCount: 0, stop() {this.stopped = true; this.stopCount++;},
      getCapabilities: capabilities || (() => ({})), applyConstraints: async () => {}};
    const stream = {track, getTracks: () => [track], getVideoTracks: () => [track]};
    streams.push(stream); return stream;
  };
  const document = {
    querySelector: selector => nodes[selector] || null,
    createElement: tag => {
      if (tag === 'script') {const script = {removed: false, remove() {this.removed = true;}}; return script;}
      assert.equal(tag, 'canvas');
      const canvas = {width: 0, height: 0};
      canvas.getContext = () => ({drawImage: (...args) => draws.push(args), getImageData: () => ({width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(canvas.width * canvas.height * 4)})});
      return canvas;
    },
    head: {append: script => scripts.push(script)}
  };
  const window = {setTimeout, clearTimeout};
  if (decoder) window.ZXing = decoderApi();
  if (nativeDetect) window.BarcodeDetector = class {detect(canvas) {return nativeDetect(canvas);}};
  const context = {document, window, navigator: {mediaDevices: {getUserMedia: () => mediaQueue.length ? mediaQueue.shift() : Promise.resolve(createStream())}},
    setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame, console,
    session: {status: 'signed-in', user: {uid: 'checker-A'}, profile: {permissions: {checklistWrite: true, checklistManage: false}}},
    route: 'checklist', today: day, currentRoute: () => context.route, todayInputValue: () => context.today,
    can: permission => context.session.profile.permissions[permission] === true,
    revealChecklistStation: (...args) => reveals.push(args)};
  vm.createContext(context);
  vm.runInContext(`let stopChecklistQrScan = null; let qrDecoderPromise = null;\n${qrHelpers}\n${loaderSource}\n${scannerSource}`, context);
  context.decodeQrImageData = image => {decoded.push(image); return decodeValues.length ? decodeValues.shift() : null;};
  const fireTimer = delay => {
    const item = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(item, `Timeout esperado de ${delay} ms`); timers.delete(item[0]); return item[1].callback();
  };
  const nextFrame = () => {
    const item = frames.entries().next().value;
    assert.ok(item, 'Quadro de leitura esperado'); frames.delete(item[0]); return item[1]();
  };
  return {context, nodes, dialog, video, focus, status, close, streams, scripts, reveals, draws, decoded, timers, frames,
    mediaQueue, playQueue, decodeValues, createStream, fireTimer, nextFrame,
    open: () => context.openChecklistQrScanner([station], day), stop: () => context.stopChecklistQrScanner(),
    flushClose: () => {while (closeEvents.length) closeEvents.shift()();},
    nextScan: async () => {fireTimer(100); await nextFrame();},
    decoderPromise: () => vm.runInContext('qrDecoderPromise', context)};
}

test('close enfileirado da sessão anterior não encerra câmera nova; Voltar encerra a atual', async () => {
  const h = harness(); await h.open(); const first = h.video.srcObject;
  await h.open(); const second = h.video.srcObject;
  assert.notEqual(second, first); assert.equal(first.track.stopped, true);
  h.flushClose();
  assert.equal(h.dialog.open, true); assert.equal(h.video.srcObject, second); assert.equal(second.track.stopped, false);
  h.dialog.close(); h.flushClose();
  assert.equal(second.track.stopped, true); assert.equal(h.video.srcObject, null); assert.equal(h.frames.size, 0);
});

test('fechar durante getUserMedia descarta a câmera recebida tarde', async () => {
  const h = harness(), gate = deferred(), stream = h.createStream(); h.mediaQueue.push(gate.promise);
  const opening = h.open(); await drain(); h.stop(); gate.resolve(stream); await opening;
  assert.equal(stream.track.stopped, true); assert.equal(h.video.srcObject, null); assert.equal(h.frames.size, 0);
});

test('erro tardio de play da sessão A não apaga vídeo, status ou cleanup da sessão B', async () => {
  const h = harness(), gate = deferred(); h.playQueue.push(gate.promise);
  const firstOpening = h.open(); await drain();
  await h.open(); const second = h.video.srcObject, status = h.status.textContent;
  gate.reject(new Error('play antigo interrompido')); await firstOpening;
  assert.equal(h.video.srcObject, second); assert.equal(second.track.stopped, false); assert.equal(h.status.textContent, status);
  h.flushClose(); assert.equal(second.track.stopped, false);
  h.stop(); assert.equal(second.track.stopped, true);
});

test('fechar enquanto play aguarda não reinicia o scanner ao concluir play', async () => {
  const h = harness(), gate = deferred(); h.playQueue.push(gate.promise);
  const opening = h.open(); await drain(); const stream = h.video.srcObject;
  h.stop(); gate.resolve(); await opening;
  assert.equal(stream.track.stopped, true); assert.equal(h.video.srcObject, null); assert.equal(h.frames.size, 0);
});

test('erro tardio do decoder da sessão A não interfere na sessão B', async () => {
  const h = harness({decoder: false}), gate = deferred(); let loads = 0;
  h.context.loadQrDecoder = () => ++loads === 1 ? gate.promise : Promise.resolve();
  const firstOpening = h.open(); await drain();
  h.context.window.ZXing = decoderApi(); await h.open(); const second = h.video.srcObject, status = h.status.textContent;
  gate.reject(new Error('decoder antigo indisponível')); await firstOpening;
  assert.equal(h.video.srcObject, second); assert.equal(second.track.stopped, false); assert.equal(h.status.textContent, status);
  h.stop(); assert.equal(second.track.stopped, true);
});

test('dimensões com apenas metadata não são capturadas; quadro pronto é desenhado e decodificado', async () => {
  const h = harness(); h.decodeValues.push(station.qrCode); h.video.readyState = 1; await h.open(); await h.nextFrame();
  assert.equal(h.draws.length, 0); assert.equal(h.decoded.length, 0); assert.equal(h.reveals.length, 0);
  h.video.readyState = 2; await h.nextScan();
  assert.equal(h.draws.length, 1); assert.equal(h.decoded.length, 1); h.stop();
});

test('exceção em getCapabilities não impede a leitura de câmera', async () => {
  const h = harness({capabilities: () => {throw new Error('Autofoco não disponível');}}); h.decodeValues.push(station.qrCode); await h.open();
  assert.equal(h.streams[0].track.stopped, false); await h.nextFrame(); assert.equal(h.decoded.length, 1); h.stop();
});

test('fechar durante applyConstraints não reinicia a leitura nem muda status ao concluir autofocus', async () => {
  const h = harness({capabilities: () => ({focusMode: ['continuous']})}), gate = deferred(), stream = h.createStream();
  stream.track.applyConstraints = () => gate.promise; h.mediaQueue.push(Promise.resolve(stream));
  const opening = h.open(); await drain(); h.stop(); h.status.textContent = 'Leitor encerrado'; gate.resolve(); await opening;
  assert.equal(stream.track.stopped, true); assert.equal(h.video.srcObject, null); assert.equal(h.frames.size, 0);
  assert.equal(h.status.textContent, 'Leitor encerrado');
});

test('permissão negada mostra diagnóstico e Voltar fecha o modal de erro', async () => {
  const h = harness(); h.mediaQueue.push(Promise.reject(Object.assign(new Error('Denied'), {name: 'NotAllowedError'})));
  await h.open();
  assert.equal(h.status.hidden, false); assert.match(h.status.textContent, /permissão|autorize/i); assert.equal(h.frames.size, 0);
  h.close.onclick(); assert.equal(h.dialog.open, false); h.flushClose();
});

test('navegador sem getUserMedia mostra diagnóstico e permite fechar o modal', async () => {
  const h = harness(); h.context.navigator.mediaDevices = undefined; await h.open();
  assert.equal(h.status.hidden, false); assert.match(h.status.textContent, /HTTPS|permissão/i); assert.equal(h.streams.length, 0);
  h.close.onclick(); assert.equal(h.dialog.open, false); h.flushClose();
});

test('duas leituras válidas entregam a estação ao banner e encerram a câmera', async () => {
  const h = harness(); h.decodeValues.push(station.qrCode, station.qrCode); await h.open();
  await h.nextFrame(); assert.equal(h.reveals.length, 0);
  await h.nextScan();
  assert.equal(h.reveals.length, 1); assert.equal(h.reveals[0][0], station); assert.equal(h.reveals[0][1], day);
  assert.equal(h.reveals[0][2][0], station); assert.equal(h.dialog.open, false); assert.equal(h.streams[0].track.stopped, true);
});

test('QR fora do catálogo não confirma a estação nem bloqueia tentativas seguintes', async () => {
  const h = harness(); h.decodeValues.push('QR-desconhecido', station.qrCode, station.qrCode); await h.open();
  await h.nextFrame(); assert.equal(h.reveals.length, 0);
  await h.nextScan(); assert.equal(h.reveals.length, 0);
  await h.nextScan(); assert.equal(h.reveals.length, 1);
});

test('falha do BarcodeDetector ativa decoder de fallback para o mesmo recorte', async () => {
  let nativeCalls = 0;
  const h = harness({nativeDetect: async () => {nativeCalls++; throw new Error('Detector nativo indisponível');}});
  h.decodeValues.push(station.qrCode, station.qrCode); await h.open(); await h.nextFrame(); await h.nextScan();
  assert.equal(nativeCalls, 1); assert.equal(h.decoded.length, 2); assert.equal(h.reveals.length, 1);
});

test('leitura nativa pendente não confirma após trocar UID, permissão, rota, dia ou DOM', async t => {
  const changes = {
    UID: h => {h.context.session.user = {uid: 'checker-B'};},
    permissão: h => {h.context.session.profile.permissions.checklistWrite = false;},
    rota: h => {h.context.route = 'home';},
    dia: h => {h.context.today = '2026-10-02';},
    DOM: h => {h.nodes['#checklist-qr-dialog'] = new Element();}
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const gate = deferred(); let nativeCalls = 0;
    const h = harness({nativeDetect: () => ++nativeCalls === 1 ? Promise.resolve([{rawValue: station.qrCode}]) : gate.promise});
    await h.open(); await h.nextFrame(); h.fireTimer(100); const reading = h.nextFrame(); await drain();
    change(h); h.status.textContent = 'Estado da interface atual'; gate.resolve([{rawValue: station.qrCode}]); await reading;
    assert.equal(h.reveals.length, 0); assert.equal(h.status.textContent, 'Estado da interface atual'); assert.equal(h.frames.size, 0);
    assert.equal([...h.timers.values()].some(timer => timer.delay === 100), false); h.stop();
  });
});

test('vários QRs nativos na moldura não entregam uma estação nem usam fallback de um QR', async () => {
  const h = harness({nativeDetect: async () => [{rawValue: station.qrCode}, {rawValue: 'QR-OUTRO'}]});
  h.decodeValues.push(station.qrCode); await h.open(); await h.nextFrame(); await h.nextScan();
  assert.equal(h.reveals.length, 0); assert.equal(h.decoded.length, 0); h.stop();
});

test('loader reutiliza uma única carga e rejeita onload sem APIs ZXing antes de permitir retry', async () => {
  const h = harness({decoder: false}), first = h.context.loadQrDecoder();
  assert.equal(h.context.loadQrDecoder(), first); assert.equal(h.scripts.length, 1); assert.equal(h.scripts[0].src, '/SAHMTV2/vendor/zxing.min.js');
  const rejected = assert.rejects(first, /leitor QR|decodificador|disponível|carregar/i); h.scripts[0].onload(); await rejected;
  assert.equal(h.scripts[0].removed, true);
  const retry = h.context.loadQrDecoder(); assert.notEqual(retry, first); assert.equal(h.scripts.length, 2);
  h.context.window.ZXing = decoderApi(); h.scripts[1].onload(); await retry;
});

test('loader rejeita API ZXing incompleta em vez de iniciar leitor silencioso', async () => {
  const h = harness({decoder: false}), opening = h.context.loadQrDecoder();
  h.context.window.ZXing = {QRCodeReader: class {}};
  const rejected = assert.rejects(opening, /leitor QR|decodificador|disponível|carregar/i); h.scripts[0].onload(); await rejected;
});

test('erro de carga remove script e callback antigo não apaga a Promise do retry', async () => {
  const h = harness({decoder: false}), first = h.context.loadQrDecoder(), oldError = h.scripts[0].onerror;
  const rejected = assert.rejects(first, /carregar|leitor QR/i); oldError(); await rejected;
  assert.equal(h.scripts[0].removed, true);
  const retry = h.context.loadQrDecoder(); oldError();
  assert.equal(h.decoderPromise(), retry); assert.equal(h.context.loadQrDecoder(), retry);
  h.context.window.ZXing = decoderApi(); h.scripts[1].onload(); await retry;
});

test('carga travada vence em 10 segundos; onload tardio não interfere no retry', async () => {
  const h = harness({decoder: false}), first = h.context.loadQrDecoder(), oldLoad = h.scripts[0].onload;
  assert.equal([...h.timers.values()].some(timer => timer.delay === 10000), true);
  const rejected = assert.rejects(first, /carregar|leitor QR|tempo|demor/i); h.fireTimer(10000); await rejected;
  assert.equal(h.scripts[0].removed, true);
  const retry = h.context.loadQrDecoder(); oldLoad(); assert.equal(h.decoderPromise(), retry);
  h.context.window.ZXing = decoderApi(); h.scripts[1].onload(); await retry;
  assert.equal(h.timers.size, 0);
});

test('scanner confirma duas capturas iguais em aparelho que demora dois segundos por leitura', async () => {
  const h = harness(); let time = 0;
  h.context.Date = {now: () => time};
  h.decodeValues.push(station.qrCode, station.qrCode); await h.open();
  await h.nextFrame(); assert.equal(h.reveals.length, 0);
  time = 2000; await h.nextScan();
  assert.equal(h.reveals.length, 1); assert.equal(h.streams[0].track.stopped, true);
});

test('leitura rápida usa 640px e preserva tentativa de 1280px quando o QR exige resolução maior', async () => {
  const h = harness(); h.video.videoWidth = h.video.videoHeight = 1920;
  h.decodeValues.push(null, station.qrCode, null, station.qrCode); await h.open();
  await h.nextFrame();
  assert.deepEqual(h.decoded.map(image => image.width), [640, 1280]);
  assert.equal(h.reveals.length, 0);
  await h.nextScan();
  assert.deepEqual(h.decoded.map(image => image.width), [640, 1280, 640, 1280]);
  assert.equal(h.reveals.length, 1);
});

test('autofoco que não conclui permanece opcional e não impede decodificar o QR', async () => {
  const h = harness({capabilities: () => ({focusMode: ['continuous']})}), stream = h.createStream();
  stream.track.applyConstraints = () => new Promise(() => {}); h.mediaQueue.push(Promise.resolve(stream));
  h.decodeValues.push(station.qrCode, station.qrCode); await h.open();
  await h.nextFrame(); await h.nextScan();
  assert.equal(h.reveals.length, 1); assert.equal(stream.track.stopped, true);
});
