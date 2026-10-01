import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checklistQrCrop, createChecklistQrConfirmation, decodeQrImageData} from '../src/checklist-qr.js';

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
