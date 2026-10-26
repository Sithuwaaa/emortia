/* photos-reachable.test.js - a stored picture must arrive at a thumbnail
   and a download button.

     node tools/esn/photos-reachable.test.js

   WHY THIS EXISTS. On 26 October f725036 narrowed WH24's page read to an
   explicit column list without `gins`. Every opened ticket then rendered its
   materials, its reservation and its GI number with no Download button, while
   617 verified PDFs sat in the bucket. Nothing caught it: the document tests
   all asked whether a file had been STORED, none asked whether a stored file
   still ARRIVED somewhere a person could click.

   ESN has the same shape - a file in a private bucket, a path on a row, a
   control on a page - and the same hole. It also has one WH24 did not:

       THE COLUMNS AND THE PAGE DO NOT USE THE SAME NAMES.

   The table stores esn_photo / esn_full / om_ip_photo. The page reads
   r.esnPhoto / r.esnFull / r.omIpPhoto. E.fromRow is the only thing joining
   them, so a column dropped from the select does not produce an error
   anywhere - fromRow quietly sets the camelCase key to undefined, renderFiled
   quietly emits '' for that picture, and the row still renders with its site,
   its serials, its UMPT password and its timestamp. Exactly WH24's failure,
   and quieter.

   So this test is the whole chain, driven by what the read actually asks for
   rather than by a copy of it:

       db.js esnList's select  ->  project a snake_case row through it
                               ->  E.fromRow
                               ->  the page's real renderFiled
                               ->  img[data-shot] + button.dl

   TWO TRAPS, guarded in tools/_lib/reachable.js and asserted before use:

   1. A FAKE THAT DOES NOT PROJECT PASSES EITHER WAY. fake-supabase.js records
      st.cols and never applies it, so a row comes back whole whatever the
      select asked for - it would report healthy thumbnails under a narrowed
      read too. selfCheck proves the projection projects first.

   2. THE EMPTY CASE IS ASSERTED IN THE SAME BREATH, or a renderFiled that
      always returned '' would pass this file for ever. Section 5.

   WHAT IS STUBBED, AND WHY THAT IS HONEST. actionsHtml and E.localStamp /
   E.agoStamp are stand-ins: they draw the Edit and Delete cell and format a
   date, and neither can carry a picture. Everything on the path from a stored
   path to a clickable control is the real thing.

   Fixtures are invented. No real site code, serial, ESN or filename.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const R = require(path.join(ROOT, 'tools', '_lib', 'reachable.js'));
const E = require('./esn.js');

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
const COLS = R.selectOf(DB, 'esnList');
is('esnList declares what it selects', typeof COLS === 'string' && COLS.length > 0, true);

/* ---- 2. the page's real renderFiled ------------------------------------
   It takes no arguments and reads module-level state, so the state is what
   gets injected. FILED and SIGNED_IN are the two the tool itself sets. */
const PAGE = fs.readFileSync(path.join(ROOT, 'tools', 'esn', 'index.html'), 'utf8');
const src = R.lift(PAGE, 'renderFiled');
is('renderFiled was lifted from the page', !!src, true);

const KIND_LABEL = (/const KIND_LABEL = (\{[^}]+\})/.exec(PAGE) || [])[1];
is('KIND_LABEL was read from the page too', !!KIND_LABEL, true);

function render(filed, signedIn) {
  const fn = new Function('FILED', 'SIGNED_IN', 'E', 'esc', 'KIND_LABEL', 'actionsHtml',
    src + '\nreturn renderFiled();');
  return fn(filed, signedIn,
    Object.assign({}, E, { localStamp: s => String(s || ''), agoStamp: () => 'just now' }),
    R.esc, eval('(' + KIND_LABEL + ')'), () => '<td-actions/>');
}

/* ---- 3. a row as the table stores it ----------------------------------- */
const row = {
  id: 'r-0001',
  site_id: 'AA-0001', site_name: 'Invented Site', run_om: true,
  esn_photo:   'AA-0001/2026-03-03T00-00-00-000Z-esn.webp',
  esn_full:    'AA-0001/2026-03-03T00-00-00-000Z-full.webp',
  om_ip_photo: 'AA-0001/2026-03-03T00-00-00-000Z-om.webp',
  cards: [{ type: 'UMPT-INVENT', serial: 'SN-ALPHA-0001' }],
  umpt_password: 'not-a-real-password',
  note: 'invented record',
  created_by: 'u-1', created_email: 'nobody@example.invalid',
  created_name: 'Nobody', created_at: '2026-03-03T00:00:00.000Z'
};

const asRead = R.project(row, COLS);
is('the read carries the ESN picture column',    'esn_photo' in asRead, true);
is('and the full-shot column',                   'esn_full' in asRead, true);
is('and the O&M IP column',                      'om_ip_photo' in asRead, true);

/* the join that renames them, which is where a dropped column goes quiet */
const rec = E.fromRow(asRead);
is('fromRow carries all three paths through',
   [rec.esnPhoto, rec.esnFull, rec.omIpPhoto].filter(Boolean).length, 3);

/* ---- 4. the chain ------------------------------------------------------ */
const html = render([rec], true);

is('a filed record shows a thumbnail per picture',
   (html.match(/class="thumb"/g) || []).length, 3);
is('and a download button per picture',
   (html.match(/class="dl"/g) || []).length, 3);
is('the thumbnail carries the bucket path', html.indexOf('data-shot="' + rec.esnPhoto + '"') >= 0, true);
is('the button carries the record it belongs to', /data-dl="r-0001"/.test(html), true);

/* every kind reaches its own button - three thumbs with one kind repeated
   would satisfy the counts above and still lose two pictures */
for (const k of ['esnPhoto', 'esnFull', 'omIpPhoto'])
  is('kind ' + k + ' has its own button', html.indexOf('data-kind="' + k + '"') >= 0, true);

is('and more than one picture offers Download All', /data-dlall="r-0001"/.test(html), true);

/* ---- 5. the empty cases, which are what prove the check can see a failure */
is('a record with no pictures shows no thumbnail',
   /class="thumb"/.test(render([E.fromRow(R.project(
     Object.assign({}, row, { esn_photo: null, esn_full: null, om_ip_photo: null }), COLS))], true)), false);
is('but the record itself still renders',
   /AA-0001/.test(render([E.fromRow(R.project(
     Object.assign({}, row, { esn_photo: null, esn_full: null, om_ip_photo: null }), COLS))], true)), true);
is('one picture does not offer Download All',
   /data-dlall/.test(render([E.fromRow(R.project(
     Object.assign({}, row, { esn_full: null, om_ip_photo: null }), COLS))], true)), false);
is('nothing filed yet says so',      /Nothing filed yet/.test(render([], true)), true);
is('and draws no table',             /<table>/.test(render([], true)), false);

/* 6. an empty list from an expired session is not an empty database - the
      distinction the tool already makes, and the one that would otherwise
      let "no pictures" and "no sign-in" look identical */
is('an expired sign-in says the records are still on the server',
   /sign-in has expired/.test(render([], false)), true);
is('and does not claim nothing is filed',
   /Nothing filed yet/.test(render([], false)), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
