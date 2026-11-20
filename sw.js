/* Caches the category lists so a later game can use them offline. */
const CACHE = 'hilingo-cats-v4101';
self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(Promise.resolve()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.includes('/cats/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(event.request);
      if (fresh && fresh.ok) cache.put(event.request, fresh.clone());
      return fresh;
    } catch (err) {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      throw err;
    }
  })());
});
