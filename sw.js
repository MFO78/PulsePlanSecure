const CACHE_NAME = 'pulseplan-secure-pwa-v1';
const APP_SHELL = './index.html';
const CORE_ASSETS = [
  APP_SHELL,
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        CORE_ASSETS.map((asset) =>
          fetch(new Request(asset, { cache: 'no-cache' }))
            .then((res) => (res && res.ok ? cache.put(asset, res) : null))
            .catch(() => null)
        )
      ))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => {})
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML navigations with canonical APP_SHELL caching (prevents duplicate './' and './index.html' cache entries)
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(new Request(req.url, { cache: 'no-cache', credentials: req.credentials }))
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(APP_SHELL))
    );
    return;
  }

  // Stale-while-revalidate for local static assets
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(new Request(req.url, { cache: 'no-cache', credentials: req.credentials })).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
