/* wh-bulk-cable.test.js - a length with no drum is a complete answer.

     node tools/_lib/wh-bulk-cable.test.js

   73 rows of his sheet are cable recorded as UOM M with a quantity and
   nothing else: no drum name, no start and end readings. That is not an
   incomplete drum, it is a coil on the floor, and it has to book in.

   The form accepts it today - verified in a browser against both a
   delivery and a site return, which is the only way to know. What this
   guards is that it STAYS accepted, because the two refusals that could
   swallow it live three lines apart in saveInbound and both would look
   reasonable if tightened:

     the drum refusal  must fire only when the row HAS a drum
     the cable refusal must fire only when the row IS flagged cable

   Either one widened to "any row whose unit is M" would reject 73 rows
   and read like a sensible validation while doing it. This asserts the
   gates stay on the row's own shape, not on its unit. */

const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', 'warehouse', 'warehouse.js');
const src = fs.readFileSync(W, 'utf8');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* the body of saveInbound, where the refusals live */
const save = (src.match(/async function saveInbound\(\)\{[\s\S]*?\n\}/) || [''])[0];
const refusals = save.split('\n').filter(l => /return bad\(|msg\.innerHTML=/.test(l));

console.log('--- a length with no drum books in ---');
console.log('  refusals in saveInbound: ' + refusals.length + '\n');

/* A SCAN THAT FOUND NOTHING PASSES EVERYTHING. */
is('saveInbound was found', save.length > 200, true);
is('and it still refuses some things', refusals.length >= 3, true);

/* every refusal that mentions a drum or readings is gated on the row
   actually having one */
const drumRefusals = refusals.filter(l => /drum/i.test(l));
const cableRefusals = refusals.filter(l => /readings|cable piece/i.test(l));
is('there is a drum refusal to check', drumRefusals.length >= 1, true);
is('there is a readings refusal to check', cableRefusals.length >= 1, true);
is('the drum refusal only fires on a row that has a drum',
   drumRefusals.filter(l => !/r\.drum&&|r\.drum\s*&&/.test(l)), []);
is('the readings refusal only fires on a row flagged as a cable piece',
   cableRefusals.filter(l => !/r\.cable&&|r\.cable\s*&&/.test(l)), []);

/* and nothing refuses a row for its unit alone */
is('no refusal is gated on the unit being M',
   refusals.filter(l => /uom\s*===?\s*'M'/.test(l)), []);
is('no refusal demands a drum name from every cable row',
   refusals.filter(l => /isCableRow/.test(l)), []);

/* the row says so, rather than leaving him to guess */
is('a cable row with no drum says a plain length is fine',
   /a plain length is fine/.test(src), true);
is('and it says it only when no drum or roll is chosen',
   /\$\{!d&&!c\?'<span class="mstate lenok">/.test(src), true);

/* ---- prove it by breaking ---- */
console.log('\n  --- and the same checks against validation that would block it ---');
is('a drum refusal widened to any M row is caught',
   [`if(ok.find(r=>r.uom==='M'&&!r.drum)){return bad('cable needs a drum')}`]
     .filter(l => !/r\.drum&&/.test(l)).length, 1);
is('a readings refusal widened to any cable row is caught',
   [`if(ok.find(r=>isCableRow(r)&&r.ra==null)){return bad('needs readings')}`]
     .filter(l => /isCableRow/.test(l)).length, 1);
is('the real drum refusal is not caught by either',
   drumRefusals.concat(cableRefusals).filter(l => /uom\s*===?\s*'M'/.test(l) || /isCableRow/.test(l)), []);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
