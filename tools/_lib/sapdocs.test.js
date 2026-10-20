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

/* ============================================ DID IT RECOGNISE THE TABLE ===

   The third time this shape cost something: filesOf returning [] on a fetch
   that found nothing, the GIN document count, and this. In every one of them
   the code KNEW recognition had failed and threw that away before returning,
   so an empty result read exactly like a genuine zero.

   What matters here is not that the good cases parse. It is that the bad
   ones can be told apart from each other and from the honest empty:

     a note it reads               items, and tableFound true
     a note with no material rows  no items, and tableFound TRUE - correct,
                                   and the emptiness means something
     a renamed column header       no items, and tableFound FALSE - the rows
                                   are on the paper and were not read
     not one of these documents    no items, and tableFound false

   The renamed-column case is the one that matters. Everything else about
   that document is intact, including its GI number, which is exactly why
   the old proxy waved it through as a successful zero.

   Fixtures are invented throughout - no real material code, serial, site or
   GI number. */

const HDR_OK    = [[30,'#'],[50,'ITEM CODE'],[118,'DESCRIPTION'],[230,'UOM'],[270,'QTY'],[320,'S/N'],[430,'LOCATION']];
/* one label renamed, the way SAP would rename it */
const HDR_DRIFT = [[30,'#'],[50,'MATERIAL CODE'],[118,'DESCRIPTION'],[230,'UOM'],[270,'QTY'],[320,'S/N'],[430,'LOCATION']];

const ginHead = y => [
  [40, y + 100, 'GI Number :4930000777'],
  [40, y + 90,  'Document Date :03.03.2026'],
  [40, y + 80,  'Reservation number :1700777']
].map(([x, yy, s]) => ({ x, y: yy, s }));

const hdrRow = (hdr, y) => hdr.map(([x, s]) => ({ x, y, s }));
const matRow = (y, cells) => cells.filter(c => c[1] !== '').map(([x, s]) => ({ x, y, s }));

const ROW_1 = [[30,'1'],[50,'MAT-ALPHA-01'],[118,'Widget, blue, 2m'],[230,'EA'],[270,'2'],[320,'SNAAA111'],[430,'A01']];
const ROW_2 = [[30,'2'],[50,'MAT-BETA-02'],[118,'Bracket, short'],[230,'EA'],[270,'5'],[430,'B07']];

/* 1 - a note it reads */
const okPages = [ginHead(600).concat(hdrRow(HDR_OK, 600), matRow(585, ROW_1), matRow(570, ROW_2))];
/* 2 - the same note, issuing nothing. The table is there and it is empty. */
const emptyPages = [ginHead(600).concat(hdrRow(HDR_OK, 600))];
/* 3 - the rows are on the paper; SAP renamed one column heading */
const driftPages = [ginHead(600).concat(hdrRow(HDR_DRIFT, 600), matRow(585, ROW_1), matRow(570, ROW_2))];
/* 4 - not one of these documents at all */
const letterPages = [[
  { x: 40, y: 700, s: 'Dear colleague' },
  { x: 40, y: 680, s: 'Please find enclosed the revised schedule.' },
  { x: 40, y: 660, s: 'Kind regards' }
]];
/* 5 - a letter carrying the words, so the signal is not the header fields
   wearing a new name */
const decoyPages = [[
  { x: 40, y: 700, s: 'Memo about stores paperwork' },
  { x: 40, y: 680, s: 'GI Number :4930000777' },
  { x: 40, y: 660, s: 'Please quote it on all correspondence.' }
]];

const okDoc     = SAP.parse(okPages);
const emptyDoc  = SAP.parse(emptyPages);
const driftDoc  = SAP.parse(driftPages);
const letterDoc = SAP.parse(letterPages);
const decoyDoc  = SAP.parse(decoyPages);

is('a note it reads has its lines',       okDoc.items.length, 2);
is('and says it found the table',         okDoc.tableFound, true);
is('first code',                          okDoc.items[0].code, 'MAT-ALPHA-01');
is('second code',                         okDoc.items[1].code, 'MAT-BETA-02');

is('a note issuing nothing has no lines', emptyDoc.items.length, 0);
is('but the table was there',             emptyDoc.tableFound, true);
is('and its GI number was read',          emptyDoc.giNumber, '4930000777');

is('a renamed column yields no lines',    driftDoc.items.length, 0);
is('AND SAYS THE TABLE WAS NOT FOUND',    driftDoc.tableFound, false);
is('though the GI number still reads',    driftDoc.giNumber, '4930000777');

is('a letter has no lines',               letterDoc.items.length, 0);
is('and no table',                        letterDoc.tableFound, false);
is('a decoy letter has no table either',  decoyDoc.tableFound, false);

/* The point of the exercise, as one assertion: the honest empty and the
   unrecognised table are no longer the same answer. */
is('the honest empty differs from the unreadable',
   [emptyDoc.items.length, emptyDoc.tableFound, driftDoc.items.length, driftDoc.tableFound],
   [0, true, 0, false]);

/* THE OLD PROXY, SHOWN FAILING. !giNumber && items.length === 0 is what the
   extractor guessed from. It calls the drifted note good, which is how two
   materials on the paper were reported as a green zero. Kept so nobody
   reintroduces it believing it works. */
const oldProxySaysBad = d => !d.giNumber && d.items.length === 0;
is('the old proxy waved the drifted note through', oldProxySaysBad(driftDoc), false);
is('the signal does not',                          driftDoc.tableFound,       false);

/* ---- the Activity Report: same hole, same fix ---- */
/* the real column header, as the fixture at the top of this file has it -
   the first attempt here invented labels the reader never looks for, which
   made the "drifted" case pass for the wrong reason */
const MH_OK    = [[28,'No.'],[51,'Equipment'],[150,'Code'],[200,'Material'],[260,'Mat. Desc.'],[414,'UoM'],[439,'Serial Number']];
/* Code renamed, which is what moveHeader matches on with /^Code$/ */
const MH_DRIFT = [[28,'No.'],[51,'Equipment'],[150,'Item Code'],[200,'Material'],[260,'Mat. Desc.'],[414,'UoM'],[439,'Serial Number']];
const repHead = y => [
  { x: 40, y: y + 100, s: 'Equipment / Asset Movement' },
  { x: 40, y: y + 90,  s: 'Activity Report No.' },
  { x: 240, y: y + 90, s: ': 900012345' }
];
const REP_ROW = [[28,'1'],[51,'EQ-0001'],[150,'MAT-GAMMA-03'],[200,'MATL-03'],[260,'Radio unit'],[414,'EA'],[439,'SNBBB221']];

const repOk    = [repHead(600).concat(hdrRow(MH_OK, 600),    matRow(585, REP_ROW))];
const repDrift = [repHead(600).concat(hdrRow(MH_DRIFT, 600), matRow(585, REP_ROW))];

const repOkDoc    = SAP.parse(repOk);
const repDriftDoc = SAP.parse(repDrift);

is('the report is recognised as a movement', repOkDoc.kind, 'move');
is('and it says it found the table',         repOkDoc.tableFound, true);
is('a renamed column there reads nothing',   repDriftDoc.items.length, 0);
is('AND SAYS SO',                            repDriftDoc.tableFound, false);
is('while the report number still reads',    repDriftDoc.rep, '900012345');

/* ---- the shapes WH24 actually receives carry it ---- */
const anyOk    = SAP.readAny(okPages);
const anyDrift = SAP.readAny(driftPages);
const anyRep   = SAP.readAny(repDrift);
is('readAny passes the signal on a gin',   anyOk.gin.tableFound, true);
is('and on a drifted gin',                 anyDrift.gin.tableFound, false);
is('and on a drifted report',              anyRep.gin.tableFound, false);
is('a good gin shape still carries lines', anyOk.gin.items.length, 2);

/* WH24's rule as WH24 applies it: a table that was not recognised is refused,
   not stored as a note that issued nothing. */
const wh24Keeps = r => !!(r.gin && r.gin.tableFound !== false);
is('wh24 keeps a readable note',    wh24Keeps(anyOk),    true);
is('wh24 refuses a drifted note',   wh24Keeps(anyDrift), false);
is('wh24 refuses a drifted report', wh24Keeps(anyRep),   false);


/* ------------------------------------ IS THAT CELL ACTUALLY A QUANTITY ---

   tableFound catches a header this reader cannot recognise. It does not
   catch a header it CAN recognise whose columns have moved underneath it:
   values would be filed under the wrong keys and the rows would be
   confidently wrong rather than absent, which is the worse failure because
   it produces numbers somebody acts on.

   That case is not modelled and does not need to be. A description or a
   material code landing in the quantity column is not a number, and that is
   one check.

   NON-EMPTY AND NON-NUMERIC, not merely non-numeric. Empty is legitimate -
   SAP merges the unit and the quantity into one cell and ginShape splits
   them afterwards, so refusing on empty would refuse that repair before it
   ran. These assert both halves. */

const qtyPages = cells => [
  [{ x: 40, y: 700, s: 'GI Number :4930000777' }]
    .concat(HDR_OK.map(([x, s]) => ({ x, y: 600, s })))
    .concat(cells.map(([x, s]) => ({ x, y: 585, s })))
];
const QBASE = [[30,'1'],[50,'MAT-ALPHA-01'],[118,'Widget'],[230,'EA']];
const qtyDoc = q => SAP.parse(qtyPages(QBASE.concat(q === null ? [] : [[270, q]], [[430,'A01']])));

/* the quantities that are real and must keep working */
is('a plain quantity is a number',   qtyDoc('2').items[0].qty, 2);
is('and is read',                    qtyDoc('2').items[0].qtyRead, true);
is('a thousands separator is read',  qtyDoc('3,500.00').items[0].qty, 3500);
is('a decimal is read',              qtyDoc('12.5').items[0].qty, 12.5);

/* ZERO. The old line was parseFloat(...) || it.qty, so a genuine zero was
   falsy and fell back to the raw string "0" - it never became a number at
   all. That had to be fixed before this check could exist, because the
   check would have refused it. The value was wrong, not the rule. */
is('zero is the number zero',        qtyDoc('0').items[0].qty, 0);
is('and zero is a quantity',         qtyDoc('0').items[0].qtyRead, true);
is('zero is not an unread row',      qtyDoc('0').qtyUnread, 0);

/* empty is not the shuffle signature */
is('an empty cell is not a refusal', qtyDoc(null).items[0].qtyRead, true);
is('and counts as nothing unread',   qtyDoc(null).qtyUnread, 0);

/* the merged cell, which ginShape repairs afterwards */
const merged = SAP.readAny(qtyPages([[30,'1'],[50,'MAT-ALPHA-01'],[118,'Cable'],[230,'M 3,500.00'],[430,'A01']]));
is('the merged cell still splits',   merged.gin.items[0].qty, 3500);
is('and the repaired row is read',   merged.gin.items[0].qtyRead, true);
is('and the note is not refused',    merged.gin.qtyUnread, 0);

/* and the shuffle itself, three ways it shows up */
is('a description in the qty cell',  qtyDoc('Bracket').items[0].qtyRead, false);
is('a material code in it',          qtyDoc('MAT-BETA-02').items[0].qtyRead, false);
/* parseFloat('5 EA') is 5, which is not a quantity cell read correctly */
is('a number with a unit after it',  qtyDoc('5 EA').items[0].qtyRead, false);
is('the value is left as found',     qtyDoc('Bracket').items[0].qty, 'Bracket');
is('and the document counts it',     qtyDoc('Bracket').qtyUnread, 1);

/* what the callers do with it - both refuse, the way they refuse tableFound */
const shuffled = SAP.readAny(qtyPages(QBASE.concat([[270,'Bracket'],[430,'A01']])));
is('the shape carries the count',    shuffled.gin.qtyUnread, 1);
is('its table WAS recognised',       shuffled.gin.tableFound, true);
const wh24Keeps2 = r => !!(r.gin && r.gin.tableFound !== false && !r.gin.qtyUnread);
is('wh24 refuses a shuffled note',   wh24Keeps2(shuffled), false);
is('wh24 still keeps a good one',    wh24Keeps2(SAP.readAny(okPages)), true);


console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
