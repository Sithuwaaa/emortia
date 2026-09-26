/* This worker's only job is to remove itself.

   What used to be here answered `if (cached) return cached` to every
   request inside /tools/gin-extractor/ - including ../_lib/*.js and its
   own index.html. Two things follow from that, and the second is why this
   file still exists instead of simply being deleted:

     1. Once ../_lib/supabase-config.js landed in that cache it was served
        for ever, so the tool reported a missing anon key that was never
        missing. Fifteen deploys went out underneath it.

     2. Its own index.html was cached the same way. Anyone still carrying
        that registration is pinned to the HTML of whatever day they first
        opened the tool, and no new script tag - no fix of any kind - can
        reach them through the page.

   A service worker script is the one file a browser always re-fetches from
   the network on its own schedule, never from its own cache. So this is the
   only door left open. Deleting the file would eventually work too, because
   a 404 on the update check discards the registration, but that relies on
   what a browser does with an error; this states the intention outright,
   clears the caches that did the damage, and reloads the page so the root
   worker at / can pick it up straight away.

   Once you are satisfied nobody is still carrying the old registration,
   this file can go. There is no hurry: it costs one request. */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    /* every cache the old worker opened - gin-v1 through gin-v15 and any
       other name it ever used */
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.indexOf('emortia-') !== 0).map(k => caches.delete(k)));

    await self.registration.unregister();

    /* The pages under this scope are still controlled until they reload,
       and they are showing cached HTML, so send them round again. They
       come back uncontrolled, fetch the real files, and the worker at the
       root takes over from there. */
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { await c.navigate(c.url); } catch (e) { /* not ours to navigate */ }
    }
  })());
});

/* Until that activate finishes, pass everything straight through: no
   request made in the meantime should be answered from the old cache. */
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request).catch(() => new Response('', { status: 504 })));
});
