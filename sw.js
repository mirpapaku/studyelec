const CACHE_NAME = 'electric-cbt-v4-silgi-link';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './theory.js',
  './silgi.js',
  './manifest.webmanifest',
  './data/index.json',
  './data/theory_map.json',
  './data/silgi/index.json',
  './data/silgi/link_map.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(() => {});
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
  const total = urls.length;
  const notify = async (payload) => {
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage(payload));
  };

  const batchSize = 12;
  for (let i = 0; i < total; i += batchSize) {
    const chunk = urls.slice(i, i + batchSize);
    await Promise.all(chunk.map(async u => {
      try {
        const hit = await cache.match(u);
        if (!hit) {
          const res = await fetch(u);
          if (res.ok) await cache.put(u, res);
        }
      } catch (e) {}
      done++;
    }));
    await notify({ type: 'CACHE_PROGRESS', done, total });
  }
  await notify({ type: 'CACHE_DONE', total });
});
