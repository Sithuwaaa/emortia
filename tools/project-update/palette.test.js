/* node tools/project-update/palette.test.js

   EVERY BUCKET COLOUR MUST SURVIVE BEING READ, IN BOTH THEMES.

   The eleven status hues are used four ways: the KPI tile's 3px rule, its
   34px/800 number, the By status bar fills, and the chips in the data
   table. The chip is the strict one and the only one this file checks,
   because clearing it clears the rest:

       12px/600 text in the colour,
       on background:color-mix(in srgb, <colour> 10%, transparent)
       over the PANEL - which is --p-solid composited over the
       photograph now, not the flat --card it used to be,
       which needs 4.5:1.

   The tint is made FROM the colour, so as the ink darkens the fill darkens
   with it and the gap closes more slowly than against a fixed background.
   That is why eight of eleven failed in light mode before this existed.

   WHY THIS TEST READS THE BUCKETS ARRAY RATHER THAN THE STYLESHEET.

   The colour does not reach the element as a literal. BUCKETS[].c is
   written into an inline style as --k or --c, and the CSS only ever says
   color:var(--k). The site-wide guard in family.test.js looks for literal
   token usages like color:var(--ok), so it cannot see a colour that
   arrives through an inline custom property - which is exactly how this
   tool's stat row was missed when the fill/text split went through.

   So this file starts from the list of colours instead of from the usage,
   and a twelfth bucket is checked the moment it is added. */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
/* comments are not CSS and are not JavaScript - prose inside one has
   matched a selector pattern before now and dragged the wrong values in */
const BARE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- colour, from the shared harness --------------------------------
   This file used to carry its own hex reader and its own ratio. So did
   every ad-hoc measurement in the browser, and one of those read
   color(srgb 0.93 0.44 0.49) as a 0-to-255 triple twice in three weeks.
   There is one implementation now, it refuses what it cannot normalise,
   and tools/_lib/contrast.test.js proves it refuses. */
const C = require(path.join(__dirname, '..', '_lib', 'contrast.js'));
const h2 = h => C.parse(h).rgb;
const CR = C.ratio;
/* The chip is 10% of the colour over whatever is behind it. Both halves of
   that sentence changed when the panels became glass: the tint dropped from
   15%, and "behind it" stopped being --card.

   This lerp is a MODEL of what the browser paints. It was checked against
   the real thing - chips built from this stylesheet, read back through a
   1x1 canvas so the serialisation cannot be misread, and composited by the
   engine - and it agrees to within 0.03.

   AND THE PERCENTAGE IS READ OUT OF THE RULE, not restated here. It was
   written as a literal 0.10 for about ten minutes, and in those ten
   minutes putting the tint back to 15% left this file green - because the
   model no longer had anything to do with the stylesheet. The same shape
   as every other near miss in this repository: the test agreed with
   itself. There are two .chip rules in the sheet now, the original and
   the restyle, so the LAST one is the one that wins and the one read. */
const chipRules = [...BARE.matchAll(
  /\.chip\s*\{[^}]*?background:\s*color-mix\(in\s+([a-z]+)\s*,\s*var\(--c\)\s*([\d.]+)%/g)];
if (!chipRules.length) throw new Error('no .chip background mix found - cannot model the chip');
const MIXSPACE = chipRules[chipRules.length - 1][1];
const MIX = parseFloat(chipRules[chipRules.length - 1][2]) / 100;
if (!(MIX > 0 && MIX < 1)) throw new Error('nonsense mix percentage: ' + MIX);
console.log('the chip, as the stylesheet declares it: color-mix(in ' + MIXSPACE +
            ', <colour> ' + (MIX * 100) + '%, transparent)');
const chip = (c, card) => CR(c, C.over(c, MIX, card));

/* ---- the tokens, from BOTH places, in the order the browser resolves them

   THIS IS THE PART THAT WAS WRONG FIRST TIME, and it is worth the words.
   The tool declares --card and --muted in its own <style>, but
   category.css loads last and redeclares them !important for the tool's
   family. index.html alone gives --card #142428 and --muted #5f7b81; the
   page actually paints #2D1406 and #776558. Measuring a chip against a
   card the page never paints is worse than not measuring it at all.

   So the tool's own block first, then category.css for this family over
   the top - which is the cascade. The status hues are tool-local and
   survive it; the surfaces and --muted come from category.css. */
const CAT = fs.readFileSync(path.join(__dirname, '..', '_lib', 'category.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');
const FAMILY = (/<html[^>]*data-cat="([a-z-]+)"/.exec(SRC) || [])[1];
if (!FAMILY) throw new Error('no data-cat on <html> - cannot know which family governs');

/* EVERY matching block, in source order, later ones winning - which is the
   cascade. This read only the first one until 27 October, and that was a
   blind spot rather than a simplification: --chip-under is declared in a
   second :root block further down the sheet, and a test that stops at the
   first block reports a token as missing when the browser can see it
   perfectly well.

   AND THE BLOCK IS FOUND BY WALKING BRACES, not by looking for a closing
   brace at the start of a line. The old terminator was /\n\s*\}/, which
   depends on how the author happened to format the sheet: a block that
   closes with `--chip-under:#0b182c}` on one line does not match, so the
   scan ran on into the NEXT block and read the light value while claiming
   to report the dark one. It printed eleven confident failures that were
   not real. A brace walk cannot do that. */
const declsOf = (src, re, what) => {
  const starts = [...src.matchAll(new RegExp(re.source.replace(/\\\{[\s\S]*$/, '') + '\\s*\\{', 'g'))];
  if (!starts.length) throw new Error('no ' + what + ' found');
  const out = {};
  for (const m of starts) {
    let i = m.index + m[0].length, depth = 1;
    for (; i < src.length && depth; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    const body = src.slice(m.index + m[0].length, i - 1);
    for (const d of body.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) out[d[1]] = d[2];
  }
  return out;
};

function tokensOf(theme) {
  /* this tool is dark-first: dark values on a bare :root, light under
     html[data-theme="light"]. A wrong selector throws rather than quietly
     reading an empty block, which is the point of throwing. */
  const own = declsOf(BARE, theme === 'dark'
      ? /:root\s*\{([\s\S]*?)\n\s*\}/
      : /html\[data-theme="light"\]\s*\{([\s\S]*?)\n\s*\}/,
    theme + ' block in index.html');
  const cat = declsOf(CAT, theme === 'dark'
      ? new RegExp('html\\[data-cat="' + FAMILY + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}')
      : new RegExp('html\\[data-cat="' + FAMILY + '"\\]\\[data-theme="light"\\]\\s*\\{([\\s\\S]*?)\\n\\}'),
    theme + ' block for family "' + FAMILY + '" in category.css');
  return Object.assign({}, own, cat);   /* category.css is !important, so it wins */
}

/* ---- the bucket list, read from the source of truth ---- */
function buckets() {
  const m = /const BUCKETS = \[([\s\S]*?)\n\];/.exec(BARE);
  if (!m) throw new Error('BUCKETS array not found');
  const rows = [];
  for (const b of m[1].matchAll(/label:'([^']+)'[^}]*?c:'([^']+)'/g))
    rows.push({ label: b[1], c: b[2] });
  return rows;
}

const B = buckets();
console.log('\nthe bucket list');
is('all eleven buckets are read', B.length, 11);

/* THE RULE THAT CAUSED ALL OF THIS */
const literals = B.filter(b => /^#/.test(b.c));
is('NO BUCKET COLOUR IS A HEX LITERAL - every one is a token',
   literals.map(b => b.label + ' ' + b.c), []);
is('and every one is a var()', B.every(b => /^var\(--[a-z0-9-]+\)$/.test(b.c)), true);

for (const theme of ['dark', 'light']) {
  const tok = tokensOf(theme);
  /* NOT --card any more. A panel is --p-solid composited over the
     photograph, so --chip-under carries the binding end of the range that
     was measured across the whole scene on the rendered page. */
  const card = h2(tok['chip-under']);
  console.log('\n' + theme + '  behind a chip: ' + tok['chip-under']);
  for (const b of B) {
    const name = b.c.replace(/^var\(--|\)$/g, '');
    const hex = tok[name];
    is(theme + ' --' + name + ' is declared', !!hex, true);
    if (!hex) continue;
    const r = chip(h2(hex), card);
    const ok = r >= 4.5;
    if (!ok) console.log('      ' + b.label + '  ' + hex + '  chip ' + r);
    is(theme + ' ' + b.label + ' clears 4.5 as a chip (' + hex + ' = ' + r + ')', ok, true);
  }
}

/* the big number is large text at 3:1 - clearing the chip clears it, but
   assert it rather than assume the relationship holds for a future hue */
console.log('\nthe KPI number, 34px/800, needs only 3:1');
for (const theme of ['dark', 'light']) {
  const tok = tokensOf(theme), card = h2(tok['chip-under']);
  for (const b of B) {
    const hex = tok[b.c.replace(/^var\(--|\)$/g, '')];
    if (!hex) continue;
    is(theme + ' ' + b.label + ' big number clears 3', CR(h2(hex), card) >= 3, true);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
