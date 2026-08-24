/* materials.js - what each radio actually is, and which bands one box can carry.

   Why this file exists
   --------------------
   A model number is not a part. RRU5909 appears in the 2026 MBB design under
   three technology blocks - G900, L900 and L2100 - and the one under L2100 is
   not the same radio as the one under G900. You cannot take a GL900 5909 to a
   site and use it for L21. Counting by model name alone merges them into one
   box and orders too few.

   The opposite mistake is just as real. RRU 4490 B1+B3 appears under L1800 and
   L2100, and that is one radio doing both, because B1 is 2100 and B3 is 1800.
   Splitting it by technology orders two where one is needed.

   So each model records the band groups a single unit can carry at once.
   Technologies inside one group share a box; technologies in different groups
   need separate boxes.

   Where this comes from
   ---------------------
   Three sources, in order of trust:

     1. The design sheet itself. The technology block a radio is written under
        is the band it is being used for, per site, and it is the only source
        that is right for that site on that day. Every entry below was seen in
        a real book - the counts are in the notes.
     2. The part name. "RRU 4490 B1+B3" and "Radio 4499/DCS_L18_L12" say what
        they are, and the Final columns carry the same qualifiers - RRU5909/GL,
        Radio 2271/GL.
     3. Vendor documentation. Least useful here, because Huawei reuses a base
        number across band variants: searching RRU5909 returns 1800MHz on one
        page and 900MHz on another, which is the very ambiguity this file
        exists to settle.

   Anything not listed is treated as single-band and split per technology,
   which is the safe way round: it orders one too many rather than one too few,
   and a spare is cheaper than a second trip to the site.

   Confirmed by Sithara. Corrections here are the whole point of the file -
   add a model, change its groups, and the counting follows. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.Materials = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* The bands, as the design sheet's technology blocks name them. A group is
     the set of technologies one physical unit can serve at the same time. */
  const RADIOS = [
    {
      model: 'RRU5909',
      groups: [['G900', 'L900'], ['L1800'], ['L2100']],
      note: 'Seen under G900 (248), L900 (249) and L2100 (428) in 2026 MBB. ' +
            'The 900 variant carries GSM and LTE together - the Final column ' +
            'writes it RRU5909/GL. The L21 unit is a different radio and ' +
            'cannot be swapped for it.'
    },
    {
      model: 'Radio 2271',
      groups: [['G900', 'L900']],
      note: '900 only. Seen under G900 (278) and L900 (278), always as a pair ' +
            'on the same sector, and Final writes it Radio 2271/GL.'
    },
    {
      model: 'RRU 4490 B1+B3',
      groups: [['L1800', 'L2100']],
      note: 'One radio for both. B1 is 2100 and B3 is 1800, which the part ' +
            'name states outright. Seen under L2100 (182) and L1800 (167).'
    },
    {
      model: 'RRU5910',
      groups: [['G900', 'L900']],
      note: 'Seen under G900 (107) and L900 (107); Final writes RRU5910/GL.'
    },
    {
      model: 'Radio 4415',
      groups: [['G1800', 'L1800']],
      note: 'Seen under G1800 (21) and L1800 (21). Final writes Radio 4415/GL.'
    },
    {
      model: 'Radio 4499',
      groups: [['G1800', 'L1800', 'L2100']],
      note: 'Final writes it Radio 4499/DCS_L18_L12, so DCS plus L18 plus L12 ' +
            'off one box. Only 5 in the 2026 MBB book - worth confirming ' +
            'before it is trusted on a big order.'
    },
    {
      model: 'RRU5818',
      groups: [['L2300(HBB)', 'L2300(MBB)']],
      note: '2300 only. The HBB book writes it RRU5818\\LO_L23 (142).'
    },
    { model: 'RRU3251', groups: [['L2300(HBB)', 'L2300(MBB)']], note: 'HBB, written RRU3251\\LO_L23 (65).' },
    { model: 'RRU3276', groups: [['L2300(HBB)', 'L2300(MBB)']], note: 'HBB, written RRU3276\\LO_L23 (12).' },
    { model: 'RRU3256', groups: [['L2300(HBB)', 'L2300(MBB)']], note: 'HBB, written RRU3256\\LO_L23 (4).' },
    { model: 'RRU5258', groups: [['L2600']], note: 'Seen under L2600 only (4).' },
    { model: 'RRU5501', groups: [['G1800', 'L1800']], note: 'Seen under G1800 (4) and L1800 as DCS RRU5501 (2).' }
  ];

  /* A model is written a dozen ways across the two books - with a band
     suffix, with a slash, with a backslash, with DCS in front. This strips
     it back to the part so it can be looked up. */
  function baseModel(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    s = s.replace(/^(?:dcs|share[d]?\s+sec\w*\s*\d*)\s+/i, '');   // leading qualifiers
    s = s.split(/[\/\\]/)[0];                                      // RRU5909/GL, RRU5818\LO_L23
    return s.replace(/\s+/g, ' ').trim();
  }

  const byModel = {};
  RADIOS.forEach(r => { byModel[r.model.toLowerCase()] = r; });

  function lookup(raw) {
    const b = baseModel(raw);
    if (!b) return null;
    const hit = byModel[b.toLowerCase()];
    if (hit) return hit;
    /* "RRU5909 B3" and the like: fall back to the longest known model that
       the text starts with, so a variant suffix does not lose the entry */
    let best = null;
    RADIOS.forEach(r => {
      if (b.toLowerCase().indexOf(r.model.toLowerCase()) === 0 &&
          (!best || r.model.length > best.model.length)) best = r;
    });
    return best;
  }

  /* The question the counting actually asks: can one box carry all of these
     technologies at once? Unknown models answer no unless it is a single
     technology, which is the cautious way round. */
  function sameBox(raw, techs) {
    const list = (techs || []).filter(Boolean);
    if (list.length <= 1) return true;
    const m = lookup(raw);
    if (!m) return false;
    return m.groups.some(g => list.every(t => g.indexOf(t) > -1));
  }

  /* Split the technologies a model carries in one sector into the smallest
     number of boxes that can actually carry them. */
  function boxesFor(raw, techs) {
    const list = (techs || []).filter(Boolean);
    if (!list.length) return [];
    const m = lookup(raw);
    if (!m) return list.map(t => [t]);            // unknown: one box each
    const out = [];
    const left = list.slice();
    m.groups.forEach(g => {
      /* In the table's order, not the order the sheet happened to list them.
         The same sector read twice has to produce the same answer both times,
         or comparing two versions of a design shows changes that are not
         there. */
      const take = g.filter(t => left.indexOf(t) > -1);
      if (take.length){
        out.push(take);
        take.forEach(t => left.splice(left.indexOf(t), 1));
      }
    });
    left.forEach(t => out.push([t]));             // anything the table did not cover
    return out;
  }

  /* ------------------------------------------------------- naming a variant

     The design sheet writes the same radio five ways - RRU5909, RRU5909/GL,
     RRU 5909(L21), DCS RRU5501, RRU5818\LO_L23 - and the BOM catalogue writes
     it a sixth. Both tools need one name for one part, or the design says
     RRU5909 and the BOM cannot tell which of the three it means.

     So a radio is named by its part and the band that box actually carries:
     RRU5909 (GL900) and RRU5909 (L2100) are two lines, which is what they
     are. This is the name the design hands to the BOM. */
  const BAND_LABEL = [
    { techs: ['G900', 'L900'],     label: 'GL900'   },
    { techs: ['G1800', 'L1800'],   label: 'GL1800'  },
    { techs: ['L1800', 'L2100'],   label: 'L1800+L2100' },
    { techs: ['G1800', 'L1800', 'L2100'], label: 'DCS+L18+L21' }
  ];

  function bandLabel(techs) {
    const list = (techs || []).filter(Boolean);
    if (!list.length) return '';
    const hit = BAND_LABEL.find(b =>
      b.techs.length === list.length && b.techs.every(t => list.indexOf(t) > -1));
    if (hit) return hit.label;
    /* L2300(HBB) and L2300(MBB) are the same band written for two scopes */
    return list.map(t => t.replace(/\((?:HBB|MBB)\)/, '')).join('+');
  }

  const variantName = (model, techs) => {
    const base = baseModel(model) || String(model || '').trim();
    const band = bandLabel(techs);
    return band ? base + ' (' + band + ')' : base;
  };

  const known = () => RADIOS.map(r => r.model);

  return { RADIOS, baseModel, lookup, sameBox, boxesFor, bandLabel, variantName, known };
});
