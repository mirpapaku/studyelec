const CACHE_NAME = 'elec-master-pwa-v5.2';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css?v=5.2',
  './app.js?v=5.2',
  './manifest.json',
  './data/meta.json',
  './data/written_1.json',
  './data/written_2.json',
  './data/practical.json',
  './data/theory_map.json',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        CORE_ASSETS.map((url) =>
          fetch(new Request(url, { cache: 'reload' })).then((res) => {
            if (res && res.ok) return cache.put(url, res);
          }).catch(() => {})
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isCoreOrDataRequest(url) {
  const p = url.pathname;
  return (
    p.endsWith('/') ||
    p.endsWith('/index.html') ||
    p.endsWith('/style.css') ||
    p.endsWith('/app.js') ||
    p.endsWith('/manifest.json') ||
    p.includes('/data/')
  );
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML/CSS/JS/JSON so updates apply immediately without stale cache
  if (event.request.mode === 'navigate' || isCoreOrDataRequest(url)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request, { ignoreSearch: true })
            .then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // Cache-first with runtime caching for images & icons
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
