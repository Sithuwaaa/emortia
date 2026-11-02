/* relog.js - what a reload was for, when it happened, and whether it
   changed anything.

   WHY THIS EXISTS AND WHAT IT IS NOT. There is a theory that the flicker
   in Materials and WH24 is a reconcile re-rendering a whole list when
   nothing has changed. That theory is not confirmed, and the fix for it
   is not written. This file is the instrument that decides, and it is
   built so it can say NO.

   THREE FACTS PER RELOAD, and the third is the one that falsifies:

     why       the trigger. liveChannel hands a string for each of its
               three reconcile paths and UNDEFINED for a real
               postgres_changes event, so the two are distinguishable -
               which is the whole question.
     when      a timestamp, and the gap since the previous reload.
     differs   whether the data that came back differs from what was on
               screen when the reload started.

   THE GAP IS THE FALSIFIER. Nothing in the three reconcile paths can
   fire fast enough to produce flicker you watch happen. Becoming
   visible is a person alt-tabbing. A resubscribe is the network. The
   backstop is every 900000 ms. And a real event is coalesced on a 1200
   ms trailing edge in both liveChannel and wh24's own path, so even a
   sync writing hundreds of rows cannot drive a reload more often than
   that. A log showing repeated gaps under 1200 ms is a log saying the
   theory is WRONG and something else is calling reload. That reading
   matters more than a confirmation, so `rate()` prints it first.

   THE INSTRUMENT'S OWN COST IS LOGGED. Deciding `differs` means
   fingerprinting the whole model, which at a few thousand rows is not
   free. An instrument that silently spends 20 ms inside the thing it is
   timing produces a number about itself. So `fpMs` is in every record,
   and if it dominates the reading, the reading says so.

   nChanged IS null, NEVER 0, WHEN IT CANNOT BE COMPUTED. It needs a key
   function to pair rows across the two sets. Without one there is no
   count, and a 0 standing in for "unknown" is a figure printed with a
   confidence it has not earned.

   Nothing here is on a page's critical path and nothing here renders.
   It records and prints. Removing the script tag removes the whole of
   it. */
(function (root) {
  'use strict';

  var CAP = 400;            /* ring buffer; flicker scrolls a console away */
  var COALESCE = 1200;      /* liveChannel's wait, and wh24's refetchSoon */
  var log = [];
  var last = {};            /* per tool: the previous record's time */

  /* ---- fingerprint -----------------------------------------------------
     Key order out of PostgREST is stable per query, but it is stable by
     habit rather than by contract, and a fingerprint that changes when
     nothing did would manufacture the very finding this is meant to
     test. So keys are sorted. */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) {
      var a = '[';
      for (var i = 0; i < v.length; i++) a += (i ? ',' : '') + canon(v[i]);
      return a + ']';
    }
    var ks = Object.keys(v).sort(), s = '{';
    for (var j = 0; j < ks.length; j++)
      s += (j ? ',' : '') + JSON.stringify(ks[j]) + ':' + canon(v[ks[j]]);
    return s + '}';
  }

  /* FNV-1a over the canonical string. A hash collision would report
     "nothing changed" when something did - the wrong way round for a
     guard - so the length goes in the fingerprint too: two models of
     different size can never match, whatever the hash does. */
  function fp(v) {
    var s = canon(v), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return s.length + ':' + h.toString(16);
  }

  /* A fingerprint, or null when one cannot be taken. JSON.stringify
     throws on a circular reference and on BigInt, and a model that
     cannot be serialised is not a model that can be declared unchanged. */
  function sig(v) {
    try { return fp(v); } catch (e) { return null; }
  }

  /* ---- THE SKIP DECISION ----------------------------------------------
     shouldRender(before, after) - the whole of it, in one place, so the
     two tools cannot answer it differently and so it can be broken on
     purpose in a test.

     UNKNOWN RENDERS. The two failure directions are not symmetrical and
     this is the entire design:

       rendering when nothing changed   costs a redundant repaint.
       skipping when something changed   shows the user stale data and
                                        says nothing. The tab looks
                                        live and is not, which is the
                                        failure this project keeps
                                        producing.

     So the only path to `false` is BOTH signatures computable AND
     identical. No signature, one signature, a thrown serialiser, a
     missing RELOG - every one of those renders. The default is the
     expensive answer, deliberately. */
  function shouldRender(before, after) {
    var a = sig(before), b = sig(after);
    if (a === null || b === null) return true;
    return a !== b;
  }

  /* How many rows actually differ, when the caller can pair them. */
  function changed(before, after, key) {
    if (!key || !Array.isArray(before) || !Array.isArray(after)) return null;
    var m = {}, n = 0, i, k;
    for (i = 0; i < before.length; i++) {
      k = key(before[i]); if (k == null) return null;
      m[k] = canon(before[i]);
    }
    var seen = {};
    for (i = 0; i < after.length; i++) {
      k = key(after[i]); if (k == null) return null;
      seen[k] = 1;
      if (m[k] !== canon(after[i])) n++;          /* new row, or altered */
    }
    for (k in m) if (!seen[k]) n++;               /* gone */
    return n;
  }

  /* ---- the one call a page makes ---------------------------------------
     mark(tool, why, before, after, key) - `before` is the model as it
     stood on screen when the reload began, `after` is what came back. */
  function mark(tool, why, before, after, key) {
    var t0 = (root.performance && root.performance.now) ? root.performance.now() : 0;
    var a = fp(before), b = fp(after);
    var n = changed(before, after, key);
    var t1 = (root.performance && root.performance.now) ? root.performance.now() : 0;

    var now = Date.now();
    var gap = last[tool] == null ? null : now - last[tool];
    last[tool] = now;

    var rec = {
      tool: tool,
      why: why == null ? 'realtime event' : String(why),
      at: new Date(now).toISOString(),
      gapMs: gap,
      differs: a !== b,
      nBefore: Array.isArray(before) ? before.length : null,
      nAfter: Array.isArray(after) ? after.length : null,
      nChanged: n,
      fpMs: Math.round((t1 - t0) * 10) / 10
    };
    log.push(rec);
    if (log.length > CAP) log.shift();

    if (root.console && console.info)
      console.info('[relog] ' + tool +
        ' | ' + rec.why +
        ' | +' + (gap == null ? 'first' : gap + 'ms') +
        ' | ' + (rec.differs ? 'CHANGED' : 'no change') +
        ' | rows ' + rec.nBefore + '→' + rec.nAfter +
        ' | changed ' + (n == null ? '-' : n) +
        ' | fp ' + rec.fpMs + 'ms');
    return rec;
  }

  /* ---- reading it back -------------------------------------------------
     dump() is the records. rate() is the question: can the three
     reconcile paths account for how often this fired? */
  function dump(tool) {
    return tool ? log.filter(function (r) { return r.tool === tool; }) : log.slice();
  }

  function rate(tool) {
    var rs = dump(tool);
    if (!rs.length) return { records: 0, note: 'nothing logged yet' };
    var gaps = rs.map(function (r) { return r.gapMs; })
                 .filter(function (g) { return g != null; });
    var fast = gaps.filter(function (g) { return g < COALESCE; });
    var byWhy = {};
    rs.forEach(function (r) { byWhy[r.why] = (byWhy[r.why] || 0) + 1; });
    var out = {
      records: rs.length,
      spanMin: Math.round((Date.parse(rs[rs.length - 1].at) - Date.parse(rs[0].at)) / 600) / 100,
      byWhy: byWhy,
      changedCount: rs.filter(function (r) { return r.differs; }).length,
      noChangeCount: rs.filter(function (r) { return !r.differs; }).length,
      minGapMs: gaps.length ? Math.min.apply(null, gaps) : null,
      medianGapMs: gaps.length ? gaps.slice().sort(function (a, b) { return a - b; })[gaps.length >> 1] : null,
      gapsUnderCoalesce: fast.length,
      /* the falsifying read, stated so it cannot be skimmed past */
      verdict: fast.length
        ? 'THE THREE RECONCILE PATHS CANNOT ACCOUNT FOR THIS. ' + fast.length +
          ' reload(s) came less than ' + COALESCE + 'ms after the one before, ' +
          'which is shorter than the coalescing window. Something other than ' +
          'the reconcile is calling reload.'
        : 'Consistent with the reconcile paths: no reload came sooner than ' +
          COALESCE + 'ms after the one before.'
    };
    return out;
  }

  var API = { mark: mark, dump: dump, rate: rate, fp: fp, sig: sig,
              shouldRender: shouldRender, canon: canon,
              changed: changed, COALESCE: COALESCE,
              reset: function () { log = []; last = {}; } };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.RELOG = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
