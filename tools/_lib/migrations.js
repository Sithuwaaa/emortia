/* migrations.js - which migrations have actually run.

   THE PROBLEM THIS EXISTS FOR. Nothing anywhere records which migrations
   have been applied. They are pasted into the Supabase SQL editor by
   hand, so the migration table is empty and the repo has no idea. That is
   how 044 sat unrun for a week while WH24 showed zeros on an office
   laptop with no way to check, and how 034 was argued about rather than
   answered. A tool that cannot say "this is not switched on yet" says
   "there is no data" instead, which is the same sentence a working empty
   table produces.

   WHY A PROBE AND NOT A QUERY. PostgREST does not expose
   information_schema and the test runner cannot reach the database at
   all. What a signed-in page CAN do is ask for one column of one table
   and read the error: PostgREST answers a missing table and a missing
   column with distinct, stable messages. So each migration gets the
   cheapest possible read of something it creates - `select <col> limit 1`
   - and the answer is applied / missing / refused / unverifiable.

   WHY THE LIST IS GENERATED AND NOT WRITTEN. A hand-kept list of probes
   drifts from the folder the moment somebody adds a migration and
   forgets, and a checker that silently stops covering a migration is
   worse than none. PROBES below is produced from supabase/*.sql by
   migrations.test.js, which regenerates it on every run and fails if what
   is committed here differs. Adding a migration therefore breaks the
   suite until this file is regenerated, which is the point.

   THE RULE IT IS BUILT AROUND: it must never be able to say "all
   applied" when it could not check. A migration that creates no table and
   no column - policies only, or functions only - is UNVERIFIABLE, and
   unverifiable is reported separately and loudly. It is not applied and
   it is not missing; it is unknown, and the summary refuses to call a run
   clean while any remain unknown. Functions are deliberately not probed
   by calling them: some of them write.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Migrations = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* GENERATED - run `node tools/_lib/migrations.test.js --write` to refresh.
     Each entry: { file, table, col }. col null means "the table alone is
     the evidence". A migration with no entry is unverifiable. */
  var PROBES = [];
  var UNVERIFIABLE = [];

  /* PostgREST's own wording, which is what the probe reads. These are the
     same two messages db.js's error translators key on, and they have
     been stable across every incident this repository has recorded. */
  function classify(err) {
    var m = String((err && err.message) || err || '');
    if (/could not find the table|relation .* does not exist/i.test(m)) return 'missing';
    if (/column .* does not exist|could not find the .* column/i.test(m)) return 'missing';
    if (/jwt|not authenticated|row-level security|permission denied/i.test(m)) return 'refused';
    if (/fetch|network|failed to|timeout|offline/i.test(m)) return 'unreachable';
    return 'error';
  }

  /* check(ask) where ask(table, col) resolves to { error } - the caller
     supplies it so this file never imports db.js and the test can drive
     it without a network.

     Every probe is awaited. A probe that could not be run is NOT an
     applied one: 'refused' and 'unreachable' are their own answers, and
     the summary below treats them as reasons the whole run is unusable
     rather than as migrations that happen to be fine. */
  function check(ask, list) {
    var probes = list || PROBES;
    return Promise.all(probes.map(function (p) {
      return Promise.resolve()
        .then(function () { return ask(p.table, p.col); })
        .then(function (r) {
          if (r && r.error) return { file: p.file, state: classify(r.error), why: String(r.error.message || r.error) };
          return { file: p.file, state: 'applied', why: null };
        }, function (e) {
          return { file: p.file, state: classify(e), why: String(e && e.message || e) };
        });
    })).then(function (rows) {
      UNVERIFIABLE.forEach(function (u) {
        rows.push({ file: u.file, state: 'unverifiable', why: u.why });
      });
      rows.sort(function (a, b) { return a.file < b.file ? -1 : a.file > b.file ? 1 : 0; });
      return rows;
    });
  }

  /* THE SENTENCE. It can only say everything is applied when nothing was
     missing AND nothing was unverifiable AND nothing could not be asked.
     An "all clear" that a refused or unreachable probe can produce is the
     check-that-cannot-fail shape, and this guard exists to stop that
     class, so it must not be an instance of it. */
  function summary(rows) {
    var by = function (s) { return rows.filter(function (r) { return r.state === s; }); };
    var missing = by('missing'), unver = by('unverifiable');
    var refused = by('refused'), unreach = by('unreachable'), erred = by('error');
    var blocked = refused.concat(unreach).concat(erred);
    /* rows.length FIRST. Without it an empty probe list has nothing
       missing, nothing unverifiable and nothing blocked, so it reports a
       clean bill of health for a run that asked no questions - the
       check-that-cannot-fail shape, inside the guard written to stop that
       class. The test for it is the assertion that caught it. */
    var clean = rows.length > 0 && !missing.length && !unver.length && !blocked.length;

    var line;
    if (!rows.length) line = 'NOTHING WAS CHECKED - there are no probes, which is not the same as nothing being wrong.';
    else if (missing.length) line = missing.length + ' MIGRATION' + (missing.length > 1 ? 'S HAVE' : ' HAS') +
      ' NOT BEEN RUN: ' + missing.map(function (r) { return r.file; }).join(', ');
    else if (blocked.length) line = 'COULD NOT CHECK ' + blocked.length + ' of ' + rows.length +
      ' - ' + blocked[0].state + '. Nothing here says the rest are fine.';
    else if (unver.length) line = 'Nothing missing among the ' + by('applied').length +
      ' that can be checked. ' + unver.length + ' cannot be checked at all - ' +
      unver.map(function (r) { return r.file; }).join(', ');
    else line = 'All ' + rows.length + ' migrations are applied.';

    return {
      clean: clean, line: line,
      applied: by('applied').length,
      missing: missing.map(function (r) { return r.file; }),
      unverifiable: unver.map(function (r) { return r.file; }),
      blocked: blocked.map(function (r) { return { file: r.file, state: r.state, why: r.why }; }),
      total: rows.length
    };
  }

  /* the probe a page runs, given window.DB's client */
  function asker(from) {
    return function (table, col) {
      return from(table).select(col || '*').limit(1);
    };
  }

  function load(probes, unverifiable) {
    PROBES = probes || []; UNVERIFIABLE = unverifiable || [];
  }

  return { check: check, summary: summary, classify: classify, asker: asker,
           load: load,
           get PROBES() { return PROBES; },
           get UNVERIFIABLE() { return UNVERIFIABLE; } };
}));
