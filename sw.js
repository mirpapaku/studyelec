const CACHE_NAME = 'electric-cbt-full-v13';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './theory.js',
  './manifest.webmanifest',
  './data/index.json',
  './data/theory_map.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (
          res &&
          res.status === 200 &&
          (event.request.url.startsWith(self.location.origin) ||
            event.request.url.includes('katex') ||
            event.request.url.includes('pdfjs-dist'))
        ) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

self.addEventListener('message', async event => {
  if (!event.data || event.data.type !== 'CACHE_URLS') return;
  const urls = event.data.urls || [];
  const cache = await caches.open(CACHE_NAME);
  let done = 0;
  const CONCURRENCY = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const idx = cursor++;
      const url = urls[idx];
      try {
        const existing = await cache.match(url);
        if (!existing) {
          const res = await fetch(url);
          if (res.ok) await cache.put(url, res);
        }
      } catch (e) {}
      done++;
      if (done % 5 === 0 || done === urls.length) {
        event.source.postMessage({ type: 'CACHE_PROGRESS', done, total: urls.length });
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, urls.length); i++) workers.push(worker());
  await Promise.all(workers);
  event.source.postMessage({ type: 'CACHE_DONE', total: urls.length });
});
