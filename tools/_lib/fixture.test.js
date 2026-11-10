/* fixture.test.js - the fixture must never reach the live site.

     node tools/_lib/fixture.test.js

   A preview that shows invented material codes is useful. The SAME file
   doing it on emortia.com would be worse than an outage: nobody would
   know. So the question this file asks is not "does the fixture work" -
   that is visible the moment you open a preview - but "when does it
   refuse to work", which is not visible at all.

   The real tools/_lib/fixture.js is executed, not a copy of its guard.
   A re-implementation of the condition here would pass happily while the
   shipped one let the site through, which is the whole failure mode. */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'fixture.js'), 'utf8');
/* the real materials.js, so the fixture's vendors go through the real
   normVendor rather than a stand-in of it */
const MAT = require(path.join(__dirname, '..', 'materials', 'materials.js'));

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

/* Enough DOM for the banner to be built without a browser. It records,
   so a test can also ask whether the banner appeared - an unlabelled
   fixture is its own defect. */
function fakeWindow(host, anonKey) {
  const made = [];
  const body = { appendChild: n => made.push(n) };
  const doc = {
    body,
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute(){}, set textContent(v){ this._t = v; },
                            get textContent(){ return this._t; } }),
    addEventListener: () => {}
  };
  const win = {
    SUPABASE_CONFIG: anonKey === undefined ? undefined : { url: 'u', anonKey },
    location: { hostname: host },
    document: doc,
    console: { info: () => {} },
    MAT: MAT
  };
  win.window = win;
  return { win, doc, made };
}

function run(host, anonKey) {
  const { win, doc, made } = fakeWindow(host, anonKey);
  new Function('window', 'document', 'location', 'console', SRC)
    (win, doc, win.location, win.console);
  return { F: win.FIXTURE, win, banner: made.length };
}

/* ---- 1. THE LIVE SITE, WHICH IS THE ONE THAT MATTERS -------------- */
{
  const r = run('emortia.com', 'sb_publishable_realkey');
  is('live host WITH a key: off',            r.F.on, false);
  is('and it says why',                      r.F.why, 'this is the live host');
  is('no banner',                            r.banner, 0);
  is('it did not touch DB',                  r.win.DB, undefined);
  is('it did not touch Access',              r.win.Access, undefined);
}
{
  /* the second lock on its own: a deploy that lost the key must still
     show the real error rather than invented rows */
  const r = run('emortia.com', '');
  is('LIVE HOST WITH NO KEY: STILL OFF',     r.F.on, false);
  is('and the reason is the host',           r.F.why, 'this is the live host');
  is('no banner',                            r.banner, 0);
  is('DB untouched',                         r.win.DB, undefined);
}
{
  const r = run('www.emortia.com', '');
  is('a subdomain of the live site is live too', r.F.on, false);
}
{
  const r = run('EMORTIA.COM', '');
  is('and the host check is case-blind',     r.F.on, false);
}
{
  const r = run('emortia.com', undefined);
  is('no SUPABASE_CONFIG at all, live host: off', r.F.on, false);
}

/* ---- 2. WHERE IT IS SUPPOSED TO WORK ------------------------------ */
{
  const r = run('localhost', '');
  is('keyless, not live: ON',                r.F.on, true);
  is('and it says so on screen',             r.banner, 1);
  is('DB.configured answers false',          r.win.DB.configured(), false);
  is('Access.protect is a no-op',            typeof r.win.Access.protect, 'function');
  is('and it owns nothing',                  r.win.IS_OWNER, false);
}
{
  const r = run('some-canvas.claudeusercontent.com', '');
  is('a canvas host, keyless: ON',           r.F.on, true);
}

/* ---- 2b. THE CANVAS, WHICH IS WHY THIS EXISTS --------------------

   The migrated design project carries the anon key and still cannot
   sign anybody in. "No key" never fires there, so the host does. */
{
  const r = run('some-canvas.claudeusercontent.com', 'sb_publishable_realkey');
  is('A CANVAS WITH A KEY: ON, where localhost with a key is off', r.F.on, true);
  is('and it says which way in',             r.F.why, 'a Claude canvas, and "some-canvas.claudeusercontent.com" is not the live site');
  is('it stands in for the reads',           typeof r.win.DB.materialsLoad, 'function');
}
{
  const r = run('claude.ai', 'sb_publishable_realkey');
  is('claude.ai counts as a canvas too',     r.F.on, true);
}
{
  /* asked for by hand, off the live site */
  const { win } = (() => { const f = fakeWindow('staging.example.com', 'sb_publishable_realkey');
    f.win.location.search = '?preview=1';
    new Function('window','document','location','console', SRC)(f.win, f.doc, f.win.location, f.win.console);
    return f; })();
  is('?preview=1 off the live site: ON',     win.FIXTURE.on, true);
}
{
  /* AND IT IS STILL REFUSED ON THE LIVE SITE - the one that matters */
  const f = fakeWindow('emortia.com', 'sb_publishable_realkey');
  f.win.location.search = '?preview=1';
  new Function('window','document','location','console', SRC)(f.win, f.doc, f.win.location, f.win.console);
  is('?preview=1 ON THE LIVE SITE: STILL OFF', f.win.FIXTURE.on, false);
  is('and the reason is the host',           f.win.FIXTURE.why, 'this is the live host');
  is('DB untouched',                         f.win.DB, undefined);
}
{
  const r = run('localhost', '   ');
  is('a whitespace key is no key',           r.F.on, true);
}
{
  /* LOCALHOST IS NOW A WAY IN, deliberately - it is the design surface,
     and it has to show a page the moment it opens. This asserted the
     opposite until 10 November, when the local server became where the
     look is worked on. The expectation changed because the contract did. */
  const r = run('localhost', 'sb_publishable_realkey');
  is('LOCALHOST WITH A KEY: ON, because it is the design surface', r.F.on, true);
  is('and it says which way in',
     r.F.why, 'a local server, and "localhost" is not the live site');
  is('127.0.0.1 too',    run('127.0.0.1', 'sb_publishable_realkey').F.on, true);
}
{
  /* ...and the key check must still bite SOMEWHERE, or removing it would
     cost nothing and this file would be agreeing with whatever it finds.
     A host that is neither live, nor a canvas, nor local is the case it
     still governs. */
  const r = run('staging.example.com', 'sb_publishable_realkey');
  is('A KEYED HOST THAT IS NEITHER LOCAL NOR A CANVAS: OFF', r.F.on, false);
  is('reason is the key',                    r.F.why, 'an anon key is configured');
  is('DB untouched',                         r.win.DB, undefined);
}
{
  /* the door out, for testing the real gate on localhost */
  const f = fakeWindow('localhost', 'sb_publishable_realkey');
  f.win.location.search = '?nofixture=1';
  new Function('window','document','location','console', SRC)(f.win, f.doc, f.win.location, f.win.console);
  is('?nofixture=1 turns it off on localhost',  f.win.FIXTURE.on, false);
  is('and says so',                             f.win.FIXTURE.why, 'turned off with ?nofixture=1');
  is('leaving the real gate and DB alone',      f.win.DB, undefined);
}
{
  /* but it cannot turn the LIVE lock into a way in - live is checked first */
  const f = fakeWindow('emortia.com', '');
  f.win.location.search = '?nofixture=1';
  new Function('window','document','location','console', SRC)(f.win, f.doc, f.win.location, f.win.console);
  is('the live host is still decided by the live check', f.win.FIXTURE.why, 'this is the live host');
}

/* ---- 3. WHAT IT STANDS IN FOR, WHEN IT IS ON ----------------------

   The rows are built on the first read, not at load, because materials.js
   loads after this file and the builder needs its normVendor. So the rows
   are asked for the way the page asks for them. */
{
  const { win } = run('localhost', '');
  is('the rows are not built before anything asks', win.FIXTURE.rows, null);
  return win.DB.materialsLoad().then(res => {
    const R = res.rows;
    is('there are rows',                       R.length > 40, true);
    is('and FIXTURE.rows is filled in once built', win.FIXTURE.rows.length, R.length);
    is('the shape is what materials.js collates',
       Object.keys(R[0]).sort(), ['attrs', 'code', 'desc', 'type', 'vendor']);
    is('NO REAL MATERIAL CODE - 7 to 12 digits is the real shape',
       R.some(r => /^\d{7,12}$/.test(r.code)), false);
    is('every row says it is invented',
       R.every(r => /invented/i.test(r.desc)), true);
    is('some are disposed, so the chips and the segment have both states',
       R.some(r => r.attrs['Total Dispose']) && R.some(r => !r.attrs['Total Dispose']), true);
    is('more than one type, or the facets are empty',
       new Set(R.map(r => r.type)).size > 5, true);

    /* the vendor goes through the real normaliser, so the preview shows
       what the page would: HUA folded into Huawei, Fibrolan kept whole */
    const v = new Set(R.map(r => r.vendor));
    is('a mappable spelling is normalised, not passed through', v.has('HUA'), false);
    is('and lands on the mapped name',                          v.has('Huawei'), true);
    is('AN UNMAPPED ONE SURVIVES, so a preview can show that case',
       v.has('Fibrolan'), true);
    is('and no row lost its vendor',   R.every(r => !!r.vendor), true);
    return next();
  });
}
function next() {
  /* reads answer, writes refuse - a preview must not be able to pretend
     it deleted anything */
  const { win } = run('localhost', '');
  const ok = [];
  return Promise.all([
    win.DB.materialsLoad().then(r => is('materialsLoad returns the rows', r.rows.length > 40, true)),
    win.DB.materialsCount().then(r => is('materialsCount answers', r.n > 40, true)),
    win.DB.materialsWipe().then(() => ok.push('resolved'), e => ok.push(e.message)),
    win.DB.materialsSave().then(() => ok.push('resolved'), e => ok.push(e.message))
  ]).then(() => {
    is('materialsWipe REFUSES', /preview with sample data/.test(ok[0]), true);
    is('materialsSave REFUSES', /preview with sample data/.test(ok[1]), true);
    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(fail ? 1 : 0);
  });
}
