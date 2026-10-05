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

  /* ---- PH1: unchanged. The last task whose name starts "System Issuance
     Done", and done_at is when that task was created. ---- */

  /* ---- PH2 ----
     A stream is ready when BOTH halves of "it has been issued" are on the
     card: the Activity / GRN number is filled in AND the issuance note is
     attached. One without the other is a half-finished entry, not stock on a
     shelf.

     done_at is the NOTE'S OWN DOCUMENT DATE, not the card's last-updated.
     The two differ by days: the note is written at the warehouse on the day
     the material moved, and the card is touched again afterwards for reasons
     that have nothing to do with the material. Counting the wait from the
     card would start the clock late and understate every PH2 queue. */
  function ph2Ready(stream) {
    var st = stream || {};
    var note = (st.gins || [])[0];
    if (!s(st.grn) || !note) return null;
    var d = s(note.date);
    /* A note with no readable date still means issued. Falling back to the
       card would be inventing a day; null done_at with a ready state is not a
       thing this model allows, so the note's absence of a date is carried as
       the GRN entry's date if there is one, and otherwise as no date at all -
       and the caller decides. */
    return d ? d + 'T00:00:00Z' : (s(st.grnDate) ? s(st.grnDate) + 'T00:00:00Z' : null);
  }

  /* ---- Bulk ----
     Completed, and the card's own Initiation Status reading Approved. done_at
     is when the Material Reservation Initiation task completed.

     This is an APPROVAL, not an issuance. WorkHub records no issuance step
     anywhere in the Bulk workflow, so nothing on the card is evidence that
     any material moved. That is why a Bulk row never enters "Can collect". */
  function bulkApproved(raw) {
    var tl = raw.timeline || [];
    var open = tl.some(isOpen);
    if (open) return null;
    if (!/^approved$/i.test(s(raw.initiationStatus))) return null;
    var init = tl.filter(function (t) { return stems(t.n, 'material reservation initiat') &&
                                               !stems(t.n, 'material reservation initiat reject'); });
    var last = init[init.length - 1];
    return (last && last.d) || null;
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
      return (raw.streams || [])
        .filter(function (x) { return s(x.reservation); })
        .map(function (x) {
          return record({
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
            collectedAt: null
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
        initiation_status: raw.initiationStatus,
        doneAt: bulkApproved(raw), collectedAt: null
      })];
    }
    return [record(raw)];
  }

  /* The PH2 sections that are about material. Everything else on that card is
     a different job sharing a work order. Named as what to KEEP, so a section
     added to the form later is ignored until somebody decides it belongs -
     the opposite way round would quietly let it through. */
  var PH2_KEEP = ['material reservation', 'material issuance', 'material collection',
                  'grn', 'goods receipt', 'material request'];
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
    if (collectedOn(t, mark)) return 'collected';
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
  var ORDER = ['reserving', 'approved', 'issuing', 'ready', 'collected', 'shortage', 'rejected', 'other'];
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
           bulkApproved: bulkApproved, bulkState: bulkState,
           match: match, record: record, localDay: localDay,
           collectedOn: collectedOn, daysBetween: daysBetween, state: state, waiting: waiting,
           issuing: issuing, issueCheck: issueCheck, matches: matches, sheet: sheet,
           pipeline: pipeline, pickList: pickList,
           HEADERS: HEADERS };
}));
