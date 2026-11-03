/* Service worker de la raíz DESACTIVADO.
 * Rutas Nicaragua ahora vive en /rutas/. Este archivo solo existe para que
 * los teléfonos y PCs que tenían el service worker viejo (alcance "/", que
 * abarcaba todas las apps del sitio) lo reemplacen por este y se borre solo. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter(k => /^rutas-v\d+$/.test(k)).map(k => caches.delete(k)));
    await self.registration.unregister();
    const ventanas = await self.clients.matchAll({ type: 'window' });
    ventanas.forEach(c => c.navigate(c.url));
  })());
});
