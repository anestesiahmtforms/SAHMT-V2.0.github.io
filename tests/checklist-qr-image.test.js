import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {checklistQrCrop, createChecklistQrConfirmation, decodeQrImageData, findStationForQr} from '../src/checklist-qr.js';

test('QR diferente, leitura ambígua, três perdas e intervalo vencido reiniciam a confirmação', () => {
  let time = 0;
  const confirm = createChecklistQrConfirmation({now: () => time});
  assert.equal(confirm('A'), null);
  time = 100; assert.equal(confirm(null), null);
  time = 200; assert.equal(confirm(null), null);
  time = 300; assert.equal(confirm('A'), 'A');
  assert.equal(confirm('B'), null);
  assert.equal(confirm(null, {reset: true}), null);
  assert.equal(confirm('B'), null);
  assert.equal(confirm(null), null);
  assert.equal(confirm(null), null);
  assert.equal(confirm(null), null);
  assert.equal(confirm('B'), null);
  time += 1100;
  assert.equal(confirm('B'), null);
  assert.equal(confirm('B'), 'B');
});
test('etiqueta apagada recebe normalização de contraste antes de uma nova tentativa', () => {
  class RGBLuminanceSource { constructor(matrix) { this.matrix = matrix; } }
  class HybridBinarizer { constructor(source) { this.source = source; } }
  class BinaryBitmap { constructor(binarizer) { this.source = binarizer.source; } }
  class QRCodeReader {
    decode(bitmap) {
      if (bitmap.source.matrix[1] - bitmap.source.matrix[0] < 100) throw new Error('Low contrast');
      return {getText: () => '100170017'};
    }
  }
  const api = {RGBLuminanceSource, HybridBinarizer, BinaryBitmap, QRCodeReader};
  const data = new Uint8ClampedArray([120,120,120,255,140,140,140,255]);
  assert.equal(decodeQrImageData({width:2,height:1,data}, api), '100170017');
});


function fakeZXing(decodeResult = 'SAHMT:CHK:0001') {
  let luminanceSource;
  class RGBLuminanceSource {
    constructor(matrix, width, height) { luminanceSource = {matrix, width, height}; }
  }
  class HybridBinarizer { constructor(source) { this.source = source; } }
  class BinaryBitmap { constructor(binarizer) { this.binarizer = binarizer; } }
  class QRCodeReader { decode(bitmap) { if (!decodeResult) throw new Error('Not found'); assert.ok(bitmap instanceof BinaryBitmap); return {getText: () => decodeResult}; } }
  return {api: {RGBLuminanceSource, HybridBinarizer, BinaryBitmap, QRCodeReader}, getLuminance: () => luminanceSource};
}

test('decodifica imagem QR local convertendo RGBA em luminância', () => {
  const fake = fakeZXing();
  const result = decodeQrImageData({width: 2, height: 1, data: new Uint8ClampedArray([20, 40, 60, 255, 100, 120, 140, 255])}, fake.api);
  assert.equal(result, 'SAHMT:CHK:0001');
  assert.deepEqual({...fake.getLuminance(), matrix: [...fake.getLuminance().matrix]}, {width: 2, height: 1, matrix: [40, 120]});
});

test('imagem sem QR retorna null; estrutura ou decodificador inválidos mostram erro', () => {
  const fake = fakeZXing(null);
  assert.equal(decodeQrImageData({width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255])}, fake.api), null);
  assert.throws(() => decodeQrImageData({width: 1, height: 1, data: []}, fake.api), /não pôde ser processada/);
  assert.throws(() => decodeQrImageData({width: 1, height: 1, data: new Uint8ClampedArray(4)}, {}), /não está disponível/);
});

test('recorte acompanha a moldura visível em vídeo cover, não o quadro inteiro', () => {
  const videoRect = {left: 10, top: 20, width: 300, height: 300};
  assert.deepEqual(checklistQrCrop({videoWidth: 1920, videoHeight: 1080, videoRect,
    focusRect: {left: 70, top: 80, width: 180, height: 180}}), {x: 636, y: 216, width: 648, height: 648});
  assert.deepEqual(checklistQrCrop({videoWidth: 1080, videoHeight: 1920, videoRect,
    focusRect: {left: 70, top: 80, width: 180, height: 180}}), {x: 216, y: 636, width: 648, height: 648});
  assert.equal(checklistQrCrop({videoWidth: 0, videoHeight: 0, videoRect}), null);
});
test('leitura exige duas capturas iguais e tolera duas perdas breves sem contar como leitura', () => {
  const confirm = createChecklistQrConfirmation();
  assert.equal(confirm('100170017'), null);
  assert.equal(confirm('100170017'), '100170017');
  assert.equal(confirm('100170016'), null);
  assert.equal(confirm(null), null);
  assert.equal(confirm('100170016'), '100170016');
});

test('decodificador tenta contraste global quando a primeira leitura não encontra o QR', () => {
  let calls = 0;
  class RGBLuminanceSource { constructor(data, width, height) { this.width = width; this.height = height; } }
  class HybridBinarizer {}
  class GlobalHistogramBinarizer {}
  class BinaryBitmap { constructor(binarizer) { this.binarizer = binarizer; } }
  class QRCodeReader {
    decode(bitmap, hints) {
      calls++;
      assert.equal(hints.get(3), true);
      if (bitmap.binarizer instanceof HybridBinarizer) throw new Error('Not found');
      return {getText: () => '100170017'};
    }
  }
  const api = {RGBLuminanceSource, HybridBinarizer, GlobalHistogramBinarizer, BinaryBitmap, QRCodeReader, DecodeHintType: {TRY_HARDER: 3}};
  assert.equal(decodeQrImageData({width: 1, height: 1, data: new Uint8ClampedArray([120, 120, 120, 255])}, api), '100170017');
  assert.equal(calls, 2);
});
test('captura coincide com a janela de vídeo deslocada para o topo', () => {
  const rect = {left: 90, top: 108, width: 200, height: 200};
  assert.deepEqual(checklistQrCrop({videoWidth: 1920, videoHeight: 1080, videoRect: rect, focusRect: rect}),
    {x: 420, y: 0, width: 1080, height: 1080});
});


// Exercise the browser bundle shipped to the PWA, including its real binarizers.
const browserContext = vm.createContext({Uint8ClampedArray, Uint8Array, Int32Array, TextEncoder, TextDecoder, BigInt});
browserContext.window = browserContext;
vm.runInContext(readFileSync(new URL('../public/vendor/zxing.min.js', import.meta.url), 'utf8'), browserContext);
const realZXing = browserContext.ZXing;
const syntheticQrValue = 'SAHMT:CHK:TESTE-0001';

function syntheticQrImage({value = syntheticQrValue, scale = 10, dark = 0, light = 255, dotted = false, rotated = false} = {}) {
  const matrix = new realZXing.QRCodeWriter().encode(value, realZXing.BarcodeFormat.QR_CODE, 1, 1, new Map());
  const modules = matrix.getWidth();
  const width = modules * scale;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const imageX = rotated ? y : x;
      const imageY = rotated ? width - 1 - x : y;
      const moduleX = Math.floor(imageX / scale);
      const moduleY = Math.floor(imageY / scale);
      // Printed dotted labels retain solid finder patterns in their three corners.
      const finder = (moduleX < 11 && moduleY < 11)
        || (moduleX >= modules - 11 && moduleY < 11)
        || (moduleX < 11 && moduleY >= modules - 11);
      const dot = Math.hypot(imageX % scale + 0.5 - scale / 2, imageY % scale + 0.5 - scale / 2) <= scale * 0.45;
      const black = matrix.get(moduleX, moduleY) && (!dotted || finder || dot);
      const pixel = (y * width + x) * 4;
      data[pixel] = data[pixel + 1] = data[pixel + 2] = black ? dark : light;
      data[pixel + 3] = 255;
    }
  }
  return {width, height: width, data};
}

test('ZXing distribuído lê QR fictício quadrado e pontilhado com o decodificador real', () => {
  assert.equal(decodeQrImageData(syntheticQrImage(), realZXing), syntheticQrValue);
  assert.equal(decodeQrImageData(syntheticQrImage({dotted: true}), realZXing), syntheticQrValue);
});

test('ZXing real lê QR pontilhado apagado e rotacionado', () => {
  const faded = {dotted: true, dark: 120, light: 140};
  assert.equal(decodeQrImageData(syntheticQrImage(faded), realZXing), syntheticQrValue);
  assert.equal(decodeQrImageData(syntheticQrImage({...faded, rotated: true}), realZXing), syntheticQrValue);
});

test('QR que contém link é retornado como identificador da estação fictícia', () => {
  const value = 'https://example.invalid/arsenal/qr-ficticio';
  const station = {id: 'arsenal-ficticio', qrCode: value, active: true};
  const decoded = decodeQrImageData(syntheticQrImage({value}), realZXing);
  assert.equal(decoded, value);
  assert.equal(findStationForQr([station], decoded, '2026-10-01'), station);
});

test('ZXing real recusa imagem uniforme e QR recortado sem os padrões completos', () => {
  const uniform = {width: 160, height: 160, data: new Uint8ClampedArray(160 * 160 * 4).fill(255)};
  assert.equal(decodeQrImageData(uniform, realZXing), null);
  const original = syntheticQrImage();
  const width = Math.floor(original.width / 2);
  const data = new Uint8ClampedArray(width * original.height * 4);
  for (let y = 0; y < original.height; y++) {
    data.set(original.data.subarray(y * original.width * 4, (y * original.width + width) * 4), y * width * 4);
  }
  assert.equal(decodeQrImageData({width, height: original.height, data}, realZXing), null);
});

test('confirmação configurada para câmera lenta aceita duas capturas iguais após dois segundos', () => {
  let time = 0;
  const slow = createChecklistQrConfirmation({now: () => time, maxGapMs: 5000});
  const normal = createChecklistQrConfirmation({now: () => time});
  assert.equal(slow(syntheticQrValue), null);
  assert.equal(normal(syntheticQrValue), null);
  time = 2000;
  assert.equal(slow(syntheticQrValue), syntheticQrValue);
  assert.equal(normal(syntheticQrValue), null);
  time = 4000;
  assert.equal(normal(syntheticQrValue), null);
  time += 5001;
  assert.equal(slow(syntheticQrValue), null);
});
