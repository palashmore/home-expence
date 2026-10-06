// HomeExpenses Progressive Web App Service Worker
const CACHE_NAME = 'homeexpenses-v13';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/tracker_app.js',
  '/advance_modules.js',
  '/ui_actions.js',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
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

// 3. Push and System Notification Handling (Closed-App Mobile Alerts & Heads-Up Banners)
self.addEventListener('push', event => {
  let data = {
    title: '🔔 GharKhata Alert',
    body: 'You have a pending household reminder.',
    url: '/',
    tag: `home-expence-${Date.now()}`
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const alertTag = data.tag || `home-expence-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: alertTag,
    renotify: true,
    requireInteraction: true, // Forces heads-up banner on mobile Android
    silent: false, // Disables silent channel routing
    vibrate: data.vibrate || [300, 100, 300, 100, 300],
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Open GharKhata' }
    ]
  };

  const promiseChain = self.registration.showNotification(data.title, options)
    .then(() => {
      // Notify all open browser clients to refresh transactions without cache AND show in-app banner
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
        for (let client of windowClients) {
          client.postMessage({ type: 'SYNC_TRANSACTIONS', payload: data });
          client.postMessage({ type: 'SHOW_IN_APP_BANNER', payload: data });
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

