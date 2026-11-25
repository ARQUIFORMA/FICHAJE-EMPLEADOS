/* Service worker: cachea solo la "carcasa" de la app para que abra al instante.
   Las llamadas a la API NUNCA se cachean: un fichaje siempre va al servidor en el momento. */
var VERSION = 'fichaje-v11';
var CARCASA = ['./', './index.html', './app.js?v=11', './geo.js?v=11', './config.js', './manifest.webmanifest',
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
  // Red primero (para recibir actualizaciones), caché si no hay conexión
  // cache:'no-cache' obliga a comprobar con GitHub que el archivo no ha cambiado (evita versiones viejas)
  var peticion = e.request.mode === 'navigate' ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request, { cache: 'no-cache' });
  e.respondWith(peticion.then(function (r) {
    var copia = r.clone();
    caches.open(VERSION).then(function (c) { c.put(e.request, copia); });
    return r;
  }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match('./index.html'); }); }));
});
