/* Guarda la app en el teléfono para que abra sin internet.
 * Cuando cambiés index.html o app.js, subí el número de VERSION. */
const VERSION = 'rutas-v4';
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
  // Solo se guardan los archivos de la app, las fuentes y el mapa (Leaflet).
  // Rutas, búsquedas de lugares y cuadros del mapa siempre van directo a internet.
  const propio = url.origin === location.origin || url.hostname.includes('gstatic') || url.hostname.includes('googleapis') || url.hostname === 'cdnjs.cloudflare.com';
  if (!propio) return;

  // Archivos de la app: primero internet (para tener la última versión), si no hay, la copia guardada
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const copia = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copia));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
