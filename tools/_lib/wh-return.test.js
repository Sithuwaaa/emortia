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
is('and that path never writes a drum name onto the new piece',
   /drum_name/.test(R.split('cut_from is not null')[1].split('elsif')[0] || ''), false);
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
