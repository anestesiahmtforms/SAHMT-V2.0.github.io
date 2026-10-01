const CACHE = 'sahmt-v2-shell-v155';
// Cached Auth must initialize before a saved profile can open the PWA. Home's
// cached projections use data-lite, and Labels binds its manual dialog after
// loading the camera controller even when no camera/AI action is requested.
const OFFLINE_DYNAMIC_ENTRIES = ['src/firebase-auth.js', 'src/data-lite.js', 'src/data.js', 'src/label-camera.js'];
// Firestore initialization awaits App Check in builds configured for AI. Keep
// that small SDK chunk when emitted; the IA-disabled build omits it entirely.
const OFFLINE_OPTIONAL_ENTRIES = ['node_modules/firebase/app-check/dist/esm/index.esm.js'];
const OFFLINE_SCHEDULE_CACHE = 'sahmt-v2-offline-schedule-v1';
const BASE = '/SAHMT-V2.0.github.io/';
const PRECACHE = [
  BASE,
  `${BASE}manifest.webmanifest`,
  `${BASE}assets-manifest.json`,
  `${BASE}assets/icon-192.png`,
  `${BASE}assets/icon-512.png`,
  `${BASE}assets/sahmt-logo.png`,
  `${BASE}assets/selo-qga-accredited-qmentum-diamond.png`,
  `${BASE}assets/modules/operacional.jpg`,
  `${BASE}assets/modules/checklist.svg`,
  `${BASE}vendor/zxing.min.js`
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const cacheAsset = async (assetUrl) => {
      const response = await fetch(assetUrl, {cache: 'reload'});
      if (!response.ok || response.type !== 'basic') throw new Error(`Asset do shell indisponível: ${assetUrl}`);
      await cache.put(assetUrl, response);
    };
    // HTML and the manifest keep their URLs across builds. A warm HTTP cache
    // must not install the previous build beneath the new worker version.
    await Promise.all(PRECACHE.map(cacheAsset));
    const manifestResponse = await cache.match(`${BASE}assets-manifest.json`);
    if (!manifestResponse) throw new Error('Manifest Vite ausente no cache do shell.');
    const manifest = await manifestResponse.json();
    const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry && /\.js$/.test(manifest[key].file || ''));
    if (!entryKey) throw new Error('Entrada JavaScript do shell ausente no manifest Vite.');
    const visited = new Set();
    const assets = new Set();
    const visitEntry = (key) => {
      if (visited.has(key)) return;
      visited.add(key);
      const entry = manifest[key];
      if (!entry) throw new Error(`Import offline obrigatório ausente no manifest Vite: ${key}`);
      for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
        const assetUrl = new URL(file, new URL(BASE, self.location.origin));
        if (assetUrl.origin === self.location.origin && assetUrl.pathname.startsWith(BASE)) assets.add(assetUrl.href);
      }
      for (const imported of entry.imports || []) visitEntry(imported);
    };
    visitEntry(entryKey);
    for (const key of OFFLINE_DYNAMIC_ENTRIES) {
      if (!manifest[key]) throw new Error(`Módulo offline obrigatório ausente no manifest Vite: ${key}`);
      visitEntry(key);
    }
    // Linked dependency directories can give Vite a ../-prefixed source key.
    // Match only the declared source path, never an arbitrary SDK/name prefix.
    for (const source of OFFLINE_OPTIONAL_ENTRIES) {
      for (const key of Object.keys(manifest)) {
        const matchesSource = [key, manifest[key]?.src].some((value) =>
          typeof value === 'string' && value.replace(/^(?:\.\.\/)+/, '') === source);
        if (matchesSource) visitEntry(key);
      }
    }
    await Promise.all([...assets].map(cacheAsset));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(async (keys) => {
    const olderShells = keys
      .filter((key) => /^sahmt-v2-shell-v\d+$/.test(key) && key !== CACHE)
      .sort((left, right) => Number(right.match(/v(\d+)$/)?.[1] || 0) - Number(left.match(/v(\d+)$/)?.[1] || 0));
    const keep = new Set([CACHE, OFFLINE_SCHEDULE_CACHE, olderShells[0]].filter(Boolean));
    await Promise.all(keys.filter((key) => key.startsWith('sahmt-v2-') && !keep.has(key)).map((key) => caches.delete(key)));
  }).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE) || url.pathname.startsWith(`${BASE}tools/`)) return;
  if (request.mode !== 'navigate' && (request.cache === 'reload' || request.cache === 'no-store')) {
    event.respondWith(fetch(request).catch(async (error) => {
      const immutableBuildAsset = url.pathname.startsWith(`${BASE}assets/`) && /-[\w-]{8,}\.(?:js|css)$/.test(url.pathname);
      const requiredQrDecoder = url.pathname === `${BASE}vendor/zxing.min.js`;
      if (request.cache === 'reload' && (immutableBuildAsset || requiredQrDecoder)) {
        const currentShell = await caches.open(CACHE);
        const cached = (await currentShell.match(request)) || (await caches.match(request));
        if (cached) return cached;
      }
      throw error;
    }));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(`${BASE}index.html`, response.clone());
        }
        return response;
      } catch {
        const currentShell = await caches.open(CACHE);
        return (await currentShell.match(`${BASE}index.html`)) || (await currentShell.match(BASE)) ||
          (await caches.match(`${BASE}index.html`)) || (await caches.match(BASE));
      }
    })());
    return;
  }
  if (url.pathname.startsWith(`${BASE}assets/offline-schedule/`)) {
    event.respondWith((async () => {
      // Preparing the gallery replaces this copy. A prior shell may still hold
      // the same URL, so looking across every cache first can resurrect it.
      const imageCache = await caches.open(OFFLINE_SCHEDULE_CACHE);
      const cached = (await imageCache.match(request)) || (await caches.match(request));
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await imageCache.put(request, response.clone());
      return response;
    })());
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  })));
});
