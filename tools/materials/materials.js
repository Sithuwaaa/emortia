/* materials.js - reading, merging and searching the material list.

   No DOM in here, so it runs under node and the tests are real:

     node tools/materials/materials.test.js

   WHAT THIS MERGES

   Two files describe the same materials from different directions.

   The export (table-export.csv, and the sheet of the same name in the
   workbook) is the spine: one row per material with Type, Description, Code,
   Model, Vendor and two Category columns. Around 1,900 of them.

   The workbook's other sheets are per-category masters - Antennas, Radios,
   Jumpers, Fibers, BBU and so on - and they carry what the export cannot,
   because every category wants different columns. An antenna has a port type
   and a Macro/Lamp flag; a fibre has two connectors, a polish and a mode; a
   radio has a band and a power. Those sheets also hold materials the export
   never had: the two transmission sheets alone add five hundred.

   So the merge is: the export gives every material its Type and its name, the
   category sheets fill in everything else and add what is missing, and the
   material code is the key throughout. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MAT = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var s = function (v) { return String(v == null ? '' : v).trim(); };

  /* A material code is seven to twelve digits. Checked rather than assumed:
     these sheets carry totals, notes and blank spacer rows between the real
     ones, and a row without a code is not a material. */
  function isCode(v) { return /^\d{7,12}$/.test(s(v)); }

  /* ------------------------------------------------------------- the types

     The Type column in the export, and the sheet a row came off, are the same
     seventeen words said two ways. Mapped here so a material found in both
     places lands in one bucket rather than two nearly-identical ones. */
  var SHEET_TYPE = {
    'power mat': 'PWR',
    'tnp_tx': 'TX',
    'tnp_ip': 'IP',
    'civil': 'Civil',
    'fibers': 'Fibers',
    'rru pwr ca': 'RRU PWR',
    'antennas': 'Antenna',
    'com & filters': 'Com & Filters',
    'jumpers': 'Jumpers',
    'radios': 'Radio',
    'aau & air': 'AAU & AIR',
    'ap h & e sfp': 'H & E SFP',
    'bbu': 'BBU',
    'bb,mpt,ext,bb accs': 'BB,MPT,EXT,BB accs',
    'cenrf ibs': 'CenRF IBS',
    'table-export': ''            // the spine: its own Type column decides
  };
  /* Sheets that are not material masters. "Material requirement" and "Ind FP"
     are procurement notes - a code, a quantity and a date somebody asked for
     it - and folding those into a catalogue of what a material *is* would put
     one-off order lines beside the equipment list. */
  function isMasterSheet(name) { return SHEET_TYPE.hasOwnProperty(s(name).toLowerCase()); }
  function typeForSheet(name) { return SHEET_TYPE[s(name).toLowerCase()] || ''; }

  /* ----------------------------------------------------------- the vendors

     Two spellings of every vendor and a column that sometimes holds something
     else entirely. HUA and HUAWEI are one company; the Jumpers sheet has rows
     whose Vendor reads "4.3-10M TO NM JUMPER", which is a port type that ended
     up one column to the left.

     Only a name on this list becomes a vendor. Anything else stays in the
     attributes where it can be read, and out of the filter where it would be
     a chip of one. */
  var VENDOR = {
    'hua': 'Huawei', 'huawei': 'Huawei', 'hw': 'Huawei',
    'eric': 'Ericsson', 'ericsson': 'Ericsson', 'ericson': 'Ericsson',
    'nokia': 'Nokia', 'nsn': 'Nokia',
    'zte': 'ZTE',
    'kathrein': 'Kathrein', 'ketherin': 'Kathrein',
    'commscope': 'CommScope', 'comscope': 'CommScope',
    'andrew': 'Andrew',
    'powerwave': 'PowerWave', 'p.wave': 'PowerWave',
    'rfs': 'RFS', 'amphenol': 'Amphenol', 'cenrf': 'CenRF',
    'wi-bas': 'Wi-Bas', 'wibas': 'Wi-Bas'
  };
  function normVendor(v) {
    var k = s(v).toLowerCase().replace(/[.\s_-]+$/, '');
    return VENDOR[k] || VENDOR[k.replace(/[^a-z]/g, '')] || '';
  }

  /* --------------------------------------------------------- reading a sheet

     Every sheet names its code and description column differently - Material,
     Material Code, MC - and two of them put a title row above the headings. So
     the header is found rather than assumed: the first row in the top six that
     names both a code and a description. */
  function findHeader(rows) {
    for (var i = 0; i < Math.min(rows.length, 6); i++) {
      var c = (rows[i] || []).map(function (x) { return s(x).toLowerCase(); });
      var code = c.some(function (h) { return /^(material|material code|mc|materil code)$/.test(h); });
      var desc = c.some(function (h) { return /description|material name/.test(h); });
      if (code && desc) return i;
    }
    return -1;
  }

  function readSheet(name, rows) {
    var out = [];
    if (!Array.isArray(rows) || !isMasterSheet(name)) return out;
    var h = findHeader(rows);
    if (h < 0) return out;
    var head = (rows[h] || []).map(s);
    var ci = -1, di = -1, ti = -1;
    head.forEach(function (x, k) {
      var l = x.toLowerCase();
      if (ci < 0 && /^(material|material code|mc|materil code)$/.test(l)) ci = k;
      if (di < 0 && /description|material name/.test(l)) di = k;
      if (ti < 0 && l === 'type') ti = k;
    });
    if (ci < 0 || di < 0) return out;

    var sheetType = typeForSheet(name);
    for (var r = h + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      if (!isCode(row[ci])) continue;
      var attrs = {};
      head.forEach(function (label, k) {
        if (k === ci || k === di || !label) return;
        if (s(row[k])) attrs[label] = s(row[k]);
      });
      out.push({
        code: s(row[ci]),
        desc: s(row[di]),
        /* the export carries its own Type; a category sheet is its own Type */
        type: sheetType || (ti >= 0 ? s(row[ti]) : ''),
        attrs: attrs
      });
    }
    return out;
  }

  /* Read a whole workbook: { 'Sheet name': [[cell,...],...] }. The CSV is
     handed in the same way, under the name 'table-export', because it is the
     same table. */
  function readWorkbook(sheets) {
    var recs = [];
    Object.keys(sheets || {}).forEach(function (name) {
      recs = recs.concat(readSheet(name, sheets[name]));
    });
    return recs;
  }

  /* ------------------------------------------------------------- the merge

     One record per code. The longest description wins - the export truncates
     some of them and the category sheets do not - and the first type wins,
     which is why the spine is read first. Attributes accumulate; a blank never
     overwrites something that has a value. */
  function collate(records) {
    var by = {}, order = [];
    (records || []).forEach(function (r) {
      var code = s(r.code);
      if (!isCode(code)) return;
      var cur = by[code];
      if (!cur) { cur = by[code] = { code: code, desc: '', type: '', vendor: '', attrs: {} }; order.push(code); }
      var d = s(r.desc);
      if (d.length > cur.desc.length) cur.desc = d;
      if (!cur.type && s(r.type)) cur.type = s(r.type);
      Object.keys(r.attrs || {}).forEach(function (k) {
        var v = s(r.attrs[k]);
        if (v && !cur.attrs[k]) cur.attrs[k] = v;
      });
    });
    return order.map(function (c) {
      var r = by[c];
      r.vendor = normVendor(r.attrs.Vendor || r.attrs.vendor || '');
      return r;
    });
  }

  /* What a record hashes to, for deciding whether an upload changed it. The
     attribute keys are sorted so that two readings of the same row in a
     different column order are the same material, not a changed one. */
  /* An explicit escape rather than the character itself: a literal U+0001
     in the source is invisible, and an invisible separator is one somebody
     later deletes by accident while tidying whitespace. */
  var SEP = '\u0001';
  function fingerprint(r) {
    var keys = Object.keys(r.attrs || {}).sort();
    var bits = [s(r.desc), s(r.type), s(r.vendor)];
    keys.forEach(function (k) { bits.push(k + '=' + s(r.attrs[k])); });
    var str = bits.join(SEP), h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }

  /* An upload is not a replacement. It says what it knows, and what it knows
     is merged into what is already there: a material it does not mention is
     left alone, because the two files each cover part of the list and neither
     is the whole of it.

     Returns the rows to write and a count of what happened, so the page can
     say "4 changed, 2,418 already right" rather than "done". */
  function planUpload(incoming, existing) {
    var have = {};
    (existing || []).forEach(function (r) { have[s(r.code)] = r; });

    var merged = collate((existing || []).concat(incoming || []));
    var write = [], added = 0, changed = 0, unchanged = 0;

    merged.forEach(function (r) {
      var was = have[r.code];
      if (!was) { added++; write.push(r); return; }
      if (fingerprint(was) !== fingerprint(r)) { changed++; write.push(r); return; }
      unchanged++;
    });
    return { write: write, added: added, changed: changed, unchanged: unchanged, total: merged.length };
  }

  /* ------------------------------------------------------------ the filters

     Type first, because that is how somebody asks: they want the antennas, or
     the RRU power cables. Vendor second, because the next question is which
     Huawei one. Both are counted from the data rather than listed by hand, so
     a type that appears in a future upload appears as a chip on its own. */
  function facets(records) {
    var t = {}, v = {};
    (records || []).forEach(function (r) {
      var k = s(r.type) || '—';
      t[k] = (t[k] || 0) + 1;
      if (r.vendor) v[r.vendor] = (v[r.vendor] || 0) + 1;
    });
    var sortByCount = function (o) {
      return Object.keys(o).map(function (k) { return { name: k, count: o[k] }; })
        .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
    };
    return { types: sortByCount(t), vendors: sortByCount(v) };
  }

  /* Everything about a material, lowercased, for the search to run over. The
     code is in here twice over - as typed and without leading zeros - because
     it is the one thing people paste in whole. */
  function haystack(r) {
    var bits = [r.code, r.desc, r.type, r.vendor];
    Object.keys(r.attrs || {}).forEach(function (k) { bits.push(r.attrs[k]); });
    return bits.join('  ').toLowerCase();
  }

  /* Every word has to land somewhere, in any order: "huawei 12awg" finds the
     cable whether the description says Huawei first or the vendor column does. */
  function hit(hay, q) {
    var parts = s(q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!parts.length) return true;
    for (var i = 0; i < parts.length; i++) if (hay.indexOf(parts[i]) < 0) return false;
    return true;
  }

  function view(records, opts) {
    opts = opts || {};
    var type = s(opts.type), vendor = s(opts.vendor), q = s(opts.q);
    var out = (records || []).filter(function (r) {
      if (type && (s(r.type) || '—') !== type) return false;
      if (vendor && r.vendor !== vendor) return false;
      if (q && !hit(r._hay || (r._hay = haystack(r)), q)) return false;
      return true;
    });
    /* code order, so the same search always lists the same way */
    out.sort(function (a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; });
    return out;
  }

  /* ---------------------------------------------------------- the detail

     The attributes a material carries depend entirely on what it is, so the
     panel cannot have a fixed set of fields. These are the ones worth showing
     first where they exist; everything else follows in the order the sheet had
     them. Blank ones are not shown at all - a fibre has no band and an antenna
     has no polish, and a column of dashes says nothing. */
  var LEAD = ['Vendor', 'Model', 'Model Name', 'Category', 'Category 1', 'Category 2',
              'Type - Cat', 'Band', 'Protocol-defined Band', 'Power (W)', 'Port Type',
              'Macro/Lamp', 'Length (m)', 'Length of Cable (m)', 'Gage', 'Remarks'];
  function details(r) {
    var seen = {}, out = [];
    LEAD.forEach(function (k) {
      if (r.attrs && s(r.attrs[k])) { out.push({ k: k, v: s(r.attrs[k]) }); seen[k] = 1; }
    });
    Object.keys(r.attrs || {}).forEach(function (k) {
      if (seen[k]) return;
      if (s(r.attrs[k])) out.push({ k: k, v: s(r.attrs[k]) });
    });
    return out;
  }

  /* What lands on the clipboard. The code alone by default: it is what goes
     into SAP, and anything else attached to it is something to delete. */
  function copyText(r, what) {
    if (what === 'desc') return s(r.desc);
    if (what === 'row') return [s(r.code), s(r.desc), s(r.type), s(r.vendor)].join('\t');
    return s(r.code);
  }

  return {
    isCode: isCode, normVendor: normVendor, isMasterSheet: isMasterSheet,
    typeForSheet: typeForSheet, findHeader: findHeader, readSheet: readSheet,
    readWorkbook: readWorkbook, collate: collate, fingerprint: fingerprint,
    planUpload: planUpload, facets: facets, haystack: haystack, hit: hit,
    view: view, details: details, copyText: copyText
  };
}));
