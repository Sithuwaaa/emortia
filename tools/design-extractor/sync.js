/* sync.js - working out what actually changed between two uploads.

   A vendor sends the same design book back with one site's azimuth altered
   and everything else identical. Writing all 245 sites would be honest but
   useless: every site would show as touched today, and the one that moved
   would be invisible. So each site is fingerprinted, the new book is compared
   against what the server already holds, and only the sites that genuinely
   differ are written.

   Two scopes live side by side. The 2026 MBB new-sites book and the 2025 HBB
   upgrade book describe different work on overlapping sites, so a site is
   keyed by scope and ID together - the same site ID can hold one row for each
   and neither overwrites the other.

   No network in this file. What to write is arithmetic and worth testing; the
   writing is in db.js. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.DesignSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Which book this is. The name says it plainly enough on both files the
     vendor sends, and the content is the fallback when it does not: the HBB
     book is all L2300 and the MBB book has G900 in it. */
  function scopeOf(fileName, sites) {
    const n = String(fileName || '').toUpperCase();
    /* Not \b. Every one of these files is named 2026_MBB_New Sites, and an
       underscore is a word character - so \bMBB\b never matches between two
       of them and every book came back OTHER. The separator here is anything
       that is not a letter. */
    if (/(?:^|[^A-Z])HBB(?:[^A-Z]|$)/.test(n)) return 'HBB';
    if (/(?:^|[^A-Z])MBB(?:[^A-Z]|$)/.test(n)) return 'MBB';
    const list = sites || [];
    let hbb = 0, mbb = 0;
    list.forEach(s => {
      const t = (s.technologies || []).join(' ');
      if (/L2300\(HBB\)/.test(t)) hbb++;
      if (/G900|G1800/.test(t)) mbb++;
    });
    if (hbb && !mbb) return 'HBB';
    if (mbb && !hbb) return 'MBB';
    return 'OTHER';
  }

  /* Which project a site belongs to.

     This tool is not only for the lamp pole work - every design book comes
     through it - so a site has to say which project it is part of rather than
     that being assumed from whichever book was open.

     The 2026 MBB book carries it per row in "New AP Batch Name", and one file
     holds nineteen different batches, so the file name is not the answer. The
     2025 HBB book has no such column, and there the programme stands in. */
  function projectOf(site, fileName, sites) {
    const b = site && (site.batchName || site.batch);
    const named = String(b == null ? '' : b).trim();
    if (named && named !== '-') return named;
    return programmeName(fileName, sites);
  }

  /* A readable name for the book as a whole, for sites that do not name their
     own batch. The file name without its extension is what people call it. */
  function programmeName(fileName, sites) {
    const raw = String(fileName || '').replace(/\.[a-z0-9]+$/i, '').trim();
    if (raw && !/^from the server/i.test(raw)) return raw;
    return scopeOf(fileName, sites);
  }

  /* Every distinct project in a set of sites, with how many sites each holds -
     what the tool needs to show and filter by. */
  function projectsIn(sites, fileName) {
    const out = {};
    (sites || []).forEach(s => {
      const p = projectOf(s, fileName, sites);
      out[p] = (out[p] || 0) + 1;
    });
    return Object.entries(out).sort((a, b) => b[1] - a[1])
      .map(([project, count]) => ({ project, count }));
  }

  /* A fingerprint has to be the same for the same site read twice and
     different the moment anything about it moves. JSON key order is not
     guaranteed, so the keys are walked in sorted order - without that, two
     identical reads can hash differently and every site looks changed. */
  function stable(v) {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (typeof v === 'object') {
      const keys = Object.keys(v).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  /* FNV-1a, 32 bits, written as hex. Not a security hash and does not need to
     be: it only has to notice a changed azimuth, and a collision costs one
     site not being re-uploaded. */
  function fingerprint(site) {
    const s = stable(strip(site));
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  /* Fields that say when a thing was read rather than what it says. Leaving
     them in makes every site differ on every upload, which defeats the whole
     exercise. */
  const IGNORE = new Set(['savedAt', 'readAt', 'uploadedAt', 'updatedAt', 'batch', 'source', 'row']);
  function strip(site) {
    if (!site || typeof site !== 'object') return site;
    const out = {};
    Object.keys(site).forEach(k => { if (!IGNORE.has(k)) out[k] = site[k]; });
    /* The ID is normalised here as well as in the key. " mu5051 " and
       "MU5051" are one site, and hashing them apart would file the same site
       twice and report a change every time the spacing moved. */
    if (out.siteId != null) out.siteId = String(out.siteId).trim().toUpperCase();
    if (out.site_id != null) out.site_id = String(out.site_id).trim().toUpperCase();
    return out;
  }

  const idOf = s => String((s && (s.siteId || s.site_id)) || '').trim().toUpperCase();

  /* How much a row actually says. Used only to pick between two rows for the
     same site in the same book - the one that names a region and carries
     antennas beats the one that is an ID and nothing else.

     Counted rather than judged: an active sector is worth more than a filled
     text field, because a row with sectors is the row somebody has to work
     from. */
  function substance(site) {
    if (!site || typeof site !== 'object') return 0;
    let n = 0;
    Object.keys(site).forEach(k => {
      if (IGNORE.has(k) || k === 'flags') return;
      const v = site[k];
      if (v == null || v === '' ) return;
      if (Array.isArray(v)) { n += v.length ? 1 : 0; return; }
      if (typeof v === 'object') { n += Object.keys(v).length ? 1 : 0; return; }
      n += 1;
    });
    n += ((site.sectors || []).filter(x => x && x.active).length) * 3;
    n += (site.rruCount || 0) > 0 ? 2 : 0;
    n += (site.antennaCount || 0) > 0 ? 2 : 0;
    return n;
  }

  /* What to write, and what to leave alone.

     `have` is {siteId: fingerprint} as the server has it. Sites missing from
     the new book are NOT deleted - a batch file covers the sites in that
     batch, and the ones it does not mention are simply not part of it. A
     vendor sending batch 5 must not wipe batches 1 to 4. */
  function plan(sites, have, opts) {
    const known = have || {};
    const added = [], changed = [], same = [];
    const seen = new Set();

    /* The same site can appear twice in one book. In the 2025 HBB upgrade
       book 32 of them do: one row carrying the antennas, the region and the
       vendor, and a second that is empty apart from the ID and flagged "no
       active sector". Keeping whichever came first was a coin toss - half the
       time the blank row won and the site arrived on the server with nothing
       in it. The fuller row wins now, whichever order they are in. */
    const best = new Map();
    (sites || []).forEach(s => {
      const id = idOf(s);
      if (!id) return;
      const prev = best.get(id);
      if (!prev || substance(s) > substance(prev)) best.set(id, s);
    });

    best.forEach((s, id) => {
      seen.add(id);
      const fp = fingerprint(s);
      const was = known[id];
      const rec = { siteId: id, fingerprint: fp, site: s,
                    project: projectOf(s, opts && opts.file, sites) };
      if (was == null) added.push(rec);
      else if (was !== fp) changed.push(rec);
      else same.push(rec);
    });

    return {
      added, changed, same,
      write: added.concat(changed),
      counts: { added: added.length, changed: changed.length,
                unchanged: same.length, total: seen.size },
      untouched: Object.keys(known).filter(id => !seen.has(id))
    };
  }

  /* A sentence for the person who just dropped the file in. */
  function summarise(p, scope) {
    const c = p.counts;
    const bits = [];
    if (c.added)     bits.push(c.added + (c.added === 1 ? ' new site' : ' new sites'));
    if (c.changed)   bits.push(c.changed + ' changed');
    if (c.unchanged) bits.push(c.unchanged + ' unchanged');
    const head = scope ? scope + ' · ' : '';
    if (!bits.length) return head + 'nothing to save.';
    if (!c.added && !c.changed)
      return head + 'nothing has moved - all ' + c.unchanged + ' sites are as they were.';
    return head + bits.join(', ') + '.';
  }

  /* Which fields differ between the stored site and the new one, so the tool
     can say what moved rather than only that something did. */
  function fieldsChanged(before, after) {
    const a = strip(before) || {}, b = strip(after) || {};
    const keys = [...new Set(Object.keys(a).concat(Object.keys(b)))].sort();
    return keys.filter(k => stable(a[k]) !== stable(b[k]));
  }

  return { scopeOf, projectOf, programmeName, projectsIn,
           fingerprint, stable, plan, summarise, fieldsChanged, substance, idOf, IGNORE };
});
