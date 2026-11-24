/* wh-drum-balance.test.js - the arithmetic, and the branch that broke it.

     node tools/_lib/wh-drum-balance.test.js

   A drum's readings fall when a length is CUT off it. They do not fall
   when the whole drum is issued - that moves status and leaves the
   numbers alone. So "what the drum reads" and "what the drum owes" are
   kept in two places, and nothing compared them.

   wh_delete_note and wh_delete_line both restored metres to a drum by
   asking "is this item a drum" rather than "was this line a cut". A
   whole-drum issue went through the restore, which added metres to a
   range that had never been reduced and left status='out' behind. One
   drum is in that state: it reads its full original span while an
   outbound note still issues 140 m of it.

   THE INVARIANT IS IN TWO PARTS AND I WAS GIVEN IT IN ONE. The
   one-line version - orig_span - outstanding = live_span - flags every
   healthy whole-drum issue, because such a line is outstanding for the
   drum's entire length while the readings have not moved. The second
   case below is what caught it. See wh-drum-balance.js for the split. */

const fs = require('fs');
const path = require('path');
const B = require('./wh-drum-balance.js');

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

const row = o => Object.assign(
  { orig_lower: 65, orig_upper: 565, drum_lower: 65, drum_upper: 565,
    cut_out: 0, whole_out: 0, whole_lines: 0, status: 'in' }, o);

console.log('--- a drum on the shelf ---');
is('untouched and in stock is fine', B.check(row({})).ok, true);
is('140 cut off it and still out reads 360',
   B.check(row({ drum_upper: 425, cut_out: 140 })).ok, true);
is('but reading full with 140 cut out is wrong',
   B.check(row({ cut_out: 140 })).faults,
   ['reads 500 but came in at 500 with 140 m cut and still out']);
is('and a drum in stock cannot have a whole line against it',
   B.check(row({ whole_out: 500, whole_lines: 1 })).faults,
   ['is in stock but 500 m of it is out whole']);

console.log('\n--- a drum standing on a site ---');
/* THE CASE THAT CORRECTED THE RULE. Nothing was ever cut off this
   drum, all of it went out whole, and the readings are untouched -
   which is the correct state for it. The one-line invariant reads
   500 - 500 = 0 against a live span of 500 and calls it -500. */
is('issued whole, uncut, is fine',
   B.check(row({ status: 'out', whole_out: 500, whole_lines: 1 })).ok, true);
is('cut down and then issued whole is fine too',
   B.check(row({ status: 'out', drum_upper: 425, cut_out: 140,
                 whole_out: 360, whole_lines: 1 })).ok, true);

/* THE STATE ON THE LIVE DATABASE. Out on a note that issues 140, and
   reading its full 500 because deletes restored metres onto a range
   that had never been reduced. */
{
  const c = B.check(row({ status: 'out', whole_out: 140, whole_lines: 1 }));
  is('the drum in the report is caught', c.ok, false);
  is('and the fault names both numbers', c.faults,
     ['is out whole for 140 m but reads 500 m']);
  is('rule A says nothing about it, which is why one line missed it',
     c.live === c.orig - c.cut, true);
}
is('two whole lines at once is caught as well',
   B.check(row({ status: 'out', whole_out: 640, whole_lines: 2 })).faults,
   ['is out on a note but has 2 whole-drum lines outstanding']);

console.log('\n--- the query asks the right question ---');
is('cut lines and whole lines are counted apart',
   /\(l\.cut_from is not null\) as is_cut/.test(B.SQL), true);
is('outstanding is netted against what came back',
   /returns_line = l\.id/.test(B.SQL), true);
is('only outbound lines count', /n\.kind = 'OBN'/.test(B.SQL), true);
is('and only rows that are drums with readings',
   /drum_name is not null/.test(B.SQL) && /orig_upper is not null/.test(B.SQL), true);
is('the number of whole lines is reported, not just their sum',
   /as whole_lines/.test(B.SQL), true);

console.log('\n--- and both delete paths ask "was this line a cut" ---');
for (const fn of ['wh_delete_note', 'wh_delete_line']) {
  const d = lastDef(fn), c = code(d.body);
  is(fn + ' was found (' + d.from + ')', !!d.body, true);
  is(fn + ' restores only a line that cut something',
     /drum_name is not null and rec\.cut_from is not null/.test(c), true);
  is(fn + ' checks what other notes still owe', /into owed/.test(c), true);
  is(fn + ' and refuses rather than going over',
     /is still out on other notes/.test(c), true);
  is(fn + ' still clears the status for a whole drum',
     /set status = 'in', out_note = null, out_date = null/.test(c)
     || /set status='in', out_note=null, out_date=null/.test(c), true);
}

/* ---- prove it by breaking ---- */
console.log('\n  --- the branch as it was ---');
{
  const files = fs.readdirSync(SQLDIR).filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).filter(f => parseInt(f, 10) < 70);
  let before = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SQLDIR, f), 'utf8').replace(/\r/g, '');
    const m = sql.match(/create or replace function wh_delete_note\([^)]*\)[\s\S]*?\$\$;/i);
    if (m) before = code(m[0]);
  }
  is('it caught every drum, cut or not',
     /elsif rec\.drum_name is not null then/.test(before), true);
  is('so a whole-drum line never reached the status branch',
     /rec\.cut_from is not null/.test(before), false);
  is('and the only guard compared against what came in',
     /came in at %/.test(before) && !/still out on other notes/.test(before), true);
}
{
  /* the one-line invariant, applied to a healthy drum */
  const oneLine = r => (r.orig_upper - r.orig_lower) - r.owed - (r.drum_upper - r.drum_lower);
  is('the version I was given calls a healthy whole-drum issue -500',
     oneLine({ orig_lower: 65, orig_upper: 565, drum_lower: 65, drum_upper: 565, owed: 500 }), -500);
  is('and the split calls the same drum fine',
     B.check(row({ status: 'out', whole_out: 500, whole_lines: 1 })).ok, true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
