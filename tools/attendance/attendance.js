/* attendance.js - what the day adds up to.

   No DOM in here, so it runs under node and the tests are real:

     node tools/attendance/attendance.test.js

   HOW THE DAY WORKS

   A photo is the record. Somebody on the shared device takes one picture of
   whoever is starting the shift and submits it; the time and the location are
   stamped on it at that moment, not typed afterwards. The same again when the
   shift ends. The office then ticks the faces it can see in each photo, and
   the attendance sheet fills itself in from those ticks.

   Nothing here trusts a person to type a time. The only thing anybody enters
   by hand is which names are in which photograph, and that is a judgement a
   person has to make anyway. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ATT = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var s = function (v) { return String(v == null ? '' : v).trim(); };
  var pad = function (n) { return String(n).padStart(2, '0'); };

  /* The local calendar day, not UTC. A shift that starts at 06:00 in Colombo
     is the 4th here and the 3rd in London, and the sheet is read in Colombo. */
  function dstr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function hm(mins) { return pad(Math.floor(mins / 60)) + ':' + pad(mins % 60); }
  function minsOf(ts) { var d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }
  function fmt(ts) { return ts ? hm(minsOf(ts)) : '—'; }

  /* Late is the shift start plus whatever grace is allowed. Both are settings
     rather than constants: the lamp-pole crews do not all start at nine. */
  function lateAfter(shiftStart, graceMinutes) {
    var p = s(shiftStart || '08:30').split(':');
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (isNaN(h)) h = 8; if (isNaN(m)) m = 30;
    var g = parseInt(graceMinutes, 10);
    return h * 60 + m + (isNaN(g) ? 15 : g);
  }

  /* A reference somebody can quote on the phone. Date and the tail of the
     timestamp: short enough to read out, unique enough within a day. */
  function refFor(date, ts) {
    return 'A' + s(date).replace(/-/g, '') + '-' + String(ts).slice(-4);
  }

  function ofDay(records, date) {
    return (records || []).filter(function (r) { return s(r.date) === s(date); });
  }

  /* ---------------------------------------------------------- the sheet

     One row per person on the roster, whether or not they turned up - an
     attendance sheet that only lists the people who came is a list of the
     people who came, and the useful half of it is who did not.

     The earliest clock-in they appear in and the latest clock-out: if two
     photos were taken at the start of a shift, being in either one is being
     there, and the first is when they arrived. */
  function buildSheet(people, records, date, lateMins) {
    var ups = ofDay(records, date);
    var la = lateMins == null ? lateAfter() : lateMins;
    return (people || []).map(function (p) {
      var mine = function (kind) {
        return ups.filter(function (u) {
          return u.kind === kind && (u.members || []).indexOf(p.id) > -1;
        });
      };
      var ins = mine('in').sort(function (a, b) { return a.ts - b.ts; });
      var outs = mine('out').sort(function (a, b) { return b.ts - a.ts; });
      var i = ins[0] || null, o = outs[0] || null;

      var late = !!i && minsOf(i.ts) > la;
      var status = 'Absent', tag = 'tag-out';
      if (i) { status = late ? 'Late' : 'On time'; tag = late ? 'tag-late' : 'tag-ok'; }
      /* still on site: clocked in, no photo out yet */
      if (i && !o) { status = status + ' · in'; }

      return {
        id: p.id, name: p.name, role: p.role || '',
        in: fmt(i && i.ts), out: fmt(o && o.ts),
        inGeo: i ? (i.geo || '—') : '—', outGeo: o ? (o.geo || '—') : '—',
        /* hours only when both ends exist - half a day is not a number */
        hours: i && o ? ((o.ts - i.ts) / 3600000).toFixed(2) : '—',
        status: status, tagClass: tag, late: late, present: !!i, closed: !!(i && o)
      };
    });
  }

  function stats(sheet, dayRecords) {
    var present = (sheet || []).filter(function (r) { return r.present; });
    var late = (sheet || []).filter(function (r) { return r.late; });
    var named = (dayRecords || []).reduce(function (a, u) { return a + (u.members || []).length; }, 0);
    return {
      photos: (dayRecords || []).length,
      named: named,
      present: present.length,
      roster: (sheet || []).length,
      late: late.length
    };
  }

  /* The last ten days, newest first. Ten because a sheet older than that is a
     question for the export rather than the screen. */
  function dateOpts(today, n) {
    var base = today ? new Date(today + 'T12:00:00') : new Date();
    var out = [];
    for (var i = 0; i < (n || 10); i++) {
      var d = new Date(base.getTime());
      d.setDate(d.getDate() - i);
      out.push({
        value: dstr(d),
        label: (i === 0 ? 'Today · ' : '') +
          d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
      });
    }
    return out;
  }

  /* What the device does next. Its own clock-in closes when its own clock-out
     is filed, and the whole thing expires after a day so a phone left on a
     shelf is ready again tomorrow rather than stuck on yesterday. */
  function deviceState(device, now) {
    now = now || Date.now();
    if (!device || !device.expires || device.expires <= now) return { in: null, out: null, next: 'in', done: false };
    return {
      in: device.in || null,
      out: device.out || null,
      next: device.in ? 'out' : 'in',
      done: !!(device.in && device.out)
    };
  }
  function hoursBetween(a, b) {
    return (a && b) ? ((b - a) / 3600000).toFixed(2) : '';
  }

  /* Ticking a face on or off. Returns a new record rather than editing the one
     handed in, so a failed save leaves what is on screen untouched. */
  function toggleMember(record, personId) {
    var members = (record.members || []).slice();
    var at = members.indexOf(personId);
    if (at > -1) members.splice(at, 1); else members.push(personId);
    var out = {};
    Object.keys(record).forEach(function (k) { out[k] = record[k]; });
    out.members = members;
    return out;
  }

  /* The rows the export writes. Built here rather than in the page so the
     spreadsheet and the table on screen can never disagree about a day. */
  function exportRows(sheet, date, lateMins) {
    var head = ['Staff', 'Role', 'Clock in', 'In location', 'Clock out', 'Out location', 'Hours', 'Status'];
    var rows = (sheet || []).map(function (r) {
      return [r.name, r.role, r.in, r.inGeo, r.out, r.outGeo, r.hours, r.status];
    });
    var st = stats(sheet, []);
    return {
      title: 'Daily attendance · ' + s(date),
      note: st.present + ' of ' + st.roster + ' present · ' + st.late +
            ' late · late is any clock-in after ' + hm(lateMins == null ? lateAfter() : lateMins),
      head: head, rows: rows
    };
  }

  /* A person's name is what everything else hangs off, so it has to be there;
     a role is a convenience and may be blank. */
  function cleanPerson(p) {
    var name = s(p && p.name);
    if (!name) return null;
    return { id: s(p.id) || ('P' + Date.now() + Math.random().toString(36).slice(2, 6)),
             name: name, role: s(p && p.role), sort: Number(p && p.sort) || 0 };
  }
  function sortPeople(people) {
    return (people || []).slice().sort(function (a, b) {
      return (a.sort - b.sort) || String(a.name).localeCompare(String(b.name));
    });
  }

  return {
    pad: pad, dstr: dstr, hm: hm, minsOf: minsOf, fmt: fmt,
    lateAfter: lateAfter, refFor: refFor, ofDay: ofDay,
    buildSheet: buildSheet, stats: stats, dateOpts: dateOpts,
    deviceState: deviceState, hoursBetween: hoursBetween,
    toggleMember: toggleMember, exportRows: exportRows,
    cleanPerson: cleanPerson, sortPeople: sortPeople
  };
}));
