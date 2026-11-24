/* migrations-replay.test.js - the file order is not a run order.

     node tools/_lib/migrations-replay.test.js

   I was asked which migrations needed running, could not read the
   database, derived an order from the file names and said so. Saying so
   was not enough: the order was printed as "migrations to run", and
   three of those files cannot run at all against the schema the rest
   leave behind. 056 seeds wh_vendors and 059 drops it. 057 reads
   drum_cur and 057 drops it. 059 selects from wh_projects, wh_parties
   and wh_sources and drops all three.

   None of that is bad luck. A migration that removes what an earlier
   one wrote to makes the earlier one unrepeatable by construction, and
   a list taken from file order cannot see it. This is the check.

   THE LIST IS DECLARED, not asserted empty, because eleven real files
   are in it and they are all correct. The point is that it cannot grow
   without someone looking: write a migration that drops a column an
   older one still writes to, and this fails and names both. */

const path = require('path');
const R = require('./migrations-replay.js');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* file -> what it can no longer find. Earliest dropper per name. */
const DECLARED = {
  '048_tooway_warehouse.sql':           ['wh_items.drum_cur', 'wh_projects', 'wh_parties'],
  '049_warehouse_note_fields.sql':      ['wh_items.drum_cur', 'wh_projects', 'wh_parties'],
  '050_warehouse_delete_edit.sql':      ['wh_items.drum_cur'],
  '052_warehouse_line_edit.sql':        ['wh_items.drum_cur'],
  '053_warehouse_real_world.sql':       ['wh_sources'],
  '054_warehouse_item_edit_widen.sql':  ['wh_items.drum_cur'],
  '055_warehouse_return.sql':           ['wh_items.drum_cur'],
  '056_warehouse_vendor_redep.sql':     ['wh_items.drum_cur', 'wh_vendors'],
  '057_warehouse_cable_either_end.sql': ['wh_items.drum_cur', 'wh_parties'],
  '058_warehouse_whole_drum.sql':       ['wh_parties'],
  '059_warehouse_one_lookup.sql':       ['wh_projects', 'wh_parties', 'wh_sources', 'wh_vendors']
};

const c = R.conflicts();
const got = {};
for (const x of c) { (got[x.file] = got[x.file] || []).push(x.needs); }

console.log('--- which migrations can no longer run ---');
console.log('  ' + R.files().length + ' files, ' + Object.keys(got).length + ' of them unrepeatable\n');

is('the scan read the folder', R.files().length > 50, true);
is('the unrepeatable files are the declared ones',
   Object.keys(got).sort(), Object.keys(DECLARED).sort());
for (const f of Object.keys(DECLARED).sort())
  is(f.slice(0, 3) + ' needs what it is declared to need', (got[f] || []).sort(), DECLARED[f].slice().sort());

console.log('\n--- the three the report got wrong ---');
is('056 is caught on wh_vendors',
   c.some(x => /^056/.test(x.file) && x.needs === 'wh_vendors' && /^059/.test(x.droppedBy)), true);
is('057 is caught on drum_cur',
   c.some(x => /^057/.test(x.file) && x.needs === 'wh_items.drum_cur'), true);
for (const t of ['wh_projects', 'wh_parties', 'wh_sources'])
  is('059 is caught on ' + t, c.some(x => /^059/.test(x.file) && x.needs === t), true);

console.log('\n--- and a drop that puts the thing straight back is not one ---');
{
  /* 002 drops sites.site_name and adds it again as a generated column
     on the next line; 015 does the same to feature_locks.unlocked.
     Both were flagged by the first version of this and both are fine. */
  is('002 is not in the list', !!got['002_site_access_schema.sql'], false);
  is('015 is not in the list', !!got['015_roles_and_tiers.sql'], false);
  is('a drop followed by an add is healed',
     R.healedBy('alter table t drop column if exists c;\nalter table t add column c text;',
                { kind: 'column', table: 't', col: 'c' }), true);
  is('a drop with nothing after it is not',
     R.healedBy('alter table t drop column c;', { kind: 'column', table: 't', col: 'c' }), false);
  is('and an add BEFORE the drop does not count either',
     R.healedBy('alter table t add column c text;\nalter table t drop column c;',
                { kind: 'column', table: 't', col: 'c' }), false);
}

console.log('\n--- prose is not a reference ---');
{
  /* these files explain themselves at length, and most of them name the
     tables they replaced. A header saying "wh_vendors is gone" must not
     read as a file that still writes to it. */
  is('a -- comment naming a dropped table is ignored',
     R.strip('-- wh_vendors is gone\nselect 1;').includes('wh_vendors'), false);
  is('a /* */ comment too',
     R.strip('/* drops wh_parties */\nselect 1;').includes('wh_parties'), false);
  is('but the code on the same line survives',
     R.strip('select 1; -- wh_vendors').trim(), 'select 1;');
  /* THE SAME LINE WITH WINDOWS ENDINGS. "." does not match \r in JS, so
     --.*$ cannot match a comment that ends in one, and the comment
     survives. The repository is LF and a fresh Windows clone is CRLF -
     which is how CI checks it out - so this file read the same folder
     two different ways until strip() dropped the \r first. */
  is('a CRLF comment is stripped too',
     R.strip('-- wh_vendors is gone\r\nselect 1;\r\n').includes('wh_vendors'), false);
  is('and a CRLF file gives the same answer as an LF one',
     R.strip('insert into wh_vendors(name) values (x);\r\n-- wh_parties is gone\r\n'),
     R.strip('insert into wh_vendors(name) values (x);\n-- wh_parties is gone\n'));
  is('which is what CI was reading differently',
     R.uses(R.strip('-- wh_parties was replaced by wh_lookups\r\nselect 1;\r\n'),
            { kind: 'table', table: 'wh_parties' }), false);
  is('a real insert is still seen',
     R.uses('insert into wh_vendors(name) values (x);', { kind: 'table', table: 'wh_vendors' }), true);
  is('and the drop statement itself is not a use',
     R.uses('drop table if exists wh_vendors;', { kind: 'table', table: 'wh_vendors' }), false);
}

console.log('\n--- prove it by breaking ---');
{
  const dropped = R.dropsIn(`alter table wh_items drop column drum_cur;
    drop table if exists wh_vendors;
    alter table wh_notes drop column if exists old_ref;`);
  is('every drop is picked up', dropped.length, 3);
  is('with its table and column',
     dropped.map(d => d.kind + ':' + d.table + (d.col ? '.' + d.col : '')),
     ['table:wh_vendors', 'column:wh_items.drum_cur', 'column:wh_notes.old_ref']);
  is('a column needs its table named too, not just the word',
     R.uses('select orig_upper from wh_items;', { kind: 'column', table: 'wh_items', col: 'drum_cur' }), false);
  is('and is caught when both are there',
     R.uses('select drum_cur from wh_items;', { kind: 'column', table: 'wh_items', col: 'drum_cur' }), true);
}

console.log('\n--- no function body lost a dollar quote ---');
{
  /* A FILE CAN BE UNRUNNABLE FOR A DULLER REASON THAN A MISSING TABLE.
     067 was first written by appending a second function with
     String.replace, and $$ in a REPLACEMENT string is an escape for a
     literal $ - so "as $$" became "as $" and "end $$;" became "end $;".
     The file held one dollar-quoted body where it should have held two
     and Postgres would have rejected it outright. Nothing noticed until
     the payload guard reported a field as never read, because the
     second function was no longer parseable AS a function.

     COUNTING MARKERS DOES NOT CATCH IT - I tried that first and it was
     wrong twice over. These files also use plain "create function",
     bare DO blocks and triggers, so two-per-function is not the rule;
     and the corruption leaves an EVEN number of $$ anyway, because the
     damaged pair stops being $$ at all. What is diagnostic is the
     shape left behind: a dollar quote written with one $. That never
     occurs on purpose. */
  const fs2 = require('fs');
  const path2 = require('path');
  const dir = path2.join(__dirname, '..', '..', 'supabase');
  const OPEN = /\bas\s*\$(?!\$)/i;          /* as $  - should be as $$ */
  const CLOSE = /\bend\s*\$(?!\$)\s*;/i;    /* end $; - should be end $$; */
  const hurt = [];
  for (const f of R.files()) {
    const raw = fs2.readFileSync(path2.join(dir, f.file), 'utf8');
    if (OPEN.test(raw)) hurt.push(f.file + ': opens a body with a single $');
    if (CLOSE.test(raw)) hurt.push(f.file + ': closes a body with a single $');
  }
  is('no migration dollar-quotes a body with one $', hurt, []);

  /* and the shape, so this is not taking my word for it */
  const broken = 'create or replace function f() returns int\nlanguage plpgsql as $\nbegin return 1; end $;';
  is('the corruption is caught', OPEN.test(broken) && CLOSE.test(broken), true);
  const whole = 'create or replace function f() returns int\nlanguage plpgsql as $' + '$\nbegin return 1; end $' + '$;';
  is('a whole body is not', OPEN.test(whole) || CLOSE.test(whole), false);
  is('counting markers would NOT have caught it - both are even',
     [(broken.match(/\$\$/g) || []).length, 2], [0, 2]);
  is('String.replace is what eats it',
     'x'.replace('x', 'as $' + '$'), 'as $');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
