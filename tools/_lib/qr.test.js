/* qr.test.js - does the code say what it is supposed to say.

     node tools/_lib/qr.test.js

   A QR code is either readable or it is a grey square, and nothing in between
   is visible by looking at it. So the parts that can be checked against the
   published standard are checked against it: the error correction vector from
   the specification's own worked example, the format strings from Annex C,
   the version strings from Annex D. If those three are right, the arithmetic
   underneath is right.

   The rest - placement and masking - is checked for structure. A scanner is
   the only thing that can say the whole is right, so scan one.
*/

const QR = require('./qr.js');

let pass = 0, fail = 0;
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(46) +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* ------------------------------------------------------- against the standard */
console.log('\n  against the standard');

/* ISO/IEC 18004, the worked example: "01234567" as version 1-M. These are the
   data codewords it gives, and these are the ten it says come out. */
is('the specification\'s error correction',
   QR._ecc([0x10,0x20,0x0C,0x56,0x61,0x80,0xEC,0x11,0xEC,0x11,0xEC,0x11,0xEC,0x11,0xEC,0x11], 10),
   [0xA5,0x24,0xD4,0xC1,0xED,0x36,0xC7,0x87,0x2C,0x55]);

/* Annex C, the sixteen published format strings at mask 0 for each level. */
const fmt = (e, m) => QR._format(e, m).toString(2).padStart(15, '0');
is('format L, mask 0', fmt('L', 0), '111011111000100');
is('format M, mask 0', fmt('M', 0), '101010000010010');
is('format Q, mask 0', fmt('Q', 0), '011010101011111');
is('format H, mask 0', fmt('H', 0), '001011010001001');
is('format M, mask 5', fmt('M', 5), '100000011001110');
is('format L, mask 7', fmt('L', 7), '110100101110110');

/* Annex D. */
const ver = v => QR._version(v).toString(2).padStart(18, '0');
is('version 7',  ver(7),  '000111110010010100');
is('version 10', ver(10), '001010010011010011');

/* ----------------------------------------------------------- what it draws */
console.log('\n  what it draws');

const link = 'https://emortia.com/attendance/?d=' + 'a3f1'.repeat(9);
const m = QR.matrix(link, 'M');

is('a device link fits in version 5', m.length, 37);
is('and in version 4 at level L',     QR.matrix(link, 'L').length, 33);

/* A finder is a solid ring: the top row of one is seven dark modules. */
const topRow = (r, c) => [0,1,2,3,4,5,6].map(i => m[r][c + i]);
is('finder, top left',     topRow(0, 0), [1,1,1,1,1,1,1]);
is('finder, top right',    topRow(0, m.length - 7), [1,1,1,1,1,1,1]);
is('finder, bottom left',  topRow(m.length - 7, 0), [1,1,1,1,1,1,1]);
is('and its second row is the ring', [0,1,2,3,4,5,6].map(i => m[1][i]), [1,0,0,0,0,0,1]);
is('and its middle is solid',        [2,3,4].map(i => m[3][i]), [1,1,1]);

is('the separator is light',   [m[7][0], m[0][7], m[7][7]], [0,0,0]);
is('the module that is always dark', m[m.length - 8][8], 1);
is('timing runs across',  [6,7,8,9,10].map(i => m[6][i]), [1,0,1,0,1]);
is('timing runs down',    [6,7,8,9,10].map(i => m[i][6]), [1,0,1,0,1]);
is('every module is 0 or 1', m.every(r => r.every(v => v === 0 || v === 1)), true);

/* Roughly half of a good code is dark; a badly masked one drifts far off. */
let dark = 0; m.forEach(r => r.forEach(v => { if (v) dark++; }));
const pct = Math.round(dark * 100 / (m.length * m.length));
is('the mask leaves it near half dark', pct > 40 && pct < 60, true);

/* Versions must step where the standard says they step. */
is('an empty string is version 1',   QR.matrix('', 'M').length, 21);
is('154 characters still fit at L',  QR.matrix('x'.repeat(154), 'L').length, 45);
let tooLong = false;
try { QR.matrix('x'.repeat(400), 'L'); } catch (e){ tooLong = true; }
is('and something far too long says so', tooLong, true);

/* Same input, same code - a mask chosen at random would not be repeatable. */
is('it is the same code every time',
   JSON.stringify(QR.matrix(link, 'M')) === JSON.stringify(QR.matrix(link, 'M')), true);

const svg = QR.svg(link, { dark: '#000', light: '#fff' });
is('the quiet zone is four modules each side', /viewBox="0 0 45 45"/.test(svg), true);
is('the token is not in the label',  /a3f1/.test(QR.svg(link, { label: 'A device link' }).split('d="')[0]), false);

/* --------------------------------------------------------- read back again

   Everything above passed once while the codes were unreadable. The format
   information was being written least significant bit first, which is a grid
   that looks entirely well formed, satisfies every structural check, and that
   no scanner can read - because reading the format is the first thing a
   scanner does. Nothing short of a decode catches that.

   So: draw it, and read it back with a decoder that shares no code with this
   one. jsQR is not a dependency of the site and never ships with it; if it is
   not installed this says so rather than passing quietly.

     npm install jsqr
*/
console.log('\n  read back again');
let jsQR = null;
try { jsQR = require('jsqr'); jsQR = jsQR.default || jsQR; } catch (e){ /* below */ }

if (!jsQR){
  console.log('  ..    SKIPPED - no decoder. npm install jsqr to run these.');
  console.log('        Until then nothing here proves a scanner can read the output.');
} else {
  const scale = 6, quiet = 4;
  function roundTrip(text, ecl){
    const m = QR.matrix(text, ecl), n = m.length, px = (n + quiet * 2) * scale;
    const px4 = new Uint8ClampedArray(px * px * 4).fill(255);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++){
      if (!m[r][c]) continue;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++){
        const o = (((r + quiet) * scale + y) * px + ((c + quiet) * scale + x)) * 4;
        px4[o] = px4[o + 1] = px4[o + 2] = 0;
      }
    }
    const got = jsQR(px4, px, px);
    return got ? got.data : null;
  }
  const device = 'https://emortia.com/attendance/?d=' + 'a3f1'.repeat(9);
  is('a device link, level M', roundTrip(device, 'M'), device);
  is('a device link, level L', roundTrip(device, 'L'), device);
  is('a short string',        roundTrip('HELLO WORLD', 'M'), 'HELLO WORLD');
  is('one character',         roundTrip('a', 'L'), 'a');
  is('an en dash survives',   roundTrip('Kollupitiya – crew A', 'M'), 'Kollupitiya – crew A');
  is('120 characters',        roundTrip('x'.repeat(120), 'M'), 'x'.repeat(120));
  is('and the longest that fits', roundTrip('x'.repeat(154), 'L'), 'x'.repeat(154));

  /* every mask has to produce a readable code, not just the one the penalty
     happens to pick today */
  const perMask = [];
  for (let k = 0; k < 8; k++){
    const m = QR.matrix(device, 'M', k), n = m.length, px = (n + quiet * 2) * scale;
    const px4 = new Uint8ClampedArray(px * px * 4).fill(255);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++){
      if (!m[r][c]) continue;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++){
        const o = (((r + quiet) * scale + y) * px + ((c + quiet) * scale + x)) * 4;
        px4[o] = px4[o + 1] = px4[o + 2] = 0;
      }
    }
    const got = jsQR(px4, px, px);
    perMask.push(got && got.data === device);
  }
  is('all eight masks read back', perMask, [true,true,true,true,true,true,true,true]);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
