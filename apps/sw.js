/* Guarda el lanzador para que abra sin internet. Solo maneja /apps/. */
const VERSION = 'mis-apps-v3';
const ARCHIVOS = ['./', 'index.html', 'apps.json', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(k => Promise.all(k.filter(x => x.startsWith('mis-apps-') && x !== VERSION).map(x => caches.delete(x))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/apps/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
