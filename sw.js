/* Guarda la app en el teléfono para que abra sin internet.
 * Cuando cambiés index.html o app.js, subí el número de VERSION. */
const VERSION = 'rutas-v1';
const ARCHIVOS = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'privacidad.html',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(claves => Promise.all(claves.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Las rutas siempre se piden en vivo a Apps Script
  if (url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // Archivos de la app: primero internet (para tener la última versión), si no hay, la copia guardada
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && (url.origin === location.origin || url.hostname.includes('gstatic') || url.hostname.includes('googleapis'))) {
        const copia = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copia));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
