/**
 * Offline shell.
 *
 * The player is a static page, so the only thing worth caching is the page
 * itself: the code, the styles, the demo and the icons. Music the user imports
 * is never cached — those are blob URLs that die with the tab, and they are
 * the user's files, not this app's.
 */

const CACHE = 'izgiv-v3';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './icon.svg',
  './manifest.webmanifest',
  './src/app.js',
  './src/tags.js',
  './src/queue.js',
  './src/lrc.js',
  './src/color.js',
  './src/eq.js',
  './demo/demo.mp3',
  './demo/demo.lrc',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Cache-first for the shell: this app has no data to keep fresh.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
