/* Service worker: la "carcasa" de la app se sirve al instante desde la caché y se actualiza por detrás.
   Las llamadas a la API NUNCA se cachean: un fichaje siempre va al servidor en el momento. */
var VERSION = 'fichaje-v16';
var CARCASA = ['./', './index.html', './app.js?v=16', './geo.js?v=16', './config.js', './manifest.webmanifest',
               './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(CARCASA); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // API y terceros: directo a red
  var clave = e.request.mode === 'navigate' ? './index.html' : e.request;
  // cache:'no-cache' obliga a preguntar a GitHub si el archivo cambió (así nunca se queda una versión vieja)
  var red = fetch(e.request.mode === 'navigate' ? e.request.url : e.request, { cache: 'no-cache' }).then(function (r) {
    if (r && r.ok) { var copia = r.clone(); caches.open(VERSION).then(function (c) { c.put(clave, copia); }); }
    return r;
  });
  e.respondWith(caches.match(clave).then(function (enCache) {
    if (enCache) { e.waitUntil(red.catch(function () {})); return enCache; } // al instante; la red actualiza para la próxima vez
    return red.catch(function () { return caches.match('./index.html'); });
  }));
});
