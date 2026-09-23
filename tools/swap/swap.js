/* swap.js - the parts of the Austin SWAP tool that are worth testing on their
   own. No DOM: data in, data out. What a record has to have before it can be
   filed, what the material list answers when a code is typed, and what the
   warehouse's spreadsheet looks like.

   The shape of the thing: an Airtel tower and a Dialog tower become one site.
   One of them comes down - usually the Airtel one - and what is taken off it,
   and sometimes off the other as well, has to reach the warehouse as a list of
   codes and serial numbers. Some of it never reaches the warehouse: it goes
   straight onto another site, and saying so is the difference between a
   remapped radio and a missing one. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.SwapCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const norm = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  const upper = v => norm(v).toUpperCase();
  /* Site IDs come off a screen or a phone: lower case, a stray full stop, a
     space in the middle. All of those are the same site. */
  const siteKey = v => upper(v).replace(/[^A-Z0-9]/g, '');

  /* Which tower a material came off, and which one is coming down. Both are
     kept: "removed from the Dialog tower on a swap where Airtel is the one
     being dismantled" is a real line and the warehouse needs to see it. */
  const SIDES = [['airtel', 'Airtel'], ['dialog', 'Dialog']];
  const REMOVED = [
    ['airtel', 'Airtel tower removed'],
    ['dialog', 'Dialog tower removed'],
    ['both',   'Materials off both towers']
  ];
  const sideLabel = s => (SIDES.find(x => x[0] === s) || [, 'Airtel'])[1];
  const removedLabel = s => (REMOVED.find(x => x[0] === s) || [, ''])[1];

  /* Where a material is going. Anything not going to the warehouse has to say
     where instead, or it is written off as lost. */
  const DESTS = [['wh', 'To warehouse'], ['remap', 'Remapped to a site'], ['scrap', 'Scrapped on site']];
  const destLabel = d => (DESTS.find(x => x[0] === d) || [, 'To warehouse'])[1];

  /* Where it is going and where it actually is are two different questions,
     and neither of them is the one asked three weeks later, which is "where
     has it been?". A radio comes off the Airtel tower, sits with the team,
     reaches the warehouse, and some weeks after that goes up on another site
     - and sometimes it goes straight from the tower to the other site and
     never sees the warehouse at all. Both are ordinary; only a list of steps
     can hold them both.

     So a material line carries its journey rather than a status. The first
     step is the removal itself, which is the visit the record was filed on;
     every step after it is added as it happens, by whoever knows. Where it is
     now is simply the last step. */
  const STEPS = [
    ['team',     'With the team'],
    ['wh',       'At the warehouse'],
    ['site',     'Installed at a site'],
    ['scrapped', 'Scrapped']
  ];
  const stepLabel = t => (STEPS.find(x => x[0] === t) || [, 'With the team'])[1];

  const blankMove = to => ({ to: to || 'team', on: new Date().toISOString().slice(0, 10),
                             site: '', siteName: '', note: '' });
  /* An older line, filed before this was a list, still answers: its single
     status becomes the one step it had. */
  function movesOf(it) {
    if (it && Array.isArray(it.moves) && it.moves.length) return it.moves;
    const to = it && it.at === 'remapped' ? 'site' : (it && it.at) || 'team';
    return [{ to: to === 'site' && !(it && it.remapSite) ? 'team' : to,
              on: (it && it.atOn) || '', site: (it && it.remapSite) || '', siteName: (it && it.remapName) || '',
              note: (it && it.atNote) || '' }];
  }
  const whereNow = it => { const m = movesOf(it); return m[m.length - 1]; };
  const whereLabel = m => !m ? '' : (m.to === 'site'
    ? 'Installed at ' + (upper(m.site) || 'a site') : stepLabel(m.to));
  /* The whole journey as one line, starting at the tower it came off. */
  function timeline(rec, it) {
    const out = [{ to: 'removed', label: 'Off the ' + sideLabel(it.from) + ' tower',
                   on: norm(rec && (rec.visitedOn || rec.visited_on)) }];
    movesOf(it).forEach(m => out.push({ to: m.to, label: whereLabel(m), on: norm(m.on), note: norm(m.note) }));
    return out;
  }
  const chainText = (rec, it) => timeline(rec, it)
    .map(s => s.label + (s.on ? ' (' + s.on + ')' : '')).join(' → ');

  /* ------------------------------------------------------- the site lookup

     Built once from the Site Access dataset ({cols, rows}) and asked for a
     name per keystroke, so it has to be a map rather than a scan of thousands
     of rows. The same index answers for the Airtel tower, the Dialog tower
     and wherever a material is being remapped to. */
  function buildIndex(ds) {
    const idx = {};
    if (!ds || !Array.isArray(ds.cols) || !Array.isArray(ds.rows)) return idx;
    const at = name => ds.cols.findIndex(c => norm(c).toLowerCase() === name);
    const idCols = ['site_id', 'siteid', 'site id', 'other_site_ids'].map(at).filter(i => i >= 0);
    const nameCol = ['site_name', 'sitename', 'site name'].map(at).find(i => i >= 0);
    if (!idCols.length || nameCol == null || nameCol < 0) return idx;
    ds.rows.forEach(r => {
      const nm = norm(r[nameCol]);
      if (!nm) return;
      idCols.forEach(c => String(r[c] == null ? '' : r[c]).split(/[,;/]+/).forEach(one => {
        const k = siteKey(one);
        if (k && !idx[k]) idx[k] = nm;
      }));
    });
    return idx;
  }
  const findSite = (idx, id) => (idx || {})[siteKey(id)] || '';

  /* ----------------------------------------------------- the material list

     Codes and names come off the Material Codes tool, which is the one place
     that knows both. Typing a code fills the name in; typing part of a name
     finds the code. Nothing here invents a material: a code that is not on
     the list is only allowed through for the owner, who is the person who
     maintains the list and will know whether it is a new code or a typo. */
  function materialIndex(rows) {
    const byCode = {}, all = [];
    (rows || []).forEach(m => {
      const code = upper(m.code);
      if (!code) return;
      const rec = { code, name: norm(m.desc || m.name), type: norm(m.type), vendor: norm(m.vendor) };
      byCode[code] = rec;
      all.push(rec);
    });
    return { byCode, all };
  }
  function findMaterial(index, code) {
    return (index && index.byCode) ? (index.byCode[upper(code)] || null) : null;
  }
  /* Best first: the code that starts with what was typed, then a code that
     contains it, then a name that does. Enough to pick from, not a search
     engine - the Material Codes tool is the search engine. */
  function suggest(index, q, limit) {
    const s = upper(q);
    if (!s || !index || !index.all) return [];
    const rank = m => {
      if (m.code.indexOf(s) === 0) return 0;
      if (m.code.indexOf(s) > -1) return 1;
      if (upper(m.name).indexOf(s) === 0) return 2;
      return 3;
    };
    return index.all
      .filter(m => m.code.indexOf(s) > -1 || upper(m.name).indexOf(s) > -1)
      .sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code))
      .slice(0, limit || 8);
  }

  /* --------------------------------------------------------- the scanner

     What a barcode reader hands back is rarely just the serial: some print a
     prefix, some wrap it in an AI-coded GS1 string, and a keyboard-wedge
     scanner sends a newline at the end. This is the one place that tidies it,
     so the camera, a hardware scanner and a typed serial all arrive the same
     way. */
  function cleanSerial(raw) {
    let v = norm(raw).replace(/[\r\n\t]+/g, ' ').trim();
    if (!v) return '';
    /* GS1 element strings: (21) is the serial. Only with the brackets - a
       plain serial that happens to start with 21 is not a GS1 string, and
       reading it as one eats the first two characters of a real number. */
    const gs1 = /\(21\)([A-Za-z0-9._-]{4,})/.exec(v);
    if (gs1) v = gs1[1];
    /* "SN:", "S/N -", "Serial No." and the rest of it. Something has to come
       between the word and the number - a colon, a dash, a space - or a
       serial that genuinely begins "SN" loses its first two characters. */
    v = v.replace(/^\s*(?:s\/?n|serial(?:\s*(?:no|number))?)\s*(?:[.:#=-]+\s*|\s+)/i, '');
    return upper(v).replace(/\s+/g, '');
  }

  const blankSerial = () => ({ sn: '', photo: null });
  const blankItem = side => ({
    from: side || 'airtel', code: '', name: '', qty: 1,
    dest: 'wh', remapSite: '', remapName: '',
    moves: [blankMove('team')],
    serials: [blankSerial()], note: ''
  });
  const blank = () => ({
    uid: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    id: null,
    airtelSite: '', airtelName: '', dialogSite: '', dialogName: '',
    removed: 'airtel',
    visitedOn: new Date().toISOString().slice(0, 10),
    team: '', note: '',
    items: [blankItem('airtel')],
    files: {}, saved: false, busy: null
  });

  /* A line nobody has started filling in is not a line: it is the empty one
     the form always keeps at the bottom. */
  const liveItems = rec => (rec && rec.items ? rec.items : [])
    .filter(i => norm(i.code) || norm(i.name) || liveSerials(i).length);
  const liveSerials = item => (item && item.serials ? item.serials : [])
    .filter(s => norm(s.sn) || s.photo || (s.file && s.file.blob));

  /* ------------------------------------------------------------- the rules

     What the warehouse cannot do without. Everything else is worth having and
     nothing else stops the record going in: a tower you were at with a list of
     what came off it is worth more filed than perfect. */
  function check(rec, opts) {
    const o = opts || {};
    const missing = [];
    const both = rec.removed === 'both';
    if (!norm(rec.airtelSite) && !norm(rec.dialogSite)) missing.push('at least one of the two site IDs');
    if (both && (!norm(rec.airtelSite) || !norm(rec.dialogSite))) missing.push('both site IDs');
    const items = liveItems(rec);
    if (!items.length) missing.push('at least one material');
    if (items.some(i => !norm(i.code))) missing.push('a material code on every line');
    if (items.some(i => !(Number(i.qty) > 0))) missing.push('a quantity on every line');
    if (items.some(i => i.dest === 'remap' && !norm(i.remapSite)))
      missing.push('the site a remapped material is going to');
    if (items.some(i => movesOf(i).some(m => m.to === 'site' && !norm(m.site))))
      missing.push('the site a material went onto');
    /* A serial photographed but not read, or read but not photographed, is
       half a record. Both, or neither - and neither is allowed: plenty of
       material has no serial on it at all. */
    items.forEach(i => {
      liveSerials(i).forEach(s => {
        if (norm(s.sn) && !(s.photo || (s.file && s.file.blob))) missing.push('a photo for serial ' + upper(s.sn));
      });
    });
    /* A code the material list has never heard of is a typo until the owner
       says otherwise - they are the one who keeps the list. */
    if (o.index && !o.owner) {
      const unknown = items.filter(i => norm(i.code) && !findMaterial(o.index, i.code))
        .map(i => upper(i.code));
      if (unknown.length) missing.push('a code off the material list instead of ' + unknown.join(', '));
    }
    return { ok: missing.length === 0, missing: [...new Set(missing)] };
  }
  function why(missing) {
    if (!missing.length) return '';
    if (missing.length === 1) return 'Still needs ' + missing[0] + '.';
    return 'Still needs ' + missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1] + '.';
  }

  /* Who may change a record that has already been filed. The team files from
     the field and fixes its own typos; the owner fixes anything. */
  function editableFor(rec, me, owner) {
    if (owner) return true;
    return !!me && (rec.createdBy === me);
  }

  /* Every picture the record points at, for a delete that leaves nothing
     behind in the bucket. */
  function pathsOf(rec) {
    const out = [];
    (rec && rec.items ? rec.items : []).forEach(i =>
      (i.serials || []).forEach(s => { if (s.photo) out.push(s.photo); }));
    return out;
  }

  /* ---------------------------------------------------------- the export

     One row per serial number, because that is the unit the warehouse counts
     in. A material with no serial is still one row - a quantity of cable does
     not have a serial and still has to be on the list. */
  const COLS = ['Swap', 'Airtel Site', 'Airtel Name', 'Dialog Site', 'Dialog Name',
                'Tower Removed', 'Removed From', 'Visited On', 'Team',
                'Material Code', 'Material Name', 'Qty', 'Serial No', 'SN Photo',
                'Destination', 'Remap Site', 'Remap Name',
                'Where It Is Now', 'Since', 'Movement',
                'Line Note', 'Record Note', 'Filed By', 'Filed At'];

  /* The task is the pair: both towers, named. Collecting is done a tower at
     a time, but the thing itself is one job and reads as one. */
  function swapTitle(r) {
    const one = (id, nm) => { id = upper(id); nm = norm(nm); return id ? (nm ? id + " " + nm : id) : ""; };
    const a = one(r.airtelSite || r.airtel_site, r.airtelName || r.airtel_name);
    const d = one(r.dialogSite || r.dialog_site, r.dialogName || r.dialog_name);
    return a && d ? a + " / " + d : (a || d || "");
  }
  function swapName(r) {
    const a = upper(r.airtelSite || r.airtel_site), d = upper(r.dialogSite || r.dialog_site);
    return a && d ? a + ' / ' + d : (a || d || '');
  }

  function toRows(records, links) {
    links = links || {};
    const out = [];
    (records || []).forEach(r => {
      const head = [
        swapName(r),
        upper(r.airtelSite || r.airtel_site), norm(r.airtelName || r.airtel_name),
        upper(r.dialogSite || r.dialog_site), norm(r.dialogName || r.dialog_name),
        removedLabel(r.removed || 'airtel')
      ];
      const tail = [norm(r.note), norm(r.createdName || r.created_name),
                    localStamp(r.savedAt || r.createdAt || r.created_at)];
      const items = liveItems(r);
      if (!items.length){
        out.push(head.concat(['', norm(r.visitedOn || r.visited_on), norm(r.team),
                              '', '', '', '', '', '', '', '', '', '', '', ''], tail));
        return;
      }
      items.forEach(i => {
        const mid = [sideLabel(i.from), norm(r.visitedOn || r.visited_on), norm(r.team),
                     upper(i.code), norm(i.name), Number(i.qty) || 0];
        const now = whereNow(i);
        const dest = [destLabel(i.dest), upper(i.remapSite), norm(i.remapName),
                      whereLabel(now), norm(now && now.on), chainText(r, i), norm(i.note)];
        const serials = liveSerials(i);
        if (!serials.length){
          out.push(head.concat(mid, ['', ''], dest, tail));
          return;
        }
        serials.forEach(s => {
          out.push(head.concat(mid, [upper(s.sn), links[s.photo] || s.photo || ''], dest, tail));
        });
      });
    });
    return out;
  }

  /* What the tool counts on its own summary line, and what the warehouse gets
     told at the top of the sheet. */
  function totals(records) {
    let lines = 0, serials = 0, remapped = 0, pieces = 0, waiting = 0;
    (records || []).forEach(r => liveItems(r).forEach(i => {
      lines++;
      pieces += Number(i.qty) || 0;
      serials += liveSerials(i).length;
      if (i.dest === 'remap') remapped++;
      /* what has not got anywhere yet - the answer to "so where is it?" */
      const to = (whereNow(i) || {}).to;
      if (to !== 'wh' && to !== 'site' && to !== 'scrapped') waiting++;
    }));
    return { records: (records || []).length, lines, pieces, serials, remapped, waiting };
  }

  const pad = n => String(n).padStart(2, '0');
  function localStamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* The row as the database keeps it, in the words the page uses. */
  function fromRow(row) {
    return {
      id: row.id,
      airtelSite: row.airtel_site || '', airtelName: row.airtel_name || '',
      dialogSite: row.dialog_site || '', dialogName: row.dialog_name || '',
      removed: row.removed || 'airtel',
      visitedOn: row.visited_on || '',
      team: row.team || '',
      items: Array.isArray(row.items) ? row.items : [],
      note: row.note || '',
      createdName: row.created_name || '',
      createdBy: row.created_by || '',
      createdAt: row.created_at || '',
      savedAt: row.updated_at || row.created_at || ''
    };
  }

  return {
    SIDES, REMOVED, DESTS, STEPS, sideLabel, removedLabel, destLabel,
    stepLabel, whereLabel, blankMove, movesOf, whereNow, timeline, chainText,
    norm, upper, siteKey,
    buildIndex, findSite,
    materialIndex, findMaterial, suggest,
    cleanSerial,
    blank, blankItem, blankSerial, liveItems, liveSerials,
    check, why, editableFor, pathsOf,
    COLS, swapName, swapTitle, toRows, totals, localStamp, fromRow
  };
});
