/* pin.test.js - the accent family survives every stylesheet a page loads.

   THE HOLE THIS CLOSES. family.test.js enforces the pin by reading a tool's
   index.html, access.js, category.css and theme.css. It never opens a _lib
   stylesheet. On 11 November that was recorded as a blind spot; on 12
   November it bit, on live code: a design bundle's leaf-glass.css set
   --accent, --accentB, --accentT, --accentD and --accent-ink with
   !important, and 2,816 assertions stayed green. Only reading the file
   before copying it stopped three regressions shipping.

   WHAT THIS ASSERTS, and why it is a different question. Not "does any file
   say the wrong thing" - that is a grep, and a grep has to know where to
   look, which is exactly what failed. This asks what the PAGE ENDS UP WITH:
   every stylesheet it loads, in load order, resolved by !important then
   specificity then source order. An override is caught wherever it lives,
   because this never asks where a declaration came from, only which one
   wins.

   THE PIN IS NOT HARDCODED HERE. It is read from category.css by resolving
   the same property against the same page with the sheets AFTER category.css
   removed. So this compares the page's answer to the family's answer, and
   changing the family's colours on purpose does not break it - only
   something overriding them does. That is the property, not the value.

   THE RESOLVER IS CHECKED AGAINST A BROWSER. cascade.test.js holds 44
   answers taken from getComputedStyle on the two rendered leaf pages in both
   themes. Two real bugs were found that way and not by reading the code: it
   did not follow var(), and it did not inherit custom properties down to a
   descendant. A guard built on a resolver nobody checked would be the same
   mistake one level down. */

const fs = require('fs');
const path = require('path');
const C = require('./cascade.js');
const { ratio, parse } = require('./contrast.js');

const ROOT = path.join(__dirname, '..', '..');
const TOOLS = path.join(ROOT, 'tools');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

const FAMILY = ['--accent', '--accentB', '--accentT', '--accentD', '--accent-ink'];

/* every tool page that has a category and loads category.css */
const tools = fs.readdirSync(TOOLS)
  .filter(t => fs.existsSync(path.join(TOOLS, t, 'index.html')))
  .map(t => {
    const src = fs.readFileSync(path.join(TOOLS, t, 'index.html'), 'utf8');
    const cat = (src.match(/<html[^>]*data-cat="([a-z]+)"/) || [])[1];
    const look = (src.match(/<html[^>]*data-look="([a-z]+)"/) || [])[1] || null;
    return { tool: t, cat, look };
  })
  .filter(r => r.cat);

is('every tool page carries a category', tools.length, 17);

console.log('\n--- the accent family is category.css\'s, on every page, in both themes ---');
for (const { tool, cat, look } of tools) {
  const page = path.join(TOOLS, tool, 'index.html');
  const sheets = C.sheetsFor(page);
  const catAt = sheets.findIndex(s => /category\.css$/.test(s.name));
  is(tool + ' loads category.css', catAt >= 0, true);
  if (catAt < 0) continue;
  /* the family's own answer: nothing after category.css gets a say */
  const upToFamily = sheets.slice(0, catAt + 1);

  for (const theme of ['dark', 'light']) {
    const attrs = { 'data-cat': cat };
    if (look) attrs['data-look'] = look;
    if (theme === 'light') attrs['data-theme'] = 'light';
    const html = [{ tag: 'html', attrs, classes: [] }];

    for (const prop of FAMILY) {
      let pinned, actual;
      try { pinned = C.resolve(upToFamily, html, prop); actual = C.resolve(sheets, html, prop); }
      catch (e) { is(tool + ' ' + theme + ' ' + prop + ' resolves', 'REFUSED: ' + e.message, 'a value'); continue; }
      if (!pinned) { is(tool + ' ' + theme + ' ' + prop + ' is pinned by category.css', false, true); continue; }
      is(tool + ' ' + theme + ' ' + prop + ' is still the family\'s',
         actual ? actual.value : '(unset)', pinned.value);
    }
  }
}

/* ---- the two other things the bundle would have taken back ----------

   These are not the accent pin, but they went the same way and for the same
   reason: a shared stylesheet is where they live, and nothing was looking at
   one. Both are asserted on the resolved result for the same reason. */

console.log('\n--- a filled primary button is the accent, not a literal ---');
{
  /* THIS ASSERTION EXISTS BECAUSE IT CAUGHT ME. On 11 November the four
     hardcoded #0B6B2A literals on the light buttons were pointed at
     var(--accent), so the page showed one green instead of two. On 12
     November a newer bundle brought the literals back and the merge
     re-applied three fixes but not that one - it had been a separate
     commit. The accent token itself was fine, so nothing above caught it;
     the regression was in a rule, not a token. Only measuring the rendered
     button found it: 6.67 on rgb(11,107,42) beside a segment at 7.44 on
     rgb(0,100,0).

     So the question is asked of the thing itself: whatever paints a filled
     primary button, does it come out as the family's accent. */
  for (const [tool, sel] of [['materials', ['cpb', 'primary']], ['wh24', ['btn', 'pri']]]) {
    const sheets = C.sheetsFor(path.join(TOOLS, tool, 'index.html'));
    for (const theme of ['dark', 'light']) {
      const attrs = { 'data-cat': 'design', 'data-look': 'leaf' };
      if (theme === 'light') attrs['data-theme'] = 'light';
      const html = { tag: 'html', attrs, classes: [] };
      const chain = [html, { tag: 'button', classes: sel, attrs: {} }];
      let got, want;
      try {
        const g = C.resolve(sheets, chain, 'background');
        got = g ? g.value : '(unset)';
        want = C.resolve(sheets, [html], '--accent').value;
      } catch (e) { got = 'REFUSED: ' + e.message; want = 'a value'; }
      is(tool + ' ' + theme + ' .' + sel.join('.') + ' is filled with the accent', got, want);
    }
  }
}

console.log('\n--- the status ink on a leaf panel clears the floor ---');
{
  /* Measured on the rendered page, not derived: the worst ground an Active
     chip sits on with the light leaf panel at .80 over the photograph, read
     through the panel's own backdrop-filter at the scroll position that
     reaches the brightest part. If the photo or the panel alpha changes this
     number has to be measured again - it is an observation, not a constant. */
  const GROUND_LIGHT = 'rgb(219,231,220)';
  const FLOOR = 4.5;
  for (const tool of ['materials', 'wh24']) {
    const sheets = C.sheetsFor(path.join(TOOLS, tool, 'index.html'));
    const html = [{ tag: 'html', attrs: { 'data-cat': 'design', 'data-look': 'leaf', 'data-theme': 'light' }, classes: [] }];
    const okT = C.resolve(sheets, html, '--okT');
    is(tool + ' light --okT is set', !!okT, true);
    if (!okT) continue;
    const r = +ratio(parse(okT.value).rgb, parse(GROUND_LIGHT).rgb).toFixed(2);
    is(tool + ' light --okT clears ' + FLOOR + ' on the leaf panel (' + r + ')', r >= FLOOR, true);
  }
}

console.log('\n--- Disposed is a state, so the filter is red, not the accent ---');
{
  const sheets = C.sheetsFor(path.join(TOOLS, 'materials', 'index.html'));
  for (const theme of ['dark', 'light']) {
    const attrs = { 'data-cat': 'design', 'data-look': 'leaf' };
    if (theme === 'light') attrs['data-theme'] = 'light';
    const html = { tag: 'html', attrs, classes: [] };
    const chain = [html, { tag: 'div', classes: ['seg'], attrs: {} },
                         { tag: 'button', classes: ['on', 'bad'], attrs: {} }];
    const plain = [html, { tag: 'div', classes: ['seg'], attrs: {} },
                         { tag: 'button', classes: ['on'], attrs: {} }];
    const bad = C.resolve(sheets, chain, 'background');
    const acc = C.resolve(sheets, plain, 'background');
    const wantBad = C.resolve(sheets, [html], '--bad');
    const wantAcc = C.resolve(sheets, [html], '--accent');
    is('materials ' + theme + ' the chosen Disposed segment is --bad',
       bad ? bad.value : '(unset)', wantBad.value);
    is('materials ' + theme + ' and is NOT the accent',
       bad && bad.value === wantAcc.value, false);
    is('materials ' + theme + ' while any other chosen segment is the accent',
       acc ? acc.value : '(unset)', wantAcc.value);
    const ink = C.resolve(sheets, chain, 'color');
    const wantInk = C.resolve(sheets, [html], '--badInk');
    is('materials ' + theme + ' and its ink is --badInk',
       ink ? ink.value : '(unset)', wantInk.value);
    const r = +ratio(parse(ink.value).rgb, parse(bad.value).rgb).toFixed(2);
    is('materials ' + theme + ' which clears 4.5 on that fill (' + r + ')', r >= 4.5, true);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
