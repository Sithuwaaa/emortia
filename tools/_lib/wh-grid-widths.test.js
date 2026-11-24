/* wh-grid-widths.test.js - no column may be squeezed to nothing.

     node tools/_lib/wh-grid-widths.test.js

   Every .rows table is table-layout:fixed. Under that algorithm a
   column with no declared width takes WHAT IS LEFT - and what is left
   can be zero, or negative, which is also zero.

   That is what happened to Material name in the inbound entry grid.
   The other twelve columns declared 1354px of a 1459px pane, and then
   Site name was added at 150px. The name column went to 0. The header
   was in the HTML, the cell was in the row, both were in the served
   bytes, and the column was invisible on screen - measured at 0px on
   the live site at 1920px wide. Counting cells and headers, which is
   what I checked when I shipped it, cannot see that. Only a width can.

   THE RULE THIS KEEPS. A width-less column is allowed, but only where
   there is genuinely room for it: the declared pixels, plus 120px of
   readable space for each column left to fend for itself, must fit a
   pane of 1400px. The warehouse pane measures 1459px at 1920 wide,
   which is the widest he works at, so a grid that needs more than that
   has already run out before it starts.

   The entry grid is the one that ran out, so it declares shares
   instead. Percentages under a fixed layout always sum to the pane, so
   no column there can be starved by another one growing, at any width. */

const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', 'warehouse', 'warehouse.js');
const src = fs.readFileSync(W, 'utf8');

const PANE = 1400;      /* the pane at his widest, rounded down */
const READABLE = 120;   /* what a column needs to be worth having */

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};
const close = (name, got, want, tol) => {
  if (Math.abs(got - want) <= tol) { pass++; console.log('  ok   ' + name + ' (' + got + ')'); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + got + '\n  want ' + want + ' ±' + tol);
};

/* R is the only thing that varies inside a header: take each side of
   every ${R?'…':'…'} to get the delivery grid and the return grid */
const variant = (s, R) => s.replace(
  /\$\{R\?('(?:[^'\\]|\\.)*'|''):('(?:[^'\\]|\\.)*'|'')\}/g,
  (m, a, b) => (R ? a : b).slice(1, -1));

const cols = v => (v.match(/<th\b[^>]*>/g) || []).map(t => {
  const m = t.match(/width:\s*([\d.]+)(%|px)/);
  const label = (v.slice(v.indexOf(t) + t.length).match(/^([^<]*)/) || ['', ''])[1].trim();
  return m ? { n: parseFloat(m[1]), unit: m[2], label } : { n: null, unit: null, label };
});

const tally = c => ({
  n: c.length,
  px: c.filter(x => x.unit === 'px').reduce((a, x) => a + x.n, 0),
  pc: c.filter(x => x.unit === '%').reduce((a, x) => a + x.n, 0),
  bare: c.filter(x => x.n === null).length,
  bareLabels: c.filter(x => x.n === null).map(x => x.label || '(blank)')
});

/* the rule, applied to one grid */
const check = (name, c) => {
  const t = tally(c);
  console.log('\n  ' + name + ': ' + t.n + ' columns, ' + t.px + 'px + ' + t.pc
    + '% declared, ' + t.bare + ' left to fend'
    + (t.bare ? ' (' + t.bareLabels.join(', ') + ')' : ''));
  is(name + ': no column mixes units with its neighbours',
     t.px > 0 && t.pc > 0, false);
  if (t.pc > 0) {
    close(name + ': the shares add up to the pane', Math.round(t.pc * 10) / 10, 100, 0.2);
    is(name + ': so nothing is left to fend for itself', t.bare, 0);
    is(name + ': and no share is under 2% of it', c.filter(x => x.n < 2).length, 0);
  } else {
    is(name + ': a width-less column still has room to be read',
       t.px + READABLE * t.bare <= PANE, true);
  }
};

console.log('--- no column may be squeezed to nothing ---');

const heads = src.match(/<div class="rows"><table><thead><tr>[\s\S]*?<\/tr>/g) || [];
is('all four .rows grids were found', heads.length, 4);
if (heads.length !== 4) { console.log('\n' + pass + ' passed, 1 failed\n'); process.exit(1); }

/* the entry grid is the one with a Reservation column */
const entry = heads.find(h => /Reservation/.test(h));
is('the inbound entry grid was found', !!entry, true);

for (const [label, R] of [['entry · delivery', false], ['entry · return', true]])
  check(label, cols(variant(entry, R)));

heads.filter(h => h !== entry).forEach((h, i) => check('grid ' + (i + 1), cols(variant(h, false))));

/* the two entry variants trade one column for the other and must
   otherwise agree, or a row looks like it jumped when he switches */
{
  const a = cols(variant(entry, false)).map(x => x.n);
  const b = cols(variant(entry, true)).map(x => x.n);
  console.log('');
  is('both entry variants have thirteen columns', [a.length, b.length], [13, 13]);
  is('reservation and condition take the same share', a[6], b[7]);
  is('the columns before them are identical', a.slice(0, 6), b.slice(0, 6));
  is('and the columns after them too', a.slice(8), b.slice(8));
}

/* ---- prove it by breaking ---- */
console.log('\n  --- and the rule against the header that shipped ---');
{
  const shipped = `<div class="rows"><table><thead><tr><th style="width:36px">#</th><th style="width:210px">Material code</th><th>Material name</th><th style="width:130px">Category</th><th style="width:84px">UoM</th><th style="width:84px">Qty</th>\${R?'':'<th style="width:150px">Reservation</th>'}<th style="width:210px">SN</th>\${R?'<th style="width:120px">Condition</th>':''}<th style="width:110px">Site ID</th><th style="width:150px">Site name</th><th style="width:130px">WH location</th><th style="width:170px">Remarks</th><th style="width:40px"></th></tr>`;
  const c = cols(variant(shipped, false));
  const t = tally(c);
  is('Material name is the column with no width', t.bareLabels, ['Material name']);
  is('the declared pixels are what starved it', t.px, 1504);
  is('and the rule rejects it', t.px + READABLE * t.bare <= PANE, false);
}
{
  /* THE VERSION BEFORE SITE NAME FAILS THIS RULE TOO, and I expected it
     to pass. It does not, and the rule is right: with 1354px declared
     the name column had 105px at a 1459px pane and 46px at this one.
     Nobody complained, so it was visible - but it was already not a
     column worth having, and Site name did not break it so much as
     finish it. Asserted as what it is rather than softened to let it
     through, because the number it would take to pass it - under 46px
     for a material name - is not a threshold worth keeping. */
  const before = `<tr><th style="width:36px">#</th><th style="width:210px">Material code</th><th>Material name</th><th style="width:130px">Category</th><th style="width:84px">UoM</th><th style="width:84px">Qty</th><th style="width:150px">Reservation</th><th style="width:210px">SN</th><th style="width:110px">Site ID</th><th style="width:130px">WH location</th><th style="width:170px">Remarks</th><th style="width:40px"></th></tr>`;
  const t = tally(cols(before));
  is('the version before Site name was already too tight', t.px, 1354);
  is('and this rule would have refused it as well',
     t.px + READABLE * t.bare <= PANE, false);
  is('it had 46px left at this pane, and 105 at the one he uses',
     [PANE - t.px, 1459 - t.px], [46, 105]);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
