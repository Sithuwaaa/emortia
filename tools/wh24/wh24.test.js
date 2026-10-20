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

/* Reading a GIN moved out of here with the function: both SAP documents are
   read by tools/_lib/sapdocs.js now, and every assertion that was here is in
   tools/_lib/sapdocs.test.js, against SAPDocs.readAny. */

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

/* ---- and WHERE it was found, which is the half the counter needs ----

   A hit has to name the field, because "this ticket" does not tell you
   which of three material lines carried the serial you typed. */
const found = (q) => W.matchesAt(F, q);
is('a serial says it is a serial',      found('ea8d945522')[0].label, 'Serial');
is('and gives the value as stored',     found('ea8d945522')[0].value, 'EA8D945522');
is('with the run it matched',           [found('ea8d945522')[0].at, found('ea8d945522')[0].len], [0, 10]);
is('a GI number names itself',          found('4932180605')[0].label, 'GI number');
is('a material code too',               found('1000026380')[0].label, 'Material code');
is('a partial site hit keeps its offset', [found('5049')[0].label, found('5049')[0].at], ['Site', 2]);
is('a description hit says so',         found('RADIO')[0].label, 'Description');
is('a miss finds nowhere',              found('KU0361'), []);
is('an empty query is not a search',    found(''), []);
is('and the boolean still agrees with it',
   [W.matches(F, 'RADIO'), W.matches(F, 'nope'), W.matches(F, '')], [true, false, true]);

/* the shortest, most exact field wins: 25293 is the ticket, and it also
   appears nowhere else - but when a value is in two places the exact one
   must lead, or searching a reservation reports a Description */
const Two = { id: 1772833, reservation: '1772833', lines: [
  { code: 'X', desc: 'note for 1772833', gin: { res: '1772833', gi: '1', sn: [] } }] };
is('exact whole-value hit leads', W.matchesAt(Two, '1772833')[0].label, 'Ticket');
is('and the buried one is not first',
   W.matchesAt(Two, '1772833').map(h => h.label).indexOf('Description') > 0, true);
is('every place it occurs is kept', W.matchesAt(Two, '1772833').length, 4);

/* ---- the sheet ---- */
const sh = W.sheet([T, R], { '25490|': { collected_on: null } }, '2026-10-01');
is('headers', sh[0].length, 29);
is('the four appended ones name the source and stream', sh[0].slice(25),
   ['Source', 'Stream', 'Project / PM Order', 'Activity / GRN No']);
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
/* tickets are listed by (id, stream) now, because a PH2 card contributes two
   of them and "ticket 25490" is no longer one thing */
is('pick list only counts what can be collected', pk.map(p => [p.code, p.qty, p.tickets]),
   [['1000017512', 3, ['10|', '11|']], ['1000008167', 2, ['10|']]]);
is('issued qty wins and serials counted', [pk[0].qty, pk[0].sn, pk[0].uom], [3, 3, 'EA']);
is('a typed date takes it off the list',
   W.pickList([A, B], { '11|': { collected_on: '2026-10-01' } })[0].tickets, ['10|']);
is('and a mark keyed on the id alone no longer reaches it - the pair is the key',
   W.pickList([A, B], { 11: { collected_on: '2026-10-01' } })[0].tickets, ['10|', '11|']);
is('pipeline', W.pipeline([A, B, C, D], {}).filter(p => p.n).map(p => [p.state, p.n]),
   [['issuing', 1], ['ready', 2], ['collected', 1]]);

is('no check before it is issued', W.sheet([{ id: 1, stage: 'System Issuance Pending', lines: [{ code: '1', qty: 1 }] }], {}, '2026-10-01')[1][24], '');
/* ---- every reservation on a ticket, not just the card's own field ----
   Invented numbers throughout: the repo is public and a fixture is published
   the moment it is committed. */
is('no ticket', W.reservations(null), []);
is('nothing to find', W.reservations({ id: 1 }), []);
is('one on the card', W.reservations({ reservation: '9000001' }), ['9000001']);
is('the card already holds two', W.reservations({ reservation: '9000001 / 9000002' }),
   ['9000001', '9000002']);
is('a comma-separated list', W.reservations({ reservation: '9000001, 9000002' }),
   ['9000001', '9000002']);
/* the case that made this worth writing: the note names one the card does not */
is('a GIN carries one the card never mentioned',
   W.reservations({ reservation: '9000001', gins: [{ res: '9000003' }] }),
   ['9000001', '9000003']);
is('the same one twice is still one',
   W.reservations({ reservation: '9000001', gins: [{ res: '9000001' }] }), ['9000001']);
is('lines count too',
   W.reservations({ reservation: '', lines: [{ gin: { res: '9000004' } }] }), ['9000004']);
is('a line without a GIN is not a reservation',
   W.reservations({ reservation: '9000001', lines: [{ code: 'MAT-0000001' }] }), ['9000001']);
is('order is first seen',
   W.reservations({ reservation: '9000002', gins: [{ res: '9000001' }, { res: '9000003' }] }),
   ['9000002', '9000001', '9000003']);
is('blanks and stray separators are dropped',
   W.reservations({ reservation: ' / 9000001 /  / ' }), ['9000001']);

/* ---- how old is this screen ----
   Every assertion fixes `now`, so these say what the function computes rather
   than what time the suite happened to run. The levels are read off the
   returned object, not off a class name a page might paint. */
const NOW = '2026-10-11T12:00:00Z';
const fr = (o) => W.freshness(Object.assign({ now: NOW }, o));
const at = (h) => new Date(Date.parse(NOW) - h * 3600000).toISOString();

is('nothing has ever been synced', [fr({}).level, fr({}).hours, fr({}).headline],
   ['never', null, 'Never synced']);
is('a check an hour ago is fresh', fr({ checkedAt: at(1) }).level, 'ok');
/* the two thresholds, from both sides, because an off-by-one here is a page
   that says "up to date" about yesterday's numbers */
is('just inside twelve hours', fr({ checkedAt: at(11.99) }).level, 'ok');
is('twelve hours exactly', fr({ checkedAt: at(12) }).level, 'warn');
is('just inside a day', fr({ checkedAt: at(23.99) }).level, 'warn');
is('a day exactly', fr({ checkedAt: at(24) }).level, 'bad');
is('the thresholds themselves', [W.FRESH_WARN, W.FRESH_BAD], [12, 24]);
is('the age is in hours', fr({ checkedAt: at(3) }).hours, 3);

/* The point of the whole thing: a check that found nothing is NOT the same as
   never having checked, and the two must not come back looking alike. */
is('checked, and nothing had moved',
   [fr({ checkedAt: at(1), changed: 0 }).level, fr({ checkedAt: at(1), changed: 0 }).result],
   ['ok', 'nothing had moved']);
is('checked, and three had', fr({ checkedAt: at(1), changed: 3 }).result, '3 tickets changed');
is('one is not three', fr({ checkedAt: at(1), changed: 1 }).result, '1 ticket changed');
is('a check with no count reports no result', fr({ checkedAt: at(1) }).result, null);
is('never checked has no result to report', fr({ updatedAt: at(1) }).result, null);

/* A row write with no check behind it still dates the screen - that is the
   pre-038 case, and it must not read as "never". */
is('a row write alone still dates it',
   [fr({ updatedAt: at(30) }).level, fr({ updatedAt: at(30) }).headline], ['bad', 'Out of date']);
is('the check wins over the row write', fr({ checkedAt: at(1), updatedAt: at(40) }).level, 'ok');
is('both stamps come back out',
   [fr({ checkedAt: at(1), updatedAt: at(40) }).checkedAt === at(1),
    fr({ checkedAt: at(1), updatedAt: at(40) }).updatedAt === at(40)], [true, true]);
is('who checked and what was on screen',
   [fr({ checkedAt: at(1), checkedBy: 'sithara', tickets: 61 }).checkedBy,
    fr({ checkedAt: at(1), checkedBy: 'sithara', tickets: 61 }).tickets], ['sithara', 61]);
/* the sentence under the headline, per level - the button is useless without it */
is('every level says why, in a sentence',
   ['never', 'bad', 'warn', 'ok'].map(lv => {
     const o = lv === 'never' ? fr({}) : fr({ checkedAt: at(lv === 'bad' ? 30 : lv === 'warn' ? 15 : 1) });
     return o.level === lv && /^[A-Z].*[.]$/.test(o.why);
   }), [true, true, true, true]);
is('the warn sentence names the threshold', fr({ checkedAt: at(15) }).why,
   'Nobody has asked WorkHub24 in over 12 hours.');
is('no em dash in the copy',
   ['never', 'bad', 'warn', 'ok'].map(lv => {
     const o = lv === 'never' ? fr({}) : fr({ checkedAt: at(lv === 'bad' ? 30 : lv === 'warn' ? 15 : 1) });
     return (o.why + o.headline).indexOf('—') < 0;
   }), [true, true, true, true]);

/* ---- what has happened, this week ----
   Synthetic ids and site codes throughout: the repo is public. */
const nAt = h => new Date(Date.parse(NOW) - h * 3600000).toISOString();
/* a ticket whose state is decided by the fields, not asserted by the fixture:
   stage 'Material Reservation - Infomate Team' is reserving, done_at makes it
   ready, 'Material Shortage - ACE' is a shortage. */
const tk = (id, o) => Object.assign({ id, stream: '', site: 'ZZ0001', site_name: 'Test_Site',
  stage: 'Material Reservation - Infomate Team', timeline: [], lines: [], gins: [] }, o);
const NEWS = (ts, mk, o) => W.news(ts, mk || {}, Object.assign({ now: NOW }, o));

/* the states are derived, not declared - if this drifts the rest is noise */
is('the fixture really is reserving then ready then shortage',
   [W.state(tk(1), null), W.state(tk(1, { done_at: nAt(50) }), null),
    W.state(tk(1, { stage: 'Material Shortage - ACE' }), null)],
   ['reserving', 'ready', 'shortage']);

/* 1. a move the sync actually recorded */
const moved = NEWS([tk(9001, { synced_at: nAt(3), prev_state: 'reserving', done_at: nAt(4) })]);
is('a real move says what it was and what it is',
   moved.map(e => [e.id, e.kind, e.prev, e.state]), [[9001, 'move', 'reserving', 'ready']]);
is('and carries the time it happened', moved[0].at, nAt(3));

/* 2. THE CORRECTION: a fresh stamp is not a state change */
is('prev_state equal to the state reads as an update, not a verdict',
   NEWS([tk(9002, { synced_at: nAt(2), prev_state: 'reserving' })])
     .map(e => [e.kind, e.prev]), [['update', null]]);
is('prev_state null is unknown, and still not a verdict',
   NEWS([tk(9003, { synced_at: nAt(2), prev_state: null })])
     .map(e => [e.kind, e.prev]), [['update', null]]);
is('a column that does not exist is the same unknown',
   NEWS([tk(9004, { synced_at: nAt(2) })]).map(e => e.kind), ['update']);
is('the empty string is a new ticket, which null must not be confused with',
   NEWS([tk(9005, { synced_at: nAt(2), prev_state: '' })]).map(e => [e.kind, e.state]),
   [['new', 'reserving']]);

/* 3. the week, from both sides */
is('six days ago is in, eight days ago is out',
   NEWS([tk(9006, { synced_at: nAt(24 * 6), prev_state: '' }),
         tk(9007, { synced_at: nAt(24 * 8), prev_state: '' })]).map(e => e.id), [9006]);
is('the window is a week', W.NEWS_DAYS, 7);
is('and it can be asked for a different one',
   NEWS([tk(9008, { synced_at: nAt(24 * 3), prev_state: '' })], {}, { days: 2 }).length, 0);

/* 4. newest first */
is('newest first', NEWS([tk(9010, { synced_at: nAt(50), prev_state: '' }),
                         tk(9011, { synced_at: nAt(2), prev_state: '' }),
                         tk(9012, { synced_at: nAt(20), prev_state: '' })]).map(e => e.id),
   [9011, 9012, 9010]);

/* 5. THE CORRECTION: a mass republish collapses to one line and is not hidden */
const massAt = nAt(5);
const mass = [];
for (let i = 0; i < 60; i++) mass.push(tk(9100 + i, { synced_at: massAt, prev_state: 'reserving' }));
/* twelve real changes, at a different stamp, which must survive it */
for (let i = 0; i < 12; i++)
  mass.push(tk(9200 + i, { synced_at: nAt(4), prev_state: 'reserving', done_at: nAt(4) }));
const mixed = NEWS(mass);
is('sixty rows written together become one entry, twelve real ones stay',
   [mixed.length, mixed.filter(e => e.kind === 'batch').length], [13, 1]);
const batch = mixed.find(e => e.kind === 'batch');
is('the batch says how big it was and keeps its rows to open',
   [batch.n, batch.events.length, batch.at], [60, 60, massAt]);
is('the twelve real moves are not inside it',
   mixed.filter(e => e.kind === 'move').map(e => e.id).sort((a, b) => a - b),
   [9200, 9201, 9202, 9203, 9204, 9205, 9206, 9207, 9208, 9209, 9210, 9211]);
is('the real ones are newest first, above the batch', mixed[0].kind, 'move');
is('the threshold is fifty', W.NEWS_BULK, 50);
is('fifty exactly is not a mass republish, fifty-one is',
   [NEWS(Array.from({ length: 50 }, (_, i) => tk(9300 + i, { synced_at: nAt(6), prev_state: '' })))
      .filter(e => e.kind === 'batch').length,
    NEWS(Array.from({ length: 51 }, (_, i) => tk(9400 + i, { synced_at: nAt(6), prev_state: '' })))
      .filter(e => e.kind === 'batch').length], [0, 1]);
/* the size is counted over every row held, not only the ones in the window -
   otherwise a maintenance sync eight days old would decollapse as it aged */
const aged = [];
for (let i = 0; i < 60; i++) aged.push(tk(9500 + i, { synced_at: nAt(24 * 8), prev_state: '' }));
is('a mass publish outside the window produces nothing at all', NEWS(aged).length, 0);

/* 6. a hand-marked collection, which never touches the ticket row */
const marked = NEWS([tk(9600, { synced_at: nAt(60), prev_state: 'reserving' })],
                    { '9600|': { ticket_id: 9600, stream: '', collected_on: '2026-10-10',
                                 collected_by: 'ruwan', updated_at: nAt(1) } });
is('a mark is an event even when the row is older than the week',
   marked.map(e => [e.id, e.kind, e.state, e.by, e.at]),
   [[9600, 'mark', 'collected', 'ruwan', nAt(1)]]);
is('a mark claims no previous state, because nobody recorded one', marked[0].prev, null);
is('the row wins when the row is newer',
   NEWS([tk(9601, { synced_at: nAt(1), prev_state: 'reserving', done_at: nAt(9) })],
        { '9601|': { ticket_id: 9601, stream: '', updated_at: nAt(5) } })
     .map(e => [e.kind, e.prev, e.state, e.at]), [['move', 'reserving', 'ready', nAt(1)]]);
is('a mark never joins a batch',
   NEWS(mass.concat([tk(9602, { synced_at: massAt, prev_state: 'reserving' })]),
        { '9602|': { ticket_id: 9602, stream: '', collected_on: '2026-10-10',
                     collected_by: 'ruwan', updated_at: nAt(1) } })
     .filter(e => e.kind === 'mark').length, 1);

/* 7. PH2 keeps its two streams apart */
is('two streams on one ticket are two entries',
   NEWS([tk(9700, { stream: 'ACE', synced_at: nAt(2), prev_state: '' }),
         tk(9700, { stream: 'Advantis', synced_at: nAt(3), prev_state: '' })])
     .map(e => e.key), ['9700|ACE', '9700|Advantis']);

/* 8. nothing to say */
is('no tickets', NEWS([]), []);
is('a ticket that has never been written says nothing', NEWS([tk(9800)]), []);
is('null tickets are survived', NEWS([null, tk(9801, { synced_at: nAt(1), prev_state: '' })]).length, 1);

/* 9. the unread count, which is what the badge shows */
const feed = NEWS([tk(9900, { synced_at: nAt(1), prev_state: '' }),
                   tk(9901, { synced_at: nAt(10), prev_state: '' }),
                   tk(9902, { synced_at: nAt(30), prev_state: '' })]);
is('everything is unread when nothing has been seen', W.newsUnseen(feed, null), 3);
is('unseen is strictly newer than the stamp', W.newsUnseen(feed, nAt(10)), 1);
is('nothing is unread once the latest has been seen', W.newsUnseen(feed, nAt(0)), 0);
is('a rubbish stamp is treated as having seen nothing', W.newsUnseen(feed, 'not a date'), 3);
is('a collapsed publish counts as the one line it draws, not its sixty rows',
   W.newsUnseen(NEWS(mass), nAt(24 * 7)), 13);

/* ---- written, versus moved -------------------------------------------

   The footer said "689 changed" while the feed said "689 re-synced,
   nothing changed", one above the other, and both were counting the same
   rows. sig() decides whether to WRITE and rightly includes WorkHub's own
   wh_updated_at; sigReal() decides whether anything MOVED and must not.

   Both live in the page rather than this module, so they are lifted out
   and executed here - what is asserted is their behaviour, not their
   text. If either is renamed this test fails loudly rather than silently
   checking nothing. */
{
  const fs = require('fs'), path = require('path');
  const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  /* Regex LITERALS, not strings handed to new RegExp: a string loses every
     backslash to the string parser first, so \s becomes s and the pattern
     quietly matches nothing. That failed loudly here only because lift
     throws when it finds nothing - which is exactly why it throws. */
  const lift = (name, re) => {
    const m = re.exec(page);
    if (!m) throw new Error(name + ' not found in index.html - was it renamed?');
    return eval('(' + m[1] + ')');
  };
  const sig = lift('sig', /const sig = (t => JSON\.stringify\(\[[\s\S]*?\]\));/);
  const sigReal = lift('sigReal', /const sigReal = (t => JSON\.stringify\(\[[\s\S]*?\]\));/);
  const base = { site: 'QQ0248', site_name: 'Inv', wo: 'W', reservation: '1780194',
    stage: 'System Issuance Done - ACE', team: 'T', status: 'S',
    wh_created_at: '2026-10-13T00:00:00Z', wh_updated_at: '2026-10-19T08:08:00Z',
    done_at: null, wh_collected_at: null, timeline: [{ n: 'A', s: 'DONE', c: '1', d: '2' }],
    lines: [{ code: 'X' }], gins: [], phase: 'PH1', workflow: 'w' };
  const copy = (f) => { const o = JSON.parse(JSON.stringify(base)); f(o); return o; };
  const wrote = (b) => sig(base) !== sig(b);
  const moved = (b) => sigReal(base) !== sigReal(b);

  is('identical: neither',            [wrote(base), moved(base)], [false, false]);
  /* the whole point: WorkHub bumps its stamp across the estate in bulk */
  is('WorkHub stamp only: write, no move',
     [wrote(copy(o => o.wh_updated_at = '2026-10-19T09:30:00Z')),
      moved(copy(o => o.wh_updated_at = '2026-10-19T09:30:00Z'))], [true, false]);
  is('timeline timestamps only: write, no move',
     [wrote(copy(o => o.timeline[0].d = '3')),
      moved(copy(o => o.timeline[0].d = '3'))], [true, false]);
  /* and the things that must always count as a move */
  is('a stage move counts',    moved(copy(o => o.stage = 'Material Shortage - ACE')), true);
  is('documents arriving counts', moved(copy(o => o.gins = [{ gi: '1' }])), true);
  is('a collection counts',    moved(copy(o => o.wh_collected_at = '2026-10-20T00:00:00Z')), true);
  is('material lines count',   moved(copy(o => o.lines = [{ code: 'Y' }])), true);
  is('a reservation appearing counts', moved(copy(o => o.reservation = '1780195')), true);
  /* anything that moves must also be written - a move the writer misses
     would never reach the database at all */
  ['stage', 'reservation', 'site'].forEach(k => {
    is('a changed ' + k + ' is also written', wrote(copy(o => o[k] = 'ZZZ')), true);
  });
}


/* ---- the digest: what a person reads after a sync ---------------------

   news() gives one entry per event, which after a maintenance run is six
   hundred lines of "re-synced" with the two real changes buried in them.
   newsDigest buckets per publish, groups by where each ticket LANDED, and
   counts the quiet rows without listing them.

   The quiet case matters most: a sync that ran and found nothing must not
   look like a failure, because that is the glance that decides whether to
   open the tool at all. */
{
  const NOW = '2026-10-19T12:00:00Z';
  const ago = h => new Date(Date.parse(NOW) - h * 3600000).toISOString();
  const RESERVING = 'Material Reservation - Infomate Team';
  const mk = (id, stage, at) => ({ id: id, stream: '', site: 'QQ0' + id, site_name: 'Inv',
    stage: stage, synced_at: at, timeline: [], lines: [], gins: [] });
  const busy = ago(1), quietRun = ago(3);

  /* two rejected and one brand new in the busy run, sixty rewritten in the
     earlier one. prev_state is set from the state the row computes to, so
     "quiet" means what it says rather than what the fixture asserts. */
  const rows = [];
  for (let i = 1; i <= 2; i++){ const t = mk(200 + i, 'Rejected', busy); t.prev_state = 'reserving'; rows.push(t); }
  const fresh = mk(300, RESERVING, busy); fresh.prev_state = ''; rows.push(fresh);
  for (let i = 1; i <= 60; i++){
    const t = mk(400 + i, RESERVING, quietRun); t.prev_state = W.state(t, null); rows.push(t);
  }
  const d = W.newsDigest(W.news(rows, {}, { now: NOW, days: 7 }));

  is('one bucket per publish',        d.syncs.length, 2);
  is('newest publish first',          d.syncs[0].at, busy);
  is('the busy run moved three',      d.syncs[0].moved, 3);
  is('and it groups by where they landed',
     d.syncs[0].groups.map(g => g.key + 'x' + g.n), ['rejectedx2', 'newx1']);
  is('a new ticket is its own group, not folded into a state',
     d.syncs[0].groups.filter(g => g.kind === 'new').length, 1);
  is('every grouped ticket is still named',
     d.syncs[0].groups[0].items.map(x => x.id).sort(), [201, 202]);

  /* the maintenance run */
  is('the quiet run moved nothing',   d.syncs[1].moved, 0);
  is('and counted all sixty',         d.syncs[1].quiet, 60);
  is('with no groups to draw',        d.syncs[1].groups.length, 0);

  /* THE QUIET CASE ON ITS OWN - the shape the headline is written from */
  const onlyQuiet = [];
  for (let i = 1; i <= 689; i++){
    const t = mk(500 + i, RESERVING, busy); t.prev_state = W.state(t, null); onlyQuiet.push(t);
  }
  const q = W.newsDigest(W.news(onlyQuiet, {}, { now: NOW, days: 7 }));
  is('a sync where nothing moved is still a sync', q.syncs.length, 1);
  is('nothing moved',                 q.syncs[0].moved, 0);
  is('all of it is quiet',            q.syncs[0].quiet, 689);
  is('and there is nothing to list',  q.syncs[0].groups.length, 0);

  /* a row written before 044 says "unknown", which is NOT "unchanged" */
  const old = mk(600, RESERVING, busy); old.prev_state = null;
  const u = W.newsDigest(W.news([old], {}, { now: NOW, days: 7 }));
  is('an unknown previous state is not counted as quiet', u.syncs[0].quiet, 0);
  is('it is reported as having moved',  u.syncs[0].moved, 1);

  /* a hand-typed collection date belongs to no sync */
  const marked = mk(700, RESERVING, busy); marked.prev_state = W.state(marked, null);
  const m = W.newsDigest(W.news([marked],
    { '700|': { collected_on: '2026-10-19', updated_at: ago(0.5), collected_by: 'S' } },
    { now: NOW, days: 7 }));
  is('a mark is its own list, not bucketed into a publish', m.byHand.length, 1);
  is('and does not inflate a sync bucket', m.syncs.length, 0);
}

/* ---- 31 September -----------------------------------------------------

   localDay accepts any YYYY-MM-DD shape without asking the calendar, so an
   impossible day travels intact. realDay is the question; the marking and
   the warning live at nice() on the page. */
is('realDay accepts a real day',       W.realDay('2026-10-20'), true);
is('realDay rejects 31 September',     W.realDay('2026-09-31'), false);
is('realDay rejects 31 November',      W.realDay('2026-11-31'), false);
is('realDay rejects 31 April',         W.realDay('2026-04-31'), false);
is('realDay rejects month 13',         W.realDay('2026-13-01'), false);
is('realDay rejects day 00',           W.realDay('2026-10-00'), false);
is('realDay rejects a loose shape',    W.realDay('2026-9-5'), false);
is('realDay rejects a timestamp',      W.realDay('2026-10-20T08:00:00Z'), false);
is('realDay rejects nothing at all',   W.realDay(''), false);
is('29 Feb 2024 is a real day',        W.realDay('2024-02-29'), true);
is('29 Feb 2026 is not',               W.realDay('2026-02-29'), false);
is('localDay still lets it through',   W.localDay('2026-09-31'), '2026-09-31');

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
