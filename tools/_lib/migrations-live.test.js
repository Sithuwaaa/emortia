/* migrations-live.test.js - the marker logic, without needing the
   database.

     node tools/_lib/migrations-live.test.js

   The --live check itself needs credentials and cannot run in CI. The
   part that CAN be checked anywhere is the part that was wrong first
   time: how a marker is chosen. If a marker does not distinguish the
   newest version of a function from the one before it, --live will
   report a stale database as up to date - confidently wrong, in the one
   direction the whole thing exists to prevent. */

const fs = require('fs');
const path = require('path');
const { markers, lines } = require('./migrations-live.js');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

const SQLDIR = path.join(__dirname, '..', '..', 'supabase');
const M = markers();
const by = Object.fromEntries(M.map(m => [m.fn, m]));

console.log('--- how a marker is chosen ---');
console.log('  functions seen: ' + M.length + ', with a usable marker: '
  + M.filter(m => m.marker).length + '\n');

/* a scan that found nothing passes everything */
is('the scan found the functions', M.length >= 40, true);
is('it found the ones rewritten more than once',
   M.filter(m => m.versions > 1).length >= 5, true);

/* ---- the property that matters ---- */
{
  /* Every marker must be absent from EVERY earlier version of its own
     function. This is the assertion that the first version of the code
     failed: it picked declare lines, which are usually identical to the
     version before. */
  const files = fs.readdirSync(SQLDIR).filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const defs = new Map();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SQLDIR, f), 'utf8');
    const rx = /create\s+or\s+replace\s+function\s+([a-z_][a-z0-9_]*)\s*\([^)]*\)([\s\S]*?)\$\$;/gi;
    let m;
    while ((m = rx.exec(sql))) {
      const k = m[1].toLowerCase();
      if (!defs.has(k)) defs.set(k, []);
      defs.get(k).push(m[2]);
    }
  }
  const leaky = [];
  for (const m of M) {
    if (!m.marker) continue;
    const v = defs.get(m.fn);
    for (let i = 0; i < v.length - 1; i++)
      if (lines(v[i]).includes(m.marker)) { leaky.push(m.fn); break; }
  }
  is('no marker also appears in an older version of its own function', leaky, []);
}

is('a marker is never the function header, which every function shares',
   M.filter(m => m.marker && /^language\s+plpgsql/i.test(m.marker)).map(m => m.fn), []);
is('a marker is never a comment',
   M.filter(m => m.marker && m.marker.startsWith('--')).map(m => m.fn), []);
is('a function with no usable marker says why, rather than passing quietly',
   M.filter(m => !m.marker && !m.why).map(m => m.fn), []);

/* ---- the warehouse ones, by name, because they are what this shipped for ---- */
is('wh_inbound is marked by the remarks insert 060 added',
   /insert into wh_lines\(note_id,item_id,line_no,qty,remarks\)/.test(by.wh_inbound.marker), true);
is('wh_outbound is marked by the one-lookup insert 059 added',
   /wh_lookups/.test(by.wh_outbound.marker), true);
is('wh_update_item is marked by something 057 added, not something 054 had',
   /orig_upper|orig_lower/.test(by.wh_update_item.marker), true);
is('and wh_update_item is known to have been rewritten four times',
   by.wh_update_item.versions, 4);

/* ---- prove it by breaking ---- */
console.log('\n  --- and the rule, against markers that would not work ---');
{
  /* the exact mistake: a declare line identical in both versions */
  const old = 'declare i wh_items; iid bigint := 1; touches_stock boolean;';
  const neu = old;
  is('a line identical in the previous version is rejected as a marker',
     lines(neu).filter(l => !lines(old).includes(l)), []);
}
{
  const old = 'declare i wh_items;\nif i.drum_cur is distinct from i.drum_upper then';
  const neu = 'declare i wh_items;\nand (i.drum_upper is distinct from i.orig_upper or i.drum_lower is null)';
  const cand = lines(neu).filter(l => l.length >= 40 && !lines(old).includes(l));
  is('a line only the new version has is accepted', cand.length > 0, true);
}
is('the header line is filtered out before anything is chosen',
   lines('language plpgsql security definer set search_path = public as $$\nselect 1;'),
   ['select 1;']);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
