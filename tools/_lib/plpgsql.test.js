/* plpgsql.test.js - a declared variable must not share a name with a table
   alias in the same function body.

     node tools/_lib/plpgsql.test.js

   WHY THIS FILE EXISTS. 050 shipped wh_delete_note with "L record" while
   all three of its queries aliased wh_lines as "l". PostgreSQL folds an
   unquoted identifier to lower case, so L and l are one name: l.* and
   l.note_id resolved to the declared variable instead of the alias, the
   variable had no value until the loop assigned it, and the loop could
   not assign it until the query ran. Every delete died with

       record "l" is not assigned yet

   The same hour, 052 was written in the same style and carried the
   identical bug. Nothing in the repository noticed either copy. The suite
   does not run Postgres; migrations.test.js checks that each migration is
   accounted for, not what its bodies mean; and both files are valid SQL,
   because a plpgsql body is only parsed when the function is created.

   So this is a VISIBILITY check, not a judgement one. It does not ask
   whether a function is correct. It asks one question a reader cannot
   reliably answer by looking - does any declared name collide with an
   alias used beside it - across every migration at once.

   Proved by breaking, at the bottom: the real wh_delete_note with rec
   renamed back to L must be caught.
*/
const fs = require('fs');
const path = require('path');

const SQLDIR = path.join(__dirname, '..', '..', 'supabase');

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + label); return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

/* Words that follow a table name without being an alias. Missing one here
   invents a collision; the cost is a false failure, which is the safe
   direction for a check of this kind. */
const NOT_AN_ALIAS = new Set(['where','on','loop','order','group','having','set','join',
  'left','right','inner','outer','full','cross','lateral','using','as','for','into',
  'limit','offset','and','or','select','values','returning','union','except','intersect',
  'when','then','else','end','from','if','is','not','null','exists','in','by','asc','desc']);

function bodies(sql) {
  const out = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_]+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const open = sql.indexOf('$$', m.index);
    if (open < 0) continue;
    const close = sql.indexOf('$$', open + 2);
    if (close < 0) continue;
    out.push({ fn: m[1], body: sql.slice(open + 2, close), at: sql.slice(0, m.index).split('\n').length });
  }
  return out;
}

function declaredNames(body) {
  const i = body.search(/\bdeclare\b/i);
  if (i < 0) return [];
  const j = body.search(/\bbegin\b/i);
  const head = body.slice(i + 7, j > i ? j : body.length);
  const names = [];
  for (const part of head.split(';')) {
    const m = part.match(/^\s*([a-z_][a-z0-9_]*)\s+\S/i);
    if (m) names.push(m[1].toLowerCase());
  }
  return names;
}

function aliases(body) {
  const found = new Set();
  const re = /\b(?:from|join)\s+[a-z_][a-z0-9_]*(?:\s*\([^)]*\))?\s+(?:as\s+)?([a-z_][a-z0-9_]*)/gi;
  let m;
  while ((m = re.exec(body))) {
    const a = m[1].toLowerCase();
    if (!NOT_AN_ALIAS.has(a)) found.add(a);
  }
  return found;
}

function collisions(sql) {
  const hits = [];
  for (const { fn, body, at } of bodies(sql)) {
    const al = aliases(body);
    for (const v of declaredNames(body)) if (al.has(v)) hits.push({ fn, name: v, at });
  }
  return hits;
}

console.log('--- a declared name must not be a table alias too ---\n');

const files = fs.readdirSync(SQLDIR).filter(f => f.endsWith('.sql')).sort();
const offenders = [];
let scanned = 0, fns = 0;
for (const f of files) {
  const sql = fs.readFileSync(path.join(SQLDIR, f), 'utf8');
  scanned++; fns += bodies(sql).length;
  for (const h of collisions(sql)) offenders.push(f + ':' + h.at + '  ' + h.fn + '()  "' + h.name + '"');
}
console.log('  scanned ' + scanned + ' migrations, ' + fns + ' function bodies\n');
if (offenders.length) {
  console.log('  a variable and an alias share a name - Postgres sees one identifier:');
  for (const o of offenders) console.log('    ' + o);
  console.log('');
}
is('no declared name shadows a table alias', offenders.length, 0);

/* ---- proved by breaking ---------------------------------------------- */
{
  const real = fs.readFileSync(path.join(SQLDIR, '050_warehouse_delete_edit.sql'), 'utf8');
  const broken = real.replace(/\brec\b/g, 'L');
  const hits = collisions(broken).map(h => h.fn + ':' + h.name);
  is('the shipped bug is caught when put back', hits.includes('wh_delete_note:l'), true);
}
{
  const clean = 'create or replace function f() returns void language plpgsql as $$\n' +
                'declare rec record;\nbegin\n  for rec in select l.* from wh_lines l loop null; end loop;\nend $$;';
  is('rec beside alias l is fine', collisions(clean).length, 0);
}
{
  const dirty = 'create or replace function g() returns void language plpgsql as $$\n' +
                'declare i wh_items;\nbegin\n  select * into i from wh_items i where true;\nend $$;';
  is('a second shape is caught too', collisions(dirty).map(h => h.name), ['i']);
}
{
  const noalias = 'create or replace function h() returns void language plpgsql as $$\n' +
                  'declare n wh_notes;\nbegin\n  select * into n from wh_notes where id = $1;\nend $$;';
  is('a table with no alias invents nothing', collisions(noalias).length, 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
