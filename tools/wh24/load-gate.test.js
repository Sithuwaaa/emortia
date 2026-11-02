/* load-gate.test.js - the reconcile must not read 1,308 kB to find out
   that nothing moved.

     node tools/wh24/load-gate.test.js

   THE SAME SHAPE AS dataset-gate, AND THE SAME LESSON A FOURTH TIME.
   wh24Load reads '*' over two pages. The reconcile ran it on every tab
   show, every reconnect and every fifteen minutes: 178 full walks a day
   measured over 24 hours, nearly all returning what was already on
   screen. The cheap question - did anything get written - was never
   asked.

   WHY (count, max(synced_at)) IS EXACT. wh24Publish is the only writer
   of wh24_tickets and stamps synced_at on every row of every chunk from
   one hoisted value, so no write can land without moving the maximum.
   There are no deletes; a removal is the 'removed' column, which is an
   update, which is stamped. An added or vanished row moves the count.

   THE RULE EVERY ASSERTION HERE IS ABOUT: a gate that is wrong in the
   cheap direction leaves stale tickets on screen saying nothing. So
   every case where the gate cannot PROVE nothing moved must read.

   Fixtures are invented: no real ticket id, site code or serial.
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

const loadSrc = lift(DB_SRC, 'wh24Load');
is('wh24Load was found in db.js', typeof loadSrc === 'string' && loadSrc.length > 400, true);

function sandbox(db) {
  const src =
    "const WH24T = 'wh24_tickets', WH24M = 'wh24_marks';\n" +
    'const wh24Why = m => m;\n' +
    'async ' + loadSrc + '\n' +
    'return wh24Load;';
  return new Function('client', src)(async () => db);
}

const STAMP = '2026-11-02T16:04:30.667+00:00';
const ticket = (id, stamp) => ({ id, site: 'QQ900' + id, stream: '',
  status: 'ready', synced_at: stamp || STAMP, gins: [{ no: 'IN' + id }] });
const TICKETS = [ticket(1), ticket(2), ticket(3)];
const MARKS = [{ ticket_id: 1, stream: '', collected: true },
               { ticket_id: 1, stream: 'ACE', collected: false }];

const world = rows => {
  const db = Fake.client({ wh24_tickets: rows || TICKETS, wh24_marks: MARKS });
  return { db, load: sandbox(db) };
};
const pages = db => db.__calls.filter(c => c.table === 'wh24_tickets' && c.cols === '*');
const probes = db => db.__calls.filter(c => c.table === 'wh24_tickets' && c.cols === 'synced_at');

(async () => {

  /* ---- 0. it can see a walk, or it proves nothing ------------------- */
  {
    const w = world();
    const r = await w.load();
    is('with no `since` it walks the table', pages(w.db).length > 0, true);
    is('and asks no probe at all',           probes(w.db).length, 0);
    is('and hands back the tickets',         r.tickets.length, 3);
    is('with the marks keyed on (ticket_id, stream)',
       Object.keys(r.marks).sort(), ['1|', '1|ACE']);
    is('and does not claim to be unchanged', !!r.unchanged, false);
  }

  /* ---- 1. THE ASSERTION THIS FILE EXISTS FOR ------------------------ */
  {
    const w = world();
    const r = await w.load({ since: { n: 3, stamp: STAMP } });
    is('A MATCHING COUNT AND STAMP WALKS NOTHING', pages(w.db).length, 0);
    is('and asks exactly one probe instead',       probes(w.db).length, 1);
    is('THE PROBE ASKS FOR ONE COLUMN, NEWEST FIRST, LIMIT ONE',
       [probes(w.db)[0].cols, probes(w.db)[0].limit], ['synced_at', 1]);
    is('it says so plainly',                       r.unchanged, true);
    /* the safety rule as an assertion: null means KEEP YOURS. An empty
       array here would blank the list, which is worse than the egress. */
    is('AND RETURNS null FOR THE TICKETS, NEVER []', r.tickets, null);
    is('while the marks still come back fresh',
       Object.keys(r.marks).sort(), ['1|', '1|ACE']);
    is('and there is no error',                    r.error, null);
  }

  /* ---- 2. every way it must fall back to walking -------------------- */
  {
    const w = world();
    await w.load({ since: { n: 3, stamp: '2026-11-01T09:00:00.000+00:00' } });
    is('a stamp that moved walks', pages(w.db).length > 0, true);
  }
  {
    const w = world();
    await w.load({ since: { n: 2, stamp: STAMP } });
    is('the right stamp with the wrong count walks', pages(w.db).length > 0, true);
  }
  {
    /* a row added carries a NEWER stamp and a bigger count - either alone
       is enough, and both are asserted because a gate that needed both to
       move would miss an in-place edit */
    const w = world(TICKETS.concat([ticket(4, '2026-11-02T17:00:00.000+00:00')]));
    await w.load({ since: { n: 3, stamp: STAMP } });
    is('a new row walks', pages(w.db).length > 0, true);
  }
  {
    /* THE IN-PLACE EDIT, which is the case a count-only gate gets wrong */
    const edited = [ticket(1), ticket(2), ticket(3, '2026-11-02T18:00:00.000+00:00')];
    const w = world(edited);
    await w.load({ since: { n: 3, stamp: STAMP } });
    is('AN EDIT THAT KEEPS THE COUNT STILL WALKS', pages(w.db).length > 0, true);
  }
  {
    const w = world();
    await w.load({ since: { n: 3, stamp: '' } });
    is('no stamp to compare walks', pages(w.db).length > 0, true);
  }
  {
    const w = world();
    await w.load({ since: { n: 0, stamp: STAMP } });
    is('an empty page walks rather than confirming itself', pages(w.db).length > 0, true);
  }
  {
    const w = world([]);
    const r = await w.load({ since: { n: 3, stamp: STAMP } });
    is('and a table that emptied walks', pages(w.db).length > 0, true);
    is('handing back an empty list, not null', r.tickets, []);
  }

  /* ---- 3. one implementation of the marks key ----------------------- */
  is('db.js builds the marks key in exactly one place',
     (DB_SRC.match(/marks\[String\(r\.ticket_id\) \+ '\|' \+ \(r\.stream \|\| ''\)\] = r;/g) || []).length, 1);
  is('and the gate goes through that one, not its own copy',
     /return \{ tickets: null, marks: mm\.marks/.test(DB_SRC), true);

  /* ---- 4. the page's half ------------------------------------------
     Source assertions, labelled as such. They bite when the page stops
     saying it, which the breaks prove. */
  is('only the reconcile asks - the probe is gated on `hold`',
     /const since = \(hold && LOADED && TICKETS\.length\)/.test(PAGE_SRC), true);
  is('so a first load and a post-sync read always walk',
     /const r = await window\.DB\.wh24Load\(since \? \{ since \} : undefined\);/.test(PAGE_SRC), true);
  is('AND null KEEPS THE ROWS RATHER THAN BLANKING THEM',
     /if \(r\.tickets !== null\) TICKETS = r\.tickets;/.test(PAGE_SRC), true);
  is('while the marks are taken every time',
     /\n  MARKS = r\.marks; LOADED = true;/.test(PAGE_SRC), true);
  is('and the stamp it sends is the one the server is asked for',
     /stamp: lastWrite\(\)/.test(PAGE_SRC) &&
     /return TICKETS\.reduce\(\(a, t\) => !a \|\| t\.synced_at > a \? t\.synced_at : a, null\);/.test(PAGE_SRC), true);

  /* The auth race shipped in the same commit as this gate, but it is a
     property of db.js client() and belongs where someone editing client()
     will run it: tools/_lib/dataset-gate.test.js, section 5. */

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
