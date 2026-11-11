/* mirror.test.js - the two copies of the front page stay the same bytes.

   WHY THIS EXISTS. index.html and Emortia.html are byte-identical copies
   of the same page, and they moved in lockstep through 8 and 9 November
   without anybody maintaining that by hand - every change happened to
   touch both. On 11 November a palette change went into index.html alone
   and shipped. Nothing noticed, because nothing was looking: the suite
   was green, the deploy check passed (it checks the files a commit
   touched, and the commit did not touch Emortia.html), and the page that
   diverged is not the one anybody opened.

   That is the whole failure mode. A duplicate that nothing compares is a
   duplicate that is already wrong and has not been caught yet.

   WHAT THIS DOES NOT DECIDE. It does not say which file is canonical, it
   does not say the duplication is a good idea, and it does not delete
   anything. Whether the pair should be mirrored, generated from one
   source, or reduced to a single file is a question about the main site
   and it is not this test's to answer. All this says is: while there are
   two of them, they are the same, and the day they are not, something
   fails before it ships.

   A byte comparison is deliberately the whole test. Anything cleverer -
   comparing parsed CSS, or ignoring whitespace - would have let today's
   change through in some form, and the point is that NO difference is
   expected. If the two are ever meant to differ, this file is where that
   decision gets written down. */

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

/* The pair. Adding a row here is the whole job of mirroring another file. */
const PAIRS = [['index.html', 'Emortia.html']];

console.log('--- the front page copies are the same bytes ---');

for (const [a, b] of PAIRS) {
  const pa = path.join(ROOT, a), pb = path.join(ROOT, b);

  is(a + ' exists', fs.existsSync(pa), true);
  is(b + ' exists', fs.existsSync(pb), true);
  if (!fs.existsSync(pa) || !fs.existsSync(pb)) continue;

  const A = fs.readFileSync(pa), B = fs.readFileSync(pb);

  /* Size first, because it is the cheap half of the answer and it makes
     the failure readable: "448572 vs 447809" says more at a glance than
     two hashes that differ. */
  is(a + ' and ' + b + ' are the same size', A.length, B.length);

  const ha = crypto.createHash('sha256').update(A).digest('hex');
  const hb = crypto.createHash('sha256').update(B).digest('hex');
  is(a + ' and ' + b + ' are byte-identical', ha, hb);

  /* On a failure, say WHERE, or the next person has to go and diff it
     themselves to learn anything. One line is enough to recognise what
     drifted. */
  if (ha !== hb) {
    const sa = A.toString('utf8'), sb = B.toString('utf8');

    /* SAY SO WHEN THE DIFFERENCE IS INVISIBLE. The first draft of this
       printed the two lines raw, and on a CRLF/LF mismatch it printed
       "<!DOCTYPE html>" against "<!DOCTYPE html>" - a failure message
       that looks like a bug in the test. A reporter that renders an
       invisible difference as an identical one is worse than none. */
    const eol = s => (s.match(/\r\n/g) || []).length;
    if (sa.split('\r\n').join('\n') === sb.split('\r\n').join('\n')) {
      console.log('  the text is the same; only the line endings differ:');
      console.log('    ' + a + ': ' + eol(sa) + ' CRLF');
      console.log('    ' + b + ': ' + eol(sb) + ' CRLF');
      console.log('  check .gitattributes before editing either file.');
    } else {
      const la = sa.split('\n'), lb = sb.split('\n');
      const n = Math.max(la.length, lb.length);
      for (let i = 0; i < n; i++) {
        if (la[i] !== lb[i]) {
          /* escaped, so a stray \r or trailing space is visible */
          const cut = s => s === undefined ? '(no such line)'
            : JSON.stringify(s.length > 100 ? s.slice(0, 100) + '...' : s);
          console.log('  first difference at line ' + (i + 1));
          console.log('    ' + a + ': ' + cut(la[i]));
          console.log('    ' + b + ': ' + cut(lb[i]));
          break;
        }
      }
    }
    console.log('  to mirror the change:  cp ' + a + ' ' + b +
                '   (or the other way, if ' + b + ' is the one that moved)');
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
