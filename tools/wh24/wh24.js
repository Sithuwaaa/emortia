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
    return {
      id: Number(raw.id),
      site: s(raw.site).toUpperCase() || null,
      site_name: s(raw.siteName) || null,
      wo: s(raw.wo) || null,
      reservation: s(raw.reservation) || null,
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
      done_at: dt.done,
      wh_collected_at: dt.collected,
      timeline: tl,
      lines: match(raw.requested, raw.gins),
      gins: (raw.gins || []).map(function (g) {
        return { file: s(g.file), gi: s(g.gi), date: g.date || '', res: s(g.res), sloc: s(g.sloc),
                 wbs: s(g.wbs), mv: s(g.mv), items: g.items || [] };
      })
    };
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
    if (t.done_at) return 'ready';
    var st = s(t.stage);
    if (/^System Issuance Pending/i.test(st)) return 'issuing';
    if (/Shortage/i.test(st)) return 'shortage';
    if (/Rejected|Rejection/i.test(st)) return 'rejected';
    if (/Material Reservation|Infomate|Activity|FL Creation|Vendor/i.test(st)) return 'reserving';
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
    var hay = [t.id, t.site, t.site_name, t.wo, t.reservation, t.stage];
    (t.lines || []).forEach(function (l) {
      hay.push(l.code, l.desc);
      if (l.gin) { hay.push(l.gin.res, l.gin.gi); hay = hay.concat(l.gin.sn || []); }
    });
    return hay.some(function (v) { return s(v).toUpperCase().indexOf(q) >= 0; });
  }

  /* ------------------------------------------------------- the dashboard

     How many tickets sit in each state, in the order a ticket moves through
     them - the strip across the top of the page. */
  var ORDER = ['reserving', 'issuing', 'ready', 'collected', 'shortage', 'rejected', 'other'];
  function pipeline(tickets, marks) {
    var n = {};
    ORDER.forEach(function (k) { n[k] = 0; });
    (tickets || []).forEach(function (t) { n[state(t, (marks || {})[t.id])]++; });
    return ORDER.map(function (k) { return { state: k, n: n[k] }; });
  }

  /* What to ask for at the counter: every line on every ticket that can be
     collected, added up by material code. What the GIN says was issued wins
     over what was asked, because the issued quantity is what is on the
     shelf. Biggest pile of tickets first, then by code. */
  function pickList(tickets, marks) {
    var by = {};
    (tickets || []).forEach(function (t) {
      if (state(t, (marks || {})[t.id]) !== 'ready') return;
      (t.lines || []).forEach(function (l) {
        if (!l.code) return;
        var q = l.gin && l.gin.qty != null ? l.gin.qty : l.qty;
        var k = by[l.code] || (by[l.code] = { code: l.code, desc: '', uom: '', qty: 0, sn: 0, tickets: [] });
        if (!k.desc && l.desc) k.desc = l.desc;
        if (!k.uom) k.uom = (l.gin && l.gin.uom) || l.uom || '';
        k.qty += q || 0;
        k.sn += l.gin && l.gin.sn ? l.gin.sn.length : 0;
        if (k.tickets.indexOf(t.id) < 0) k.tickets.push(t.id);
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
    'Serial Number(s)', 'Issue S.Loc', 'GIN WBS', 'Issue Check'];

  function sheet(tickets, marks, today) {
    var out = [HEADERS.slice()];
    (tickets || []).forEach(function (t) {
      var mk = (marks || {})[t.id], lines = t.lines && t.lines.length ? t.lines : [{}];
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
          (g.sn || []).join(', '), g.sloc || '', g.wbs || '', l.code && t.done_at ? issueCheck(l) : ''
        ]);
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
           match: match, record: record, localDay: localDay,
           collectedOn: collectedOn, daysBetween: daysBetween, state: state, waiting: waiting,
           issuing: issuing, issueCheck: issueCheck, matches: matches, sheet: sheet,
           pipeline: pipeline, pickList: pickList,
           HEADERS: HEADERS };
}));
