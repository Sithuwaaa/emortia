/* qr.js - a QR code, made here.

   This exists because of what it is asked to encode. A device link is a
   capability URL: whoever holds it can file attendance from that phone. Every
   easy way to make a QR code - the image services that take a ?data= query -
   would mean handing that token to somebody else's server to draw, and it
   would be in their logs. There is no version of that which is acceptable, so
   the code is drawn on the machine that already knows the token.

   Byte mode, versions 1 to 10, error correction L or M. That covers a URL of
   up to 154 characters, which is more than a link to this site will ever be.

   Nothing here is clever. It is the specification, written out.

     QR.matrix(text, ecl)  ->  [[0|1, ...], ...]   square, no quiet zone
     QR.svg(text, opts)    ->  an <svg> string

   Usable as a module or from a <script> tag.
*/
(function (root, make) {
  const QR = make();
  if (typeof module === 'object' && module.exports) module.exports = QR;
  else root.QR = QR;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------- arithmetic in GF(256)

     Reed-Solomon works in a field of 256 elements. Multiplication is done by
     adding logarithms, so the two tables are built once and everything else
     is lookups. The primitive polynomial is the one the specification names,
     0x11d. */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  }());

  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /* The generator polynomial for n error-correction codewords is
     (x - 2^0)(x - 2^1)...(x - 2^(n-1)), multiplied out. */
  function generator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= g[j];                    // multiplied by x
        next[j + 1] ^= mul(g[j], EXP[i]);   // and by the root
      }
      g = next;
    }
    return g;
  }

  /* Polynomial long division: the remainder is the error correction. */
  function ecc(data, n) {
    const g = generator(n), rem = new Array(n).fill(0);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ rem[0];
      rem.shift(); rem.push(0);
      if (factor !== 0) for (let j = 0; j < n; j++) rem[j] ^= mul(g[j + 1], factor);
    }
    return rem;
  }

  /* ------------------------------------------------------------ the versions

     Per version and error-correction level: how many error correction
     codewords each block carries, then the blocks themselves in one or two
     groups. Two groups because the data does not always divide evenly, and
     the longer blocks go second. */
  const RS = {
    L: [ [7,1,19,0,0], [10,1,34,0,0], [15,1,55,0,0], [20,1,80,0,0], [26,1,108,0,0],
         [18,2,68,0,0], [20,2,78,0,0], [24,2,97,0,0], [30,2,116,0,0], [18,2,68,2,69] ],
    M: [ [10,1,16,0,0], [16,1,28,0,0], [26,1,44,0,0], [18,2,32,0,0], [24,2,43,0,0],
         [16,4,27,0,0], [18,4,31,0,0], [22,2,38,2,39], [22,3,36,2,37], [26,4,43,1,44] ]
  };

  /* Where the alignment patterns sit, by version. */
  const ALIGN = [ [], [6,18], [6,22], [6,26], [6,30],
                  [6,34], [6,22,38], [6,24,42], [6,26,46], [6,28,50] ];

  const dataCodewords = t => t[1] * t[2] + t[3] * t[4];

  /* ------------------------------------------------------------- the message

     Mode 0100 is bytes. The character count is eight bits up to version 9 and
     sixteen from version 10, which is the only reason this code cares where
     ten is. Then a terminator, padding to a whole codeword, and the two
     alternating pad bytes the specification names. */
  function bitstream(bytes, version, total) {
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
    put(4, 4);
    put(bytes.length, version < 10 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) put(bytes[i], 8);

    const capacity = total * 8;
    for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);

    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      out.push(b);
    }
    const PAD = [0xEC, 0x11];
    for (let i = 0; out.length < total; i++) out.push(PAD[i % 2]);
    return out;
  }

  /* Blocks are interleaved codeword by codeword, data first and then error
     correction, so that a scratch across the code damages a little of each
     block rather than all of one. */
  function interleave(data, t) {
    const n = t[0], blocks = [], eccs = [];
    let at = 0;
    for (let i = 0; i < t[1]; i++) { blocks.push(data.slice(at, at + t[2])); at += t[2]; }
    for (let i = 0; i < t[3]; i++) { blocks.push(data.slice(at, at + t[4])); at += t[4]; }
    blocks.forEach(b => eccs.push(ecc(b, n)));

    const out = [], longest = Math.max.apply(null, blocks.map(b => b.length));
    for (let i = 0; i < longest; i++)
      blocks.forEach(b => { if (i < b.length) out.push(b[i]); });
    for (let i = 0; i < n; i++) eccs.forEach(e => out.push(e[i]));
    return out;
  }

  /* --------------------------------------------------------------- the grid */
  function blank(size) {
    const m = [], res = [];
    for (let r = 0; r < size; r++) {
      m.push(new Array(size).fill(0));
      res.push(new Array(size).fill(false));   // true where the module is fixed
    }
    return { m, res };
  }

  function finder(g, row, col) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const y = row + r, x = col + c;
      if (y < 0 || x < 0 || y >= g.m.length || x >= g.m.length) continue;
      const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                 (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      g.m[y][x] = on ? 1 : 0; g.res[y][x] = true;
    }
  }

  function patterns(g, version) {
    const size = g.m.length;
    finder(g, 0, 0); finder(g, 0, size - 7); finder(g, size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
      const on = i % 2 === 0 ? 1 : 0;
      g.m[6][i] = on; g.res[6][i] = true;
      g.m[i][6] = on; g.res[i][6] = true;
    }

    const cs = ALIGN[version - 1];
    cs.forEach(r => cs.forEach(c => {
      /* not over a finder */
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) return;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0;
        g.m[r + dr][c + dc] = on; g.res[r + dr][c + dc] = true;
      }
    }));

    /* the one module that is always dark */
    g.m[size - 8][8] = 1; g.res[size - 8][8] = true;

    /* format areas are reserved now and written once the mask is chosen */
    for (let i = 0; i <= 8; i++) {
      if (!g.res[8][i]) { g.res[8][i] = true; }
      if (!g.res[i][8]) { g.res[i][8] = true; }
    }
    for (let i = 0; i < 8; i++) { g.res[8][size - 1 - i] = true; g.res[size - 1 - i][8] = true; }

    if (version >= 7) {
      const bits = versionBits(version);
      for (let i = 0; i < 18; i++) {
        const b = (bits >> i) & 1, r = Math.floor(i / 3), c = i % 3;
        g.m[r][size - 11 + c] = b; g.res[r][size - 11 + c] = true;
        g.m[size - 11 + c][r] = b; g.res[size - 11 + c][r] = true;
      }
    }
  }

  /* BCH(18,6), the generator the specification gives. */
  function versionBits(v) {
    /* Six data bits over a degree-twelve generator, so six reductions - bits
       17 down to 12. Running it twelve times shifts by a negative amount. */
    const d = v << 12;
    let r = d;
    for (let i = 0; i < 6; i++) if ((r >>> (17 - i)) & 1) r ^= 0x1F25 << (5 - i);
    return d | r;
  }

  /* BCH(15,5), then exclusive-or with the fixed mask so a blank code is not
     a valid format. */
  function formatBits(ecl, mask) {
    const ecBits = { L: 1, M: 0, Q: 3, H: 2 }[ecl];
    const d = (ecBits << 3) | mask;
    let r = d << 10;
    for (let i = 0; i < 5; i++) if (r >>> (14 - i) & 1) r ^= 0x537 << (4 - i);
    return ((d << 10) | r) ^ 0x5412;
  }

  /* The fifteen format modules, in the order the standard walks them, written
     twice. The first module of each copy carries the MOST significant bit -
     getting that backwards produces a code that looks perfectly well formed
     and that no scanner on earth can read, because the first thing a reader
     does is take the format information and it comes out as nonsense.

     The second copy is seven modules up the left column and eight along the
     top, not eight and seven: an eighth up the column would land on the
     module below them, which is the one that is always dark. */
  function formatCells(size) {
    const a = [];
    for (let i = 0; i <= 5; i++) a.push([8, i]);
    a.push([8, 7], [8, 8], [7, 8]);
    for (let i = 5; i >= 0; i--) a.push([i, 8]);
    const b = [];
    for (let i = 0; i <= 6; i++) b.push([size - 1 - i, 8]);
    for (let i = 7; i <= 14; i++) b.push([8, size - 15 + i]);
    return [a, b];
  }

  function writeFormat(m, ecl, mask) {
    const bits = formatBits(ecl, mask);
    formatCells(m.length).forEach(copy => copy.forEach((cell, i) => {
      m[cell[0]][cell[1]] = (bits >> (14 - i)) & 1;
    }));
  }

  /* The data snakes up and down in two-module columns from the right, skipping
     the vertical timing line. */
  function place(g, codewords) {
    const size = g.m.length;
    let bit = 0, up = true;
    const next = () => {
      if (bit >= codewords.length * 8) return 0;
      const b = (codewords[bit >> 3] >> (7 - (bit & 7))) & 1;
      bit++; return b;
    };
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;                   // the timing column
      for (let i = 0; i < size; i++) {
        const row = up ? size - 1 - i : i;
        for (let c = 0; c < 2; c++) {
          const col = right - c;
          if (g.res[row][col]) continue;
          g.m[row][col] = next();
        }
      }
      up = !up;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0
  ];

  /* The four penalties, which between them pick the mask that looks least
     like a finder pattern and least like a large flat block. */
  function penalty(m) {
    const size = m.length;
    let p = 0;

    const run = line => {
      let score = 0, last = -1, n = 0;
      for (let i = 0; i < size; i++) {
        if (line[i] === last) { n++; if (n === 5) score += 3; else if (n > 5) score++; }
        else { last = line[i]; n = 1; }
      }
      return score;
    };
    for (let r = 0; r < size; r++) p += run(m[r]);
    for (let c = 0; c < size; c++) p += run(m.map(row => row[c]));

    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }

    const bad = [1,0,1,1,1,0,1,0,0,0,0], bad2 = [0,0,0,0,1,0,1,1,1,0,1];
    const hit = (line, at) => {
      const same = pat => pat.every((v, i) => line[at + i] === v);
      return same(bad) || same(bad2);
    };
    for (let r = 0; r < size; r++) for (let c = 0; c + 11 <= size; c++) if (hit(m[r], c)) p += 40;
    for (let c = 0; c < size; c++) {
      const col = m.map(row => row[c]);
      for (let r = 0; r + 11 <= size; r++) if (hit(col, r)) p += 40;
    }

    let dark = 0;
    m.forEach(row => row.forEach(v => { if (v) dark++; }));
    const pct = dark * 100 / (size * size);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  function utf8(text) {
    const s = unescape(encodeURIComponent(String(text)));
    const out = new Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /* force is for the test bench: it pins the mask so a failure can be traced
     to the choice of mask rather than to everything at once. */
  function matrix(text, ecl, force) {
    ecl = (ecl === 'L' || ecl === 'M') ? ecl : 'M';
    const bytes = utf8(text);

    let version = 0, t = null;
    for (let v = 1; v <= 10; v++) {
      const row = RS[ecl][v - 1];
      const room = dataCodewords(row) - (v < 10 ? 2 : 3);
      if (bytes.length <= room) { version = v; t = row; break; }
    }
    if (!version) throw new Error('That is too long for a QR code of this size.');

    const codewords = interleave(bitstream(bytes, version, dataCodewords(t)), t);
    const size = version * 4 + 17;

    let best = null, bestScore = Infinity;
    const from = force == null ? 0 : force, upto = force == null ? 8 : force + 1;
    for (let mask = from; mask < upto; mask++) {
      const g = blank(size);
      patterns(g, version);
      place(g, codewords);
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
        if (!g.res[r][c] && MASKS[mask](r, c)) g.m[r][c] ^= 1;
      writeFormat(g.m, ecl, mask);
      const score = penalty(g.m);
      if (score < bestScore) { bestScore = score; best = g.m; }
    }
    return best;
  }

  /* One <path> for every dark module, which stays crisp at any size and needs
     no canvas. The quiet zone is four modules, as the specification asks - a
     code with no margin around it is the commonest reason a scan fails. */
  function svg(text, opts) {
    opts = opts || {};
    const m = matrix(text, opts.ecl || 'M');
    const quiet = opts.quiet == null ? 4 : opts.quiet;
    const size = m.length + quiet * 2;
    const dark = opts.dark || '#000', light = opts.light || '#fff';
    let d = '';
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m.length; c++) {
        if (m[r][c]) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" ' +
      'shape-rendering="crispEdges"' + (opts.label ? ' role="img" aria-label="' +
        String(opts.label).replace(/[<>&"]/g, '') + '"' : ' aria-hidden="true"') + '>' +
      '<rect width="' + size + '" height="' + size + '" fill="' + light + '"/>' +
      '<path fill="' + dark + '" d="' + d + '"/></svg>';
  }

  return { matrix: matrix, svg: svg, _ecc: ecc, _format: formatBits, _version: versionBits };
}));
