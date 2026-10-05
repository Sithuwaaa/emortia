/* wh24.js - the rules of WH24 Material Checker, with no DOM in them.

   Runs under node so the tests are real:

     node tools/wh24/wh24.test.js

   It is loaded in two places. The tool page uses it to decide what state a
   ticket is in and how long it has been waiting. The WorkHub sync script
   (workhub.js) loads it inside the WorkHub24 tab to read the Goods Issue Note
   PDFs and to turn what WorkHub hands back into the row the database keeps -
   so the parser that reads a GIN is tested here once, rather than living
   untested inside a bookmark.

   THE LIFE OF A TICKET

     Material Reservation - Infomate Team    Infomate reserve it in SAP
     System Issuance Pending - ACE           ACE are to issue it
     System Issuance Done - ACE              issued: it is at the warehouse
                                             ← this is when we can collect
     (Done closed)                           WorkHub marks it collected

   Along the way it can bounce through Material Shortage, Infomate, a
   reservation rejection or Activity / FL Creation, and come back round. So
   nothing here assumes the tasks happen once or in order: the open task is the
   current stage, and the last time Done opened is when it became ready. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WH24 = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var s = function (v) { return String(v == null ? '' : v).trim(); };
  var DAY = 86400000;

  /* ------------------------------------------------------------ the stages */

  /* 'System Issuance Done - ACE' → stage and team. Three spellings turn up:
     ' - ' between them, '-Advantis' with no space before the team, and the
     rejection task, which has a hyphen in it and no team at all. */
  function splitTask(name) {
    var n = s(name), m;
    if (/^Material Reservation Request\s*-\s*Reservation Rejection$/i.test(n))
      return { stage: 'Reservation Rejected', team: 'Infomate Team' };
    if ((m = /^(.*\S)\s+-\s*(\S.*)$/.exec(n))) return { stage: m[1], team: m[2] };
    return { stage: n, team: '' };
  }

  /* ------------------------------------------------------------- the stems

     PH2 and Bulk task names are not stable strings. PH2 carries a division
     suffix - the same task is "… - AP" on one card and "… - MW" on another -
     and the verb moves between Initiate and Initiation on the same workflow.
     Matching a full string means the tool silently stops recognising a stage
     the day somebody edits the wording, which is the quiet kind of wrong.

     So: drop the team, drop the division, fold the verb, lowercase. What is
     left is matched with a prefix test, never with equality.

       'Material Reservation Initiation - AP'        → material reservation initiat
       'Material Reservation Initiate'               → material reservation initiat
       'Material Reservation Initiation Rejection'   → material reservation initiat reject

     Rejection is checked BEFORE initiation, because the second is a prefix of
     the first and the wrong order puts every rejection in Reserving. */
  function stem(name) {
    var st = splitTask(name).stage;
    st = s(st).replace(/\s*[-–_]\s*(AP|MW)\s*$/i, '');        /* division */
    st = st.toLowerCase().replace(/\s+/g, ' ').trim();
    st = st.replace(/initiation|initiating|initiate/g, 'initiat');
    st = st.replace(/rejections?|rejected/g, 'reject');
    return st;
  }
  var stems = function (name, want) { return stem(name).indexOf(want) === 0; };

  /* PH1's two, unchanged and matched as they always were. 384 rows depend on
     these exactly as written, so the stem machinery above is not applied to
     them: nothing about PH1 moves in this change. */
  var isDone    = function (t) { return /^System Issuance Done/i.test(s(t && t.n)); };
  var isPending = function (t) { return /^System Issuance Pending/i.test(s(t && t.n)); };
  var isOpen    = function (t) { return s(t && t.s).toUpperCase() !== 'DONE'; };
  var ms = function (v) { if (!v) return NaN; var t = new Date(v).getTime(); return t; };

  /* The task that is still open is where the ticket is. With nothing open the
     ticket has finished, and where it finished is the newest task. */
  function current(timeline) {
    var tl = timeline || [], open = tl.filter(isOpen);
    if (open.length) return open[open.length - 1];
    var best = null;
    tl.forEach(function (t) { if (!best || ms(t.c) >= ms(best.c)) best = t; });
    return best;
  }

  /* When it became collectable, and when WorkHub says it was collected. The
     last Done, because a ticket can be issued, sent back for a shortage, and
     issued again - and it is the second issue that put it on the shelf. */
  function doneTimes(timeline) {
    var d = (timeline || []).filter(isDone);
    if (!d.length) return { done: null, collected: null };
    var last = d[d.length - 1];
    return { done: last.c || null, collected: last.d || null };
  }

  /* ------------------------------------------------------------ GIN numbers */

  /* '3,500.00' → 3500. The GIN prints thousands with a comma. */
  function num(v) {
    var n = parseFloat(s(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  /* The GIN date comes two ways: '30.09.2026' from SAP, and '08/07/2026' -
     month first - off the Advantis warehouse's printout. Back as YYYY-MM-DD. */
  function ginDate(v) {
    var t = s(v), m;
    if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t))) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) return m[3] + '-' + pad(m[1]) + '-' + pad(m[2]);
    return '';
  }
  function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  /* Reading a GIN used to live here, as a second and weaker copy of the GIN
     Extractor's parser. Both readers are in ../_lib/sapdocs.js now - the tool
     calls SAPDocs.readAny, which also recognises the Activity Report that a
     PH2 ACE stream issues on instead of a GIN. */



  /* ------------------------------------------- what was asked, what was given

     Each line asked for is paired with one GIN line: the same code and the
     same quantity if there is one, the same code otherwise, and no GIN line
     is used twice. Three radios asked for as three lines of one come back as
     three GIN lines of one, and they pair off in order. What is left over on
     the GIN side - issued but never asked for - is kept, as a line of its own
     with nothing requested against it. */
  function match(requested, gins) {
    var pool = [];
    (gins || []).forEach(function (g) {
      (g.items || []).forEach(function (it) { pool.push({ g: g, it: it, used: false }); });
    });
    var take = function (code, qty) {
      var i, p;
      for (i = 0; i < pool.length; i++) { p = pool[i];
        if (!p.used && p.it.code === code && qty != null && p.it.qty === qty) { p.used = true; return p; } }
      for (i = 0; i < pool.length; i++) { p = pool[i];
        if (!p.used && p.it.code === code) { p.used = true; return p; } }
      return null;
    };
    var issue = function (p) {
      return p ? { res: s(p.g.res), gi: s(p.g.gi), date: p.g.date || '', sloc: s(p.g.sloc),
                   wbs: s(p.g.wbs), qty: p.it.qty, uom: s(p.it.uom), sn: (p.it.sn || []).slice() } : null;
    };
    var lines = (requested || []).map(function (r) {
      var code = s(r.code), qty = num(r.qty);
      return { code: code, desc: s(r.desc), qty: qty, uom: s(r.uom), gin: issue(take(code, qty)) };
    });
    pool.forEach(function (p) {
      if (!p.used) lines.push({ code: s(p.it.code), desc: s(p.it.desc), qty: null,
                                uom: s(p.it.uom), gin: issue(p), extra: true });
    });
    return lines;
  }

  /* ------------------------------------------------------------- the record

     What the sync script hands over for one ticket, made into the row the
     database keeps. raw:
       { id, created, updated, site, siteName, wo, reservation,
         requested:[{ code, desc, qty, uom }],
         timeline:[{ n, s, c, d }],
         gins:[{ file, gi, date, res, sloc, wbs, mv, items:[...] }] } */
  function record(raw) {
    var tl = (raw.timeline || []).slice().sort(function (a, b) { return ms(a.c) - ms(b.c); });
    var cur = current(tl), st = splitTask(cur ? cur.n : '');
    var dt = doneTimes(tl);
    var newest = null;
    tl.forEach(function (t) {
      [t.c, t.d].forEach(function (v) { if (v && (!newest || ms(v) > ms(newest))) newest = v; });
    });
    /* done_at and wh_collected_at come off the timeline for PH1, and that is
       the only rule the timeline can answer. PH2 is ready when a stream's own
       issuance note says so, and Bulk when an approval completed - so both
       pass the date in and this stops guessing. undefined means "work it out",
       null means "there isn't one". They are not the same answer. */
    var done = raw.doneAt === undefined ? dt.done : (raw.doneAt || null);
    var got  = raw.collectedAt === undefined ? dt.collected : (raw.collectedAt || null);
    return {
      id: Number(raw.id),
      /* '' for PH1 and Bulk, which are one row per card. PH2 splits into
         'Advantis' and 'ACE', and the pair (id, stream) is the primary key in
         the database since 039. Nothing in this file may index on id alone. */
      stream: s(raw.stream),
      site: s(raw.site).toUpperCase() || null,
      site_name: s(raw.siteName) || null,
      wo: s(raw.wo) || null,
      reservation: s(raw.reservation) || null,
      /* PH2 carries the SAP order the stream was raised under, beside the
         reservation. Null everywhere else rather than absent, so a row from
         one source is the same shape as a row from another. */
      order_no: s(raw.orderNo) || null,
      /* PH2's Activity / GRN number - the first half of "it has been issued" */
      grn: s(raw.grn) || null,
      /* Bulk's own field. Kept on the row rather than only consulted, because
         "Approved" is the whole of why a Bulk row is where it is and a person
         reading the card should not have to open WorkHub to see it. */
      initiation_status: s(raw.initiation_status) || null,
      /* BOTH candidate columns are carried and neither is chosen - see
         bulkStatus. status_from says which one was read; status_agree is true,
         false, or null when only one of them had a value at all. Real data
         across every Bulk card settles which is the real one. */
      initiation_status_a: s(raw.initiation_status_a) || null,
      initiation_status_b: s(raw.initiation_status_b) || null,
      status_from: s(raw.status_from) || null,
      status_agree: raw.status_agree == null ? null : !!raw.status_agree,
      /* PH2: how many issuance notes this stream has had. done_at is the
         earliest of them, and this is what stops the second one vanishing. */
      notes: raw.notes == null ? null : Number(raw.notes),
      /* PH2 collection. unattributed means one confirmation stopped this
         stream's clock AND another's, so at most one of the two is right and
         the row must not read as a plain "collected". The count and the dates
         are carried so a wrong one can be spotted without opening WorkHub. */
      unattributed: !!raw.unattributed,
      confirmations: raw.confirmations == null ? null : Number(raw.confirmations),
      confirmed_on: (raw.confirmed_on || []).slice(),
      /* attached documents the reader could not turn into anything. Set by the
         sync, which is the only thing that sees a parse fail. */
      docs_failed: raw.docs_failed == null ? null : Number(raw.docs_failed),
      /* Which WorkHub app this came from, carried straight through from the
         sync. Not derived from anything on the ticket - the only thing that
         knows is the app it was read out of. Null when a caller builds a
         record without saying, which is how the tests do it. */
      phase: s(raw.phase) || null,
      workflow: s(raw.workflow) || null,
      stage: st.stage || null,
      team: st.team || null,
      status: tl.some(isOpen) ? 'inprogress' : 'completed',
      wh_created_at: raw.created || null,
      wh_updated_at: newest || raw.updated || null,
      done_at: done,
      wh_collected_at: got,
      timeline: tl,
      lines: match(raw.requested, raw.gins),
      /* Lines the card itself struck off. They are NOT dropped: a line that
         vanishes between one sync and the next reads as a parsing failure to
         whoever is holding the list, and "it was removed" is the one thing
         that would have told them otherwise. Shown struck through, counted
         nowhere. */
      removed: (raw.removed || []).map(function (r) {
        return { code: s(r.code), desc: s(r.desc), qty: r.qty == null ? null : r.qty, uom: s(r.uom) };
      }),
      gins: (raw.gins || []).map(function (g) {
        return { file: s(g.file), gi: s(g.gi), date: g.date || '', res: s(g.res), sloc: s(g.sloc),
                 wbs: s(g.wbs), mv: s(g.mv), items: g.items || [] };
      })
    };
  }

  /* ========================================= one card, one or two rows ======

     WHY TWO ROWS - the evidence, not the reasoning.

     The ordering test that settled which date field to use produced this as a
     side effect, and it is the strongest thing we have:

       System Issuance Done - ACE   opened 2025-11-27
         the Activity Report attached to the ACE field    27.11.2025
       System Issuance Done         opened 2026-03-05
         the Goods Issue Note attached to the Advantis field  05.03.2026

     Two tracks on one card, three months apart, and each vendor's document
     carries the date its OWN track opened, to the day. The suffixed track
     pairs with the Activity Report and the unsuffixed one with the GIN, and
     nothing about that was inferred from the vendor names - it fell out of
     comparing dates that had no reason to agree unless the model is right.

     One row per card could hold one of those two answers.

     A PH1 or Bulk card is one row. A PH2 card is a site work order carrying
     two parallel vendor streams - Advantis and ACE - with their own
     reservation, their own material table, their own GRN and their own
     issuance note, issued on different days by different vendors. One row
     could hold only one of those answers, so it is two rows keyed on
     (id, stream).

     Everything below takes a card that has ALREADY been read off WorkHub's
     fields. The field numbers live in workhub.js, where the form is; nothing
     here knows a column number, which is what lets these rules be tested. */

  /* (id, stream). Every lookup in this tool and on the page goes through it.
     Indexing on id alone is the bug 039 was written to make impossible, and
     it would show up as a PH2 card's two streams sharing one collected date. */
  function key(t) { return String(t && t.id) + '|' + s(t && t.stream); }
  function markOf(marks, t) { return (marks || {})[key(t)]; }

  /* =================================================== WHAT TIME IS IT ======

     WorkHub's GraphQL returns timestamps in UTC with the zone marker MISSING -
     '2026-08-19T09:20:02', not '…Z'. Its own UI renders the same instant in
     Asia/Colombo, so the card that reads 09:20:02 here reads 02:50 PM there.

     That is not guesswork. WorkHub builds each card's TITLE with a human
     timestamp inside it, and returns created_date for the same event: across
     the cards whose titles carry their creation time, title minus API is
     +5.50 h exactly, every time. Same event, two renderings, one offset.

     So:
       workhub.js  appends the Z that WorkHub omits - read as UTC
       the database stores UTC (timestamptz)
       localDay()  renders the LOCAL day, which is Colombo for everyone who
                   uses this, and is what "days waiting" counts in

     Getting this wrong by 5.5 hours does not look like a bug. It silently
     moves anything issued after 18:30 Colombo into the previous day's bucket,
     so a row reads one day younger than it is and sorts below rows it should
     sit above. Nothing on screen would say so.

     ========================================================================= */

  /* ---- PH1: unchanged. The last task whose name starts "System Issuance
     Done", and done_at is when that task was created.

     PH1 BELIEVES THE STAGE. PH2 BELIEVES THE DOCUMENT. That asymmetry is
     deliberate and must not be tidied away in either direction: PH1's stage
     is its only signal and has held across 384 rows, while a PH2 stream can
     show 'System Issuance Done - ACE' with no note attached at all - seen on
     real cards. Making PH1 wait for a document would empty its list; making
     PH2 trust its stage would fill its list with material nobody has issued.
     ---- */

  /* ---- PH2 ----
     ONE test, not two. A stream is ready when it has a reservation AND an
     issuance note attached. There is no separate Activity / GRN field on the
     form - a stream carries a reservation and a Project/PM order and nothing
     else - so the number that was called "the GRN" IS the reservation.

     THE NOTE IS THE BINDING HALF. A reservation with no note is never ready,
     whatever the stage says. The reservation is what the row is called; the
     note is the evidence the material moved.

     done_at is the NOTE'S OWN DOCUMENT DATE, not the card's last-updated. The
     two differ by days: the note is written at the warehouse on the day the
     material moved, and the card is touched again afterwards for reasons that
     have nothing to do with the material. */

  /* ===================== REPEATED THINGS: TWO RULES, OPPOSITE, BOTH RIGHT ===

     PH2, repeated NOTES  → take the EARLIEST
     Bulk, repeated INITIATIONS → take the LAST

     They look inconsistent and are not, because the repetitions mean opposite
     things.

     A second PH2 note is MORE material issued against the same stream. The
     first delivery has been sitting at the warehouse since its own date, and
     taking the later note would make the row say '0 days waiting' on the day
     a second delivery lands - a ticket getting younger, which is wrong on its
     face and buries the oldest thing in the queue. The queue exists to
     surface exactly that row. So: earliest, and the note COUNT is shown
     beside it so the second delivery is not invisible.

     A second Bulk initiation is the FIRST ONE VOIDED. The sequence is
     initiate → rejected → re-initiate, and the earlier attempt is a dead end,
     not a start date. Taking the earliest would show a card waiting since May
     when it was killed two days later and only revived in August. So: last.

     Neither should ever be "corrected" to match the other.
     ========================================================================= */
  function ph2Ready(stream) {
    var st = stream || {};
    var notes = (st.gins || []).filter(Boolean);
    if (!s(st.reservation) || !notes.length) return null;
    var days = notes.map(function (n) { return s(n.date); }).filter(Boolean).sort();
    if (!days.length) return null;     /* issued, but no readable date on any note */
    return days[0] + 'T00:00:00Z';     /* EARLIEST - see the block above */
  }
  /* How many issuances a stream has had. One is the ordinary case; more than
     one is why done_at is the earliest, and the row says so. */
  function noteCount(stream) {
    return ((stream || {}).gins || []).filter(Boolean).length;
  }

  /* ------------------------------------------- PH2: when it was collected

     This was missing entirely, and its absence was the worst bug in the
     widening: with collectedAt hard-coded null, no PH2 row could EVER record
     a collection. A row the vendor had signed for would sit in "Can collect"
     for ever, and the tool would send somebody to fetch material that had
     already gone. Showing nothing is better than that.

     WorkHub records the collection as "Material Collection Confirmation by
     Vendor". Those tasks are UNSUFFIXED, so unlike the issuance tasks they
     cannot be attributed to Advantis or ACE by name - and they must not be
     paired off 1:1 with streams either. On a real card: ACE issued 27 Nov,
     Advantis issued 5 Mar, confirmations closed 17 Mar and 16 Sep. Pair them
     in order and ACE waits seven months; pair them the other way and Advantis
     is confirmed before it was issued. Two of each is a coincidence.

     So causality, the same test that settled the date field: material issued
     on a date cannot be collected by a confirmation that closed BEFORE it.

       the earliest confirmation that CLOSED after this stream's done_at
       stops this stream's clock, at that close date

     Earliest, to match the earliest-note rule, and because the first one to
     qualify is the first moment the material could have left.

     This can OVER-claim: one confirmation stops two clocks when only one
     stream was actually collected, and on the cards seen that happens - one
     has two streams and a single confirmation. Over-claiming is the safe
     direction (nothing is sent to be fetched twice) but it is never silent:
     the row says how many confirmations there were and on what dates, and a
     row whose confirmation also stopped another stream is labelled
     unattributed rather than collected. */
  function confirmations(timeline) {
    return (timeline || [])
      .filter(function (t) { return stems(t.n, 'material collection confirmation') && t.d; })
      .sort(function (a, b) { return ms(a.d) - ms(b.d); });
  }
  function ph2Collected(timeline, doneAt) {
    if (!doneAt) return null;                 /* never issued, nothing to stop */
    var after = confirmations(timeline).filter(function (t) { return ms(t.d) > ms(doneAt); });
    return after.length ? after[0].d : null;
  }

  /* ---- Bulk ----
     Completed, and the card's own Initiation Status reading Approved. done_at
     is when the LAST Material Reservation Initiation task completed.

     This is an APPROVAL, not an issuance. WorkHub records no issuance step
     anywhere in the Bulk workflow, so nothing on the card is evidence that
     any material moved. That is why a Bulk row never enters "Can collect".

     No rejection round-trip is modelled and no stage history is kept: the
     tool re-reads WorkHub on every sync, so a card rejected again simply
     comes back rejected. Current state from the source, nothing retained. */
  function bulkApproved(raw) {
    var tl = raw.timeline || [];
    if (tl.some(isOpen)) return null;
    if (!/^approved$/i.test(s(bulkStatus(raw).value))) return null;
    var init = tl.filter(function (t) {
      return stems(t.n, 'material reservation initiat') &&
            !stems(t.n, 'material reservation initiat reject') && t.d;
    }).sort(function (a, b) { return ms(a.d) - ms(b.d); });
    var last = init[init.length - 1];   /* LAST - see the block above */
    return (last && last.d) || null;
  }

  /* ---- which column is the Initiation Status ----
     The form carries two that both read 'Approved' on the cards seen so far,
     and one card cannot tell them apart. So BOTH are carried on the row and
     neither is chosen: this reads the first that has a value, says which one
     it read, and says whether the other agreed. Real data across every Bulk
     card settles it; if they never disagree the question was moot. */
  function bulkStatus(raw) {
    var a = s(raw && raw.initiationStatusA), b = s(raw && raw.initiationStatusB);
    var from = a ? 'A' : (b ? 'B' : null);
    return { value: a || b, a: a || null, b: b || null, from: from,
             agree: (a && b) ? (a.toLowerCase() === b.toLowerCase()) : null };
  }

  /* ------------------------------------------------- which note, which stream

     The sync reads a card's PDFs and hands them back keyed on the CARD. For
     PH1 and Bulk that is enough - one card, one row, every document is its
     own. A PH2 card has two rows and two documents, and putting them on the
     wrong rows would show the Advantis note while reading the ACE line, which
     is worse than showing none.

     The documents say which is which, so nothing here guesses from the order
     they arrived in:

       - a Goods Issue Note carries the reservation it was issued against, so
         it goes to the stream with that reservation
       - an Activity Report carries no reservation, so it goes to the stream
         whose Activity / GRN number it matches
       - with exactly one stream and one document left over, that pairing is
         the only one possible and is taken

     Anything still unplaced is left off rather than put somewhere plausible.
     A stream with no note is not ready, which is the honest answer. */
  function attachDocs(raw, docs) {
    var list = (docs || []).slice();
    if (s(raw && raw.phase) !== 'PH2') {
      var o = {}; for (var k in raw) if (Object.prototype.hasOwnProperty.call(raw, k)) o[k] = raw[k];
      o.gins = list;
      return o;
    }
    var streams = (raw.streams || []).map(function (x) {
      var c = {}; for (var k2 in x) if (Object.prototype.hasOwnProperty.call(x, k2)) c[k2] = x[k2];
      c.gins = []; return c;
    });
    var taken = {};
    /* by reservation */
    streams.forEach(function (st) {
      if (st.gins.length) return;
      for (var i = 0; i < list.length; i++) {
        if (taken[i]) continue;
        if (s(list[i].res) && s(list[i].res) === s(st.reservation)) { st.gins.push(list[i]); taken[i] = 1; return; }
      }
    });
    /* by activity / GRN number */
    streams.forEach(function (st) {
      if (st.gins.length || !s(st.grn)) return;
      for (var i = 0; i < list.length; i++) {
        if (taken[i]) continue;
        var n = s(list[i].gi) || s(list[i].rep);
        if (n && s(st.grn).indexOf(n) >= 0) { st.gins.push(list[i]); taken[i] = 1; return; }
      }
    });
    /* one left, one place for it */
    var spare = streams.filter(function (st) { return !st.gins.length; });
    var free = list.filter(function (d, i) { return !taken[i]; });
    if (spare.length === 1 && free.length === 1) spare[0].gins.push(free[0]);

    var out = {}; for (var k3 in raw) if (Object.prototype.hasOwnProperty.call(raw, k3)) out[k3] = raw[k3];
    out.streams = streams;
    return out;
  }

  /* One card in, the rows it should become out. */
  function rowsFor(raw) {
    var phase = s(raw && raw.phase);
    if (phase === 'PH2') {
      /* A card enters only once a stream carries a reservation number. Before
         that there is nothing to collect and nothing to call it - a row with
         no reservation is a work order, not a material request. */
      var live = (raw.streams || []).filter(function (x) { return s(x.reservation); });
      /* Which confirmation stops which stream, worked out ACROSS the card so a
         row can say whether the one that stopped it also stopped another. That
         is the whole of what "unattributed" means here, and it cannot be known
         from one stream alone. */
      var conf = confirmations(raw.timeline);
      var stopped = live.map(function (x) { return ph2Collected(raw.timeline, ph2Ready(x)); });
      var usedTwice = {};
      stopped.forEach(function (d) { if (d) usedTwice[d] = (usedTwice[d] || 0) + 1; });
      return live
        .map(function (x, i) {
          return record({
            collectedAt: stopped[i],
            /* true only when the confirmation that stopped this stream also
               stopped another on the same card - one event, two clocks, and at
               most one of them is the truth */
            unattributed: !!(stopped[i] && usedTwice[stopped[i]] > 1),
            confirmations: conf.length,
            confirmed_on: conf.map(function (t) { return localDay(t.d); }),
            id: raw.id, phase: raw.phase, workflow: raw.workflow,
            created: raw.created, updated: raw.updated,
            site: raw.site, siteName: raw.siteName, wo: raw.wo,
            stream: x.stream,
            reservation: x.reservation, orderNo: x.orderNo, grn: x.grn,
            requested: x.requested, removed: x.removed, gins: x.gins,
            /* PH2's own collection sections only. The card also carries
               Dependency Clearance, the Sub WOs, Commissioning, Warehouse
               Selection, Vendor Allocation and Task Acceptance, none of which
               says anything about material, and all of which would otherwise
               become the "current stage" and move the row to a state it is
               not in. */
            timeline: (raw.timeline || []).filter(ph2Material),
            doneAt: ph2Ready(x),
            notes: noteCount(x)
          });
        });
    }
    if (phase === 'Bulk') {
      return [record({
        id: raw.id, phase: raw.phase, workflow: raw.workflow,
        created: raw.created, updated: raw.updated,
        site: raw.site, siteName: raw.siteName, wo: raw.wo, stream: '',
        reservation: raw.reservation, requested: raw.requested,
        removed: raw.removed, gins: raw.gins, timeline: raw.timeline,
        initiation_status: bulkStatus(raw).value,
        initiation_status_a: raw.initiationStatusA,
        initiation_status_b: raw.initiationStatusB,
        status_from: bulkStatus(raw).from,
        status_agree: bulkStatus(raw).agree,
        doneAt: bulkApproved(raw), collectedAt: null
      })];
    }
    return [record(raw)];
  }

  /* The PH2 sections that are about material. Everything else on that card is
     a different job sharing a work order. Named as what to KEEP, so a section
     added to the form later is ignored until somebody decides it belongs -
     the opposite way round would quietly let it through. */
  /* These are the stems a PH2 card ACTUALLY carries, read off a dump of real
     cards. The list that was here before was written from the shape of the
     problem rather than from the form, and every name in it was wrong: PH2
     does not have collection sections of its own wording, it reuses PH1's
     vocabulary - System Issuance Pending, System Issuance Done, Material
     Shortage, Infomate - and adds a few of its own around them. */
  var PH2_KEEP = ['system issuance pending', 'system issuance done',
                  'material shortage', 'infomate',
                  'material reservation', 'additional material reservation request',
                  'material collection confirmation', 'issue review - material collection',
                  'teco/unteco'];
  function ph2Material(t) {
    var st = stem(t && t.n);
    return PH2_KEEP.some(function (k) { return st.indexOf(k) === 0; });
  }

  /* ------------------------------------------------------- where it stands

     The date WorkHub closed Done is when it was collected, unless somebody
     has said otherwise: a date set on the page wins, because the person at
     the counter knows better than the ticket does. */
  function localDay(v) {
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    var d = new Date(v);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function collectedOn(t, mark) {
    if (mark && mark.collected_on) return localDay(mark.collected_on);
    return localDay(t && t.wh_collected_at);
  }
  /* Whole days between two YYYY-MM-DD dates, counted at noon so a clock
     change never makes a day 23 hours and the count one short. */
  function daysBetween(a, b) {
    var x = new Date(a + 'T12:00:00'), y = new Date(b + 'T12:00:00');
    return Math.round((y - x) / DAY);
  }

  /* ready      issued and waiting at the warehouse - this is the list
     collected  picked up
     issuing    reserved, waiting on ACE
     reserving  with Infomate
     shortage   ACE said it is not there
     rejected   the reservation came back
     other      anything else WorkHub invents */
  function state(t, mark) {
    if (!t) return 'other';
    /* A date somebody typed is attributed by definition - they were there and
       said which stream. Only a collection INFERRED from an unattributed
       confirmation gets the hedged state. */
    if (collectedOn(t, mark)) {
      return (t && t.unattributed && !(mark && mark.collected_on)) ? 'collected_un' : 'collected';
    }
    if (s(t.phase) === 'Bulk') return bulkState(t);
    if (t.done_at) return 'ready';
    var st = s(t.stage);
    if (/^System Issuance Pending/i.test(st)) return 'issuing';
    if (/Shortage/i.test(st)) return 'shortage';
    if (/Rejected|Rejection/i.test(st)) return 'rejected';
    if (/Material Reservation|Infomate|Activity|FL Creation|Vendor/i.test(st)) return 'reserving';
    return 'other';
  }

  /* ---- Bulk's own states ----

     'approved' is NOT 'ready' and must never be counted with it. Dialog
     approving a bulk request is the end of what WorkHub records: there is no
     issuance task, no GIN, no evidence anywhere on the card that the material
     left a warehouse. Putting an approved Bulk row in "Can collect" would be
     the tool asserting something it has not been told.

     The two failures go to Problems, neither to Reserving: a rejected
     initiation is a decision against the request, and a resubmit is the
     request bounced back for more - both are somebody's move to make, which
     is what Problems means here and is not what Reserving means. */
  function bulkState(t) {
    var st = s(t.stage);
    if (stems(st, 'material reservation initiat reject')) return 'rejected';
    if (stems(st, 'resubmit material request')) return 'shortage';
    if (t.done_at) return 'approved';
    if (stems(st, 'ud approval') || stems(st, 'material reservation initiat')) return 'reserving';
    return 'other';
  }

  /* ------------------------------------------------- a mark that outlived its stage

     wh24_marks is OUR data. It does not come back from WorkHub and a sync
     never touches it. So a ticket marked collected whose stage later resets -
     rejected, sent back for a shortage, re-reserved - keeps the mark while the
     card goes backwards underneath it.

     state() says 'collected', because somebody stood at the counter and said
     so and that is the better of the two facts. But the row should LOOK odd,
     not normal: the mark is not auto-cleared and never will be, because it is
     a record of something that happened and the tool does not get to decide
     it did not. It is flagged, and a person decides.

     Null when there is nothing strange, so a caller can draw the badge only
     when there is something to say. */
  function markOdd(t, mark) {
    if (!t || !mark || !mark.collected_on) return null;
    var st = s(t.stage);
    if (/Rejected|Rejection/i.test(st)) return 'marked collected, but the stage is now ' + st;
    if (/Shortage/i.test(st)) return 'marked collected, but the stage is now ' + st;
    /* The remaining two tests are about a card that has no issuance when it
       should have one. Bulk never has one - that is the whole point of its
       own band - so neither applies to it, and "Material Reservation
       Initiation" is Bulk's ordinary stage rather than a sign of anything. */
    if (s(t.phase) === 'Bulk') return null;
    /* back with whoever reserves it, after it had already been collected */
    if (/^Material Reservation|Infomate/i.test(st) && !t.done_at)
      return 'marked collected, but the card has gone back to ' + st;
    /* collected before it was ever issued */
    if (!t.done_at)
      return 'marked collected, but nothing on the card says it was issued';
    return null;
  }

  /* ==================================================== NEEDS CHECKING =====

     A problem is per TICKET, not per tool. The temptation with any of the
     cases below is to hedge every row so that the few bad ones are covered -
     brackets everywhere, "approximately" everywhere - and the result is a
     tool nobody can read and a backlog nobody can act on.

     So: a row the tool can state confidently reads plainly. Exact date, exact
     day count, no brackets and no qualifiers. A row it CANNOT state
     confidently is pulled out here with a reason in plain English, and settled
     by hand. Exceptions being visible and FEW is the whole point.

     Rows in this group are in neither Can collect nor the pick list, and are
     never counted into a waiting average. Clean rows are untouched.

     Returns null for a clean row, or { key, why } for one that is not. */
  function needsCheck(t, mark) {
    if (!t) return null;
    var ph = s(t.phase);

    /* my own mark against a card that has gone backwards - first, because it
       is the one case where two sources actively disagree */
    var odd = markOdd(t, mark);
    if (odd) return { key: 'mark', why: odd };

    /* one confirmation stopped more than one stream's clock, so at most one
       of them is the truth */
    if (t.unattributed && !(mark && mark.collected_on))
      return { key: 'unattributed',
               why: 'one collection confirmation stopped more than one stream - at most one is this row' };

    /* the two Bulk status columns do not agree */
    if (t.status_agree === false)
      return { key: 'status',
               why: 'the two initiation-status fields disagree: ' +
                    s(t.initiation_status_a) + ' and ' + s(t.initiation_status_b) };

    /* a document was attached and could not be read */
    if (t.docs_failed)
      return { key: 'unreadable',
               why: t.docs_failed + ' attached document' + (t.docs_failed === 1 ? '' : 's') +
                    ' could not be read' };

    if (ph === 'PH2' && !t.done_at) {
      /* issued, but the paper does not say when */
      if (t.notes)
        return { key: 'nodate',
                 why: 'an issuance note is attached but carries no readable date, so there is nothing to count from' };
      /* reserved and nothing issued yet. Not ready - but shown here rather
         than left to look like an empty queue. */
      return { key: 'nonote',
               why: 'reserved, but no issuance note is attached - nothing says the material moved' };
    }

    /* Bulk, approved, and WorkHub records no issuance step anywhere in that
       workflow - so nothing on the card is evidence the material moved */
    if (ph === 'Bulk' && t.done_at && !collectedOn(t, mark))
      return { key: 'bulk',
               why: 'approved, but WorkHub records no issuance for a Bulk request - collection is not tracked' };

    return null;
  }

  /* -------------------------------------------- the bracket, inside the group

     ONLY for a row already in Needs checking. An unattributed collection is
     known to lie between the earliest confirmation that could have been it and
     the latest confirmation on the card, so the row says both ends and both
     day counts. Showing the near end alone would be picking the number that
     makes the backlog look smaller, which is the one thing this must not do.

     One qualifying confirmation collapses the bracket to a single date, and
     the row reads like any other. */
  function collectedBracket(t) {
    if (!t || !t.unattributed) return null;
    var on = localDay(t.wh_collected_at);
    if (!on) return null;
    var all = (t.confirmed_on || []).slice().filter(Boolean).sort();
    var to = all.length ? all[all.length - 1] : on;
    var from = localDay(t.done_at);
    return {
      from: on, to: to, single: on === to,
      days: from ? daysBetween(from, on) : null,
      daysMax: from ? daysBetween(from, to) : null
    };
  }

  /* How long it has been sitting there: from the day Done opened to the day
     it was picked up, or to today if nobody has gone yet. Null until it is
     ready, because a ticket still with ACE is not waiting on us. */
  function waiting(t, mark, today) {
    if (!t || !t.done_at) return null;
    var from = localDay(t.done_at), to = collectedOn(t, mark) || today;
    return Math.max(0, daysBetween(from, to));
  }

  /* How long ACE have had it: from Pending opening to now, while it is still
     pending. The old sheet's Days Pending column. */
  function issuing(t, today) {
    if (!t || !/^System Issuance Pending/i.test(s(t.stage))) return null;
    var open = (t.timeline || []).filter(function (x) { return isPending(x) && isOpen(x); });
    var since = open.length ? open[open.length - 1].c : t.wh_updated_at;
    return since ? Math.max(0, daysBetween(localDay(since), today)) : null;
  }

  /* Was everything asked for issued? */
  function issueCheck(line) {
    if (!line.gin) return 'Not in GIN';
    if (line.extra) return 'Extra in GIN';
    if (line.qty == null || line.gin.qty == null) return 'Issued';
    return line.gin.qty >= line.qty ? 'Full' : 'Partial';
  }

  /* --------------------------------------------------------- finding things */

  /* A ticket, a site, a name, a code, a reservation, a GI number or a serial:
     whatever is to hand at the warehouse counter finds the ticket. */
  function matches(t, q) {
    q = s(q).toUpperCase();
    if (!q) return true;
    var hay = [t.id, t.site, t.site_name, t.wo, t.reservation, t.stage,
               t.stream, t.order_no, t.grn, t.phase];
    (t.lines || []).forEach(function (l) {
      hay.push(l.code, l.desc);
      if (l.gin) { hay.push(l.gin.res, l.gin.gi); hay = hay.concat(l.gin.sn || []); }
    });
    return hay.some(function (v) { return s(v).toUpperCase().indexOf(q) >= 0; });
  }

  /* ------------------------------------------------------- the dashboard

     How many tickets sit in each state, in the order a ticket moves through
     them - the strip across the top of the page. */
  /* 'approved' sits between reserving and ready in the strip because that is
     where it is in the life of a Bulk request - past the approval, and not at
     a warehouse counter. It is its own band and is never added to ready. */
  var ORDER = ['reserving', 'approved', 'issuing', 'ready', 'collected', 'collected_un', 'shortage', 'rejected', 'other'];
  function pipeline(tickets, marks) {
    var n = {};
    ORDER.forEach(function (k) { n[k] = 0; });
    (tickets || []).forEach(function (t) { n[state(t, markOf(marks, t))]++; });
    return ORDER.map(function (k) { return { state: k, n: n[k] }; });
  }

  /* What to ask for at the counter: every line on every ticket that can be
     collected, added up by material code. What the GIN says was issued wins
     over what was asked, because the issued quantity is what is on the
     shelf. Biggest pile of tickets first, then by code. */
  function pickList(tickets, marks) {
    var by = {};
    (tickets || []).forEach(function (t) {
      if (state(t, markOf(marks, t)) !== 'ready') return;
      (t.lines || []).forEach(function (l) {
        if (!l.code) return;
        var q = l.gin && l.gin.qty != null ? l.gin.qty : l.qty;
        var k = by[l.code] || (by[l.code] = { code: l.code, desc: '', uom: '', qty: 0, sn: 0, tickets: [] });
        if (!k.desc && l.desc) k.desc = l.desc;
        if (!k.uom) k.uom = (l.gin && l.gin.uom) || l.uom || '';
        k.qty += q || 0;
        k.sn += l.gin && l.gin.sn ? l.gin.sn.length : 0;
        if (k.tickets.indexOf(key(t)) < 0) k.tickets.push(key(t));
      });
    });
    return Object.keys(by).map(function (c) { return by[c]; }).sort(function (a, b) {
      return b.tickets.length - a.tickets.length || (a.code < b.code ? -1 : 1);
    });
  }

  /* ------------------------------------------------------------- the sheet

     The same columns as the Excel it replaces, so a file that went to the
     warehouse last week and one going today line up. One row per material
     line; the ticket's own fields on its first line only. */
  var HEADERS = ['Ticket ID', 'Current Stage', 'Last Update', 'Reservation No', 'Indent/WO',
    'Site ID', 'Site Name', 'Material Code', 'Material description', 'Quantity', 'Unit of Measure',
    'Owner Team', 'Status', 'Days Pending (Issuance)', 'Issuance Done Date', 'Collected Date',
    'Days Pending (Collection)', 'GIN Reservation No', 'GI Number', 'GI Date', 'Issued Qty',
    'Serial Number(s)', 'Issue S.Loc', 'GIN WBS', 'Issue Check',
    /* Appended, never inserted: a column added in the middle would move every
       other one and break anybody's template. Blank for PH1 and Bulk; a PH2
       card writes two rows with the same Ticket ID and these tell them apart,
       which is the whole reason they are here. */
    'Source', 'Stream', 'Project / PM Order', 'Activity / GRN No'];

  function sheet(tickets, marks, today) {
    var out = [HEADERS.slice()];
    (tickets || []).forEach(function (t) {
      var mk = markOf(marks, t), lines = t.lines && t.lines.length ? t.lines : [{}];
      var done = localDay(t.done_at), got = collectedOn(t, mk);
      lines.forEach(function (l, i) {
        var g = l.gin || {}, first = i === 0;
        out.push([
          first ? t.id : '', first ? (t.stage || '') : '', first ? localStamp(t.wh_updated_at) : '',
          first ? (t.reservation || '') : '', t.wo || '', t.site || '', t.site_name || '',
          l.code || '', l.desc || '', l.qty == null ? '' : l.qty, l.uom || '',
          first ? (t.team || '') : '', first ? (t.status === 'completed' ? 'Completed' : 'Inprogress') : '',
          first ? nz(issuing(t, today)) : '', first ? done : '', first ? got : '',
          first && done && !got ? nz(waiting(t, mk, today)) : '',
          g.res || '', g.gi || '', g.date || '', g.qty == null ? '' : g.qty,
          (g.sn || []).join(', '), g.sloc || '', g.wbs || '', l.code && t.done_at ? issueCheck(l) : '',
          first ? (t.phase || '') : '', first ? (t.stream || '') : '',
          first ? (t.order_no || '') : '', first ? (t.grn || '') : ''
        ]);
      });
      /* The lines the card struck off, under the live ones, marked as what
         they are. Leaving them out of the sheet would make the sheet disagree
         with the screen, and somebody would reconcile the difference by hand. */
      (t.removed || []).forEach(function (r) {
        var row = new Array(HEADERS.length).fill('');
        row[7] = r.code || ''; row[8] = r.desc || '';
        row[9] = r.qty == null ? '' : r.qty; row[10] = r.uom || '';
        row[4] = t.wo || ''; row[5] = t.site || ''; row[6] = t.site_name || '';
        row[24] = 'Removed';
        row[25] = t.phase || ''; row[26] = t.stream || '';
        out.push(row);
      });
    });
    return out;
  }
  function nz(v) { return v == null ? '' : v; }
  function localStamp(v) {
    if (!v) return '';
    var d = new Date(v);
    return isNaN(d) ? '' : localDay(v) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* Every reservation a ticket knows about, distinct, in the order first met.
     Three places can carry one and they do not always agree:

       t.reservation   what WorkHub writes on the card. Already more than one
                       when there is more than one - '1772793 / 1764338'.
       gin.res         what each Goods Issue Note was issued against. A note
                       can name a reservation the card never mentioned, which
                       is exactly the case where showing only the card's field
                       hides the number you need at the counter.

     Split on both / and , because the card's own field uses the first and a
     pasted list uses the second. */
  function reservations(t) {
    var out = [], seen = {};
    var add = function (v) {
      s(v).split(/[\/,]/).forEach(function (p) {
        var k = p.trim();
        if (k && !seen[k]) { seen[k] = 1; out.push(k); }
      });
    };
    if (!t) return out;
    add(t.reservation);
    (t.gins || []).forEach(function (g) { if (g) add(g.res); });
    (t.lines || []).forEach(function (l) { if (l && l.gin) add(l.gin.res); });
    return out;
  }

  return { splitTask: splitTask, current: current, doneTimes: doneTimes, num: num, ginDate: ginDate,
           reservations: reservations,
           stem: stem, stems: stems, key: key, markOf: markOf,
           rowsFor: rowsFor, ph2Ready: ph2Ready, ph2Material: ph2Material, attachDocs: attachDocs,
           bulkApproved: bulkApproved, bulkState: bulkState, bulkStatus: bulkStatus,
           noteCount: noteCount, markOdd: markOdd,
           ph2Collected: ph2Collected, confirmations: confirmations,
           needsCheck: needsCheck, collectedBracket: collectedBracket,
           match: match, record: record, localDay: localDay,
           collectedOn: collectedOn, daysBetween: daysBetween, state: state, waiting: waiting,
           issuing: issuing, issueCheck: issueCheck, matches: matches, sheet: sheet,
           pipeline: pipeline, pickList: pickList,
           HEADERS: HEADERS };
}));
