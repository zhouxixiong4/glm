/* sw.js — offline support. The app shell is cached at install time (bump VERSION on every release);
 * KaTeX files and generated images are cached the first time they are shown. API calls are never cached. */
const VERSION = 'glm-v1.1.4';
const RUNTIME = 'glm-runtime-1';
const SHELL = [
  './', './index.html', './style.css', './boot.js', './config.js', './markdown.js', './app.js', './sandbox.js', './ui-runtime.js', './ui-base.css',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];
const CDN = /^https:\/\/(registry\.npmmirror\.com\/katex\/0\.16\.11\/|cdn\.jsdelivr\.net\/npm\/katex@0\.16\.11\/|unpkg\.com\/katex@0\.16\.11\/)/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

// A new version waits until the page asks for it (the user tapped 更新), so a running page never mixes versions.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('glm-v') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = req.mode === 'navigate'
        ? await cache.match('./index.html')
        : await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (e) {
        if (req.mode === 'navigate') return (await cache.match('./')) || Response.error();
        return Response.error();
      }
    })());
    return;
  }
  // Images drawn by CogView: their links expire after a few days, so keep a copy on the phone.
  if (req.destination === 'image' && /(^|\.)(ufileos\.com|bigmodel\.cn|chatglm\.cn|aliyuncs\.com)$/.test(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }
  if (CDN.test(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'cors') cache.put(req, res.clone());
      return res;
    })());
  }
});
