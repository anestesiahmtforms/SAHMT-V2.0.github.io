import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const BASE = '/SAHMT-V2.0.github.io/';
const workerSource = readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const currentShellCache = /^const CACHE = '(sahmt-v2-shell-v\d+)';/m.exec(workerSource)?.[1];
assert.ok(currentShellCache, 'O service worker deve declarar uma versão válida do shell.');
const manifest = {
  'assets/main.js': {
    isEntry: true,
    file: 'assets/main.js',
    css: ['assets/main.css'],
    assets: ['assets/logo.svg'],
    imports: ['assets/shared.js']
  },
  'src/checklist-report-listener.js': {src: 'src/checklist-report-listener.js', file: 'assets/checklist-listener.js', imports: ['assets/shared.js'], dynamicImports: ['optional-pdf']},
  'src/firebase.js': {src: 'src/firebase.js', file: 'assets/firebase-full.js', imports: ['assets/shared.js']},
  'src/data.js': {src: 'src/data.js', file: 'assets/data.js', imports: ['src/firebase.js']},
  'node_modules/firebase/app-check/dist/esm/index.esm.js': {src: 'node_modules/firebase/app-check/dist/esm/index.esm.js', file: 'assets/app-check.js', imports: ['assets/shared.js']},
  'src/performance-ui.js': {src: 'src/performance-ui.js', file: 'assets/performance-ui.js', imports: ['assets/shared.js'], dynamicImports: ['optional-pdf']},
  'src/evaluation-data.js': {src: 'src/evaluation-data.js', file: 'assets/evaluation-data.js', imports: ['assets/shared.js']},
  'src/label-camera.js': {src: 'src/label-camera.js', file: 'assets/label-camera.js', imports: ['assets/shared.js']},
  'src/label-ai.js': {src: 'src/label-ai.js', file: 'assets/label-ai.js', imports: ['src/firebase-auth.js']},
  'src/firebase-auth.js': {src: 'src/firebase-auth.js', file: 'assets/firebase-auth.js', imports: ['assets/shared.js']},
  'optional-pdf': {file: 'assets/report-pdf.js', imports: []},
  'assets/shared.js': {
    file: 'assets/shared.js',
    css: ['assets/shared.css'],
    assets: [],
    imports: []
  }
};

function createWorker({offline = false, navigationOk = true} = {}) {
  const origin = 'https://sahmt.example';
  const normalizeUrl = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const handlers = new Map();
  const names = new Set(['sahmt-v2-shell-v200', 'sahmt-v2-offline-schedule-v1', 'unrelated-cache']);
  const entries = new Map();
  const cacheNames = [];
  const fetched = [];
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  let deletes = [];
  const manifestResponse = {json: async () => manifest};

  const cache = {
    async addAll(urls) {
      cacheNames.push(...urls);
      for (const url of urls) {
        const value = url.endsWith('assets-manifest.json') ? manifestResponse : {url};
        entries.set(normalizeUrl(url), value);
      }
    },
    async match(request) {
      return entries.get(normalizeUrl(request));
    },
    async put(url, response) {
      entries.set(normalizeUrl(url), response);
    }
  };

  const caches = {
    async open(name) {
      names.add(name);
      return cache;
    },
    async keys() {
      return [...names];
    },
    async delete(name) {
      deletes.push(name);
      names.delete(name);
      return true;
    },
    async match(request) {
      return cache.match(request);
    }
  };
  const self = {
    location: {origin},
    clients: {async claim() { claimCalls++; }},
    addEventListener(type, handler) { handlers.set(type, handler); },
    async skipWaiting() { skipWaitingCalls++; }
  };
  const fetch = async (request) => {
    if (offline && typeof request !== 'string') throw new Error('offline');
    fetched.push(request instanceof URL ? request.href : request);
    return {ok: request?.mode === 'navigate' ? navigationOk : true, type: 'basic', clone() { return this; }};
  };
  vm.runInNewContext(workerSource, {self, caches, URL, fetch, Promise, Set, Math});
  return {handlers, cacheNames, entries, fetched, names, deletes: () => deletes, skipWaiting: () => skipWaitingCalls, claim: () => claimCalls};
}

test('publica uma nova versão do shell ao trocar chunks do PWA', () => {
  assert.equal(currentShellCache, 'sahmt-v2-shell-v240');
});

test('only the same-origin repair entry activates an installed update without claiming windows',async()=>{
 const worker=createWorker();let operation;
 const send=(url,type='SAHMT_ACTIVATE_REPAIRED_APP')=>worker.handlers.get('message')({data:{type},source:{url},waitUntil:p=>{operation=p;}});
 send('https://other.example/SAHMT-V2.0.github.io/tools/refresh-app.html');
 send('https://sahmt.example/another-page');assert.equal(worker.skipWaiting(),0);
 send('https://sahmt.example/SAHMT-V2.0.github.io/tools/refresh-app.html');await operation;
 assert.equal(worker.skipWaiting(),1);assert.equal(worker.claim(),0);assert.deepEqual(worker.deletes(),[]);
});

test('instala o shell atual com os símbolos da Home e os imports estáticos do Vite', async () => {
  const worker = createWorker();
  let install;
  worker.handlers.get('install')({waitUntil(promise) { install = promise; }});
  await install;
  assert.ok(worker.names.has(currentShellCache));
  assert.ok(worker.cacheNames.includes(`${BASE}vendor/zxing.min.js`));

  assert.ok(worker.cacheNames.includes(`${BASE}assets/modules/operacional.jpg`));
  assert.ok(worker.cacheNames.includes(`${BASE}assets/modules/checklist.svg`));
  assert.ok(worker.cacheNames.includes(`${BASE}assets/sahmt-logo.png`));
  assert.ok(worker.cacheNames.includes(`${BASE}assets/selo-qga-accredited-qmentum-diamond.png`));
  assert.ok(worker.entries.has('https://sahmt.example/SAHMT-V2.0.github.io/assets/main.js'));
  assert.ok(worker.entries.has('https://sahmt.example/SAHMT-V2.0.github.io/assets/label-camera.js'));
  assert.ok(worker.entries.has('https://sahmt.example/SAHMT-V2.0.github.io/assets/label-ai.js'));
  assert.ok(worker.entries.has('https://sahmt.example/SAHMT-V2.0.github.io/assets/firebase-auth.js'));
  assert.ok(worker.entries.has('https://sahmt.example/SAHMT-V2.0.github.io/assets/shared.css'));
  assert.equal(worker.skipWaiting(), 0);
});

test('mantém os caches de férias e externos ao atualizar o shell', async () => {
  const worker = createWorker();
  let install;
  worker.handlers.get('install')({waitUntil(promise) { install = promise; }});
  await install;
  worker.names.add('sahmt-v2-shell-v159');
  let activation;
  worker.handlers.get('activate')({waitUntil(promise) { activation = promise; }});
  await activation;

  assert.deepEqual(worker.deletes(), ['sahmt-v2-shell-v159']);
  assert.ok(worker.names.has('sahmt-v2-shell-v200'));
  assert.ok(worker.names.has(currentShellCache));
  assert.ok(worker.names.has('sahmt-v2-offline-schedule-v1'));
  assert.ok(worker.names.has('unrelated-cache'));
  assert.equal(worker.claim(), 0);
});

test('serve o shell salvo quando a navegação ocorre sem rede', async () => {
  const worker = createWorker({offline: true});
  const indexUrl = `https://sahmt.example${BASE}index.html`;
  const savedIndex = {url: indexUrl};
  worker.entries.set(indexUrl, savedIndex);
  let response;
  worker.handlers.get('fetch')({
    request: {method: 'GET', mode: 'navigate', url: `https://sahmt.example${BASE}home`},
    respondWith(promise) { response = promise; }
  });

  assert.equal(await response, savedIndex);
  assert.equal(worker.fetched.length, 0);
});

test('deixa páginas auxiliares fora do cache do shell para não substituir o HTML offline', async () => {
  const worker = createWorker();
  let intercepted = false;
  worker.handlers.get('fetch')({
    request: {method: 'GET', mode: 'navigate', url: `https://sahmt.example${BASE}tools/catalog-review.html`},
    respondWith() { intercepted = true; }
  });

  assert.equal(intercepted, false);
  assert.equal(worker.fetched.length, 0);
});

test('erro HTTP da hospedagem também recupera o shell local já instalado', async () => {
  const worker = createWorker({navigationOk: false});
  const saved = {local: true}; worker.entries.set('https://sahmt.example' + BASE + 'index.html', saved);
  let response;
  worker.handlers.get('fetch')({request: {method: 'GET', mode: 'navigate', url: 'https://sahmt.example' + BASE}, respondWith(value) {response = value;}});
  assert.equal(await response, saved);
});

test('abertura usa primeiro o shell instalado mesmo com internet, sem aguardar a hospedagem', async () => {
  const worker = createWorker(), saved = {local: true};
  worker.entries.set('https://sahmt.example' + BASE, saved);
  let response;
  worker.handlers.get('fetch')({request: {method: 'GET', mode: 'navigate', url: 'https://sahmt.example' + BASE}, respondWith(value) {response = value;}});
  assert.equal(await response, saved); assert.equal(worker.fetched.length, 0);
});


test('precache report adapters from the build graph without PDF or all dynamic imports', async () => {
  const worker = createWorker(); let install;
  worker.handlers.get('install')({waitUntil(promise) {install = promise;}});
  await install;
  assert.ok(worker.entries.has('https://sahmt.example' + BASE + 'assets/checklist-listener.js'));
  assert.ok(worker.entries.has('https://sahmt.example' + BASE + 'assets/firebase-full.js'));
  assert.ok(worker.entries.has('https://sahmt.example' + BASE + 'assets/data.js'));
  assert.ok(worker.entries.has('https://sahmt.example' + BASE + 'assets/app-check.js'));
  assert.ok(!worker.entries.has('https://sahmt.example' + BASE + 'assets/report-pdf.js'));
  let response;
  worker.handlers.get('fetch')({request: {method: 'GET', mode: 'cors', url: 'https://sahmt.example' + BASE + 'assets/checklist-listener.js'}, respondWith(promise) {response = promise;}});
  assert.ok(await response);
});

test('Desempenho abre offline com adaptadores leves, sem pré-cache de PDF/material', async () => {
  const worker=createWorker();let install;worker.handlers.get('install')({waitUntil(value){install=value;}});await install;
  assert.ok(worker.entries.has('https://sahmt.example/SAHMT-V2.0.github.io/assets/performance-ui.js'));
  assert.ok(worker.entries.has('https://sahmt.example/SAHMT-V2.0.github.io/assets/evaluation-data.js'));
  assert.equal(worker.entries.has('https://sahmt.example/SAHMT-V2.0.github.io/assets/report-pdf.js'),false);
});


test('demonstração não pode substituir o HTML offline da produção',()=>{
 const worker=createWorker();let intercepted=false;
 worker.handlers.get('fetch')({request:{method:'GET',mode:'navigate',url:`https://sahmt.example${BASE}demo.html`},respondWith(){intercepted=true;}});
 assert.equal(intercepted,false);
});
