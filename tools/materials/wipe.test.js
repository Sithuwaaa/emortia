/* wipe.test.js - emptying the material list, proved by breaking it.

     node tools/materials/wipe.test.js

   Four things were asked for and all four are the kind that pass by
   accident if you only check the happy path:

     cancelling at step one deletes nothing
     cancelling at step two deletes nothing
     a non-owner cannot reach it at all
     the number in the question is the live count, not a baked-in one

   So none of them is asserted against a mock of my own making. The two
   database functions are LIFTED OUT OF db.js and the two page functions
   out of index.html, and they run against Fake.client with the store
   inspected afterwards. "The wipe was not called" is not the assertion -
   "the rows are still in the store" is, because a wipe that was called
   and silently did nothing would pass the first and fail the second.

   Fixtures are invented: no real material code, description or vendor.
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

const countSrc = lift(DB_SRC, 'materialsCount');
const wipeSrc  = lift(DB_SRC, 'materialsWipe');
const askSrc   = lift(PAGE_SRC, 'askWipe');
const obSrc    = lift(PAGE_SRC, 'ownerBlock');
is('materialsCount was found in db.js', typeof countSrc === 'string' && countSrc.length > 200, true);
is('materialsWipe was found in db.js',  typeof wipeSrc  === 'string' && wipeSrc.length  > 200, true);
is('askWipe was found in index.html',   typeof askSrc   === 'string' && askSrc.length   > 400, true);
is('ownerBlock was found in index.html',typeof obSrc    === 'string' && obSrc.length    > 100, true);

/* the real db.js pair, over one fake client */
const dbFor = db => new Function('client',
  'async ' + countSrc + '\nasync ' + wipeSrc +
  '\nreturn { materialsCount, materialsWipe };')(async () => db);

const row = i => ({ code: 'MM-' + String(i).padStart(4, '0'),
  descr: 'Invented material ' + i, type: 'Invented type',
  vendor: 'Invented vendor', attrs: { Band: String(700 + i) },
  updated_at: '2026-09-05T07:47:23.837229+00:00' });
const store = n => Array.from({ length: n }, (_, i) => row(i + 1));

/* ---------------------------------------------------------------- the page

   askWipe assigns to the page's module-level state, so the state is
   declared inside the sandbox and handed back through peek(). Everything
   it reaches out to - the DOM, the toast, the box, the repaint - is a
   stub that RECORDS, so the test can ask what the question said rather
   than assume. */
function pageFor(db, opts) {
  const o = opts || {};
  const el = { wipe: { disabled: false, textContent: 'Empty the list…' },
               q: { value: '' } };
  const seen = { toasts: [], steps: null, painted: 0 };
  const $ = id => el[id] || null;
  const toast = (m) => seen.toasts.push(String(m));
  const paint = () => { seen.painted++; };
  const Ask = { twice: (steps) => { seen.steps = steps;
                                    return Promise.resolve(o.answer !== false &&
                                                           o.cancelAt == null); } };
  if (o.cancelAt != null) {
    /* a cancel is "the box returned false at step N" - and the step it
       stopped at is recorded, so a test cannot pass by never opening it */
    Ask.twice = (steps) => { seen.steps = steps; seen.cancelledAt = o.cancelAt;
                             return Promise.resolve(false); };
  }
  const DB = o.DB || dbFor(db);
  const win = { DB };
  const src =
    'let ALL = ' + JSON.stringify(o.ALL || []) + ';\n' +
    'let MSTAMP = "x", MN = 1, PICKED = {}, FS = { Band: ["700"] };\n' +
    'let TYPE = "Invented type", FAM = "RF", VENDOR = "Invented vendor";\n' +
    'let Q = "mm", LIM = 400, WIPED = null;\n' +
    'async ' + askSrc + '\n' +
    'return { askWipe, peek: () => ({ ALL, MSTAMP, MN, PICKED, FS, TYPE, FAM,' +
    ' VENDOR, Q, LIM, WIPED }) };';
  const made = new Function('$', 'toast', 'Ask', 'window', 'paint', src)
    ($, toast, Ask, win, paint);
  return { el, seen, DB, askWipe: made.askWipe, peek: made.peek };
}

(async () => {

/* ================================================================== 1
   THE COUNT IS THE TABLE'S, NOT THE PAGE'S                             */
{
  const db = Fake.client({ materials: store(2422) });
  const api = dbFor(db);
  const r = await api.materialsCount();
  const c = db.__calls.filter(x => x.table === 'materials');
  is('the count is what the table holds', r.n, 2422);
  is('it took exactly one request',       c.length, 1);
  is('IT ASKED FOR NO ROWS AT ALL - count in the header, head: true',
     [c[0].count, c[0].head], ['exact', true]);
}
{
  /* the same code against a different table has to say a different
     number - this is what "live, not baked in" means and it is the only
     way to tell the two apart */
  const db = Fake.client({ materials: store(7) });
  const r = await dbFor(db).materialsCount();
  is('A DIFFERENT TABLE GIVES A DIFFERENT NUMBER', r.n, 7);
}
{
  const db = Fake.client({ materials: [] });
  const r = await dbFor(db).materialsCount();
  is('an empty table counts zero, not null', r.n, 0);
  is('and does not call it an error',        r.error, null);
}

/* ================================================================== 2
   THE QUESTION CARRIES THAT NUMBER                                     */
{
  const db = Fake.client({ materials: store(2422) });
  const p = pageFor(db, { cancelAt: 1 });
  await p.askWipe();
  /* counted the way Ask.twice counts them - it does steps.filter(Boolean)
     first, so a step that is falsy is a step that does not exist, and
     asserting on the raw array length would not notice one going missing */
  const steps = (p.seen.steps || []).filter(Boolean);
  is('the box was opened with two real steps', steps.length, 2);
  is('and both of them ask something',
     steps.every(s => typeof s.title === 'string' && s.title.length > 10), true);
  is('STEP ONE NAMES THE LIVE COUNT', /\b2,422\b/.test(steps[0].title), true);
  is('and step two names what that number is, not the number again',
     /\b2,422\b/.test(steps[1].title), false);
}
{
  const db = Fake.client({ materials: store(7) });
  const p = pageFor(db, { cancelAt: 1 });
  await p.askWipe();
  is('AND A TABLE OF 7 SAYS 7, NOT 2,422',
     /\b7\b/.test(p.seen.steps[0].title) && !/2,422/.test(p.seen.steps[0].title), true);
}
{
  /* the page's own idea of the list is deliberately wrong here: if the
     question read ALL.length instead of the table it would say 3 */
  const db = Fake.client({ materials: store(2422) });
  const p = pageFor(db, { cancelAt: 1, ALL: [row(1), row(2), row(3)] });
  await p.askWipe();
  is('IT DOES NOT READ THE ROWS ALREADY ON THE PAGE',
     /\b2,422\b/.test(p.seen.steps[0].title), true);
}
{
  const db = Fake.client({ materials: [] });
  const p = pageFor(db, {});
  await p.askWipe();
  is('an already-empty list is never asked about', p.seen.steps, null);
  is('it says so instead', /already empty/i.test(p.seen.toasts.join(' ')), true);
}

/* ================================================================== 3
   CANCELLING AT EITHER STEP DELETES NOTHING                            */
{
  const db = Fake.client({ materials: store(2422) });
  const p = pageFor(db, { cancelAt: 1 });
  await p.askWipe();
  is('cancel at step one: the box was opened',   p.seen.steps.length, 2);
  is('CANCEL AT STEP ONE DELETES NOTHING',       db.__store.materials.length, 2422);
  is('and no delete was issued at all',
     db.__calls.filter(c => c.op === 'delete').length, 0);
  is('and the page state is untouched',          p.peek().ALL.length, 0);
  is('and it does not claim the list was emptied', p.peek().WIPED, null);
  is('and nothing was repainted',                p.seen.painted, 0);
}
{
  const db = Fake.client({ materials: store(2422) });
  const p = pageFor(db, { cancelAt: 2 });
  await p.askWipe();
  is('CANCEL AT STEP TWO DELETES NOTHING',       db.__store.materials.length, 2422);
  is('and no delete was issued at all',
     db.__calls.filter(c => c.op === 'delete').length, 0);
  is('and it does not claim the list was emptied', p.peek().WIPED, null);
}
{
  /* the guard has to be able to bite: with the same harness answering
     yes, the rows DO go. Without this the two above pass on a page that
     cannot delete anything at all. */
  const db = Fake.client({ materials: store(2422) });
  const p = pageFor(db, {});
  await p.askWipe();
  is('...and answering yes twice empties it',    db.__store.materials.length, 0);
  is('the page is told how many went',           p.peek().WIPED, 2422);
  is('and it repainted',                         p.seen.painted, 1);
}

/* ================================================================== 4
   IT DELETES ROWS, AND ONLY ROWS                                       */
{
  const db = Fake.client({ materials: store(500), site_data: [{ site_id: 'a' }],
                           wh24_tickets: [{ id: 1 }], feature_locks: [{ feature: 'x' }] });
  await db.storage.from('docs').upload('keep.pdf', { size: 9 });
  const before = db.__calls.length;          /* the upload above is mine */
  const n = await dbFor(db).materialsWipe();
  const mine = db.__calls.slice(before);
  is('it reports what the server removed',       n, 500);
  is('the material rows are gone',               db.__store.materials.length, 0);
  is('NO OTHER TABLE WAS TOUCHED',
     [...new Set(mine.map(c => c.table))], ['materials']);
  is('AND NO BUCKET WAS EITHER',
     mine.filter(c => c.bucket).length, 0);
  is('site_data is intact',                      db.__store.site_data.length, 1);
  is('wh24_tickets is intact',                   db.__store.wh24_tickets.length, 1);
  is('feature_locks is intact',                  db.__store.feature_locks.length, 1);
  is('and the bucket still holds the file that was in it',
     Object.keys(db.__files.docs || {}), ['keep.pdf']);
}
{
  /* THE FILTER IS CHECKED AS A FILTER, not by its effect. The fake, like
     any store, deletes everything when handed no filter at all - so
     "the table is empty afterwards" passes just as well for an
     UNFILTERED delete, which PostgREST refuses outright and which would
     fail only in production. The request itself is the assertion. */
  const db = Fake.client({ materials: store(31) });
  const n = await dbFor(db).materialsWipe();
  const del = db.__calls.filter(c => c.op === 'delete');
  is('exactly one delete was issued', del.length, 1);
  is('IT CARRIED A FILTER, AND IT IS not(code is null)',
     del[0].filters, [{ col: 'code', op: 'is', val: null, neg: true }]);
  is('it asked the server for the count', del[0].count, 'exact');
  is('every row matched it', n, 31);
  is('none survived it',     db.__store.materials.length, 0);
}
{
  /* A NON-OWNER, AT THE DATABASE. RLS on materials is
     "for all using (is_owner())", so a signed-in reader who is not the
     owner gets no error - the rows are simply invisible to the DELETE
     and nothing happens. The function must report that as 0 rather than
     as success, which is why it returns the server's count instead of
     what the caller hoped for. */
  const db = Fake.client({ materials: [] });          /* nothing visible */
  const n = await dbFor(db).materialsWipe();
  is('A REFUSED DELETE REPORTS 0, NOT SUCCESS', n, 0);
}
{
  const db = Fake.client({ materials: store(10) });
  const p = pageFor(db, { DB: { materialsCount: async () => ({ n: 10, error: null }),
                                materialsWipe:  async () => 0 } });
  await p.askWipe();
  is('and the page says nothing was deleted',
     /nothing was deleted/i.test(p.seen.toasts.join(' ')), true);
}

/* ================================================================== 5
   A NON-OWNER CANNOT REACH IT AT ALL                                   */
{
  const ownerBlock = new Function('window',
    obSrc + '\nreturn ownerBlock;')({ IS_OWNER: false });
  const html = ownerBlock();
  is('a non-owner gets no owner block at all', html, '');
  is('so there is no delete control in it',    /id="wipe"/.test(html), false);
}
{
  const ownerBlock = new Function('window',
    obSrc + '\nreturn ownerBlock;')({ IS_OWNER: true });
  const html = ownerBlock();
  is('THE OWNER DOES GET ONE - or the check above is vacuous',
     /id="wipe"/.test(html), true);
  is('and the upload is still there beside it', /id="up"/.test(html), true);
}
{
  /* the wiring is inside the same guard, so a button that is not in the
     DOM has nothing bound to it either */
  is('the handler is only bound when the control exists',
     /if \(\$\('wipe'\)\) \$\('wipe'\)\.onclick = askWipe;/.test(PAGE_SRC), true);
}

/* ================================================================== 6
   AFTERWARDS THE PAGE SAYS IT IS EMPTY, NOT THAT IT FAILED             */
{
  const db = Fake.client({ materials: store(2422) });
  const p = pageFor(db, {});
  await p.askWipe();
  const s = p.peek();
  is('the rows are cleared',        s.ALL.length, 0);
  is('the gate memory is cleared',  [s.MSTAMP, s.MN], [null, 0]);
  is('the filters are cleared',     [s.TYPE, s.FAM, s.VENDOR, s.Q, s.FS], ['', '', '', '', {}]);
  is('the open detail is closed',   s.PICKED, null);
  is('and WIPED holds the number the server reported', s.WIPED, 2422);
}
{
  /* the empty state and the count line both have to read WIPED, or the
     page shows a blank hint and a magnifying glass - which is what a
     failed load looks like */
  is('the count line stays on after a wipe',
     /ALL\.length \|\| WIPED !== null/.test(PAGE_SRC), true);
  is('the empty state has a branch for it',
     /WIPED !== null[\s\S]{0,400}rows were[\s\S]{0,80}deleted/.test(PAGE_SRC), true);
  is('and it says nothing failed',
     /Nothing failed/.test(PAGE_SRC), true);
  is('a later upload clears the flag',
     /if \(ALL\.length\) WIPED = null;/.test(PAGE_SRC), true);
}

/* ================================================================== 7
   THE BOX IS THE PROJECT'S, NOT A NEW ONE                              */
{
  is('it uses Ask.twice, like every other delete here',
     /Ask\.twice\(\[/.test(askSrc), true);
  is('and the page loads _lib/ask.js',
     /_lib\/ask\.js/.test(PAGE_SRC), true);
  is('and defines no confirm box of its own',
     /function ask\s*\(|window\.confirm|[^.]\bconfirm\(/.test(askSrc), false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

})();
