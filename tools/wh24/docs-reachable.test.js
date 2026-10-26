/* docs-reachable.test.js - a stored document must arrive at a button.

     node tools/wh24/docs-reachable.test.js

   WHY THIS EXISTS. f725036 narrowed the WH24 page read to an explicit
   column list without `gins`, on a plan whose second half - fetching the
   documents when a ticket is opened - was never built. For two days every
   opened ticket rendered its materials, its reservation and its GI number
   with no Download button, while 617 verified PDFs sat in the bucket.

   Nothing caught it. The document work is thoroughly tested and every one
   of those tests asks whether a document was STORED - bytes verified, path
   deterministic, upsert on, download name resolved. None asked whether a
   stored document is still REACHABLE. The chain from a column in the read
   to a button under an opened ticket had no guard on it, so removing a link
   from that chain broke nothing any test could see.

   So this test is the chain, end to end, driven by what the read actually
   asks for rather than by a copy of it:

       db.js wh24Load's column list  ->  project a row through it
                                     ->  the page's real docsBox
                                     ->  a Download button

   TWO TRAPS, both named in the decisions entry and both guarded here.

   1. A FAKE THAT DOES NOT PROJECT PASSES EITHER WAY. tools/_lib/fake-supabase.js
      records st.cols and never applies it, so a row comes back whole
      whatever the select asked for - it would report a healthy ticket under
      the narrow read too. The projection below is therefore asserted on its
      own before it is trusted.

   2. ASSERT THE EMPTY CASE IN THE SAME BREATH. docsBox returns '' for a
      ticket with no documents. Without checking that, a docsBox that always
      returned '' would pass this file for ever.

   Fixtures are invented: no real GI number, reservation, site or filename.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const W = require('./wh24.js');

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- 1. what the read actually asks for ---------------------------------

   Read out of db.js, not restated here. If somebody narrows wh24Load again,
   this test narrows with it - which is the only way it can notice. */
const DB = fs.readFileSync(path.join(ROOT, 'tools', '_lib', 'db.js'), 'utf8');

const colsExpr = (/async function wh24Load\([^)]*\)\s*\{[\s\S]{0,400}?const cols\s*=\s*([^;]+);/.exec(DB) || [])[1];
is('wh24Load declares what it selects', typeof colsExpr === 'string', true);

/* the expression is either '*' or one of the declared lists */
function resolveCols(expr) {
  if (!expr) return null;
  const e = expr.trim();
  if (/^['"]\*['"]$/.test(e)) return '*';
  const lit = /^['"]([^'"]+)['"]$/.exec(e);
  if (lit) return lit[1];
  /* a named list, e.g. WH24_LIST or a ternary mentioning it */
  const named = /WH24_LIST/.test(e);
  if (named) {
    const m = /const WH24_LIST = \[([\s\S]*?)\]\.join/.exec(DB);
    if (m) return (m[1].match(/'([a-z_0-9]+)'/g) || []).map(x => x.replace(/'/g, '')).join(',');
  }
  if (/\*/.test(e)) return '*';     /* a ternary with '*' on one side */
  return null;
}
const COLS = resolveCols(colsExpr);
is('and the column list resolves', typeof COLS === 'string' && COLS.length > 0, true);

/* ---- 2. a fake that honours the column list ---------------------------- */
function project(row, cols) {
  if (!cols || cols.trim() === '*') return Object.assign({}, row);
  const keep = cols.split(',').map(s => s.trim()).filter(Boolean);
  const out = {};
  for (const k of keep) if (k in row) out[k] = row[k];
  return out;
}

/* the harness guards itself, because a projection that does not project is
   the whole reason this bug survived a test suite once already */
{
  const whole = { id: 1, gins: [{ file: 'a.pdf' }], lines: [] };
  is('projection keeps what was asked for', Object.keys(project(whole, 'id,lines')).sort(), ['id', 'lines']);
  is('projection drops what was not',       'gins' in project(whole, 'id,lines'), false);
  is('and star keeps everything',           Object.keys(project(whole, '*')).sort(), ['gins', 'id', 'lines']);
}

/* ---- 3. the page's real docsBox ---------------------------------------- */
const PAGE = fs.readFileSync(path.join(ROOT, 'tools', 'wh24', 'index.html'), 'utf8');

function lift(name) {
  const start = PAGE.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = PAGE.indexOf('{', start), depth = 0;
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (!depth) return PAGE.slice(start, i + 1); }
  }
  return null;
}
const src = lift('docsBox');
is('docsBox was lifted from the page', !!src, true);

/* esc is the page's own; nice only formats a date and is stubbed, because
   this test is about whether a button arrives, not how a day reads */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nice = d => String(d || '');
const docsBox = new Function('W', 'esc', 'nice', src + '\nreturn docsBox;')(W, esc, nice);

/* ---- 4. the chain ------------------------------------------------------ */
const ticket = {
  id: 90210, site: 'AA-0001', site_name: 'Invented Site', stream: 'Advantis',
  wo: 'WO-1', reservation: '1700001', stage: 'Material Collection', status: 'Done',
  phase: 'PH1', lines: [{ code: 'MAT-ALPHA-01', desc: 'Widget', qty: 2 }],
  timeline: [], site_lines: [],
  gins: [
    { file: 'inv-0001.pdf', gi: '4930000001', res: '1700001', date: '2026-03-03',
      path: 'wh24/90210/inv-0001.pdf' },
    { file: 'inv-0002.pdf', rep: '900000002', date: '2026-03-04', kind: 'move',
      path: 'wh24/90210/inv-0002.pdf' }
  ]
};

const asRead = project(ticket, COLS);
const html = docsBox(asRead);

is('the read carries the documents column', 'gins' in asRead, true);
is('an opened ticket shows a Download button', /class="mini dl"/.test(html), true);
is('one button per stored document', (html.match(/class="mini dl"/g) || []).length, 2);
is('the button carries the bucket path', /data-path="wh24\/90210\/inv-0001\.pdf"/.test(html), true);
is('and a filename to save it as', /data-name="[^"]+"/.test(html), true);

/* 5. the empty case, which is what proves the check can see a failure */
is('a ticket with no documents renders nothing', docsBox(project({ id: 1, gins: [] }, COLS)), '');
is('and so does one whose column is absent',     docsBox({ id: 1 }), '');

/* 6. a document WorkHub has but the bucket does not: no button, and a line
      saying why - the case that must not look like a missing feature */
{
  const partial = docsBox(project(Object.assign({}, ticket, {
    gins: [{ file: 'inv-0003.pdf', gi: '4930000003', date: '2026-03-05' }]
  }), COLS));
  is('an unstored document gets no button', /class="mini dl"/.test(partial), false);
  is('but says it is held in WorkHub24',    /held in WorkHub24/.test(partial), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
