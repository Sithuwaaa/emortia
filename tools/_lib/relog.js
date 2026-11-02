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
    if (v === null || typeof v !== 'object') {
      var t = JSON.stringify(v);
      /* undefined has no JSON form, and `'' + undefined` would make it the
         string "undefined" - so two half-loaded models would compare
         equal and the render would be skipped. Refused on purpose. The
         old code reached the same answer by throwing on `undefined.length`
         one frame later, which is the right answer by accident. */
      if (t === undefined) throw new Error('relog: undefined is not fingerprintable');
      return t;
    }
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
     different size can never match, whatever the hash does.

     WHERE WH24's 250.6ms COMES FROM, since the obvious answer is wrong.
     I rewrote this to fold the hash as it walked, on the theory that
     building one enormous string was the cost. Measured, folding was
     18.1ms against 16.7ms for the string - no faster, slightly slower -
     and BOTH were nowhere near 250ms, so the premise was false and the
     rewrite is gone.

     The cost is the DATA. wh24Load reads '*' and wh24_tickets carries
     four jsonb columns - gins, timeline, lines, doc. 820 tickets with
     gins alone populated is 2.8 MB of canonical form and 88ms; four such
     columns is a quarter of a second, which is exactly what was measured.
     Materials reads six narrow columns, so 2,422 rows cost 7ms.

     Which leaves a real question this file cannot answer by itself:
     whether a quarter second to decide costs more than the repaint it
     is avoiding. That is what renderMs is in the record for. If render
     turns out cheap, the right answer for WH24 is to drop the skip, not
     to make the comparison cleverer - a projection that fingerprints
     only what the render reads would be faster and would drift from what
     the render reads, which this repository has already paid for once. */
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
  var clock = function () {
    return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
  };
  var ms = function (n) { return Math.round(n * 10) / 10; };

  /* entry(tool, why, before, after, o)
       o.key     pairs rows so nChanged can be counted
       o.rows    [before, after] to COUNT, when what is COMPARED is a
                 composite. WH24 compares [TICKETS, MARKS, CHECKED] but
                 the interesting count is tickets, and a log line reading
                 "rows 3->3" for a 2,627-row table is a figure about the
                 wrong thing.
       o.render  called when it decides to paint, and timed
       o.decides false for a record-only read */
  function entry(tool, why, before, after, o) {
    o = o || {};
    var rows = o.rows || [before, after];
    var decides = o.decides !== false, render = o.render;
    var t0 = clock();
    var a = sig(before), b = sig(after);
    var n = changed(rows[0], rows[1], o.key);
    var t1 = clock();

    /* THE DECISION AND THE RECORD ARE ONE EVENT, which is why they are in
       one function. They were two calls - shouldRender() in the page, then
       mark() in the page - and the first reading showed what that costs:
       WH24 printed "held" and Materials never did, because the word lived
       in a console line I had written into one page and not the other. The
       skip was working in both. Only the log was asymmetric, in the file
       whose whole purpose is that two tools cannot answer differently. */
    var paint = null, renderMs = null;
    if (decides) {
      paint = (a === null || b === null) ? true : a !== b;
      if (paint && typeof render === 'function') {
        var t2 = clock();
        try { render(); } finally { renderMs = ms(clock() - t2); }
      }
    }

    var now = Date.now();
    var gap = last[tool] == null ? null : now - last[tool];
    last[tool] = now;

    var rec = {
      tool: tool,
      why: why == null ? 'realtime event' : String(why),
      at: new Date(now).toISOString(),
      gapMs: gap,
      /* null, not false, when a signature could not be taken. The same
         discipline as nChanged: "unknown" never wears the look of a
         measured answer. */
      differs: (a === null || b === null) ? null : a !== b,
      nBefore: Array.isArray(rows[0]) ? rows[0].length : null,
      nAfter: Array.isArray(rows[1]) ? rows[1].length : null,
      nChanged: n,
      fpMs: ms(t1 - t0),
      painted: paint,
      renderMs: renderMs
    };
    log.push(rec);
    if (log.length > CAP) log.shift();

    if (root.console && console.info)
      console.info('[relog] ' + tool +
        ' | ' + rec.why +
        ' | +' + (gap == null ? 'first' : gap + 'ms') +
        ' | ' + (rec.differs === null ? 'UNKNOWN' : rec.differs ? 'CHANGED' : 'no change') +
        ' | ' + (paint === null ? 'not deciding'
                 : paint ? 'PAINTED' + (renderMs == null ? '' : ' ' + renderMs + 'ms')
                 : 'HELD') +
        ' | rows ' + rec.nBefore + '→' + rec.nAfter +
        ' | changed ' + (n == null ? '-' : n) +
        ' | fp ' + rec.fpMs + 'ms');
    return rec;
  }

  /* Record only. Kept for the reads that are not deciding anything. */
  function mark(tool, why, before, after, key) {
    return entry(tool, why, before, after, { key: key, decides: false });
  }

  /* Decide, paint, and record - the call both tools make. Returns whether
     it painted, so a caller that passed no render can do it itself. */
  function decide(tool, why, before, after, o) {
    o = o || {}; o.decides = true;
    return entry(tool, why, before, after, o).painted;
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

  var API = { mark: mark, decide: decide, dump: dump, rate: rate, fp: fp, sig: sig,
              shouldRender: shouldRender, canon: canon,
              changed: changed, COALESCE: COALESCE,
              reset: function () { log = []; last = {}; } };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (root) root.RELOG = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
