/* wh-origin.test.js - where a stock hit came from, and the serial
   beside it.

     node tools/_lib/wh-origin.test.js

   TWO THINGS, because they live in the same two lines of the page.

   ORIGIN. The outbound pick lists show a code, a name, what is left and
   a bin. In a warehouse of six hundred items that is enough; in his,
   where the same material code sits on a shelf three times over, the
   question he is actually answering is "which one" - and the honest
   answer to that is where it came from. originOf already handled a
   warehouse, a REDEP and a local purchase. A site return - most of what
   he is choosing between - fell through to the empty string.

   These assertions run the real function, pulled out of the page
   source, and read its actual output. A test that checked only that the
   word "fromSite" appears somewhere would pass against a function that
   returns nothing.

   THE SERIAL. There are exactly two of these hit renderers and they
   print the same things in the same order. One escaped the serial and
   one did not, which is how it survived several edits to both: reading
   either one on its own, nothing looks wrong. So this counts them and
   insists they agree. */

const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', 'warehouse', 'warehouse.js');
const src = fs.readFileSync(W, 'utf8');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- the real function, run ---- */
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const text = (src.match(/function originOf\(L\)\{[\s\S]*?\n\}/) || [''])[0];

console.log('--- where a stock hit came from ---');
is('originOf was found in the page', text.length > 100, true);
if (!text) { console.log('\n0 passed, 1 failed\n'); process.exit(1); }

const originOf = new Function('esc', 'return (' + text + ')')(esc);

/* the case that drew nothing before */
const ret = originOf({ source: 'return', fromSite: 'AUS0123', fromSiteName: 'Austin D2' });
is('a returned item names its site', /AUS0123/.test(ret), true);
is('and the site name with it', /Austin D2/.test(ret), true);
is('as a site-coloured origin chip', /class="chip org st"/.test(ret), true);
is('a return whose site name is not known still shows the ID',
   originOf({ source: 'return', fromSite: 'AUS0456', fromSiteName: '' }).includes('AUS0456'), true);

/* the ones that already worked, which must not have moved */
is('REDEP still says REDEP',
   originOf({ source: 'redep', fromSite: 'AUS0123' }), '<span class="chip org rd">REDEP</span>');
is('a local purchase still says so',
   originOf({ source: 'local' }), '<span class="chip org lp">Local purchase</span>');
is('a warehouse is still named',
   originOf({ source: 'new', fromWh: 'ACE' }), '<span class="chip org">ACE</span>');
is('and an item with no origin at all draws nothing',
   originOf({ source: 'new' }), '');
is('nor does a missing item', originOf(null), '');

/* REDEP comes off a site too, and must not be relabelled as a plain
   return - the whole point of the word is that it did not go back */
is('a REDEP that came off a site is still a REDEP, not a return',
   /org st/.test(originOf({ source: 'redep', fromSite: 'AUS0123', fromSiteName: 'Austin D2' })), false);

/* the site is untrusted text, like every other name he types */
is('a site name is escaped',
   originOf({ source: 'return', fromSite: 'A1', fromSiteName: '<b>x</b>' }).includes('<b>'), false);

/* ---- the matched pair of hit renderers ---- */
console.log('\n--- the two hit renderers, which must agree ---');
const pairs = src.split('\n').filter(l => /L\.sn\|\|fmt\(/.test(l));
is('both hit renderers are still there', pairs.length, 2);
is('and both escape the serial they print',
   pairs.filter(l => !/esc\(L\.sn\|\|fmt\(/.test(l)), []);
is('both ask originOf', src.split('originOf(L)').length - 1 >= 2, true);

/* ---- the shared serial renderer, and a tripwire ----

   It was fair to ask what the pair count actually watches: it matches
   the idiom "L.sn||fmt(", so a brand new renderer printing a bare serial straight
   into a template would not be counted and this file would stay green.

   I tried to answer that by finding every substitution that mentions a
   serial and insisting each passed through something that escapes. It
   does not work. Four of the five things it flagged print nothing -
   search filters that join fields to match a query, and a description
   string escaped later at the point of use - and telling those apart
   from real output needs a parser, not a regex. The only way to get it
   green was to keep widening the list of calls it treats as safe,
   which is fitting the guard to the values.

   So: the two things that can be checked without guessing.

   One, snHtml is the shared helper that renders a serial into HTML -
   two call sites - and it must escape on both of its branches.

   Two, a count. Not a proof of anything, a tripwire: if a serial turns
   up somewhere new, this fails and someone goes and looks at it. That
   is the whole job. The number may move for an innocent reason; move
   it, having looked.

   AND WHAT THIS FILE CANNOT DO, since that was the question behind the
   report: it reads the page on disk, not the page on the server. A
   green run here says nothing about what is deployed. deploy-check is
   what compares those two, and it runs on every push. */
{
  const snHtml = (src.match(/const snHtml=[^\n]*/) || [''])[0];
  is('snHtml exists', snHtml.length > 20, true);
  is('and escapes a dummy serial', /class="dmy">\$\{esc\(sn\)\}/.test(snHtml), true);
  is('and escapes a real one', /esc\(sn\|\|'—'\)/.test(snHtml), true);
  /* two call sites, and the definition is an arrow so it is not one of
     them - I wrote >= 3 expecting it to be, which was arithmetic, not a
     weaker rule. Exactly two is the tighter statement: the Inventory
     grid and the note's item table, which are the two places a stored
     serial is printed. */
  is('it is used at both places a stored serial is printed',
     (src.match(/snHtml\(/g) || []).length, 2);

  const n = (src.match(/\bL\.sn\b/g) || []).length;
  console.log('  serial mentions in the page: ' + n);
  /* 38 -> 41 on 069. The tripwire fired and I looked: the three
     new mentions are in editInboundNote and editDispatchNote, which
     build the form's own state from a filed note - sn:L.sn and
     q:L.sn||... as object properties. None of them renders HTML, so
     none of them needs escaping. Moved, having looked, which is what
     the number is for. */
  /* 41 -> 39. The two note views lost their per-row pencil: the whole
     note is editable now, so a pencil opening one row beside a form
     opening all of them was two answers to one question. Each of those
     calls passed a serial as the button's label - rowEdit(L.id,
     L.sn||...) - so two mentions went with them, and both were inside
     an escaper, which is why the count below fell by two as well.
     Moved, having looked. */
  is('the page mentions a serial exactly where it did', n, 39);
  is('and ten of those are inside something that escapes',
     (src.match(/(?:esc|hlt|snHtml|rowEdit|rowDel)\([^()]*L\.sn/g) || []).length, 8);
}

/* ---- prove it by breaking ---- */
console.log('\n  --- and the same checks against the code as it was ---');
const was = `      <em>\${L.drum?fmt(L.qty)+' m left':L.sn||fmt(L.qty)+' '+L.uom}</em>`;
is('the unescaped version is caught', /esc\(L\.sn\|\|fmt\(/.test(was), false);
const old = `function originOf(L){
  if(!L) return '';
  if(L.source==='redep') return '<span class="chip org rd">REDEP</span>';
  if(L.fromWh) return '<span class="chip org">'+esc(L.fromWh)+'</span>';
  return '';
}`;
is('and the version with no site answer is caught',
   new Function('esc', 'return (' + old + ')')(esc)({ source: 'return', fromSite: 'AUS0123' }), '');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
