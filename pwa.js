/* The page's half of the service worker: clear out what went before,
   register the one at the root, and offer to install.

   The clearing-out is the important part. Six workers had accumulated on
   this origin, one of them answering every request from its own cache -
   which is how the site came to insist an anon key was missing while the
   key sat in the file. Any registration whose scope is not the root is
   from that era and goes, every load, before anything else happens.

   Everything here is defensive on purpose. A page that throws on line one
   of this file is a page that never registers a worker and never cleans
   one up, and on a home-screen app nobody can reach developer tools to
   find out why. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) { window.Emortia = window.Emortia || {}; return; }

  var ROOT = new URL('/', location.origin).href;
  var API = window.Emortia = window.Emortia || {};
  var ready = null;

  /* ---- 1. the old ones ---- */
  function sweep() {
    return navigator.serviceWorker.getRegistrations().then(function (regs) {
      var old = regs.filter(function (r) { return r.scope !== ROOT; });
      if (!old.length) return 0;
      console.info('[pwa] removing ' + old.length + ' worker(s) from before the root one');
      return Promise.all(old.map(function (r) { return r.unregister().catch(function () {}); }))
        .then(function () { return old.length; });
    }).catch(function () { return 0; });
  }

  /* Caches from the old workers, by the names they used. Ours all start
     with `emortia-`; anything else on this origin was theirs. */
  function sweepCaches() {
    if (!window.caches || !caches.keys) return Promise.resolve();
    return caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('emortia-') !== 0;
      }).map(function (k) {
        console.info('[pwa] dropping stale cache ' + k);
        return caches.delete(k);
      }));
    }).catch(function () {});
  }

  /* ---- 2. ours ---- */
  function register() {
    /* updateViaCache:'none' means the browser never serves sw.js itself out
       of the HTTP cache, so a bad worker is always one deploy from fixed. */
    return navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(function (reg) {
        /* Ask on every load and when the tab comes back, rather than waiting
           for the browser's own daily check. */
        var poke = function () { reg.update().catch(function () {}); };
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') poke();
        });
        setTimeout(poke, 1000);
        return reg;
      })
      .catch(function (e) { console.warn('[pwa] registration failed', e); });
  }

  /* One reload when a genuinely new worker takes over - never on the first
     install, where there was no controller to replace, or the first visit
     turns into a loop. */
  var had = !!navigator.serviceWorker.controller, reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!had || reloading) return;
    reloading = true;
    location.reload();
  });

  ready = sweep().then(sweepCaches).then(register);

  /* ---- 3. songs kept for offline ----
     The worker does the fetching; this is the doorbell. Nothing is saved
     unless somebody asks for it by name. */
  function ask(msg) {
    return new Promise(function (resolve, reject) {
      navigator.serviceWorker.ready.then(function (reg) {
        var sw = reg.active || navigator.serviceWorker.controller;
        if (!sw) return reject(new Error('no worker yet'));
        var ch = new MessageChannel(), done = false;
        var t = setTimeout(function () { if (!done) { done = true; reject(new Error('timed out')); } }, 120000);
        ch.port1.onmessage = function (e) { if (done) return; done = true; clearTimeout(t); resolve(e.data); };
        sw.postMessage(msg, [ch.port2]);
      }, reject);
    });
  }

  API.saved = function () {
    return ask({ type: 'audio-list' }).then(function (r) { return (r && r.urls) || []; })
      .catch(function () { return []; });
  };
  API.save = function (url) {
    return ask({ type: 'save-audio', url: new URL(url, location.href).pathname })
      .then(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || 'could not save'); return true; });
  };
  API.drop = function (url) {
    return ask({ type: 'drop-audio', url: new URL(url, location.href).pathname }).then(function () { return true; });
  };
  API.version = function () {
    return ask({ type: 'version' }).then(function (r) { return r && r.version; }).catch(function () { return null; });
  };

  /* ---- 4. installing ----
     The event only fires where the browser is willing, and never once the
     app is already installed, so its arrival is the whole test. */
  var deferred = null;
  API.canInstall = function () { return !!deferred; };
  API.installed = function () {
    return matchMedia('(display-mode: standalone)').matches ||
           matchMedia('(display-mode: minimal-ui)').matches ||
           navigator.standalone === true;
  };
  API.install = function () {
    if (!deferred) return Promise.resolve(false);
    var p = deferred; deferred = null;
    p.prompt();
    return p.userChoice.then(function (c) {
      var ok = c && c.outcome === 'accepted';
      if (!ok) deferred = p;                 // said no; let them find it again later
      announce();
      return ok;
    });
  };

  function announce() {
    try {
      window.dispatchEvent(new CustomEvent('emortia:install-state', {
        detail: { canInstall: !!deferred && !API.installed(), installed: API.installed() }
      }));
    } catch (e) {}
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    announce();
  });
  window.addEventListener('appinstalled', function () { deferred = null; announce(); });

  API.ready = ready;
})();
