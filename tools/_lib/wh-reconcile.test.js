/* wh-reconcile.test.js - editing a whole note, built on what exists.

     node tools/_lib/wh-reconcile.test.js

   Editing a note meant the header through wh_update_note and then each
   row through its own pencil, and there was no way to ADD a row at all:
   none of the eleven wh_ functions inserts a line into a note that
   already exists.

   wh_reconcile settles the difference between a note and the form, and
   the thing worth guarding is HOW. Every job it does has a function
   that already does it, and the one that matters most is
   wh_delete_line: it gives a cut back to the end it came off, two
   updates and a refusal when a later cut is in the way. A second copy
   of that arithmetic is the failure this file exists to prevent.

   Adding a line had no home, so 069 gave it one - the per-item bodies
   of wh_inbound and wh_outbound moved into helpers both the creating
   form and the edit now call. One implementation, two callers. */

const fs = require('fs');
const path = require('path');

const SQLDIR = path.join(__dirname, '..', '..', 'supabase');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

function lastDef(fn) {
  const files = fs.readdirSync(SQLDIR).filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  let body = null, from = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SQLDIR, f), 'utf8').replace(/\r/g, '');
    const m = sql.match(new RegExp('create or replace function ' + fn + '\\([^)]*\\)[\\s\\S]*?\\$\\$;', 'i'));
    if (m) { body = m[0]; from = f; }
  }
  return { body, from };
}
const code = sql => (sql || '').replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const R = lastDef('wh_reconcile');
console.log('--- editing a whole note ---');
console.log('  wh_reconcile defined in ' + R.from + '\n');
is('wh_reconcile exists', !!R.body, true);
if (!R.body) { console.log('\n' + pass + ' passed, 1 failed\n'); process.exit(1); }
const B = code(R.body);

console.log('--- every job goes to the function that owns it ---');
is('the header goes through wh_update_note', /perform wh_update_note\(/.test(B), true);
is('changes go through wh_update_item', /perform wh_update_item\(/.test(B), true);
is('removals go through wh_delete_line', /perform wh_delete_line\(/.test(B), true);
is('new rows go through the add helpers',
   /perform wh_add_outbound_line\(/.test(B) && /perform wh_add_inbound_line\(/.test(B), true);

/* THE ONE THAT MATTERS. wh_delete_line restores a drum's range - two
   updates, one per end, with a refusal if a later cut is in the way.
   Writing that again here is how the two copies start to disagree. */
console.log('\n--- and the drum arithmetic exists once ---');
is('wh_reconcile never moves a drum reading itself',
   /update wh_items set[^;]*drum_(upper|lower)/i.test(B), false);
is('nor reads the original range to decide anything',
   /orig_(upper|lower)/i.test(B), false);
is('nor writes a line row for a cut', /insert into wh_lines/i.test(B), false);
{
  const dl = code(lastDef('wh_delete_line').body);
  is('wh_delete_line is still the one that does it',
     (dl.match(/update wh_items set drum_(upper|lower)/g) || []).length, 2);
  is('and still refuses when a later cut is in the way',
     /Undo the later cut first/.test(dl), true);
}

console.log('\n--- one transaction, and nothing relaxed ---');
is('no exception is caught, so it lands whole or not at all',
   /\bexception\s+when\b/i.test(B), false);
is('an empty note is refused rather than emptied',
   /A note has to keep at least one line/.test(B), true);
is('a return cannot be edited as if it were its own note',
   /A return is edited from the note it reverses/.test(B), true);
is('an outbound line\'s issued quantity is not rewritten here',
   /update wh_lines set qty/i.test(B), false);
is('the note is locked before anything is settled', /for update/.test(B), true);
is('it checks the same permission the rest of the tool does',
   /may_read\('tool:warehouse'\)/.test(B), true);

console.log('\n--- a new row joins the note, not today ---');
is('the note\'s own date is passed to the helper', /'date', n\.note_date/.test(B), true);
is('and the note\'s kind, so an SRN stays an SRN', /'kind', n\.kind/.test(B), true);

console.log('\n--- one implementation of adding a line, two callers ---');
{
  const ai = lastDef('wh_add_inbound_line'), ao = lastDef('wh_add_outbound_line');
  is('both helpers exist', [!!ai.body, !!ao.body], [true, true]);
  const inb = code(lastDef('wh_inbound').body), out = code(lastDef('wh_outbound').body);
  is('wh_inbound delegates to its helper', /perform wh_add_inbound_line\(/.test(inb), true);
  is('wh_outbound delegates to its helper', /perform wh_add_outbound_line\(/.test(out), true);
  is('and no longer inserts an item itself', /insert into wh_items/i.test(inb), false);
  is('nor does the outbound one', /insert into wh_items/i.test(out), false);
  /* the cut arithmetic went with it, and there is one of it */
  const all = fs.readdirSync(SQLDIR).filter(f => /^\d+_.*\.sql$/.test(f));
  is('the helper carries the cut, and the guard 068 added',
     /drum_upper = drum_upper - len/.test(code(ao.body))
     && /went out whole on/.test(code(ao.body)), true);
  is('the helper carries the SRN side door too',
     /wh_assert_returnable/.test(code(ai.body)), true);
  is('both helpers are kept off the public API',
     /revoke all on function wh_add_inbound_line[^\n]*from public, anon, authenticated/
       .test(fs.readFileSync(path.join(SQLDIR, R.from), 'utf8')), true);
}

/* ---- prove it by breaking ---- */
console.log('\n  --- against a reconcile that did it the other way ---');
{
  const hand = `begin
    update wh_items set drum_upper = drum_upper + rec.qty where id = rec.iid;
    delete from wh_lines where id = lid;
  end`;
  is('a hand-written drum restore is caught',
     /update wh_items set[^;]*drum_(upper|lower)/i.test(hand), true);
  is('and the real one is not', /update wh_items set[^;]*drum_(upper|lower)/i.test(B), false);
  const swallow = `begin perform wh_delete_line(lid); exception when others then null; end`;
  is('a swallowed exception is caught', /\bexception\s+when\b/i.test(swallow), true);
  is('and the real one has none', /\bexception\s+when\b/i.test(B), false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
