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
    dynamicImports: ['src/firebase-auth.js', 'src/data-lite.js', 'src/data.js', 'src/label-camera.js', '_report-pdf-built.js']
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
  'src/firebase-auth.js': {file: 'assets/firebase-auth.js', imports: ['assets/auth.js']},
  'assets/auth.js': {file: 'assets/auth.js', imports: []},
  'src/data-lite.js': {file: 'assets/data-lite.js', imports: ['assets/firestore-lite.js']},
  'assets/firestore-lite.js': {file: 'assets/firestore-lite.js', imports: []},
  'src/label-camera.js': {file: 'assets/label-camera.js', imports: []},
  '_report-pdf-built.js': {file: 'assets/report-pdf.js', name: 'report-pdf', imports: []},
  'src/checklist-signature.js': {file: 'assets/checklist-signature.js', imports: []}
};

function createWorker({offline = false, manifestOverride = manifest, globalCacheMatch = null} = {}) {
  const origin = 'https://sahmt.example';
  const normalizeUrl = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const handlers = new Map();
  const names = new Set(['sahmt-v2-shell-v20', 'sahmt-v2-shell-v102', 'sahmt-v2-shell-v103', 'sahmt-v2-shell-v104', 'sahmt-v2-shell-v105', 'sahmt-v2-shell-v106', 'sahmt-v2-shell-v107', 'sahmt-v2-offline-schedule-v1', 'unrelated-cache']);
  const entries = new Map();
  const cacheNames = [];
  const fetched = [];
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  let deletes = [];
  const manifestResponse = {json: async () => manifestOverride};

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
      return globalCacheMatch ? globalCacheMatch(request) : cache.match(request);
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

test('instala shell V107 com símbolos e módulos offline selecionados do manifest Vite', async () => {
  assert.match(workerSource, /const CACHE = 'sahmt-v2-shell-v107';/);
  const worker = createWorker();
  let install;
  worker.handlers.get('install')({waitUntil(promise) { install = promise; }});
  await install;

  for (const asset of [
    'assets/modules/operacional.jpg',
    'assets/modules/checklist.svg',
    'assets/sahmt-logo.png',
    'vendor/zxing.min.js',
    'assets/selo-qga-accredited-qmentum-diamond.png',
    'assets/main.js',
    'assets/shared.css',
    'assets/firebase-auth.js',
    'assets/auth.js',
    'assets/data-lite.js',
    'assets/firestore-lite.js',
    'assets/label-camera.js',
    'assets/data.js',
    'assets/firestore.js'
  ]) assert.ok(worker.entries.has(`https://sahmt.example${BASE}${asset}`), `${asset} deve estar no cache offline`);
  assert.ok(!worker.entries.has(`https://sahmt.example${BASE}assets/report-pdf.js`));
  assert.ok(!worker.entries.has(`https://sahmt.example${BASE}assets/checklist-signature.js`));
  assert.equal(worker.skipWaiting(), 1);
});

test('não ativa shell incompleto quando falta módulo essencial ou um import dele', async () => {
  for (const missing of ['src/firebase-auth.js', 'src/data-lite.js', 'src/data.js', 'src/label-camera.js', 'assets/auth.js']) {
    const incomplete = {...manifest};
    delete incomplete[missing];
    const worker = createWorker({manifestOverride: incomplete});
    let install;
    worker.handlers.get('install')({waitUntil(promise) { install = promise; }});
    await assert.rejects(install, /offline obrigatório ausente/);
    assert.equal(worker.skipWaiting(), 0);
  }
});

test('build com IA configurada inclui somente o SDK App Check necessário à inicialização do Firestore', async () => {
  const configured = {...manifest, 'node_modules/firebase/app-check/dist/esm/index.esm.js': {file: 'assets/app-check-core.js', imports: ['assets/shared.js']}};
  const worker = createWorker({manifestOverride: configured});
  let install;
  worker.handlers.get('install')({waitUntil(promise) {install = promise;}});
  await install;
  assert.ok(worker.entries.has(`https://sahmt.example${BASE}assets/app-check-core.js`));
  assert.ok(!worker.entries.has(`https://sahmt.example${BASE}assets/report-pdf.js`));
  assert.ok(!worker.entries.has(`https://sahmt.example${BASE}assets/checklist-signature.js`));
});

test('mantém o shell anterior para abas antigas e preserva os caches da fila offline', async () => {
  const worker = createWorker();
  const oldAssetUrl = `https://sahmt.example${BASE}assets/old-main.js`;
  const oldAsset = {url: oldAssetUrl, source: 'shell-v106'};
  worker.entries.set(oldAssetUrl, oldAsset);
  let activation;
  worker.handlers.get('activate')({waitUntil(promise) { activation = promise; }});
  await activation;

  assert.deepEqual(worker.deletes(), ['sahmt-v2-shell-v20', 'sahmt-v2-shell-v102', 'sahmt-v2-shell-v103', 'sahmt-v2-shell-v104', 'sahmt-v2-shell-v105']);
  assert.ok(worker.names.has('sahmt-v2-shell-v106'));
  assert.ok(worker.names.has('sahmt-v2-shell-v107'));
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

test('recarregar a página offline usa o shell salvo, mesmo com request.cache reload', async () => {
  const worker = createWorker({offline: true});
  const indexUrl = `https://sahmt.example${BASE}index.html`;
  const savedIndex = {url: indexUrl};
  worker.entries.set(indexUrl, savedIndex);
  let response;
  worker.handlers.get('fetch')({
    request: {method: 'GET', mode: 'navigate', url: `https://sahmt.example${BASE}`, cache: 'reload'},
    respondWith(promise) { response = promise; }
  });
  assert.strictEqual(await response, savedIndex);
});

test('nova navegação offline prefere o shell atual à página index do cache anterior', async () => {
  const previousIndex = {source: 'previous-shell-index'};
  const worker = createWorker({offline: true, globalCacheMatch: async () => previousIndex});
  const currentBase = {source: 'current-shell-base'};
  worker.entries.set(`https://sahmt.example${BASE}`, currentBase);
  let response;
  worker.handlers.get('fetch')({
    request: {method: 'GET', mode: 'navigate', url: `https://sahmt.example${BASE}`, cache: 'default'},
    respondWith(promise) { response = promise; }
  });
  assert.strictEqual(await response, currentBase);
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

test('imagem preparada corrigida prevalece sobre a mesma URL salva num shell anterior', async () => {
  const previous = {source: 'old-shell-image'};
  const corrected = {source: 'corrected-prepared-image'};
  const worker = createWorker({offline: true, globalCacheMatch: async () => previous});
  const url = `https://sahmt.example${BASE}assets/offline-schedule/segunda-2026.jpg`;
  worker.entries.set(url, corrected);
  let response;
  worker.handlers.get('fetch')({request: {method: 'GET', mode: 'no-cors', url, cache: 'default'}, respondWith(promise) {response = promise;}});
  assert.strictEqual(await response, corrected);
  assert.equal(worker.fetched.length, 0);
});

test('reload offline recupera somente JS/CSS imutáveis do build e não devolve imagem antiga', async () => {
  for (const asset of ['index-abcd1234.js', 'index-abcd1234.css', 'operacional.jpg']) {
    const worker = createWorker({offline: true});
    const url = `https://sahmt.example${BASE}assets/${asset}`;
    const cached = {source: 'saved-build'};
    worker.entries.set(url, cached);
    let response;
    worker.handlers.get('fetch')({request: {method: 'GET', mode: 'cors', url, cache: 'reload'}, respondWith(promise) {response = promise;}});
    if (/\.(js|css)$/.test(asset)) assert.strictEqual(await response, cached);
    else await assert.rejects(response, /offline/);
  }
});

test('no-store permanece obrigatório no servidor, inclusive para JS salvo', async () => {
  const worker = createWorker({offline: true});
  const url = `https://sahmt.example${BASE}assets/index-abcd1234.js`;
  worker.entries.set(url, {source: 'saved-build'});
  let response;
  worker.handlers.get('fetch')({request: {method: 'GET', mode: 'cors', url, cache: 'no-store'}, respondWith(promise) {response = promise;}});
  await assert.rejects(response, /offline/);
});

test('decoder QR essencial sem hash abre offline em reload e prefere a versão do shell atual', async () => {
  const current = {source: 'current-qr-decoder'};
  const worker = createWorker({offline: true, globalCacheMatch: async () => ({source: 'old-qr-decoder'})});
  const url = `https://sahmt.example${BASE}vendor/zxing.min.js`;
  worker.entries.set(url, current);
  let response;
  worker.handlers.get('fetch')({request: {method: 'GET', mode: 'no-cors', url, cache: 'reload'}, respondWith(promise) {response = promise;}});
  assert.strictEqual(await response, current);
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
