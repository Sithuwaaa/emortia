/* Emortia · tools/_lib/sapdocs.js
   Reading the two sheets of paper SAP prints at the warehouse.

   ONE reader, two tools. The GIN Extractor had both parsers and the WH24
   checker had a second, weaker copy of the first one, so the same document
   could be read two ways depending on which page you were standing on. This
   is the GIN Extractor's pair, moved here unchanged - byte for byte, lifted
   rather than retyped - and WH24's copy is gone.

   The two documents are:

   - GOODS ISSUE NOTE. What the Engineering Warehouse and Advantis print when
     material is issued against a reservation. Has an ITEM CODE table, a GI
     number, a reservation number and a serial number per line.

   - ACTIVITY REPORT, Equipment / Asset Movement. What ACE's end of a PH2 job
     prints. No ITEM CODE and no quantity column: one row per serialised unit,
     each carrying an equipment number, moving between functional locations.

   Nobody is asked which kind they have. The paper says so itself, which is
   what sniff() reads.

   Input is pdf.js text fragments - [page][{x, y, s}] - because that is what
   both callers already build and neither of them should have to build
   anything else. Nothing here touches the DOM or pdf.js, so it runs in node.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SAPDocs = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SKIP_RE = /^-{3,}$|^Date\s*:?$|^(Issued by|Checked By|Received by|Checked By-Security Officer)$/i;
  const JUNK_RE = /^Page\s*No\b|^\d{2}\.\d{2}\.\d{4}\s*\/\s*\d{2}:\d{2}|^GIN\s*:/i;

  function parseGIN(pages, allLines) {
    const allItems = [];
    let prevCols = null;
    let open = null;   // an item still being built when a page ends (spans the break)

    for (const frags of pages) {
      const res = parsePageItems(frags, prevCols, open);
      allItems.push(...res.items);
      open = res.open;                 // carry the unfinished item into the next page
      if (res.cols) prevCols = res.cols;
    }
    if (open) allItems.push(open);     // flush the final item

    const d = extractHeaderFields(allLines);
    d.kind = 'gin';
    d.items = allItems.map(finalizeItem);
    return d;
  }

  function groupIntoLines(frags) {
    const buckets = [];
    for (const f of frags) {
      let b = buckets.find(b => Math.abs(b.y - f.y) < 3);
      if (!b) { b = { y: f.y, frags: [] }; buckets.push(b); }
      b.frags.push(f);
    }
    buckets.sort((a, b) => b.y - a.y);
    return buckets.map(b =>
      b.frags.sort((a, b) => a.x - b.x).map(f => f.s).join(' ')
        .replace(/\s+/g, ' ').trim()
    );
  }

  function grab(text, label) {
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*(.+)', 'i');
    for (const line of text) {
      const m = line.match(re);
      if (m && m[1].trim() && m[1].trim() !== ':') return m[1].replace(/^:\s*/, '').trim();
    }
    return '';
  }

  function extractHeaderFields(lines) {
    return {
      giNumber:  (grab(lines,'GI Number').match(/\d+/) || [''])[0],
      docDate:    grab(lines,'Document Date').split(' ')[0] || '',
      resNo:     (grab(lines,'Reservation number').match(/\d+/) || [''])[0],
      plantName:  grab(lines,'Plant-Name'),
      slocName:   grab(lines,'Storage Location-Name'),
      issuedBy:   grab(lines,'Issued by'),
      requestedBy:grab(lines,'Requested by'),
      issuedTo:   grab(lines,'Issued To'),
      movType:   (grab(lines,'Movement Type').match(/\d+/) || [''])[0],
      order:     (grab(lines,'Order').match(/\d+/) || [''])[0],
      createdBy:  grab(lines,'Created by'),
      items: []
    };
  }

  function findHeader(frags) {
    const labels = [
      { key: 'num',  re: /^#$/ },
      { key: 'code', re: /^ITEM\s*CODE$/i },
      { key: 'desc', re: /^DESCRIPTION$/i },
      { key: 'uom',  re: /^UOM$/i },
      { key: 'qty',  re: /^QTY$/i },
      { key: 'sn',   re: /^S\/N$/i },
      { key: 'loc',  re: /^LOCATION$/i }
    ];
    const byY = [];
    for (const f of frags) {
      let b = byY.find(b => Math.abs(b.y - f.y) < 3);
      if (!b) { b = { y: f.y, frags: [] }; byY.push(b); }
      b.frags.push(f);
    }
    for (const line of byY) {
      const found = {};
      for (const f of line.frags) {
        const t = f.s.trim();
        for (const l of labels) if (l.re.test(t) && !(l.key in found)) found[l.key] = f.x;
      }
      if ('code' in found && 'desc' in found && 'qty' in found && 'loc' in found) {
        if (!('num' in found)) found.num = 0;
        if (!('uom' in found)) found.uom = (found.desc + found.qty) / 2;
        if (!('sn' in found))  found.sn  = (found.qty + found.loc) / 2;
        return { y: line.y, cols: found };
      }
    }
    return null;
  }

  const GIN_ORDER  = ['num','code','desc','uom','qty','sn','loc'];
  const MOVE_ORDER = ['no','equip','code','mat','desc','uom','sn'];

  function assignColumn(x, cols, order) {
    const xs = order.map(k => cols[k]);
    let col = order[0];
    for (let i = 1; i < order.length; i++) {
      const boundary = (xs[i - 1] + xs[i]) / 2;
      if (x >= boundary - 2) col = order[i];
    }
    return col;
  }

  /* SAP wraps mid-token: lines whose boundary words carry underscores
     (or end in - / _) re-join with no space. */
  function joinDescLines(descLines) {
    let out = '';
    for (const line of descLines) {
      if (!out) { out = line; continue; }
      const lastWord = out.split(/\s+/).pop();
      const firstWord = line.split(/\s+/)[0];
      const noSpace = /[_\-\/]$/.test(out) || lastWord.includes('_') || firstWord.includes('_');
      out += (noSpace ? '' : ' ') + line;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function finalizeItem(it) {
    return {
      num:  it.num,
      code: it.code.replace(/\s+/g, ''),
      desc: joinDescLines(it.descLines),
      uom:  it.uom.toUpperCase(),
      qty:  parseFloat(String(it.qty).replace(/,/g, '')) || it.qty,
      sns:  it.snToks.filter(Boolean),
      loc:  it.locFrags.join('').replace(/\s+/g, '').replace(/GIN:?\d*$/i, '')
    };
  }

  function parsePageItems(frags, prevCols, carryItem) {
    const hdr = findHeader(frags);
    const cols = hdr ? hdr.cols : prevCols;
    if (!cols) return { items: [], cols: null, open: carryItem || null };
    const topY = hdr ? hdr.y : Infinity;

    const buckets = [];
    for (const f of frags) {
      if (f.y >= topY - 1) continue;              // only rows below the table header
      const t = f.s.trim();
      if (SKIP_RE.test(t) || JUNK_RE.test(t)) continue;  // signatures + page footers
      let b = buckets.find(b => Math.abs(b.y - f.y) < 3);
      if (!b) { b = { y: f.y, frags: [] }; buckets.push(b); }
      b.frags.push(f);
    }
    buckets.sort((a, b) => b.y - a.y);

    const items = [];
    let cur = carryItem || null;   // continue an item carried over from the previous page
    for (const line of buckets) {
      line.frags.sort((a, b) => a.x - b.x);
      const cells = { num:[], code:[], desc:[], uom:[], qty:[], sn:[], loc:[] };
      for (const f of line.frags) {
        // strip a trailing "GIN : 12345" tag SAP glues onto the last cell of a page
        const t = f.s.trim().replace(/\s*GIN\s*:?\s*\d+\s*$/i, '').trim();
        if (!t) continue;
        const colKey = assignColumn(f.x, cols, GIN_ORDER);
        if (colKey === 'num') {
          const m = t.match(/^(\d{1,3})\s+(\d{8,12})(?:\s+(.*))?$/);
          if (m) {
            cells.num.push(m[1]); cells.code.push(m[2]);
            if (m[3]) cells.desc.push(m[3]);
            continue;
          }
        }
        cells[colKey].push(t);
      }
      const numTok = cells.num.join(' ').trim();
      if (/^\d{1,3}$/.test(numTok)) {
        if (cur) items.push(cur);
        cur = { num: numTok, code:'', descLines:[], uom:'', qty:'', snToks:[], locFrags:[] };
      }
      if (!cur) continue;  // stray text before the first item and with no carried item
      if (cells.code.length) cur.code = (cur.code + cells.code.join('')).trim();
      if (cells.desc.length) cur.descLines.push(cells.desc.join(' '));
      if (cells.uom.length && !cur.uom) cur.uom = cells.uom.join(' ').trim();
      if (cells.qty.length && !cur.qty) cur.qty = cells.qty.join(' ').trim();
      if (cells.sn.length)   cur.snToks.push(...cells.sn.join(' ').split(/\s+/));
      if (cells.loc.length)  cur.locFrags.push(...cells.loc);
    }
    // Do NOT push `cur` here - it may continue on the next page. Return it as "open".
    return { items, cols, open: cur };
  }

  /* ==================================================================
     ACTIVITY REPORT - Equipment / Asset Movement.

     The same idea as above, against a different sheet of paper. Three
     things about this one need saying:

     - Every page repeats the whole header block, so a field is looked up
       once and the first page that answers wins.
     - A serial number is wrapped mid-token by SAP: "R4875GDUMMY000000"
       on one line and "4" on the next. The pieces are joined with nothing
       between them, because they were one word before the column was too
       narrow for it.
     - An equipment row can begin on one page and finish on the next -
       item 6 of this report carries its serial over the break - so the
       unfinished row is handed to the next page rather than closed.
     ================================================================== */

  const MOVE_SKIP_RE =
    /^_{3,}$|^Number$|^Date\s*:?$|^Issued by$|^Received by$|^Checked by\b|^Page\s*:|^User\s*:|^Prited\b|^Printed\b/i;

  const MOVE_FIELDS = [
    ['rep',        'Activity Report No.'],
    ['createdBy',  'Created By'],
    ['createdOn',  'Created On'],
    ['changedBy',  'Last Change By'],
    ['changedOn',  'Last Change On'],
    ['reportedBy', 'Reported By'],
    ['status',     'Status'],
    ['plant',      'Maintenance Plant'],
    ['issuedTo',   'Issued To'],
    ['remarks',    'Remarks'],
    ['descr',      'Description'],
    ['sendLoc',    'Sending Func. Location'],
    ['sendDesc',   'Sending Func. Loc. Desc.'],
    ['recvLoc',    'Receiving Func. Location'],
    ['recvDesc',   'Receiving Func. Loc. Desc.'],
    ['vendorCode', 'Vendor Code'],
    ['vendorName', 'Vendor Name'],
    ['address',    'Address']
  ];

  const labelKey = s => s.trim().replace(/\s+/g, ' ').replace(/[.:]+$/, '').toLowerCase();

  function bucketRows(frags) {
    const out = [];
    for (const f of frags) {
      let b = out.find(b => Math.abs(b.y - f.y) < 3);
      if (!b) { b = { y: f.y, frags: [] }; out.push(b); }
      b.frags.push(f);
    }
    out.sort((a, b) => b.y - a.y);
    for (const r of out) r.frags.sort((a, b) => a.x - b.x);
    return out;
  }

  /* label on the left, value in its own column to the right, on the same
     line - near enough, since SAP sets the two a few points apart */
  function moveField(frags, label) {
    const want = labelKey(label);
    const lab = frags.find(f => labelKey(f.s) === want);
    if (!lab) return '';
    const val = frags
      .filter(f => f.x > lab.x + 30 && Math.abs(f.y - lab.y) <= 7)
      .sort((a, b) => a.x - b.x)
      .map(f => f.s.trim())
      .join(' ')
      .replace(/^:\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    return /^[,;\-\s]*$/.test(val) ? '' : val;   // ":," is an empty address
  }

  function moveHeader(frags) {
    for (const line of bucketRows(frags)) {
      const at = re => { const f = line.frags.find(g => re.test(g.s.trim())); return f ? f.x : null; };
      const desc = at(/^Mat\.?\s*Desc/i);
      const code = at(/^Code$/i);
      const mat  = at(/^Material$/i);
      if (desc === null || code === null || mat === null) continue;
      // "No. Equipment" is one fragment and "Number" wraps below it, so the
      // equipment column is placed from the left edge rather than found
      const no  = at(/^No\.(\s|$)/) ?? 28;
      const uom = at(/^UoM\b/i) ?? 414;
      return { y: line.y, cols: { no, equip: no + 23, code, mat, desc, uom, sn: uom + 25 } };
    }
    return null;
  }

  function parseMovePage(frags, prevCols, carry) {
    const hdr = moveHeader(frags);
    const cols = hdr ? hdr.cols : prevCols;
    if (!cols) return { items: [], cols: null, open: carry || null };
    const topY = hdr ? hdr.y : Infinity;

    const items = [];
    let cur = carry || null;

    for (const line of bucketRows(frags)) {
      if (line.y >= topY - 1) continue;          // the header block and above
      const cells = { no:[], equip:[], code:[], mat:[], desc:[], uom:[], sn:[] };
      let any = false;
      for (const f of line.frags) {
        const t = f.s.trim();
        if (!t || MOVE_SKIP_RE.test(t)) continue;
        cells[assignColumn(f.x, cols, MOVE_ORDER)].push(t);
        any = true;
      }
      if (!any) continue;

      const noTok = cells.no.join('').trim();
      if (/^\d{1,4}$/.test(noTok) && cells.equip.length) {
        if (cur) items.push(cur);
        cur = { num: noTok, equip:'', code:'', material:'', descLines:[], uom:'', snToks:[] };
      }
      if (!cur) continue;
      if (cells.equip.length) cur.equip += cells.equip.join('');
      if (cells.code.length && !cur.code) cur.code = cells.code.join('');
      if (cells.mat.length)  cur.material += cells.mat.join('');
      if (cells.desc.length) cur.descLines.push(cells.desc.join(' '));
      if (cells.uom.length && !cur.uom) cur.uom = cells.uom.join('');
      if (cells.sn.length)   cur.snToks.push(cells.sn.join(''));
    }
    return { items, cols, open: cur };
  }

  function finalizeMove(it) {
    return {
      num:      it.num,
      equip:    it.equip.replace(/\s+/g, ''),
      code:     it.code.replace(/\s+/g, ''),
      material: it.material.replace(/\s+/g, ''),
      desc:     joinDescLines(it.descLines),
      uom:      it.uom.toUpperCase(),
      sn:       it.snToks.join('').replace(/\s+/g, '')
    };
  }

  function parseMovement(pages, allLines) {
    const d = { kind: 'move' };
    for (const [key] of MOVE_FIELDS) d[key] = '';
    for (const frags of pages) {
      for (const [key, label] of MOVE_FIELDS) {
        if (d[key]) continue;
        const v = moveField(frags, label);
        if (v) d[key] = v;
      }
    }
    d.rep = (d.rep.match(/\d+/) || [''])[0];

    const items = [];
    let prevCols = null, open = null;
    for (const frags of pages) {
      const res = parseMovePage(frags, prevCols, open);
      items.push(...res.items);
      open = res.open;
      if (res.cols) prevCols = res.cols;
    }
    if (open) items.push(open);

    d.items = items.map(finalizeMove);
    return d;
  }

  /* ------------------------------------------------------------- the sniff

     Lifted out of the GIN Extractor's parsePDF, which is the only part of
     that function that was ever a reading decision rather than plumbing. */
  function sniff(pages) {
    var lines = [];
    (pages || []).forEach(function (frags) { lines.push.apply(lines, groupIntoLines(frags)); });
    var movement = lines.some(function (l) {
      return /Equipment\s*\/\s*Asset\s*Movement/i.test(l) || /Activity\s*Report\s*No/i.test(l);
    });
    return { movement: movement, lines: lines };
  }

  function parse(pages) {
    var s = sniff(pages);
    return s.movement ? parseMovement(pages, s.lines) : parseGIN(pages, s.lines);
  }

  /* ------------------------------------------------------ the WH24 shape

     WH24 stores a GIN on a ticket line and reads it back in half a dozen
     places - g.gi, g.date, g.res, g.qty, g.sn - and those names are in the
     database, in the Excel export and in W.issueCheck. They are not worth
     renaming for the sake of this move, so the richer document is narrowed to
     them here instead. Only the shape changes; every value is the parser's.

     sloc, wbs and mv are read off the joined lines, the way readGin read them,
     and not off the extractor's header block. For sloc and wbs that is because
     the header block does not collect them at all. For mv it is because the
     two disagree: the extractor keeps only the digits of Movement Type, and
     readGin kept the trailing letter - "281 Q", not "281". That value is
     already in the database and in the sheet, so readGin's reading is the one
     that has to survive the move. */
  function field(lines, k) {
    var re = new RegExp(k + '\\s*:\\s*([^\\n]*)');
    for (var i = 0; i < lines.length; i++) {
      var m = re.exec(lines[i]);
      if (m) return String(m[1] == null ? '' : m[1]).replace(/\s+/g, ' ').trim();
    }
    return '';
  }
  /* An empty heading reads the next heading as its value - WBS : with nothing
     after it picks up 'Cost Centre :'. A value that is itself a heading is no
     value. (readGin's rule, kept.) */
  function notAHeading(v) { return /^[A-Za-z /]+ ?:/.test(v) ? '' : v; }

  /* SAP writes 30.09.2026; Advantis writes 08/07/2026, month first. Both come
     back as YYYY-MM-DD, and anything else comes back empty. */
  function isoDate(v) {
    var s = String(v == null ? '' : v).trim();
    var dot = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
    if (dot) return dot[3] + '-' + pad(dot[2]) + '-' + pad(dot[1]);
    var sl = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (sl) return sl[3] + '-' + pad(sl[1]) + '-' + pad(sl[2]);
    return '';
  }
  function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }
  function num(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  function ginShape(doc, lines) {
    if (!doc || doc.kind !== 'gin') return null;
    var ls = lines || [];
    var mv = field(ls, 'Movement Type');
    return {
      gi:   doc.giNumber || '',
      date: isoDate(doc.docDate),
      res:  doc.resNo || '',
      sloc: field(ls, 'Issue from S ?Loc'),
      wbs:  notAHeading(field(ls, 'WBS')),
      mv:   /^\d+ ?[A-Z]?$/.test(mv) ? mv : '',
      items: (doc.items || []).map(function (it) {
        /* "M 3,500.00" arrives in one cell when SAP sets the unit and the
           quantity too close together to tell apart by x. The extractor shows
           that cell as it found it; WH24 counts against the number, so it is
           split here. readGin's rule, and the reason it existed. */
        var uom = it.uom, qty = it.qty;
        var one = /^(\S+)\s+([\d,.]+)$/.exec(String(uom == null ? '' : uom));
        if (one && (qty === '' || qty == null)) { uom = one[1]; qty = num(one[2]); }
        return { code: it.code, desc: it.desc, uom: uom, qty: qty, sn: it.sns || [] };
      })
    };
  }

  /* ------------------------------- the Activity Report, in the same shape

     THIS IS ACE'S ISSUANCE DOCUMENT, not a curiosity to be set aside. The
     ordering test settled it: on a real card the report's Created On is the
     same day the card's "System Issuance Done - ACE" task opened, and the
     Advantis GIN's document date is the same day the unsuffixed issuance task
     opened - two tracks three months apart, each document landing on its own
     track's day.

     It was being counted and discarded, which left every PH2 ACE stream with
     no note, therefore never ready, therefore in Needs checking for a reason
     that was not true. That code was written before anything consumed a
     movement document and was never revisited when something did.

     The form carries no posting date - Created On and the print stamp are the
     only two dates on it - so Created On is the date, and the field it came
     from is recorded on the document so a later reader can see which it was.

     No quantity column either: one row per serialised unit, which is a fact
     the paper states rather than one worth inferring around. So lines are
     grouped by material and the quantity IS the number of rows. */
  /* this file has no string helper of its own - wh24.js's s() is not in
     scope here, and reaching for it is how the first version of this threw */
  function str(v) { return String(v == null ? '' : v).trim(); }
  function moveShape(doc, file) {
    if (!doc) return null;
    var by = {}, order = [];
    (doc.items || []).forEach(function (it) {
      var code = str(it.material) || str(it.code);
      if (!code) return;
      if (!by[code]) { by[code] = { code: code, desc: str(it.desc), uom: str(it.uom), qty: 0, sn: [] }; order.push(code); }
      by[code].qty += 1;
      if (str(it.sn)) by[code].sn.push(str(it.sn));
    });
    return {
      file: str(file),
      kind: 'move',
      gi: '',                       /* a report has no GI number */
      rep: str(doc.rep),
      date: isoDate(doc.createdOn),
      date_field: 'Created On',     /* the label, recorded rather than implied */
      res: '',                      /* and no reservation on it either */
      sloc: str(doc.sendLoc), wbs: '', mv: '',
      items: order.map(function (c) { return by[c]; })
    };
  }

  /* What WH24 asks for: a document in the shape the tool stores, whichever of
     the two sheets of paper it turns out to be. */
  function readAny(pages) {
    var s2 = sniff(pages);
    if (s2.movement) {
      var mv = parseMovement(pages, s2.lines);
      return { kind: 'move', move: mv, gin: moveShape(mv) };
    }
    var doc = parseGIN(pages, s2.lines);
    var g = ginShape(doc, s2.lines);
    if (g) { g.kind = 'gin'; g.date_field = 'Document Date'; }
    return { kind: 'gin', gin: g, doc: doc };
  }

  return { parse: parse, sniff: sniff, parseGIN: parseGIN, parseMovement: parseMovement,
           groupIntoLines: groupIntoLines, ginShape: ginShape, readAny: readAny, moveShape: moveShape,
           isoDate: isoDate };
}));
