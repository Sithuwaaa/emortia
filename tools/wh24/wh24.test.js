/* node tools/wh24/wh24.test.js
   The rules the collection list depends on, checked without a browser.
   Dates are read in Colombo time, as the page reads them. */
process.env.TZ = 'Asia/Colombo';
const W = require('./wh24.js');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- the task names, all three spellings ---- */
is('team after dash', W.splitTask('System Issuance Done - ACE'), { stage: 'System Issuance Done', team: 'ACE' });
is('no space before team', W.splitTask('System Issuance Pending -Advantis'), { stage: 'System Issuance Pending', team: 'Advantis' });
is('infomate', W.splitTask('Material Reservation - Infomate Team'), { stage: 'Material Reservation', team: 'Infomate Team' });
is('rejection is not a team', W.splitTask('Material Reservation Request -Reservation Rejection'),
   { stage: 'Reservation Rejected', team: 'Infomate Team' });
is('no team at all', W.splitTask('Vendor Allocation'), { stage: 'Vendor Allocation', team: '' });

/* ---- numbers and dates off the GIN ---- */
is('thousands', W.num('3,500.00'), 3500);
is('plain', W.num('24.00'), 24);
is('nothing', W.num(''), null);
is('sap date', W.ginDate('30.09.2026'), '2026-09-30');
is('advantis date is month first', W.ginDate('08/07/2026'), '2026-08-07');
is('junk date', W.ginDate('Cost Centre :'), '');

/* ---- reading a GIN ----
   A page laid out the way the PDFs are: headings on one row, then the lines.
   x positions are the real ones, rounded. */
const H = [[30,'#'],[50,'ITEM CODE'],[118,'DESCRIPTION'],[230,'UOM'],[270,'QTY'],[320,'S/N'],[430,'LOCATION']];
const head = (y, extra) => (extra || []).concat(
  [[40, 700, 'GI Number :4932180605'], [40, 690, 'Document Date :30.09.2026'],
   [40, 680, 'Reservation number :1772833'], [40, 670, 'WBS :'], [40, 660, 'Cost Centre :'],
   [40, 650, 'Issue from S Loc :7390'], [40, 640, 'Movement Type : 281 Q']]
  .map(([x, yy, s]) => ({ x, y: yy, s })))
  .concat(H.map(([x, s]) => ({ x, y, s })));
const row = (y, cells) => cells.map(([x, s]) => ({ x, y, s }));

const page1 = head(600).concat(
  row(580, [[32,'1'],[50,'1000026308'],[118,'RADIO 4490'],[232,'EA'],[272,'1.00'],[320,'DH80390178'],[430,'MR5049_Toow']]),
  row(572, [[118,'44B1 44B3'],[430,'ay_Solu_25293']]),
  row(560, [[32,'2'],[50,'1000024598'],[118,'HUA_PWR_CABLE'],[232,'M 3,500.00'],[430,'MR5049']]),
  row(540, [[32,'3'],[50,'1000018112'],[118,'SFP+'],[232,'EA'],[272,'3.00'],[320,'2000355441201']]),
  row(532, [[320,'2000355441670']]),
  row(100, [[40,'------------------------------------------------']]),
  row(90,  [[40,'Issued by'],[300,'Received by']]),
  row(80,  [[40,'Page No 1 / 2']])
);
/* page two repeats the header and the last row's serials carry on */
const page2 = head(600).concat(
  row(580, [[320,'2000355443279']]),
  row(100, [[40,'------------------------------------------------']]),
  row(80,  [[40,'Page No 2 / 2']])
);
const gin = W.readGin([page1, page2]);
is('gin number', gin.gi, '4932180605');
is('gin date', gin.date, '2026-09-30');
is('reservation', gin.res, '1772833');
is('empty WBS is not the next heading', gin.wbs, '');
is('s.loc', gin.sloc, '7390');
is('movement', gin.mv, '281 Q');
is('three lines, no footer row', gin.items.length, 3);
is('wrapped description joins', gin.items[0].desc, 'RADIO 4490 44B1 44B3');
is('one serial', gin.items[0].sn, ['DH80390178']);
is('unit and qty in one piece', [gin.items[1].uom, gin.items[1].qty], ['M', 3500]);
is('serials run onto page two', gin.items[2].sn, ['2000355441201', '2000355441670', '2000355443279']);
is('serial count matches qty', gin.items[2].sn.length, gin.items[2].qty);
is('footer never becomes a serial', gin.items.every(i => i.sn.every(x => !/Page/.test(x))), true);

/* ---- pairing what was asked with what was issued ---- */
const lines = W.match(
  [{ code:'1000026380', qty:'1', uom:'EA' }, { code:'1000026380', qty:'1', uom:'EA' },
   { code:'1000029192', qty:'18', uom:'EA' }, { code:'1000021104', qty:'2', uom:'' }],
  [{ gi:'G1', res:'R1', date:'2026-09-30', items:[
     { code:'1000026380', qty:1, uom:'EA', sn:['EA8D945522'] },
     { code:'1000029192', qty:18, uom:'EA', sn:[] },
     { code:'1000026380', qty:1, uom:'EA', sn:['EA8D945514'] },
     { code:'1000099999', qty:4, uom:'EA', sn:[] } ] }]);
is('repeat lines pair off in order', lines.slice(0, 2).map(l => l.gin.sn[0]), ['EA8D945522', 'EA8D945514']);
is('qty carried', lines[2].gin.qty, 18);
is('not issued', lines[3].gin, null);
is('issued but never asked for is kept', [lines[4].code, lines[4].extra], ['1000099999', true]);
is('checks', lines.map(W.issueCheck), ['Full', 'Full', 'Full', 'Not in GIN', 'Extra in GIN']);
is('partial', W.issueCheck({ qty: 5, gin: { qty: 3 } }), 'Partial');

/* ---- a whole ticket, from 25307 as WorkHub has it ---- */
const T = W.record({
  id: 25307, site: 'cm5756', siteName: 'Yasorapura_Rd_Lamp', reservation: '1675015',
  requested: [{ code: '1000029192', desc: '7_16-DIN Male to 4.3-10 Female Adapter', qty: 18, uom: 'EA' }],
  timeline: [
    { n: 'System Issuance Done - ACE', s: 'DONE', c: '2026-09-28T14:24:02Z', d: '2026-09-30T07:31:47Z' },
    { n: 'Material Reservation - Infomate Team', s: 'DONE', c: '2026-09-21T09:32:06Z', d: '2026-09-22T06:46:26Z' },
    { n: 'System Issuance Pending - ACE', s: 'DONE', c: '2026-09-22T06:46:45Z', d: '2026-09-28T14:23:39Z' } ],
  gins: [{ file: '1675015.pdf', gi: '4932166689', date: '2026-09-28', res: '1675015', sloc: '7390',
           items: [{ code: '1000029192', qty: 18, uom: 'EA', sn: [] }] }]
});
is('site upper', T.site, 'CM5756');
is('timeline sorted', T.timeline.map(t => t.n.slice(0, 22)),
   ['Material Reservation -', 'System Issuance Pendin', 'System Issuance Done -']);
is('stage when nothing is open', [T.stage, T.team, T.status], ['System Issuance Done', 'ACE', 'completed']);
is('ready from', T.done_at, '2026-09-28T14:24:02Z');
is('collected in workhub', T.wh_collected_at, '2026-09-30T07:31:47Z');
is('newest event', T.wh_updated_at, '2026-09-30T07:31:47Z');
is('ready on (colombo)', W.localDay(T.done_at), '2026-09-28');
is('collected on (colombo)', W.collectedOn(T), '2026-09-30');
is('state', W.state(T), 'collected');
is('two days on the shelf', W.waiting(T, null, '2026-10-01'), 2);

/* ---- waiting, and the date the counter knows better ---- */
const R = W.record({ id: 25490, site: 'BD5071', requested: [],
  timeline: [{ n: 'System Issuance Pending - ACE', s: 'DONE', c: '2026-09-30T04:23:00Z', d: '2026-09-30T12:33:00Z' },
             { n: 'System Issuance Done - ACE', s: 'NEW', c: '2026-09-30T12:33:00Z', d: null }] });
is('open task is current', [R.stage, R.status], ['System Issuance Done', 'inprogress']);
is('ready', W.state(R), 'ready');
is('counting', W.waiting(R, null, '2026-10-04'), 4);
is('a typed date stops it', W.waiting(R, { collected_on: '2026-10-02' }, '2026-10-04'), 2);
is('and makes it collected', W.state(R, { collected_on: '2026-10-02' }), 'collected');
is('a typed date beats workhub', W.collectedOn(T, { collected_on: '2026-09-29' }), '2026-09-29');
is('an emptied mark falls back', W.collectedOn(T, { collected_on: null }), '2026-09-30');

/* ---- still with ACE ---- */
const P = W.record({ id: 25485, timeline: [
  { n: 'Material Reservation - Infomate Team', s: 'DONE', c: '2026-09-29T07:09:00Z', d: '2026-09-29T10:14:00Z' },
  { n: 'System Issuance Pending - ACE', s: 'NEW', c: '2026-09-29T10:14:00Z', d: null }] });
is('issuing', W.state(P), 'issuing');
is('not waiting on us', W.waiting(P, null, '2026-10-01'), null);
is('days with ACE', W.issuing(P, '2026-10-01'), 2);
is('shortage', W.state({ stage: 'Material Shortage' }), 'shortage');
is('rejected', W.state({ stage: 'Reservation Rejected' }), 'rejected');
is('reserving', W.state({ stage: 'Material Reservation' }), 'reserving');

/* ---- a ticket that went round twice is ready from the second issue ---- */
const Twice = W.record({ id: 1, timeline: [
  { n: 'System Issuance Done - ACE', s: 'DONE', c: '2026-09-01T00:00:00Z', d: '2026-09-02T00:00:00Z' },
  { n: 'Material Shortage - ACE', s: 'DONE', c: '2026-09-02T00:00:00Z', d: '2026-09-03T00:00:00Z' },
  { n: 'System Issuance Done - ACE', s: 'NEW', c: '2026-09-05T00:00:00Z', d: null }] });
is('last done wins', [W.localDay(Twice.done_at), Twice.wh_collected_at], ['2026-09-05', null]);

/* ---- finding ---- */
const F = { id: 25293, site: 'MR5049', site_name: 'Midigama_Lamp', lines: [
  { code: '1000026380', desc: 'RADIO 2271 B8', gin: { res: '1772833', gi: '4932180605', sn: ['EA8D945522'] } }] };
is('by serial', W.matches(F, 'ea8d945522'), true);
is('by gi', W.matches(F, '4932180605'), true);
is('by site', W.matches(F, 'mr50'), true);
is('miss', W.matches(F, 'KU0361'), false);

/* ---- the sheet ---- */
const sh = W.sheet([T, R], { 25490: { collected_on: null } }, '2026-10-01');
is('headers', sh[0].length, 25);
is('ticket row', [sh[1][0], sh[1][14], sh[1][15], sh[1][16]], [25307, '2026-09-28', '2026-09-30', '']);
is('waiting row', [sh[2][0], sh[2][14], sh[2][15], sh[2][16]], [25490, '2026-09-30', '', 1]);
is('gin columns', [sh[1][18], sh[1][20], sh[1][24]], ['4932166689', 18, 'Full']);

/* ---- the dashboard ---- */
const A = { id: 10, done_at: '2026-09-30T10:00:00Z', lines: [
  { code: '1000017512', desc: 'HW DCDU-12B0', qty: 1, uom: 'EA', gin: { qty: 2, uom: 'EA', sn: ['X1', 'X2'] } },
  { code: '1000008167', desc: 'Power Cables Flex 35mm', qty: 2, uom: 'M', gin: null } ] };
const B = { id: 11, done_at: '2026-09-29T10:00:00Z', lines: [
  { code: '1000017512', desc: 'HW DCDU-12B0', qty: 1, uom: 'EA', gin: { qty: 1, uom: 'EA', sn: ['X3'] } } ] };
const C = { id: 12, done_at: '2026-09-29T10:00:00Z', wh_collected_at: '2026-09-30T10:00:00Z',
            lines: [{ code: '1000017512', qty: 5, gin: { qty: 5 } }] };
const D = { id: 13, stage: 'System Issuance Pending', lines: [] };
const pk = W.pickList([A, B, C, D], {});
is('pick list only counts what can be collected', pk.map(p => [p.code, p.qty, p.tickets]),
   [['1000017512', 3, [10, 11]], ['1000008167', 2, [10]]]);
is('issued qty wins and serials counted', [pk[0].qty, pk[0].sn, pk[0].uom], [3, 3, 'EA']);
is('a typed date takes it off the list', W.pickList([A, B], { 11: { collected_on: '2026-10-01' } })[0].tickets, [10]);
is('pipeline', W.pipeline([A, B, C, D], {}).filter(p => p.n).map(p => [p.state, p.n]),
   [['issuing', 1], ['ready', 2], ['collected', 1]]);

is('no check before it is issued', W.sheet([{ id: 1, stage: 'System Issuance Pending', lines: [{ code: '1', qty: 1 }] }], {}, '2026-10-01')[1][24], '');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
