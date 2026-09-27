// Aegis Vision PWA Service Worker
const CACHE_NAME = 'aegis-cctv-v3.2';
const STATIC_ASSETS = [
  '/',
  '/static/css/style.css?v=3.2',
  '/static/js/app.js?v=3.2',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never cache live camera streams or dynamic API stats
  if (url.pathname.startsWith('/stream') || url.pathname.startsWith('/api')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
