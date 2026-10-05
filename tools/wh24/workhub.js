/* workhub.js - the half of WH24 Material Checker that runs inside WorkHub24.

   It is not loaded by any page on this site. The tool page reads this file,
   wraps it into a bookmark, and that bookmark is what runs - in the WorkHub24
   tab, as the person who is signed in there, with nothing stored anywhere.

   WHY A BOOKMARK AND NOT A SERVER

   WorkHub24 has no API we have been given and no export of what we need: the
   timeline of a ticket and the GIN PDFs attached to it. The page itself reads
   both, from its own GraphQL endpoint, with the access token it keeps in that
   tab. A bookmark clicked in that tab can ask the same questions the page
   asks, and nothing has to hold a WorkHub password - not this site, not
   Supabase, not a scheduled job.

   WHAT IT DOES

     1. opens the WH24 tab on emortia.com (now, while the click still counts as
        a click - a window opened after the work is done is a blocked pop-up)
     2. waits for that tab to say it is ready, and to say which GINs it has
        already read, so they are not fetched again
     3. lists the Material Reservation PH1 tickets created since the date it
        was given, newest first, and for each one reads the ticket, its task
        timeline, and any GIN PDF it has not seen
     4. hands the lot across. The PDFs go as they are, bytes and all: the
        Emortia page reads them, so the parser runs where it is tested

   Only slash-star comments in this file. It is going into a javascript: link,
   and a double-slash comment there runs to the end of everything after it. */
(function () {
  'use strict';
  var EMORTIA = 'https://emortia.com';
  /* EVERY WorkHub app this tool reads, and what a row from it is called.
     One table, deliberately: a fourth source is one more line here and
     nothing else in the file changes. The id is WorkHub's workflow id, which
     is what the API selects on and what survives somebody renaming the app;
     the phase is the short label that goes on the row and into the database.

     PH2 and Bulk are NOT in here yet, and must not be added until their stage
     wording has been read off WorkHub - see the note at the foot of this
     file. Adding the id alone would widen the fetch and silently mislabel
     every one of their tickets. */
  /* ------------------------------------------------------------- the build

     A bookmarklet is a FROZEN COPY. Whatever this file says today, the bar
     holds whatever it said the day it was dragged there, and nothing ever
     tells it otherwise.

     That produced the worst failure this tool has had. A copy from before the
     widening still asked for PH1 alone, so a sync returned 384 tickets, every
     count identical to the day before, and no error at all. It looked like a
     successful sync and was a third of the data. A loud failure costs an
     afternoon; a quiet one costs the numbers being believed.

     So the bookmarklet states what it is, and the page - which always has the
     current file, because it fetches it to build the link - refuses to
     publish anything a stale copy sent. BUMP THIS whenever a change alters
     WHAT is fetched rather than how. Adding a source counts. */
  var BUILD = '2026-10-05.3src';

  var SOURCES = [
    { id: 'w8b6c7c686c', phase: 'PH1',  name: 'Material Reservation PH1' },
    { id: 'waf2294d730', phase: 'PH2',  name: 'Material Reservation PH2' },
    { id: 'w987513db94', phase: 'Bulk', name: 'Material Reservation PH1_Bulk Initiation' }
  ];
  var HOST = 'dialog.workhub24.com';

  if (location.host !== HOST) {
    window.alert('Open WorkHub24 (dialog.workhub24.com) first, then click WH24 Sync again.');
    return;
  }
  if (window.__wh24Running) { window.alert('WH24 Sync is already running in this tab.'); return; }
  window.__wh24Running = true;

  var win = window.open(EMORTIA + '/tools/wh24/#sync', 'wh24sync');

  /* ---- a small panel, so the tab says what it is doing ---- */
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#1e0500;color:#f8ecdc;' +
    'border:1px solid #6b3a10;border-radius:12px;padding:12px 16px;font:13px/1.45 system-ui,sans-serif;' +
    'box-shadow:0 10px 30px rgba(0,0,0,.5);min-width:260px;max-width:340px';
  box.innerHTML = '<b style="color:#ffc164">WH24 Sync</b><div id="wh24msg">Waiting for the Emortia tab…</div>';
  document.body.appendChild(box);
  var say = function (t) { var m = box.querySelector('#wh24msg'); if (m) m.textContent = t; };
  var finish = function (t, bad) {
    say(t); box.style.borderColor = bad ? '#ff7d92' : '#34c98b';
    window.__wh24Running = false;
    setTimeout(function () { box.remove(); }, bad ? 15000 : 6000);
  };

  if (!win) { finish('The browser blocked the Emortia tab. Allow pop-ups for this site and click again.', true); return; }

  /* ---- WorkHub's own GraphQL, with the token this tab already holds ---- */
  function gql(query, variables) {
    var tok = localStorage.getItem('access_token');
    if (!tok) return Promise.reject(new Error('Not signed in to WorkHub24.'));
    return fetch('/api/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: '*/*', authorization: 'Bearer ' + tok },
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.errors && j.errors.length) throw new Error(String(j.errors[0].message && j.errors[0].message.message || j.errors[0].message));
      return j.data;
    });
  }
  /* ---------------------------------------------- the variable declarations

     GraphQL accepts a T! variable anywhere a T is wanted, and NEVER a T
     variable where a T! is required. So the safe declaration is the strictest
     one every call site can satisfy:

       a variable that is always given a value  →  declare it NON-NULL
       a variable that is ever given null       →  must stay nullable

     Q_URL used to declare all four nullable while passing all four. WorkHub
     wants String! for contentId and refused the whole query:

       Variable `$contentId` of type `String` found as input to argument of
       type `String!`

     It had been that way since the PH1 sync was written and never fired,
     because the PDF fetch only runs for a document the page has not already
     read - and PH1's were all read long ago. Widening brought new documents,
     the path ran for the first time in months, and the latent bug surfaced as
     a sync that stopped.

     Four more declarations had the same shape and would have failed the same
     way the moment WorkHub tightened them. They are all non-null now.

     $nodeId and $taskId are the exception and MUST stay nullable: getCard is
     deliberately called with null for both, and declaring them non-null would
     break a query that works. */
  var Q_LIST = 'query ($workflowId: ID!, $queryParams: QueryParams!) { getListCards(workflowId: $workflowId, queryParams: $queryParams) }';
  var Q_CARD = 'query ($id: Int!, $workflowId: ID!, $nodeId: String, $taskId: ID) { getCard(id: $id, workflowId: $workflowId, nodeId: $nodeId, taskId: $taskId) }';
  var Q_TASKS = 'query ($workflowId: String!, $cardId: Int!) { tasks: getTasksHistoryForCard(workflowId: $workflowId, cardId: $cardId) { nodeName status createdDate completedDate } }';
  var Q_URL = 'query ($contentId: String!, $fileName: String!, $id: Int!, $workflowId: ID!) { getContentViewUrl(contentId: $contentId, fileName: $fileName, id: $id, workflowId: $workflowId) }';
  var NOT_DELETED = JSON.stringify([{ type: 'field', value: 'deleted' }, { type: 'operator', value: 'IS_EQUAL_TO' }, { type: 'boolean', value: false }]);

  /* WorkHub's dates are UTC with no zone on the end. Said out loud here, so
     nothing downstream reads them as Colombo time and moves every ticket
     five and a half hours.

     Proved, not assumed: WorkHub builds each card's TITLE with a human
     timestamp in it and returns created_date for the same event, and across
     the cards whose titles carry their creation time, title minus API is
     +5.50 h exactly - Asia/Colombo. So the API value is UTC and WorkHub's own
     screen is the local rendering of it.

     Everything downstream of this line is UTC: the postMessage, the database
     column, done_at. Only the page renders a local day, and it does that with
     localDay() in wh24.js. */
  var utc = function (v) { return v ? String(v).replace(/\.\d+$/, '').replace(/Z?$/, 'Z') : null; };

  function listSince(since, workflow) {
    var out = [], off = 0, PAGE = 100;
    function page() {
      return gql(Q_LIST, { workflowId: workflow, queryParams: {
        fields: ['id', 'created_date', 'last_updated_date'], filters: NOT_DELETED,
        limit: PAGE, offset: off, orderBy: 'id DESC', showArchived: false } })
      .then(function (d) {
        var rows = d.getListCards || [];
        rows.forEach(function (r) { if (utc(r.created_date) >= since) out.push(r); });
        var last = rows[rows.length - 1];
        if (rows.length < PAGE || !last || utc(last.created_date) < since || off > 20000) return out;
        off += PAGE; say('Listing tickets… ' + out.length); return page();
      });
    }
    return page();
  }

  /* A JSON value that may arrive as a string of JSON, or not at all. */
  function json(v, dflt) {
    if (v == null || v === '') return dflt;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (e) { return dflt; }
  }
  function rowsOf(card, keys) {
    var tf = card.table_fields || {};
    for (var i = 0; i < keys.length; i++) {
      var t = json(tf[keys[i]], null);
      if (t && t.rows && t.rows.length) return t.rows;
    }
    return [];
  }

  /* What the ticket asked for lives in a table field of its own. Which one
     depends on the form the ticket was raised on: column_159 on the current
     form, column_62 on the older one. Its columns are named by number:
       63 code · 83 description · 64 quantity · 104 unit · 81 site · 82 name · 85 WO
     The reservation numbers are in another table, 160 (or 108), column 110. */
  /* every PDF attached anywhere on the card, with the field it hangs on -
     PH2 needs the field, because which field a note is attached to is what
     says which vendor stream it belongs to */
  function filesOf(card, only) {
    var out = [];
    Object.keys(card).forEach(function (k) {
      if (only && only.indexOf(k) < 0) return;
      var v = card[k];
      if (typeof v !== 'string' || v.charAt(0) !== '[' || v.indexOf('contentId') < 0) return;
      json(v, []).forEach(function (f) {
        if (f && f.type === 'pdf' && f.contentId) out.push({ name: f.name, cid: f.contentId, at: k });
      });
    });
    return out;
  }
  var timelineOf = function (tasks) {
    return (tasks || []).map(function (t) {
      return { n: t.nodeName, s: t.status, c: utc(t.createdDate), d: utc(t.completedDate) };
    });
  };

  function shape(card, tasks) {
    var req = rowsOf(card, ['column_159', 'column_62']);
    var resv = rowsOf(card, ['column_160', 'column_108']).map(function (r) { return r.column_110; }).filter(Boolean);
    var first = req[0] || {};
    return {
      id: Number(card.id),
      created: utc(card.created_date), updated: utc(card.last_updated_date),
      site: card.column_41 || first.column_81 || '',
      siteName: first.column_82 || '',
      wo: card.column_116 || first.column_85 || '',
      reservation: resv.length ? resv.join(' / ') : (card.column_235 || ''),
      requested: req.map(function (r) {
        return { code: String(r.column_63 || ''), desc: r.column_83 || '', qty: r.column_64, uom: r.column_104 || '' };
      }),
      timeline: timelineOf(tasks),
      files: filesOf(card)
    };
  }

  /* ======================================================== PH2 ============

     A PH2 card is a site work order carrying TWO parallel vendor streams. The
     form holds each stream's reservation and Project/PM order in a table of
     its own, and each stream's issuance note on an attachment field of its
     own. Those four field numbers are the whole of what tells the streams
     apart, and they were read off a dump of real cards rather than guessed:

       Advantis   table column_1030   note field column_957
       ACE        table column_2295   note field column_2305

     Both tables use the same two column numbers inside them - 1032 for the
     reservation, 1031 for the Project/PM order - so only the TABLE id says
     which vendor a row belongs to.

     The pairing was confirmed by the documents, not by the names: a card's
     column_1030 reservation matches the number in the filename of the Goods
     Issue Note on column_957, and its column_2295 reservation matches the
     Activity Report on column_2305. Advantis issues on a GIN; ACE issues on
     an Activity Report. Two cards agree on this.

     THERE IS NO ACTIVITY / GRN FIELD. A stream has a reservation and an order
     and nothing else, so the number that was called "the GRN" IS the
     reservation. Readiness is one test, not two - see ph2Ready in wh24.js.

     A stream can carry MORE THAN ONE reservation and more than one note, and
     a card can have one stream or neither. None of that is an error.

     The material table is NOT split by stream: column_1057 is the site's
     whole requirement and its CTL / Non_CTL tag is a storing location, not a
     vendor. It is carried as `requested` on the card so the expanded ticket
     can show it, and each ROW's lines come from that stream's own document. */
  var PH2 = {
    streams: [
      { name: 'Advantis', table: 'column_1030', notes: 'column_957' },
      { name: 'ACE',      table: 'column_2295', notes: 'column_2305' }
    ],
    res: 'column_1032', order: 'column_1031',
    material: ['column_1057', 'column_2323'],
    site: 'column_41', siteName: 'column_1059', wo: 'column_116'
  };
  function shapePH2(card, tasks) {
    var mat = rowsOf(card, PH2.material);
    var first = mat[0] || {};
    return {
      id: Number(card.id),
      created: utc(card.created_date), updated: utc(card.last_updated_date),
      site: card[PH2.site] || first.column_1058 || '',
      siteName: first[PH2.siteName] || '',
      wo: card[PH2.wo] || first.column_1061 || '',
      /* the site's whole requirement, shown on the expanded ticket and kept
         off every row - it is neither vendor's */
      requested: mat.map(function (r) {
        return { code: String(r.column_1063 || ''), desc: r.column_1064 || '',
                 qty: r.column_1068, uom: r.column_1069 || '',
                 store: r.column_2449 || r.column_2450 || '' };
      }),
      streams: PH2.streams.map(function (st) {
        var rows = rowsOf(card, [st.table]);
        return {
          stream: st.name,
          reservation: rows.map(function (r) { return String(r[PH2.res] || '').trim(); })
                           .filter(Boolean).join(' / '),
          orderNo: rows.map(function (r) { return String(r[PH2.order] || '').trim(); })
                       .filter(Boolean).join(' / '),
          requested: [],                 /* filled from this stream's own note */
          removed: [],
          files: filesOf(card, [st.notes]).map(function (f) { return f.name; })
        };
      }),
      timeline: timelineOf(tasks),
      files: filesOf(card)
    };
  }

  /* ======================================================= Bulk ===========

     One row per card. Its material table is column_62 - the same number PH1's
     older form uses - and its site is column_41, the same as PH1.

     TWO columns both read "Approved" on the cards seen so far and one card
     cannot tell them apart, so BOTH are sent and neither is chosen here. See
     bulkStatus in wh24.js: it reads one, says which, and reports whether the
     other agreed. */
  function shapeBulk(card, tasks) {
    var req = rowsOf(card, ['column_62']);
    var first = req[0] || {};
    return {
      id: Number(card.id),
      created: utc(card.created_date), updated: utc(card.last_updated_date),
      site: card.column_41 || first.column_81 || '',
      siteName: first.column_82 || '',
      wo: card.column_116 || first.column_85 || '',
      reservation: '',
      initiationStatusA: card.column_143 || '',
      initiationStatusB: card.column_146 || '',
      /* 'completed' / 'inprogress' / 'draft'. A draft has no tasks at all and
         must not become a row that claims anything. */
      cardStage: card.stage_id || '',
      requested: req.map(function (r) {
        return { code: String(r.column_63 || ''), desc: r.column_83 || '', qty: r.column_64, uom: r.column_104 || '' };
      }),
      timeline: timelineOf(tasks),
      files: filesOf(card)
    };
  }

  var SHAPE = { PH2: shapePH2, Bulk: shapeBulk };

  function pool(items, n, fn) {
    var i = 0, out = new Array(items.length);
    function next() {
      if (i >= items.length) return Promise.resolve();
      var k = i++;
      return fn(items[k], k).then(function (v) { out[k] = v; return next(); });
    }
    var runners = [];
    for (var j = 0; j < Math.min(n, items.length); j++) runners.push(next());
    return Promise.all(runners).then(function () { return out; });
  }

  function run(cfg) {
    /* the page sends the start of the day in Colombo, already in UTC */
    var since = cfg.sinceIso || ((cfg.since || '2026-08-04') + 'T00:00:00Z');
    var known = cfg.known || {};          /* { ticketId: ['1772793.pdf', …] } */
    var tickets = [], pdfs = [], bufs = [], done = 0;
    /* One pass per source, one after another rather than at once, so the
       panel can say which app it is on and a failure names the app it was
       reading. With one source this is exactly what it did before. */
    return SOURCES.reduce(function (chain, src) {
      return chain.then(function () {
        say('Listing ' + src.phase + ' tickets since ' + cfg.since + '…');
        return listSince(since, src.id).then(function (list) {
          say('Reading ' + list.length + ' ' + src.phase + ' tickets…');
          return pool(list, 6, function (r) {
            var id = Number(r.id);
            return Promise.all([
              gql(Q_CARD, { id: id, workflowId: src.id, nodeId: null, taskId: null }),
              gql(Q_TASKS, { workflowId: src.id, cardId: id })
            ]).then(function (got) {
              var t = (SHAPE[src.phase] || shape)(got[0].getCard, got[1].tasks);
              /* Stamped here, where which app it came from is a fact rather
                 than an inference. Working it out later from the stage
                 wording is exactly the guess this is meant to remove - and
                 it is why these rows had to be hand-labelled twice. */
              t.workflow = src.id;
              t.phase = src.phase;
              tickets.push(t);
              var have = known[id] || [];
              return pool(t.files.filter(function (f) { return have.indexOf(f.name) < 0; }), 2, function (f) {
                return gql(Q_URL, { contentId: f.cid, fileName: f.name, id: id, workflowId: src.id })
                  .then(function (d) { return fetch(d.getContentViewUrl); })
                  .then(function (resp) { if (!resp.ok) throw new Error('GIN ' + f.name + ': ' + resp.status); return resp.arrayBuffer(); })
                  .then(function (buf) { pdfs.push({ id: id, file: f.name, buf: buf }); bufs.push(buf); });
              });
            }).then(function () { done++; say('Read ' + done + ' tickets · ' + pdfs.length + ' new GINs'); });
          });
        });
      });
    }, Promise.resolve()).then(function () {
      tickets.forEach(function (t) { t.files = t.files.map(function (f) { return f.name; }); });
      /* build and sources travel WITH the data, so the page can tell a sync
         that read everything from one that read a third of it and said
         nothing. Both are facts about the copy that ran, which is the only
         thing the page cannot otherwise know. */
      win.postMessage({ type: 'wh24:data', since: cfg.since, at: new Date().toISOString(),
                        build: BUILD, sources: SOURCES.map(function (s) { return s.phase; }),
                        tickets: tickets, pdfs: pdfs }, EMORTIA, bufs);
      finish('Sent ' + tickets.length + ' tickets and ' + pdfs.length + ' new GINs to the Emortia tab.');
    });
  }

  /* The Emortia tab speaks first: it has to be loaded and signed in before
     there is anywhere to send anything. Only that tab, on that origin, is
     listened to. */
  /* Three minutes was as good as silence. By then whoever clicked has gone
     back to what they were doing, the WorkHub tab is behind something else,
     and the panel that would have said so takes itself away fifteen seconds
     later - so a sync that never started looked exactly like one that worked.
     Twenty-five seconds is long enough for a tab to load and sign in, short
     enough that the person is still watching, and this one stays up until it
     is clicked away rather than timing out in an empty room. */
  var nudge = setTimeout(function () {
    say('Still waiting for the Emortia tab… open it and sign in.');
  }, 9000);
  var timer = setTimeout(function () {
    clearTimeout(nudge);
    window.removeEventListener('message', onMsg);
    window.__wh24Running = false;
    say('Sync started but didn\'t finish — open the WH24 tab after clicking the bookmark, ' +
        'sign in there, then click WH24 Sync again.');
    box.style.borderColor = '#ff7d92';
    var b = document.createElement('button');
    b.textContent = 'Close';
    b.style.cssText = 'margin-top:10px;background:#6b3a10;color:#f8ecdc;border:0;border-radius:8px;' +
      'padding:6px 14px;font:inherit;cursor:pointer';
    b.onclick = function () { box.remove(); };
    box.appendChild(b);
  }, 25000);
  function onMsg(e) {
    if (e.origin !== EMORTIA || e.source !== win || !e.data || e.data.type !== 'wh24:hello') return;
    clearTimeout(timer); clearTimeout(nudge);
    window.removeEventListener('message', onMsg);
    run(e.data).catch(function (err) {
      try { win.postMessage({ type: 'wh24:error', message: err.message }, EMORTIA); } catch (x) {}
      finish('Stopped: ' + err.message, true);
    });
  }
  window.addEventListener('message', onMsg);
  /* the tab may have been open already and said hello before we were listening */
  try { win.postMessage({ type: 'wh24:knock' }, EMORTIA); } catch (e) {}
})();
