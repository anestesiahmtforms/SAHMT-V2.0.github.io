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
    imports: ['assets/shared.js']
  },
  'assets/shared.js': {
    file: 'assets/shared.js',
    css: ['assets/shared.css'],
    assets: [],
    imports: []
  }
};

function createWorker({offline = false} = {}) {
  const origin = 'https://sahmt.example';
  const normalizeUrl = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const handlers = new Map();
  const names = new Set(['sahmt-v2-shell-v20', 'sahmt-v2-offline-schedule-v1', 'unrelated-cache']);
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
    return {ok: true, type: 'basic', clone() { return this; }};
  };
  vm.runInNewContext(workerSource, {self, caches, URL, fetch, Promise, Set, Math});
  return {handlers, cacheNames, entries, fetched, names, deletes: () => deletes, skipWaiting: () => skipWaitingCalls, claim: () => claimCalls};
}

test('instala o shell V28 com os símbolos da Home e os imports estáticos do Vite', async () => {
  assert.match(workerSource, /const CACHE = 'sahmt-v2-shell-v28';/);
  const worker = createWorker();
  let install;
  worker.handlers.get('install')({waitUntil(promise) { install = promise; }});
  await install;

  assert.ok(worker.cacheNames.includes(`${BASE}assets/modules/operacional.jpg`));
  assert.ok(worker.cacheNames.includes(`${BASE}assets/modules/checklist.svg`));
  assert.ok(worker.cacheNames.includes(`${BASE}assets/sahmt-logo.png`));
  assert.ok(worker.cacheNames.includes(`${BASE}assets/selo-qga-accredited-qmentum-diamond.png`));
  assert.ok(worker.entries.has('https://sahmt.example/SAHMT-V2.0.github.io/assets/main.js'));
  assert.ok(worker.entries.has('https://sahmt.example/SAHMT-V2.0.github.io/assets/shared.css'));
  assert.equal(worker.skipWaiting(), 1);
});

test('mantém os caches de férias e externos ao atualizar o shell', async () => {
  const worker = createWorker();
  let activation;
  worker.handlers.get('activate')({waitUntil(promise) { activation = promise; }});
  await activation;

  assert.deepEqual(worker.deletes(), ['sahmt-v2-shell-v20']);
  assert.ok(worker.names.has('sahmt-v2-offline-schedule-v1'));
  assert.ok(worker.names.has('unrelated-cache'));
  assert.equal(worker.claim(), 1);
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
