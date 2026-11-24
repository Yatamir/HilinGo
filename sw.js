/* Category lists and a short-lived copy of the page.
   The Whisper weight cache (transformers-cache) is never touched. */
const CATS = 'hilingo-cats-v41316';
const SHELL = 'hilingo-shell-v41316';

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('hilingo-') && k !== CATS && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isDocument(request, url){
  if (request.mode === 'navigate') return true;
  const path = url.pathname;
  return path.endsWith('/') || path.endsWith('/index.html') || path.endsWith('/version.json');
}

function isCode(url){
  return /\.(?:js|mjs|css)$/.test(url.pathname);
}

async function networkFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request, { cache: 'reload' });
    if (fresh && fresh.ok) {
      try { await cache.put(request, fresh.clone()); } catch (_) {}
    }
    return fresh;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (isDocument(event.request, url)) {
    event.respondWith(networkFirst(event.request, SHELL));
    return;
  }
  if (url.pathname.includes('/cats/')) {
    event.respondWith(networkFirst(event.request, CATS));
    return;
  }
  if (isCode(url)) {
    event.respondWith(networkFirst(event.request, SHELL));
  }
});
