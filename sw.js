// HomeExpenses Progressive Web App Service Worker
const CACHE_NAME = 'homeexpenses-v8';
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

// 3. Push and System Notification Handling (Closed-App Mobile Alerts)
self.addEventListener('push', event => {
  let data = {
    title: 'HomeExpenses Reminder',
    body: 'You have a pending household reminder.',
    url: '/',
    tag: 'homeexpenses-alert'
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || `home-expence-${Date.now()}`,
    renotify: true,
    requireInteraction: false,
    vibrate: [250, 100, 250],
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Open Home Expence' }
    ]
  };

  const promiseChain = self.registration.showNotification(data.title, options)
    .then(() => {
      // Also notify all open browser clients to refresh transactions without cache
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
        for (let client of windowClients) {
          client.postMessage({ type: 'SYNC_TRANSACTIONS', payload: data });
        }
      });
    });

  event.waitUntil(promiseChain);
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

