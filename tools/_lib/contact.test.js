/* contact.test.js - the way to reach Sithuwaaa actually reaches him.

   WHY THIS EXISTS. The address on the contact page was
   emortiamusix@gmail.com - one letter wrong - from the day the form was
   built until 15 November 2026. Every message anybody sent through it
   went nowhere, and nothing noticed, because nothing was looking: the
   suite had 3,101 assertions and not one of them touched the only part
   of the site a stranger can use to get in contact.

   A wrong letter in an address is invisible to review. Nobody proofreads
   a mailto. So it gets a check instead of a proofread.

   WHAT THIS REFUSES.
     - any address but the one below, in the link or in the form
     - an obfuscated href: Cloudflare's /cdn-cgi/l/email-protection
       rewrite replaces the address with a hex blob and a script, and a
       blob is not something a reader can check at a glance. If that
       ever appears here the address has stopped being readable in the
       source, which is how the typo survived.
     - the link saying one address and pointing at another, which is the
       one shape a careful reader is most likely to miss

   The address is written once, here, and both files are measured
   against it. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILES = ['index.html', 'Emortia.html'];

/* The one true address. If it ever changes, it changes here and the
   build tells you which files still disagree. */
const ADDRESS = 'emortiamusic@gmail.com';

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

console.log('--- the contact address is the one that works ---');
console.log('  expecting ' + ADDRESS + '\n');

for (const f of FILES) {
  const p = path.join(ROOT, f);
  is(f + ' exists', fs.existsSync(p), true);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');

  /* ---- 1. the link a reader clicks -------------------------------- */

  /* Pulled apart rather than searched for: the href and the words are
     read out separately and each compared to the address, so a link
     that SAYS the right thing and POINTS somewhere else fails. */
  const anchors = [...src.matchAll(/<a\s+href="mailto:([^"?]*)[^"]*"[^>]*>([^<]*)<\/a>/g)]
    .map(m => ({ href: m[1], text: m[2].trim() }));

  is(f + ': there is exactly one mailto link', anchors.length, 1);
  if (anchors.length === 1) {
    is(f + ': its href is the address', anchors[0].href, ADDRESS);
    is(f + ': the words it shows are the same address', anchors[0].text, ADDRESS);
  }

  /* ---- 2. the form, which is where the messages actually went ----- */

  /* The form does not post anywhere - it hands a composed message to
     the reader's mail client. The address it hands over is the one that
     was wrong, and it is a different line from the link above, so both
     are read. */
  const jump = [...src.matchAll(/window\.location\.href\s*=\s*'mailto:([^'?]*)\?/g)]
    .map(m => m[1]);
  is(f + ': the form builds exactly one mailto', jump.length, 1);
  if (jump.length === 1) is(f + ': and it is the address', jump[0], ADDRESS);

  /* ---- 3. nothing else claims to be an address -------------------- */

  /* Every mailto: in the file, however it is written, resolves to the
     address. This is what catches a second one being added later and
     only the first being corrected. */
  const everyMailto = [...src.matchAll(/mailto:([^"'?\s>]+)/g)].map(m => m[1]);
  is(f + ': every mailto in the file is the address',
     [...new Set(everyMailto)], [ADDRESS]);

  /* Any @gmail.com at all, in case one is written without a mailto: */
  const everyGmail = [...src.matchAll(/[A-Za-z0-9._%+-]+@gmail\.com/g)].map(m => m[0]);
  is(f + ': every gmail address in the file is the address',
     [...new Set(everyGmail)], [ADDRESS]);

  /* ---- 4. the address stays readable in the source ---------------- */

  is(f + ': the address is not behind an email-protection blob',
     /cdn-cgi\/l\/email-protection|data-cfemail/.test(src), false);
}

/* ---- 5. prove it would catch the thing it was written for --------- */

/* The bug was a single letter. A test that passes on the real file says
   nothing until it is shown failing on the broken one, so the broken one
   is built here, in memory, and run through the same checks. */
console.log('\n  --- and the same checks against the file as it was, with the typo ---');
{
  const src = fs.readFileSync(path.join(ROOT, FILES[0]), 'utf8')
    .split(ADDRESS).join('emortiamusix@gmail.com');
  const anchors = [...src.matchAll(/<a\s+href="mailto:([^"?]*)[^"]*"[^>]*>([^<]*)<\/a>/g)];
  const jump = [...src.matchAll(/window\.location\.href\s*=\s*'mailto:([^'?]*)\?/g)];
  const everyGmail = [...new Set([...src.matchAll(/[A-Za-z0-9._%+-]+@gmail\.com/g)].map(m => m[0]))];
  is('the link check fails on the old file', anchors[0][1] === ADDRESS, false);
  is('the form check fails on the old file', jump[0][1] === ADDRESS, false);
  is('the sweep fails on the old file',
     JSON.stringify(everyGmail) === JSON.stringify([ADDRESS]), false);
}

/* One letter, in one of the two places, with the other left right - the
   shape a find-and-replace half-finished would leave. */
{
  const src = fs.readFileSync(path.join(ROOT, FILES[0]), 'utf8')
    .replace("window.location.href='mailto:" + ADDRESS,
             "window.location.href='mailto:emortiamusix@gmail.com");
  const jump = [...src.matchAll(/window\.location\.href\s*=\s*'mailto:([^'?]*)\?/g)];
  const everyGmail = [...new Set([...src.matchAll(/[A-Za-z0-9._%+-]+@gmail\.com/g)].map(m => m[0]))];
  is('a half-finished replace is caught in the form', jump[0][1] === ADDRESS, false);
  is('and by the sweep', everyGmail.length, 2);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
