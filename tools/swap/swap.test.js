/* node tools/swap/swap.test.js
   The rules the warehouse's sheet depends on, checked without a browser. */
const S = require('./swap.js');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};
const ok = (name, cond) => is(name, !!cond, true);

/* ---- serials, however they arrive ---- */
is('typed serial', S.cleanSerial(' 2102310abc '), '2102310ABC');
is('SN: prefix', S.cleanSerial('SN: 2102310ABC'), '2102310ABC');
is('S/N with dash', S.cleanSerial('S/N - 2102310ABC'), '2102310ABC');
is('serial no.', S.cleanSerial('Serial No. 2102310ABC'), '2102310ABC');
is('wedge newline', S.cleanSerial('2102310ABC\n'), '2102310ABC');
is('gs1 element', S.cleanSerial('(21)2102310ABC'), '2102310ABC');
is('nothing', S.cleanSerial(''), '');

/* ---- the material list ---- */
const MI = S.materialIndex([
  { code: '100001', desc: 'RRU5301 900MHz', type: 'Radio', vendor: 'Huawei' },
  { code: '100002', desc: 'AAU5613 Antenna', type: 'Antenna', vendor: 'Huawei' },
  { code: '200010', desc: 'Feeder jumper 1/2"', type: 'Jumper', vendor: '' }
]);
is('code finds name', S.findMaterial(MI, '100001').name, 'RRU5301 900MHz');
is('code is case blind', S.findMaterial(MI, ' 100001 ').name, 'RRU5301 900MHz');
is('unknown code', S.findMaterial(MI, '999'), null);
is('suggest by code', S.suggest(MI, '1000').map(m => m.code), ['100001', '100002']);
is('suggest by name', S.suggest(MI, 'jumper').map(m => m.code), ['200010']);

/* ---- what a record must have ---- */
const rec = () => {
  const r = S.blank();
  r.airtelSite = 'ATL123'; r.dialogSite = 'CML0421';
  r.items = [{ from:'airtel', code:'100001', name:'RRU5301 900MHz', qty:2, dest:'wh',
               remapSite:'', remapName:'', note:'',
               serials:[{ sn:'SN1', photo:'swap/a.jpg' }, { sn:'SN2', photo:'swap/b.jpg' }] }];
  return r;
};
ok('a full record files', S.check(rec()).ok);

let r = rec(); r.airtelSite = ''; r.dialogSite = '';
is('no site at all', S.check(r).missing, ['at least one of the two site IDs']);

r = rec(); r.removed = 'both'; r.dialogSite = '';
ok('both towers needs both IDs', S.check(r).missing.includes('both site IDs'));

r = rec(); r.items = [];
ok('nothing removed', S.check(r).missing.includes('at least one material'));

r = rec(); r.items[0].code = '';
ok('a line with no code', S.check(r).missing.includes('a material code on every line'));

r = rec(); r.items[0].qty = 0;
ok('a line with no quantity', S.check(r).missing.includes('a quantity on every line'));

r = rec(); r.items[0].dest = 'remap';
ok('remapped needs a site', S.check(r).missing.includes('the site a remapped material is going to'));
r.items[0].remapSite = 'CML9999';
ok('remapped with a site is fine', S.check(r).ok);

r = rec(); r.items[0].serials[1].photo = null;
ok('a serial with no photo', S.check(r).missing.some(m => /photo for serial SN2/.test(m)));

r = rec(); r.items[0].serials = [{ sn:'', photo:null }];
ok('material with no serial at all is fine', S.check(r).ok);

/* ---- codes off the list ---- */
r = rec(); r.items[0].code = '999999';
ok('the team may not invent a code', S.check(r, { index: MI }).missing.some(m => /999999/.test(m)));
ok('the owner may', S.check(r, { index: MI, owner: true }).ok);

/* ---- who may change what ---- */
const filed = { createdBy: 'u1' };
ok('the filer may edit their own', S.editableFor(filed, 'u1', false));
ok('somebody else may not', !S.editableFor(filed, 'u2', false));
ok('the owner may edit anything', S.editableFor(filed, 'u2', true));

/* ---- the sheet ---- */
const full = S.fromRow({
  id:'x', airtel_site:'atl123', airtel_name:'Airtel Kandy', dialog_site:'cml0421',
  dialog_name:'Union Place', removed:'airtel', visited_on:'2026-09-22', team:'Team A',
  note:'tower down', created_name:'kasun', created_at:'2026-09-22T06:30:00Z',
  items:[
    { from:'airtel', code:'100001', name:'RRU5301 900MHz', qty:2, dest:'wh',
      serials:[{ sn:'sn1', photo:'p1' }, { sn:'sn2', photo:'p2' }] },
    { from:'dialog', code:'200010', name:'Feeder jumper 1/2"', qty:5, dest:'remap',
      remapSite:'cml9999', remapName:'Nugegoda', serials:[], note:'to the new hub' }
  ]
});
const rows = S.toRows([full], { p1:'https://link/one' });
is('a row per serial, plus the one with none', rows.length, 3);
is('columns line up', rows[0].length, S.COLS.length);
is('swap name', rows[0][0], 'ATL123 / CML0421');
is('site IDs are upper', [rows[0][1], rows[0][3]], ['ATL123', 'CML0421']);
is('which tower came down', rows[0][5], 'Airtel tower removed');
is('which tower this came off', rows[0][6], 'Airtel');
is('the serial', rows[0][12], 'SN1');
is('a signed link when there is one', rows[0][13], 'https://link/one');
is('the raw path when there is not', rows[1][13], 'p2');
is('the second material is the dialog one', rows[2][6], 'Dialog');
is('remapped says where', [rows[2][14], rows[2][15]], ['Remapped to a site', 'CML9999']);
is('no serial, still a row', rows[2][12], '');

is('totals', S.totals([full]), { records:1, lines:2, pieces:7, serials:2, remapped:1, waiting:2 });

/* ---- where it has been, and so where it is ---- */
const trip = { from:'airtel', code:'1', qty:1, serials:[], moves:[
  { to:'team', on:'2026-09-22' }, { to:'wh', on:'2026-10-02' },
  { to:'site', site:'cml9999', siteName:'Nugegoda', on:'2026-10-10' }] };
const visit = { visitedOn:'2026-09-22', items:[trip] };
is('where it is now', S.whereLabel(S.whereNow(trip)), 'Installed at CML9999');
is('the journey starts at the tower it came off',
   S.timeline(visit, trip).map(x => x.label),
   ['Off the Airtel tower', 'With the team', 'At the warehouse', 'Installed at CML9999']);
is('the journey as one line', S.chainText(visit, trip),
   'Off the Airtel tower (2026-09-22) → With the team (2026-09-22) → At the warehouse (2026-10-02) → Installed at CML9999 (2026-10-10)');

/* straight from the tower to another site, never seeing the warehouse */
const direct = { from:'airtel', code:'2', qty:1, serials:[], moves:[{ to:'site', site:'cml8888', on:'2026-09-22' }] };
is('straight onto another site', S.chainText({ visitedOn:'2026-09-22' }, direct),
   'Off the Airtel tower (2026-09-22) → Installed at CML8888 (2026-09-22)');

/* a line filed before there were journeys still answers */
is('an older line', S.chainText({ visitedOn:'2026-09-22' }, { from:'dialog', at:'wh', atOn:'2026-10-02' }),
   'Off the Dialog tower (2026-09-22) → At the warehouse (2026-10-02)');

ok('a step onto a site has to say which site',
   S.check({ ...rec(), items:[{ ...rec().items[0], moves:[{ to:'site', site:'' }] }] })
    .missing.includes('the site a material went onto'));

is('what is still out there', S.totals([{ items:[
  { code:'1', qty:1, serials:[], moves:[{ to:'team' }] },
  { code:'2', qty:1, serials:[], moves:[{ to:'wh' }] },
  { code:'3', qty:1, serials:[], moves:[{ to:'site', site:'X' }] }] }]).waiting, 1);

/* ---- both towers name the job, each tower collects on its own ---- */
is('the task is named by both', S.swapTitle(full), 'ATL123 Airtel Kandy / CML0421 Union Place');
is('one tower only', S.swapTitle({ airtelSite:'atl1', airtelName:'A' }), 'ATL1 A');

/* ---- the sheet carries the journey ---- */
const jr = S.toRows([{ ...full, items:[trip] }], {});
is('where it is now, in the sheet', jr[0][S.COLS.indexOf('Where It Is Now')], 'Installed at CML9999');
is('since, in the sheet', jr[0][S.COLS.indexOf('Since')], '2026-10-10');
ok('the movement column has the whole chain', /At the warehouse/.test(jr[0][S.COLS.indexOf('Movement')]));

/* ---- the site index ---- */
const idx = S.buildIndex({ cols:['Site_ID','Site_Name','Other_Site_IDS'],
                           rows:[['CML0421','Union Place Tower','CO-421, CML421']] });
is('by its own ID', S.findSite(idx, 'cml0421'), 'Union Place Tower');
is('by another name for it', S.findSite(idx, 'CML421'), 'Union Place Tower');
is('a site nobody knows', S.findSite(idx, 'ZZZ'), '');

console.log((fail ? 'FAILED ' : 'ok ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
