/* motion.test.js - anything that moves can be asked to stop.

     node tools/_lib/motion.test.js

   WHY THIS EXISTS. prefers-reduced-motion has been honoured in
   motion.css and theme.css since they were written, and nothing
   asserted it. A setting that is honoured by habit is honoured until
   somebody adds an animation in a hurry - and the person it matters to
   is the one least likely to be able to tell you it broke. Vestibular
   disorders, migraine, motion sickness: the symptom is feeling ill, not
   a bug report.

   So: every file that animates must also say how to stop. The check is
   per file, because that is the unit somebody edits.

   KNOWN_BARE is four pages that animate without honouring it today.
   They are listed rather than ignored, so the number is visible and can
   only go down - a new page cannot join them without editing this file,
   which is the point. Removing one from the list is a one-line change
   plus a reduce block.

   WHAT COUNTS AS ANIMATING: a @keyframes definition, or an animation
   property that is not "none". A transition is deliberately not counted
   - a 150ms colour fade on hover is not what makes people ill, and
   counting it would make the list long enough to stop meaning
   anything. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/* Pages that animate and do not yet honour the setting. This list may
   shrink and must never grow. */
const KNOWN_BARE = [
  'attendance/clock/index.html',
  'tools/attendance/index.html',
  'tools/field-config/index.html',
  'tools/team/index.html',
];

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

function files() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.work') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(css|html)$/.test(e.name)) out.push(p);
    }
  })(ROOT);
  return out;
}

const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');
const animates = t => /@keyframes\s/.test(t) || /animation\s*:\s*(?!none)/.test(t);
const honours  = t => /prefers-reduced-motion/.test(t);

const moving = [], bare = [];
for (const f of files()) {
  const t = fs.readFileSync(f, 'utf8');
  if (!animates(t)) continue;
  moving.push(rel(f));
  if (!honours(t)) bare.push(rel(f));
}

console.log('--- anything that moves can be asked to stop ---');
console.log('  files that animate: ' + moving.length);
console.log('  of those, not yet honouring the setting: ' + bare.length + '\n');

/* A SCAN THAT FOUND NOTHING PASSES EVERYTHING. */
is('the scan found the animating files', moving.length >= 15, true);
is('it found the two that have always honoured it',
   ['tools/_lib/motion.css', 'tools/_lib/theme.css'].filter(f => !moving.includes(f)), []);

is('every animating file either honours the setting or is on the list',
   bare.filter(f => !KNOWN_BARE.includes(f)), []);
is('and the list has not grown', bare.length <= KNOWN_BARE.length, true);
is('nothing on the list has quietly been fixed without removing it',
   KNOWN_BARE.filter(f => !bare.includes(f)), []);

/* the two the item named, asserted by name rather than by count */
for (const f of ['tools/_lib/motion.css', 'tools/_lib/theme.css']) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  is(f + ' honours prefers-reduced-motion', honours(t), true);
}

/* ---- the water drop, which is what this assertion shipped beside ---- */
{
  const wh = fs.readFileSync(path.join(ROOT, 'tools/warehouse/index.html'), 'utf8');
  is('the warehouse panel has the drop', /@keyframes whDrop/.test(wh), true);
  is('and the ripple that follows it', /@keyframes whRipple/.test(wh), true);
  is('it is on the panel, not the tab bar',
     /\.view\.on\{animation:whDrop/.test(wh), true);
  is('the tab bar is not animated',
     /\.tab[^{]*\{[^}]*animation\s*:\s*(?!none)/.test(wh), false);
  const reduce = wh.slice(wh.indexOf('@media (prefers-reduced-motion:reduce)'));
  is('and both are turned off for anyone who asked',
     /\.view\.on,\.view\.on::before\{animation:none\}/.test(reduce), true);
}

/* ---- prove it by breaking ------------------------------------------- */
console.log('\n  --- and the same test against stylesheets that are wrong ---');
is('a file that animates with no reduce block is caught',
   animates('@keyframes x{from{opacity:0}}') && !honours('@keyframes x{from{opacity:0}}'), true);
is('a file that animates and honours it is not',
   animates('.a{animation:x 1s}') && honours('@media (prefers-reduced-motion:reduce){.a{animation:none}}'), true);
is('animation:none alone does not count as animating',
   animates('.a{animation:none}'), false);
is('a transition alone does not count', animates('.a{transition:color .2s}'), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
