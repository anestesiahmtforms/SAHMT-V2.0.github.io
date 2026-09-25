import test from 'node:test';
import assert from 'node:assert/strict';
import {cropLabelImage} from '../src/label-ocr.js';

function withCanvas(callback) {
  const originalDocument = globalThis.document;
  let canvas;
  let drawArgs;
  globalThis.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      canvas = {
        width: 0,
        height: 0,
        getContext() {
          return {drawImage(...args) { drawArgs = args; }};
        }
      };
      return canvas;
    }
  };
  try { callback(() => ({canvas, drawArgs})); }
  finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
}

test('recorta pixels pela região normalizada da prévia', () => {
  withCanvas((getResult) => {
    const source = {width: 1000, height: 500};
    const result = cropLabelImage(source, {left: 0.1, top: 0.2, width: 0.4, height: 0.5});
    const {canvas, drawArgs} = getResult();
    assert.equal(result, canvas);
    assert.equal(canvas.width, 400);
    assert.equal(canvas.height, 250);
    assert.deepEqual(drawArgs, [source, 100, 100, 400, 250, 0, 0, 400, 250]);
  });
});

test('limita o recorte à borda da imagem e garante ao menos um pixel', () => {
  withCanvas((getResult) => {
    const source = {width: 1000, height: 500};
    cropLabelImage(source, {left: 0.9999, top: 0.9999, width: 1, height: 1});
    const {canvas, drawArgs} = getResult();
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
    assert.deepEqual(drawArgs.slice(1, 5), [999, 499, 1, 1]);
  });
});
