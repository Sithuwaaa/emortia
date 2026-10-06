/* node tools/wh24/widen.test.js
   PH2 and Bulk: the stems, the three readiness rules, and one card becoming
   two rows. PH1 is in here too, asserting that none of it moved.

   Fixtures are invented throughout - no real site code, serial, material code
   or order number. */
process.env.TZ = 'Asia/Colombo';
const W = require('./wh24.js');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* ================================================================ stems === */
is('the team comes off', W.stem('System Issuance Done - ACE'), 'system issuance done');
is('a division suffix comes off', W.stem('Material Reservation Initiation - AP'),
   'material reservation initiat');
is('the other division too', W.stem('Material Reservation Initiation - MW'),
   'material reservation initiat');
is('Initiate and Initiation are one stem',
   [W.stem('Material Reservation Initiate'), W.stem('Material Reservation Initiation')],
   ['material reservation initiat', 'material reservation initiat']);
is('rejection keeps its own stem', W.stem('Material Reservation Initiation Rejection'),
   'material reservation initiat reject');
is('ud approval', W.stem('UD Approval'), 'ud approval');
is('resubmit', W.stem('Resubmit Material Request'), 'resubmit material request');
/* the trap: initiation is a prefix of initiation rejection */
is('a rejection is not matched as an initiation by equality',
   W.stems('Material Reservation Initiation Rejection', 'material reservation initiat'), true);
is('which is why rejection is tested first', W.bulkState(
   { phase: 'Bulk', stage: 'Material Reservation Initiation Rejection' }), 'rejected');

/* ============================================================== PH1 ======= */
/* The same card as wh24.test.js reads, through rowsFor rather than record. */
const ph1 = {
  id: 25307, phase: 'PH1', workflow: 'w-test-ph1', site: 'zz0001', siteName: 'Invented_Place_A',
  reservation: '1700001', created: '2026-09-21T09:30:00Z', updated: '2026-09-30T07:31:47Z',
  requested: [{ code: '1000000192', desc: 'Invented adapter', qty: 18, uom: 'EA' }],
  timeline: [
    { n: 'System Issuance Done - ACE', s: 'DONE', c: '2026-09-28T14:24:02Z', d: '2026-09-30T07:31:47Z' },
    { n: 'Material Reservation - Infomate Team', s: 'DONE', c: '2026-09-21T09:32:06Z', d: '2026-09-22T06:46:26Z' },
    { n: 'System Issuance Pending - ACE', s: 'DONE', c: '2026-09-22T06:46:45Z', d: '2026-09-28T14:23:39Z' } ],
  gins: [{ file: '1700001.pdf', gi: '4930000001', date: '2026-09-28', res: '1700001',
           items: [{ code: '1000000192', qty: 18, uom: 'EA', sn: [] }] }]
};
const r1 = W.rowsFor(ph1);
is('a PH1 card is one row', r1.length, 1);
is('with an empty stream', r1[0].stream, '');
is('ready from the Done task, as before', r1[0].done_at, '2026-09-28T14:24:02Z');
is('collected from the Done task closing, as before', r1[0].wh_collected_at, '2026-09-30T07:31:47Z');
is('state, as before', W.state(r1[0]), 'collected');
is('rowsFor and record agree on PH1', JSON.stringify(r1[0]), JSON.stringify(W.record(ph1)));
is('and nothing added a stage it did not have', r1[0].stage, 'System Issuance Done');

/* ============================================================== PH2 ======= */
const note = (gi, date) => ({ file: gi + '.pdf', gi: gi, date: date, res: '', items: [] });
const ph2 = {
  id: 25490, phase: 'PH2', workflow: 'w-test-ph2', site: 'zz0002', siteName: 'Invented_Place_B',
  wo: 'WO-TEST-0002', created: '2026-02-01T04:00:00Z', updated: '2026-03-20T11:00:00Z',
  /* The stage NAMES here are the real ones, read off a dump of real PH2
     cards - they are the form's structure, not Dialog's data, and inventing
     them is what made the first version of this file test nothing. Every
     value around them is still invented.

     Note what this says about PH2: it reuses PH1's vocabulary rather than
     having collection sections of its own. */
  timeline: [
    { n: 'Material reservation Initiation - AP', s: 'DONE', c: '2026-02-02T04:00:00Z', d: '2026-02-04T04:00:00Z' },
    { n: 'Material Reservation request', s: 'DONE', c: '2026-02-04T04:00:00Z', d: '2026-02-10T04:00:00Z' },
    { n: 'System Issuance Pending - ACE', s: 'DONE', c: '2026-02-10T04:00:00Z', d: '2026-03-01T04:00:00Z' },
    { n: 'System Issuance Done - ACE', s: 'DONE', c: '2026-03-05T04:00:00Z', d: null },
    /* every one of these is on the same card and says nothing about material */
    { n: 'Dependency Clearance', s: 'DONE', c: '2026-02-01T04:00:00Z', d: '2026-02-02T04:00:00Z' },
    { n: 'Commissioning', s: 'OPEN', c: '2026-03-20T11:00:00Z', d: null },
    { n: 'Warehouse Selection', s: 'DONE', c: '2026-02-01T05:00:00Z', d: '2026-02-01T06:00:00Z' },
    { n: 'Vendor Allocation', s: 'DONE', c: '2026-02-01T06:00:00Z', d: '2026-02-01T07:00:00Z' },
    { n: 'Task Acceptance ', s: 'OPEN', c: '2026-03-18T04:00:00Z', d: null },
    { n: 'Remote UAT', s: 'OPEN', c: '2026-03-19T04:00:00Z', d: null },
    { n: 'Document Submission', s: 'DONE', c: '2026-03-17T04:00:00Z', d: '2026-03-18T04:00:00Z' }
  ],
  streams: [
    { stream: 'Advantis', reservation: '1700002', orderNo: '800700000001', grn: 'GRN-TEST-0001',
      requested: [{ code: '1000000511', desc: 'Invented optical module', qty: 16, uom: 'EA' }],
      removed: [{ code: '1000000999', desc: 'Invented removed line', qty: 2, uom: 'EA' }],
      gins: [{ ...note('4930000002', '2026-03-05'), res: '1700002',
               items: [{ code: '1000000511', qty: 16, uom: 'EA',
                         sn: ['SN-TEST-0001', 'SN-TEST-0002'] }] }] },
    { stream: 'ACE', reservation: '1700003', orderNo: '800700000002', grn: 'GRN-TEST-0002',
      requested: [{ code: '1000000886', desc: 'Invented radio unit', qty: 3, uom: 'EA' }],
      gins: [{ ...note('10000001', '2026-03-12'), res: '1700003',
               items: [{ code: '1000000886', qty: 3, uom: 'EA', sn: ['SN-MOVE-0001'] }] }] }
  ]
};
const r2 = W.rowsFor(ph2);
is('ONE PH2 CARD YIELDS TWO ROWS', r2.length, 2);
is('one per vendor stream', r2.map(r => r.stream), ['Advantis', 'ACE']);
is('both carry the same ticket id', [...new Set(r2.map(r => r.id))], [25490]);
is('and the pair is what distinguishes them', r2.map(W.key), ['25490|Advantis', '25490|ACE']);
is('each its own reservation', r2.map(r => r.reservation), ['1700002', '1700003']);
is('each its own order', r2.map(r => r.order_no), ['800700000001', '800700000002']);
is('each its own GRN', r2.map(r => r.grn), ['GRN-TEST-0001', 'GRN-TEST-0002']);
is('each its own material', r2.map(r => r.lines.map(l => l.code)),
   [['1000000511'], ['1000000886']]);

/* --- done_at is the NOTE'S date, not the card's last update --- */
is('Advantis is ready on its note date', r2[0].done_at, '2026-03-05T00:00:00Z');
is('ACE is ready on its own, a week later', r2[1].done_at, '2026-03-12T00:00:00Z');
is('neither took the card last-updated', r2.every(r => r.done_at !== ph2.updated), true);
is('both can collect', r2.map(r => W.state(r)), ['ready', 'ready']);
is('and they waited different lengths',
   r2.map(r => W.waiting(r, null, '2026-03-20')), [15, 8]);

/* --- the collection sections only --- */
is('the non-material sections are gone from the row',
   r2[0].timeline.map(t => t.n),
   ['Material reservation Initiation - AP', 'Material Reservation request',
    'System Issuance Pending - ACE', 'System Issuance Done - ACE']);
is('so Commissioning and Remote UAT being open do not become the stage',
   r2[0].stage, 'System Issuance Done');
is('and the row does not read as in progress because of it', r2[0].status, 'completed');
const task = n => ({ n: n, s: 'DONE', c: null, d: null });
/* the real ones, including the third division and the lower-case r */
is('ph2Material keeps what it should',
   ['Material reservation Initiation - AP', 'Material Reservation Initiate - MW',
    'Material reservation Initiation - WIBAS', 'System Issuance Pending - ACE',
    'System Issuance Done', 'Material Shortage', 'Infomate - ACE',
    'Additional Material Reservation Request',
    'Material Collection Confirmation by Vendor', 'TECO/UNTECO - ACE']
     .map(n => W.ph2Material(task(n))),
   [true, true, true, true, true, true, true, true, true, true]);
is('and refuses the rest',
   ['Dependency Clearance', 'Sub WO 1', 'Commissioning', 'Warehouse Selection',
    'Vendor Allocation', 'Task Acceptance ', 'Remote UAT', 'Document Submission',
    'UAT Decision', 'IPNO', 'Implementation', 'License Issuance - Huawei',
    'Link Acceptance', 'Trigger Supportive Parties']
     .map(n => W.ph2Material(task(n))),
   [false, false, false, false, false, false, false, false,
    false, false, false, false, false, false]);
/* a keep-list, so a section added to the form later is ignored until somebody
   decides it belongs - the opposite way round would let it through unseen */
is('and refuses one nobody has seen yet', W.ph2Material(task('Something New - AP')), false);

/* --- ONE test: reservation present AND note attached, and the NOTE binds --- */
is('a reservation with no note is NEVER ready',
   W.ph2Ready({ reservation: '1700002', gins: [] }), null);
is('a note with no reservation is not ready either',
   W.ph2Ready({ reservation: '', gins: [note('4930000003', '2026-03-05')] }), null);
is('both, and it is', W.ph2Ready({ reservation: '1700002', gins: [note('4930000003', '2026-03-05')] }),
   '2026-03-05T00:00:00Z');
is('a note with no readable date is not a date',
   W.ph2Ready({ reservation: '1700002', gins: [note('4930000003', '')] }), null);

/* --- repeated notes: EARLIEST, and the count is shown --- */
{
  const two = { reservation: '1700002',
                gins: [note('4930000004', '2026-03-10'), note('4930000005', '2026-03-01')] };
  is('two notes take the EARLIEST date', W.ph2Ready(two), '2026-03-01T00:00:00Z');
  is('not the latest', W.ph2Ready(two) === '2026-03-10T00:00:00Z', false);
  is('and the count is carried', W.noteCount(two), 2);
  /* the reason: a second delivery must not make the row younger */
  is('a row does not get younger when a second note lands',
     W.waiting(W.record({ id: 1, doneAt: W.ph2Ready(two), timeline: [] }), null, '2026-03-20'), 19);
  is('which latest-note would have made', W.daysBetween('2026-03-10', '2026-03-20'), 10);
}
{
  const half = JSON.parse(JSON.stringify(ph2));
  half.streams[1].gins = [];
  const rows = W.rowsFor(half);
  /* 'other', and that is the point of the PH2 rule. The card says System
     Issuance Done on this stream - under PH1's rule that alone would make it
     collectable. PH2 does not believe the stage, it believes the document,
     so with no note attached the stream is NOT in Can collect. */
  is('one stream ready, the other not', rows.map(r => W.state(r)), ['ready', 'reserving']);
  is('and the one without a note is NOT collectable, which is the point',
     rows.some(r => W.state(r) === 'ready' && !r.done_at), false);
  is('and the unready one has no date to count from', rows[1].done_at, null);
}

/* --- a card enters only once a stream has a reservation --- */
{
  const early = JSON.parse(JSON.stringify(ph2));
  early.streams.forEach(x => { x.reservation = ''; });
  is('no reservation anywhere, no rows', W.rowsFor(early).length, 0);
  early.streams[0].reservation = '1700002';
  is('one reserved, one row', W.rowsFor(early).map(r => r.stream), ['Advantis']);
}

/* --- removed materials --- */
is('removed lines are kept on the row', r2[0].removed.map(r => r.code), ['1000000999']);
is('and are not in the lines', r2[0].lines.map(l => l.code), ['1000000511']);
is('so they are not in the pick list',
   W.pickList(r2, {}).map(p => p.code).indexOf('1000000999'), -1);
is('the other stream has none', r2[1].removed, []);

/* --- the pick list counts both streams separately --- */
is('both streams reach the pick list',
   W.pickList(r2, {}).map(p => [p.code, p.qty]),
   [['1000000511', 16], ['1000000886', 3]]);
is('a date on one stream does not take the other off',
   W.pickList(r2, { '25490|Advantis': { collected_on: '2026-03-20' } }).map(p => p.code),
   ['1000000886']);

/* ----------------------------------------- which note goes to which stream */
{
  const gin  = { file: 'a.pdf', gi: '4930000002', date: '2026-03-05', res: '1700003', items: [] };
  const rep  = { file: 'b.pdf', gi: '', rep: '10000001', date: '2026-03-12', res: '', items: [] };
  const bare = { ...ph2, streams: ph2.streams.map(x => ({ ...x, gins: [] })) };

  /* deliberately handed over in the WRONG order, and with the GIN's
     reservation belonging to the ACE stream */
  const a = W.attachDocs(bare, [rep, gin]);
  is('the GIN follows its reservation, not its position',
     a.streams.map(x => (x.gins[0] || {}).file), ['b.pdf', 'a.pdf']);

  /* the report placed by its number against the GRN */
  const b2 = W.attachDocs({ ...bare,
    streams: [{ ...bare.streams[0], grn: 'GRN/10000001' }, { ...bare.streams[1], grn: 'GRN-X' }] },
    [rep]);
  is('the Activity Report follows its report number',
     b2.streams.map(x => x.gins.length), [1, 0]);

  /* one stream unplaced and one document unused is the only pairing left */
  const c = W.attachDocs({ ...bare,
    streams: [{ ...bare.streams[0], reservation: '1700002', grn: '' },
              { ...bare.streams[1], reservation: '1700003', grn: '' }] },
    [{ file: 'c.pdf', gi: '', rep: '', res: '1700002', date: '2026-03-01', items: [] },
     { file: 'd.pdf', gi: '', rep: '', res: '', date: '2026-03-09', items: [] }]);
  is('the last one goes to the last stream', c.streams.map(x => (x.gins[0] || {}).file),
     ['c.pdf', 'd.pdf']);

  /* two unplaced is a guess, so neither is placed */
  const d = W.attachDocs(bare,
    [{ file: 'e.pdf', res: '', gi: '', rep: '', date: '2026-03-01', items: [] },
     { file: 'f.pdf', res: '', gi: '', rep: '', date: '2026-03-02', items: [] }]);
  is('two that cannot be told apart are placed nowhere',
     d.streams.map(x => x.gins.length), [0, 0]);
  is('and so neither stream is called ready',
     W.rowsFor(d).map(r => W.state(r)), ['reserving', 'reserving']);
  is('and neither has a date to count a wait from',
     W.rowsFor(d).map(r => r.done_at), [null, null]);

  /* PH1 is untouched by any of this */
  const p = W.attachDocs(ph1, ph1.gins);
  is('a PH1 card just keeps its documents', p.gins.length, 1);
  is('and rowsFor still gives the same row', JSON.stringify(W.rowsFor(p)[0]),
     JSON.stringify(W.record(ph1)));
}

/* ============== PH2 COLLECTION: causality, not pairing ==================== */
{
  const conf = (c, d) => ({ n: 'Material Collection Confirmation by Vendor', s: 'DONE', c: c, d: d });

  /* the real shape of the card that found this bug, with invented values:
     one stream issued long before the other, two confirmations */
  const card = JSON.parse(JSON.stringify(ph2));
  card.streams[0].gins = [{ ...note('4930000010', '2026-03-05'), res: '' }];   /* Advantis */
  card.streams[1].gins = [{ ...note('10000002', '2025-11-27'), res: '' }];     /* ACE, 3 months earlier */
  card.timeline = card.timeline.concat([
    conf('2026-03-07T04:00:00Z', '2026-03-17T04:00:00Z'),
    conf('2026-06-23T04:00:00Z', '2026-09-16T04:00:00Z')
  ]);
  const rows = W.rowsFor(card);
  is('both streams are issued', rows.map(r => W.localDay(r.done_at)), ['2026-03-05', '2025-11-27']);
  /* the point: NOT paired in order. Both take the earliest confirmation that
     closed after their own issuance, which is the same one. */
  is('both clocks stop at the earliest confirmation that closed after issuance',
     rows.map(r => W.localDay(r.wh_collected_at)), ['2026-03-17', '2026-03-17']);
  is('and neither is paired with the September one', rows.every(r =>
     W.localDay(r.wh_collected_at) !== '2026-09-16'), true);
  is('so nothing claims to have waited seven months',
     rows.map(r => W.waiting(r, null, '2026-10-05')), [12, 110]);
  is('and the 312 days is gone', rows.every(r => W.waiting(r, null, '2026-10-05') < 300), true);

  /* one confirmation, two clocks - say so */
  is('both are flagged unattributed', rows.map(r => r.unattributed), [true, true]);
  is('with their own state, not plain collected', rows.map(r => W.state(r)),
     ['collected_un', 'collected_un']);
  is('neither is in Can collect', rows.some(r => W.state(r) === 'ready'), false);
  is('nor in the pick list', W.pickList(rows, {}).length, 0);
  is('the confirmation count is on the row', rows.map(r => r.confirmations), [2, 2]);
  is('and their dates', rows[0].confirmed_on, ['2026-03-17', '2026-09-16']);
  is('and they stay visible in their own band',
     W.pipeline(rows, {}).filter(p => p.n).map(p => [p.state, p.n]), [['collected_un', 2]]);

  /* a confirmation that closed BEFORE a stream was issued cannot be its
     collection - that is the whole rule */
  is('a confirmation before issuance is ignored',
     W.ph2Collected([conf('2026-01-01T04:00:00Z', '2026-01-10T04:00:00Z')], '2026-03-05T00:00:00Z'), null);
  is('one after it is taken',
     W.ph2Collected([conf('2026-03-06T04:00:00Z', '2026-03-17T04:00:00Z')], '2026-03-05T00:00:00Z'),
     '2026-03-17T04:00:00Z');
  is('an unissued stream has no clock to stop',
     W.ph2Collected([conf('2026-03-06T04:00:00Z', '2026-03-17T04:00:00Z')], null), null);
  is('an open confirmation does not stop anything',
     W.ph2Collected([conf('2026-03-06T04:00:00Z', null)], '2026-03-05T00:00:00Z'), null);

  /* one stream and one confirmation is not ambiguous and is not hedged */
  const single = JSON.parse(JSON.stringify(ph2));
  single.streams[0].reservation = '';
  single.streams[1].gins = [{ ...note('10000003', '2026-03-01'), res: '' }];
  single.timeline = single.timeline.concat([conf('2026-03-07T04:00:00Z', '2026-03-17T04:00:00Z')]);
  const one = W.rowsFor(single);
  is('one stream, one confirmation', one.length, 1);
  is('collected, and not hedged', [W.state(one[0]), one[0].unattributed], ['collected', false]);

  /* a typed date is attributed by definition - somebody was there */
  is('a mark beats the inference and is not hedged',
     W.state(rows[0], { collected_on: '2026-03-18' }), 'collected');
}

/* ================= NEEDS CHECKING, AND WHAT MUST NOT GO IN IT ============
   The principle under test: a row the tool can state confidently reads
   plainly. Only the ones it cannot are pulled out. (c) is the important one -
   it proves the exception machinery does not leak onto healthy rows. */
{
  const conf = (c, d) => ({ n: 'Material Collection Confirmation by Vendor', s: 'DONE', c: c, d: d });
  const base = () => JSON.parse(JSON.stringify(ph2));

  /* ---- (a) two streams with done_at, ONE later confirmation ---- */
  {
    const card = base();
    card.streams[0].gins = [{ ...note('4930000020', '2026-03-01'), res: '' }];
    card.streams[1].gins = [{ ...note('10000020', '2026-03-02'), res: '' }];
    card.timeline = card.timeline.concat([conf('2026-03-08T04:00:00Z', '2026-03-12T04:00:00Z')]);
    const r = W.rowsFor(card);
    is('(a) two rows', r.length, 2);
    is('(a) one confirmation stopped both', r.map(x => W.localDay(x.wh_collected_at)),
       ['2026-03-12', '2026-03-12']);
    is('(a) both unattributed', r.map(x => x.unattributed), [true, true]);
    is('(a) confirmations 1', r.map(x => x.confirmations), [1, 1]);
    is('(a) both in Needs checking, for that reason',
       r.map(x => W.needsCheck(x).key), ['unattributed', 'unattributed']);
    const b = W.collectedBracket(r[0]);
    is('(a) one confirmation COLLAPSES the bracket to a single date', b.single, true);
    is('(a) and the two ends are the same day', [b.from, b.to], ['2026-03-12', '2026-03-12']);
    is('(a) with one day count, not a range', [b.days, b.daysMax], [11, 11]);
  }

  /* ---- (b) two streams, two confirmations ---- */
  {
    const card = base();
    card.streams[0].gins = [{ ...note('4930000021', '2026-03-01'), res: '' }];
    card.streams[1].gins = [{ ...note('10000021', '2025-12-01'), res: '' }];
    card.timeline = card.timeline.concat([
      conf('2026-03-08T04:00:00Z', '2026-03-12T04:00:00Z'),
      conf('2026-06-01T04:00:00Z', '2026-09-20T04:00:00Z')
    ]);
    const r = W.rowsFor(card);
    is('(b) both stop at the earliest that qualifies', r.map(x => W.localDay(x.wh_collected_at)),
       ['2026-03-12', '2026-03-12']);
    const b0 = W.collectedBracket(r[0]), b1 = W.collectedBracket(r[1]);
    is('(b) the bracket is a RANGE on both', [b0.single, b1.single], [false, false]);
    is('(b) Advantis: between the two confirmations', [b0.from, b0.to], ['2026-03-12', '2026-09-20']);
    is('(b) and its day range, not the flattering end', [b0.days, b0.daysMax], [11, 203]);
    is('(b) ACE, issued in December, has the wider range', [b1.days, b1.daysMax], [101, 293]);
    is('(b) neither is in Can collect', r.some(x => W.state(x) === 'ready'), false);
    is('(b) nor in the pick list', W.pickList(r, {}).length, 0);
  }

  /* ---- (c) A CLEAN STREAM. Nothing here may be hedged. ---- */
  {
    const card = base();
    card.streams[0].reservation = '';                     /* one stream only */
    card.streams[1].gins = [{ ...note('10000022', '2026-03-01'), res: '' }];
    card.timeline = card.timeline.concat([conf('2026-03-08T04:00:00Z', '2026-03-12T04:00:00Z')]);
    const r = W.rowsFor(card);
    is('(c) one row', r.length, 1);
    is('(c) an EXACT collected date', W.localDay(r[0].wh_collected_at), '2026-03-12');
    is('(c) an EXACT day count', W.waiting(r[0], null, '2026-04-01'), 11);
    is('(c) plain collected, not hedged', W.state(r[0]), 'collected');
    is('(c) NOT unattributed', r[0].unattributed, false);
    is('(c) NOT in Needs checking', W.needsCheck(r[0]), null);
    is('(c) and NO bracket is offered for it', W.collectedBracket(r[0]), null);
  }

  /* ---- every other reason lands in the group, and nothing else does ---- */
  {
    /* site is on these because every real row has one - from a field on PH1
       and Bulk, from the title on PH2 - and a row with none is itself a
       reason to be in the group, which these two are testing the absence of */
    const clean = { id: 1, phase: 'PH1', site: 'ZZ-AAA-001', stage: 'System Issuance Done',
                    done_at: '2026-03-01T04:00:00Z', wh_collected_at: '2026-03-05T04:00:00Z' };
    is('a clean PH1 row is never in the group', W.needsCheck(clean), null);
    const waiting = { id: 2, phase: 'PH1', site: 'ZZ-AAA-001',
                      stage: 'System Issuance Done', done_at: '2026-03-01T04:00:00Z' };
    is('nor is one simply still waiting', W.needsCheck(waiting), null);
    is('but a row with no site code at all IS in it',
       W.needsCheck({ ...clean, site: '' }).key, 'notitle');
    is('and it says which kind of nothing it was',
       W.needsCheck({ ...clean, site: '', title: 'INH_x_nothing_here' }).why,
       'could not read a site code from the card title');

    is('a note with no date', W.needsCheck({ phase: 'PH2', notes: 1, done_at: null }).key, 'nodate');
    is('no note at all', W.needsCheck({ phase: 'PH2', notes: 0, done_at: null }).key, 'nonote');
    is('Bulk approved, no issuance recorded anywhere',
       W.needsCheck({ phase: 'Bulk', done_at: '2026-08-19T09:20:02Z' }).key, 'bulk');
    is('the two status columns disagree',
       W.needsCheck({ phase: 'Bulk', status_agree: false, initiation_status_a: 'Approved',
                      initiation_status_b: 'Rejected', done_at: null }).key, 'status');
    is('a document that would not parse',
       W.needsCheck({ phase: 'PH1', docs_failed: 2, done_at: '2026-03-01T04:00:00Z' }).key, 'unreadable');
    is('and my mark against a card that went backwards',
       W.needsCheck({ phase: 'PH1', stage: 'Reservation Rejected', done_at: null },
                    { collected_on: '2026-03-10' }).key, 'mark');
    is('every reason gives a sentence, not a code',
       ['nodate','nonote','bulk'].every(k => /[a-z]{4,}\s[a-z]/.test(
          W.needsCheck(k === 'bulk' ? { phase:'Bulk', done_at:'2026-08-19T00:00:00Z' }
                                    : { phase:'PH2', notes: k === 'nodate' ? 1 : 0, done_at:null }).why)), true);
  }
}

/* ============ THE CARD'S OWN FIELDS REACH EVERY ROW ======================

   title was added to the card, to record(), to the migration and to the page,
   and NOT to the hand-written copy lists inside rowsFor's PH2 and Bulk
   branches. So PH1 - which hands its raw card straight to record() and needs
   the title least - kept it, while PH2 and Bulk, which have no site field at
   all and need it most, published null on every row.

   These assert the field survives the journey, and the last one asserts it
   generically so the next field added to a card cannot be lost the same way. */
{
  const TITLE = 'INH_Western_ZZ0002_Invented_Place_B_AP Upgrades_New Site Installation_AP_2026_9001_Test Project';
  const card = JSON.parse(JSON.stringify(ph2));
  card.title = TITLE;
  const rows = W.rowsFor(card);
  is('a PH2 card yields rows at all', rows.length, 2);
  is('EVERY PUBLISHED PH2 ROW CARRIES THE CARD TITLE',
     rows.map(r => r.title), [TITLE, TITLE]);
  is('and it is not quietly blank', rows.every(r => !!r.title && r.title.length > 10), true);
  is('the site code is parsed out of it for the chip', rows[0].site, 'ZZ0002');
  is('and the name with it', rows[0].site_name, 'Invented_Place_B');

  /* Bulk too */
  const b = W.rowsFor({ id: 5, phase: 'Bulk', title: 'Material Reservation/ZZ0003/x/y/z/5',
                        site: 'ZZ0003', timeline: [], requested: [],
                        initiationStatusA: '', initiationStatusB: '' })[0];
  is('a Bulk row carries its title too', b.title, 'Material Reservation/ZZ0003/x/y/z/5');

  /* PH1 was never broken, and must stay unbroken */
  is('PH1 still carries it', W.rowsFor({ ...ph1, title: TITLE })[0].title, TITLE);

  /* ---- the general rule, so the NEXT field cannot be dropped ----
     Anything on the card that record() knows how to keep must arrive on every
     row it produces, whatever the source. */
  const probe = { ...JSON.parse(JSON.stringify(ph2)), title: TITLE, wo: 'WO-CARD-9001',
                  created: '2026-01-01T00:00:00Z' };
  ['title', 'wo', 'phase', 'workflow', 'wh_created_at'].forEach(f => {
    const want = f === 'wh_created_at' ? probe.created : probe[f];
    is('every PH2 row inherits ' + f + ' from its card',
       [...new Set(W.rowsFor(probe).map(r => r[f]))], [want]);
  });
  is('and the per-row fields are NOT inherited - the stream differs',
     new Set(W.rowsFor(probe).map(r => r.stream)).size, 2);
  is('the card’s stream list never leaks onto a row',
     W.rowsFor(probe).every(r => r.streams === undefined), true);
}

/* ========= WHAT record() KEEPS ON A DOCUMENT, AND WHAT IT DROPS ==========

   record() rebuilds every gin as a fresh object with a fixed set of keys.
   That is deliberate - it is what keeps a published row to a known shape -
   but it means ANYTHING hung on a parsed document by the sync is gone by the
   time the row exists.

   The PDF bytes were hung on there as __buf. They were dropped here, the
   upload pass filtered on exactly that key, found nothing, uploaded nothing
   and - because both its report lines were conditional on a non-zero count -
   said nothing. The bytes live in a side map now; this pins down the two
   halves of why. */
{
  const g = { file: 'doc.pdf', gi: '4930000030', rep: '', date: '2026-03-05',
              kind: 'gin', date_field: 'Document Date', path: 'ZZ/_/x.pdf',
              items: [{ code: 'MAT-0000001', qty: 1, uom: 'EA', sn: [] }],
              __buf: 'PRETEND BYTES', somethingElse: 'also dropped' };
  const r = W.record({ id: 1, phase: 'PH1', site: 'ZZ-AAA-001', timeline: [], requested: [], gins: [g] });
  const kept = r.gins[0];

  is('the file name survives', kept.file, 'doc.pdf');
  is('the number survives', kept.gi, '4930000030');
  is('the date survives', kept.date, '2026-03-05');
  is('WHICH DATE FIELD it came from survives', kept.date_field, 'Document Date');
  is('the kind survives', kept.kind, 'gin');
  is('THE STORAGE PATH SURVIVES - without it no row can offer a download',
     kept.path, 'ZZ/_/x.pdf');
  is('the lines survive', kept.items.length, 1);

  /* and the half that bit */
  is('bytes do NOT survive, which is why they must not be carried this way',
     kept.__buf, undefined);
  is('nor does anything else the sync hangs on a document',
     kept.somethingElse, undefined);
  is('so a published document is exactly these keys and no more',
     Object.keys(kept).sort().join(','),
     'date,date_field,file,gi,items,kind,mv,path,rep,res,sloc,wbs');

  /* a document with no path must come back as empty string, never undefined -
     the page tests `g.path` to decide whether to draw a download button */
  const nopath = W.record({ id: 2, phase: 'PH1', site: 'ZZ-AAA-001', timeline: [], requested: [],
                            gins: [{ file: 'b.pdf', gi: '1', items: [] }] }).gins[0];
  is('an unstored document has an empty path, not undefined', nopath.path, '');
  is('and the page would draw no button for it', !nopath.path, true);
}

/* ============================================================= Bulk ======= */
const bulk = (stage, status, open, initDone, statusB) => ({
  id: 25600, phase: 'Bulk', workflow: 'w-test-bulk', site: 'zz0003', siteName: 'Invented_Place_C',
  reservation: '1700004', created: '2026-03-01T04:00:00Z', updated: '2026-03-18T04:00:00Z',
  initiationStatusA: status, initiationStatusB: statusB === undefined ? status : statusB,
  requested: [{ code: '1000000300', desc: 'Invented bulk item', qty: 40, uom: 'EA' }],
  timeline: [
    { n: 'UD Approval', s: 'DONE', c: '2026-03-01T04:00:00Z', d: '2026-03-04T04:00:00Z' },
    { n: stage, s: open ? 'OPEN' : 'DONE', c: '2026-03-04T04:00:00Z', d: open ? null : initDone }
  ]
});

{
  const b = W.rowsFor(bulk('Material Reservation Initiation', 'Approved', false, '2026-03-16T09:00:00Z'))[0];
  is('a Bulk card is one row', b.stream, '');
  is('approved and completed is ready-ish', b.done_at, '2026-03-16T09:00:00Z');
  is('*** BUT IT IS NOT "CAN COLLECT" ***', W.state(b), 'approved');
  is('and it is counted in its own band',
     W.pipeline([b], {}).filter(p => p.n).map(p => [p.state, p.n]), [['approved', 1]]);
  is('and never in the collectable one', W.pipeline([b], {}).find(p => p.state === 'ready').n, 0);
  is('so it is not in the pick list either', W.pickList([b], {}).length, 0);
  is('the status is on the row, not just consulted', b.initiation_status, 'Approved');
}
{
  const b = W.rowsFor(bulk('Material Reservation Initiation', 'Pending', false, '2026-03-16T09:00:00Z'))[0];
  is('completed but not approved is not done', b.done_at, null);
  is('and sits with the open ones', W.state(b), 'reserving');
}
{
  const b = W.rowsFor(bulk('Material Reservation Initiation', 'Approved', true, null))[0];
  is('approved on the card but the task still open is not done', b.done_at, null);
  is('still reserving', W.state(b), 'reserving');
}
{
  const b = W.rowsFor(bulk('Material Reservation Initiation Rejection', 'Rejected', false, '2026-03-16T09:00:00Z'))[0];
  is('a rejection is a Problem', W.state(b), 'rejected');
  is('NOT reserving', W.state(b) === 'reserving', false);
  is('and the rejection task is not read as the initiation completing', b.done_at, null);
}
{
  const b = W.rowsFor(bulk('Resubmit Material Request', 'Pending', true, null))[0];
  is('a resubmit is a Problem too', W.state(b), 'shortage');
  is('NOT reserving', W.state(b) === 'reserving', false);
}
{
  const b = W.rowsFor(bulk('UD Approval', 'Pending', true, null))[0];
  is('waiting on UD Approval is reserving', W.state(b), 'reserving');
}

/* ===================== THE TWO OPPOSITE RULES, TESTED SIDE BY SIDE ========
   PH2 repeated notes → earliest.  Bulk repeated initiations → last.
   They are opposite on purpose, and this is here so neither gets "corrected"
   to match the other by somebody reading only one of them. */
{
  /* PH2: a second note is MORE material. The first is still sitting there. */
  const twoNotes = { reservation: '1700002',
                     gins: [note('4930000006', '2026-03-01'), note('4930000007', '2026-03-10')] };
  is('PH2 takes the EARLIEST of two notes', W.ph2Ready(twoNotes), '2026-03-01T00:00:00Z');

  /* Bulk: a second initiation means the FIRST WAS VOIDED. Card 876's real
     shape - initiate, rejected, re-initiate - with invented dates. */
  const roundTrip = {
    id: 25601, phase: 'Bulk', workflow: 'w-test-bulk', site: 'zz0004',
    initiationStatusA: 'Approved', initiationStatusB: 'Approved',
    created: '2026-03-01T04:00:00Z', updated: '2026-08-19T09:20:02Z', requested: [],
    timeline: [
      { n: 'UD Approval', s: 'DONE', c: '2026-03-01T04:00:00Z', d: '2026-03-06T03:56:43Z' },
      { n: 'Material Reservation Initiation', s: 'DONE', c: '2026-03-06T03:56:55Z', d: '2026-03-08T09:07:14Z' },
      { n: 'Material Reservation Initiation Rejection', s: 'DONE', c: '2026-03-08T09:07:26Z', d: '2026-06-10T08:48:50Z' },
      { n: 'UD Approval', s: 'DONE', c: '2026-06-10T08:48:59Z', d: '2026-06-18T06:03:53Z' },
      { n: 'Resubmit Material Request', s: 'DONE', c: '2026-06-18T06:04:03Z', d: '2026-06-18T07:24:13Z' },
      { n: 'UD Approval', s: 'DONE', c: '2026-06-18T07:24:35Z', d: '2026-06-18T07:25:17Z' },
      { n: 'Material Reservation Initiation', s: 'DONE', c: '2026-06-18T07:25:27Z', d: '2026-06-19T09:20:02Z' }
    ]
  };
  const rt = W.rowsFor(roundTrip)[0];
  is('Bulk takes the LAST completed initiation', rt.done_at, '2026-06-19T09:20:02Z');
  is('NOT the first, which was rejected two days later', rt.done_at === '2026-03-08T09:07:14Z', false);
  is('so it does not claim to have been waiting since March',
     W.daysBetween(W.localDay(rt.done_at), '2026-06-25'), 6);
  is('which the first occurrence would have made', W.daysBetween('2026-03-08', '2026-06-25'), 109);
  is('and the rejection task is never mistaken for an initiation',
     rt.done_at !== '2026-06-10T08:48:50Z', true);
  is('no stage history is kept - only what WorkHub says now', rt.timeline.length, 7);
}

/* ---- both status columns, neither chosen ---- */
{
  const agree = W.bulkStatus({ initiationStatusA: 'Approved', initiationStatusB: 'Approved' });
  is('agreeing columns', [agree.value, agree.from, agree.agree], ['Approved', 'A', true]);
  const clash = W.bulkStatus({ initiationStatusA: 'Approved', initiationStatusB: 'Rejected' });
  is('disagreeing columns are reported, not resolved',
     [clash.value, clash.from, clash.agree, clash.a, clash.b],
     ['Approved', 'A', false, 'Approved', 'Rejected']);
  const onlyB = W.bulkStatus({ initiationStatusA: '', initiationStatusB: 'Approved' });
  is('only one has a value', [onlyB.value, onlyB.from, onlyB.agree], ['Approved', 'B', null]);
  const neither = W.bulkStatus({});
  is('neither does', [neither.value, neither.from, neither.agree], ['', null, null]);
  is('and both are carried onto the row',
     (r => [r.initiation_status_a, r.initiation_status_b, r.status_from, r.status_agree])(
       W.rowsFor(bulk('Material Reservation Initiation', 'Approved', false,
                      '2026-03-16T09:00:00Z', 'Rejected'))[0]),
     ['Approved', 'Rejected', 'A', false]);
}

/* ---- a mark that outlived its stage ---- */
{
  const got = { collected_on: '2026-03-15', collected_by: 'Nimal' };
  const collected = { id: 1, phase: 'PH1', stage: 'System Issuance Done', done_at: '2026-03-10T04:00:00Z' };
  is('an ordinary collected row is not odd', W.markOdd(collected, got), null);
  is('no mark, nothing to flag', W.markOdd(collected, null), null);

  const rejected = { id: 1, phase: 'PH1', stage: 'Reservation Rejected', done_at: null };
  is('a mark under a rejected stage is flagged',
     /marked collected, but the stage is now/.test(W.markOdd(rejected, got)), true);
  is('and the state still says collected - the mark is not cleared',
     W.state(rejected, got), 'collected');

  const shortage = { id: 1, phase: 'PH1', stage: 'Material Shortage', done_at: null };
  is('a shortage after collection is flagged too', !!W.markOdd(shortage, got), true);

  const backToReserving = { id: 1, phase: 'PH1', stage: 'Material Reservation', done_at: null };
  is('and a card that went back to reserving',
     /gone back to/.test(W.markOdd(backToReserving, got)), true);

  const never = { id: 1, phase: 'PH1', stage: 'System Issuance Pending', done_at: null };
  is('collected before anything says it was issued',
     /nothing on the card says it was issued/.test(W.markOdd(never, got)), true);

  const bulkRow = { id: 1, phase: 'Bulk', stage: 'Material Reservation Initiation', done_at: null };
  is('but Bulk is not flagged for having no issuance - it never has one',
     W.markOdd(bulkRow, got), null);
}

/* ====================================================== all three at once = */
const all = [].concat(W.rowsFor(ph1), r2, W.rowsFor(
  bulk('Material Reservation Initiation', 'Approved', false, '2026-03-16T09:00:00Z')));
is('four rows from three cards', all.length, 4);
is('every row has a key of its own', [...new Set(all.map(W.key))].length, 4);
is('the counts, by band',
   W.pipeline(all, {}).filter(p => p.n).map(p => [p.state, p.n]),
   [['approved', 1], ['ready', 2], ['collected', 1]]);
is('"Can collect" is the two PH2 streams and nothing else',
   all.filter(t => W.state(t) === 'ready').map(W.key), ['25490|Advantis', '25490|ACE']);

/* the sheet carries which is which */
const sh = W.sheet(all, {}, '2026-03-20');
const col = n => W.HEADERS.indexOf(n);
is('the sheet names the source', [...new Set(sh.slice(1).map(r => r[col('Source')]).filter(Boolean))],
   ['PH1', 'PH2', 'Bulk']);
/* three, not two: the Advantis stream's removed line gets a row of its own and
   carries the stream too, or it would be a line nobody could place */
is('and the stream', sh.slice(1).map(r => r[col('Stream')]).filter(Boolean),
   ['Advantis', 'Advantis', 'ACE']);
is('a removed line is in the sheet, marked',
   sh.filter(r => r[col('Issue Check')] === 'Removed').map(r => r[col('Material Code')]),
   ['1000000999']);

/* ============================================ is this actually a PDF? ===

   What went into the bucket the first time was a ZERO-BYTE object. pdf.js
   transfers the ArrayBuffer it is given, so the buffer kept for upload had
   already been detached by the parse; Blob([detached]) is empty, and an empty
   object uploads, signs and downloads without one error anywhere. Chrome
   refusing to open the file was the first and only symptom.

   These assert on the real returned value, not the shape of one. Each case
   below is a thing that was actually stored or could have been. */
const pdf = n => { const u = new Uint8Array(n); u[0]=0x25; u[1]=0x50; u[2]=0x44; u[3]=0x46; return u; };

is('a PDF of a believable size is a PDF', W.isPdf(pdf(40000)), true);
is('EXACTLY what was stored: nothing at all', W.isPdf(new Uint8Array(0)), false);
is('a detached buffer reads as zero length and is refused',
   W.isPdf({ byteLength: 0 }), false);
/* 200 OK with a sign-in page in the body. resp.ok is true, arrayBuffer()
   succeeds, and it is called .pdf by the time anything looks at it. */
is('an HTML sign-in page is refused',
   W.isPdf(Buffer.from('<!doctype html><html><body>Sign in</body></html>'.repeat(40))), false);
is('a JSON error body is refused',
   W.isPdf(Buffer.from(JSON.stringify({ error: 'Unauthorized' }))), false);
is('a PDF with the right header but no body is refused on length',
   W.isPdf(pdf(900)), false);
is('right length, wrong first four bytes, refused',
   W.isPdf(Buffer.concat([Buffer.from('%PDG'), Buffer.alloc(4000)])), false);
is('one byte under the floor is refused and one byte over is not',
   [W.isPdf(pdf(W.PDF_MIN - 1)), W.isPdf(pdf(W.PDF_MIN))], [false, true]);
is('nothing, rather than a buffer, is refused rather than thrown',
   [W.isPdf(null), W.isPdf(undefined)], [false, false]);
/* An ArrayBuffer, which is what the page actually holds - not a view of one */
is('an ArrayBuffer is read, not just a typed array', W.isPdf(pdf(5000).buffer), true);

/* The floor is a number somebody could later "tidy" to 0 and undo all of
   this. Pinned, with the reason: an empty file passed every other check. */
is('the minimum length is a real floor, not zero', W.PDF_MIN >= 1024, true);

/* ==================================== what a download is called ========

   The reservation number off THE DOCUMENT, and nothing else. */
is('a GIN downloads as its reservation number alone',
   W.docName({ res: '1776693', gi: '4932181056', rep: '', file: 'BD5071_4932181244.pdf' }),
   '1776693.pdf');
is('no site code, no GI number, no underscores',
   /^[0-9]+\.pdf$/.test(W.docName({ res: '1776693', gi: '4932181056' })), true);
/* The document's own, never the ticket's. A ticket carrying 1764339 and
   1776693 has a GIN for each, and each names the one it was issued against. */
is('two documents on one ticket take their own reservations',
   [W.docName({ res: '1764339', gi: '4932181050' }),
    W.docName({ res: '1776693', gi: '4932181056' })],
   ['1764339.pdf', '1776693.pdf']);
/* An Activity Report has neither a reservation nor a GI - moveShape sets both
   to '' - so without the fallback this file was called ".pdf". */
is('an Activity Report falls back to its report number',
   W.docName({ kind: 'move', res: '', gi: '', rep: '5001234567' }), '5001234567.pdf');
is('a GIN with no reservation falls back to its GI number',
   W.docName({ res: '', gi: '4932181056', rep: '' }), '4932181056.pdf');
is('nothing to name it after is document.pdf, never ".pdf"',
   [W.docName({ res: '', gi: '', rep: '' }), W.docName({}), W.docName(null)],
   ['document.pdf', 'document.pdf', 'document.pdf']);
is('and never "undefined.pdf"',
   W.docName({ res: undefined, gi: undefined, rep: undefined }), 'document.pdf');
is('whitespace around a number does not become part of the name',
   W.docName({ res: '  1776693 ' }), '1776693.pdf');
is('a path separator cannot get into the saved name',
   W.docName({ res: '../../etc/passwd' }), 'etc-passwd.pdf');
is('a number that sanitises away is still not ".pdf"',
   W.docName({ res: '...' }), 'document.pdf');
/* The collision the two GINs on one reservation produce, pinned as a known
   property: the browser adds "(1)" and that is accepted. */
is('two GINs on one reservation DO share a name, knowingly',
   W.docName({ res: '1776693', gi: '4932181056' }) === W.docName({ res: '1776693', gi: '4932181057' }),
   true);
/* But a GIN and an Activity Report on one ticket never collide, because the
   report carries no reservation and falls through to its own number. */
is('a GIN and an Activity Report never collide',
   W.docName({ res: '1776693', gi: '4932181056' }) === W.docName({ kind: 'move', res: '', gi: '', rep: '5001234567' }),
   false);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
