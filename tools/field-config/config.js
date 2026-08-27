/* config.js - the arithmetic behind the field reference.

   The document is vendors, each with groups, each with sections. A section
   carries any of six kinds of thing: notes, key/values, chips, numbered
   steps, commands, and links to documents. This file decides what is on
   screen and what a search matches; the page in index.html draws it and
   db.js fetches it.

   Nothing of the reference itself is in this repository. It holds the UMPT
   passwords, the LMT logins and the Wi-Bas credentials, and everything
   committed here is served publicly at emortia.com - see the note at the top
   of supabase/013_field_config.sql. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.ConfigCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* The six kinds a section can hold, in the order they read on the page:
     what this is, the settings, the values to grab, what to do, what to type,
     and what to go and read. */
  const KINDS = ['notes', 'kvs', 'chips', 'steps', 'cmds', 'docs', 'images'];

  const str = v => String(v == null ? '' : v).trim();
  const arr = v => Array.isArray(v) ? v : [];

  /* ------------------------------------------------------------ counting */

  function countSection(s) {
    return KINDS.reduce((n, k) => n + arr(s && s[k]).length, 0);
  }
  function countGroup(g) {
    return arr(g && g.sections).reduce((n, s) => n + countSection(s), 0);
  }
  function countVendor(v) {
    return arr(v && v.groups).reduce((n, g) => n + countGroup(g), 0);
  }
  function totals(doc) {
    const d = arr(doc);
    return {
      vendors: d.length,
      groups: d.reduce((n, v) => n + arr(v.groups).length, 0),
      entries: d.reduce((n, v) => n + countVendor(v), 0)
    };
  }

  /* ------------------------------------------------------------ searching

     Everything a row says, flattened to one string. A command is found by its
     label as readily as by the command itself - "serial number" has to reach
     DSP BRDMFRINFO, because that is the way somebody in a cabinet remembers
     it. */
  function textOf(x) {
    if (x == null) return '';
    if (typeof x === 'string') return x.toLowerCase();
    return ['label', 'cmd', 'note', 'k', 'v', 't', 'n', 'name', 'kind', 'cap']
      .map(f => x[f]).filter(Boolean).join(' ').toLowerCase();
  }

  /* Every word has to land somewhere in the row, not the whole phrase in one
     field: "huawei vlan" finds the VLAN table under Huawei, which neither
     word alone narrows down. */
  function hit(hay, q) {
    const words = str(q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const h = String(hay).toLowerCase();
    return words.every(w => h.indexOf(w) > -1);
  }

  /* A section matches wholesale when its own title matches - asking for
     "passwords" should hand over the whole password list rather than picking
     out the one chip that happens to contain the word. */
  function filterSection(s, q, context) {
    if (!s) return null;
    const whole = hit(str(s.title) + ' ' + str(s.kicker) + ' ' + str(context), q);
    const out = { title: str(s.title), kicker: str(s.kicker) };
    KINDS.forEach(k => {
      const list = arr(s[k]);
      out[k] = (!q || whole) ? list.slice() : list.filter(x => hit(textOf(x), q));
    });
    /* notes describe the things around them; on their own they are not a hit */
    return KINDS.some(k => k !== 'notes' && out[k].length) ? out : null;
  }

  /* Without a search you get the group you picked. With one you get every
     section that matches, from every vendor - the thing you half remember is
     usually filed under a vendor you were not looking at. */
  function view(doc, vendorId, groupId, q) {
    const d = arr(doc);
    if (!d.length) return { vendors: [], groups: [], sections: [], scope: 'empty' };

    const vendor = d.filter(v => v.id === vendorId)[0] || d[0];
    const groups = arr(vendor.groups);
    const group = groups.filter(g => g.id === groupId)[0] || groups[0];
    const query = str(q);

    let sections = [];
    if (query) {
      d.forEach(v => arr(v.groups).forEach(g => arr(g.sections).forEach(s => {
        const f = filterSection(s, query.toLowerCase(), v.name + ' ' + g.name);
        if (f) { f.where = v.name + ' · ' + g.name; sections.push(f); }
      })));
    } else if (group) {
      sections = arr(group.sections).map(s => filterSection(s, '', '')).filter(Boolean);
    }

    return {
      vendors: d.map(v => ({ id: v.id, name: v.name, sub: v.sub || '',
                             on: v.id === vendor.id, entries: countVendor(v) })),
      groups: groups.map(g => ({ id: g.id, name: g.name,
                                 on: !!group && g.id === group.id, entries: countGroup(g) })),
      sections,
      vendorName: vendor.name,
      groupName: group ? group.name : '',
      scope: query ? 'search' : 'group'
    };
  }

  /* ------------------------------------------------------------- copying

     A command copies as the command, never with its label attached: it is
     going straight into an LMT window and anything extra is a syntax error.
     A key/value copies the value alone for the same reason. */
  const copyOf = {
    kvs:   x => str(x.v),
    chips: x => typeof x === 'string' ? str(x) : str(x.v),
    cmds:  x => str(x.cmd),
    steps: x => str(x.t),
    docs:  x => str(x.href)
  };
  function copyText(kind, x) {
    const f = copyOf[kind];
    return f ? f(x) : '';
  }

  /* A whole section as text, for taking an upgrade sequence into a note. The
     commands keep their numbers because the order is the point. */
  function sectionText(s) {
    const lines = [];
    arr(s.kvs).forEach(kv => lines.push(str(kv.k) + '\t' + str(kv.v)));
    arr(s.chips).forEach(c => lines.push(typeof c === 'string' ? str(c) : str(c.v)));
    arr(s.steps).forEach(st => lines.push(str(st.n) + '  ' + str(st.t)));
    arr(s.cmds).forEach(c => {
      lines.push(str(c.label));
      lines.push(str(c.cmd));
      if (c.note) lines.push('-- ' + str(c.note));
      lines.push('');
    });
    /* one trailing blank line from the last command is not worth keeping */
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  /* ---------------------------------------------------------- the shape --

     What a document has to look like before the page will trust it. Said as
     a list of complaints rather than a boolean, because the person who will
     see this is the one who wrote the JSON and can fix it. */
  function check(doc) {
    const bad = [];
    if (!Array.isArray(doc)) return ['The reference should be a list of vendors.'];
    const ids = {};
    doc.forEach((v, i) => {
      const at = 'vendor ' + (i + 1) + (v && v.name ? ' (' + v.name + ')' : '');
      if (!v || !str(v.id)) bad.push(at + ' has no id.');
      else if (ids[v.id]) bad.push('two vendors share the id "' + v.id + '".');
      else ids[v.id] = 1;
      if (!v || !str(v.name)) bad.push(at + ' has no name.');
      const gids = {};
      arr(v && v.groups).forEach((g, j) => {
        const gat = at + ', group ' + (j + 1);
        if (!str(g.id)) bad.push(gat + ' has no id.');
        else if (gids[g.id]) bad.push(gat + ' repeats the id "' + g.id + '".');
        else gids[g.id] = 1;
        if (!str(g.name)) bad.push(gat + ' has no name.');
        arr(g.sections).forEach((s, k) => {
          if (!str(s.title)) bad.push(gat + ', section ' + (k + 1) + ' has no title.');
          if (!countSection(s)) bad.push(gat + ', "' + str(s.title) + '" is empty.');
        });
      });
    });
    return bad;
  }

  return { KINDS, totals, countSection, countGroup, countVendor,
           textOf, hit, filterSection, view, copyText, sectionText, check };
});
