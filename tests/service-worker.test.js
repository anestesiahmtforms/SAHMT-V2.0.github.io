import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const BASE = '/SAHMT-V2.0.github.io/';
const workerSource = readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const manifest = {
  'assets/main.js': {
    isEntry: true,
    file: 'assets/main.js',
    css: ['assets/main.css'],
    assets: ['assets/logo.svg'],
    imports: ['assets/shared.js'],
    dynamicImports: ['src/data.js', 'src/report-pdf.js']
  },
  'assets/shared.js': {
    file: 'assets/shared.js',
    css: ['assets/shared.css'],
    assets: [],
    imports: []
  },
  'src/data.js': {
    file: 'assets/data.js',
    imports: ['assets/firestore.js'],
    dynamicImports: ['src/checklist-signature.js']
  },
  'assets/firestore.js': {file: 'assets/firestore.js', imports: []},
  'src/report-pdf.js': {file: 'assets/report-pdf.js', imports: []},
  'src/checklist-signature.js': {file: 'assets/checklist-signature.js', imports: []}
};

function createWorker({offline = false} = {}) {
  const origin = 'https://sahmt.example';
  const normalizeUrl = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const handlers = new Map();
  const names = new Set(['sahmt-v2-shell-v20', 'sahmt-v2-shell-v97', 'sahmt-v2-shell-v98', 'sahmt-v2-shell-v99', 'sahmt-v2-shell-v100', 'sahmt-v2-offline-schedule-v1', 'unrelated-cache']);
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
    return {ok: true, type: 'basic', source: 'network', clone() { return this; }};
  };
  vm.runInNewContext(workerSource, {self, caches, URL, fetch, Promise, Set, Math});
  return {handlers, cacheNames, entries, fetched, names, deletes: () => deletes, skipWaiting: () => skipWaitingCalls, claim: () => claimCalls};
}

test('instala shell V101 com imports estáticos e módulos offline selecionados do manifest Vite', async () => {
  assert.match(workerSource, /const CACHE = 'sahmt-v2-shell-v101';/);
  const worker = createWorker();
  let install;
  worker.handlers.get('install')({waitUntil(promise) { install = promise; }});
  await install;

  for (const asset of [
    'assets/modules/operacional.jpg',
    'assets/modules/checklist.svg',
    'assets/sahmt-logo.png',
    'assets/selo-qga-accredited-qmentum-diamond.png',
    'assets/main.js',
    'assets/shared.css',
    'assets/data.js',
    'assets/firestore.js'
  ]) assert.ok(worker.entries.has(`https://sahmt.example${BASE}${asset}`), `${asset} deve estar no cache offline`);
  assert.ok(!worker.entries.has(`https://sahmt.example${BASE}assets/report-pdf.js`));
  assert.ok(!worker.entries.has(`https://sahmt.example${BASE}assets/checklist-signature.js`));
  assert.equal(worker.skipWaiting(), 1);
});

test('mantém o shell anterior para abas antigas e preserva os caches da fila offline', async () => {
  const worker = createWorker();
  const oldAssetUrl = `https://sahmt.example${BASE}assets/old-main.js`;
  const oldAsset = {url: oldAssetUrl, source: 'shell-v100'};
  worker.entries.set(oldAssetUrl, oldAsset);
  let activation;
  worker.handlers.get('activate')({waitUntil(promise) { activation = promise; }});
  await activation;

  assert.deepEqual(worker.deletes(), ['sahmt-v2-shell-v20', 'sahmt-v2-shell-v97', 'sahmt-v2-shell-v98', 'sahmt-v2-shell-v99']);
  assert.ok(worker.names.has('sahmt-v2-shell-v100'));
  assert.ok(worker.names.has('sahmt-v2-offline-schedule-v1'));
  assert.ok(worker.names.has('unrelated-cache'));
  assert.equal(worker.claim(), 1);
  let response;
  worker.handlers.get('fetch')({
    request: {method: 'GET', mode: 'cors', url: oldAssetUrl, cache: 'default'},
    respondWith(promise) { response = promise; }
  });
  assert.strictEqual(await response, oldAsset);
});

test('serve shell salvo quando a navegação ocorre sem rede', async () => {
  const worker = createWorker({offline: true});
  const indexUrl = `https://sahmt.example${BASE}index.html`;
  const savedIndex = {url: indexUrl};
  worker.entries.set(indexUrl, savedIndex);
  let response;
  worker.handlers.get('fetch')({
    request: {method: 'GET', mode: 'navigate', url: `https://sahmt.example${BASE}home`, cache: 'default'},
    respondWith(promise) { response = promise; }
  });
  assert.strictEqual(await response, savedIndex);
  assert.equal(worker.fetched.length, 0);
});

test('requisição reload da mesma URL ignora a cópia antiga e busca imagem atualizada', async () => {
  const worker = createWorker();
  const url = `https://sahmt.example${BASE}assets/modules/operacional.jpg`;
  const previous = {source: 'old-image'};
  worker.entries.set(url, previous);
  let response;
  worker.handlers.get('fetch')({
    request: {method: 'GET', mode: 'cors', url, cache: 'reload'},
    respondWith(promise) { response = promise; }
  });
  const refreshed = await response;
  assert.equal(refreshed.source, 'network');
  assert.notStrictEqual(refreshed, previous);
  assert.equal(worker.fetched.at(-1).cache, 'reload');
});

test('páginas auxiliares ficam fora do cache do shell', async () => {
  const worker = createWorker();
  let intercepted = false;
  worker.handlers.get('fetch')({
    request: {method: 'GET', mode: 'navigate', url: `https://sahmt.example${BASE}tools/catalog-review.html`, cache: 'default'},
    respondWith() { intercepted = true; }
  });
  assert.equal(intercepted, false);
  assert.equal(worker.fetched.length, 0);
});
