/* photos-reachable.test.js - a stored picture must arrive at a gallery button.

     node tools/swap/photos-reachable.test.js

   WHY THIS EXISTS. On 26 October f725036 narrowed WH24's page read to an
   explicit column list without `gins`. Every opened ticket then rendered its
   materials, its reservation and its GI number with no Download button, while
   617 verified PDFs sat in the bucket. Nothing caught it: the document tests
   all asked whether a file had been STORED, none asked whether a stored file
   still ARRIVED somewhere a person could click.

   Swap has the same shape - a file in a private bucket, a path on a row, a
   control on a page - and one more link in the chain than either of the
   others, because the paths are not in a column of their own:

       items (jsonb)  ->  items[].photos[] + items[].photoKinds[]

   One column carries every picture in the record. Dropping `items` from the
   select would not take the pictures off one row, it would take the Photos
   column, the quantities, the serials, the statuses and the whole inventory
   off every row at once - and `Array.isArray(row.items) ? row.items : []` in
   S.fromRow means it would do that without raising anything. The page would
   render its headers over an empty table and read as "nothing filed yet".

   So this test is the whole chain, driven by what the read actually asks for
   rather than by a copy of it:

       db.js swapList's select  ->  project a snake_case row through it
                                ->  S.fromRow
                                ->  the page's real flat()
                                ->  the page's real renderRows()
                                ->  button.galbtn carrying path/kind pairs

   TWO TRAPS, guarded in tools/_lib/reachable.js and asserted before use:

   1. A FAKE THAT DOES NOT PROJECT PASSES EITHER WAY. fake-supabase.js records
      st.cols and never applies it, so a row comes back whole whatever the
      select asked for - it would report a healthy gallery button under a
      narrowed read too. selfCheck proves the projection projects first.

   2. THE EMPTY CASE IS ASSERTED IN THE SAME BREATH, or a renderRows that
      always drew an empty table would pass this file for ever. Section 5,
      and both of its two spellings: nothing filed, and nothing matching.

   AND THE PAYLOAD IS DECODED, NOT PATTERN-MATCHED. The button carries its
   paths as escaped JSON in an attribute. Asserting /data-gal="/ would pass on
   an empty array; section 4 parses it and checks the pairs that come back.

   WHAT IS STUBBED, AND WHY THAT IS HONEST. locSel and dropCell draw the
   owner's Location and Delete cells, and `stamp` formats a date. None of the
   three can carry a picture. up, siteOf, S.fromRow, S.movesOf, flat and
   renderRows are all the real thing.

   Fixtures are invented. No real site code, material code, serial or filename.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const R = require(path.join(ROOT, 'tools', '_lib', 'reachable.js'));
const S = require('./swap.js');

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- 0. the harness, before anything trusts it ------------------------- */
R.selfCheck(is);

/* ---- 1. what the read actually asks for -------------------------------- */
const DB = fs.readFileSync(path.join(ROOT, 'tools', '_lib', 'db.js'), 'utf8');
const COLS = R.selectOf(DB, 'swapList');
is('swapList declares what it selects', typeof COLS === 'string' && COLS.length > 0, true);

/* ---- 2. the page's real flat() and renderRows() ------------------------ */
const PAGE = fs.readFileSync(path.join(ROOT, 'tools', 'swap', 'index.html'), 'utf8');
const flatSrc = R.lift(PAGE, 'flat');
const rowsSrc = R.lift(PAGE, 'renderRows');
is('flat was lifted from the page', !!flatSrc, true);
is('renderRows was lifted from the page', !!rowsSrc, true);

/* up and siteOf are one-line consts on the same path, so they are taken from
   the page too rather than reinvented here */
const upSrc = (/const up = ([^;]+);/.exec(PAGE) || [])[1];
const siteOfSrc = (/const siteOf = ([^;]+);/.exec(PAGE) || [])[1];
is('up was read from the page', !!upSrc, true);
is('siteOf was read from the page', !!siteOfSrc, true);
const up = eval('(' + upSrc + ')');
const siteOf = eval('(' + siteOfSrc + ')');

const flat = new Function('S', 'siteOf', 'up', 'stamp', flatSrc + '\nreturn flat;')(
  S, siteOf, up, d => d.toISOString().slice(0, 19).replace('T', ' '));

function render(rows, filedCount) {
  const box = { innerHTML: null };
  const fn = new Function('$', 'FILED', 'esc', 'locSel', 'dropCell',
    rowsSrc + '\nreturn renderRows;');
  fn(() => box, new Array(filedCount == null ? rows.length : filedCount).fill({}),
     R.esc, () => '<loc/>', () => '<td-drop/>')(rows);
  return box.innerHTML;
}

/* the attribute holds escaped JSON; reading it back is the only way to know
   the paths are in there rather than an empty array */
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const galsOf = html => (html.match(/data-gal="([^"]*)"/g) || [])
  .map(m => JSON.parse(unesc(/data-gal="([^"]*)"/.exec(m)[1])));

/* ---- 3. a row as the table stores it ----------------------------------- */
const P1 = 'AA-0001/2026-03-03T00-00-00-000Z-sn.jpg';
const P2 = 'AA-0001/2026-03-03T00-00-00-001Z-full1.jpg';
const row = {
  id: 'r-0001',
  airtel_site: 'AA-0001', airtel_name: 'Invented Site A',
  dialog_site: 'DD-0001', dialog_name: 'Invented Site D',
  removed: 'airtel', visited_on: '2026-03-03', team: 'Invented Team',
  items: [
    { code: 'MAT-ALPHA-01', name: 'Invented widget', qty: 2, uom: 'EA',
      serials: [{ sn: 'SN-ALPHA-0001', photo: P1 }],
      photos: [P1, P2], photoKinds: ['sn', 'full1'],
      status: 'ok', submittedAt: '2026-03-03T00:00:00.000Z', moves: [] },
    { code: 'MAT-BETA-02', name: 'Invented bracket', qty: 1, uom: 'EA',
      noSn: true, serials: [], photos: [], photoKinds: [],
      submittedAt: '2026-03-03T00:00:00.000Z', moves: [] }
  ],
  note: 'invented record',
  created_by: 'u-1', created_name: 'Nobody', created_at: '2026-03-03T00:00:00.000Z'
};

const asRead = R.project(row, COLS);
is('the read carries the column the pictures live in', 'items' in asRead, true);

const rec = S.fromRow(asRead);
is('fromRow keeps the items as an array', Array.isArray(rec.items), true);
is('and keeps both of them',              rec.items.length, 2);
is('and the paths inside the first',      (rec.items[0] || {}).photos, [P1, P2]);

const rows = flat([rec]);
is('flat produces a row per item',        rows.length, 2);
is('and carries the paths onto the row',  (rows[0] || {}).photos, [P1, P2]);
is('with a kind beside each',             (rows[0] || {}).kinds, ['sn', 'full1']);

/* ---- 4. the chain, decoded --------------------------------------------- */
const html = render(rows);
is('an item with pictures shows a gallery button',
   (html.match(/class="galbtn"/g) || []).length, 1);
is('the button counts them',  /class="galbtn"[^>]*>[^<]*2</.test(html), true);

const gals = galsOf(html);
is('and its payload parses',                    gals.length, 1);
is('carrying one pair per stored picture',      (gals[0] || []).length, 2);
is('each pair being a bucket path and a kind',  gals[0] || null, [[P1, 'sn'], [P2, 'full1']]);
is('the row itself renders beside it',          /MAT-ALPHA-01/.test(html), true);

/* ---- 5. the empty cases, which are what prove the check can see a failure */
is('the second item has no pictures and no button',
   /class="galbtn"/.test(render(rows.slice(1))), false);
is('but it still renders',
   /MAT-BETA-02/.test(render(rows.slice(1))), true);

is('nothing filed at all says so',
   /Nothing in inventory yet/.test(render([], 0)), true);
is('and draws no table',          /<table/.test(render([], 0)), false);
is('nothing matching a filter says something different',
   /Nothing matches/.test(render([], 3)), true);

/* 6. the whole column gone - the failure that reads as an empty tool rather
      than a broken one, which is why it is asserted as its own case */
{
  const stripped = S.fromRow(R.project(Object.assign({}, row, { items: undefined }), COLS));
  const out = render(flat([stripped]), 0);
  is('a record whose items column never arrived renders nothing at all',
     /class="galbtn"/.test(out), false);
  is('and flat produces no rows from it', flat([stripped]).length, 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
