/* team.js - the arithmetic behind the directory.

   Who is in which team, what matches a search, what a copied row says, and
   whether an NIC number looks like an NIC number. No DOM and no network in
   this file: the page in index.html does the drawing and db.js does the
   talking, and both read everything they decide from here.

   The directory itself is never in this repository. It is ninety-seven
   people's mobile numbers and NIC numbers, and everything committed here is
   served publicly at emortia.com - see the note at the top of
   supabase/012_team.sql. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.TeamCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------ copying --

     Four ways out, because where a name is going decides its shape. A row
     pasted into Excel wants tabs; a row pasted into WhatsApp wants dashes,
     and tabs there arrive as one run-on line. */
  const FORMATS = [
    { id:'tab',   name:'Tab separated',    note:'For pasting into a spreadsheet.' },
    { id:'comma', name:'Comma separated',  note:'For a CSV, or anywhere a tab collapses.' },
    { id:'dash',  name:'Name – mobile – ID', note:'For a message. Reads as a sentence.' },
    { id:'phone', name:'Mobile only',      note:'Just the numbers, one to a line.' }
  ];
  const formatById = id => FORMATS.filter(f => f.id === id)[0] || FORMATS[0];

  const str = v => String(v == null ? '' : v).trim();

  /* +94 for anything going outside the country. The leading zero is a
     domestic prefix and has to come off, or the number dials nowhere. */
  function phone(v, intl) {
    const n = str(v);
    if (!n) return '';
    if (!intl) return n;
    if (n.charAt(0) === '+') return n;
    return '+94' + n.replace(/^0+/, '');
  }

  function rowText(p, opts) {
    const o = opts || {};
    const f = formatById(o.format).id;
    const mob = phone(p.mobile, o.intl);
    if (f === 'phone') return mob;
    if (f === 'dash') return [str(p.name), mob, str(p.nic)].filter(Boolean).join(' – ');
    const parts = [str(p.name), mob, str(p.nic)];
    if (o.company) parts.push(str(p.company));
    return parts.filter(Boolean).join(f === 'comma' ? ', ' : '\t');
  }

  function vehicleText(v, opts) {
    const o = opts || {};
    const sep = formatById(o.format).id === 'comma' ? ', ' : '\t';
    return [str(v.reg), str(v.kind), str(v.driver)].filter(Boolean).join(sep);
  }

  const sheet = (list, fn, opts) => (list || []).map(x => fn(x, opts)).join('\n');

  /* ------------------------------------------------------------- naming --

     A team's id is a slug and never changes, so renaming "Janaka" does not
     orphan the nine people filed under it. Two teams called the same thing
     are told apart by a suffix rather than one silently overwriting the
     other - which is what an unadorned slug would do. */
  function slug(name, taken) {
    let base = str(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!base) base = 'team';
    const have = {};
    (taken || []).forEach(t => { have[t] = 1; });
    if (!have[base]) return base;
    for (let i = 2; i < 500; i++) if (!have[base + '-' + i]) return base + '-' + i;
    return base + '-x';
  }

  /* ---------------------------------------------------------- searching --

     Everything flattened once, each row carrying the team it came from, so a
     search crosses teams and a team view is the same list filtered. */
  function pools(teams) {
    const people = [], vehicles = [];
    (teams || []).forEach(t => {
      (t.people || []).forEach(p => people.push(Object.assign({}, p, { team: t.team, teamId: t.id })));
      (t.vehicles || []).forEach(v => vehicles.push(Object.assign({}, v, { team: t.team, teamId: t.id })));
    });
    return { people, vehicles };
  }

  /* Every word has to match something, not the whole phrase one thing:
     "lucky nalin" finds Nalin in the Lucky team, which typing either alone
     does not. Spaces and dashes come out of numbers first, so 077 123 4567
     and 0771234567 are the same search. */
  const loose = s => str(s).toLowerCase().replace(/[\s\-().]/g, '');
  function hit(hay, q) {
    const words = str(q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const plain = hay.toLowerCase(), tight = loose(hay);
    return words.every(w => plain.indexOf(w) > -1 || tight.indexOf(loose(w)) > -1);
  }
  /* The company is deliberately not searched. Every one of them works for the
     same firm, so it can never tell two people apart - and it does real harm:
     "Tooway Solutions (Pvt) Ltd" closes up to ...pvtltd, so a search for the
     role TL matched the entire directory. */
  const personHay = p => [p.name, p.mobile, p.nic, p.role, p.team].filter(Boolean).join(' ');
  const vehicleHay = v => [v.reg, v.kind, v.driver, v.team].filter(Boolean).join(' ');

  /* A search looks everywhere; without one you get the team you picked, or
     everybody. Searching inside one team would hide the answer whenever the
     person turned out to be filed somewhere else, which is the usual reason
     for searching at all. */
  function view(teams, teamId, query) {
    const p = pools(teams);
    const q = str(query);
    if (q) return {
      people: p.people.filter(x => hit(personHay(x), q)),
      vehicles: p.vehicles.filter(x => hit(vehicleHay(x), q)),
      scope: 'search'
    };
    if (teamId && teamId !== 'ALL') return {
      people: p.people.filter(x => x.teamId === teamId),
      vehicles: p.vehicles.filter(x => x.teamId === teamId),
      scope: 'team'
    };
    return { people: p.people, vehicles: p.vehicles, scope: 'all' };
  }

  function counts(teams) {
    const p = pools(teams);
    return { teams: (teams || []).length, people: p.people.length, vehicles: p.vehicles.length };
  }

  /* ------------------------------------------------------------ checking --

     A Sri Lankan NIC is either the old nine digits and a letter, or the new
     twelve digits. Anything else is a typo somebody will find out about at a
     gate one morning, so it is marked - and only marked. The sheet is the
     record and the tool does not get to refuse it. */
  function nicNote(nic) {
    const n = str(nic).toUpperCase();
    if (!n) return 'No ID number';
    if (/^[0-9]{9}[VX]$/.test(n)) return '';
    if (/^[0-9]{12}$/.test(n)) return '';
    if (/^[0-9]{10,}$/.test(n)) return 'Too long for an NIC (' + n.length + ' digits)';
    if (/^[0-9]{9}$/.test(n)) return 'Nine digits with no V or X';
    return 'Not an NIC shape';
  }
  /* the same numbers written two ways are the same number */
  const nicKey = nic => str(nic).toUpperCase().replace(/[^0-9VX]/g, '');

  /* One person in two teams is normal here - a driver covers both. The same
     NIC twice inside one team is a duplicated row, and that is worth saying. */
  function duplicates(teams) {
    const out = [];
    (teams || []).forEach(t => {
      const seen = {};
      (t.people || []).forEach(p => {
        const k = nicKey(p.nic);
        if (!k) return;
        if (seen[k]) out.push({ team: t.team, teamId: t.id, nic: p.nic, name: p.name, first: seen[k] });
        else seen[k] = p.name;
      });
    });
    return out;
  }

  /* ----------------------------------------------------------- the forms --

     What is missing, said once and in the order somebody fills the form in.
     Only the name and the team are actually required: half a record is worth
     more than no record, and the rest arrives when somebody asks. */
  function checkPerson(f) {
    if (!str(f && f.name)) return 'A name, please.';
    if (!str(f && f.teamId)) return 'Pick a team.';
    const m = str(f.mobile);
    if (m && !/^[+0-9\s\-()]{7,}$/.test(m)) return 'That does not look like a mobile number.';
    return '';
  }
  function checkVehicle(f) {
    if (!str(f && f.reg)) return 'A vehicle number, please.';
    if (!str(f && f.teamId)) return 'Pick a team.';
    return '';
  }
  function checkTeam(f, existing) {
    const n = str(f && f.name);
    if (!n) return 'A team name, please.';
    const clash = (existing || []).some(t => str(t.team).toLowerCase() === n.toLowerCase());
    if (clash) return 'There is already a team called ' + n + '.';
    return '';
  }

  return { FORMATS, formatById, phone, rowText, vehicleText, sheet,
           slug, pools, view, counts, hit, personHay, vehicleHay,
           nicNote, nicKey, duplicates, checkPerson, checkVehicle, checkTeam };
});
