const CACHE = 'sahmt-v2-shell-v166';
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
    await cache.addAll(PRECACHE);
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
      if (!entry) return;
      for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
        const assetUrl = new URL(file, new URL(BASE, self.location.origin));
        if (assetUrl.origin === self.location.origin && assetUrl.pathname.startsWith(BASE)) assets.add(assetUrl.href);
      }
      for (const imported of entry.imports || []) visitEntry(imported);
    };
    visitEntry(entryKey);
    // Only the report/offline adapters and their static dependencies are essential.
    // PDF, camera processing and other optional module graphs remain fetched on demand.
    const reportEssentials = new Set([
      'src/report-live-data.js', 'src/checklist-report-listener.js', 'src/label-report-reader.js',
      'src/firebase.js', 'src/firebase-auth.js', 'src/data.js', 'src/data-lite.js'
    ]);
    for (const [key, entry] of Object.entries(manifest)) {
      if (reportEssentials.has(entry.src || key)) visitEntry(key);
    }
    await Promise.all([...assets].map(async (assetUrl) => {
      const response = await fetch(assetUrl, {cache: 'reload'});
      if (!response.ok || response.type !== 'basic') throw new Error(`Asset do shell indisponível: ${assetUrl}`);
      await cache.put(assetUrl, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('sahmt-v2-') && key !== CACHE && key !== OFFLINE_SCHEDULE_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE) || url.pathname.startsWith(`${BASE}tools/`)) return;
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
        return (await caches.match(`${BASE}index.html`)) || (await caches.match(BASE));
      }
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
