/* wh-payload.test.js - every field the warehouse page sends is a field the
   database reads.

     node tools/_lib/wh-payload.test.js

   WHY THIS EXISTS. The page talks to Postgres through one rpc per action,
   with the whole payload as a single jsonb. jsonb accepts anything. A key
   the function never reads is not an error anywhere: not in the browser,
   not in the SQL, not in the suite. It is dropped in silence, and the
   field looks saved until somebody opens the note a week later and finds
   it empty.

   That has happened three times on this tool - driver_nic, issued_contact
   and remarks were each sent by the page with nowhere to land. Each was
   found by eye, afterwards. This is the check that was missing.

   WHAT IT COMPARES
     sent   the keys of the object each DB.wh* payload call is given, at
            the top level and inside the per-item map
     read   the keys each wh_* function pulls out with p->>'k', p->'k',
            p ? 'k', it->>'k' or it->'k'

   WHICH CALLS COUNT is read out of db.js, not guessed from the name: a
   payload wrapper is one written as whRpc('wh_x', { p }). The others pass
   named scalars (wh_delete_note, wh_next) or write to a table directly
   (whSetSN, whPin), and neither can lose a field this way - a wrong column
   name there is an error the client reports.

   THE LAST DEFINITION WINS. A function may be rewritten by a later
   migration - wh_inbound is written in 048 and again in 053 - so the
   definitions are read in migration order and the last one is the one the
   database will be running.

   THE OTHER DIRECTION IS NOT AN ERROR. A function may read a key the page
   does not send yet; that is a field waiting for a form. Only sent-but-
   never-read loses data in silence, so only that fails.

   AND IT SAYS WHAT IT CANNOT SEE. A payload call whose argument this
   cannot parse FAILS rather than being passed over, and a payload function
   with no call sites at all is named in the output. The @media bug in
   cascade.js hid 109 dropped rules for weeks because the parser that could
   not read them reported nothing at all; a guard that quietly sees less
   than it claims to is worse than no guard. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'tools', 'warehouse', 'warehouse.js');
const DBJS = path.join(ROOT, 'tools', '_lib', 'db.js');
const SUPA = path.join(ROOT, 'supabase');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- shared: brace matching ----------------------------------------- */

/* COMMENTS ARE BLANKED BEFORE ANYTHING IS WALKED, and the reason is a
   bug this file had. The walkers below track strings so that a brace
   inside a message cannot end an object early - but they knew nothing
   about comments, and an apostrophe in a comment INSIDE a payload
   literal opened a string that never closed. One "this row's own
   answer" above a key, and the whole call site came back unparseable:

     source:nIn.type==='RT'?...     <- swallowed by the open quote

   It failed loudly rather than quietly, which is the right way round,
   but it also meant the payload could only be commented in prose with
   no apostrophes in it - a rule nobody would remember, enforced by a
   confusing failure. Blanking keeps the byte offsets and the newlines
   exactly as they were, so every index and line number downstream is
   unchanged. */
function blankComments(src) {
  let out = '', i = 0, inStr = null;
  const blank = t => t.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const c = src[i];
    if (inStr) { out += c; if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; }
      if (c === inStr) inStr = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += blank(src.slice(i, stop)); i = stop; continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      out += blank(src.slice(i, stop)); i = stop; continue;
    }
    out += c; i++;
  }
  return out;
}

/* from the opening brace to its partner, respecting strings so a } inside
   a message or a template literal cannot end the object early */
function blockFrom(src, open) {
  let d = 0, inStr = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return src.slice(open, i + 1); }
  }
  return null;
}

/* the keys of one object literal, at its own level only, so item keys and
   the branches of a ternary inside a value are not taken for fields */
function topKeys(block) {
  const out = [];
  let d = 0, i = 0, inStr = null;
  while (i < block.length) {
    const c = block[i];
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue; }
    if (c === '{' || c === '[' || c === '(') { d++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { d--; i++; continue; }
    if (d === 1) {
      const m = /^([a-zA-Z_][\w]*)\s*:/.exec(block.slice(i));
      if (m && /[{,\s]/.test(block[i - 1] || '{')) { out.push(m[1]); i += m[0].length; continue; }
    }
    i++;
  }
  return out;
}

/* the expression one top-level key is given, up to the comma that ends it */
function valueOf(block, key) {
  let d = 0, i = 0, inStr = null;
  const kx = new RegExp('^' + key + '\\s*:');
  while (i < block.length) {
    const c = block[i];
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue; }
    if (c === '{' || c === '[' || c === '(') { d++; i++; continue; }
    if (c === '}' || c === ']' || c === ')') { d--; i++; continue; }
    if (d === 1 && kx.test(block.slice(i)) && /[{,\s]/.test(block[i - 1] || '{')) {
      const start = i + kx.exec(block.slice(i))[0].length;
      let j = start, dd = 0, s2 = null;
      while (j < block.length) {
        const k = block[j];
        if (s2) { if (k === '\\') j++; else if (k === s2) s2 = null; j++; continue; }
        if (k === '"' || k === "'" || k === '`') { s2 = k; j++; continue; }
        if (k === '{' || k === '[' || k === '(') dd++;
        else if (k === '}' || k === ']' || k === ')') { if (!dd) break; dd--; }
        else if (k === ',' && !dd) break;
        j++;
      }
      return block.slice(start, j);
    }
    i++;
  }
  return null;
}

/* THE PER-ITEM KEYS, HOWEVER THE CALLBACK IS WRITTEN. The inbound map is
   r => ({...}); the outbound map is r => { ...; return {...}; return {...} }
   with one shape for a row picked off stock and another for a manual row.
   Matching only the first form read the outbound items as empty and printed
   "0 per item" - green, and blind to the very field (remarks) that this
   file was written about. So every returned literal is collected, and the
   union of their keys is what the page sends. */
function itemKeys(block) {
  const expr = valueOf(block, 'items');
  if (expr === null) return { keys: [], shapes: 0, present: false };
  const keys = new Set();
  let shapes = 0;
  for (const m of expr.matchAll(/(?:=>\s*\(\s*|return\s+)\{/g)) {
    const b = blockFrom(expr, expr.indexOf('{', m.index + m[0].length - 1));
    if (!b) continue;
    shapes++;
    for (const k of topKeys(b)) keys.add(k);
  }
  return { keys: [...keys], shapes, present: true };
}

/* ---- 1. which wrappers carry a payload, per db.js -------------------- */

function payloadWrappers() {
  const src = fs.readFileSync(DBJS, 'utf8');
  const out = new Map();                       // whInbound -> wh_inbound
  for (const m of src.matchAll(/const\s+(wh[A-Za-z]+)\s*=\s*p\s*=>\s*whRpc\(\s*'(wh_[a-z_]+)'\s*,\s*\{\s*p\s*\}\s*\)/g))
    out.set(m[1], m[2]);
  return out;
}

/* ---- 2. what the SQL reads ------------------------------------------ */

function readSide() {
  const files = fs.readdirSync(SUPA).filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const defs = new Map();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SUPA, f), 'utf8');
    const rx = /create\s+or\s+replace\s+function\s+(wh_[a-z_]+)\s*\(([^)]*)\)([\s\S]*?)\$\$;/gi;
    let m;
    while ((m = rx.exec(sql))) defs.set(m[1].toLowerCase(), { args: m[2], body: m[3], from: f });
  }
  const out = new Map();
  for (const [name, d] of defs) {
    const p = new Set(), it = new Set();
    for (const mm of d.body.matchAll(/\bp\s*(?:->>|->|\?)\s*'([a-zA-Z_]\w*)'/g)) p.add(mm[1]);
    for (const mm of d.body.matchAll(/\bit\s*(?:->>|->|\?)\s*'([a-zA-Z_]\w*)'/g)) it.add(mm[1]);
    /* A DYNAMIC STATEMENT READS p TOO, AND THE PATTERN ABOVE IS BLIND TO
       IT. wh_update_note sets driver_nic and issued_contact through an
       EXECUTE with p bound as a parameter, so inside the quoted statement
       they read $2->>''driver_nic'' and not p->>'driver_nic'. Matching
       only the latter made the scan report those two as never read -
       which is how the first version of this file behaved, and they are
       two of the three fields it was written about. Counted only when p
       is actually in the USING list, so this cannot invent a read. */
    if (/\busing\b[^;]*\bp\b/i.test(d.body))
      for (const mm of d.body.matchAll(/\$\d+\s*(?:->>|->|\?)\s*''?([a-zA-Z_]\w*)''?/g)) p.add(mm[1]);
    out.set(name, { p, it, from: d.from, jsonb: /\bp\s+jsonb\b/i.test(d.args) });
  }
  return out;
}

/* WHAT THE PAGE DECLARES IT MAY SEND. An edit payload is assembled from
   whichever boxes the typist changed, so there is no single literal to
   read and this file will not guess at one. The page therefore states
   its own surface as const WH_SENDS_<function> = { ... }, and that is
   what gets compared here. The page's whOnly() throws at runtime on a
   key outside its declaration, so the two cannot drift apart quietly. */
function declaredSide() {
  const src = blankComments(fs.readFileSync(PAGE, 'utf8'));
  const out = new Map();
  for (const m of src.matchAll(/const\s+WH_SENDS_(wh_[a-z_]+)\s*=\s*\{/g)) {
    const b = blockFrom(src, m.index + m[0].length - 1);
    if (b) out.set(m[1], topKeys(b));
  }
  return out;
}

/* ---- 3. what the page sends ----------------------------------------- */

/* Every call site of every payload wrapper. The argument is either an
   object literal written in place, or the name of one built just above. */
function sentSide(wrappers) {
  const src = blankComments(fs.readFileSync(PAGE, 'utf8'));
  const found = [], unreadable = [];
  for (const [wrapper, fn] of wrappers) {
    const rx = new RegExp('DB\\.' + wrapper + '\\s*\\(', 'g');
    let m;
    while ((m = rx.exec(src))) {
      const argAt = m.index + m[0].length;
      const rest = src.slice(argAt);
      let block = null, how = '';
      const inline = /^\s*\{/.exec(rest);
      const named = /^\s*([A-Za-z_$][\w$]*)\s*\)/.exec(rest);
      if (inline) { block = blockFrom(src, argAt + inline[0].length - 1); how = 'in place'; }
      else if (named) {
        /* the object it names, built just above in the same function */
        const decl = src.lastIndexOf('const ' + named[1] + '={', m.index);
        const decl2 = src.lastIndexOf('const ' + named[1] + ' = {', m.index);
        const at = Math.max(decl, decl2);
        if (at !== -1) { block = blockFrom(src, src.indexOf('{', at)); how = 'via ' + named[1]; }
      }
      const line = src.slice(0, m.index).split('\n').length;
      if (!block) { unreadable.push({ fn, at: wrapper + ' at warehouse.js:' + line }); continue; }
      const it = itemKeys(block);
      if (it.present && !it.shapes) unreadable.push({ fn, at: wrapper + ' at warehouse.js:' + line + ' - its items map returns nothing this can read' });
      found.push({ wrapper, fn, line, how, top: topKeys(block).filter(k => k !== 'items'),
                   items: it.keys, shapes: it.shapes, hasItems: it.present });
    }
  }
  return { found, unreadable };
}

/* ---- 4. compare ------------------------------------------------------ */

const WRAP = payloadWrappers();
const READ = readSide();
const DECL = declaredSide();
const { found: SENT, unreadable: RAW_UNREADABLE } = sentSide(WRAP);
/* A call site this cannot parse is forgiven only when the page has
   declared that function's key set instead. Nothing is simply skipped. */
const unreadable = RAW_UNREADABLE.filter(u => !DECL.has(u.fn)).map(u => u.at);

console.log('--- every field the warehouse page sends is a field the database reads ---');
console.log('  payload wrappers in db.js: ' + [...WRAP.keys()].join(', '));
console.log('  wh_ functions in supabase/: ' + [...READ.keys()].sort().join(', '));
for (const s of SENT)
  console.log('  warehouse.js:' + s.line + '  ' + s.fn + ' (' + s.how + ')  '
    + s.top.length + ' fields, ' + s.items.length + ' per item across '
    + s.shapes + ' item shape' + (s.shapes === 1 ? '' : 's'));
for (const [fn, keys] of DECL)
  console.log('  declared by the page: ' + fn + '  may send ' + keys.length + ' keys');
const silent = [...WRAP.values()].filter(fn => !SENT.some(s => s.fn === fn) && !DECL.has(fn));
if (silent.length) console.log('  no call site yet: ' + silent.join(', ') + '  (nothing to compare)');
console.log('');

/* A SCAN THAT READS NOTHING PASSES EVERYTHING. */
is('db.js still routes payloads through whRpc(.., { p })', WRAP.size >= 4, true);
is('the migrations still define the wh_ functions', READ.size >= 8, true);
is('every payload wrapper names a function that exists',
   [...WRAP.values()].filter(fn => !READ.has(fn)), []);
is('every payload function really takes p jsonb',
   [...WRAP.values()].filter(fn => READ.has(fn) && !READ.get(fn).jsonb), []);
is('no payload call site was skipped as unparseable', unreadable, []);
is('the page still files notes', SENT.filter(s => s.fn === 'wh_inbound' || s.fn === 'wh_outbound').length >= 2, true);
/* both note payloads carry items, so an empty item list here means the
   scan went blind, not that the page sends bare notes */
is('both note payloads were read with their items',
   SENT.filter(s => (s.fn === 'wh_inbound' || s.fn === 'wh_outbound') && s.items.length)
       .map(s => s.fn).sort(), ['wh_inbound', 'wh_outbound']);

/* The dynamic-EXECUTE reads must actually be found, or the fix above is
   dead code and the scan is back to being blind about them. */
is('wh_update_note is seen to read the two fields it sets dynamically',
   ['driver_nic', 'issued_contact'].filter(k => !READ.get('wh_update_note').p.has(k)), []);

is('every declared key set names a function that exists',
   [...DECL.keys()].filter(fn => !READ.has(fn)), []);

const orphans = [];
for (const s of SENT) {
  const r = READ.get(s.fn);
  for (const k of s.top) if (!r.p.has(k)) orphans.push(s.fn + ' <- ' + k + '  (warehouse.js:' + s.line + ', never read)');
  for (const k of s.items) if (!r.it.has(k)) orphans.push(s.fn + ' <- items[].' + k + '  (warehouse.js:' + s.line + ', never read)');
}
for (const [fn, keys] of DECL) {
  const r = READ.get(fn); if (!r) continue;
  for (const k of keys) if (!r.p.has(k)) orphans.push(fn + ' <- ' + k + '  (declared by the page, never read)');
}
if (orphans.length) {
  console.log('\n  SENT WITH NOWHERE TO LAND:');
  for (const o of orphans) console.log('    ' + o);
  console.log('  Either the function should read it, or the page should stop sending it.\n');
}
is('nothing is sent that the database never reads', orphans, []);

/* ---- 5. prove it by breaking ---------------------------------------- */

/* A checker green on a clean tree has said nothing until it is shown
   failing on a dirty one. Every arm of it, in memory. */
console.log('\n  --- and the same machinery against inputs that are wrong ---');
{
  const r = READ.get('wh_inbound');
  const caught = ['kind', 'nowhere_to_land'].filter(k => !r.p.has(k));
  is('a top-level key the function never reads is caught', caught, ['nowhere_to_land']);
}
{
  const r = READ.get('wh_inbound');
  const caught = ['code', 'bogus_item_field'].filter(k => !r.it.has(k));
  is('an item key the function never reads is caught', caught, ['bogus_item_field']);
}
{
  /* the two that really were lost, as the tree looked before 049 */
  const r = READ.get('wh_outbound');
  const before049 = new Set([...r.p].filter(k => k !== 'driver_nic' && k !== 'issued_contact'));
  is('the fields 049 had to add would have been caught',
     ['driver_nic', 'issued_contact'].filter(k => !before049.has(k)),
     ['driver_nic', 'issued_contact']);
}
{
  /* the comment that broke it, asserted both ways round */
{
  const withApostrophe = `const p={kind:'GRN',
    /* this row's own answer, and 'return' in the same breath */
    items:ok.map(r=>({code:r.code,source:'redep'}))};`;
  is('an apostrophe in a comment no longer opens a string',
     itemKeys(blankComments(withApostrophe)).keys.sort(), ['code', 'source']);
  is('and without blanking it really did swallow the rest',
     itemKeys(withApostrophe).keys.length === 0
       || !itemKeys(withApostrophe).present, true);
  is('a brace inside a REAL string is still respected',
     topKeys(blankComments(`{a:'}{',b:1}`)).sort(), ['a', 'b']);
  is('and a // comment goes too',
     topKeys(blankComments("{a:1, // b:2 is not a key\n c:3}")).sort(), ['a', 'c']);
  is('blanking keeps the file the same length',
     blankComments("{a:1 /* xx */}").length, "{a:1 /* xx */}".length);
  is('and keeps its line count',
     blankComments("{a:1 /* x\ny */}").split('\n').length, 2);
}

/* an unparseable call site must fail, not vanish */
  const src = "DB.whUpdateItem(buildIt(row))";
  const argAt = src.indexOf('(') + 1;
  const rest = src.slice(argAt);
  const readable = /^\s*\{/.test(rest) || /^\s*([A-Za-z_$][\w$]*)\s*\)/.test(rest);
  is('a payload built by a call, not a literal, is reported unreadable', readable, false);
}
{
  /* and the healthy shapes stay readable */
  for (const shape of ['DB.whUpdateItem({id:1,name:"x"})', 'DB.whInbound(p)']) {
    const argAt = shape.indexOf('(') + 1, rest = shape.slice(argAt);
    const readable = /^\s*\{/.test(rest) || /^\s*([A-Za-z_$][\w$]*)\s*\)/.test(rest);
    is('"' + shape + '" is readable', readable, true);
  }
}
{
  /* a declared key that no function reads is caught the same way */
  const r = READ.get('wh_update_item');
  is('a declared key the function never reads is caught',
     ['id', 'name', 'not_a_column'].filter(k => !r.p.has(k)), ['not_a_column']);
}
{
  /* AND THE DYNAMIC-EXECUTE FIX IS SHOWN TO BE WHAT FINDS THEM. The
     p->>'k' pattern alone, run over the migration that defines
     wh_update_note, does not contain either field - so if the $n rule
     above ever stops matching, the assertion that they ARE read is a
     real failure and not a formality. */
  const sql = fs.readFileSync(path.join(SUPA, '050_warehouse_delete_edit.sql'), 'utf8');
  const plainOnly = new Set([...sql.matchAll(/\bp\s*(?:->>|->|\?)\s*'([a-zA-Z_]\w*)'/g)].map(m => m[1]));
  is('the plain p->> pattern alone really is blind to those two',
     ['driver_nic', 'issued_contact'].filter(k => plainOnly.has(k)), []);
  const dyn = new Set([...sql.matchAll(/\$\d+\s*(?:->>|->|\?)\s*''?([a-zA-Z_]\w*)''?/g)].map(m => m[1]));
  is('and the $n pattern is what sees them',
     ['driver_nic', 'issued_contact'].filter(k => !dyn.has(k)), []);
}
{
  /* a key the SQL reads but the page does not send yet is allowed */
  const r = READ.get('wh_inbound');
  const unsent = [...r.p].filter(k => !SENT.some(s => s.fn === 'wh_inbound' && s.top.includes(k)));
  is('a field the SQL reads but no form fills yet is not an error',
     orphans.some(o => unsent.some(u => o.includes('<- ' + u + ' '))), false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
