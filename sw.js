/* Drink & Pass Journal service worker: keeps the app working offline. Entries are never touched here. */
var CACHE = 'dp-shell-v3';
var SHELL = ['./', './index.html', './css/app.css', './js/app.js', './js/core.js', './fonts/bricolage-grotesque-latin.woff2', './fonts/bricolage-grotesque-latin-ext.woff2', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('dp-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
var SCOPE = new URL('./', self.location).pathname;
function isAppPage(url) { return url.pathname === SCOPE || url.pathname === SCOPE + 'index.html'; }
self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) { if (res.ok && isAppPage(url)) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put('./index.html', copy); }); } return res; })
      .catch(function () { return caches.match('./index.html'); }));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); } return res; });
    }));
    return;
  }
});
