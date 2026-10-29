import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as model from '../src/html-training-model.js';
import {trainingCategories, trainingFolderLevel} from '../src/html-training-folders.js';
import {renderTrainingDocumentCard} from '../src/html-training-card.js';
import * as activity from '../src/html-training-activity.js';
import {randomUUID} from 'node:crypto';
import {installMaterialViewer} from '../src/material-viewer.js';
import {renderManagementDocumentCard} from '../src/management-document-folders.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function trainings({holdOpen = false, holdBegin = false, completed = false} = {}) {
  const listeners = new Map(), calls = [];
  const classes = new Set();
  const frame={srcdoc:'',addEventListener(){}};
  const root = {isConnected: true, innerHTML: '', classList: {add(...names) { names.forEach(name => classes.add(name)); }, remove(...names) { names.forEach(name => classes.delete(name)); }, toggle(name, force) { if(force) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); }}, setAttribute() {}, removeAttribute() {}, querySelector: selector => selector==='.ht-content-frame'?frame:null, querySelectorAll: () => [], contains: () => true,
    addEventListener: (key, value) => listeners.set(key, value), removeEventListener() {}, replaceChildren() { this.innerHTML = ''; }};
  const training = {id: 'one', title: 'Documento sintético', status: 'PUBLISHED', category: 'Protocolos', subcategory: 'Protocolos do SAHMT', version: 1, sectionCount: 1};
  let releaseOpen, releaseBegin;
  const api = async action => {
    calls.push(action);
    if (action === 'LIST') return {trainings: [structuredClone(training)]};
    if (action === 'OPEN') { if (holdOpen) await new Promise(resolve => { releaseOpen = resolve; }); return {training: structuredClone(training), state: {uid:'one',trainingId:'one',attempts: completed?[{trainingVersion:1,score:5,maxScore:5,suggestion:'Texto',completedAt:2,acknowledgedAt:1}]:[],run:completed?{stage:'COMPLETED',trainingVersion:1,readCount:1}:null}, questions: []}; }
    if (action === 'CONTENT') return {sections: [{id: 's', title: 'Seção', html: '<p>Texto</p>'}]};
    if (action === 'BEGIN') {if(holdBegin)await new Promise(resolve=>{releaseBegin=resolve;});return {state:{uid:'one',trainingId:'one',attempts:[],run:{id:'run-1',trainingVersion:1,stage:'READING',readCount:0}}};}
    throw Error(action);
  };
  const source = readFileSync(new URL('../src/html-training.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({...model, ...activity, crypto:{randomUUID}, h: model.escapeHtml, trainingCategories, trainingFolderLevel, renderTrainingDocumentCard, mountTrainingAudit() {}, root, api});
  vm.runInContext(source.replace(/^import[^\n]+\n/gm, '').replaceAll('export ', '').replaceAll('import.meta.env', '{}'), ctx);
  const controller = ctx.mountHtmlTrainings(root, {user: {uid: 'one'}, api});
  const click = (action, data = {}) => listeners.get('click')({target: {closest: () => ({dataset: {ht: action, ...data}})}});
  return {root, frame, controller, calls, click, training, releaseOpen: () => releaseOpen?.(),releaseBegin:()=>releaseBegin?.()};
}

test('the protected text is visible before a slow BEGIN completes, without another opening button',async t=>{
  const h=trainings({holdBegin:true});t.after(()=>h.controller());await tick();h.click('open',{id:'one'});await tick();await tick();
  assert.match(h.frame.srcdoc,/<p>Texto<\/p>/);
  assert.doesNotMatch(h.root.innerHTML,/Iniciar leitura|Prepare-se para começar/);
  assert.ok(h.root.innerHTML.indexOf('ht-content-frame')<h.root.innerHTML.indexOf('ht-summary'));
  assert.equal(h.calls.includes('SUBMIT'),false);h.releaseBegin();await tick();
  assert.match(h.root.innerHTML,/Li esta seção e desejo continuar/);
});

test('a completed document opens its text again without starting another attempt',async t=>{
  const h=trainings({completed:true});t.after(()=>h.controller());await tick();h.click('open',{id:'one'});await tick();await tick();
  assert.match(h.frame.srcdoc,/<p>Texto<\/p>/);assert.match(h.root.innerHTML,/Resultado registrado/);
  assert.equal(h.calls.includes('BEGIN'),false);assert.equal(h.calls.includes('SUBMIT'),false);
});

test('document back preserves its subfolder and traverses only one ancestor per tap', async t => {
  const h = trainings(); t.after(() => h.controller()); await tick();
  h.click('folder', {folder: JSON.stringify(['Protocolos'])}); await tick();
  h.click('folder', {folder: JSON.stringify(['Protocolos', 'Protocolos do SAHMT'])}); await tick();
  h.click('open', {id: 'one'}); await tick(); await tick();
  assert.match(h.root.innerHTML, /ht-content-frame/);
  assert.doesNotMatch(h.root.innerHTML, /Prepare-se para começar|Iniciar leitura/);
  assert.equal(typeof h.controller.goBack, 'function');
  assert.equal(h.controller.goBack(), true);
  await tick();
  assert.match(h.root.innerHTML, /<h2>PROTOCOLOS<\/h2>/);
  assert.match(h.root.innerHTML, /data-ht="open" data-id="one"/);
  assert.match(h.root.innerHTML, /Documento sintético/);
  assert.equal(h.controller.goBack(), true);
  assert.match(h.root.innerHTML, /<strong>Protocolos do SAHMT<\/strong>/);
  assert.doesNotMatch(h.root.innerHTML, /data-ht="open"/);
  assert.equal(h.controller.goBack(), true);
  assert.match(h.root.innerHTML, /<h2>Gestão de Documentos<\/h2>/);
  assert.equal(h.controller.goBack(), false);
  assert.deepEqual(h.calls.filter(action=>action!=='OPEN'), ['LIST', 'CONTENT', 'BEGIN', 'LIST']);
});

test('back cancels a stalled document open and ignores its late response', async t => {
  const h = trainings({holdOpen: true}); t.after(() => h.controller()); await tick();
  h.click('folder', {folder: '["Protocolos"]'}); await tick();
  h.click('open', {id: 'one'}); await tick();
  assert.equal(h.controller.goBack(), true);
  assert.equal(h.controller.goBack(), true);
  assert.match(h.root.innerHTML, /<h2>Gestão de Documentos<\/h2>/);
  h.releaseOpen(); await tick(); await tick();
  assert.doesNotMatch(h.root.innerHTML, /ht-content-frame/);
  assert.equal(h.calls.includes('BEGIN'), false);
});

test('returning to the same folder refreshes catalog metadata', async t => {
  const h = trainings(); t.after(() => h.controller()); await tick();
  h.click('folder', {folder: '["Protocolos","Protocolos do SAHMT"]'}); await tick();
  h.click('open', {id: 'one'}); await tick(); await tick();
  h.training.title = 'Título publicado atualizado';
  h.controller.goBack(); await tick();
  assert.match(h.root.innerHTML, /<h2>PROTOCOLOS<\/h2>/);
  assert.match(h.root.innerHTML, /data-ht="open" data-id="one"/);
  assert.match(h.root.innerHTML, /Título publicado atualizado/);
});

test('a disposed document controller cannot intercept the area back action', async () => {
  const h = trainings(); await tick(); h.click('folder', {folder: '["Protocolos"]'}); await tick(); h.controller();
  assert.equal(h.root.classList.contains('html-trainings'), false);
  assert.equal(h.root.classList.contains('ht-reading'), false);
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

