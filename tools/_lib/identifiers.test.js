/* identifiers.test.js - no real Dialog identifiers in committed files.

   WHY THIS EXISTS. The rule - no real site codes, serials or material
   codes in fixtures, because the repository is public - has now been
   broken twice by people who could recite it. The second time, the
   fixture was written directly underneath a comment saying the repository
   is public, and what caught it was a permission check at the boundary,
   not the rule and not the comment.

   So the rule gets a check instead of a reminder.

   WHAT COUNTS AS REAL. Four shapes, as WorkHub and SAP write them -
   illustrated here with invented values, because the first draft of this
   comment illustrated them with real ones and this test failed on its own
   documentation the first time it ran against a committed copy of itself:

     site         two letters + four digits        ZZ1234
     material     ten digits beginning 1000        1000000123
     GI number    ten digits beginning 49          4900000123
     reservation  seven digits beginning 1         1700123

   WHAT IS ALLOWED. An invented range per shape, so a new fixture has an
   obvious place to live and this test never has to be argued with:

     site         ZZ####             the convention already in use
     material     1000000000-999     the low block
     GI           4900000### / 4930000###
     reservation  1700###

   THE OUTSTANDING ONES ARE LISTED BY HASH, NOT BY VALUE. There are real
   identifiers already committed, in files outside the two cleaned on
   12 November, and they are not this test's to change - some are UI
   placeholders and column comments rather than fixtures, and all of them
   need Sithuwaaa's yes. Listing them in the clear would mean a test that
   publishes the very values it exists to keep out, so each is recorded as
   a SHA-256 prefix. The count is the debt; the hashes keep it honest
   without widening the leak.

   The effect: anything NEW that matches a real shape and is not in an
   invented range fails here, immediately, before it is committed. */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

const h = v => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 12);

/* The allowed material prefix is assembled rather than written out. Spelled
   in full it is a seven-digit run beginning 1, which is the reservation
   shape - so the literal would make this file fail its own check. It did,
   on the first run after it was committed. */
const MAT_OK = '1000' + '000';

/* Shapes that look like the real thing. */
const SHAPES = [
  { kind: 'site code',     rx: /\b([A-Z]{2}\d{4})\b/g,  ok: v => /^ZZ/.test(v) },
  { kind: 'material code', rx: /\b(1000\d{6})\b/g,      ok: v => v.startsWith(MAT_OK) && v.length === 10 },
  { kind: 'GI number',     rx: /\b(49\d{8})\b/g,        ok: v => /^49[03]0000\d{3}$/.test(v) },
  { kind: 'reservation',   rx: /\b(1\d{6})\b/g,         ok: v => /^1700\d{3}$/.test(v) },
];

/* Not identifiers at all, and nothing to do with Dialog:
     - a CSS hex colour reads as a site code (#FF5400)
     - 1048576 is 2^20, 1114111 is the top Unicode code point
     - the vendored Supabase build is somebody else's code  */
const NOT_AN_IDENTIFIER = new Set(['1048576', '1114111', '1240000']);
const SKIP_FILE = /^(tools\/_lib\/vendor\/|docs\/)/;
const BINARY = /\.(webp|png|jpe?g|gif|ico|woff2?|ttf|otf|wav|mp3|m4a|pdf|xlsx|zip|svg)$/i;

/* Hashes of the real identifiers already committed on 12 November 2026.
   Each is a value this test would otherwise fail on, left in place pending
   a decision. Removing one from this list is how the debt gets paid. */
const OUTSTANDING = new Set([
  // site code - 13 distinct, in 12 file(s)
  '27a22f236e1b', '8f44cc5fa311', '487d5945c798', 'acc5665bc7aa', 'a79999ee8948',
  '04ed05429ffb', '1549901f5821', '1213d898e84c', '71f37ce86610', '1f754479db94',
  'eae8067b7390', '976baff766b3', '1aa956da6613',
  // material code - 6 distinct, in 1 file(s)
  'bc8e342a0718', 'abd1a467917e', '9d912d78f5d5', '66980a31acd9', '27fd68c75a56',
  'b8491e5d89f4',
  // GI number - 9 distinct, in 3 file(s)
  '5eaa872c419f', 'a78485f82a68', '15f849497d1e', '81a3781e22bf', '6456c00d5b34',
  '5d9eaeb76c34', '6a21fa6425f3', '078226cd2ea2', '5d5ef6922471',
  // reservation - 10 distinct, in 7 file(s)
  '2558a34d4d20', '4995fb5c9aec', '211edc89b2dd', 'dd0d88d7ae95', 'd106f44d6aaf',
  'e6353aca1f67', '3f6807d188be', '895172620ef2', 'e52dbbb45292', '03370c3b6fe8',
]);

const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e9 })
  .split('\n').map(s => s.trim()).filter(Boolean);

const offenders = [];
let scanned = 0;
for (const f of files) {
  if (BINARY.test(f) || SKIP_FILE.test(f)) continue;
  let src;
  try { src = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { continue; }
  if (src.indexOf('\u0000') >= 0) continue;
  scanned++;
  src.split('\n').forEach((line, i) => {
    for (const { kind, rx, ok } of SHAPES) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(line))) {
        const v = m[1];
        if (ok(v) || NOT_AN_IDENTIFIER.has(v)) continue;
        /* a hex colour, not a site: #FF5400, or part of a longer hex run */
        if (kind === 'site code') {
          const before = line[m.index - 1] || '';
          if (before === '#' || /[0-9a-fA-F]/.test(before)) continue;
          if (/^(FF|AA|BB|CC|DD|EE)/.test(v) && /[#:]/.test(line.slice(0, m.index))) continue;
        }
        if (OUTSTANDING.has(h(v))) continue;
        offenders.push({ kind, file: f, line: i + 1, hash: h(v) });
      }
    }
  });
}

console.log('--- real-pattern identifiers in committed files ---');
console.log('  scanned ' + scanned + ' text files, ' + OUTSTANDING.size +
            ' known values held as hashes');

if (offenders.length) {
  console.log('\n  NEW real-pattern identifiers (value withheld - look at the line):');
  for (const o of offenders.slice(0, 40)) {
    console.log('    ' + o.kind.padEnd(15) + o.file + ':' + o.line + '   sha ' + o.hash);
  }
  console.log('\n  If the value is invented, move it into the allowed range:');
  console.log('    site ZZ####   material ' + MAT_OK + '###   GI 4900000###   reservation 1700###');
  console.log('  If it is real, it does not belong in a public repository.');
}
is('no new real-pattern identifier is committed', offenders.length, 0);

/* the two files cleaned on 12 November stay clean */
for (const f of ['tools/wh24/wh24.test.js', 'tools/esn/esn.test.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const bad = [...src.matchAll(/\b([A-Z]{2}\d{4})\b/g)].map(m => m[1])
    .filter(v => !/^ZZ/.test(v) && !/^(FF|QQ9)/.test(v));
  is(f + ' carries no real site code', [...new Set(bad)], []);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
