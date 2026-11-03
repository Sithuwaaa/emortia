/* load-gate.test.js - the reconcile must not read 2,422 rows to find out
   that nothing moved.

     node tools/materials/load-gate.test.js

   THE FOURTH TABLE, AND THE SAME SHAPE. materialsLoad reads three pages
   and the reconcile ran it on every tab show, reconnect and fifteen
   minutes: 88 full walks a day measured over 24 hours, of a list last
   written on 5 September. Once sites and wh24_tickets were gated this was
   the biggest walk count left.

   WHY IT NEEDED NO MIGRATION, which is the part that was wrong in my own
   notes. materialsSave does not set updated_at, and I wrote that down as
   "the stamp is broken". The FUNCTION does not; the TABLE does.
   materials_touch_trg is a BEFORE UPDATE trigger setting
   new.updated_at = now(), and the column defaults to now() on insert. An
   upsert takes the ON CONFLICT DO UPDATE path and fires it. So every
   write moves the maximum already, and (count, max(updated_at)) is exact
   without changing anything in the database.

   The trigger is unconditional, so it fires even when an upsert writes
   identical values. That is over-eager in the SAFE direction: it can
   cause a walk that was not needed, never skip one that was.

   Fixtures are invented: no real material code or description.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const Fake = require(path.join(ROOT, 'tools', '_lib', 'fake-supabase.js'));
const { lift } = require(path.join(ROOT, 'tools', '_lib', 'reachable.js'));

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

const DB_SRC = fs.readFileSync(path.join(ROOT, 'tools', '_lib', 'db.js'), 'utf8')
  .split('\r\n').join('\n');
const PAGE_SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  .split('\r\n').join('\n');

const loadSrc = lift(DB_SRC, 'materialsLoad');
is('materialsLoad was found in db.js', typeof loadSrc === 'string' && loadSrc.length > 500, true);

const sandbox = db => new Function('client',
  'async ' + loadSrc + '\nreturn materialsLoad;')(async () => db);

const STAMP = '2026-09-05T07:47:23.837229+00:00';
const LATER = '2026-11-03T06:00:00.000000+00:00';
const row = (i, stamp) => ({ code: 'MM-' + String(i).padStart(4, '0'),
  descr: 'Invented material ' + i, type: 'Invented type', vendor: 'Invented vendor',
  attrs: { Band: String(700 + i) }, updated_at: stamp || STAMP });

const world = rows => { const db = Fake.client({ materials: rows }); return { db, load: sandbox(db) }; };
const pages  = db => db.__calls.filter(c => c.table === 'materials' && /descr/.test(String(c.cols)));
const probes = db => db.__calls.filter(c => c.table === 'materials' && c.cols === 'updated_at');

(async () => {
  const THREE = [row(1), row(2), row(3)];

  /* ---- 0. it can see a walk ----------------------------------------- */
  {
    const w = world(THREE);
    const r = await w.load();
    is('with no since it walks',      pages(w.db).length > 0, true);
    is('and probes nothing',          probes(w.db).length, 0);
    is('and returns the rows',        r.rows.length, 3);
    is('mapped to the page shape',    Object.keys(r.rows[0]).sort(),
       ['attrs', 'code', 'desc', 'type', 'vendor']);
    is('WITHOUT updated_at ON THE ROW, which planUpload diffs',
       'updated_at' in r.rows[0], false);
    is('the stamp comes back beside them', r.stamp, STAMP);
    is('and so does the count',            r.n, 3);
  }

  /* ---- 1. THE ASSERTION THIS FILE EXISTS FOR ------------------------ */
  {
    const w = world(THREE);
    const r = await w.load({ since: { stamp: STAMP, n: 3 } });
    is('A MATCHING COUNT AND STAMP WALKS NOTHING', pages(w.db).length, 0);
    is('and asks exactly one probe',              probes(w.db).length, 1);
    is('for one column, newest first, limit one',
       [probes(w.db)[0].cols, probes(w.db)[0].limit, probes(w.db)[0].count],
       ['updated_at', 1, 'exact']);
    is('it says so',                              r.unchanged, true);
    is('AND RETURNS null FOR THE ROWS, NEVER []', r.rows, null);
    is('carrying the stamp forward',              [r.stamp, r.n], [STAMP, 3]);
  }

  /* ---- 2. every way it must fall back to walking -------------------- */
  {
    const w = world(THREE);
    await w.load({ since: { stamp: '2026-01-01T00:00:00+00:00', n: 3 } });
    is('a stamp that moved walks', pages(w.db).length > 0, true);
  }
  {
    const w = world(THREE);
    await w.load({ since: { stamp: STAMP, n: 2 } });
    is('the right stamp with the wrong count walks', pages(w.db).length > 0, true);
  }
  {
    /* THE IN-PLACE EDIT: the trigger moves the stamp, the count does not
       change, and a count-only gate would miss it entirely */
    const w = world([row(1), row(2), row(3, LATER)]);
    await w.load({ since: { stamp: STAMP, n: 3 } });
    is('AN EDIT THAT KEEPS THE COUNT STILL WALKS', pages(w.db).length > 0, true);
  }
  {
    const w = world(THREE.concat([row(4, LATER)]));
    await w.load({ since: { stamp: STAMP, n: 3 } });
    is('a new row walks', pages(w.db).length > 0, true);
  }
  {
    const w = world(THREE);
    await w.load({ since: { stamp: '', n: 3 } });
    is('no stamp to compare walks', pages(w.db).length > 0, true);
  }
  {
    const w = world(THREE);
    await w.load({ since: { stamp: STAMP, n: 0 } });
    is('an empty page walks rather than confirming itself', pages(w.db).length > 0, true);
  }
  {
    const w = world([]);
    const r = await w.load({ since: { stamp: STAMP, n: 3 } });
    is('and a list that emptied walks', pages(w.db).length > 0, true);
    is('handing back an empty list, not null', r.rows, []);
  }

  /* ---- 3. the page's half, as source assertions --------------------- */
  is('only the subscriber passes since',
     /MSTAMP && MN \? \{ since: \{ stamp: MSTAMP, n: MN \} \} : undefined/.test(PAGE_SRC), true);
  is('AND null KEEPS THE ROWS RATHER THAN BLANKING THEM',
     /if \(f\.rows !== null\)\{ ALL = f\.rows; MSTAMP = f\.stamp; MN = f\.n; \}/.test(PAGE_SRC), true);
  is('the first load takes no since, so it always walks',
     /const r = await window\.DB\.materialsLoad\(\);/.test(PAGE_SRC), true);
  is('and records what it came back with',
     /ALL = r\.rows \|\| \[\]; MSTAMP = r\.stamp \|\| null; MN = r\.n \|\| 0;/.test(PAGE_SRC), true);
  is('the skip still goes through the one RELOG call',
     /RELOG\.decide\('materials'/.test(PAGE_SRC), true);
  is('and still paints when RELOG is absent',
     /else paint\(\);/.test(PAGE_SRC), true);

  /* ---- 4. the stamp really is maintained by the table --------------- */
  is('db.js records WHY no migration was needed, so nobody re-adds one',
     /materials_touch_trg is a BEFORE UPDATE trigger/.test(DB_SRC), true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
