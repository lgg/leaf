const CACHE = 'leaf-lgg-v15';
const ASSETS = [
  './editor.html',
  './index.html',
  './leaf.webmanifest',
  './leaf-icon-192.png',
  './leaf-icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key.startsWith('leaf-') && key !== CACHE)
        .map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Fetch the latest editor HTML online; fall back to the cached copy offline.
  // Cache-first indefinitely would keep old settings/JS after a GitHub Pages release.
  const isEditor = request.mode === 'navigate' ||
    url.pathname.endsWith('/editor.html') ||
    url.pathname.endsWith('/index.html');
  if (isEditor) {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
        }
        return response;
      }).catch(() => caches.match(request).then(cached =>
        cached || caches.match('./editor.html')))
    );
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
