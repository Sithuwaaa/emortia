/* contrast.js - the one contrast harness, because the ad-hoc ones lie.

   NOT SHIPPED CODE. A test and measurement helper, like reachable.js and
   fake-supabase.js beside it. Nothing on the site loads it.

   WHY IT EXISTS. Twice now a measurement has been wrong in the same way,
   and both times the thing that was supposed to prevent it was a note:

     ~6 October  color(srgb 0.93 0.44 0.49 / 0.55) on the day-pill edge
                 was read as a 0-to-255 triple, so a colour three
                 quarters of the way to white measured as near-black.
                 The figure came out 1.15 when it was really 2.72, and a
                 colour change was nearly made on the strength of it.

     27 October  the same serialisation, the same misread, this time on
                 the Project Update status chips. It produced a confident
                 claim that ten of eleven colours had never cleared 4.5
                 on a rendered page. They always had: 4.52.

   The note said "normalise through a canvas". The note did not stop it,
   the same way the comment above the date regex did not stop that being
   broken a second time - which is why that became regex.test.js. So this
   is the same move: THE CHECK REFUSES INSTEAD OF THE HUMAN REMEMBERING.

   A harness that can be handed `color(srgb 0.93 0.44 0.49)` and hand back
   something it treats as 0-to-255 IS the bug. This one normalises it, and
   where it cannot normalise it throws rather than guessing.

   THREE FAULTS, ALL GUARDED HERE:

   1. THE SERIALISATION. parse() understands color(srgb …) and converts
      it. Anything it does not understand is refused by name rather than
      half-read.

   2. THE SHARED CANVAS. The browser probe used one context for every
      call. Assigning an invalid colour to ctx.fillStyle is a silent
      no-op - the previous colour stays - so a rejected value came back
      as whatever was measured last. White-on-navy measured 1.08 that
      way. probe() takes a fresh context per call and asserts the
      assignment was accepted.

   3. READING ACROSS A THEME SWITCH. One run set data-theme and read
      computed values before the style recalculation landed, so it
      reported dark's accent in light and light's in dark. That is the
      measurement equivalent of sampling a collapsed pane and calling it
      black: the harness answers, and the answer is about the wrong
      thing. withTheme() flushes and then PROVES the theme took by
      requiring a witness value to change.
*/
'use strict';

/* ---- the refusals, named so a test can assert on them ---------------- */
class ContrastRefusal extends Error {
  constructor(msg) { super(msg); this.name = 'ContrastRefusal'; }
}

/* ---- a colour, as 0-to-255 channels ---------------------------------- */
const clamp255 = v => Math.max(0, Math.min(255, v));

function parse(input) {
  if (Array.isArray(input)) return { rgb: assertChannels(input.slice(0, 3)), a: 1 };
  const s = String(input).trim();

  /* #rgb #rgba #rrggbb #rrggbbaa */
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8)
      throw new ContrastRefusal('not a hex colour I can read: ' + s);
    const n = i => parseInt(h.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], a: h.length === 8 ? n(6) / 255 : 1 };
  }

  /* rgb()/rgba(), comma or space separated, optional / alpha, % allowed */
  m = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split('/');
    const ch = parts[0].trim().split(/[\s,]+/).filter(Boolean);
    if (ch.length < 3) throw new ContrastRefusal('rgb() with fewer than 3 channels: ' + s);
    const val = t => t.endsWith('%') ? parseFloat(t) * 2.55 : parseFloat(t);
    const rgb = ch.slice(0, 3).map(t => Math.round(clamp255(val(t))));
    let a = 1;
    const at = parts[1] !== undefined ? parts[1] : ch[3];
    if (at !== undefined) a = String(at).trim().endsWith('%')
      ? parseFloat(at) / 100 : parseFloat(at);
    return { rgb, a: isFinite(a) ? a : 1 };
  }

  /* THE RECURRENCE: color(srgb r g b / a), channels 0..1 */
  m = /^color\(\s*srgb\s+([^)]*)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split('/');
    const ch = parts[0].trim().split(/[\s,]+/).filter(Boolean);
    if (ch.length < 3) throw new ContrastRefusal('color(srgb …) with fewer than 3 channels: ' + s);
    const val = t => t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
    const rgb = ch.slice(0, 3).map(t => Math.round(clamp255(val(t) * 255)));
    let a = 1;
    if (parts[1] !== undefined) {
      const t = parts[1].trim();
      a = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
    }
    return { rgb, a: isFinite(a) ? a : 1 };
  }

  /* everything else - oklab, oklch, lab, lch, hsl, color() in another
     space - is refused BY NAME. Half-reading one of these is exactly the
     failure this file exists for; in a browser, hand it through probe()
     and let the engine convert it. */
  throw new ContrastRefusal(
    'cannot normalise ' + s + ' outside a browser. Use probe(document) so the ' +
    'engine converts it, or pass rgb()/#hex/color(srgb …).');
}

/* ---- the guard that would have caught both occurrences ---------------
   0-to-255 channels are whole numbers. 0-to-1 channels are not. A triple
   carrying fractions is a normalised colour that someone forgot to scale,
   which is precisely what 1.15-instead-of-2.72 was. */
function assertChannels(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3)
    throw new ContrastRefusal('expected [r,g,b], got ' + JSON.stringify(rgb));
  for (const v of rgb.slice(0, 3)) {
    if (typeof v !== 'number' || !isFinite(v))
      throw new ContrastRefusal('channel is not a number: ' + JSON.stringify(rgb));
    if (!Number.isInteger(v))
      throw new ContrastRefusal(
        'channels look normalised (0..1), not 0..255: ' + JSON.stringify(rgb) +
        '. This is the color(srgb …) misread - scale by 255, or use parse().');
    if (v < 0 || v > 255)
      throw new ContrastRefusal('channel out of range 0..255: ' + JSON.stringify(rgb));
  }
  return rgb.slice(0, 3);
}

/* ---- the arithmetic -------------------------------------------------- */
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

function luminance(rgb) {
  const [r, g, b] = assertChannels(rgb);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const x = luminance(assertChannels(a)), y = luminance(assertChannels(b));
  return +(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2));
}

/* fg at alpha over an opaque bg, rounded back to whole channels */
function over(fg, alpha, bg) {
  const f = assertChannels(fg), b = assertChannels(bg);
  const a = alpha == null ? 1 : alpha;
  if (!(a >= 0 && a <= 1)) throw new ContrastRefusal('alpha out of range 0..1: ' + a);
  return f.map((v, i) => Math.round(a * v + (1 - a) * b[i]));
}

/* what a colour string composites to over a background, in one step */
function composite(colourString, backgroundString) {
  const f = parse(colourString), b = parse(backgroundString);
  if (b.a !== 1) throw new ContrastRefusal('the background must be opaque, got alpha ' + b.a);
  return over(f.rgb, f.a, b.rgb);
}

/* ---- the browser probe, with the shared-canvas fault designed out ----
   Hands a colour to the engine and reads back whole channels, so any
   serialisation at all is normalised. A FRESH context per call, and the
   assignment is checked: ctx.fillStyle silently keeps its old value when
   it is handed something it does not accept, and a probe that returns the
   previous colour is worse than one that fails. */
function probe(doc) {
  if (!doc || typeof doc.createElement !== 'function')
    throw new ContrastRefusal('probe(document) needs a document');
  return function px(colour, overColour) {
    const canvas = doc.createElement('canvas');
    canvas.width = canvas.height = 1;
    const x = canvas.getContext('2d', { willReadFrequently: true });
    if (!x) throw new ContrastRefusal('no 2d context - cannot normalise anything');
    if (overColour !== undefined && overColour !== null) {
      x.fillStyle = '#000000';
      x.fillStyle = overColour;
      if (x.fillStyle === '#000000' && !/^#0{3,8}$|^black$/i.test(String(overColour).trim()))
        throw new ContrastRefusal('the canvas refused the background colour: ' + overColour);
      x.fillRect(0, 0, 1, 1);
    }
    const before = x.fillStyle;
    x.fillStyle = colour;
    if (x.fillStyle === before && String(colour).trim().toLowerCase() !== String(before).toLowerCase())
      throw new ContrastRefusal('the canvas refused the colour: ' + colour +
        ' (fillStyle stayed ' + before + ', which is how a shared context ' +
        'returns the previous measurement instead of failing)');
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
}

/* ---- switching theme without reading the old one ---------------------
   Sets the attribute, forces a style flush, waits two frames, and then
   REQUIRES the witness to have changed. A theme that did not take is the
   measurement equivalent of a collapsed pane: the harness still answers,
   and the answer is about the wrong page. */
async function withTheme(doc, win, theme, witness) {
  if (typeof witness !== 'function')
    throw new ContrastRefusal('withTheme needs a witness () => value that differs between themes');
  const was = witness();
  doc.documentElement.dataset.theme = theme;
  if (doc.body) void doc.body.offsetHeight;
  if (win && typeof win.requestAnimationFrame === 'function')
    await new Promise(r => win.requestAnimationFrame(() => win.requestAnimationFrame(r)));
  const now = witness();
  if (String(now) === String(was))
    throw new ContrastRefusal('theme "' + theme + '" did not take: the witness still reads ' +
      JSON.stringify(was) + '. Reading now would report the other theme.');
  return now;
}

module.exports = {
  ContrastRefusal, parse, assertChannels, luminance, ratio, over, composite, probe, withTheme
};
