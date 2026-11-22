/* Arbaeen UK service worker: offline shell + push notifications */
const CACHE = 'arbaeen-v3';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'lib/leaflet.js', 'lib/leaflet.css', 'manifest.webmanifest', 'icons/icon.svg', 'js/i18n.js', 'lib/qrcode.js', 'lib/jsQR.js', 'js/scan.js', 'scan.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Live data and API: network first, fall back to last copy
  if (url.pathname.includes('/data/') || url.pathname.includes('/api/')) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});

// Push: announcements, check-in reminders, approved alerts
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Arbaeen UK', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url));
});
