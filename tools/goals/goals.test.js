/* goals.test.js - the money, and where it goes wrong.

     node tools/goals/goals.test.js

   The arithmetic is the tool. A percentage that creeps past 100, a total
   that counts an achieved goal twice, an overdue marker that fires a month
   early - none of those throw, and all of them read plausibly on screen,
   which is the only reason this file exists.

   Figures are invented. No real plans, no real amounts.
*/
const M = require('./goals.js');
const S = require('./store.js');

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

const g = o => Object.assign({ id: 'x', name: 'thing', cat: 'self', target: 0,
  saved: 0, month: null, year: 2026, note: '', done: false }, o);

/* ---------------------------------------------------------------- pct --- */
is('no cost, not done',            M.pct(g({})), 0);
is('half saved',                   M.pct(g({ target: 1000, saved: 500 })), 50);
is('rounds to the nearest point',  M.pct(g({ target: 3000, saved: 1000 })), 33);
is('nothing saved',                M.pct(g({ target: 1000 })), 0);
is('exactly funded',               M.pct(g({ target: 1000, saved: 1000 })), 100);
/* over-saving must not report more than full */
is('oversaved still reads 100',    M.pct(g({ target: 1000, saved: 4000 })), 100);
/* done beats the saved figure, which often stops being updated */
is('done with nothing saved',      M.pct(g({ target: 1000, saved: 0, done: true })), 100);
is('done with no cost at all',     M.pct(g({ done: true })), 100);
is('negative saved is zero',       M.pct(g({ target: 1000, saved: -50 })), 0);
is('rubbish saved is zero',        M.pct(g({ target: 1000, saved: 'soon' })), 0);

/* ------------------------------------------------------------- funded --- */
is('funded is capped at target',   M.funded(g({ target: 1000, saved: 4000 })), 1000);
is('a done goal funds its target', M.funded(g({ target: 1000, saved: 0, done: true })), 1000);
is('no target, nothing funded',    M.funded(g({ saved: 500 })), 0);

/* ------------------------------------------------------------ summary --- */
{
  const year = [
    g({ id: 'a', target: 2000, saved: 500 }),
    g({ id: 'b', target: 1000, saved: 1000 }),
    g({ id: 'c', target: 1000, saved: 0, done: true }),
    g({ id: 'd' })                                    /* no cost, not done */
  ];
  const s = M.summary(year);
  is('counts every goal',            s.count, 4);
  is('counts the achieved',          s.done, 1);
  is('counts what is left',          s.open, 3);
  is('adds the targets',             s.target, 4000);
  is('adds what is put aside',       s.saved, 2500);
  is('and what is still needed',     s.remaining, 1500);
  is('percent is of money, not count', s.pct, 63);
}
{
  /* THE OVERSAVE CASE, which is why funded() caps. Without the cap this
     reads 150% funded while two of the three are still unbought. */
  const s = M.summary([
    g({ target: 1000, saved: 5000 }),
    g({ target: 1000 }),
    g({ target: 1000 })
  ]);
  is('one oversaved goal cannot fund the others', s.saved, 1000);
  is('and the headline stays honest',             s.pct, 33);
}
{
  /* a year of yes/no goals still deserves a ring */
  const s = M.summary([g({ done: true }), g({}), g({ done: true }), g({})]);
  is('with no costs it counts achievements', s.pct, 50);
  is('and reports no money',                 [s.target, s.saved], [0, 0]);
}
is('an empty year is zero, not NaN', M.summary([]).pct, 0);
is('an empty year has no remainder', M.summary([]).remaining, 0);

/* ------------------------------------------------------------ overdue --- */
const JUN = new Date(2026, 5, 15);          /* 15 June 2026 */
is('due in March, now June',       M.overdue(g({ year: 2026, month: 2 }), JUN), true);
is('due THIS month is not late',   M.overdue(g({ year: 2026, month: 5 }), JUN), false);
is('due in September',             M.overdue(g({ year: 2026, month: 8 }), JUN), false);
is('any time this year',           M.overdue(g({ year: 2026, month: null }), JUN), false);
is('last year, any time, is late', M.overdue(g({ year: 2025, month: null }), JUN), true);
is('next year is not late',        M.overdue(g({ year: 2027, month: 0 }), JUN), false);
is('an achieved goal is never late',
   M.overdue(g({ year: 2025, month: 0, done: true }), JUN), false);

is('the late label says was due',  M.label(g({ year: 2026, month: 2 }), JUN), 'Was due Mar 2026');
is('the coming label says by',     M.label(g({ year: 2026, month: 8 }), JUN), 'By Sep 2026');
is('no month, no deadline',        M.label(g({ month: null }), JUN), 'Any time this year');
is('an achieved goal has no due line', M.label(g({ month: 2, done: true }), JUN), '');

/* -------------------------------------------------------------- money --- */
is('thousands are grouped',        M.money('Rs', 1240000), 'Rs 1,240,000');
is('cents are not shown',          M.money('Rs', 1999.6), 'Rs 2,000');
is('zero reads as zero',           M.money('$', 0), '$ 0');
is('rubbish reads as zero',        M.money('Rs', 'later'), 'Rs 0');

/* -------------------------------------------------------------- store --- */
{
  /* the backend is swappable, which is the whole reason store.js exists */
  let mem = null;
  S.use({ read: () => mem, write: v => { mem = v; return true; } });

  (async () => {
    let st = await S.load();
    is('an empty store opens empty',   [st.cur, st.goals.length], ['Rs', 0]);

    st = S.upsert(st, { name: 'Car', cat: 'vehicle', target: '2000000', saved: '250000', month: '8', year: 2026 });
    is('upsert adds one',              st.goals.length, 1);
    is('and gives it an id',           st.goals[0].id.length > 0, true);
    is('numbers arrive as numbers',    [st.goals[0].target, st.goals[0].saved], [2000000, 250000]);
    is('the month is an index',        st.goals[0].month, 8);

    const id = st.goals[0].id;
    st = S.upsert(st, Object.assign({}, st.goals[0], { saved: '400000' }));
    is('upsert by id replaces',        st.goals.length, 1);
    is('and keeps the change',         st.goals[0].saved, 400000);

    await S.save(st);
    st = await S.load();
    is('it survives a round trip',     st.goals[0].saved, 400000);

    st = S.currency(st, '$');
    await S.save(st);
    st = await S.load();
    is('the currency round-trips',     st.cur, '$');

    st = S.remove(st, id);
    is('remove takes it out',          st.goals.length, 0);

    /* a corrupt key must open empty rather than refuse to open */
    S.use({ read: () => ({ cur: 5, goals: 'not an array' }), write: () => true });
    st = await S.load();
    is('rubbish opens as an empty year', [st.cur, st.goals], ['Rs', []]);

    /* a full disk is the user losing work; the caller has to be able to know */
    S.use({ read: () => null, write: () => false });
    is('a failed write says so',       await S.save({ cur: 'Rs', goals: [] }), false);

    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(fail ? 1 : 0);
  })();
}
