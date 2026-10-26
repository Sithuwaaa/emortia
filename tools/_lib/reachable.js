/* reachable.js - the shared half of "is this still reachable from the page".

   NOT SHIPPED CODE. This is a test helper, like fake-supabase.js beside it.
   Nothing in the site loads it; three test files do.

   WHY IT EXISTS. f725036 narrowed the WH24 read and took the Download
   button off every opened ticket, because the plan's second half was never
   built. The suite was green: every document test asked whether a file had
   been STORED, none asked whether a stored file still ARRIVED somewhere a
   person could click.

   Three tools have that same shape - a file in a private bucket, a path on
   a row, a control on a page:

     wh24   gins[]            -> docsBox(t)        -> button.mini.dl
     esn    esnPhoto, esnFull,
            omIpPhoto         -> renderFiled()     -> img[data-shot] + button.dl
     swap   photos[]          -> renderRows(rows)  -> button.galbtn

   What generalises is the scaffolding, and only that: find what the read
   actually asks for, project a row through it, lift the real renderer out
   of the page, and refuse to trust a projection that does not project.
   What does NOT generalise is every interesting part - which columns, which
   renderer, what the control looks like, and what an empty one should do.
   Those stay in each tool's own file, where they can be read.

   THE TWO TRAPS, guarded here once rather than three times:

   1. A FAKE THAT DOES NOT PROJECT PASSES EITHER WAY. fake-supabase.js
      records st.cols and never applies it, so a row comes back whole
      whatever the select asked for - it would report a healthy page under a
      narrowed read too. selfCheck() asserts the projection on known input
      before any test is allowed to trust it.

   2. THE EMPTY CASE HAS TO BE ASSERTED IN THE SAME BREATH, or a renderer
      that always returned nothing would pass for ever. That one cannot be
      shared - only the tool knows what empty looks like - so this file
      cannot enforce it. Each test does, and says so.
*/
'use strict';

/* ---- what a db.js function actually selects ---------------------------

   Read out of the source, never restated in a test. If somebody narrows
   the read again, the test narrows with it, which is the only way it can
   notice. */
function selectOf(dbSrc, fnName) {
  const src = dbSrc.split('\r\n').join('\n');   /* db.js is CRLF on disk */
  const at = src.indexOf('async function ' + fnName + '(');
  if (at < 0) return null;
  /* Stop at the next function. A target with no select of its own must come
     back null rather than be answered by its neighbour's - that would be a
     false pass, and a false pass is the thing this file exists to prevent. */
  const next = src.indexOf('\n  async function ', at + 1);
  const scope = src.slice(at, next < 0 ? at + 1600 : next);

  /* either `const cols = …` just above the call, or the literal inside it */
  const viaConst = /const cols\s*=\s*([^;]+);/.exec(scope);
  if (viaConst) return resolve(viaConst[1], src);

  const inline = /\.select\((\s*'[^']*'|\s*"[^"]*"|\s*[A-Z_][A-Z_0-9]*)\s*\)/.exec(scope);
  if (inline) return resolve(inline[1], src);
  return null;
}

function resolve(expr, dbSrc) {
  const e = String(expr).trim();
  const lit = /^['"]([^'"]*)['"]$/.exec(e);
  if (lit) return lit[1];
  /* a named constant, e.g. WH24_LIST or GOAL_COLS */
  const name = /^[A-Z_][A-Z_0-9]*$/.test(e) ? e : (/([A-Z_][A-Z_0-9]{2,})/.exec(e) || [])[1];
  if (name) {
    const asStr = new RegExp('const ' + name + "\\s*=\\s*'([^']+)'").exec(dbSrc);
    if (asStr) return asStr[1];
    const asArr = new RegExp('const ' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]\\.join').exec(dbSrc);
    if (asArr) return (asArr[1].match(/'([a-z_0-9]+)'/g) || []).map(s => s.replace(/'/g, '')).join(',');
  }
  if (/\*/.test(e)) return '*';
  return null;
}

/* ---- a projection that actually projects ------------------------------ */
function project(row, cols) {
  if (!cols || String(cols).trim() === '*') return Object.assign({}, row);
  const keep = String(cols).split(',').map(s => s.trim()).filter(Boolean);
  const out = {};
  for (const k of keep) if (k in row) out[k] = row[k];
  return out;
}

/* ---- lift a named function out of a page, by brace matching ------------ */
function lift(pageSrc, name) {
  const start = pageSrc.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = pageSrc.indexOf('{', start), depth = 0;
  for (; i < pageSrc.length; i++) {
    if (pageSrc[i] === '{') depth++;
    else if (pageSrc[i] === '}') { depth--; if (!depth) return pageSrc.slice(start, i + 1); }
  }
  return null;
}

/* the page's own escaper, which every renderer here calls */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---- the harness checks itself before anything trusts it --------------
   Takes the caller's own `is`, so a failure here is counted and reported
   in that tool's suite rather than thrown away. */
function selfCheck(is) {
  const whole = { id: 1, photos: [{ path: 'a.jpg' }], sn: 'X', note: 'n' };
  is('harness: projection keeps what was asked for',
     Object.keys(project(whole, 'id,sn')).sort(), ['id', 'sn']);
  is('harness: projection drops what was not',
     'photos' in project(whole, 'id,sn'), false);
  is('harness: star keeps everything',
     Object.keys(project(whole, '*')).length, 4);
  is('harness: a missing column is simply absent',
     'nope' in project(whole, 'id,nope'), false);
  is('harness: lift finds a function and balances its braces',
     /\}$/.test(lift('function f(){ if(1){ } }', 'f') || ''), true);
  is('harness: lift returns null for what is not there',
     lift('function f(){}', 'ghost'), null);

  /* and the select lookup must not answer with the neighbour's columns */
  const two = [
    '  async function aLoad(limit){',
    "    const { data } = await c.from(A).select('id,name');",
    '  }',
    '  async function bLoad(limit){',
    '    const { data } = await c.from(B);',
    '  }'
  ].join('\n');
  is('harness: selectOf reads the function it was asked about',
     selectOf(two, 'aLoad'), 'id,name');
  is('harness: and not the next one down',
     selectOf(two, 'bLoad'), null);
  is('harness: CRLF source reads the same as LF',
     selectOf(two.split('\n').join('\r\n'), 'aLoad'), 'id,name');
}

module.exports = { selectOf, project, lift, esc, selfCheck };
