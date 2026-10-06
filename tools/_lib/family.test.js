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
  is('not one designed colour has moved since it was copied in',
     crypto.createHash('sha256').update(values).digest('hex'),
     'a086d111fcf698a8bdd6ea316d276f3a127ff78c465d208632e31565adc6d1e9');
  is('and the file still carries the note on the 4.39 value',
     /4\.39[\s\S]*?--accentT/.test(NAV), true);
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
}

console.log('\n--- the mapping ---');
for (const r of mapping) console.log('  ' + r.tool.padEnd(17) + r.group.padEnd(21) + r.family);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
