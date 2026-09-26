/* Emortia's service worker.

   ── Bump VERSION on every deploy. ──────────────────────────────────────
   Nothing else in here needs touching. Changing this string changes the
   worker's own bytes, which is what makes the browser install a new one;
   activating it then deletes every cache that is not this version's, so
   nothing from the last deploy can survive into this one.

   Why this file is careful
   ------------------------
   The tool suite has already been broken once by a worker: the one under
   /tools/gin-extractor/ answered `if (cached) return cached` to every
   request, including ../_lib/supabase-config.js. Once a copy landed in
   that cache it was served for ever, so the site announced that the anon
   key was missing while the key sat in the file, correct, on the server.
   Fifteen deploys went out underneath it. Six workers had piled up on the
   origin, and on a home-screen app there is no Ctrl+Shift+R to dig out of
   it with.

   So the rule here is the other way round, and it is not negotiable:

     HTML and JS   network first, always. The cache is a fallback for when
                   the network is genuinely gone, never a first choice. A
                   stale page is better than no page, but only then.
     images/fonts  cache first. They are content-addressed in practice -
                   a changed picture gets a changed name - and they are
                   what makes the app feel instant.
     audio         never automatically. The tracks are multi-megabyte WAVs
                   and filling somebody's phone without asking is rude.
                   The page asks for one by name, per song, and only then.

   Anything not matched by those falls through to the network untouched. */

const VERSION = 'v3';

const SHELL   = 'emortia-shell-' + VERSION;   // HTML and JS, the fallback copy
const STATIC  = 'emortia-static-' + VERSION;  // images and fonts
const AUDIO   = 'emortia-audio';              // songs, saved by hand, kept across deploys
const MINE    = [SHELL, STATIC, AUDIO];

/* Enough to open the door when there is no network at all. Everything else
   arrives in the cache by being used. */
const DOOR = ['/', '/index.html', '/404.html'];

/* The files the old worker froze. They get no special case here, and that
   is deliberate: network-first is already the fix, because with a network
   they are fetched fresh every single time and a stale copy can never be
   preferred. Cutting them out of the cache altogether was the other idea,
   and it is worse - offline the script tag would simply fail, and the tool
   would announce a missing anon key, which is precisely the sentence this
   whole file exists to stop anybody reading again. Offline, last known
   good beats nothing. */

const isHTML = (req, url) =>
  req.mode === 'navigate' ||
  (req.headers.get('accept') || '').includes('text/html') ||
  /\.html$/.test(url.pathname);
const isJS    = url => /\.(js|mjs)(\?|$)/.test(url.pathname);
/* Stylesheets and the site's own text files ride with the code, not with the
   pictures. They change on a deploy, so they are fetched fresh when there is
   a network - but they have to be in the cache for when there is not, or a
   tool opens unstyled and the poems do not open at all. */
const isCSS   = url => /\.css(\?|$)/.test(url.pathname);
const isData  = url => /\.(txt|json|lrc|csv)(\?|$)/.test(url.pathname);
const isImage = url => /\.(png|jpe?g|webp|gif|svg|ico|avif)(\?|$)/.test(url.pathname);
const isFont  = url => /\.(woff2?|ttf|otf|eot)(\?|$)/.test(url.pathname);
const isAudio = url => /\.(wav|mp3|m4a|ogg|flac)(\?|$)/.test(url.pathname);

self.addEventListener('install', e => {
  /* The door is best-effort: one missing file must not stop the worker
     installing, or a typo here becomes a site that cannot update. */
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.all(DOOR.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    /* Only this worker's own names. The clock at /attendance/clock/ is a
       separate installed app with its own worker and its own caches, and a
       janitor that sweeps every name it does not recognise would empty them
       every time somebody opened the main site. */
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => /^emortia-(shell|static)-/.test(k) && !MINE.includes(k))
      .map(k => caches.delete(k)));
    /* Older navigation preloads can outlive their worker; clear it so the
       first navigation after an update is not answered by the last one. */
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (err) {}
    }
    await self.clients.claim();
  })());
});

/* The page asks for a song; the worker fetches it and says how it went. */
self.addEventListener('message', e => {
  const m = e.data || {};
  /* The page asks down a MessageChannel and waits on its own end of it, so
     the answer goes back through the port it sent. Falling back to the
     client only covers a caller that did not open one. */
  const port = e.ports && e.ports[0];
  const reply = msg => port ? port.postMessage(msg) : (e.source && e.source.postMessage(msg));

  if (m.type === 'version') return reply({ type: 'version', version: VERSION });

  if (m.type === 'save-audio') {
    e.waitUntil((async () => {
      try {
        const res = await fetch(m.url, { cache: 'reload' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const c = await caches.open(AUDIO);
        await c.put(m.url, res);
        reply({ type: 'audio-saved', url: m.url, ok: true });
      } catch (err) {
        reply({ type: 'audio-saved', url: m.url, ok: false, error: String(err.message || err) });
      }
    })());
  }

  if (m.type === 'drop-audio') {
    e.waitUntil((async () => {
      const c = await caches.open(AUDIO);
      await c.delete(m.url);
      reply({ type: 'audio-dropped', url: m.url });
    })());
  }

  if (m.type === 'audio-list') {
    e.waitUntil((async () => {
      const c = await caches.open(AUDIO);
      const keys = await c.keys();
      reply({ type: 'audio-list', urls: keys.map(r => new URL(r.url).pathname) });
    })());
  }
});

async function networkFirst(req, cacheName){
  try {
    const res = await fetch(req);
    /* An opaque or error response is not worth keeping - caching a 404 of
       a script is how a site starts lying about itself. */
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(cacheName).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: false });
    if (hit) return hit;
    /* A navigation with nothing cached still deserves the door rather than
       the browser's dinosaur. */
    if (req.mode === 'navigate') {
      const door = await caches.match('/index.html');
      if (door) return door;
    }
    throw err;
  }
}

async function cacheFirst(req, cacheName){
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
    const copy = res.clone();
    caches.open(cacheName).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Someone else's server is their business - and a range request for a
     song must reach the network or seeking breaks. */
  if (url.origin !== location.origin) return;
  if (req.headers.has('range')) return;

  /* The worker and the manifest are never served from a cache: that is the
     thread you pull to get out of a bad deploy. */
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.json') return;

  if (isAudio(url)) {
    /* Only what was asked for by name. Everything else goes to the network
       and is not kept. */
    e.respondWith(caches.open(AUDIO)
      .then(c => c.match(req))
      .then(hit => hit || fetch(req)));
    return;
  }

  if (isHTML(req, url) || isJS(url) || isCSS(url) || isData(url)) {
    e.respondWith(networkFirst(req, SHELL)); return;
  }
  if (isImage(url) || isFont(url)) { e.respondWith(cacheFirst(req, STATIC)); return; }
});
