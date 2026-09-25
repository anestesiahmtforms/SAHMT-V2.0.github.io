const CACHE = 'sahmt-v2-shell-v14';
const OFFLINE_SCHEDULE_CACHE = 'sahmt-v2-offline-schedule-v1';
const BASE = '/SAHMT-V2.0.github.io/';
const PRECACHE = [BASE, `${BASE}manifest.webmanifest`, `${BASE}assets/icon-192.png`, `${BASE}assets/icon-512.png`];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('sahmt-v2-') && key !== CACHE && key !== OFFLINE_SCHEDULE_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
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
  if (!url.pathname.startsWith(BASE)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  })));
});
