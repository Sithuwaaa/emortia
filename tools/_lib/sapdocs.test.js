/* node tools/_lib/sapdocs.test.js
   The two SAP documents, read without a browser.

   The GIN half of this file is the readGin block out of wh24.test.js, moved
   here with the function it tested. Nothing it asserted has been dropped: the
   same fixture pages, the same expected values, now against SAPDocs.readAny.
   Fixtures are invented - no real site code, serial or material number. */
process.env.TZ = 'Asia/Colombo';
const SAP = require('./sapdocs.js');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* ================================================== a GOODS ISSUE NOTE ====
   A page laid out the way the PDFs are: headings on one row, then the lines.
   x positions are the real ones, rounded. */
const H = [[30,'#'],[50,'ITEM CODE'],[118,'DESCRIPTION'],[230,'UOM'],[270,'QTY'],[320,'S/N'],[430,'LOCATION']];
const head = (y, extra) => (extra || []).concat(
  [[40, 700, 'GI Number :4930000001'], [40, 690, 'Document Date :30.09.2026'],
   [40, 680, 'Reservation number :1700001'], [40, 670, 'WBS :'], [40, 660, 'Cost Centre :'],
   [40, 650, 'Issue from S Loc :7390'], [40, 640, 'Movement Type : 281 Q']]
  .map(([x, yy, s]) => ({ x, y: yy, s })))
  .concat(H.map(([x, s]) => ({ x, y, s })));
const row = (y, cells) => cells.map(([x, s]) => ({ x, y, s }));

const page1 = head(600).concat(
  row(580, [[32,'1'],[50,'1000000308'],[118,'RADIO 4490'],[232,'EA'],[272,'1.00'],[320,'SN-TEST-0178'],[430,'ZZ0001_Invt']]),
  row(572, [[118,'44B1 44B3'],[430,'ed_Place_0001']]),
  row(560, [[32,'2'],[50,'1000000598'],[118,'HUA_PWR_CABLE'],[232,'M 3,500.00'],[430,'ZZ0001']]),
  row(540, [[32,'3'],[50,'1000000112'],[118,'SFP+'],[232,'EA'],[272,'3.00'],[320,'SN-TEST-1201']]),
  row(532, [[320,'SN-TEST-1670']]),
  row(100, [[40,'------------------------------------------------']]),
  row(90,  [[40,'Issued by'],[300,'Received by']]),
  row(80,  [[40,'Page No 1 / 2']])
);
/* page two repeats the header and the last row's serials carry on */
const page2 = head(600).concat(
  row(580, [[320,'SN-TEST-3279']]),
  row(100, [[40,'------------------------------------------------']]),
  row(80,  [[40,'Page No 2 / 2']])
);

const r = SAP.readAny([page1, page2]);
is('a GIN is recognised as one', r.kind, 'gin');
is('and no movement document comes back', r.move, undefined);

const gin = r.gin;
is('gin number', gin.gi, '4930000001');
is('gin date', gin.date, '2026-09-30');
is('reservation', gin.res, '1700001');
is('empty WBS is not the next heading', gin.wbs, '');
is('s.loc', gin.sloc, '7390');
is('movement keeps its letter', gin.mv, '281 Q');
is('three lines, no footer row', gin.items.length, 3);
is('wrapped description joins', gin.items[0].desc, 'RADIO 4490 44B1 44B3');
is('one serial', gin.items[0].sn, ['SN-TEST-0178']);
is('unit and qty in one piece', [gin.items[1].uom, gin.items[1].qty], ['M', 3500]);
is('serials run onto page two', gin.items[2].sn, ['SN-TEST-1201', 'SN-TEST-1670', 'SN-TEST-3279']);
is('serial count matches qty', gin.items[2].sn.length, gin.items[2].qty);
is('footer never becomes a serial', gin.items.every(i => i.sn.every(x => !/Page/.test(x))), true);

/* the GIN Extractor's own shape, off the same pages */
const doc = SAP.parse([page1, page2]);
is('the richer document is a gin too', doc.kind, 'gin');
is('it carries the plant fields the extractor shows', 'plantName' in doc && 'slocName' in doc, true);
is('and the same three items', doc.items.length, 3);
is('with serials under sns', doc.items[0].sns, ['SN-TEST-0178']);
is('the extractor narrows movement type to digits', doc.movType, '281');

/* ---- the Issue from SLoc label, both ways SAP sets it ----
   One fragment on the Advantis note ("SLoc"), two on the warehouse one
   ("S" "Loc"). readGin only matched the second and so lost the value on
   every Advantis GIN. */
{
  const squashed = head(600).map(f => f.s === 'Issue from S Loc :7390'
    ? { x: f.x, y: f.y, s: 'Issue from SLoc :2458' } : f)
    .concat(row(580, [[32,'1'],[50,'1000000308'],[118,'X'],[232,'EA'],[272,'1.00']]));
  is('SLoc with no space is read', SAP.readAny([squashed]).gin.sloc, '2458');
}

/* ===================================== an ACTIVITY REPORT (asset movement) */
const MH = [[28,'No.'],[51,'Equipment'],[150,'Code'],[200,'Material'],[260,'Mat. Desc.'],[414,'UoM'],[439,'Serial Number']];
const mhead = (y) => [
  [40, 700, 'Activity Report No.'], [240, 700, ': 10000001'],
  [40, 690, 'Created By'], [240, 690, ': ACE_TESTER'],
  [40, 680, 'Created On'], [240, 680, ': 27.11.2025'],
  [40, 670, 'Status'], [240, 670, ': Notification in process'],
  [40, 660, 'Maintenance Plant'], [240, 660, ': 2000'],
  [40, 650, 'Description'], [240, 650, ': ZZ0002_Invented_Place_0002'],
  [40, 640, 'Sending Func. Location'], [240, 640, ': ZZ-AAA000-ZZZ-AAA'],
  [40, 630, 'Receiving Func. Location'], [240, 630, ': ZZ-BBB000-ZZZ-BBB'],
  [40, 620, 'Equipment / Asset Movement']
].map(([x, yy, s]) => ({ x, y: yy, s }))
 .concat(MH.map(([x, s]) => ({ x, y, s })));

const mpage1 = mhead(600).concat(
  row(580, [[28,'1'],[51,'2010000001'],[150,'RDEP'],[200,'1000000886'],[260,'HUA_RRU_TEST_900MHz'],[414,'EA'],[439,'SN-MOVE-00001']]),
  row(560, [[28,'2'],[51,'2010000002'],[150,'RDEP'],[200,'1000000886'],[260,'HUA_RRU_TEST_900MHz'],[414,'EA'],[439,'SN-MOVE-0000']]),
  row(552, [[439,'2']]),                      /* SAP wraps a serial mid-token */
  row(100, [[40,'____________']]),
  row(90,  [[40,'Issued by'],[300,'Received by']]),
  row(80,  [[40,'Page : 1 / 1']])
);

const mv = SAP.parse([mpage1]);
is('an activity report is recognised', mv.kind, 'move');
is('report number', mv.rep, '10000001');
is('created on', mv.createdOn, '27.11.2025');
is('the site is in the description', mv.descr, 'ZZ0002_Invented_Place_0002');
is('sending location', mv.sendLoc, 'ZZ-AAA000-ZZZ-AAA');
is('receiving location', mv.recvLoc, 'ZZ-BBB000-ZZZ-BBB');
is('two rows, no footer', mv.items.length, 2);
is('one row per serialised unit', mv.items.map(i => i.equip), ['2010000001', '2010000002']);
is('all redeployed', [...new Set(mv.items.map(i => i.code))], ['RDEP']);
is('a wrapped serial joins with nothing between', mv.items[1].sn, 'SN-MOVE-00002');
is('no quantity column on this form', 'qty' in mv.items[0], false);

/* THE ACTIVITY REPORT IS ACE'S ISSUANCE DOCUMENT.
   This used to assert gin === null - that the report produced nothing - and
   that assertion WAS the bug: every PH2 ACE stream ended up with no note,
   never ready, and in Needs checking for a reason that was not true. The
   ordering test settled it the other way: the report's Created On is the day
   the card's own "System Issuance Done - ACE" task opened. */
const mr = SAP.readAny([mpage1]);
is('readAny says movement', mr.kind, 'move');
is('and hands back a usable document, not null', !!mr.gin, true);
is('with the movement document whole too', mr.move.items.length, 2);
is('the date is Created On, which is the only date this form carries',
   mr.gin.date, '2025-11-27');
is('and the field it came from is recorded, not implied', mr.gin.date_field, 'Created On');
is('the report number stands in for a GI number', [mr.gin.gi, mr.gin.rep], ['', '10000001']);
is('no reservation on this form, and none invented', mr.gin.res, '');
is('one line per material, not per unit', mr.gin.items.length, 1);
is('and the quantity IS the number of serialised units',
   [mr.gin.items[0].code, mr.gin.items[0].qty], ['1000000886', 2]);
is('with every serial kept', mr.gin.items[0].sn, ['SN-MOVE-00001', 'SN-MOVE-00002']);
is('a GIN says which field ITS date came from as well',
   SAP.readAny([page1, page2]).gin.date_field, 'Document Date');
is('and the two are told apart by kind',
   [SAP.readAny([page1, page2]).gin.kind, mr.gin.kind], ['gin', 'move']);

/* ---- the dates ---- */
is('sap date', SAP.isoDate('30.09.2026'), '2026-09-30');
is('advantis date is month first', SAP.isoDate('08/07/2026'), '2026-08-07');
is('junk date', SAP.isoDate('Cost Centre :'), '');
is('nothing', SAP.isoDate(''), '');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
