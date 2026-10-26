/* Drink & Pass Journal service worker: keeps the app working offline. Entries are never touched here. */
// Bump VERSION with every release (scripts/check-release.mjs enforces it matches package.json).
var VERSION = '1.5.1';
// Written by `npm run stamp`. The CDN in front of the site can briefly serve some files from the previous
// release, so the install checks every file against these hashes and fails rather than cache a mix.
var BUILD = 'ed3422b3';
var FILES = {
  'index.html': 'a25bc54bcd47edfb',
  'manifest.webmanifest': 'ca81ed83a9638314',
  'css/app.css': '910d9262b5086720',
  'js/app.js': '5c1d3655724e98d4',
  'js/core.js': '15f01e19de32c740',
  'js/crypto.js': '57422adbc73afa6c',
  'js/fhir.js': '56dfb3c1fd3b4931',
  'js/i18n.js': '15dc398322c98215',
  'js/pdf.js': '2433bffc70a829e4',
  'js/i18n/de.js': '8eae2927f943bc1c',
  'js/i18n/es.js': '4129d7b3ad8ddaa8',
  'js/i18n/fr.js': '0fa6889072a8e9f4',
  'js/i18n/it.js': '33b835d9c624c74a',
  'js/i18n/nl.js': '94a780bfa7dbf46f',
  'js/i18n/pt.js': '71ea1a263cbdf2bd',
  'js/i18n/zh.js': 'b0259691a4558652',
  'fonts/bricolage-grotesque-latin-ext.woff2': '776f6dcaf03636cd',
  'fonts/bricolage-grotesque-latin.woff2': 'a79fdb52d4a5c765',
  'icons/apple-touch-icon.png': '4747ae745ae58387',
  'icons/favicon-32.png': '0929c139be9a34ad',
  'icons/icon-192.png': '4f0f139b3d7cb98a',
  'icons/icon-512.png': '0b78b8f5509c1865',
  'icons/icon-maskable-512.png': 'c0882703ace35bb5'
};
var CACHE = 'dp-shell-' + VERSION + '-' + BUILD;
var SCOPE = new URL('./', self.location).pathname;
function isAppPage(url) { return url.pathname === SCOPE || url.pathname === SCOPE + 'index.html'; }

function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function precache(c, file) {
  return fetch(new Request('./' + file, { cache: 'reload' })).then(function (res) {
    if (!res.ok) throw new Error(file + ' returned ' + res.status);
    return res.arrayBuffer().then(function (buf) {
      return crypto.subtle.digest('SHA-256', buf).then(function (digest) {
        if (hex(digest).slice(0, 16) !== FILES[file]) throw new Error(file + ' is not the ' + VERSION + ' (' + BUILD + ') copy yet');
        var init = { status: res.status, statusText: res.statusText, headers: res.headers };
        var puts = [c.put('./' + file, new Response(buf, init))];
        if (file === 'index.html') puts.push(c.put('./', new Response(buf, init)));
        return Promise.all(puts);
      });
    });
  });
}
self.addEventListener('install', function (e) {
  // A failed install leaves the current version running; the browser tries again on the next visit.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(Object.keys(FILES).map(function (f) { return precache(c, f); }));
  }).catch(function (err) {
    // Tell open pages, so Settings can say why the update didn't arrive.
    var told = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
      cs.forEach(function (c) { c.postMessage({ type: 'install-failed', version: VERSION, reason: String(err && err.message || err) }); });
    });
    return Promise.all([caches.delete(CACHE), told]).then(function () { throw err; });
  }));
});
// The page asks for this when the user taps Update, so a new version never swaps in mid-session.
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'skip-waiting') self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('dp-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    if (!isAppPage(url)) return;
    // Cache-first keeps the page in step with the cached scripts of the same version.
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match('./index.html').then(function (hit) { return hit || fetch(req); });
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); });
  }));
});
