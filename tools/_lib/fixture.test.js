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
    console: { info: () => {} }
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
  is('and it says why',                      r.F.why, 'an anon key is configured');
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
{
  const r = run('localhost', '   ');
  is('a whitespace key is no key',           r.F.on, true);
}
{
  /* the guard has to be able to say no off the live site too, or the
     key check above is doing nothing */
  const r = run('localhost', 'sb_publishable_realkey');
  is('LOCALHOST WITH A KEY: OFF',            r.F.on, false);
  is('reason is the key',                    r.F.why, 'an anon key is configured');
  is('DB untouched',                         r.win.DB, undefined);
}

/* ---- 3. WHAT IT STANDS IN FOR, WHEN IT IS ON ---------------------- */
{
  const { F, win } = run('localhost', '');
  is('there are rows',                       F.rows.length > 40, true);
  is('the shape is what materials.js collates',
     Object.keys(F.rows[0]).sort(), ['attrs', 'code', 'desc', 'type', 'vendor']);
  is('NO REAL MATERIAL CODE - 7 to 12 digits is the real shape',
     F.rows.some(r => /^\d{7,12}$/.test(r.code)), false);
  is('every row says it is invented',
     F.rows.every(r => /invented/i.test(r.desc)), true);
  is('some are disposed, so the chips and the segment have both states',
     F.rows.some(r => r.attrs['Total Dispose']) &&
     F.rows.some(r => !r.attrs['Total Dispose']), true);
  is('more than one type, or the facets are empty',
     new Set(F.rows.map(r => r.type)).size > 5, true);
}
{
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
