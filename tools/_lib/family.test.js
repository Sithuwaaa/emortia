/* node tools/_lib/family.test.js

   ONE FACT, ONE PLACE: which family a tool belongs to.

   THE BUG THIS EXISTS FOR

   Every tool page used to define its own --accent, picked with nothing tying
   it to the shelf the tool sits on. So Material Codes and the GIN Extractor
   showed dark maroon on the directory and opened GREEN - two places holding
   what should be one fact, drifting the moment either was edited. The same
   shape as rowsFor's hand-copied field lists, which dropped `title` from
   every PH2 row.

   access.js is the source of truth for a tool's group. These assertions tie
   the three places that have to agree to it:

     1. the group in access.js FEATURES
     2. the data-cat on the tool page's <html>
     3. the category block in tools/_lib/category.css

   and refuse the thing that caused it: a tool defining an accent of its own.

   category.css was designed in Claude Design and is copied in byte for byte -
   SHA-256 checked against the source, not eyeballed. The five blocks that
   briefly lived in nav.css are gone: two stylesheets holding the same five
   facts is the very thing this file exists to prevent.

   No browser and no network - this reads the files. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TOOLS = path.join(ROOT, 'tools');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- the source of truth, read out of access.js itself ---- */
const ACCESS = fs.readFileSync(path.join(TOOLS, '_lib/access.js'), 'utf8');
const FEATURES = [];
{
  const rx = /\{\s*key:'tool:([a-z0-9-]+)'[^}]*?group:'([^']+)'/g;
  let m;
  while ((m = rx.exec(ACCESS))) FEATURES.push({ key: m[1], group: m[2] });
}
is('every tool in access.js was found', FEATURES.length, 16);

/* group name -> the family key used in CSS. The one place the two
   vocabularies meet, and it is five lines rather than sixteen. */
const FAMILY_OF = {
  'Design & materials': 'design',
  'Emortia':            'emortia',
  'Field operations':   'field',
  'People & work':      'people',
  'Site intelligence':  'site'
};
/* The feature key is not always the folder name. */
const FOLDER = { 'whattodo': 'whattodo', 'lyric-video': 'lyric-video' };

const NAV = fs.readFileSync(path.join(TOOLS, '_lib/category.css'), 'utf8');

/* ---- 0. the DESIGNED VALUES are exactly what the design project published

   category.css was fetched from Claude Design, not retyped, and checked by
   SHA-256 on arrival. This keeps it that way: comments may be added - one
   already has been, explaining why a 4.39 contrast is correct for its role -
   but not one colour may move without this failing and saying so.

   Hash is over the declarations with every comment and all whitespace
   stripped, so prose is free and values are frozen. */
{
  const crypto = require('crypto');
  const values = NAV.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  is('not one colour has moved since the palette was signed off',
     crypto.createHash('sha256').update(values).digest('hex'),
     '9c51437dae420df42eab877757b9a859efa1a20c76a2613f2d82a1255b15ac1e');
  /* The five identities, verbatim, so a "tidy-up" cannot quietly round one.
     In dark these ARE --accentT; in light they survive only in --glow. */
  for (const [cat, pick] of [['design','#d0f4de'], ['emortia','#ff99c8'],
                             ['field','#a9def9'], ['people','#e4c1f9'], ['site','#fcf6bd']])
    is(cat + ' still wears ' + pick,
       new RegExp('data-cat="' + cat + '"\\]\\{[^}]*--accentT:' + pick + '\\b', 'i').test(NAV), true);
  is('and the reason !important is here is written down',
     /!important, AND THAT IS DELIBERATE/.test(NAV), true);
}

/* ---- 1. category.css defines all five categories, in both themes ---- */
console.log('--- category.css holds the five categories ---');
for (const fam of Object.values(FAMILY_OF)) {
  is(fam + ' has a dark block',
     new RegExp('html\\[data-cat="' + fam + '"\\][^{]*\\{[^}]*--accent:').test(NAV), true);
  is(fam + ' has a light block',
     new RegExp('html\\[data-cat="' + fam + '"\\]\\[data-theme="light"\\]\\{[^}]*--accent:').test(NAV), true);
}

/* ---- 2. every tool declares its family, and it is the right one ---- */
console.log('\n--- every tool wears its own family ---');
const mapping = [];
for (const f of FEATURES) {
  const folder = FOLDER[f.key] || f.key;
  const file = path.join(TOOLS, folder, 'index.html');
  if (!fs.existsSync(file)) { fail++; console.log('FAIL no page for ' + f.key); continue; }
  const src = fs.readFileSync(file, 'utf8');
  const want = FAMILY_OF[f.group];
  const m = src.match(/<html[^>]*\sdata-cat="([a-z]+)"/);
  mapping.push({ tool: folder, group: f.group, family: want, found: m && m[1] });
  is(folder + ' is ' + f.group, m && m[1], want);
}

/* ---- 3. the thing that caused the bug cannot come back ---- */
console.log('\n--- no tool defines a colour of its own ---');
const OWN = /--(accent-ink|accentB|accentD|accent|glowSoft|glow|ink)\s*:/;
for (const row of mapping) {
  const src = fs.readFileSync(path.join(TOOLS, row.tool, 'index.html'), 'utf8');
  const hits = (src.match(new RegExp(OWN.source, 'g')) || []);
  is(row.tool + ' defines no accent of its own', hits, []);
}

/* ---- 3b. no tool holds a CHROME colour category.css cannot reach ----

   Removing --accent was not enough and neither was !important. A token
   category.css does not NAME is a token it cannot govern however loudly it
   declares, and those are invisible: site-access stayed entirely blue on a
   gold ground, --card2 was a typo of --card-2 in two tools, and --goHover
   followed the accent in dark while holding an old-palette literal in light,
   which is why reading only the dark value made it look fine.

   So the rule is by NAME, not by value: every colour custom property a tool
   declares must be one category.css governs, or be on the status list - a
   colour that carries meaning and is nobody else's to change. */
console.log('\n--- no ungoverned chrome anywhere ---');
{
  const GOVERNED = new Set([...NAV.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map(m => m[1]));
  /* Colours that MEAN something. They keep their own values on purpose:
     a status chip, a zebra stripe, the jumper chart's own fills, and the
     swatch outline that separates an arbitrary colour from the card. */
  const STATUS = /^(ok|warn|bad|err|info|wip|idle|zebra|rowhover|swatchEdge|c-[a-z]+|holPoya|holPub|sa-(ok|okBg|warn|warnBg|shadow))$/;
  /* holPoya and holPub are the two dots on the attendance calendar: a Poya
     day and a public holiday. Which kind of holiday a day is is not something
     a category gets a say in, so they are status and keep their own colours.
     --c-* are the jumper chart's own fills - the cable colours themselves -
     and swatchEdge is what keeps a black one from vanishing into the card. */
  /* ONLY the <style> blocks, and only a rule body found by walking braces
     from its own selector. The first version of this scanned the whole HTML
     with a naive /\{([^{}]*)\}/ - which runs straight through the page's
     JavaScript, where the braces do not pair the way CSS braces do, so the
     capture boundaries drifted and the loop never saw the tokens it was
     looking for. It reported every tool clean. It was not reading them. */
  const themeBlocks = src => {
    const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    const sel = /(^|[};])\s*((?::root|html\[data-theme="[a-z]+"\])[^{};]*)\{/g;
    let m;
    while ((m = sel.exec(css))) {
      let i = sel.lastIndex, depth = 1;
      while (i < css.length && depth) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
      out.push(css.slice(sel.lastIndex, i - 1));
    }
    return out;
  };
  const left = [];
  let scanned = 0;
  for (const row of mapping) {
    const src = fs.readFileSync(path.join(TOOLS, row.tool, 'index.html'), 'utf8');
    const props = new Set();
    for (const body of themeBlocks(src)) {
      scanned++;
      for (const d of body.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;}]*)/g))
        if (/#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i.test(d[2])) props.add(d[1]);
    }
    for (const p of [...props].sort())
      if (!GOVERNED.has(p) && !STATUS.test(p)) left.push(row.tool + ' --' + p);
  }
  /* A SCAN THAT READS NOTHING PASSES EVERYTHING. Assert it found the blocks
     before believing what it says about them. */
  is('the scan actually found theme blocks to read', scanned >= 20, true);
  is('every colour token in all sixteen is governed or is status', left, []);
  /* And the rule has teeth: a name that is neither would be caught. */
  is('an invented chrome token would be caught',
     !GOVERNED.has('cardX') && !STATUS.test('cardX'), true);
  is('while a status one would not', STATUS.test('swatchEdge') && STATUS.test('ok'), true);
}

/* ---- 3c. every tool opens in light ----

   Fourteen of the sixteen decide their own startup theme, in three different
   shapes, and four of those asked the operating system - so the same tool
   greeted two people differently and neither had chosen it. One default now,
   and nothing may fall back to dark. */
console.log('\n--- every tool opens light ---');
{
  const DARK_DEFAULT = [
    /matches\s*\?\s*'dark'\s*:\s*'light'/,            /* the OS deciding */
    /\|\|\s*'dark'/,                                   /* a bare fallback */
    /=\s*'dark';\s*try/                                /* the two-step form */
  ];
  const offenders = [];
  for (const row of mapping) {
    const src = fs.readFileSync(path.join(TOOLS, row.tool, 'index.html'), 'utf8');
    for (const rx of DARK_DEFAULT) if (rx.test(src)) offenders.push(row.tool + '  ' + rx.source);
  }
  is('no tool falls back to dark at startup', offenders, []);

  const ACC = fs.readFileSync(path.join(TOOLS, '_lib/access.js'), 'utf8');
  is('and the shared default is light', /THEME_DEFAULT\s*=\s*'light'/.test(ACC), true);
  is('the one-time reset is there, so a stored dark does not outlive it',
     /em-theme-default-light/.test(ACC), true);
  /* The account menu writes every key shape the tools use. It used to match
     only *.theme, which missed office_tool_theme - six tools - so switching
     from the menu did not reach them and they reverted on their next load. */
  is('and the menu reaches office_tool_theme as well as *.theme',
     /\\\.theme\$\|_theme\$/.test(ACC), true);
  /* Sensitivity: the patterns must actually fire on the shapes they name. */
  is('the dark-default check would catch all three shapes',
     DARK_DEFAULT.map(rx => rx.test("x = matches ? 'dark' : 'light'") ||
                            rx.test("x = localStorage.getItem(K) || 'dark'") ||
                            rx.test("let t = 'dark'; try { }")),
     [true, true, true]);
}

/* ---- 3d. no tool reads a token that nothing defines ----

   THE QUIETEST FAILURE IN CSS. var(--x) where --x is undefined does not warn,
   does not fall back to anything sensible, and does not even leave the
   property alone - it makes the declaration invalid at computed-value time,
   so the element inherits instead.

   On WH24 that meant `background:var(--accent); color:var(--ink)` - with
   --ink gone, the label inherited parchment --text and sat on a mint fill.
   The Sync button, the active filter tab and the source chip all had
   unreadable labels, and nothing anywhere reported a problem.

   --ink existed while a generated category.css happened to define it; the
   design's file defines --accent-ink and not --ink, so removing the tools'
   own copies left 16 references pointing at nothing. The others - --dim,
   --mute, --text2, --line2 - were borrowed from the site palette in
   index.html, which a tool page does not load, and had never resolved.

   A var() WITH a fallback is fine and is skipped: that is a deliberate
   default, not an accident. */
console.log('\n--- every token a tool reads is defined somewhere ---');
{
  const sheets = ['category.css', 'theme.css', 'nav.css', 'motion.css', 'lookup.css']
    .map(f => path.join(TOOLS, '_lib', f)).filter(p => fs.existsSync(p))
    .map(p => fs.readFileSync(p, 'utf8')).join('\n');
  const names = s => new Set([...s.matchAll(/--([a-zA-Z0-9_-]+)\s*:/g)].map(m => m[1]));
  const shared = names(sheets);
  is('the shared stylesheets were actually read', shared.size > 10, true);

  const dangling = [];
  for (const row of mapping) {
    const src = fs.readFileSync(path.join(TOOLS, row.tool, 'index.html'), 'utf8');
    const own = names(src);
    for (const m of src.matchAll(/var\(\s*--([a-zA-Z0-9_-]+)\s*([,)])/g)) {
      if (m[2] === ',') continue;                       /* has a fallback */
      if (!own.has(m[1]) && !shared.has(m[1])) dangling.push(row.tool + ' --' + m[1]);
    }
  }
  is('no tool reads an undefined custom property', [...new Set(dangling)], []);
  /* Sensitivity: the check must see a name that is genuinely absent. */
  is('and it would notice one', shared.has('definitely-not-a-token'), false);
}

/* ---- 4. and they all load the same stylesheet, at the same version ----

   A cache-buster that moves on some pages and not others is how half the
   suite shows the new colour and half shows the old one. */
console.log('\n--- one stylesheet, one version ---');
for (const sheet of ['nav', 'category']) {
  const vers = new Set(), order = [];
  for (const row of mapping) {
    const src = fs.readFileSync(path.join(TOOLS, row.tool, 'index.html'), 'utf8');
    const m = src.match(new RegExp('_lib\\/' + sheet + '\\.css\\?v=(\\d+)'));
    vers.add(m ? m[1] : 'MISSING');
    /* The LINK TAGS, not the first mention of the name anywhere in the file -
       a comment in a tool's own stylesheet that says "category.css" is not a
       load order, and the loose version of this check read one as one. */
    if (sheet === 'category') {
      const links = [...src.matchAll(/<link[^>]+_lib\/(nav|category)\.css/g)].map(x => x[1]);
      order.push(links.indexOf('nav') >= 0 && links.indexOf('category') > links.indexOf('nav'));
    }
  }
  is('every tool loads ' + sheet + '.css at one and the same version', [...vers].length, 1);
  is('and ' + sheet + '.css is missing from none of them', [...vers][0] !== 'MISSING', true);
  /* ORDER MATTERS. category.css has to come after nav.css or the category
     never gets the last word on a token both of them set. */
  if (sheet === 'category')
    is('and it is loaded AFTER nav.css in every one', order.every(Boolean), true);
}

/* ---- 5. the directory agrees with the tools ----
   index.html groups a card by the SAME access.js group, through FAMILY. */
console.log('\n--- the directory uses the same five keys ---');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const [group, fam] of Object.entries(FAMILY_OF)) {
  is('the directory maps ' + group + ' to ' + fam,
     new RegExp('"' + group.replace('&', '&') + '":\\s*\\{[^}]*"key":\\s*"' + fam + '"').test(INDEX), true);
  is('and .tgrp-' + fam + ' exists', INDEX.includes('.tgrp-' + fam + '{'), true);
  /* ONE .tgrp- RULE PER FAMILY. The old set was ordered differently, so a
     splice that replaced up to .tgrp-emortia left field, people and site
     behind - and being later in the file they won, silently. */
  is('exactly once, not shadowed by a leftover',
     (INDEX.match(new RegExp('^\\.tgrp-' + fam + '\\{', 'gm')) || []).length, 1);
}

/* ---- 6. the directory wears the same five colours as the tools ----

   index.html carries its OWN .tool- and .tgrp- blocks - a different token shape
   from category.css, because its ground is the burgundy page rather than a
   tool's. They are two files, so they are two chances to disagree: the
   directory sat on the old maroon set for a day after the tools had moved.
   Different tokens, same five anchors, asserted. */
/* THE SAME HUE, NOT THE SAME HEX. The directory sits on the burgundy page
   rather than a tool's own ground, and the pastel at full strength was a lamp
   there - 9.7 to 17.3 against #170d10, where the band the page was designed
   around was 1.7. So the directory carries a dimmed tone of each family. What
   must hold is that it is the SAME COLOUR, dimmer - which is a statement
   about hue, and asserting the hex would only have forced the brightness
   back. */
console.log('\n--- the directory carries the same five hues ---');
{
  const hueOf = h => {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.replace('#','').slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return null;
    let x = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (x * 60 + 360) % 360;
  };
  const apart = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  for (const [fam, pick] of [['design','#d0f4de'], ['emortia','#ff99c8'], ['field','#a9def9'],
                             ['people','#e4c1f9'], ['site','#fcf6bd']]) {
    const m = INDEX.match(new RegExp('^\\.tgrp-' + fam + '\\{--gc:(#[0-9a-fA-F]{6});\\}', 'm'));
    is('.tgrp-' + fam + ' is set', !!m, true);
    if (!m) continue;
    is('and it is the ' + pick + ' hue, within 6 degrees',
       apart(hueOf(m[1]), hueOf(pick)) <= 6, true);
  }
  /* The point of the change: nothing in the directory glares any more. */
  const lum = h => { const c = [0,2,4].map(i => parseInt(h.replace('#','').slice(i,i+2),16)/255)
      .map(v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4));
    return 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]; };
  const onPage = h => (Math.max(lum(h), lum('#170d10')) + 0.05) / (Math.min(lum(h), lum('#170d10')) + 0.05);
  const bands = [...INDEX.matchAll(/^\.tool-[a-z0-9]+\{--tc:(#[0-9a-fA-F]{6})/gm)].map(m => m[1]);
  is('all sixteen card bands are present', bands.length, 16);
  is('and not one of them is a lamp on the page',
     bands.filter(b => onPage(b) > 5).map(b => b + ' ' + onPage(b).toFixed(1)), []);
}

console.log('\n--- the mapping ---');
for (const r of mapping) console.log('  ' + r.tool.padEnd(17) + r.group.padEnd(21) + r.family);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
