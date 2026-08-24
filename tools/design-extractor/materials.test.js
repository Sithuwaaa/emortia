/* materials.test.js - which bands one radio can carry, and how a sector's
   technologies split into boxes.

     node tools/design-extractor/materials.test.js

   Every case here came out of the 2026 MBB or 2025 HBB design book. Getting
   these wrong changes how many radios are ordered, so they are pinned. */

const M = require('./materials.js');

let pass = 0, fail = 0;
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(56) + show(got) + (ok ? '' : '   want ' + show(want)));
}
const boxes = (m, t) => M.boxesFor(m, t).length;

console.log('\nreading a model name back to the part');
{
  is('a bare one',              M.baseModel('RRU5909'), 'RRU5909');
  is('with the Final slash',    M.baseModel('RRU5909/GL'), 'RRU5909');
  is('with the HBB backslash',  M.baseModel('RRU5818\\LO_L23'), 'RRU5818');
  is('with DCS in front',       M.baseModel('DCS RRU5501'), 'RRU5501');
  is('a long qualifier',        M.baseModel('Radio 4499/DCS_L18_L12'), 'Radio 4499');
  is('spaces tidied',           M.baseModel('  RRU  5909/GL '), 'RRU 5909');
  is('nothing in, nothing out', M.baseModel(''), '');
  is('and null too',            M.baseModel(null), '');
}

console.log('\nthe case that was ordering too few');
{
  /* RRU5909 is written under G900, L900 and L2100 in the same book. The 900
     unit carries GSM and LTE together; the L21 unit is a different radio. */
  is('900 GSM and LTE ride together',   boxes('RRU5909', ['G900','L900']), 1);
  is('L21 on its own is one',           boxes('RRU5909', ['L2100']), 1);
  is('but 900 and L21 are two radios',  boxes('RRU5909', ['G900','L900','L2100']), 2);
  is('and they split the right way',
     M.boxesFor('RRU5909', ['G900','L900','L2100']), [['G900','L900'],['L2100']]);
  is('L18 is a third thing again',      boxes('RRU5909', ['G900','L1800','L2100']), 3);
}

console.log('\nthe case that would order too many');
{
  /* B1 is 2100 and B3 is 1800 - the part number says so, and it is one box */
  is('4490 B1+B3 does both off one',    boxes('RRU 4490 B1+B3', ['L1800','L2100']), 1);
  is('kept together, not split',
     M.boxesFor('RRU 4490 B1+B3', ['L2100','L1800']), [['L1800','L2100']]);
  is('2271 is a 900 radio',             boxes('Radio 2271', ['G900','L900']), 1);
  is('4415 carries DCS and L18',        boxes('Radio 4415', ['G1800','L1800']), 1);
  is('5910 is 900 as well',             boxes('RRU5910', ['G900','L900']), 1);
}

console.log('\nthe qualified spellings resolve to the same part');
{
  is('Final name, same answer',   boxes('RRU5909/GL', ['G900','L900']), 1);
  is('HBB name, same answer',     boxes('RRU5818\\LO_L23', ['L2300(HBB)']), 1);
  is('DCS prefix, same answer',   boxes('DCS RRU5501', ['G1800','L1800']), 1);
  /* a variant suffix must not lose the entry entirely */
  is('a suffix falls back to the part', M.lookup('RRU5909 B3').model, 'RRU5909');
  is('and an unknown is unknown',       M.lookup('RRU9999'), null);
}

console.log('\nwhat happens to a radio nobody has listed');
{
  /* The cautious way round: one box per technology over-orders by one rather
     than under-ordering, and a spare costs less than a second trip to site. */
  is('unknown, two technologies, two boxes', boxes('RRU9999', ['L1800','L2100']), 2);
  is('unknown, one technology, one box',     boxes('RRU9999', ['L1800']), 1);
  is('sameBox says no for the unknown',      M.sameBox('RRU9999', ['L1800','L2100']), false);
  is('but yes for a single technology',      M.sameBox('RRU9999', ['L1800']), true);
}

console.log('\nedges');
{
  is('no technologies, no boxes',   M.boxesFor('RRU5909', []), []);
  is('and none at all',             M.boxesFor('RRU5909', null), []);
  is('a blank model',               M.boxesFor('', ['L1800']), [['L1800']]);
  is('one technology is always one box', M.sameBox('anything', ['L900']), true);
  is('every listed radio has at least one group',
     M.RADIOS.every(r => r.groups.length > 0 && r.groups.every(g => g.length > 0)), true);
  is('and every one says where it came from',
     M.RADIOS.every(r => typeof r.note === 'string' && r.note.length > 20), true);
  is('the table knows the models the books use',
     ['RRU5909','Radio 2271','RRU 4490 B1+B3','RRU5910','Radio 4415','RRU5818']
       .every(m => !!M.lookup(m)), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
