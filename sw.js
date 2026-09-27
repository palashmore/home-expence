// HomeExpenses Progressive Web App Service Worker
const CACHE_NAME = 'homeexpenses-v5';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/tracker_app.js',
  '/advance_modules.js',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => console.warn('PWA Precache warning:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // 1. API routes are strictly Network-Only (NEVER served from Service Worker cache)
  if (event.request.url.includes('/api/')) {
    return event.respondWith(fetch(event.request));
  }

  // 2. Static assets use Network-First to guarantee latest updates across all devices
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          return cached || (event.request.headers.get('accept')?.includes('text/html') ? caches.match('/index.html') : null);
        });
      })
  );
});
