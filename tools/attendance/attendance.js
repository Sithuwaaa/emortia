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
     rather than constants: the lamp-pole crews do not all start at nine.

     The fallback matters more than it looks. Five places below call
     lateAfter() with nothing when they are handed no cutoff, so whatever is
     written here is a second rule living in the same codebase as the first.
     It used to say 08:30 while the tool said 09:00, which meant any caller
     that forgot to pass the cutoff would quietly mark people late by a rule
     nobody had chosen. It now agrees with the tool. */
  function lateAfter(shiftStart, graceMinutes) {
    var p = s(shiftStart || '09:00').split(':');
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (isNaN(h)) h = 9; if (isNaN(m)) m = 0;
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
  /* Leave is a mark the office puts against a person for a day: it is not the
     same fact as not turning up, and a sheet that calls them both Absent is
     wrong about somebody who asked in advance. A photograph outranks it - if
     they were marked on leave and came in anyway, they were here. */
  /* Which days the tool has anything at all for. A day nobody filed on is not
     a day twenty-five people were absent - it is a day the tool was not being
     used, and painting it red says something about people that is not true.
     Before any of this was switched on every day would have read as a full
     team absence, which is worse than showing nothing. */
  function daysWithRecords(records) {
    var seen = {};
    (records || []).forEach(function (r) { if (r && r.date) seen[r.date] = true; });
    return seen;
  }

  /* A public holiday is a fact about the country, not about a person. It has
     to be written down somewhere - Poya days follow the moon and the rest are
     gazetted - so it is read from a list rather than worked out. */
  function holidayOn(date, holidays) {
    var hit = null;
    (holidays || []).forEach(function (h) { if (h && h.day === date && !hit) hit = h; });
    return hit;
  }

  function buildSheet(people, records, date, lateMins, leave, opts) {
    var o = opts || {};
    var hol = o.holiday || null;
    /* noData is decided by the caller, which can see the whole month; a single
       day cannot tell "nobody came" from "nothing was filed". */
    var blank = !!o.noData;
    var marks = {};
    (leave || []).forEach(function (l) { if (l && l.day === date) marks[l.person] = l; });
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
      var mark = marks[p.id] || null;
      var status = 'Absent', tag = 'tag-out';
      /* The order matters, weakest claim first.

         "Nothing was filed" is the weakest thing the sheet can say, so
         anything else outranks it - a leave mark is the office stating a fact
         about this person on this day, and it stays visible whether or not
         anybody else clocked in. A holiday outranks both. And a photograph
         outranks everything: somebody who came in on a Poya day, or on a day
         marked leave, was here, and the sheet says so. */
      if (blank && !i) { status = 'No record'; tag = 'tag-none'; }
      if (hol && !i)   { status = hol.name || 'Holiday'; tag = 'tag-holiday'; }
      if (mark && !i)  { status = mark.label || 'Leave'; tag = 'tag-leave'; }
      if (i) { status = late ? 'Late' : 'On time'; tag = late ? 'tag-late' : 'tag-ok'; }
      /* still on site: clocked in, no photo out yet */
      if (i && !o) { status = status + ' · in'; }

      /* A stamp the office typed is not the same evidence as a photograph, and
         the sheet should not pretend otherwise. It counts identically - the
         crews often do not send a picture and a day worked is a day worked -
         but it says which it is, so a disputed row can be traced back to
         either a face or a decision somebody made. */
      var typed = function (u) { return !!u && /^M:/.test(u.ref || ''); };

      return {
        id: p.id, name: p.name, role: p.role || '',
        in: fmt(i && i.ts), out: fmt(o && o.ts),
        inId: i ? i.id : '', outId: o ? o.id : '',
        inTyped: typed(i), outTyped: typed(o),
        inGeo: i ? (i.geo || '—') : '—', outGeo: o ? (o.geo || '—') : '—',
        /* hours only when both ends exist - half a day is not a number */
        hours: i && o ? ((o.ts - i.ts) / 3600000).toFixed(2) : '—',
        status: status, tagClass: tag, late: late, present: !!i, closed: !!(i && o),
        /* on leave and not here: the one case an empty row is accounted for */
        leave: !!(mark && !i), note: mark ? (mark.note || '') : '',
        /* Nothing was filed that day by anybody, so this row is a gap in the
           record rather than a statement about this person. Everything that
           counts days has to skip it or the figures are fiction. A leave mark
           or a holiday is not a gap - somebody wrote those down. */
        noData: blank && !i && !mark && !hol,
        /* A day off for the country. Not present, and not absent either. */
        holiday: (!i && !!hol) ? (hol.name || 'Holiday') : ''
      };
    });
  }

  /* Twenty-five names in one column is a list to be scrolled; the same names
     under Office, Supervisor, Trainee and Field is a sheet somebody can find
     their crew in. The roster is already ordered so the groups fall together,
     so this only has to notice where one ends. */
  function groupSheet(sheet) {
    var out = [], last = null;
    (sheet || []).forEach(function (r) {
      var g = r.role || 'Everyone else';
      if (!last || last.role !== g) { last = { role: g, rows: [] }; out.push(last); }
      last.rows.push(r);
    });
    return out;
  }

  function stats(sheet, dayRecords) {
    var present = (sheet || []).filter(function (r) { return r.present; });
    var late = (sheet || []).filter(function (r) { return r.late; });
    var named = (dayRecords || []).reduce(function (a, u) { return a + (u.members || []).length; }, 0);
    var onLeave = (sheet || []).filter(function (r) { return r.leave; });
    return {
      photos: (dayRecords || []).length,
      named: named,
      present: present.length,
      roster: (sheet || []).length,
      late: late.length,
      leave: onLeave.length,
      /* absent means unaccounted for: on leave is accounted for */
      absent: (sheet || []).length - present.length - onLeave.length
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
            ' late · ' + st.leave + ' on leave · ' + st.absent + ' absent · late is any clock-in after ' +
            hm(lateMins == null ? lateAfter() : lateMins),
      head: head, rows: rows
    };
  }

  /* ------------------------------------------------------------- a month

     The day sheet answers who is here. A month answers how much somebody
     worked, which is the question the office is actually asked - by a payroll
     line, by a query about one person, by a query about the crew. All three
     are built out of buildSheet, one day at a time, so a month can never
     disagree with the days it is made of.

     Days that have not happened yet are left out rather than counted absent:
     an export taken on the 5th should not say a person missed the rest of the
     month. */
  /* The last day of a month, counted rather than assumed. Day 0 of the month
     after is the last day of this one, which is the only way to get this right
     without a table of month lengths and a leap-year rule of one's own.
     Anything that asks the database for "the month" has to go through here:
     a range that ends on the 31st of September is not a late row, it is an
     error the whole query dies of. */
  function monthEnd(ym) {
    var p = s(ym).split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (!y || !m || m < 1 || m > 12) return '';
    return y + '-' + pad(m) + '-' + pad(new Date(y, m, 0).getDate());
  }
  function monthStart(ym) {
    var e = monthEnd(ym);
    return e ? e.slice(0, 8) + '01' : '';
  }
  function monthDays(ym, today) {
    var p = s(ym).split('-');
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (!y || !m || m < 1 || m > 12) return [];
    var last = new Date(y, m, 0).getDate();
    if (today && s(today).slice(0, 7) === s(ym)) {
      var d = parseInt(s(today).slice(8, 10), 10);
      if (d && d < last) last = d;
    }
    var out = [];
    for (var i = 1; i <= last; i++) out.push(y + '-' + pad(m) + '-' + pad(i));
    return out;
  }
  function monthLabel(ym) {
    var p = s(ym).split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1);
    return isNaN(d.getTime()) ? s(ym) :
      d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  function weekdayOf(date) {
    var d = new Date(s(date) + 'T12:00:00');
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'short' });
  }

  /* One cell of a month grid. Short because there are thirty-one of them
     across, and a dot rather than a second letter for the day somebody was
     photographed arriving and never photographed leaving - the hours for that
     day are not a number, and the grid should say so quietly. */
  function dayCode(row) {
    if (!row) return '';
    if (row.present) return (row.late ? 'L' : 'P') + (row.closed ? '' : '·');
    return row.leave ? 'LV' : 'A';
  }

  function monthSheets(people, records, leave, ym, lateMins, today, holidays) {
    var la = lateMins == null ? lateAfter() : lateMins;
    var filed = daysWithRecords(records);
    return monthDays(ym, today).map(function (d) {
      var hol = holidayOn(d, holidays);
      var blank = !filed[d];
      return { date: d, noData: blank, holiday: hol ? (hol.name || 'Holiday') : '',
        holidayKind: hol ? (hol.kind || '') : '',
        sheet: buildSheet(people, records, d, la, leave, { holiday: hol, noData: blank }) };
    });
  }

  /* The team, a month across: a person a row, a day a column, and the counts
     somebody would otherwise reach for a calculator to get. */
  /* ------------------------------------------------------ a stretch of days

     A month is one kind of question and a week is another, and the office asks
     both. Rather than a second copy of the counting for every shape, the range
     is the general case and the month is a range that happens to start on the
     first. */

  /* The week a date falls in, Monday to Sunday - the week the crews work to,
     not the American week that starts on Sunday. */
  function weekOf(date) {
    var d = new Date(String(date) + 'T12:00:00');
    if (isNaN(d)) return null;
    var back = (d.getDay() + 6) % 7;            // Monday is 0
    var from = new Date(d); from.setDate(d.getDate() - back);
    var to = new Date(from); to.setDate(from.getDate() + 6);
    return { from: dstr(from), to: dstr(to) };
  }

  function rangeLabel(from, to) {
    if (from === to) return weekdayOf(from) + ' ' + from;
    return from + ' to ' + to;
  }

  function rangeSheets(people, records, leave, from, to, lateMins, today, holidays) {
    var la = lateMins == null ? lateAfter() : lateMins;
    var filed = daysWithRecords(records);
    var now = today || dstr(new Date());
    return dayRange(from, to).map(function (d) {
      var hol = holidayOn(d, holidays);
      var blank = !filed[d];
      var dt = new Date(d + 'T12:00:00');
      return { date: d, noData: blank, fut: d > now,
        sun: dt.getDay() === 0, sat: dt.getDay() === 6,
        holiday: hol ? (hol.name || 'Holiday') : '',
        holidayKind: hol ? (hol.kind || '') : '',
        sheet: buildSheet(people, records, d, la, leave, { holiday: hol, noData: blank }) };
    });
  }

  /* One row per person, one column per day. Days that are not a statement
     about anybody - nothing filed, a Sunday, a holiday, a day not yet reached
     - are counted in their own buckets and never as an absence. */
  function tallyInto(t, row, day) {
    if (!row || day.fut) return '';
    if (row.present) { t.present++; if (row.late) t.late++;
      if (row.hours !== '—') t.hours += parseFloat(row.hours);
      return dayCode(row); }
    if (row.noData) { t.nodata++; return ''; }
    if (row.leave)  { t.leave++;  return dayCode(row); }
    if (day.holiday){ t.holiday++; return 'H'; }
    if (day.sun)    { t.off++;    return ''; }
    t.absent++; return dayCode(row);
  }
  function blankTally() {
    return { present: 0, late: 0, leave: 0, absent: 0, holiday: 0, off: 0, nodata: 0, hours: 0 };
  }

  function rangeTeamRows(people, records, leave, from, to, lateMins, today, holidays, title) {
    var la = lateMins == null ? lateAfter() : lateMins;
    var days = rangeSheets(people, records, leave, from, to, la, today, holidays);
    var head = ['Staff', 'Role']
      .concat(days.map(function (d) {
        return weekdayOf(d.date).slice(0, 2) + ' ' + parseInt(d.date.slice(8), 10); }))
      .concat(['Present', 'Late', 'On leave', 'Absent', 'Holiday', 'Hours']);
    var rows = (people || []).map(function (p) {
      var t = blankTally();
      var cells = days.map(function (d) {
        var r = null;
        d.sheet.forEach(function (x) { if (x.id === p.id) r = x; });
        return tallyInto(t, r, d);
      });
      return [p.name, p.role || ''].concat(cells)
        .concat([t.present, t.late, t.leave, t.absent, t.holiday,
                 Number(t.hours.toFixed(2))]);
    });
    var filed = days.filter(function (d) { return !d.noData && !d.fut; }).length;
    return {
      title: title || ('Daily attendance – the team – ' + rangeLabel(from, to)),
      note: 'P present · L late · LV on leave · A absent · H holiday · a dot means no ' +
            'clock-out was photographed, so that day has no hours. Late is any clock-in ' +
            'after ' + hm(la) + '. ' + filed + ' of ' + days.length +
            ' days have anything filed; the rest are blank rather than absent.',
      head: head, rows: rows, days: days.length
    };
  }

  function rangePersonRows(person, records, leave, from, to, lateMins, today, holidays, title) {
    var la = lateMins == null ? lateAfter() : lateMins;
    var days = rangeSheets([person], records, leave, from, to, la, today, holidays);
    var t = blankTally();
    var rows = days.map(function (d) {
      var r = d.sheet[0] || null;
      tallyInto(t, r, d);
      return [d.date, weekdayOf(d.date), r ? r.in : '—', r ? r.inGeo : '—',
              r ? r.out : '—', r ? r.outGeo : '—', r ? r.hours : '—',
              d.fut ? 'Not yet' : (r ? r.status : ''),
              d.holiday || (r ? r.note : '')];
    });
    rows.push(['', '', '', '', '', '', '', '', '']);
    rows.push(['Total', days.length + ' days', '', '', '', '',
               Number(t.hours.toFixed(2)),
               t.present + ' present · ' + t.late + ' late · ' + t.leave +
               ' on leave · ' + t.absent + ' absent',
               t.holiday + ' holiday · ' + t.nodata + ' with nothing filed']);
    return {
      title: title || ('Daily attendance – ' + s(person && person.name) + ' – ' + rangeLabel(from, to)),
      note: (person && person.role ? person.role + ' · ' : '') +
            'Late is any clock-in after ' + hm(la) + '. Hours are counted only where both ' +
            'a clock-in and a clock-out were photographed. Days with nothing filed by ' +
            'anybody are left blank rather than counted as an absence.',
      head: ['Date', 'Day', 'Clock in', 'In location', 'Clock out', 'Out location',
             'Hours', 'Status', 'Note'],
      rows: rows, totals: t
    };
  }

  function monthTeamRows(people, records, leave, ym, lateMins, today) {
    var la = lateMins == null ? lateAfter() : lateMins;
    var days = monthSheets(people, records, leave, ym, la, today);
    var head = ['Staff', 'Role']
      .concat(days.map(function (d) { return String(parseInt(d.date.slice(8), 10)); }))
      .concat(['Present', 'Late', 'On leave', 'Absent', 'Hours']);
    var rows = (people || []).map(function (p) {
      var t = { present: 0, late: 0, leave: 0, absent: 0, hours: 0 };
      var cells = days.map(function (d) {
        var r = null;
        d.sheet.forEach(function (x) { if (x.id === p.id) r = x; });
        if (!r) return '';
        if (r.present) { t.present++; if (r.late) t.late++; }
        else if (r.leave) t.leave++;
        else t.absent++;
        if (r.hours !== '—') t.hours += parseFloat(r.hours);
        return dayCode(r);
      });
      return [p.name, p.role || ''].concat(cells)
        .concat([t.present, t.late, t.leave, t.absent, Number(t.hours.toFixed(2))]);
    });
    return {
      title: 'Daily attendance – the team – ' + monthLabel(ym),
      note: 'P present · L late · LV on leave · A absent · a dot means no clock-out was ' +
            'photographed, so that day has no hours. Late is any clock-in after ' + hm(la) + '.',
      head: head, rows: rows, days: days.length
    };
  }

  /* One person, a month down: the shape somebody reads when they are being
     asked about their own month, or when a day of it is being disputed. */
  function monthPersonRows(person, records, leave, ym, lateMins, today) {
    var la = lateMins == null ? lateAfter() : lateMins;
    var days = monthSheets([person], records, leave, ym, la, today);
    var t = { present: 0, late: 0, leave: 0, absent: 0, hours: 0 };
    var rows = days.map(function (d) {
      var r = d.sheet[0] || null;
      if (r) {
        if (r.present) { t.present++; if (r.late) t.late++; }
        else if (r.leave) t.leave++;
        else t.absent++;
        if (r.hours !== '—') t.hours += parseFloat(r.hours);
      }
      return [d.date, weekdayOf(d.date), r ? r.in : '—', r ? r.inGeo : '—',
              r ? r.out : '—', r ? r.outGeo : '—', r ? r.hours : '—',
              r ? r.status : '', r ? r.note : ''];
    });
    rows.push(['', '', '', '', '', '', '', '', '']);
    rows.push(['Total', days.length + ' days', '', '', '', '',
               Number(t.hours.toFixed(2)),
               t.present + ' present · ' + t.late + ' late · ' + t.leave +
               ' on leave · ' + t.absent + ' absent', '']);
    return {
      title: 'Daily attendance – ' + s(person && person.name) + ' – ' + monthLabel(ym),
      note: (person && person.role ? person.role + ' · ' : '') +
            'Late is any clock-in after ' + hm(la) + '. Hours are counted only where both ' +
            'a clock-in and a clock-out were photographed.',
      head: ['Date', 'Day', 'Clock in', 'In location', 'Clock out', 'Out location',
             'Hours', 'Status', 'Note'],
      rows: rows, totals: t
    };
  }

  /* ------------------------------------------------------- leave, in advance

     Leave marked from the sheet is leave noticed after the fact. Somebody who
     says on Friday that they will be away on Wednesday should be able to be
     written down on Friday, which means a person, a date, and usually a date
     to as well. The days are spelled out one by one rather than kept as a
     range, because every other thing here is answered a day at a time. */
  function nextDay(date) {
    var d = new Date(s(date) + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + 1);
    return dstr(d);
  }
  function dayRange(from, to) {
    var a = s(from), b = s(to) || a;
    if (!a) return [];
    if (b < a) { var t = a; a = b; b = t; }
    var out = [], d = a, guard = 0;
    while (d && d <= b && guard++ < 400) { out.push(d); d = nextDay(d); }
    return out;
  }

  /* Six chips saying Nimal is off on six consecutive days is a worse way of
     saying one thing. Consecutive days for one person become one run. */
  function groupLeave(marks) {
    var by = {};
    (marks || []).forEach(function (m) {
      if (!m || !m.person || !m.day) return;
      (by[m.person] = by[m.person] || []).push(m);
    });
    var out = [];
    Object.keys(by).forEach(function (pid) {
      var ds = by[pid].slice().sort(function (a, b) {
        return a.day < b.day ? -1 : a.day > b.day ? 1 : 0;
      });
      var run = null;
      ds.forEach(function (m) {
        if (run && nextDay(run.to) === m.day) { run.to = m.day; run.days.push(m.day); }
        else {
          run = { person: pid, from: m.day, to: m.day, note: m.note || '', days: [m.day] };
          out.push(run);
        }
      });
    });
    return out.sort(function (a, b) {
      return a.from < b.from ? -1 : a.from > b.from ? 1 : String(a.person).localeCompare(String(b.person));
    });
  }

  /* A person's name is what everything else hangs off, so it has to be there;
     a role is a convenience and may be blank. */
  function cleanPerson(p) {
    var name = s(p && p.name);
    if (!name) return null;
    return { id: s(p.id) || ('P' + Date.now() + Math.random().toString(36).slice(2, 6)),
             name: name, role: s(p && p.role), sort: Number(p && p.sort) || 0 };
  }
  /* ---- a photograph's place, by name ----

     A record carries 'lat, lng' and nothing else. A name for that spot is a
     separate fact, kept in attend_sites, so this measures rather than guesses:
     the nearest site inside its own radius wins, and when nothing is near
     enough the answer is no name at all. Somebody clocking in from a site
     nobody has written down should see coordinates, not the wrong village.

     Equirectangular rather than haversine - at a few hundred metres the
     difference is centimetres, and this runs once per row on screen. */
  function parseGeo(g) {
    var m = String(g || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
  }
  function metresBetween(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var x = (b.lng - a.lng) * rad * Math.cos((a.lat + b.lat) / 2 * rad);
    var y = (b.lat - a.lat) * rad;
    return Math.sqrt(x * x + y * y) * R;
  }
  function placeOf(geo, sites) {
    var p = parseGeo(geo);
    if (!p || !sites || !sites.length) return '';
    var best = null, bestD = Infinity;
    sites.forEach(function (s) {
      if (s.lat == null || s.lng == null) return;
      var d = metresBetween(p, { lat: s.lat, lng: s.lng });
      if (d < bestD) { bestD = d; best = s; }
    });
    return best && bestD <= (best.radius_m || 400) ? best.name : '';
  }

  function sortPeople(people) {
    return (people || []).slice().sort(function (a, b) {
      return (a.sort - b.sort) || String(a.name).localeCompare(String(b.name));
    });
  }

  return {
    pad: pad, dstr: dstr, hm: hm, minsOf: minsOf, fmt: fmt,
    lateAfter: lateAfter, refFor: refFor, ofDay: ofDay,
    buildSheet: buildSheet, groupSheet: groupSheet, stats: stats, dateOpts: dateOpts,
    deviceState: deviceState, hoursBetween: hoursBetween,
    toggleMember: toggleMember, exportRows: exportRows,
    monthDays: monthDays, monthEnd: monthEnd, monthStart: monthStart,
    monthLabel: monthLabel, weekdayOf: weekdayOf,
    nextDay: nextDay, dayRange: dayRange, groupLeave: groupLeave,
    dayCode: dayCode, monthSheets: monthSheets,
    parseGeo: parseGeo, metresBetween: metresBetween, placeOf: placeOf,
    daysWithRecords: daysWithRecords, holidayOn: holidayOn,
    weekOf: weekOf, rangeLabel: rangeLabel, rangeSheets: rangeSheets,
    rangeTeamRows: rangeTeamRows, rangePersonRows: rangePersonRows,
    monthTeamRows: monthTeamRows, monthPersonRows: monthPersonRows,
    cleanPerson: cleanPerson, sortPeople: sortPeople
  };
}));
