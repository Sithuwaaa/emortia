/* dataset-gate.test.js - the dataset loader must not re-read 4.2 MB to
   find out that nothing changed.

     node tools/_lib/dataset-gate.test.js

   WHAT THIS IS ABOUT. `sites` holds 5,940 rows, twenty columns, about
   4.2 MB of JSON, and PostgREST caps a response so db.js walks it in six
   pages. Every tool that opens re-read all six. So did every reconcile
   of the Site Access tool - tab becoming visible, the fifteen minute
   backstop, the channel coming back - because lookup.js calls load()
   again each time. Measured over 24 hours: about 124 full reads a day,
   roughly 509 MB, of a dataset last published on 1 October. site_data is
   13,258 rows and has not moved in 58 days. The whole database is 6.7 MB
   and it was sending ~817 MB a day.

   The meta row was ALREADY being read. fetchRemote fetched
   datasets.cols/row_count/updated_at, used the column list, and threw
   the timestamp away - then paid for the pages. That is the third time
   this repository has put the comparison after the cost: wh24's full
   table read per changed row, and the done count rebuilt from a rounded
   percentage. So this file asserts the ORDER, not just the result.

   THE SAFETY RULE IT IS WRITTEN AGAINST: nothing the user can see may
   change. A gate that serves a stale dataset as current is a wrong
   figure on screen, which is worse than the egress. So every assertion
   below is about the gate being WRONG IN THE EXPENSIVE DIRECTION - when
   in any doubt, read the pages.

   Fixtures are invented: no real site code, name or depot.
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

/* ---- the real functions, lifted out of the real file ------------------
   Not copies. db.js is a browser IIFE that imports the client from a CDN
   and talks to IndexedDB, so it cannot be required here - but the two
   functions under test can be brace-matched out of it and run against
   the fake, which is the pattern the photo-reachability tests use. */
const DB_SRC = fs.readFileSync(path.join(ROOT, 'tools', '_lib', 'db.js'), 'utf8')
  .split('\r\n').join('\n');

const fetchRemoteSrc = lift(DB_SRC, 'fetchRemote');
const loadSrc = lift(DB_SRC, 'load');
is('fetchRemote was found in db.js', typeof fetchRemoteSrc === 'string' && fetchRemoteSrc.length > 200, true);
is('load was found in db.js', typeof loadSrc === 'string' && loadSrc.length > 200, true);
/* the sentinel is db.js's, declared once, in the scope both functions
   share - the sandbox below declares its own, so this is the assertion
   that the real file has it at all */
is('db.js declares the UNCHANGED sentinel exactly once',
   (DB_SRC.match(/const UNCHANGED = \{ unchanged: true \};/g) || []).length, 1);
is('and declares it before fetchRemote, in the same closure',
   DB_SRC.indexOf('const UNCHANGED') < DB_SRC.indexOf('async function fetchRemote'), true);

function sandbox(deps) {
  const src =
    'const UNCHANGED = { unchanged: true };\n' +
    'async ' + fetchRemoteSrc + '\n' +
    'async ' + loadSrc + '\n' +
    'return { fetchRemote, load, UNCHANGED };';
  return new Function('client', 'TABLE', 'cacheGet', 'cacheSet', 'configured', src)(
    deps.client, deps.TABLE, deps.cacheGet, deps.cacheSet, deps.configured);
}

/* ---- the world the functions run in ---------------------------------- */
const STAMP = '2026-10-01T16:06:00.258+00:00';
const COLS = ['Site_ID', 'Site_Name', 'Access_Permission_providing_Party'];
const SITE_ROWS = [
  { site_id: 'QQ9001', data: { Site_ID: 'QQ9001', Site_Name: 'Invented_Site_One', Access_Permission_providing_Party: 'MOD' } },
  { site_id: 'QQ9002', data: { Site_ID: 'QQ9002', Site_Name: 'Invented_Site_Two', Access_Permission_providing_Party: 'Private' } },
  { site_id: 'QQ9003', data: { Site_ID: 'QQ9003', Site_Name: 'Invented_Site_Three', Access_Permission_providing_Party: '' } }
];

function world(opts) {
  opts = opts || {};
  const db = Fake.client({
    datasets: [{ key: 'site_access', cols: opts.cols || COLS,
                 row_count: opts.rowCount == null ? SITE_ROWS.length : opts.rowCount,
                 updated_at: opts.stamp || STAMP }],
    sites: SITE_ROWS
  });
  let stored = opts.cached || null;
  const written = [];
  return {
    db, written,
    get stored() { return stored; },
    api: sandbox({
      client: async () => db,
      TABLE: { site_access: 'sites', site_data: 'site_data' },
      cacheGet: async () => stored,
      cacheSet: async (k, v) => { stored = v; written.push(v); return 1; },
      configured: () => true
    })
  };
}

const sitePages = db => db.__calls.filter(c => c.table === 'sites');
const metaReads = db => db.__calls.filter(c => c.table === 'datasets');

(async () => {

  /* ---- 0. the harness must be able to see a page read at all ---------
     A test that counts page reads proves nothing if it cannot count one. */
  {
    const w = world();                       /* no cache */
    const ds = await w.api.load('site_access');
    is('with no cache it reads the pages', sitePages(w.db).length > 0, true);
    is('and reads the meta row once',       metaReads(w.db).length, 1);
    is('and hands back the rows',           ds.rows.length, 3);
    is('projected through the declared columns', ds.rows[0], ['QQ9001', 'Invented_Site_One', 'MOD']);
    is('and records the full timestamp, not just the date', ds.stamp, STAMP);
    is('while savedAt stays the date the pill shows',       ds.savedAt, '2026-10-01');
    is('and it wrote that to the cache',    w.written.length, 1);
  }

  /* ---- 1. THE ASSERTION THIS FILE EXISTS FOR ------------------------- */
  {
    const cached = { cols: COLS, rows: [['QQ9001', 'Invented_Site_One', 'MOD'],
                                        ['QQ9002', 'Invented_Site_Two', 'Private'],
                                        ['QQ9003', 'Invented_Site_Three', '']],
                     savedAt: '2026-10-01', stamp: STAMP, source: 'server' };
    const w = world({ cached });
    const ds = await w.api.load('site_access');
    await new Promise(r => setTimeout(r, 0));          /* let the refresh settle */

    is('A MATCHING STAMP READS NOT ONE PAGE', sitePages(w.db).length, 0);
    is('and asks the meta row instead',       metaReads(w.db).length, 1);
    /* the safety rule, stated as an assertion: what came back is what the
       page would have drawn before */
    is('and hands back the cache UNCHANGED, field for field', ds, cached);
    is('without rewriting the cache',         w.written.length, 0);
  }

  /* ---- 2. every way it must fall back to reading ---------------------
     Each of these is a case where the gate cannot PROVE nothing changed,
     and the answer to "cannot prove" is always to pay. */
  const cachedAt = s => ({ cols: COLS,
    rows: [['QQ9001', 'Invented_Site_One', 'MOD'],
           ['QQ9002', 'Invented_Site_Two', 'Private'],
           ['QQ9003', 'Invented_Site_Three', '']],
    savedAt: String(s).slice(0, 10), stamp: s, source: 'server' });

  {
    const w = world({ cached: cachedAt('2026-09-20T10:00:00+00:00') });
    await w.api.load('site_access'); await new Promise(r => setTimeout(r, 0));
    is('a stamp that moved reads the pages', sitePages(w.db).length > 0, true);
  }
  {
    /* THE ONE THE SPEC GOT WRONG, and the reason the gate is not on
       savedAt. Two publishes on the same day share a DATE and differ by a
       TIMESTAMP. Gated on savedAt this returns the cache and the second
       publish never arrives on that device - a stale figure presented as
       current, which is the one thing the safety rule forbids. */
    const sameDay = '2026-10-01T23:59:59.000+00:00';
    const w = world({ stamp: sameDay, cached: cachedAt(STAMP) });
    is('the two stamps really are the same DAY',
       sameDay.slice(0, 10) === STAMP.slice(0, 10), true);
    await w.api.load('site_access'); await new Promise(r => setTimeout(r, 0));
    is('A SECOND PUBLISH ON THE SAME DAY STILL READS THE PAGES',
       sitePages(w.db).length > 0, true);
  }
  {
    /* a cache truncated by a storage quota: right stamp, wrong rows */
    const short = cachedAt(STAMP); short.rows = short.rows.slice(0, 1);
    const w = world({ cached: short });
    await w.api.load('site_access'); await new Promise(r => setTimeout(r, 0));
    is('a cache with the right stamp and too few rows reads the pages',
       sitePages(w.db).length > 0, true);
  }
  {
    /* written before `stamp` existed - no migration, one re-read */
    const old = cachedAt(STAMP); delete old.stamp;
    const w = world({ cached: old });
    await w.api.load('site_access'); await new Promise(r => setTimeout(r, 0));
    is('a cache from before the gate reads the pages once',
       sitePages(w.db).length > 0, true);
    is('and is rewritten with a stamp, so it gates from then on',
       w.written.length === 1 && w.written[0].stamp, STAMP);
  }
  {
    /* the server has no row for this key at all */
    const w = world();
    w.db.__rows = w.db.__rows;                 /* untouched; use a key with no dataset */
    const ds = await w.api.load('site_data');
    is('a key the server has never published is an empty dataset, not a crash',
       [ds.rows.length, ds.source], [0, 'empty']);
  }

  /* ---- 3. the callback, which is the only thing a caller is told -----
     lookup.js is the one caller that passes one, and it toasts "Updated
     from another device" and repaints. Firing it on an unchanged read is
     the toast-gate bug again; not firing it on a changed read is a tab
     that looks live and is stale. */
  {
    const w = world({ cached: cachedAt(STAMP) });
    let told = 0;
    await w.api.load('site_access', () => { told++; });
    await new Promise(r => setTimeout(r, 0));
    is('AN UNCHANGED READ TELLS THE CALLER NOTHING', told, 0);
  }
  {
    const w = world({ stamp: '2026-10-30T08:00:00+00:00', cached: cachedAt(STAMP) });
    let told = 0, gotRows = null;
    const first = await w.api.load('site_access', fresh => { told++; gotRows = fresh.rows.length; });
    await new Promise(r => setTimeout(r, 0));
    is('a changed read still paints the cache first', first.rows.length, 3);
    is('AND THEN TELLS THE CALLER ONCE', told, 1);
    is('with the fresh rows',            gotRows, 3);
  }

  /* ---- 4. the order, because the saving IS the order ------------------
     Asserting the result alone would pass a version that read all six
     pages and then compared. */
  {
    const w = world({ cached: cachedAt(STAMP) });
    await w.api.load('site_access'); await new Promise(r => setTimeout(r, 0));
    const seq = w.db.__calls.map(c => c.table);
    is('the meta row is read FIRST and is the only read',
       seq, ['datasets']);
  }
  {
    const w = world();                        /* no cache: must read both */
    await w.api.load('site_access');
    const seq = w.db.__calls.map(c => c.table);
    is('and when it does pay, the meta still comes before the pages',
       seq[0] === 'datasets' && seq.indexOf('sites') > 0, true);
  }
  /* and the source says so too: the gate must be inside fetchRemote,
     before the paging loop, not after it. Both offsets must be PRESENT
     before they are ordered - indexOf returns -1 for a missing needle,
     and -1 is less than everything, so the comparison alone passes
     vacuously on a file that has no gate at all. I made exactly that
     mistake checking the deployed copy an hour before writing this. */
  const iGate = DB_SRC.indexOf('return UNCHANGED');
  const iWalk = DB_SRC.indexOf('const PAGE = 1000');
  is('both the gate and the walk are in the source', iGate > 0 && iWalk > 0, true);
  is('and the gate sits before the walk', iGate < iWalk, true);

  /* ---- 5. client() WAITS FOR THE SESSION, NOT JUST FOR THE CLIENT ----
     createClient returns immediately and restores the stored session
     afterwards, so a select issued in between carried the anon key alone.
     On a table whose policy is may_read('tool:...') that is not an error:
     it is 0 rows and HTTP 200. materialsLoad's pager breaks on the short
     page, so the tool painted an EMPTY LIST and reported nothing wrong
     until a later reconcile fixed it. Measured: 361 of those in a day
     against 118 real reads - three empty first loads for every good one,
     and one of them seen on a cold load.

     This is a db.js property and it lives here rather than in the wh24
     test, because this is the file somebody editing client() will run. */
  is('client() awaits getSession before resolving',
     /\.then\(async c => \{\s*\n\s*if \(c\) \{ try \{ await c\.auth\.getSession\(\); \} catch \(e\) \{\} \}/.test(DB_SRC), true);
  is('and assigns clientSync FIRST, so a channel can still be torn down if it throws',
     DB_SRC.indexOf('clientSync = m.createClient') < DB_SRC.indexOf('await c.auth.getSession()'), true);
  is('a visitor with no session is not treated as a failure',
     /catch \(e\) \{\} \}\s*\n\s*return c;/.test(DB_SRC), true);
  is('and the await is not swallowed by the outer catch that returns null',
     DB_SRC.indexOf('await c.auth.getSession()') <
     DB_SRC.indexOf("console.warn('Supabase client unavailable:'"), true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
