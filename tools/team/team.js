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

  const str = v => String(v == null ? '' : v).trim();

  /* ------------------------------------------------------------ copying --

     The sheet's own columns, in the sheet's own order, separated by tabs.
     There used to be four formats to pick between and a switch for whether
     the company came along. That was a row of chips above a table nobody had
     asked a question about: what is actually wanted is the line as it sits in
     the workbook, so that copying a row and pasting it back lands in the
     right columns.

     Blanks are kept as empty cells rather than dropped. A missing NIC has to
     leave a gap, or the company slides left into the ID column and a paste
     silently files somebody's employer as their identity card. */
  const COLUMNS = ['Name', 'Mobile Number', 'ID No', 'Company Name', 'Role'];

  const phone = v => str(v);

  function rowText(p) {
    return [str(p.name), phone(p.mobile), str(p.nic), str(p.company), str(p.role)].join('\t');
  }
  function vehicleText(v) {
    return [str(v.reg), str(v.kind), str(v.driver)].join('\t');
  }
  const headerText = () => COLUMNS.join('\t');

  const sheet = (list, fn) => (list || []).map(x => fn(x)).join('\n');

  /* ------------------------------------------------------------- naming --

     A team's id is a slug and never changes, so renaming "Janaka" does not
     orphan the nine people filed under it. Two teams called the same thing
     are told apart by a suffix rather than one silently overwriting the
     other - which is what an unadorned slug would do. */
  /* A tab is often already called "Lucky Team", so writing the heading as
     name + " Team" gave "Lucky Team Team". The word is only added where it
     is not already the end of the name. */
  function titleOf(name) {
    const n = str(name);
    if (!n) return 'That team';
    return /\bteams?$/i.test(n) ? n : n + ' Team';
  }

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

  /* ================================================================
     Reading a workbook
     ================================================================

     The sheet is whatever the office actually keeps, so the columns are found
     by their headings rather than by position - somebody will insert a column
     one day and it must not silently shift everybody's NIC into the company
     field. Every spelling seen on a real sheet is listed. */
  const ALIASES = {
    name:    ['name', 'full name', 'employee name', 'member name', 'staff name'],
    mobile:  ['mobile', 'mobile number', 'mobile no', 'contact', 'contact number',
              'phone', 'phone number', 'tp', 'tp number'],
    nic:     ['id no', 'id number', 'idno', 'nic', 'nic no', 'nic number', 'id', 'nic/id'],
    company: ['company', 'company name', 'employer'],
    role:    ['role', 'designation', 'position', 'type', 'category'],
    team:    ['team', 'team name', 'sub team', 'subteam', 'group'],
    reg:     ['vehicle no', 'vehicle number', 'vehicle', 'vehicle reg', 'reg no'],
    kind:    ['vehicle type', 'type of vehicle'],
    driver:  ['driver', 'driver name']
  };
  const norm = s => str(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function headerFor(cell) {
    const n = norm(cell);
    if (!n) return null;
    const keys = Object.keys(ALIASES);
    for (let i = 0; i < keys.length; i++)
      if (ALIASES[keys[i]].indexOf(n) > -1) return keys[i];
    return null;
  }

  /* The heading row is not always the first: sheets carry titles, blank rows
     and merged banners above the table. It is the first row that names at
     least a person's name and one other thing we recognise. */
  function findHeader(rows) {
    const top = Math.min((rows || []).length, 25);
    for (let r = 0; r < top; r++) {
      const found = {}, cells = rows[r] || [];
      for (let c = 0; c < cells.length; c++) {
        const k = headerFor(cells[c]);
        if (k && found[k] == null) found[k] = c;
      }
      if (found.name != null && Object.keys(found).length > 1) return { row: r, cols: found };
    }
    return null;
  }

  /* One real sheet has TL / DRIVER / MEMBER sitting in a column with no
     heading at all. Rather than guess from the values, the single unlabelled
     column that actually holds something becomes the role - and the caller is
     told, because a silent guess about somebody's job is worse than a noisy
     one. */
  function adoptUnlabelled(rows, head, tally, sheetName) {
    if (head.cols.role != null) return;
    const used = {};
    Object.keys(head.cols).forEach(k => { used[head.cols[k]] = 1; });
    const width = rows.slice(head.row, head.row + 200)
      .reduce((w, r) => Math.max(w, (r || []).length), 0);
    const spare = [];
    for (let c = 0; c < width; c++) {
      if (used[c]) continue;
      const has = rows.slice(head.row + 1).some(r => str((r || [])[c]));
      if (has) spare.push(c);
    }
    /* Sixteen team tabs share one layout, so warning per tab would print the
       same sentence sixteen times. They are tallied and said once. */
    if (spare.length === 1) {
      head.cols.role = spare[0];
      (tally.role[colName(spare[0])] = tally.role[colName(spare[0])] || []).push(sheetName);
    } else if (spare.length > 1) {
      (tally.skipped[spare.length] = tally.skipped[spare.length] || []).push(sheetName);
    }
  }
  /* "on 16 sheets" rather than sixteen lines; up to three are named, because
     after three the names stop telling anybody anything. */
  function tallyLines(tally, warn) {
    Object.keys(tally.role).forEach(col => {
      const on = tally.role[col];
      warn.push('Column ' + col + ' has no heading and was read as the role' +
        (on.length === 1 ? ' on ' + on[0] : ', on ' + on.length + ' sheets (' +
          on.slice(0, 3).join(', ') + (on.length > 3 ? ', …' : '') + ')') + '.');
    });
    Object.keys(tally.skipped).forEach(n => {
      const on = tally.skipped[n];
      warn.push(n + ' columns have no heading and were skipped' +
        (on.length === 1 ? ' on ' + on[0] : ' on ' + on.length + ' sheets') + '.');
    });
  }
  const colName = i => {
    let s = '';
    for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
    return s;
  };

  /* sheets is [{ name, rows }], rows being arrays of raw cells. SheetJS lives
     in the page; this file has never needed it and should not learn. */
  function readWorkbook(sheets, opts) {
    const o = opts || {};
    const warn = [], teams = [];
    const tally = { role: {}, skipped: {} };
    const byId = {};
    const take = (id, name, source) => {
      if (!byId[id]) { byId[id] = { id, team: name, source: source || 'sheet',
                                    people: [], vehicles: [] }; teams.push(byId[id]); }
      return byId[id];
    };

    (sheets || []).forEach(sh => {
      const rows = sh.rows || [];
      const head = findHeader(rows);
      if (!head) {
        if (rows.some(r => (r || []).some(c => str(c))))
          warn.push('“' + sh.name + '” has no Name column and was skipped.');
        return;
      }
      adoptUnlabelled(rows, head, tally, '“' + sh.name + '”');
      const at = (r, k) => head.cols[k] == null ? '' : str((r || [])[head.cols[k]]);

      for (let i = head.row + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r.some(c => str(c))) continue;

        /* the team comes off a Team column when the sheet has one, and off
           the sheet's own tab name when it does not - which is how the real
           workbook is arranged, one team to a tab */
        const teamName = at(r, 'team') || sh.name;
        if (!str(teamName)) continue;
        const t = take(slug(teamName, []), teamName, o.source);

        const reg = at(r, 'reg');
        const name = at(r, 'name');
        /* a row can carry a person, a vehicle, or both - the vehicle columns
           on a person's row are that person's van */
        if (name && norm(name) !== 'name')
          t.people.push({ name, mobile: at(r, 'mobile'), nic: at(r, 'nic'),
                          company: at(r, 'company'), role: at(r, 'role') });
        if (reg)
          t.vehicles.push({ reg, kind: at(r, 'kind'), driver: at(r, 'driver') || name });
      }
    });

    tallyLines(tally, warn);
    teams.forEach(t => {
      if (!t.people.length && !t.vehicles.length)
        warn.push('“' + t.team + '” had no rows under its headings.');
    });
    return { teams: teams.filter(t => t.people.length || t.vehicles.length), warnings: warn };
  }

  /* ================================================================
     What actually changed
     ================================================================

     The same sheet arrives again next month with three numbers corrected. The
     point of this is that three rows move and ninety-four do not: an untouched
     row keeps its id, its place and its history rather than being deleted and
     written back identical. */

  /* FNV-1a over the fields that are the record. Anything the tool added -
     ids, sort order, timestamps - is deliberately outside it, or every row
     would look changed the moment it was saved. */
  /* The fields are joined on a separator none of them can contain. Without
     one, "Ann" + "1234" and "Ann1" + "234" are the same string and two
     different people hash to one row. */
  const SEP = '';

  function fingerprint(p) {
    const s = [str(p.name).toLowerCase(), str(p.mobile).replace(/\D/g, ''),
               nicKey(p.nic), str(p.company).toLowerCase(), str(p.role).toLowerCase()].join(SEP);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }
  function vehicleFingerprint(v) {
    return fingerprint({ name: v.reg, mobile: '', nic: '', company: v.kind, role: v.driver });
  }

  /* Who a row is. The NIC when there is one, because that is the thing that
     does not change when a name is spelt differently on the second sheet.
     Failing that the name and the number together - a name alone would merge
     two people who share one. Scoped to the team, because the same driver
     genuinely appears under two of them. */
  function identity(teamId, p) {
    const nic = nicKey(p.nic);
    return teamId + SEP + (nic || (str(p.name).toLowerCase() + SEP +
                                        str(p.mobile).replace(/\D/g, '')));
  }
  const vehicleIdentity = (teamId, v) =>
    teamId + SEP + str(v.reg).toLowerCase().replace(/[^a-z0-9]/g, '');

  /* What the import would do, worked out before anything is written so it can
     be read and agreed to. Nothing is deleted here: rows in the directory
     that this sheet does not mention are listed as `missing` and left exactly
     where they are, because a sheet covering one team must never be able to
     empty the other fifteen. */
  function planImport(incoming, existing) {
    const have = {}, haveV = {}, teamsHave = {}, byName = {};
    (existing || []).forEach(t => {
      teamsHave[t.id] = t;
      /* Also indexed by name. A team's id was minted at some point in the
         past and need not be what slug() would produce today - the directory
         carries "janaka-2-" where this would now say "janaka-2". Matching on
         the id alone made that team, and everybody in it, look new. */
      byName[str(t.team).toLowerCase()] = t;
      (t.people || []).forEach(p => { have[identity(t.id, p)] = { row: p, team: t }; });
      (t.vehicles || []).forEach(v => { haveV[vehicleIdentity(t.id, v)] = { row: v, team: t }; });
    });

    const out = { newTeams: [], add: [], update: [], same: 0,
                  addV: [], updateV: [], sameV: 0, missing: [], touched: {},
                  saidVehicles: {} };
    const seen = {}, seenV = {};

    (incoming || []).forEach(inc => {
      /* the team as the directory already knows it, whatever its id */
      const known = teamsHave[inc.id] || byName[str(inc.team).toLowerCase()];
      const t = known ? { id: known.id, team: known.team,
                          people: inc.people, vehicles: inc.vehicles }
                      : inc;
      if (!known) out.newTeams.push({ id: t.id, team: t.team, source: 'sheet' });
      out.touched[t.id] = t.team;
      /* A sheet with no vehicle columns has said nothing about vehicles, so
         it must not make every van in the directory look missing. */
      if ((inc.vehicles || []).length) out.saidVehicles[t.id] = 1;

      (t.people || []).forEach((p, i) => {
        const id = identity(t.id, p);
        seen[id] = 1;
        const was = have[id];
        const row = { teamId: t.id, teamName: t.team, name: p.name, mobile: p.mobile,
                      nic: p.nic, company: p.company, role: p.role, sort: i };
        if (!was) out.add.push(row);
        else if (fingerprint(was.row) !== fingerprint(p))
          out.update.push(Object.assign({ id: was.row.id, was: was.row }, row));
        else out.same++;
      });

      (t.vehicles || []).forEach((v, i) => {
        const id = vehicleIdentity(t.id, v);
        seenV[id] = 1;
        const was = haveV[id];
        const row = { teamId: t.id, teamName: t.team, reg: v.reg, kind: v.kind,
                      driver: v.driver, sort: i };
        if (!was) out.addV.push(row);
        else if (vehicleFingerprint(was.row) !== vehicleFingerprint(v))
          out.updateV.push(Object.assign({ id: was.row.id }, row));
        else out.sameV++;
      });
    });

    /* only inside the teams this sheet actually covered - anywhere it was
       silent, it has said nothing about who belongs there */
    Object.keys(out.touched).forEach(tid => {
      const t = teamsHave[tid];
      if (!t) return;
      (t.people || []).forEach(p => {
        if (!seen[identity(tid, p)])
          out.missing.push({ kind: 'person', id: p.id, name: p.name, team: t.team });
      });
      /* only where the sheet actually carried vehicles - a people-only
         workbook has not said the vans are gone, it has not mentioned them */
      if (out.saidVehicles[tid]) (t.vehicles || []).forEach(v => {
        if (!seenV[vehicleIdentity(tid, v)])
          out.missing.push({ kind: 'vehicle', id: v.id, name: v.reg, team: t.team });
      });
    });

    out.counts = {
      teams: out.newTeams.length,
      add: out.add.length, update: out.update.length, same: out.same,
      addV: out.addV.length, updateV: out.updateV.length, sameV: out.sameV,
      missing: out.missing.length,
      writes: out.newTeams.length + out.add.length + out.update.length +
              out.addV.length + out.updateV.length
    };
    return out;
  }

  /* What the plan reads as, in one line. "245 read, 3 changed, 242 already
     right" is the sentence somebody wants after uploading the same sheet
     twice by accident. */
  function planSummary(plan) {
    const c = plan.counts, bits = [];
    const n = (x, one, many) => x + ' ' + (x === 1 ? one : many);
    if (c.teams)  bits.push(n(c.teams, 'new team', 'new teams'));
    if (c.add)    bits.push(n(c.add, 'new member', 'new members'));
    if (c.update) bits.push(n(c.update, 'member changed', 'members changed'));
    if (c.addV)   bits.push(n(c.addV, 'new vehicle', 'new vehicles'));
    if (c.updateV)bits.push(n(c.updateV, 'vehicle changed', 'vehicles changed'));
    const unchanged = c.same + c.sameV;
    if (!bits.length) return unchanged
      ? 'Nothing has changed – all ' + unchanged + ' rows already match.'
      : 'Nothing to bring in.';
    return bits.join(', ') + (unchanged ? ', and ' + unchanged + ' already right.' : '.');
  }

  /* Which fields moved on a changed row, so the plan can say what it is about
     to overwrite rather than only that it will. */
  function changesOn(u) {
    const was = u.was || {}, fields = ['name', 'mobile', 'nic', 'company', 'role'];
    return fields.filter(f => str(was[f]) !== str(u[f]))
      .map(f => ({ field: f, from: str(was[f]), to: str(u[f]) }));
  }

  return { COLUMNS, phone, rowText, vehicleText, headerText, sheet,
           slug, titleOf, pools, view, counts, hit, personHay, vehicleHay,
           nicNote, nicKey, duplicates, checkPerson, checkVehicle, checkTeam,
           ALIASES, headerFor, findHeader, readWorkbook, colName,
           fingerprint, identity, planImport, planSummary, changesOn };
});
