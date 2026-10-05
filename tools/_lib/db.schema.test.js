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

/* ---- the fallback column list must BE the pre-042 schema ---- */
{
  const DB = fs.readFileSync(path.join(ROOT, 'tools/_lib/db.js'), 'utf8');
  const m = /const WH24T_COLS = \[([\s\S]*?)\];/.exec(DB);
  is('wh24Publish has a fallback column list', !!m, true);
  const listed = m[1].match(/'([a-z_0-9]+)'/g).map(s => s.replace(/'/g, ''));
  /* every one of them must be a real column, or the fallback fails too */
  is('every fallback column exists in the schema', listed.filter(k => !cols.has(k)), []);
  /* and it must not quietly include a 042 column, or the fallback is not a
     fallback - it would fail on exactly the database it exists to serve */
  const sql042 = fs.existsSync(path.join(ROOT, 'supabase/042_wh24_facts.sql'))
    ? fs.readFileSync(path.join(ROOT, 'supabase/042_wh24_facts.sql'), 'utf8') : '';
  const added = [];
  let mm, re2 = /add column if not exists ([a-z_0-9]+)/g;
  while ((mm = re2.exec(sql042))) added.push(mm[1]);
  is('and none of 042\'s new columns are in it', listed.filter(k => added.indexOf(k) >= 0), []);
  /* Compared against the schema WITHOUT 042, not against itself. With 042 in
     the folder `missing` is empty, so comparing to it would have been a
     tautology that passes whatever 042 contains. */
  const before = new Set([...cols].filter(k => added.indexOf(k) < 0));
  const needed = keys.filter(k => !before.has(k)).sort();
  is('042 adds exactly the columns the row needs and no others',
     added.slice().sort(), needed);
  is('and the fallback list IS the pre-042 schema',
     listed.slice().sort(), [...before].sort());
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
