const CACHE_NAME = 'pulseplan-v9.0.0-secure-icons';
const ASSETS = [
  './',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];
const scopeUrl = new URL(self.registration.scope);
const iconPaths = new Set(ASSETS.slice(1).map(asset => new URL(asset, scopeUrl).pathname));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS.map(asset => new Request(new URL(asset, scopeUrl), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('pulseplan-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;
  const branding = iconPaths.has(url.pathname);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(branding ? new Request(event.request, { cache: 'reload' }) : event.request);
      if (response.ok) {
        try { await cache.put(event.request, response.clone()); } catch {}
        return response;
      }
      const cached = await cache.match(event.request);
      return cached || response;
    } catch {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const shell = await cache.match(new URL('./', scopeUrl).href);
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
