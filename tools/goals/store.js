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

  /* The backend. Everything above it is storage-agnostic; everything in it
     is the only place that says "localStorage". A sync version replaces
     exactly this object. */
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

  var backend = local;
  /* for the tests, and for the day this becomes a table */
  function use(b) { backend = b || local; }

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

  function load() {
    var v = backend.read();
    if (!v) return Promise.resolve({ cur: EMPTY.cur, goals: [] });
    return Promise.resolve({
      cur: typeof v.cur === 'string' && v.cur ? v.cur : EMPTY.cur,
      /* Anything that is not an array of objects is treated as no goals
         rather than thrown: a corrupt key should not make the tool refuse
         to open, it should make it empty and savable. */
      goals: Array.isArray(v.goals) ? v.goals.filter(Boolean).map(clean) : []
    });
  }

  function save(state) {
    var out = {
      cur: (state && state.cur) || EMPTY.cur,
      goals: ((state && state.goals) || []).map(clean)
    };
    return Promise.resolve(backend.write(out));
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

  return { load: load, save: save, list: list, upsert: upsert, remove: remove,
           currency: currency, clean: clean, newId: newId, use: use, KEY: KEY };
}));
