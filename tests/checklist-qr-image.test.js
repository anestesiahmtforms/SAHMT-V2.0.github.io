import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeQrImageData} from '../src/checklist-qr.js';

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
