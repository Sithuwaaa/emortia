/* relog.test.js - the instrument, checked against answers already known.

     node tools/_lib/relog.test.js

   THE STANDING RULE FROM THE DECISIONS FILE: a measurement is not a
   finding until the harness that produced it has been checked against a
   case whose answer is already known. Black on white is 21.

   The known answers here are smaller and just as cheap. Two identical
   lists do not differ. A list with one field changed does, by exactly
   one row. A reload 300 ms after the last one is faster than any
   coalescing window in the project, so the verdict must say the
   reconcile cannot account for it - because THAT is the reading this
   instrument exists to be able to produce. An instrument that can only
   confirm is not an instrument.

   Fixtures are invented: no real material code, ticket or site. */
const fs = require('fs');
const path = require('path');
const R = require(path.join(__dirname, 'relog.js'));

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- 1. the fingerprint ---------------------------------------------- */
console.log('the fingerprint');
is('key order does not change it',
   R.fp([{ a: 1, b: 2 }]), R.fp([{ b: 2, a: 1 }]));
is('nested key order does not either',
   R.fp([{ x: { p: 1, q: 2 } }]), R.fp([{ x: { q: 2, p: 1 } }]));
is('a changed value does change it',
   R.fp([{ a: 1 }]) === R.fp([{ a: 2 }]), false);
is('a missing row changes it',
   R.fp([{ a: 1 }, { a: 2 }]) === R.fp([{ a: 1 }]), false);
is('null and the string "null" are not the same thing',
   R.fp([{ a: null }]) === R.fp([{ a: 'null' }]), false);
is('0 and "0" are not either',
   R.fp([{ a: 0 }]) === R.fp([{ a: '0' }]), false);
/* the length prefix is the part that makes a collision harmless in the
   direction that matters: a hash that happened to collide would say
   "nothing changed" when something had */
is('the fingerprint carries the canonical length, so two sizes cannot match',
   R.fp([{ a: 1 }]).split(':')[0] !== R.fp([{ a: 1 }, { a: 1 }]).split(':')[0], true);

/* ---- 2. the row count ------------------------------------------------- */
console.log('\nhow many rows differ');
const KEY = r => r.code;
const A = [{ code: 'XX-1', descr: 'Invented one' },
           { code: 'XX-2', descr: 'Invented two' },
           { code: 'XX-3', descr: 'Invented three' }];

is('identical lists differ by nothing', R.changed(A, A.map(r => ({ ...r })), KEY), 0);
is('one altered field is one row',
   R.changed(A, [{ code: 'XX-1', descr: 'Invented one' },
                 { code: 'XX-2', descr: 'CHANGED' },
                 { code: 'XX-3', descr: 'Invented three' }], KEY), 1);
is('an added row is one row',
   R.changed(A, A.concat([{ code: 'XX-4', descr: 'Invented four' }]), KEY), 1);
is('a removed row is one row too, which a forward-only walk would miss',
   R.changed(A, A.slice(0, 2), KEY), 1);
is('reordering alone is not a change',
   R.changed(A, A.slice().reverse(), KEY), 0);

/* THE ONE THAT MATTERS MOST: unknown is not zero. */
is('WITHOUT A KEY THE COUNT IS null, NOT 0',
   R.changed(A, A, null), null);
is('and a key that does not key is null as well, not a wrong count',
   R.changed(A, A, r => r.nope), null);

/* ---- 3. a record, and the three facts -------------------------------- */
console.log('\nthe three facts');
const realNow = Date.now;
let CLOCK = Date.parse('2026-11-02T09:00:00.000Z');
Date.now = () => CLOCK;

R.reset();
const r1 = R.mark('test', 'tab became visible', A, A.map(r => ({ ...r })), KEY);
is('why is recorded',        r1.why, 'tab became visible');
is('when is recorded',       r1.at, '2026-11-02T09:00:00.000Z');
is('the first gap is null rather than 0',  r1.gapMs, null);
is('a reload that changed nothing says so', r1.differs, false);
is('and counts no changed rows',            r1.nChanged, 0);

CLOCK += 900000;
const r2 = R.mark('test', 'periodic reconcile', A, A.slice(0, 2), KEY);
is('the backstop gap is the backstop interval', r2.gapMs, 900000);
is('a shrunken list differs',                   r2.differs, true);
is('by one row',                                r2.nChanged, 1);
is('and the row counts are both reported',      [r2.nBefore, r2.nAfter], [3, 2]);

/* liveChannel hands undefined for a real event, and the whole question is
   whether the reconcile paths or real events are doing this */
CLOCK += 5000;
const r3 = R.mark('test', undefined, A, A, KEY);
is('an undefined why is named rather than left blank', r3.why, 'realtime event');

/* ---- 4. THE FALSIFYING READ ------------------------------------------
   This is the half the theory can fail on, so it is the half that most
   needs to work. Two reloads 300 ms apart cannot come from becoming
   visible, a resubscribe, or a 900000 ms backstop - and they cannot come
   from a real event either, because both coalescing windows are 1200 ms. */
console.log('\nthe rate, which is the part that can say no');
R.reset();
CLOCK = Date.parse('2026-11-02T10:00:00.000Z');
R.mark('fastone', 'tab became visible', A, A, KEY);
CLOCK += 300; R.mark('fastone', undefined, A, A, KEY);
CLOCK += 280; R.mark('fastone', undefined, A, A, KEY);
const fastRate = R.rate('fastone');
is('it counts the gaps shorter than the coalescing window', fastRate.gapsUnderCoalesce, 2);
is('the smallest gap is reported',                          fastRate.minGapMs, 280);
is('AND THE VERDICT SAYS THE RECONCILE CANNOT ACCOUNT FOR IT',
   /CANNOT ACCOUNT FOR THIS/.test(fastRate.verdict), true);
is('it does not blame the reconcile for something it names as other',
   /Something other than/.test(fastRate.verdict), true);

R.reset();
CLOCK = Date.parse('2026-11-02T11:00:00.000Z');
R.mark('slowone', 'tab became visible', A, A, KEY);
CLOCK += 900000; R.mark('slowone', 'periodic reconcile', A, A, KEY);
CLOCK += 1300;   R.mark('slowone', undefined, A, A, KEY);
const slowRate = R.rate('slowone');
is('a 1300 ms gap is inside what coalescing allows', slowRate.gapsUnderCoalesce, 0);
is('and the verdict says consistent, not confirmed',
   /Consistent with the reconcile paths/.test(slowRate.verdict), true);
is('1200 ms exactly is not called fast - the window is the window',
   (() => { R.reset(); CLOCK = 0; R.mark('edge', 'a', A, A, KEY);
            CLOCK += R.COALESCE; R.mark('edge', 'b', A, A, KEY);
            return R.rate('edge').gapsUnderCoalesce; })(), 0);

/* ---- 5. the tally, and the tools kept apart -------------------------- */
R.reset();
CLOCK = Date.parse('2026-11-02T12:00:00.000Z');
R.mark('wh24', 'tab became visible', A, A, KEY);
CLOCK += 2000; R.mark('materials', 'tab became visible', A, A.slice(0, 1), KEY);
is('each tool keeps its own gap, or two tabs would look like one fast one',
   R.dump('materials')[0].gapMs, null);
is('a dump can be read per tool', [R.dump('wh24').length, R.dump('materials').length], [1, 1]);
is('and the whole log is both',   R.dump().length, 2);
const both = R.rate();
is('the tally splits changed from unchanged', [both.changedCount, both.noChangeCount], [1, 1]);
is('and counts the reasons',     both.byWhy['tab became visible'], 2);
is('an empty log says so rather than dividing by nothing',
   (R.reset(), R.rate().records), 0);

/* ---- 6. the instrument's own cost is in the record ------------------- */
is('fpMs is present, so time spent fingerprinting cannot be read as the page',
   typeof R.mark('cost', 'x', A, A, KEY).fpMs, 'number');

/* ---- 7. THE SKIP, AND THE FIVE WAYS IT GOES WRONG -------------------
   A render skipped when it was needed shows stale rows and says
   nothing. A render done when it was not needed costs a repaint. So
   every assertion here is about the FIRST direction, and `false` has
   exactly one route to it. */
console.log('\nthe skip');

const ROWS_A = [{ code: 'XX-1', descr: 'one' }];
const ROWS_B = [{ code: 'XX-1', descr: 'CHANGED' }];

/* 1 - a real change must render */
is('A CHANGE RENDERS', R.shouldRender(ROWS_A, ROWS_B), true);
is('a change buried in a nested object renders too',
   R.shouldRender([{ code: 'X', a: { b: 1 } }], [{ code: 'X', a: { b: 2 } }]), true);
is('a list that lost a row renders', R.shouldRender(ROWS_A.concat(ROWS_B), ROWS_A), true);

/* 2 - unknown must render. A circular reference and a BigInt both make
   JSON.stringify throw, which is what "no signature" means in practice. */
const circular = [{ code: 'X' }]; circular[0].self = circular;
is('AN UNFINGERPRINTABLE BEFORE RENDERS', R.shouldRender(circular, ROWS_A), true);
is('an unfingerprintable AFTER renders as well', R.shouldRender(ROWS_A, circular), true);
is('and sig says null rather than guessing', R.sig(circular), null);
/* THE ONE THAT CATCHES A STAND-IN. If `sig` returned a sentinel instead
   of null, two unreadable models would carry the SAME sentinel, compare
   equal, and skip the render - the exact failure, arrived at through a
   value that looks like a signature. */
const circular2 = [{ code: 'Y' }]; circular2[0].self = circular2;
is('TWO UNFINGERPRINTABLE MODELS ARE NOT THEREFORE THE SAME',
   R.shouldRender(circular, circular2), true);
is('nor is a model unfingerprintable twice over',
   R.shouldRender(circular, circular), true);
is('a BigInt is the same answer, not a crash',
   R.shouldRender([{ code: 'X', n: 1n }], ROWS_A), true);
/* undefined is a model that has not loaded; it must never read as "same" */
is('undefined against a list renders', R.shouldRender(undefined, ROWS_A), true);

/* 3 - and it must actually skip, or the change is a no-op */
is('IDENTICAL CONTENT DOES NOT RENDER',
   R.shouldRender(ROWS_A, [{ code: 'XX-1', descr: 'one' }]), false);
is('key order alone does not render',
   R.shouldRender([{ code: 'X', a: 1 }], [{ a: 1, code: 'X' }]), false);
/* the composite shape both tools pass: model plus the other things the
   render reads. A change in ANY member must render. */
is('a composite is compared whole - a changed second member renders',
   R.shouldRender([ROWS_A, { m: 1 }, null], [ROWS_A, { m: 2 }, null]), true);
is('a changed third member renders',
   R.shouldRender([ROWS_A, { m: 1 }, { checked_at: 'a' }],
                  [ROWS_A, { m: 1 }, { checked_at: 'b' }]), true);
is('and an unchanged composite does not',
   R.shouldRender([ROWS_A, { m: 1 }, null], [ROWS_A, { m: 1 }, null]), false);

/* 4 and 5 - the two the pages own, read off the pages.
   These are source assertions and are labelled as such: they are not a
   rendered verification. What they can do is bite when the source
   stops saying it, which is proved by breaking them below. */
const pg = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').split('\r\n').join('\n');
const MAT = pg('materials/index.html'), WH = pg('wh24/index.html');

/* 4 - the model is assigned whether or not the paint is held */
is('materials assigns ALL outside the skip',
   /\bALL = f\.rows;[^\n]*\n\s*if \(repaint\) paint\(\);/.test(MAT), true);
is('and does not assign it inside the conditional',
   /if \(repaint\)\s*\{?\s*ALL = /.test(MAT), false);
is('wh24 assigns TICKETS inside loadAll, before the decision is taken',
   MAT.length > 0 && WH.indexOf('TICKETS = r.tickets; MARKS = r.marks; LOADED = true;')
     < WH.indexOf('const paint = !window.RELOG'), true);
is('and its hold returns AFTER refreshChecked, so CHECKED is fresh to compare',
   /await refreshChecked\(\);\s*\n\s*if \(hold\) return;/.test(WH), true);

/* 5 - a missing RELOG renders. The polarity is the whole assertion: an
   `&&` here would make a tool with no instrument skip every render. */
is('materials renders when RELOG is absent',
   /const repaint = !window\.RELOG \|\| RELOG\.shouldRender\(/.test(MAT), true);
is('wh24 renders when RELOG is absent',
   /const paint = !window\.RELOG \|\| RELOG\.shouldRender\(/.test(WH), true);
is('neither page gates the paint on RELOG being present',
   /(const (?:re)?paint = window\.RELOG &&)/.test(MAT + WH), false);
/* and the comparison covers what the render reads, not just the rows */
is('wh24 compares MARKS and CHECKED too, not only TICKETS',
   /const before = \[was, MARKS, CHECKED\];/.test(WH) &&
   /const after = \[TICKETS, MARKS, CHECKED\];/.test(WH), true);

Date.now = realNow;
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
