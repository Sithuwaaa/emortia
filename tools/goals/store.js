/* store.js - the only thing in Year Goals that knows where goals are kept.

   WHY THIS IS A MODULE AND NOT A HANDFUL OF localStorage CALLS.

   The tool ships local-only: the goals live in this browser and nowhere
   else. That is a deliberate choice and not a permanent one - the moment
   these want to be on a phone as well as a laptop they need a table, and
   at that point every caller that reached for localStorage directly is a
   call site to find and rewrite.

   So nothing outside this file touches storage. Callers get load, save,
   list, upsert, remove and currency, and have no idea what is underneath.
   Swapping the backend for db.js is then a change to ONE file: keep the
   same six functions, make them async, and the tool is synced.

   They are already async. There is no need for a localStorage read to
   return a promise, and that is exactly the point - a caller written
   against a synchronous store is a caller that breaks when the store
   becomes a network. Awaiting something instant costs a microtask; not
   awaiting something slow costs a rewrite.

   WHAT A GOAL IS
     { id, name, cat, target, saved, month, year, note, done }
   target and saved are numbers. month is 0-11 or null for "any time".
   done is a boolean; a done goal counts as fully funded regardless of
   saved, which is the rule the summary and the tests both use.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoalStore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'emortia_goals_v1';

  /* THE BACKEND. Everything above it is storage-agnostic; this is the only
     place that knows where a goal actually lives.

     The tool shipped against `local` and now runs against `remote`. The
     swap was this object and nothing else - no call site in index.html
     changed, which is the whole reason the file was shaped this way. */
  var local = {
    read: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return null;
        var v = JSON.parse(raw);
        return v && typeof v === 'object' ? v : null;
      } catch (e) { return null; }
    },
    write: function (state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
      catch (e) {
        /* A quota error here is the user losing work silently, which is the
           one thing this file exists to prevent. The caller is told. */
        return false;
      }
    }
  };

  /* The ids this store last put on the server. save() upserts what it is
     given, which can never delete: a goal removed from the array would
     simply stop being mentioned and would sit on the server for ever,
     reappearing on the next device that loaded. So the store remembers
     what it wrote and deletes the difference. The tool still just calls
     remove() then save(), exactly as it did against localStorage. */
  var lastIds = null;

  var remote = {
    read: function () { return null; },      /* unused; load() is overridden below */
    write: function () { return true; }
  };

  var backend = local, mode = 'local';

  /* for the tests, and for the day this becomes something else again */
  function use(b) { backend = b || local; mode = b ? 'custom' : 'local'; lastIds = null; }
  function syncing() { return mode === 'remote'; }

  var EMPTY = { cur: 'Rs', goals: [] };

  function clean(g) {
    var num = function (v) { var n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
    var mon = g.month === '' || g.month == null ? null : parseInt(g.month, 10);
    return {
      id: String(g.id || ''),
      name: String(g.name == null ? '' : g.name).trim(),
      cat: String(g.cat || 'self'),
      target: num(g.target),
      saved: num(g.saved),
      month: (mon != null && mon >= 0 && mon <= 11) ? mon : null,
      year: parseInt(g.year, 10) || new Date().getFullYear(),
      note: String(g.note == null ? '' : g.note).trim(),
      done: !!g.done
    };
  }

  function shape(v) {
    if (!v) return { cur: EMPTY.cur, goals: [] };
    return {
      cur: typeof v.cur === 'string' && v.cur ? v.cur : EMPTY.cur,
      /* Anything that is not an array of objects is treated as no goals
         rather than thrown: a corrupt key should not make the tool refuse
         to open, it should make it empty and savable. */
      goals: Array.isArray(v.goals) ? v.goals.filter(Boolean).map(clean) : []
    };
  }

  /* The local copy is kept as a CACHE even when syncing, and it is cheap:
     one setItem of a list that is tens of rows, not thousands. It earns its
     place the first morning the train has no signal - the year still opens,
     from the last state this device saw, instead of an error page. */
  function load() {
    if (mode !== 'remote') return Promise.resolve(shape(backend.read()));
    return window.DB.goalsLoad().then(function (r) {
      if (r.error) {
        /* A read that fails still hands back the cache, and says why. An
           empty list and a broken connection look identical otherwise, and
           "no goals this year" is a bad way to learn you are offline. */
        var cached = shape(local.read());
        cached.error = r.error;
        lastIds = null;              /* we do not know the server's ids */
        return cached;
      }
      var out = shape({ cur: r.cur, goals: r.goals });
      lastIds = out.goals.map(function (g) { return g.id; });
      local.write(out);
      return out;
    });
  }

  function save(state) {
    var out = {
      cur: (state && state.cur) || EMPTY.cur,
      goals: ((state && state.goals) || []).map(clean)
    };
    if (mode !== 'remote') return Promise.resolve(backend.write(out));

    var ids = out.goals.map(function (g) { return g.id; });
    var gone = (lastIds || []).filter(function (id) { return ids.indexOf(id) < 0; });
    /* write the cache first: if the network write fails the device still
       has what the person just typed */
    local.write(out);
    return Promise.all(
      [window.DB.goalsSave(out.goals), window.DB.goalsCurrency(out.cur)]
        .concat(gone.map(function (id) { return window.DB.goalsRemove(id); }))
    ).then(function () { lastIds = ids; return true; })
     .catch(function () { return false; });
  }

  /* Realtime lives behind the boundary too, so the tool asks the store to
     tell it when something changed and never learns there is a channel.
     The shape is the one step 3 landed on: patch from the payload, refetch
     only what the payload cannot describe, tear down on hide, and refetch
     on show because postgres_changes does not replay a gap. */
  function watch(onChange) {
    if (mode !== 'remote' || !window.DB || !window.DB.goalsSubscribe) return function () {};
    var off = null, soon = null, backstop = null, lastStatus = null, dead = false;

    var refetchSoon = function () {
      clearTimeout(soon);
      soon = setTimeout(function () { soon = null; onChange({ reload: true }); }, 900);
    };
    var handle = function (e) {
      if (e.type === 'status') {
        if (e.status === 'SUBSCRIBED' && lastStatus && lastStatus !== 'SUBSCRIBED')
          onChange({ reload: true, why: 'channel returned after ' + lastStatus });
        lastStatus = e.status;
        return;
      }
      if (e.type === 'DELETE' && e.id) return onChange({ remove: String(e.id) });
      if (!e.usable) return refetchSoon();
      onChange({ patch: clean(e.row) });
    };
    var up = function () {
      if (off || dead) return;
      window.DB.goalsSubscribe(handle).then(function (t) {
        if (dead && t) { t(); return; }
        off = t;
      });
    };
    var down = function () { if (off) { off(); off = null; lastStatus = null; } };
    var beat = function (on) {
      clearInterval(backstop); backstop = null;
      if (on) backstop = setInterval(function () { onChange({ reload: true, why: '15 minute backstop' }); }, 900000);
    };
    var vis = function () {
      if (document.hidden) { down(); beat(false); clearTimeout(soon); soon = null; }
      else { up(); beat(true); onChange({ reload: true, why: 'tab became visible' }); }
    };
    document.addEventListener('visibilitychange', vis);
    up(); beat(true);
    return function () {
      dead = true; down(); beat(false); clearTimeout(soon);
      document.removeEventListener('visibilitychange', vis);
    };
  }

  function list(state, opts) {
    opts = opts || {};
    var gs = ((state && state.goals) || []).slice();
    if (opts.year != null) gs = gs.filter(function (g) { return g.year === +opts.year; });
    if (opts.month != null) gs = gs.filter(function (g) { return g.month === +opts.month; });
    if (opts.filter === 'open') gs = gs.filter(function (g) { return !g.done; });
    if (opts.filter === 'done') gs = gs.filter(function (g) { return g.done; });
    /* unfinished first, then by target month, "any time" last */
    gs.sort(function (a, b) {
      return (a.done - b.done) ||
             ((a.month == null ? 12 : a.month) - (b.month == null ? 12 : b.month)) ||
             (a.name < b.name ? -1 : 1);
    });
    return gs;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function upsert(state, g) {
    var row = clean(g);
    if (!row.id) row.id = newId();
    var gs = (state.goals || []).slice();
    var at = gs.findIndex(function (x) { return x.id === row.id; });
    if (at < 0) gs.push(row); else gs[at] = row;
    return { cur: state.cur, goals: gs };
  }

  function remove(state, id) {
    return { cur: state.cur,
             goals: (state.goals || []).filter(function (g) { return g.id !== String(id); }) };
  }

  function currency(state, cur) {
    return { cur: String(cur || state.cur || EMPTY.cur), goals: (state.goals || []).slice() };
  }

  /* Sync when there is a database to sync with, and fall back to the
     browser when there is not - an offline page, or a build with no anon
     key. The tool does not ask which; it calls the same six functions.

     This is the whole swap. Shipping local-only and then syncing was a
     change to this file and a notice removed from the page. */
  if (typeof window !== 'undefined' && window.DB && window.DB.goalsLoad) {
    backend = remote; mode = 'remote';
  }

  return { load: load, save: save, list: list, upsert: upsert, remove: remove,
           currency: currency, watch: watch, clean: clean, newId: newId,
           use: use, syncing: syncing, KEY: KEY };
}));
