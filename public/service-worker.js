const CACHE = 'sahmt-v2-shell-v261';
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
    const entryKey = manifest['index.html']?.isEntry ? 'index.html' : Object.keys(manifest).find((key) => manifest[key]?.isEntry && manifest[key]?.src === 'index.html') || Object.keys(manifest).find(key => manifest[key]?.isEntry && !/demo/i.test(key) && /\.js$/.test(manifest[key].file || ''));
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
    // Precache adapters required when opening core screens, including the Labels camera binder.
    // PDF and training materials remain fetched on demand.
    const reportEssentials = new Set([
      'src/report-live-data.js', 'src/checklist-report-listener.js', 'src/label-report-reader.js',
      'src/checklist-rotation-listener.js',
      'src/firebase.js', 'src/firebase-auth.js', 'src/profile-server.js', 'src/data.js', 'src/data-lite.js',
      'src/google-project-auth-runtime.js', 'src/google-project-auth-ui.js',
      'src/google-project-auth-google-button.js',
      'src/management-hub.js', 'src/performance-ui.js', 'src/evaluation-data.js', 'src/label-camera.js',
      'src/offline-cache.js', 'src/offline-runtime-mode.js', 'src/offline-report-cache.js', 'src/outbox.js',
      'src/offline-outbox-policy.js', 'src/provisional-operational-channel.js',
      'src/checklist-conference-listener.js', 'src/checklist-responsibility-listener.js', 'src/label-ai.js'
    ]);
    for (const [key, entry] of Object.entries(manifest)) {
      if (reportEssentials.has(entry.src || key) || /\/(?:@firebase\/app-check|firebase\/app-check)\//.test(entry.src || key)) visitEntry(key);
    }
    await Promise.all([...assets].map(async (assetUrl) => {
      const response = await fetch(assetUrl, {cache: 'reload'});
      if (!response.ok || response.type !== 'basic') throw new Error(`Asset do shell indisponível: ${assetUrl}`);
      await cache.put(assetUrl, response);
    }));
    // Wait for existing app windows to close. Never replace a running form or Auth flow.
    // The browser activates this worker naturally when the previous version has no clients.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys=await caches.keys();
    const shells=keys.filter(key=>/^sahmt-v2-shell-v\d+$/.test(key))
      .sort((a,b)=>Number(b.match(/v(\d+)$/)[1])-Number(a.match(/v(\d+)$/)[1]));
    const keep=new Set([CACHE,...shells.slice(0,2)]);
    await Promise.all(shells.filter(key=>!keep.has(key)).map(key=>caches.delete(key)));
    // Local records, schedule caches and Auth IndexedDB are outside this cleanup.
    // No clients.claim(): pages already open keep their own version until navigation.
  })());
});

// An error/recovery page can activate a fully installed release. It never
// claims or reloads other windows, and does not touch Auth or local records.
self.addEventListener('message', event => {
  if(event.data?.type!=='SAHMT_ACTIVATE_REPAIRED_APP')return;
  let source;try{source=new URL(event.source?.url);}catch{return;}
  if(source.origin!==self.location.origin||source.pathname!=='/SAHMT-V2.0.github.io'+'/tools/refresh-app.html')return;
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE) || url.pathname.startsWith(`${BASE}tools/`) || url.pathname.startsWith(`${BASE}gestao/`) || url.pathname === `${BASE}demo.html`) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      // The installed worker owns a consistent HTML/asset set. New releases install
      // in a separate versioned cache; opening the app never waits for hosting.
      const installed = await caches.open(CACHE);
      const shell = (await installed.match(`${BASE}index.html`)) || (await installed.match(BASE));
      if (shell) return shell;
      try {
        const response = await fetch(request);
        if (!response.ok) throw new Error('SHELL_HTTP_UNAVAILABLE');
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
  event.respondWith((async()=>{
    const installed=await caches.open(CACHE);
    const current=await installed.match(request);
    if(current)return current;
    // Only content-addressed chunks may fall back to a previous release's shell.
    if(/\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.(?:js|css)$/.test(url.pathname)){
      const previous=await caches.match(request);if(previous)return previous;
    }
    return fetch(request).then(async (response) => {
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
    });
  })());
});
