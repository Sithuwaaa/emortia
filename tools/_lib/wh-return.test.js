/* wh-return.test.js - the return path's invariants, as SQL facts.

     node tools/_lib/wh-return.test.js

   WHY THIS EXISTS. wh_inbound is rewritten by more than one migration -
   048 wrote it, 055 re-emits it to close the side door, and the parked
   053 on wip/warehouse-real-world rewrites it again for local purchases
   and cable rolls. Whichever definition is LAST is the one the database
   runs, so a later migration can reopen a door an earlier one closed and
   nothing would say a word. That is not hypothetical: it is the shape of
   every regression this tool has had.

   So the check is on the LAST definition of each function in migration
   order, which is what Postgres will actually be running, not on whether
   some migration somewhere contains the right text. */

const fs = require('fs');
const path = require('path');

const SUPA = path.join(__dirname, '..', '..', 'supabase');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* the last definition of every wh_ function, in migration order */
function lastDefs() {
  const files = fs.readdirSync(SUPA).filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const out = new Map();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SUPA, f), 'utf8');
    const rx = /create\s+or\s+replace\s+function\s+(wh_[a-z_]+)\s*\(([^)]*)\)([\s\S]*?)\$\$;/gi;
    let m;
    while ((m = rx.exec(sql))) out.set(m[1].toLowerCase(), { body: m[3], from: f });
  }
  return out;
}

const D = lastDefs();
/* THE PER-ITEM BODY MOVED AND THE INVARIANTS DID NOT. 069 lifted the
   item loops of wh_inbound and wh_outbound into wh_add_inbound_line
   and wh_add_outbound_line, so that editing a note adds a row through
   the same code that creating one does. Everything below asks the
   same questions of the same statements; only their address changed.
   The fallback keeps this readable against a database where 069 has
   not been applied yet - and the parent is still where the note-level
   checks live, so this looks at both. */
const itemBody = (parent, helper) => {
  const h = D.get(helper), pa = D.get(parent);
  return { body: (h ? h.body : '') + '\n' + (pa ? pa.body : ''),
           from: h ? h.from : (pa ? pa.from : '(none)') };
};
D.set('wh_inbound',  itemBody('wh_inbound',  'wh_add_inbound_line'));
D.set('wh_outbound', itemBody('wh_outbound', 'wh_add_outbound_line'));

console.log('--- the return path, as the database will actually run it ---');
for (const n of ['wh_inbound', 'wh_return', 'wh_delete_note', 'wh_assert_returnable'])
  console.log('  ' + n + '  <- ' + (D.has(n) ? D.get(n).from : 'NOT DEFINED ANYWHERE'));
console.log('');

/* a scan that found nothing passes everything */
is('the functions this checks are all defined',
   ['wh_inbound', 'wh_return', 'wh_delete_note', 'wh_assert_returnable'].filter(n => !D.has(n)), []);

/* ---- the side door stays shut ---------------------------------------- */
is('the last wh_inbound still refuses an SRN for something that is out',
   /wh_assert_returnable/.test(D.get('wh_inbound').body), true);
is('and it only does that for SRN, so a delivery is not blocked',
   /k = 'SRN' then perform wh_assert_returnable/.test(D.get('wh_inbound').body), true);
is('the check itself looks at status out and names the note',
   /status = 'out'/.test(D.get('wh_assert_returnable').body)
   && /out_note/.test(D.get('wh_assert_returnable').body), true);
is('a dummy serial is not treated as a real one',
   /DMY-/.test(D.get('wh_assert_returnable').body), true);

/* ---- the three cases are all present in wh_return --------------------- */
const R = D.get('wh_return').body;
is('a whole return flips the row instead of inserting a twin',
   /update wh_items set status='in', out_note=null/.test(R), true);
is('a partial return splits the row', /set qty = qty - want/.test(R), true);
is('a serialised item is refused a partial return', /comes back whole or not at all/.test(R), true);
is('a drum cut comes back as a loose piece, not a restored drum',
   /cut_from is not null/.test(R) && /'return'/.test(R), true);
/* THE INVARIANT IS ABOUT THE COLUMN, NOT THE WORD. This read
   /drum_name/ over the whole branch, which was right until 068 began
   passing rec.drum_name into a DIFFERENT column - from_drum - and the
   substring fired on the value expression. The piece still must not
   become a drum; what says so is the insert's column list, so that is
   what is read now. Tightened rather than dropped: writing drum_name
   on the returned row would still fail this. */
{
  const branch = R.split('cut_from is not null')[1].split('elsif')[0] || '';
  const cols = (branch.match(/insert into wh_items\(([^)]*)\)/) || ['', ''])[1]
    .split(',').map(c => c.trim());
  is('the returned piece is inserted with a column list', cols.length > 5, true);
  is('and that path never makes it a drum', cols.includes('drum_name'), false);
  is('nor gives it readings', cols.filter(c => /^drum_(lower|upper)$/.test(c)), []);
  is('it records which drum it came off instead', cols.includes('from_drum'), true);
}
is('how much is still out is computed from returns_line, not stored',
   /returns_line/.test(R) && /coalesce\(sum\(r\.qty\),0\)/.test(R), true);

/* ---- undo ------------------------------------------------------------- */
const N = D.get('wh_delete_note').body;
is('deleting a note knows about RTN', /kind = 'RTN'/.test(N), true);
is('an outbound note with a return against it is refused',
   /has a return against it/.test(N), true);
is('undoing a return can send a flipped row back out',
   /status='out', out_note=n\.reverses/.test(N), true);
is('undoing a split gives the quantity back to the row it came off',
   /set qty = qty \+ rec\.qty where id = rec\.orig_item/.test(N), true);

/* ---- 057: the pointer is retired, and a cut has an end ---------------- */
{
  /* drum_cur is dropped by 057, so a function still reading it would fail
     at runtime against a column that is not there - and only when somebody
     cut a drum, which is exactly the sort of bug that waits. */
  /* COMMENTS ARE NOT READERS. The first version of this matched the bare
     word and named wh_outbound and wh_update_item, whose only mention of
     drum_cur is a comment saying it was retired. A guard that cannot tell
     code from prose cries wolf, and a guard that cries wolf gets ignored
     on the day it is right - so it strips comments first. */
  const code = sql => sql.replace(/\/\*[\s\S]*?\*\//g, ' ')
                         .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  const still = [...D.entries()].filter(([, d]) => /\bdrum_cur\b/.test(code(d.body))).map(([n]) => n);
  is('no live function still reads the retired drum_cur', still, []);
  is('the migration that retires it really does drop it',
     /alter table wh_items drop column if exists drum_cur/.test(
       fs.readFileSync(path.join(SUPA, '057_warehouse_cable_either_end.sql'), 'utf8')), true);
}
{
  const O = D.get('wh_outbound').body;
  is('a cut reads which end it came off', /cut_end/.test(O), true);
  is('what is left is the span, not a pointer', /drum_upper - L\.drum_lower/.test(O), true);
  is('cutting the low end raises the lower mark', /set drum_lower = drum_lower \+ len/.test(O), true);
  is('cutting the high end drops the upper mark', /set drum_upper = drum_upper - len/.test(O), true);
}
for (const fn of ['wh_delete_note', 'wh_delete_line']) {
  const B = D.get(fn).body;
  is(fn + ' gives the metres back to the end they came off',
     /coalesce\(rec\.cut_end,'upper'\) = 'upper'/.test(B), true);
  is(fn + ' will not push a drum past what came in',
     /orig_upper/.test(B) && /orig_lower/.test(B), true);
}

/* ---- prove it by breaking --------------------------------------------- */
console.log('\n  --- and the same checks against versions that are wrong ---');
{
  /* 048's wh_inbound, which is the one without the guard */
  const o48 = fs.readFileSync(path.join(SUPA, '048_tooway_warehouse.sql'), 'utf8');
  const fn = o48.match(/create or replace function wh_inbound[\s\S]*?\r?\nend \$\$;/)[0];
  is('048\'s own wh_inbound is correctly seen as NOT having the guard',
     /wh_assert_returnable/.test(fn), false);
}
{
  /* a later migration that re-emitted wh_inbound and dropped the call */
  const broken = D.get('wh_inbound').body.replace(/.*wh_assert_returnable.*/g, '');
  is('a rewrite that drops the call is caught', /wh_assert_returnable/.test(broken), false);
}
{
  /* and one that kept it only for GRN */
  const wrong = "if k = 'GRN' then perform wh_assert_returnable(nullif(it->>'sn','')); end if;";
  is('a rewrite that guards the wrong kind is caught',
     /k = 'SRN' then perform wh_assert_returnable/.test(wrong), false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
