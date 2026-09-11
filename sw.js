// Service Worker - Appuntamenti Operaio di Lavoro (app dedicata operai)
// Strategia network-first: prende sempre la versione online,
// usa la cache solo se sei offline.
var CACHE = 'appuntamenti-operaio-v18';
var BASE = '/Appuntamenti-Operaio-di-lavoro-/';
var CORE = [
  BASE,
  BASE + 'index.html',
  BASE + 'css/style.css?v=42',
  BASE + 'js/firebase-config.js?v=42',
  BASE + 'js/planning-core.js?v=42',
  BASE + 'js/operaio.js?v=42',
  BASE + 'js/scanner.js?v=42',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'favicon.png',
  BASE + 'apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (resp) {
      var copia = resp.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copia); });
      return resp;
    }).catch(function () {
      return caches.match(e.request).then(function (r) {
        return r || caches.match(BASE + 'index.html');
      });
    })
  );
});
