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
  timeline: [
    { n: 'Material Reservation - AP', s: 'DONE', c: '2026-02-02T04:00:00Z', d: '2026-02-10T04:00:00Z' },
    { n: 'Material Issuance - AP', s: 'DONE', c: '2026-02-10T04:00:00Z', d: '2026-03-05T04:00:00Z' },
    /* every one of these is on the same card and says nothing about material */
    { n: 'Dependency Clearance', s: 'DONE', c: '2026-02-01T04:00:00Z', d: '2026-02-02T04:00:00Z' },
    { n: 'Commissioning', s: 'OPEN', c: '2026-03-20T11:00:00Z', d: null },
    { n: 'Warehouse Selection', s: 'DONE', c: '2026-02-01T05:00:00Z', d: '2026-02-01T06:00:00Z' },
    { n: 'Vendor Allocation', s: 'DONE', c: '2026-02-01T06:00:00Z', d: '2026-02-01T07:00:00Z' },
    { n: 'Task Acceptance', s: 'OPEN', c: '2026-03-18T04:00:00Z', d: null }
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
   r2[0].timeline.map(t => t.n), ['Material Reservation - AP', 'Material Issuance - AP']);
is('so Commissioning being open does not become the stage', r2[0].stage, 'Material Issuance');
is('and the row does not read as in progress because of it', r2[0].status, 'completed');
const task = n => ({ n: n, s: 'DONE', c: null, d: null });
is('ph2Material keeps what it should',
   ['Material Reservation - AP', 'Material Issuance - MW', 'GRN Update'].map(n => W.ph2Material(task(n))),
   [true, true, true]);
is('and refuses the rest',
   ['Dependency Clearance', 'Sub WO 1', 'Commissioning', 'Warehouse Selection',
    'Vendor Allocation', 'Task Acceptance'].map(n => W.ph2Material(task(n))),
   [false, false, false, false, false, false]);
/* a keep-list, so a section added to the form later is ignored until somebody
   decides it belongs - the opposite way round would let it through unseen */
is('and refuses one nobody has seen yet', W.ph2Material(task('Something New - AP')), false);

/* --- half-finished is not ready --- */
is('a GRN with no note is not ready',
   W.ph2Ready({ grn: 'GRN-TEST-0003', gins: [] }), null);
is('a note with no GRN is not ready either',
   W.ph2Ready({ grn: '', gins: [note('4930000003', '2026-03-05')] }), null);
is('both, and it is', W.ph2Ready({ grn: 'G', gins: [note('4930000003', '2026-03-05')] }),
   '2026-03-05T00:00:00Z');
{
  const half = JSON.parse(JSON.stringify(ph2));
  half.streams[1].gins = [];
  const rows = W.rowsFor(half);
  is('one stream ready, the other not', rows.map(r => W.state(r)), ['ready', 'other']);
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
     W.rowsFor(d).map(r => W.state(r)), ['other', 'other']);

  /* PH1 is untouched by any of this */
  const p = W.attachDocs(ph1, ph1.gins);
  is('a PH1 card just keeps its documents', p.gins.length, 1);
  is('and rowsFor still gives the same row', JSON.stringify(W.rowsFor(p)[0]),
     JSON.stringify(W.record(ph1)));
}

/* ============================================================= Bulk ======= */
const bulk = (stage, status, open, initDone) => ({
  id: 25600, phase: 'Bulk', workflow: 'w-test-bulk', site: 'zz0003', siteName: 'Invented_Place_C',
  reservation: '1700004', created: '2026-03-01T04:00:00Z', updated: '2026-03-18T04:00:00Z',
  initiationStatus: status,
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

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
