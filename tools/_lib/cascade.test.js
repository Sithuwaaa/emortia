/* cascade.test.js - the resolver agrees with a real browser.

   pin.test.js is only worth its output if cascade.js resolves the way a
   browser does. These are known answers: every value below was read with
   getComputedStyle on the rendered page at localhost, both themes, on
   12 November 2026, and pasted here unchanged.

   TWO REAL BUGS WERE FOUND THIS WAY, neither by reading the code:

     - it returned the winning DECLARATION, so --badT came back as
       "var(--bad, #e2607a)" where Chrome said #ff7d92. It now follows
       var() to a real value.
     - it did not inherit custom properties, so resolving a var() used on a
       button refused with "--bad is never set" while Chrome painted the
       button #e2607a. Custom properties inherit; the lookup now walks from
       the element up to the root.

   Both would have made pin.test.js either useless or confusing. If this
   file ever fails, do not adjust the numbers to match - re-read them off
   the page, because either the resolver or the page has changed and which
   one matters. */

const path = require('path');
const C = require('./cascade.js');

const ROOT = path.join(__dirname, '..', '..');
const page = t => path.join(ROOT, 'tools', t, 'index.html');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};
/* Chrome reports colours as rgb(); the stylesheets write hex. Compare in
   Chrome's shape so the known answers can be pasted exactly as read. */
const asRGB = v => {
  const m = String(v).trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return String(v).trim();
  const n = parseInt(m[1], 16);
  return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')';
};

/* ---- getComputedStyle(document.documentElement), as read ------------- */
const ROOTVALS = {
  'materials|dark': { '--accent': '#81D67B', '--accentB': '#A2E59C', '--accentT': '#A2E59C',
    '--accentD': '#569252', '--accent-ink': '#071307', '--bad': '#e2607a', '--badInk': '#2b0f16',
    '--badT': '#e2607a', '--okT': '#34c98b', '--bar': '#142C1F', '--card': 'rgba(20,44,31,.72)' },
  'materials|light': { '--accent': '#006400', '--accentB': '#006400', '--accentT': '#006400',
    '--accentD': '#004E00', '--accent-ink': '#FFFFFF', '--bad': '#c2405c', '--badInk': '#ffffff',
    '--badT': '#BE3C59', '--okT': '#006e44', '--bar': '#D0F4DE', '--card': 'rgba(208,244,222,.80)' },
  'wh24|dark': { '--accent': '#81D67B', '--accentB': '#A2E59C', '--accentT': '#A2E59C',
    '--accentD': '#569252', '--accent-ink': '#071307', '--badT': '#ff7d92', '--okT': '#34c98b',
    '--bar': '#142C1F', '--card': 'rgba(20,44,31,.72)' },
  'wh24|light': { '--accent': '#006400', '--accentB': '#006400', '--accentT': '#006400',
    '--accentD': '#004E00', '--accent-ink': '#FFFFFF', '--badT': '#BE3C59', '--okT': '#006e44',
    '--bar': '#D0F4DE', '--card': 'rgba(208,244,222,.80)' },
};

console.log('--- custom properties on <html>, against getComputedStyle ---');
for (const key of Object.keys(ROOTVALS)) {
  const [tool, theme] = key.split('|');
  const sheets = C.sheetsFor(page(tool));
  const attrs = { 'data-cat': 'design', 'data-look': 'leaf' };
  if (theme === 'light') attrs['data-theme'] = 'light';
  const html = [{ tag: 'html', attrs, classes: [] }];
  for (const [prop, want] of Object.entries(ROOTVALS[key])) {
    let got;
    try { const r = C.resolve(sheets, html, prop); got = r ? r.value : '(unset)'; }
    catch (e) { got = 'REFUSED: ' + e.message; }
    is(tool + ' ' + theme + ' ' + prop, got, want);
  }
}

/* ---- a descendant, which is where inheritance mattered --------------- */
const SEG = {
  'dark':  { background: 'rgb(226, 96, 122)', color: 'rgb(43, 15, 22)' },
  'light': { background: 'rgb(194, 64, 92)',  color: 'rgb(255, 255, 255)' },
};
console.log('\n--- the chosen Disposed segment, against getComputedStyle ---');
{
  const sheets = C.sheetsFor(page('materials'));
  for (const theme of Object.keys(SEG)) {
    const attrs = { 'data-cat': 'design', 'data-look': 'leaf' };
    if (theme === 'light') attrs['data-theme'] = 'light';
    const chain = [{ tag: 'html', attrs, classes: [] },
                   { tag: 'div', classes: ['seg'], attrs: {} },
                   { tag: 'button', classes: ['on', 'bad'], attrs: {} }];
    for (const [prop, want] of Object.entries(SEG[theme])) {
      let got;
      try { const r = C.resolve(sheets, chain, prop); got = r ? asRGB(r.value) : '(unset)'; }
      catch (e) { got = 'REFUSED: ' + e.message; }
      is('materials ' + theme + ' .seg button.on.bad ' + prop, got, want);
    }
  }
}

/* ---- the mechanics, so a wrong answer says which part is wrong ------- */
console.log('\n--- specificity and order ---');
is('an attribute counts as a class', C.specificity('html[data-cat]'), [0, 1, 1]);
is('two attributes beat one', C.specificity('html[data-cat][data-look="leaf"]'), [0, 2, 1]);
is(':not() contributes its argument',
   C.specificity('html[data-look="leaf"]:not([data-theme="light"])'), [0, 2, 1]);
is('a descendant adds up', C.specificity('html[data-look="leaf"] .seg button.on.bad'), [0, 4, 2]);

const el = [{ tag: 'html', attrs: { 'data-cat': 'design', 'data-look': 'leaf' }, classes: [] }];
is('matches on attribute value', C.matchSelector('html[data-look="leaf"]', el), true);
is('and refuses the wrong value', C.matchSelector('html[data-look="plain"]', el), false);
is(':not() excludes', C.matchSelector('html:not([data-theme="light"])', el), true);
const lit = [{ tag: 'html', attrs: { 'data-cat': 'design', 'data-theme': 'light' }, classes: [] }];
is('and admits', C.matchSelector('html:not([data-theme="light"])', lit), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
