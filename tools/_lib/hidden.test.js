/* hidden.test.js - the hidden attribute is not a toggle once CSS sets
   display on the same element.

     node tools/_lib/hidden.test.js

   WHAT HAPPENED. Material Codes shipped invisible. The modal backdrop
   carried the hidden attribute AND display:flex, so it stood over the
   whole page permanently - dimming it and swallowing every click - while
   the markup and the script both said it was closed. .totop had the same
   bug and was permanently on screen.

   WHY. The hidden attribute does nothing by itself. It works through one
   rule in the user-agent stylesheet:

       [hidden] { display: none }

   A UA rule loses to ANY author declaration of the same property. So the
   moment a stylesheet says .scrim{display:flex}, the attribute is inert
   and el.hidden = true is a no-op that reads like it worked.

   THE CLASS, not the instance. This is the vacuous-indexOf shape: a
   mechanism that silently does not do what the code says it does, and
   that nothing fails on. So this file finds every element in every tool
   whose visibility is driven by `hidden`, and requires that any page
   also setting display on it declares the override explicitly:

       .scrim[hidden],.totop[hidden]{display:none}

   AND HOW IT WAS FOUND, which is the other half of the lesson. Computed
   styles did not find it and could not have - a contrast reading of
   14.6:1 was taken on text that was sitting under the scrim, because a
   generic selector returned an element nobody could see. It took
   elementFromPoint at the coordinates of a screenshot. A page nobody has
   looked at is not verified.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TOOLS = path.join(ROOT, 'tools');

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

const pages = fs.readdirSync(TOOLS)
  .filter(d => fs.existsSync(path.join(TOOLS, d, 'index.html')))
  .map(d => ({ tool: d, src: fs.readFileSync(path.join(TOOLS, d, 'index.html'), 'utf8') }));
is('there are tool pages to scan', pages.length >= 15, true);

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* every selector whose visibility this page drives with `hidden` */
function controlled(src) {
  const out = new Set();
  /* the attribute in the markup */
  for (const m of src.matchAll(/<[a-z]+[^>]*\shidden(?=[\s/>=])[^>]*>/gi)) {
    const tag = m[0];
    const id = (/\sid="([^"]+)"/.exec(tag) || [])[1];
    const cl = (/\sclass="([^"]+)"/.exec(tag) || [])[1];
    if (id) out.add('#' + id);
    if (cl) cl.split(/\s+/).forEach(c => c && out.add('.' + c));
  }
  /* and anything the script assigns .hidden on, by id */
  for (const m of src.matchAll(/\$\('([^']+)'\)\.hidden\s*=/g)) out.add('#' + m[1]);
  for (const m of src.matchAll(/getElementById\('([^']+)'\)\.hidden\s*=/g)) out.add('#' + m[1]);
  return [...out];
}

/* every rule in the page's own <style> blocks that sets display on a
   selector, ignoring rules already qualified by [hidden] */
function displayRules(src, sel) {
  const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const hits = [];
  const re = new RegExp('(?:^|[,}])\\s*(' + esc(sel) + ')(?![\\w-])([^{,}]*)\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(css))) {
    if (/\[hidden\]/.test(m[1] + m[2])) continue;
    if (/(^|;)\s*display\s*:/.test(m[3])) hits.push((m[1] + m[2]).trim());
  }
  return hits;
}

function hasOverride(src, sel) {
  const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  return new RegExp(esc(sel) + '\\[hidden\\]').test(css);
}

/* ---- the scan ------------------------------------------------------- */
const found = [], broken = [];
for (const p of pages) {
  for (const sel of controlled(p.src)) {
    const rules = displayRules(p.src, sel);
    if (!rules.length) continue;                 /* the UA rule is enough */
    found.push(p.tool + ' ' + sel);
    if (!hasOverride(p.src, sel))
      broken.push(p.tool + '  ' + sel + '  has display in {' + rules.join(' | ') + '} and no ' + sel + '[hidden] rule');
  }
}

/* A SCAN THAT FINDS NOTHING PASSES EVERYTHING. Material Codes has two of
   these by construction, so if the scan cannot see them it is not
   reading the pages and nothing below it means anything. */
is('THE SCAN FINDS THE ELEMENTS IT IS MEANT TO WATCH',
   found.filter(f => /^materials /.test(f)).sort(), ['materials .scrim', 'materials .totop']);
is('and it found some display rules to be wrong about', found.length >= 2, true);

is('NO ELEMENT IS HIDDEN BY AN ATTRIBUTE A DISPLAY RULE OUTRANKS', broken, []);

/* ---- and the override really is what the browser needs -------------- */
{
  const mat = pages.find(p => p.tool === 'materials').src;
  is('materials declares the override for both',
     /\.scrim\[hidden\],\.totop\[hidden\]\{display:none\}/.test(mat), true);
  /* it has to come from the page, not be inherited from a shared sheet -
     category.css and theme.css know nothing about a tool's own classes */
  const shared = ['category.css', 'theme.css', 'nav.css', 'lookup.css', 'motion.css']
    .map(f => path.join(TOOLS, '_lib', f)).filter(f => fs.existsSync(f))
    .map(f => fs.readFileSync(f, 'utf8')).join('\n');
  is('and no shared stylesheet is quietly providing it',
     /\.scrim\[hidden\]|\.totop\[hidden\]/.test(shared), false);
}

/* ---- the sensitivity check ------------------------------------------
   The whole file rests on displayRules() seeing a display declaration.
   Prove it sees one, and that it correctly ignores a rule already
   qualified by [hidden] - otherwise the override would look like the
   bug it fixes. */
{
  const fake = '<style>.a{display:flex}.b[hidden]{display:none}.b{color:red}</style>' +
               '<div class="a" hidden></div><div class="b" hidden></div>';
  is('it sees a plain display rule',        displayRules(fake, '.a').length, 1);
  is('it ignores a [hidden]-qualified one', displayRules(fake, '.b'), []);
  is('and it reads both elements as controlled',
     controlled(fake).sort(), ['.a', '.b']);
  is('an element with no display rule is not reported',
     displayRules('<style>.c{color:red}</style><div class="c" hidden></div>', '.c'), []);
}

console.log('\nelements whose visibility rides on [hidden] with a display rule:');
found.forEach(f => console.log('  ' + f));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
