/* node tools/_lib/db.schema.test.js

   THE BUG CLASS THIS EXISTS FOR

   A check reported a migration unrun while the page was successfully reading
   384 rows out of the very table it claimed was missing. That has now happened
   three times - 037, 038 and 036 - and the cause was never the database.

   Two things are asserted here, and the first is the one that matters:

     1. The row shape and the schema agree. Every key wh24Publish would send
        is a column some migration creates. A field added to the model without
        a migration makes PostgREST refuse the WHOLE upsert, which is how a
        working tool stopped being able to write.

     2. The error translator can tell a missing COLUMN from a missing TABLE.
        They are worded almost identically by PostgREST and only one of them
        means "run migration 036".

   Schema-only - no database and no network. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const W = require(path.join(ROOT, 'tools/wh24/wh24.js'));

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- every column the migrations create on wh24_tickets ---- */
const sql = fs.readdirSync(path.join(ROOT, 'supabase'))
  .filter(f => /^\d+_wh24.*\.sql$/.test(f)).sort()
  .map(f => fs.readFileSync(path.join(ROOT, 'supabase', f), 'utf8')).join('\n');

function columnsOf(table) {
  const cols = new Set();
  const create = new RegExp('create table if not exists ' + table + ' \\(([\\s\\S]*?)\\n\\);').exec(sql);
  if (create) {
    create[1].split('\n').forEach(l => {
      const m = /^\s{2}([a-z_0-9]+)\s+\S/.exec(l.replace(/--.*$/, ''));
      if (m) cols.add(m[1]);
    });
  }
  /* \s+ rather than a single space: 039 aligns its two ALTERs into a column
     and writes "wh24_marks   add column". A fixed space matched neither, so
     the check reported a column missing that has been there since 039 - the
     same shape of mistake as the bug this file exists to catch. */
  const re = new RegExp('alter\\s+table\\s+' + table + '\\s+add column if not exists ([a-z_0-9]+)', 'g');
  let m;
  while ((m = re.exec(sql))) cols.add(m[1]);
  return cols;
}

/* ---- what a published row carries, from the real record() ---- */
function rowKeys() {
  const r = W.record({ id: 1, phase: 'PH2', stream: 'ACE', timeline: [], requested: [], gins: [] });
  /* wh24Publish stamps this one on every row on its way out */
  return Object.keys(r).concat(['synced_at']);
}

const cols = columnsOf('wh24_tickets');
const keys = rowKeys();
const missing = keys.filter(k => !cols.has(k));

is('the migrations create wh24_tickets at all', cols.size > 10, true);
is('EVERY key a published row carries has a column to go in\n' +
   '       (a missing one makes PostgREST refuse the whole upsert, and the\n' +
   '        error reads as a missing TABLE - which is the bug this file is for)',
   missing, []);

/* the same for the marks table, which 039 gave a second key column */
const mcols = columnsOf('wh24_marks');
['ticket_id', 'stream', 'collected_on', 'collected_by', 'note'].forEach(k => {
  is('wh24_marks has ' + k, mcols.has(k), true);
});

/* ---- a missing column must not be reported as a missing table ---- */
{
  const DB = fs.readFileSync(path.join(ROOT, 'tools/_lib/db.js'), 'utf8');
  const i = DB.indexOf('const wh24Why = m =>');
  const j = DB.indexOf('async function wh24Load');
  if (i < 0 || j < 0) throw new Error('wh24Why is not where it was');
  const ctx = {};
  /* the two translators, sliced out and run - not a retyped copy */
  new Function('exports', DB.slice(i, j) + '\n;exports.wh24Why = wh24Why;')(ctx);
  const why = ctx.wh24Why;

  const COLUMN = "Could not find the 'confirmations' column of 'wh24_tickets' in the schema cache";
  const TABLE = "Could not find the table 'public.wh24_tickets' in the schema cache";

  is('a missing COLUMN names the column', /"confirmations"/.test(why(COLUMN)), true);
  is('and does NOT claim the tool is switched off',
     /not switched on|migration 036/i.test(why(COLUMN)), false);
  is('a missing TABLE still does', /migration 036/.test(why(TABLE)), true);
  is('both used to give the same answer, which is the whole bug',
     why(COLUMN) === why(TABLE), false);

  is('a sign-in that ran out is still said plainly',
     /sign-in has run out/i.test(why('JWT expired')), true);
  is('and anything unrecognised comes through as itself',
     why('something nobody has seen before'), 'something nobody has seen before');
}

/* ---- the fallback column list must BE the schema the ESSENTIAL migrations
       make, and nothing later ----

   WH24T_COLS is what wh24Publish retries with when PostgREST refuses an
   upsert over a column the database has not got. So it has to be exactly the
   set a database that ran only the essential migrations has: 036 creates the
   table, 037 and 039 add to it, and every migration above that is optional
   BY DESIGN - the publish drops its columns and writes the rest.

   This used to name 042, which was right while 042 was the only optional
   one. 044 made it silently wrong in the worst direction: it started
   demanding prev_state in the very list whose whole job is to work on a
   database without prev_state. Optional is now read off the file numbers
   rather than hard-coded, so the next one cannot repeat it. */
const MIGRATIONS = fs.readdirSync(path.join(ROOT, 'supabase'))
  .filter(f => /^\d+_wh24.*\.sql$/.test(f)).sort();
const ESSENTIAL = /^0(36|37|39)_/;              /* create, and the two that must be run */
function addsOf(files, table) {
  const out = [];
  files.forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, 'supabase', f), 'utf8');
    const re = new RegExp('alter\\s+table\\s+' + table + '\\s+add column if not exists ([a-z_0-9]+)', 'g');
    let m; while ((m = re.exec(src))) out.push(m[1]);
  });
  return out;
}
{
  const DB = fs.readFileSync(path.join(ROOT, 'tools/_lib/db.js'), 'utf8');
  const m = /const WH24T_COLS = \[([\s\S]*?)\];/.exec(DB);
  is('wh24Publish has a fallback column list', !!m, true);
  const listed = m[1].match(/'([a-z_0-9]+)'/g).map(s => s.replace(/'/g, ''));
  /* every one of them must be a real column, or the fallback fails too */
  is('every fallback column exists in the schema', listed.filter(k => !cols.has(k)), []);

  const optional = addsOf(MIGRATIONS.filter(f => !ESSENTIAL.test(f)), 'wh24_tickets');
  is('there are optional migrations to be wrong about', optional.length > 0, true);
  /* The fallback must not quietly include one, or it is not a fallback - it
     would fail on exactly the database it exists to serve. */
  is('no optional migration\'s column is in the fallback list',
     listed.filter(k => optional.indexOf(k) >= 0), []);
  /* Compared against the schema WITHOUT them, not against itself. With every
     migration in the folder `missing` is empty, so comparing to that would
     have been a tautology that passes whatever the migrations contain. */
  const before = new Set([...cols].filter(k => optional.indexOf(k) < 0));
  is('and the fallback list IS the essential schema',
     listed.slice().sort(), [...before].sort());

  /* 042 is the one that carries the row model, so it alone must cover
     everything record() produces that the essential schema has not got. */
  const added042 = addsOf(['042_wh24_facts.sql'], 'wh24_tickets');
  is('042 adds exactly the columns the row needs and no others',
     added042.slice().sort(), keys.filter(k => !before.has(k)).sort());
}

/* ---- prev_state is attached to the row OUTSIDE record(), so the check
       above cannot see it ----

   The sync writes it in index.html, at the one moment it holds both the old
   row and the new one. That puts it past every guard here - rowKeys() asks
   record() what a row carries, and record() has never heard of it - so it
   gets its own assertions or it gets none. A key sent with no column behind
   it makes PostgREST refuse the whole upsert, which is the bug this file
   exists for. */
{
  const page = fs.readFileSync(path.join(ROOT, 'tools/wh24/index.html'), 'utf8');
  const sets = page.match(/\.prev_state\s*=/g) || [];
  is('the sync writes prev_state onto the row', sets.length > 0, true);
  is('and wh24_tickets has a column for it', cols.has('prev_state'), true);
  is('which is optional, so an unrun 044 only costs the feed its verdicts',
     addsOf(MIGRATIONS.filter(f => !ESSENTIAL.test(f)), 'wh24_tickets').indexOf('prev_state') >= 0,
     true);
  /* Every row that goes out with a fresh stamp must say what it was, or the
     feed reads a stale prev_state as a change that just happened. There are
     two places a row joins the publish: the diff, and the late pass that
     adds rows whose document gained a path. Both set it. */
  is('both paths that add a row to the publish set it', sets.length >= 2, true);
}

/* ================ the bucket heals itself, and only because of these ===

   043 repairs several hundred corrupt documents WITHOUT DELETING ANYTHING. It
   clears the paths off the rows, the next sync re-fetches every document, and
   each real file is written over the zero-byte object already at its path.

   That works only while two things stay true. Both are easy to break by
   accident and neither breaks loudly - the sync would keep reporting
   "N documents stored" while leaving the broken ones exactly where they are,
   or start piling up a second copy of every document under a new name.

   Supabase blocks DELETE on storage.objects, so if this ever stops being true
   the repair route is gone too. */
{
  const DB = fs.readFileSync(path.join(ROOT, 'tools/_lib/db.js'), 'utf8');
  const i = DB.indexOf('function wh24DocPath(t, g){');
  if (i < 0) throw new Error('wh24DocPath is not where it was');
  const ctx = {};
  new Function('exports', DB.slice(i, DB.indexOf('\n  }', i) + 4) +
               '\n;exports.p = wh24DocPath;')(ctx);
  const P = ctx.p;

  const t = { id: 25490, stream: 'Advantis', site: 'ZZ-AAA-001' };
  const g = { gi: '4900000001' };
  is('the path is built from the ticket, stream, site and document number',
     P(t, g), '25490/Advantis/ZZ-AAA-001__Advantis__4900000001.pdf');
  /* THE PROPERTY 043 RESTS ON. Called twice, with everything about the moment
     of calling different, it must give the same answer. */
  is('the same document is the same path every time', P(t, g), P({ ...t }, { ...g }));
  is('and the empty stream is a literal underscore, not a missing segment',
     P({ id: 7, stream: '', site: 'ZZ-BBB-002' }, { rep: '4932181244' }),
     '7/_/ZZ-BBB-002_____4932181244.pdf');
  is('a report number is used when there is no GI number',
     P({ id: 7, stream: 'ACE', site: 'ZZ-BBB-002' }, { rep: 'R-900' }).endsWith('R-900.pdf'), true);
  /* Two different documents on one ticket and stream, neither carrying a
     number, land on the SAME path and the second overwrites the first. This is
     the one hole in determinism, and it is deliberate: a document with no
     number is a document nothing can name. Asserted so it is a known
     property rather than a surprise. */
  is('two unnumbered documents on one stream collide, knowingly',
     P(t, {}), P(t, { gi: '', rep: '' }));

  /* Nothing from the moment of the call may reach the path. A date or a
     counter in here would make every re-sync write a NEW object beside the
     broken one instead of over it, and the bucket would grow for ever. */
  const body = DB.slice(i, DB.indexOf('\n  }', i));
  is('nothing time-based, random or sync-specific is in the path',
     /Date|Math\.random|uuid|crypto|synced_at|Now|now\(/.test(body), false);

  /* upsert:true is the other half. With it off, the second upload FAILS and
     every corrupt file stays corrupt. */
  const put = DB.slice(DB.indexOf('async function wh24PutDoc'));
  const call = put.slice(put.indexOf('.upload('), put.indexOf('.upload(') + 200);
  is('wh24PutDoc uploads with upsert:true, so a re-sync overwrites',
     /upsert:\s*true/.test(call), true);

}

/* ============ no SQL in here checks a JSON value by pattern-matching ===

   043 step 4 tested whether a document had been stored with

     gins::text like '%"path": "_%'

   In LIKE, `_` matches ANY single character - the closing quote included - so
   '{"path": ""}' matched it. The query counted every row that had a path KEY,
   empty or not, and could not return 0 while any document existed. It reported
   365 rows as stored immediately after they had all been cleared, and the
   UPDATE that did the clearing got the blame for an evening.

   Casting jsonb to text and pattern-matching it is the whole mistake. The
   structure is right there: walk the array and compare the value. So this
   refuses the cast, in every SQL file, rather than trusting the next pattern
   to be reasoned about correctly at eleven at night. */
{
  const dir = path.join(ROOT, 'supabase');
  const JSONB = ['gins', 'timeline', 'lines', 'doc'];
  const rx = col => new RegExp(col + '\\s*::\\s*text\\s+(not\\s+)?i?like', 'i');
  /* A LINT THAT MATCHES NOTHING PASSES FOREVER. Before trusting the empty
     result below, prove this pattern still catches the exact line it exists
     for - the one 043 step 4 actually shipped with. A green suite has already
     meant nothing once in this project. */
  is('the lint catches the line it was written for',
     rx('gins').test(`  count(*) filter (where gins::text like '%"path": "_%'`), true);
  is('and does not fire on the structural test that replaced it',
     rx('gins').test(`  where coalesce(e.g ->> 'path', '') <> ''`), false);

  const bad = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.sql'))) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((ln, i) => {
      /* comments are where this is explained, so they are allowed to show it */
      if (/^\s*--/.test(ln)) return;
      for (const col of JSONB)
        if (rx(col).test(ln)) bad.push(f + ':' + (i + 1) + ' ' + ln.trim());
    });
  }
  is('no SQL pattern-matches a jsonb column cast to text', bad, []);

  /* And the shape of the mistake itself, so the reason is not just prose:
     this is why the 365 was impossible to get to 0. */
  const likeMatch = (s, pat) => {
    const rx = new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '[\\s\\S]*').replace(/_/g, '[\\s\\S]') + '$');
    return rx.test(s);
  };
  is('an empty path matches the old test, which is why it never reached 0',
     likeMatch('{"path": "", "file": "a.pdf"}', '%"path": "_%'), true);
  is('and so does a real one, so the two were indistinguishable',
     likeMatch('{"path": "25490/_/a.pdf"}', '%"path": "_%'), true);
  is('the structural test tells them apart',
     [JSON.parse('{"path": ""}').path !== '', JSON.parse('{"path": "x"}').path !== ''],
     [false, true]);
}

/* ========= the download name has to reach Supabase, not the anchor ====

   <a download="…"> IS IGNORED CROSS-ORIGIN. The signed URL is on supabase.co
   and the page is not, so the browser threw the computed name away and saved
   every file under its storage path - CM5736____4931212559.pdf. The attribute
   was correct, the render was correct, and the test that asserted the
   attribute passed. The browser disagreed, and it is the only one that counts.

   The one place the name works is the signing call: Supabase answers it with
   Content-Disposition, which comes from the same origin as the bytes.

   So this runs the real function against a fake client and reads what it
   actually hands over - not whether the source looks right. */
(async () => {
  const DB = fs.readFileSync(path.join(ROOT, 'tools/_lib/db.js'), 'utf8');
  const j = DB.indexOf('async function wh24DocLink');
  if (j < 0) throw new Error('wh24DocLink is not where it was');
  const seen = [];
  const fakeClient = async () => ({ storage: { from: b => ({
    createSignedUrl: async (p, secs, opt) => {
      seen.push({ bucket: b, path: p, secs: secs, opt: opt });
      return { data: { signedUrl: 'https://project.supabase.co/sign?token=t' } };
    } }) } });
  const out = {};
  new Function('client', 'WH24B', 'exports',
    DB.slice(j, DB.indexOf('\n  }', j) + 4) + ';exports.link = wh24DocLink;'
  )(fakeClient, 'wh24-docs', out);

  const url = await out.link('25490/Advantis/a.pdf', 300, '1718878 2026-04-29.pdf');
  is('a signed URL comes back', typeof url === 'string' && url.length > 0, true);
  is('and Supabase was asked for Content-Disposition with that exact name',
     seen[0].opt, { download: '1718878 2026-04-29.pdf' });
  is('against the right bucket, path and expiry',
     [seen[0].bucket, seen[0].path, seen[0].secs],
     ['wh24-docs', '25490/Advantis/a.pdf', 300]);
  /* A missing name must not send download:'' - that would ask for an empty
     filename rather than leaving the object its own. */
  await out.link('x.pdf', 300, '');
  is('no name sends no download option at all', seen[1].opt, undefined);
  await out.link('x.pdf', 300);
  is('and an omitted name likewise', seen[2].opt, undefined);
  /* A name is stringified, so a number or an object cannot reach the header
     as "[object Object]" by accident. */
  await out.link('x.pdf', 300, 1718878);
  is('a non-string name is stringified', seen[3].opt, { download: '1718878' });

  /* ---- the soft delete's three load-bearing clauses -----------------

     These are read out of db.js as source, which is normally a poor way to
     check anything - but what is being asserted here is the PRESENCE of a
     clause in a query, and that is a property of the source. The behaviour
     these clauses produce is tested as pure functions in
     tools/whattodo/todo.test.js; this is the tripwire that catches someone
     deleting the clause itself.

     Each one, if it went missing, loses data silently:
       1. no deleted_at filter on the read  -> removed tasks come back
       2. a real delete in removeTodo       -> the undo is a lie
       3. no done=false on the purge        -> the sweep eats the archive */
  {
    const src = fs.readFileSync(path.join(ROOT, 'tools/_lib/db.js'), 'utf8');
    const fn = name => {
      const i = src.indexOf('function ' + name + '(');
      if (i < 0) return '';
      /* to the start of the next top-level function declaration */
      const j = src.indexOf('\n  async function ', i + 10);
      const k = src.indexOf('\n  function ', i + 10);
      const end = Math.min(j < 0 ? src.length : j, k < 0 ? src.length : k);
      return src.slice(i, end);
    };

    is('listTodos exists', fn('listTodos').length > 0, true);
    is('THE READ FILTERS OUT REMOVED TASKS',
       /\.is\(\s*'deleted_at'\s*,\s*null\s*\)/.test(fn('listTodos')), true);

    const rm = fn('removeTodo');
    is('removeTodo exists', rm.length > 0, true);
    is('REMOVING IS AN UPDATE, NOT A DELETE',
       /\.update\(/.test(rm) && !/\.delete\(/.test(rm), true);
    is('and it stamps deleted_at',   /deleted_at:\s*new Date\(\)/.test(rm), true);
    is('restoreTodo clears it',      /deleted_at:\s*null/.test(fn('restoreTodo')), true);

    const pg = fn('purgeRemoved');
    is('purgeRemoved exists', pg.length > 0, true);
    is('THE SWEEP CAN NEVER TOUCH COMPLETED WORK',
       /\.eq\(\s*'done'\s*,\s*false\s*\)/.test(pg), true);
    is('it only takes rows that were removed',
       /\.not\(\s*'deleted_at'\s*,\s*'is'\s*,\s*null\s*\)/.test(pg), true);
    is('and only ones past the cutoff',
       /\.lt\(\s*'deleted_at'\s*,\s*cutoff\s*\)/.test(pg), true);

    /* migration 045 has to actually create what all of the above reads */
    const m045 = fs.readFileSync(path.join(ROOT, 'supabase/045_todos_soft_delete.sql'), 'utf8');
    is('045 adds the column',
       /alter table todos add column if not exists deleted_at/i.test(m045), true);
    is('045 is safe to run twice', /if not exists/i.test(m045), true);
  }

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
