/* The clock's own worker. Scoped to /attendance/clock/ and nothing else.
   ── Bump VERSION on every deploy. ──────────────────────────────────────

   This is a separate installed app from the site: its own manifest, its own
   icon, its own caches. Three things keep the two apart:

     · it registers with scope './', which is narrower than the root worker's
       '/', and a narrower scope wins for the pages inside it;
     · its caches are named tooway-clock-*, and the root worker only ever
       deletes emortia-shell-* and emortia-static-*;
     · the root's pwa.js keeps this scope on its allow list rather than
       sweeping it away with the old per-tool workers.

   The shell is cached so the app opens at a site with no signal - that is
   the whole point of it. The RPC calls are never cached: a clock-in is not
   a thing to replay from a cache, and the queue in the page is what handles
   being offline. */

const VERSION = 'v3';
const CACHE = 'tooway-clock-' + VERSION;

const SHELL = [
  './', './index.html', './manifest.json',
  './icon-192.png', './icon-512.png',
  '../../tools/_lib/supabase-config.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    /* only this app's own names - the site's caches are not this worker's
       business, and it is not this worker's business to empty them */
    await Promise.all(keys
      .filter(k => k.startsWith('tooway-clock-') && k !== CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;              // the RPCs are POSTs: untouched

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;    // supabase, and anything else
  if (url.pathname.endsWith('/sw.js')) return;   // never from a cache

  /* Network first, so a deploy reaches the crews without anybody uninstalling
     anything - the same rule the site learned the hard way. The cache is what
     makes the app open at all when there is no signal. */
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const door = await caches.match('./index.html');
        if (door) return door;
      }
      throw err;
    }
  })());
});
