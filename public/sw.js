// Offline support: the app shell is cached on install. Same-origin requests
// are served network-first, so updates show up straight away when online,
// with the cache as the fallback when offline. Cross-origin requests (page
// imports) are never touched.
const CACHE = 'homebrew-vault-v2';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'js/app.js',
  'js/importer.js',
  'js/store.js',
  'manifest.webmanifest',
  'img/dm-screen.jpg',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      return hit || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }
  })());
});
