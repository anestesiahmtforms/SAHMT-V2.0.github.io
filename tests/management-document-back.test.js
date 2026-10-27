import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as model from '../src/html-training-model.js';
import {trainingCategories, trainingFolderLevel} from '../src/html-training-folders.js';
import {installMaterialViewer} from '../src/material-viewer.js';
import {renderManagementDocumentCard} from '../src/management-document-folders.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function trainings({holdOpen = false} = {}) {
  const listeners = new Map(), calls = [];
  const root = {isConnected: true, innerHTML: '', classList: {add() {}}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], contains: () => true,
    addEventListener: (key, value) => listeners.set(key, value), removeEventListener() {}, replaceChildren() { this.innerHTML = ''; }};
  const training = {id: 'one', title: 'Documento sintético', status: 'PUBLISHED', category: 'Protocolos', subcategory: 'Protocolos do SAHMT', version: 1, sectionCount: 1};
  let releaseOpen;
  const api = async action => {
    calls.push(action);
    if (action === 'LIST') return {trainings: [structuredClone(training)]};
    if (action === 'OPEN') { if (holdOpen) await new Promise(resolve => { releaseOpen = resolve; }); return {training: structuredClone(training), state: {attempts: []}, questions: []}; }
    if (action === 'CONTENT') return {sections: [{id: 's', title: 'Seção', html: '<p>Texto</p>'}]};
    throw Error(action);
  };
  const source = readFileSync(new URL('../src/html-training.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({...model, h: model.escapeHtml, trainingCategories, trainingFolderLevel, mountTrainingAudit() {}, root, api});
  vm.runInContext(source.replace(/^import[^\n]+\n/gm, '').replaceAll('export ', '').replaceAll('import.meta.env', '{}'), ctx);
  const controller = ctx.mountHtmlTrainings(root, {user: {uid: 'one'}, api});
  const click = (action, data = {}) => listeners.get('click')({target: {closest: () => ({dataset: {ht: action, ...data}})}});
  return {root, controller, calls, click, training, releaseOpen: () => releaseOpen?.()};
}

test('document back preserves its subfolder and traverses only one ancestor per tap', async t => {
  const h = trainings(); t.after(() => h.controller()); await tick();
  h.click('folder', {folder: JSON.stringify(['Protocolos'])}); await tick();
  h.click('folder', {folder: JSON.stringify(['Protocolos', 'Protocolos do SAHMT'])}); await tick();
  h.click('open', {id: 'one'}); await tick(); await tick();
  assert.match(h.root.innerHTML, /Prepare-se para começar/);
  assert.equal(typeof h.controller.goBack, 'function');
  assert.equal(h.controller.goBack(), true);
  await tick();
  assert.match(h.root.innerHTML, /aria-current="page">Protocolos do SAHMT/);
  assert.match(h.root.innerHTML, /Documento sintético/);
  assert.equal(h.controller.goBack(), true);
  assert.match(h.root.innerHTML, /aria-current="page">Protocolos<\/span>/);
  assert.equal(h.controller.goBack(), true);
  assert.doesNotMatch(h.root.innerHTML, /aria-current="page"/);
  assert.equal(h.controller.goBack(), false);
  assert.deepEqual(h.calls, ['LIST', 'OPEN', 'CONTENT', 'LIST']);
});

test('back cancels a stalled document open and ignores its late response', async t => {
  const h = trainings({holdOpen: true}); t.after(() => h.controller()); await tick();
  h.click('folder', {folder: '["Protocolos"]'}); await tick();
  h.click('open', {id: 'one'}); await tick();
  assert.equal(h.controller.goBack(), true);
  assert.equal(h.controller.goBack(), true);
  assert.doesNotMatch(h.root.innerHTML, /aria-current="page"/);
  h.releaseOpen(); await tick(); await tick();
  assert.doesNotMatch(h.root.innerHTML, /Prepare-se para começar/);
  assert.equal(h.calls.includes('CONTENT'), false);
});

test('returning to the same folder refreshes catalog metadata', async t => {
  const h = trainings(); t.after(() => h.controller()); await tick();
  h.click('folder', {folder: '["Protocolos","Protocolos do SAHMT"]'}); await tick();
  h.click('open', {id: 'one'}); await tick(); await tick();
  h.training.title = 'Título publicado atualizado';
  h.controller.goBack(); await tick();
  assert.match(h.root.innerHTML, /aria-current="page">Protocolos do SAHMT/);
  assert.match(h.root.innerHTML, /Título publicado atualizado/);
});

test('a disposed document controller cannot intercept the area back action', async () => {
  const h = trainings(); await tick(); h.click('folder', {folder: '["Protocolos"]'}); await tick(); h.controller();
  assert.equal(typeof h.controller.goBack, 'function');
  assert.equal(h.controller.goBack(), false);
});

test('management document triggers identify their own return context', () => {
  const html = renderManagementDocumentCard({id: 'one', title: 'Documento', category: 'Protocolos', driveUrl: 'https://drive.google.com/file/d/Document_123456789/view'});
  assert.match(html, /data-material-return="management"/);
});

test('shared viewer returns to the same management document and resets its label for other modules', t => {
  const previousDocument = globalThis.document;
  const events = new Map(), frame = {}, back = {textContent: 'FECHAR'};
  let focus = 0;
  const dialog = {open: false, setAttribute() {}, querySelector: selector => selector === 'iframe' ? frame : back,
    addEventListener: (name, callback) => events.set(name, callback), removeEventListener() {},
    showModal() { this.open = true; }, close() { this.open = false; events.get('close')?.(); }, remove() {}};
  const doc = {body: {append() {}}, getElementById: () => null, createElement: () => dialog,
    addEventListener: (name, callback) => events.set('root-' + name, callback), removeEventListener() {}};
  globalThis.document = doc;
  const dispose = installMaterialViewer(doc);
  t.after(() => { dispose(); globalThis.document = previousDocument; });
  const trigger = {isConnected: true, dataset: {materialUrl: 'https://drive.google.com/file/d/Document_123456789/view', materialReturn: 'management'}, focus: () => focus++};
  const open = () => events.get('root-click')({target: {closest: selector => selector === '[data-open-material-viewer]' ? trigger : null}});
  open(); assert.equal(back.textContent, 'VOLTAR');
  events.get('root-click')({target: {closest: selector => selector === '[data-material-viewer-close]' ? back : null}});
  assert.equal(dialog.open, false); assert.equal(frame.src, 'about:blank'); assert.equal(focus, 1);
  delete trigger.dataset.materialReturn; open(); assert.equal(back.textContent, 'FECHAR');
});
