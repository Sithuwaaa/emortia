/* parser.js - the Dialog MBB design sheet, read.

   No DOM, no network, no globals it did not make: the spreadsheet library is
   handed in. That is what lets the same file run in the browser and under node
   against the real workbook, which parser.test.js does.

   ── The one thing to understand ──────────────────────────────────────────
   A radio is written into the sheet once for every technology it carries.
   One RRU5909 serving G900, L900 and L2100 in sector 1 fills three cells and
   is one box on the pole. Counting cells triples the site.

       sec 1   G900=RRU5910  L900=RRU5910  L2100=RRU5909   ->  2 radios
       sec 3   G900=Share sec 2 L9 RRU  ...  L2100=RRU5909 ->  1 radio

   So radios are counted once per distinct model per sector, and anything that
   says "Share sec N ..." is a run back to a radio already up the pole - real
   cabling, but not a box to order.
   ───────────────────────────────────────────────────────────────────────── */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.DesignParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* Which bands one physical radio can carry. Loaded off the page in the
     browser and required under node, so the tests reach it too.

     Not `root`: that is the outer wrapper's parameter and is not in scope in
     here, so it read as undefined, the browser fell through to the stub, and
     the first call to a function the stub did not have threw on every upload.
     Under node the require worked, so the tests passed and only the browser
     was broken. globalThis is the thing that is actually in scope.

     The stub is complete now for the same reason. A missing module should
     cost accuracy - every radio split per technology, which over-orders - not
     throw halfway through reading a workbook. */
  const G = typeof globalThis !== 'undefined' ? globalThis : this;
  const MAT = (G && G.Materials)
    || (typeof require === 'function' ? (function(){ try { return require('./materials.js'); } catch(e){ return null; } })() : null)
    || {
      baseModel:   m => String(m == null ? '' : m).trim(),
      bandLabel:   t => (t || []).join('+'),
      variantName: (m, t) => String(m == null ? '' : m).trim() + ((t && t.length) ? ' (' + t.join('+') + ')' : ''),
      boxesFor:    (m, t) => (t || []).map(x => [x]),
      sameBox:     (m, t) => (t || []).length <= 1,
      lookup:      () => null
    };

  const TECHS = ['G900','G1800','L850','L900','L1800','L2100','L2600','L2300(HBB)','L2300(MBB)'];
  const BANKS = [['lteMbb','AP_LTE_MBB'], ['lteHbb','AP_LTE_HBB']];

  const BLANK = new Set(['', '-', '–', 'n/a', '#n/a', 'na', 'null', 'none']);
  const SHARE = /^\s*shared?\b/i;
  const NOISE = /^(dap\s*wh|inhouse|in-house)\b/i;   // a source pasted into a model cell

  const norm    = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  const isBlank = v => v == null || BLANK.has(norm(v).toLowerCase());
  const val     = v => isBlank(v) ? null : (typeof v === 'number' ? v : norm(v));
  const num     = v => { const n = parseFloat(val(v)); return Number.isFinite(n) ? n : null; };
  const uniq    = a => a.filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);
  /* the sheet spells it both ways */
  const vendorOf = v => { const s = val(v); return s ? String(s).replace(/ericssion/ig, 'Ericsson') : s; };

  /* "Share sec 2 L9 RRU" → which sector it comes from, and for what.
     Also "Share Sec1/L18 Radio 4499" and "Shared Sec 01 RRU5501". */
  function readShare(text){
    const t = String(text || '');
    const sec  = /sec\w*\s*0?(\d)/i.exec(t);
    const band = /\b(L\d{2,4}|G\d{3,4}|L\d|B\d(?:\+B\d)?)\b/i.exec(t.replace(/sec\w*\s*\d+/ig, ''));
    return { from: sec ? +sec[1] : null, band: band ? band[1].toUpperCase() : null, text: t };
  }

  /* ------------------------------------------------------------- workbook */

  function pickSheet(wb){
    return wb.SheetNames.find(n => /design\s*sheet/i.test(n)) || wb.SheetNames[0];
  }

  /* The header is wherever "Site ID" and "Operation Region" sit on one row.
     Nothing is ever found by column position - the sheet gains and loses
     columns between batches, and it is 765 wide. */
  function findHeader(grid){
    for (let i = 0; i < Math.min(grid.length, 25); i++){
      const set = new Set((grid[i] || []).map(c => norm(c).toLowerCase()));
      if (set.has('site id') && set.has('operation region')) return i;
    }
    return -1;
  }

  /* Some headings appear twice. The first wins. */
  function indexHeaders(row){
    const idx = {};
    (row || []).forEach((h, i) => { const k = norm(h); if (k && !(k in idx)) idx[k] = i; });
    return idx;
  }

  /* TX plan lives on its own sheet and joins on Site ID, some of which carry a
     trailing full stop there and not on the design sheet. */
  function parseTx(wb, XLSX){
    const map = {};
    const n = wb.SheetNames.find(s => /^tx$/i.test(s));
    if (!n) return map;
    const g = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
    if (!g.length) return map;
    const idx = indexHeaders(g[0]);
    g.slice(1).forEach(r => {
      const id = norm(r[idx['Site ID']]).replace(/\.$/, '').toUpperCase();
      if (!id) return;
      map[id] = { txMode: val(r[idx['TX Mode']]), mwMapping: val(r[idx['MW Mapping']]), woId: val(r[idx['WO ID']]) };
    });
    return map;
  }

  function parseWorkbook(wb, XLSX){
    const sheetName = pickSheet(wb);
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
    const h = findHeader(grid);
    if (h < 0) throw new Error('No header row found - expected one row carrying both "Site ID" and "Operation Region".');
    const idx = indexHeaders(grid[h]);
    const rows = grid.slice(h + 1).filter(r =>
      r && !isBlank(r[idx['Site ID']]) && norm(r[idx['Site ID']]).toLowerCase() !== 'site id');
    return { sheetName, headerRow: h + 1, idx, rows, tx: parseTx(wb, XLSX) };
  }

  /* ------------------------------------------------------------- one site */

  function extractSite(ctx, row){
    const g  = k => { const i = ctx.idx[k]; return i === undefined ? null : val(row[i]); };
    const gn = k => { const i = ctx.idx[k]; return i === undefined ? null : num(row[i]); };

    const s = {
      siteId:    g('Site ID'), siteName: g('Site Name'),
      batchName: g('New AP Batch Name'), index: g('Index'),
      operationRegion: g('Operation Region'), apRegion: g('AP Region'), district: g('District'),
      ftkVendor: vendorOf(ctx.idx['FTK Vendor'] === undefined ? null : row[ctx.idx['FTK Vendor']]),
      ftkOrInhouse: g('FTK or In-House'), siteOwner: g('Site Owner'),
      siteType: g('Site Type'), siteHeight: gn('Site Height'),
      projectScope: g('AP_Project_Scope'),
      latitude: gn('Finalized Latitude'), longitude: gn('Finalized Longitude'),
      flags: []
    };

    const tx = ctx.tx[String(s.siteId).replace(/\.$/, '').toUpperCase()] || {};
    s.txMode = tx.txMode || null;
    s.mwMapping = tx.mwMapping || null;
    const band = /(\d{2})\s*G/.exec(s.mwMapping || '');
    s.mwBand = band ? band[1] + 'G' : null;

    /* some flags read "Yes " with a trailing space */
    s.technologies = TECHS.filter(t => /^y/i.test(g('AP_Upgrade_Flag_' + t) || ''));

    /* ---- sector by sector ---- */
    s.sectors = [];
    for (let n = 1; n <= 4; n++){
      const sec = {
        sector: n,
        changeScope:       g('AP_Sector_Antenna/AAU_Change Scope Sec ' + n),
        antennaType:       g('AP_Sector_Antenna_Final Types Sec ' + n) || g('AP_Sector_Antenna_Addition Type Sec ' + n),
        antennaCount:      gn('AP_Sector_Antenna_Final Count Sec ' + n),
        antennaAddType:    g('AP_Sector_Antenna_Addition Type Sec ' + n),
        antennaAddCount:   gn('AP_Sector_Antenna_Addition Count Sec ' + n),
        antennaTechs:      g('AP_Sector_Antenna_Final Technologies Sec ' + n),
        combinerType:      g('AP_Sector_Antenna_Combiner Addition Type Sec ' + n),
        combinerCount:     gn('AP_Sector_Antenna_Combiner Addition Count Sec ' + n),
        azimuth:           gn('AP_Sector_Antenna_Final Azimuth Sec ' + n),
        height:            gn('AP_Sector_Antenna_Final Height Sec ' + n),
        eTilt:             gn('AP_Sector_Antenna_Final E-Tilt Sec ' + n),
        mTilt:             gn('AP_Sector_Antenna_Final M-Tilt Sec ' + n),
        netAnt:            gn('AP_Sector_Antenna_Net Addition Ant Sec ' + n) || 0,
        netRru:            gn('AP_Sector_Antenna_Net Addition RRU Sec ' + n) || 0,
        cells: []
      };
      /* The Final column first, the addition column behind it.

         Final is what the sector ends up carrying once the additions and the
         removals have both happened, which is the thing worth recording - and
         it is written with the band on it, RRU5909/GL rather than a bare
         RRU5909. But it is only filled in for some bands: in the 2026 MBB book
         it is there for G900 and G1800 and empty everywhere else, and in the
         2025 HBB book it is empty throughout. So it is preferred where it
         exists and the addition stands in where it does not, rather than
         switching to it wholesale and losing seventeen hundred entries. */
      TECHS.forEach(t => {
        const fin = g('AP_' + t + '_Final Radio configuration Sec ' + n);
        const add = g('AP_' + t + '_Radio addition Sec ' + n);
        const m = fin || add;
        if (!m) return;
        sec.cells.push({ tech: t, model: m,
          fromFinal: !!fin,
          isNew: !!add,                    // only an addition is material to order
          removed: g('AP_' + t + '_Radio removal Sec ' + n),
          shared: SHARE.test(m), noise: NOISE.test(m),
          source: g('AP_' + t + '_Radio addition source Sec ' + n) });
      });
      if (sec.antennaCount == null) sec.antennaCount = sec.antennaAddCount;
      sec.active = !!(sec.antennaType || sec.cells.length || sec.azimuth != null);
      s.sectors.push(sec);
    }
    s.sectorCount = s.sectors.filter(x => x.active).length;

    /* ---- radios: one box per distinct model per sector ---- */
    const rru = {}, shared = [];
    s.sectors.forEach(sec => {
      const box = new Map();                   // model -> the technologies it carries here
      sec.cells.forEach(c => {
        if (c.noise) return;
        if (c.shared){
          /* One run of feeder is written once per technology it carries, the
             same as a radio is. "Share sec 2 L9 RRU" under G900 and again under
             L900 is one cable, so it is recorded once with both technologies
             against it. */
          const found = shared.find(x => x.sector === sec.sector && x.text === c.model);
          if (found) found.techs.push(c.tech);
          else shared.push(Object.assign({ sector: sec.sector, techs: [c.tech] }, readShare(c.model)));
          return;
        }
        /* Keyed on the part, not on how the cell happened to spell it. The
           Final column writes Radio 2271/GL and the addition column writes
           Radio 2271, and preferring Final per technology means one radio
           arrives under both spellings - which counted it twice, 278 of one
           and 278 of the other, for 278 actual radios.

           The qualified spelling is kept for display, because /GL and
           \LO_L23 are the part of the name that says which variant it is. */
        const key = MAT.baseModel(c.model) || c.model;
        if (!box.has(key)) box.set(key, { label: c.model, techs: [], qual: null, qualFor: null });
        const b = box.get(key);
        b.techs.push(c.tech);
        /* The qualified spelling and the technology it was written against.
           RRU5909/GL came off the G900 Final cell and describes the 900 unit;
           the L2100 unit on the same sector is a different radio and must not
           inherit that name. */
        if (c.fromFinal && /[\/\\]/.test(c.model) && !b.qual){
          b.qual = c.model; b.qualFor = c.tech;
        }
      });
      /* One box per model was wrong, and wrong in a way that ordered too few.
         RRU5909 is written under G900, L900 and L2100 in the same book, and
         the L21 unit is not the same radio as the GL900 one - you cannot take
         one to a site and use it for the other. Merging them by name ordered
         one radio where two were needed.

         Splitting by technology instead would be wrong the other way: RRU 4490
         B1+B3 sits under L1800 and L2100 and is genuinely one box doing both,
         which is what the part number says.

         So the materials table decides, model by model, which technologies a
         single unit can carry at once. Anything it has never heard of is split
         per technology - one spare costs less than a second trip. */
      sec.radios = [];
      box.forEach((b, key) => {
        MAT.boxesFor(key, b.techs).forEach(group => {
          /* One name for one part, carrying the band the box actually serves -
             RRU5909 (GL900) and RRU5909 (L2100) are two lines because they are
             two radios. This is the name the BOM matches on, so the two tools
             have to agree; how the sheet happened to spell it is kept beside
             it for anyone reading the extract. */
          sec.radios.push({
            model: MAT.variantName(key, group),
            part:  key,
            band:  MAT.bandLabel(group),
            asWritten: b.qual || b.label,
            techs: group
          });
        });
      });
      sec.rruModels = sec.radios.map(r => r.model);
      sec.radios.forEach(r => {
        if (!rru[r.model]) rru[r.model] = { count: 0, sectors: [], techs: [] };
        rru[r.model].count++;
        rru[r.model].sectors.push(sec.sector);
        rru[r.model].techs = uniq(rru[r.model].techs.concat(r.techs));
      });
    });
    s.radios = rru;
    s.rruByModel = Object.fromEntries(Object.entries(rru).map(([m, v]) => [m, v.count]));
    s.rruCount = Object.values(rru).reduce((a, v) => a + v.count, 0);
    s.sharedRuns = shared;

    /* ---- antennas ---- */
    const ant = {};
    s.sectors.forEach(sec => {
      const t = sec.antennaType;
      if (!t) return;
      if (/^\d+(\.\d+)?$/.test(String(t).trim())){
        s.flags.push('Sector ' + sec.sector + ' antenna type is just "' + t + '"');
        return;
      }
      const model = String(t).replace(/\(.*?\)/g, '').trim();
      const c = sec.antennaCount == null ? 1 : sec.antennaCount;
      if (!ant[model]) ant[model] = { count: 0, sectors: [] };
      ant[model].count += c;
      ant[model].sectors.push(sec.sector);
    });
    s.antennas = ant;
    s.antennaByModel = Object.fromEntries(Object.entries(ant).map(([m, v]) => [m, v.count]));
    s.antennaCount = Object.values(ant).reduce((a, v) => a + v.count, 0);

    s.combiners = {};
    s.sectors.forEach(sec => { if (sec.combinerType)
      s.combiners[sec.combinerType] = (s.combiners[sec.combinerType] || 0) + (sec.combinerCount || 1); });

    /* ---- BBU, control card, baseband ---- */
    const bank = pre => {
      const cards = kind => {
        const out = [];
        for (let i = 1; i <= 6; i++){
          /* the first slot's heading carries a newline before "(slot 0)", which
             normalises to a space the others do not have */
          const v = g(pre + '_Baseband ' + kind + ' ' + i + ' (slot ' + (i - 1) + ')')
                 || g(pre + '_Baseband ' + kind + ' ' + i + '(slot ' + (i - 1) + ')');
          if (v) out.push({ slot: i - 1, card: v });
        }
        return out;
      };
      return {
        bbuExisting: g(pre + '_BBU Existing'),
        bbuAddition: g(pre + '_BBU Addition'),
        bbuFinal:    g(pre + '_BBU Final'),
        controlCard: g(pre + '_Control Board Card Addition Card Type'),
        controlCardFinal: g(pre + '_Control Board Card Final Card Type'),
        basebandCount: gn(pre + '_Baseband Addition Amount'),
        baseband:      cards('Addition'),
        basebandFinal: cards('Final')
      };
    };
    BANKS.forEach(([key, pre]) => { s[key] = bank(pre); });
    s.g2 = {
      bbuExisting: g('AP_2G_BBU Existing'),
      bbuAddition: g('AP_2G_BBU Addition'),
      bbuFinal:    g('AP_2G_BBU Final'),
      baseband:      g('AP_2G_Baseband card addition'),
      basebandFinal: g('AP_2G_Final Baseband configuration')
    };

    s.bbuAddition   = uniq([s.lteMbb.bbuAddition, s.lteHbb.bbuAddition, s.g2.bbuAddition]);
    s.controlCards  = uniq([s.lteMbb.controlCard, s.lteHbb.controlCard]);
    s.basebandCards = uniq([...s.lteMbb.baseband, ...s.lteHbb.baseband].map(c => c.card).concat([s.g2.baseband]));

    /* ---- what the sheet's own summary claims ----
       Stale on most sites, so never used - only compared, and a disagreement
       becomes something for a person to settle. */
    const netRru = s.sectors.reduce((a, x) => a + (x.netRru || 0), 0);
    const netAnt = s.sectors.reduce((a, x) => a + (x.netAnt || 0), 0);
    s.netRruTotal = netRru; s.netAntTotal = netAnt;
    if (netRru && netRru !== s.rruCount) s.flags.push('RRU ' + s.rruCount + ' here vs ' + netRru + ' in the sheet’s own total');
    if (netAnt && netAnt !== s.antennaCount) s.flags.push('Antenna ' + s.antennaCount + ' here vs ' + netAnt + ' in the sheet’s own total');
    if (!s.sectorCount) s.flags.push('no active sector');
    if (!s.txMode) s.flags.push('no row on the TX sheet');
    s.sectors.forEach(x => { if (x.active && x.azimuth == null) s.flags.push('Sector ' + x.sector + ' has no azimuth'); });
    s.sharedRuns.forEach(sh => { if (sh.from == null) s.flags.push('shared run does not say which sector: "' + sh.text + '"'); });

    return s;
  }

  function extract(wb, XLSX){
    const ctx = parseWorkbook(wb, XLSX);
    return { ctx, sites: ctx.rows.map(r => extractSite(ctx, r)) };
  }

  /* ---------------------------------------------------- the radio register

     Which technologies each radio carries, learned from the batch itself: a
     model's capability is simply the set of columns it was ever written under.
     This is the table to own and correct by hand - it is what turns "three
     cells" into "one box", and next batch will bring models nobody has seen. */
  function buildRegister(sites){
    const reg = {};
    sites.forEach(s => s.sectors.forEach(sec => sec.cells.forEach(c => {
      if (c.shared || c.noise) return;
      const r = reg[c.model] = reg[c.model] || { model: c.model, serves: [], seen: 0, vendors: [] };
      r.seen++;
      if (!r.serves.includes(c.tech)) r.serves.push(c.tech);
      if (s.ftkVendor && !r.vendors.includes(s.ftkVendor)) r.vendors.push(s.ftkVendor);
    })));
    Object.values(reg).forEach(r => {
      r.serves.sort((a, b) => TECHS.indexOf(a) - TECHS.indexOf(b));
      r.label = r.serves.join(' + ');
      r.source = 'sheet';
    });
    return reg;
  }

  /* A site said the way it gets said out loud. */
  function summarise(s){
    return {
      siteId: s.siteId, siteName: s.siteName, vendor: s.ftkVendor, heightM: s.siteHeight,
      batch: s.batchName, txMode: s.txMode, mwBand: s.mwBand,
      sectors: s.sectorCount, rrus: s.rruCount, antennas: s.antennaCount,
      technologies: s.technologies.slice(),
      radios: Object.entries(s.radios).map(([model, v]) =>
        ({ model, count: v.count, serves: v.techs.join(' + '), sectors: v.sectors.slice() })),
      shared: s.sharedRuns.map(x => ({ sector: x.sector, from: x.from, band: x.band, techs: (x.techs||[]).slice(), text: x.text })),
      antennaList: Object.entries(s.antennas).map(([model, v]) => ({ model, count: v.count, sectors: v.sectors.slice() })),
      bbu: s.bbuAddition.slice(), control: s.controlCards.slice(), baseband: s.basebandCards.slice(),
      flags: s.flags.slice()
    };
  }

  function envelope(sites, ctx, register){
    return {
      schema: 'emortia.design-extract/2',
      generatedAt: new Date().toISOString(),
      source: ctx ? { sheet: ctx.sheetName, headerRow: ctx.headerRow } : null,
      register: register || null,
      sites: sites
    };
  }

  return { TECHS, extract, parseWorkbook, extractSite, buildRegister, summarise, envelope,
           _internals: { norm, isBlank, val, num, findHeader, indexHeaders, readShare, vendorOf } };
});
