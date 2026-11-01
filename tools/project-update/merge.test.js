/* merge.test.js - the two halves must both still be there.

     node tools/project-update/merge.test.js

   WHY THIS EXISTS. This tool is now two things in one page: the lamp-pole
   rollout dashboard, which reads the published workbook out of `books` and
   is what the tool opens on, and the Excel browser imported from the design
   project, which reads whatever is on this device. Neither half raises
   anything when the other one goes.

   That is the WH24 Download button shape again. A read was narrowed, a
   feature left the page, and nothing was red - because every test asked
   whether the data was stored, not whether it still arrived somewhere a
   person could reach. Here there are two ways to lose a half silently:

     1. the landing view stops being the dashboard, or the browser tab
        stops being offered, and the tool looks fine either way;
     2. the browser half starts going through window.DB, which would put
        whole workbooks back through PostgREST - the thing that took 96% of
        a month's egress - and would also look fine.

   So both are asserted, from the source, by name.

   WHAT THIS FILE DOES NOT CHECK. The colours are palette.test.js's, the
   group-to-family tie is family.test.js's, and whether the thing is
   legible outdoors is Sithara's. This file only checks that the merge is
   still a merge.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const ACCESS = fs.readFileSync(path.join(ROOT, 'tools', '_lib', 'access.js'), 'utf8')
  .split('\r\n').join('\n');

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- 1. which half the tool opens on --------------------------------

   THIS INVARIANT WAS DELIBERATELY REVERSED on 27 October and the old
   assertion is kept below rather than deleted, because the reversal is
   the interesting part.

   It used to read "the tool still opens on the dashboard". The redraw
   pinned ACTIVE to the Excel browser and hid the tab strip, this file
   went red on exactly that line, and the change was confirmed rather
   than assumed. The browser is the tool now; the dashboard's code stays
   in the page, wired and routable, but nothing routes to it.

   So what is asserted now is the SHAPE OF THE DECISION: the browser is
   the landing view, and the dashboard has not been deleted on the way
   past. If somebody wants the dashboard back it is three lines, and this
   file says which three. */
const tabLine = (/const all = (\[[^;]+);/.exec(SRC) || [])[1];
is('the tab list was found in the source', typeof tabLine === 'string', true);
is('the dashboard is still in the tab list', /^\['Dashboard'\]/.test(String(tabLine)), true);
is('and the Excel browser is offered',       /EXCEL_TAB/.test(String(tabLine)), true);

/* the landing view, which is what ACTIVE starts as */
is('the tool opens on the Excel browser', /let ACTIVE = EXCEL_TAB\b/.test(SRC), true);
is('and buildTabs holds it there',        /\n\s*ACTIVE = EXCEL_TAB;/.test(SRC), true);

/* the three lines that would give the dashboard back, named so the way
   back is written down rather than rediscovered */
is('the dataset switcher is hidden, not removed',
   /<div class="dsbar" id="dsbar" style="display:none">/.test(SRC), true);
is('the tab strip is hidden, not removed',
   /<div class="tabs" id="tabs" style="display:none">/.test(SRC), true);

/* and render() still routes to each half, so neither has been orphaned */
is('render still routes the dashboard', /ACTIVE === 'Dashboard' \? renderDashboard\(\)/.test(SRC), true);
is('render routes the browser',         /ACTIVE === EXCEL_TAB\s+\? renderExcel\(\)/.test(SRC), true);
is('renderExcel exists to be routed to', /function renderExcel\(\)/.test(SRC), true);
is('renderDashboard exists too',         /function renderDashboard\(\)/.test(SRC), true);

/* ---- 1b. the MOD panel moved rather than went ------------------------
   It was the dashboard's, and the dashboard is no longer on screen. It is
   the browser half's now, reading the uploaded project's own sheets. */
is('the browser half has a MOD panel',   /function xModPanel\(\)/.test(SRC), true);
is('and the overview actually calls it', /'<\/div><\/section>' \+ xModPanel\(\)/.test(SRC), true);
is('it reads whatever book it is handed',
   /function modSites\(book = BOOK, harvest = null\)/.test(SRC), true);
is('and so does the site harvest',        /function harvestSites\(book = BOOK\)/.test(SRC), true);
/* and the browser half hands it a stored harvest rather than a book of
   rows, which is what keeps opening a project off the payloads */
is('the browser half passes a harvest, not rows', /modSites\(null, xsites\)/.test(SRC), true);
is('the harvest is computed at upload',   /function xHarvestOf\(/.test(SRC), true);
is('and rebuilt into the Maps modSites wants', /function xHarvestBack\(/.test(SRC), true);

/* ---- 1d. a displayed count is stored, not reconstituted --------------
   The overview and the tracker tile both print "N done / N open". The
   first version of the narrowing recovered that count from the stored
   percentage - round(pct * n_rows / 100) - which at 2,627 rows is worth
   about 13 rows of slack, so the figure came back one or two different
   from the one the sheet has. A number that drifts because it was
   rebuilt from a rounded one is a bug, and this is the shape of it. */
is('the exact done count is stored', /n_done/.test(SRC), true);
is('and nothing rebuilds a count out of a percentage',
   /Math\.round\(\s*(m\.)?pct\s*\*\s*m\.n_rows\s*\/\s*100\s*\)/.test(SRC), false);
is('the column exists in the migration',
   /n_done\s+integer/.test(fs.readFileSync(path.join(ROOT, 'supabase', '047_project_update_projects.sql'), 'utf8')), true);

/* ---- 1c. publishing the rollout workbook is still reachable ----------
   THIS IS A REGRESSION THAT ALREADY HAPPENED ONCE, which is why it has an
   assertion. The redraw dropped the only link that clicked #file. The
   input and its change handler were both still in the page, so nothing
   was obviously missing - there was simply no way to publish a workbook
   any more, and no error to notice. */
is('the published-workbook input is still there', /<input type="file" id="file"/.test(SRC), true);
is('its change handler is still wired',  /\$\('file'\)\.addEventListener\('change'/.test(SRC), true);
is('AND SOMETHING IN THE PAGE CLICKS IT', /\$\('file'\)\.click\(\)/.test(SRC), true);
is('both datasets can be published, not just the current one',
   /DATASETS\.map\(d =>[\s\S]{0,200}data-up="/.test(SRC), true);

/* and the links are wired by the same attribute they are drawn with.
   Without this, pointing the selector at an attribute nothing carries
   leaves the links on screen doing nothing - the same regression as
   above with one more step in it, and the first version of this file
   did not catch that. */
const drawnAttr = (/<a href="#" data-([a-z-]+)="' \+ esc\(d\.key\)/.exec(SRC) || [])[1];
const boundAttr = (/querySelectorAll\('\[data-([a-z-]+)\]'\)\.forEach\(a => a\.onclick/.exec(SRC) || [])[1];
is('the publish links are drawn with an attribute', typeof drawnAttr === 'string', true);
is('something binds a click to that same attribute', boundAttr, drawnAttr);

/* ---- 2. the dashboard half still reads the published workbook ---------- */
is('it still loads the book', /window\.DB\.loadBook\(bookKey\(\)/.test(SRC), true);
is('and still subscribes to it', /window\.DB\.subscribeBook\(bookKey\(\)/.test(SRC), true);
is('and the toast is still gated on a real event',
   /if \(!why\) toast\('Updated from another device'/.test(SRC), true);
is('the tool is still shared with the team',
   /tool:project-update'[^}]*tier:'tooway'/.test(ACCESS), true);

/* ---- 3. the browser half reaches storage through ONE door ------------

   THIS ASSERTION WAS REVERSED ON 1 NOVEMBER, and the old wording is kept
   here rather than deleted because the reversal is the point.

   It used to read "the browser half never goes through the database",
   and that was the right thing to assert while the projects were local:
   it was a decision with an egress bill attached, and the bill had just
   been paid once. The projects are synced now - a project made on the
   laptop has to exist on the phone - so the question changed.

   What replaces it is narrower and harder to get wrong by accident. The
   browser half must reach storage ONLY through PUStore. Not window.DB,
   not indexedDB, not localStorage. That boundary is why Year Goals went
   local-to-table without a rewrite, and it is the thing that makes the
   NEXT change cheap.

   It caught a real hole the hour it was written: the two delete paths
   were calling window.DB.puDeleteReports directly.

   What stops the sync becoming last month's bill is not here. It is
   tools/project-update/lazy.test.js, which watches what each read ASKS
   the server for and fails if opening the list names a payload. */
const xlStart = SRC.indexOf('THE EXCEL BROWSER - the second half');
is('the browser half was found', xlStart > 0, true);
const xlSrc = SRC.slice(xlStart, SRC.indexOf('/* ---------- render ---------- */'));
is('it is substantial enough to be the real thing', xlSrc.length > 8000, true);
is('THE BROWSER HALF TALKS TO NOTHING BUT PUStore',
   (xlSrc.match(/window\.DB\.|indexedDB\.|localStorage\./g) || []), []);
is('and it does talk to PUStore',  /PUStore\./.test(xlSrc), true);
is('store.js is loaded by the page', /<script src="store\.js"><\/script>/.test(SRC), true);
is('the local fallback moved into the store rather than vanishing',
   /indexedDB\.open\(DB_NAME/.test(fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8')), true);

/* and its names cannot shadow the dashboard's, which is the other way one
   half silently breaks the other */
for (const [mine, theirs] of [['xParseSheet', 'parseSheet'], ['xLoad', 'load']]) {
  is('the browser half declares ' + mine + ', not a second ' + theirs,
     new RegExp('(const|function)\\s+' + mine + '\\b').test(xlSrc), true);
  is('and does not redeclare ' + theirs,
     new RegExp('(const|let|function)\\s+' + theirs + '\\s*[=({]').test(xlSrc), false);
}

/* its two document listeners must not act while the other half is on screen */
const listeners = xlSrc.match(/document\.addEventListener\('(click|keydown)'[\s\S]{0,120}/g) || [];
is('both document listeners are present', listeners.length, 2);
is('and both check which half is on screen',
   listeners.every(l => /ACTIVE !== EXCEL_TAB/.test(l)), true);

/* ---- 4. the photograph is the pair that is actually on disk ------------
   The design ships PNGs; this page deliberately loads a WebP pair. A path
   that points at nothing paints the flat --bg and looks deliberate. */
const refs = [...SRC.matchAll(/url\('(img\/[^']+)'\)/g)].map(m => m[1]);
is('the scene names four files', refs.length, 4);
for (const r of refs) {
  const f = path.join(__dirname, r);
  is(r + ' is on disk', fs.existsSync(f), true);
  if (!fs.existsSync(f)) continue;
  const b = fs.readFileSync(f);
  is(r + ' is really a WebP', b.slice(0, 4).toString() + b.slice(8, 12).toString(), 'RIFFWEBP');
}
is('both themes are covered', refs.filter(r => /light/.test(r)).length, 2);
is('and both widths',          refs.filter(r => /1672/.test(r)).length, 2);

/* ---- 5. the sticky strip clears the bars above it ----------------------
   The design stuck the sheet strip under its own single 64px header. Here
   three bars stack above it, and at 64 the sheet tabs were simply gone -
   behind a taller bar with a higher z-index, which looks like nothing. */
const tabsTop = +(/\.tabs\{position:sticky;top:(\d+)px/.exec(SRC) || [])[1];
const tabsPad = +(/\.tabs\{[^}]*padding:(\d+)px/.exec(SRC) || [])[1];
const stripTop = +(/#xl \.strip\{position:sticky;top:(\d+)px/.exec(SRC) || [])[1];
is('the tab strip declares where it sticks', Number.isFinite(tabsTop), true);
is('and so does the sheet strip',            Number.isFinite(stripTop), true);
is('the sheet strip starts below the tab strip (' + stripTop + ' > ' + tabsTop + ')',
   stripTop > tabsTop + tabsPad * 2, true);
is('and no narrow override puts it back underneath',
   /#xl \.strip\{top:\d+px/.test(SRC.slice(SRC.indexOf('@media (max-width:640px)'))), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
