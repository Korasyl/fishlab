// ARCA Fish Lab - works with no connection. Answers from the saved copy at once and fetches a fresh one behind it,
// so an update shows the next time the app is opened. Change VERSION to throw the old copy away.
const VERSION = 'fishlab-v0.4.2', SHELL = ['./', 'index.html', 'fishcore.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true }), net = fetch(e.request).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('No connection, and this part has not been saved yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }));
});
