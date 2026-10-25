/* goals.js - the arithmetic, kept out of the page so it can be tested.

   The sums are the whole point of this tool. "73% funded", "Rs 240,000
   still needed", "was due March" - those are the numbers somebody plans
   a year around, and they are exactly the kind that go wrong quietly:
   a percentage over 100, a total that counts a finished goal twice, an
   overdue marker that fires in December for a goal due in January.

   None of that throws. It just reads wrong, and it reads plausibly.
   So it lives here, as plain functions over plain objects, and
   goals.test.js checks the answers rather than the shapes.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoalMath = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function num(v) { var n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; }

  /* How far along one goal is, 0-100.

     A DONE GOAL IS 100, whatever its saved figure says. Marking something
     achieved is the person telling you it happened; the saved number is a
     running note that often stops being updated the moment it does.

     A goal with no cost has no percentage to give - it is a yes/no thing
     like "learn to swim" - so it reports 0 until it is done. */
  function pct(g) {
    if (!g) return 0;
    if (g.done) return 100;
    var t = num(g.target);
    if (!t) return 0;
    return Math.min(100, Math.round(num(g.saved) / t * 100));
  }

  /* What a goal counts as having put aside.

     CAPPED AT THE TARGET on purpose. Over-saving against one goal does not
     fund another, and letting it spill made the headline percentage climb
     past 100 while things were still unbought. A done goal counts its full
     target, for the same reason pct does. */
  function funded(g) {
    if (!g) return 0;
    var t = num(g.target);
    if (g.done) return t;
    return t ? Math.min(num(g.saved), t) : 0;
  }

  /* The year in one object. */
  function summary(goals) {
    var gs = (goals || []).filter(Boolean);
    var target = 0, saved = 0, done = 0;
    gs.forEach(function (g) {
      target += num(g.target);
      saved += funded(g);
      if (g.done) done++;
    });
    var p;
    if (target > 0) p = Math.round(saved / target * 100);
    /* No costs anywhere: fall back to how many are achieved, so a year of
       non-money goals still has a ring that means something. */
    else p = gs.length ? Math.round(done / gs.length * 100) : 0;
    return {
      count: gs.length, done: done, open: gs.length - done,
      target: target, saved: saved,
      remaining: Math.max(0, target - saved),
      pct: Math.min(100, p)
    };
  }

  /* Is this goal past its month?

     NOT overdue when it is done - an achieved goal cannot be late.
     NOT overdue with no month - "any time this year" has no deadline until
     the year itself is over.
     A goal due THIS month is not late yet; you have the month. */
  function overdue(g, today) {
    if (!g || g.done) return false;
    var now = today || new Date();
    var y = now.getFullYear(), m = now.getMonth();
    if (g.year > y) return false;
    if (g.year < y) return true;              /* a past year, done or not */
    if (g.month == null) return false;        /* any time, and the year is still running */
    return g.month < m;
  }

  function label(g, today) {
    if (!g) return '';
    if (g.done) return '';
    if (g.month == null) return 'Any time this year';
    return (overdue(g, today) ? 'Was due ' : 'By ') + MON[g.month] + ' ' + g.year;
  }

  /* "Rs 1,240,000" - no decimals. These are year-sized numbers and the
     cents are noise. */
  function money(cur, n) {
    return (cur || 'Rs') + ' ' + Math.round(num(n)).toLocaleString('en-US');
  }

  /* The per-month dots on the strip. */
  function byMonth(goals) {
    var out = [];
    for (var i = 0; i < 12; i++) out.push([]);
    (goals || []).forEach(function (g) { if (g && g.month != null) out[g.month].push(g); });
    return out;
  }

  return { pct: pct, funded: funded, summary: summary, overdue: overdue,
           label: label, money: money, byMonth: byMonth, MON: MON, num: num };
}));
