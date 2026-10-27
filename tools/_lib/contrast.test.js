/* contrast.test.js - the harness must refuse what it cannot read.

     node tools/_lib/contrast.test.js

   This is the regex.test.js move applied to measurement. The date regex
   was broken twice with a comment above it saying not to break it; it
   stopped being broken when a test started asserting on it. The srgb
   float misread has now happened twice with a memory note saying to
   normalise through a canvas, so the note becomes a guard.

   The fault, both times: color(srgb 0.93 0.44 0.49 / 0.55) read as a
   0-to-255 triple. A colour three quarters of the way to white measured
   as near-black - 1.15 where the truth was 2.72, nearly costing a colour
   change on the day pill; and three weeks later, a claim that ten of
   eleven status colours had never cleared 4.5 when they always had.

   So the first six assertions below are that exact string.
*/
const path = require('path');
const C = require(path.join(__dirname, 'contrast.js'));

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};
const refuses = (label, fn) => {
  try { const v = fn(); fail++; console.log('FAIL ' + label + '\n  it returned ' + JSON.stringify(v) + ' instead of refusing'); }
  catch (e) {
    if (e instanceof C.ContrastRefusal) pass++;
    else { fail++; console.log('FAIL ' + label + '\n  threw the wrong error: ' + e.name + ' ' + e.message); }
  }
};

/* ---- 1. THE RECURRENCE, by name ---------------------------------------- */
console.log('the colour that was misread twice');
const DAYPILL = 'color(srgb 0.93 0.44 0.49 / 0.55)';
const p = C.parse(DAYPILL);
is('it normalises to 0..255 channels', p.rgb, [237, 112, 125]);
is('and keeps the alpha',              p.a, 0.55);
is('the channels are whole numbers',   p.rgb.every(Number.isInteger), true);
is('it is a light colour, not a dark one', C.luminance(p.rgb) > 0.2, true);

/* the misread itself must be impossible to carry into a ratio */
refuses('a 0..1 triple is refused by ratio()',      () => C.ratio([0.93, 0.44, 0.49], [255, 255, 255]));
refuses('and by luminance()',                        () => C.luminance([0.93, 0.44, 0.49]));
refuses('and as a background',                       () => C.ratio([0, 0, 0], [0.93, 0.44, 0.49]));
refuses('and by over()',                             () => C.over([0.93, 0.44, 0.49], 0.55, [255, 255, 255]));

/* And the stakes, as a number rather than a worry. Against a dark card -
   which is where the day pill sat - the misread UNDERSTATES, which is the
   dangerous direction: it says a colour is failing when it is passing,
   and the response to that is to change the colour. */
{
  const CARD = '#0c1619';                      /* the tool's dark --bg at the time */
  const bg = C.parse(CARD).rgb;
  const right = C.ratio(C.over(p.rgb, p.a, bg), bg);
  const wrongIfItHadBeenAllowed = (() => {
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = a => 0.2126 * lin(a[0]) + 0.7152 * lin(a[1]) + 0.0722 * lin(a[2]);
    const fg = [0.93, 0.44, 0.49].map((v, i) => 0.55 * v + 0.45 * bg[i]);
    const x = L(fg), y = L(bg);
    return +(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2));
  })();
  is('the misread understates, which is what makes it expensive',
     wrongIfItHadBeenAllowed < right, true);
  is('and by enough to change a decision', right - wrongIfItHadBeenAllowed > 1, true);
  console.log('      on ' + CARD + ': correct ' + right +
              ', misread would have said ' + wrongIfItHadBeenAllowed +
              '  (the day pill was recorded as 2.72 read as 1.15)');
}

/* ---- 2. the serialisations it must handle ------------------------------ */
console.log('\nwhat it reads');
is('#hex',              C.parse('#007748').rgb, [0, 119, 72]);
is('#hex, short',       C.parse('#fff').rgb, [255, 255, 255]);
is('#hex with alpha',   C.parse('#00774880').a > 0.49, true);
is('rgb(), commas',     C.parse('rgb(0, 119, 72)').rgb, [0, 119, 72]);
is('rgb(), spaces',     C.parse('rgb(0 119 72)').rgb, [0, 119, 72]);
is('rgba(), 4th value', C.parse('rgba(0, 119, 72, 0.5)').a, 0.5);
is('rgb() with / alpha',C.parse('rgb(0 119 72 / 0.25)').a, 0.25);
is('color(srgb)',       C.parse('color(srgb 0 0.466667 0.282353)').rgb, [0, 119, 72]);
is('color(srgb) agrees with the same colour as rgb()',
   C.parse('color(srgb 0 0.466667 0.282353)').rgb, C.parse('rgb(0, 119, 72)').rgb);

console.log('\nwhat it refuses rather than half-reads');
refuses('oklab()',          () => C.parse('oklab(0.5 -0.1 0.04)'));
refuses('oklch()',          () => C.parse('oklch(0.5 0.1 150)'));
refuses('lab()',            () => C.parse('lab(50% 20 -30)'));
refuses('display-p3',       () => C.parse('color(display-p3 0.9 0.4 0.5)'));
refuses('a bare word',      () => C.parse('rebeccapurple'));
refuses('rgb() with two channels', () => C.parse('rgb(1,2)'));

/* ---- 3. the arithmetic ------------------------------------------------- */
console.log('\nthe arithmetic');
is('black on white is 21',  C.ratio([0, 0, 0], [255, 255, 255]), 21);
is('white on white is 1',   C.ratio([255, 255, 255], [255, 255, 255]), 1);
is('it is symmetric',       C.ratio([0, 0, 0], [255, 255, 255]), C.ratio([255, 255, 255], [0, 0, 0]));
is('black at 50% over white is mid grey', C.over([0, 0, 0], 0.5, [255, 255, 255]), [128, 128, 128]);
is('a fully opaque fg is itself',         C.over([12, 34, 56], 1, [255, 255, 255]), [12, 34, 56]);
is('composite() does both steps',
   C.composite('color(srgb 0 0 0 / 0.5)', '#ffffff'), [128, 128, 128]);
refuses('a translucent background is refused', () => C.composite('#000', 'rgba(255,255,255,0.5)'));
refuses('alpha above 1',    () => C.over([0, 0, 0], 1.5, [255, 255, 255]));
refuses('a channel above 255', () => C.luminance([300, 0, 0]));

/* ---- 4. the shared-canvas fault ---------------------------------------
   A fake 2d context that behaves the way the real one does: assigning an
   unparseable colour to fillStyle is a silent no-op. The probe must fail
   on that rather than hand back whatever was measured last. */
console.log('\nthe probe, against a canvas that keeps its old fillStyle');
function fakeDoc(opts) {
  opts = opts || {};
  return { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      _fill: '#000000', _pixel: [0, 0, 0],
      get fillStyle() { return this._fill; },
      set fillStyle(v) { if (opts.accept === false) return;      /* the silent no-op */
        if (/^#|^rgb|^color\(/i.test(String(v))) this._fill = String(v); },
      fillRect() { const m = /^#([0-9a-f]{6})$/i.exec(this._fill);
        this._pixel = m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : [1, 2, 3]; },
      getImageData() { return { data: [this._pixel[0], this._pixel[1], this._pixel[2], 255] }; }
    })
  }) };
}
{
  const px = C.probe(fakeDoc());
  is('it reads a colour the canvas accepts', px('#007748'), [0, 119, 72]);
  const stubborn = C.probe(fakeDoc({ accept: false }));
  refuses('it refuses when fillStyle silently keeps its old value', () => stubborn('#007748'));
}
refuses('probe() without a document', () => C.probe(null));

/* ---- 5. reading across a theme switch ---------------------------------
   The witness is whatever the caller says should differ between themes.
   If it has not moved, the style has not landed and every reading after
   this point would be about the other theme. */
console.log('\nthe theme switch, which must prove it landed');
function fakeEnv(applies) {
  const el = { dataset: {} };
  return {
    doc: { documentElement: el, body: { offsetHeight: 1 } },
    win: { requestAnimationFrame: f => f() },
    witness: () => applies ? (el.dataset.theme === 'light' ? '#FFFFFF' : '#091C31') : '#091C31'
  };
}
(async () => {
  {
    const e = fakeEnv(true);
    const got = await C.withTheme(e.doc, e.win, 'light', e.witness);
    is('a theme that lands returns the new witness', got, '#FFFFFF');
  }
  {
    const e = fakeEnv(false);
    let refused = false;
    try { await C.withTheme(e.doc, e.win, 'light', e.witness); }
    catch (err) { refused = err instanceof C.ContrastRefusal; }
    is('a theme that does not land is refused', refused, true);
  }
  {
    const e = fakeEnv(true);
    let refused = false;
    try { await C.withTheme(e.doc, e.win, 'light', null); }
    catch (err) { refused = err instanceof C.ContrastRefusal; }
    is('and a missing witness is refused, because then nothing is proved', refused, true);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
