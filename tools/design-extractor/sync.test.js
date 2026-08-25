/* sync.test.js - what gets written when a design book is uploaded again.

     node tools/design-extractor/sync.test.js

   The rule this file protects: re-sending the same book must write nothing,
   and a book covering one batch must not disturb the batches around it. */

const S = require('./sync.js');

let pass = 0, fail = 0;
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(56) + show(got) + (ok ? '' : '   want ' + show(want)));
}

const site = (id, extra) => Object.assign({ siteId: id, sectorCount: 3,
  sectors: [{ sector: 1, azimuth: 0 }], rruByModel: { 'RRU5909 (GL900)': 1 } }, extra || {});
const have = list => list.reduce((m, s) => (m[S.idOf(s)] = S.fingerprint(s), m), {});

console.log('\nwhich book is this');
{
  is('the MBB name',   S.scopeOf('2026_MBB_New Sites_Design (9).xlsx'), 'MBB');
  is('the HBB name',   S.scopeOf('2025_HBB_Upgrade_Batch_04_H.xlsx'), 'HBB');
  is('lower case too', S.scopeOf('2026_mbb_new sites.xlsx'), 'MBB');
  /* no name to go on: read it off the technologies instead */
  is('by content, HBB', S.scopeOf('book.xlsx', [{ technologies:['L2300(HBB)'] }]), 'HBB');
  is('by content, MBB', S.scopeOf('book.xlsx', [{ technologies:['G900','L900'] }]), 'MBB');
  is('neither, so neither', S.scopeOf('book.xlsx', [{ technologies:['L2600'] }]), 'OTHER');
  is('nothing at all',  S.scopeOf('', []), 'OTHER');
}

console.log('\na fingerprint says the same thing twice');
{
  const a = site('MU5051');
  is('the same site reads the same',   S.fingerprint(a), S.fingerprint(site('MU5051')));
  /* key order is not guaranteed, and without sorting two identical reads hash
     differently and every site looks changed */
  const reordered = { rruByModel:{ 'RRU5909 (GL900)':1 }, sectors:[{ azimuth:0, sector:1 }],
                      sectorCount:3, siteId:'MU5051' };
  is('key order does not matter',      S.fingerprint(reordered), S.fingerprint(a));
  is('a moved azimuth shows',
     S.fingerprint(site('MU5051', { sectors:[{ sector:1, azimuth:120 }] })) !== S.fingerprint(a), true);
  is('an extra radio shows',
     S.fingerprint(site('MU5051', { rruByModel:{ 'RRU5909 (GL900)':2 } })) !== S.fingerprint(a), true);
  /* when it was read is not what it says */
  is('a new timestamp does not count as a change',
     S.fingerprint(site('MU5051', { savedAt:'2026-08-24' })), S.fingerprint(a));
  is('nor does the file it came from',
     S.fingerprint(site('MU5051', { batch:'batch 5' })), S.fingerprint(a));
  is('it is short and printable',      /^[0-9a-f]{8}$/.test(S.fingerprint(a)), true);
}

console.log('\nuploading the same book again');
{
  const book = [site('MU5051'), site('KI5032'), site('BD5071')];
  const p = S.plan(book, have(book));
  is('nothing is written',        p.write.length, 0);
  is('and all three are known',   p.counts, { added:0, changed:0, unchanged:3, total:3 });
  is('it says so plainly',        S.summarise(p, 'MBB'),
     'MBB · nothing has moved - all 3 sites are as they were.');
}

console.log('\none site moved, the rest did not');
{
  const before = [site('MU5051'), site('KI5032'), site('BD5071')];
  const after  = [site('MU5051'), site('KI5032', { sectors:[{ sector:1, azimuth:120 }] }), site('BD5071')];
  const p = S.plan(after, have(before));
  is('one write, not three',      p.write.length, 1);
  is('and it is the right one',   p.changed[0].siteId, 'KI5032');
  is('the others are left alone', p.counts, { added:0, changed:1, unchanged:2, total:3 });
  is('the sentence names it',     S.summarise(p, 'MBB'), 'MBB · 1 changed, 2 unchanged.');
  is('and it can say what moved',
     S.fieldsChanged(before[1], after[1]), ['sectors']);
}

console.log('\na site that was not there before');
{
  const before = [site('MU5051')];
  const after  = [site('MU5051'), site('NEW001')];
  const p = S.plan(after, have(before));
  is('the new one is added',      p.added.map(x => x.siteId), ['NEW001']);
  is('nothing else is touched',   p.counts, { added:1, changed:0, unchanged:1, total:2 });
  is('the sentence counts it',    S.summarise(p, 'HBB'), 'HBB · 1 new site, 1 unchanged.');
}

console.log('\na batch file must not wipe the batches around it');
{
  /* batch 5 covers three sites; the server holds two hundred from batches
     1 to 4. Those are not in this file and must not be deleted. */
  const server = have([site('OLD1'), site('OLD2'), site('OLD3'), site('OLD4')]);
  const batch5 = [site('NEW1'), site('NEW2')];
  const p = S.plan(batch5, server);
  is('only the batch is written',     p.write.map(x => x.siteId), ['NEW1','NEW2']);
  is('the rest are reported, not cut', p.untouched.sort(), ['OLD1','OLD2','OLD3','OLD4']);
  is('and none of them are in write',
     p.write.some(w => /^OLD/.test(w.siteId)), false);
}

console.log('\nthe same site listed twice in one book');
{
  /* The 2025 HBB book does this for 32 of its 103 rows: one row with the
     antennas, the region and the vendor, and a second that is the site ID and
     almost nothing else. Whichever came first used to win, so half of them
     arrived on the server empty. */
  const real  = site('CM0837', { district:'Colombo', antennaCount:6, rruCount:3,
                                 sectors:[{ sector:1, active:true }, { sector:2, active:true }] });
  const empty = { siteId:'CM0837', sectors:[], flags:['no active sector'] };

  is('the full row scores higher',  S.substance(real) > S.substance(empty), true);
  is('blank first, full second',    S.plan([empty, real], {}).write[0].site.district, 'Colombo');
  is('full first, blank second',    S.plan([real, empty], {}).write[0].site.district, 'Colombo');
  is('and it is still one site',    S.plan([real, empty], {}).counts.total, 1);
  is('the antennas survive',        S.plan([empty, real], {}).write[0].site.antennaCount, 6);
  /* and the fingerprint has to be the full row's, or the next upload sees a
     change that never happened */
  is('the fingerprint is the full row\'s',
     S.plan([empty, real], {}).write[0].fingerprint, S.fingerprint(real));
  is('an empty row on its own is still kept',
     S.plan([empty], {}).counts.total, 1);
}

console.log('\nwhich project a site belongs to');
{
  /* the MBB book names it per row and holds nineteen batches in one file */
  is('the row wins when it names one',
     S.projectOf({ siteId:'A', batchName:'2026_MBB_New Sites_Design_Batch_08' }, 'book.xlsx'),
     '2026_MBB_New Sites_Design_Batch_08');
  /* the HBB book has no such column, so the file stands in */
  is('the file stands in when it does not',
     S.projectOf({ siteId:'A' }, '2025_HBB_Upgrade_Batch_04_H.xlsx'),
     '2025_HBB_Upgrade_Batch_04_H');
  is('a dash is not a project',
     S.projectOf({ siteId:'A', batchName:'-' }, 'book.xlsx'), 'book');
  is('one file, many projects',
     S.projectsIn([{ siteId:'A', batchName:'B08' }, { siteId:'B', batchName:'B12' },
                   { siteId:'C', batchName:'B08' }], 'f.xlsx'),
     [{ project:'B08', count:2 }, { project:'B12', count:1 }]);
  is('and the plan records it',
     S.plan([{ siteId:'A', batchName:'B08' }], {}, { file:'f.xlsx' }).write[0].project, 'B08');
}

console.log('\nthe awkward books');
{
  is('an empty book writes nothing',   S.plan([], have([site('A')])).write.length, 0);
  is('and nothing at all',             S.plan(null, {}).counts.total, 0);
  is('a first upload is all new',      S.plan([site('A'), site('B')], {}).counts,
     { added:2, changed:0, unchanged:0, total:2 });
  /* the same site listed twice in one sheet is one site */
  is('a repeated site is counted once',
     S.plan([site('A'), site('A')], {}).counts.total, 1);
  is('a row with no site ID is skipped',
     S.plan([site(''), site('A')], {}).counts.total, 1);
  is('case and spaces do not make a new site',
     S.plan([site(' mu5051 ')], have([site('MU5051')])).counts.unchanged, 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
