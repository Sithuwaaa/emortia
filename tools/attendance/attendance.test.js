/* attendance.test.js - what the day adds up to.

     node tools/attendance/attendance.test.js

   Invented names and invented coordinates. The real roster and the real
   photographs live in Supabase; this repository is public.
*/

const A = require('./attendance.js');

let pass = 0, fail = 0;
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(52) + show(got) + (ok ? '' : '   want ' + show(want)));
}

/* A fixed day, built from local times so the test reads the way the sheet
   does. Month is zero-based in the Date constructor; 4 is May. */
const at = (h, m) => new Date(2026, 4, 12, h, m, 0).getTime();
const DAY = '2026-05-12';

const PEOPLE = [
  { id:'p1', name:'Nimal', role:'Rigger',  sort:1 },
  { id:'p2', name:'Kasun', role:'Driver',  sort:2 },
  { id:'p3', name:'Ajith', role:'Rigger',  sort:3 },
  { id:'p4', name:'Sunil', role:'Helper',  sort:4 }
];

const RECS = [
  { id:'u1', date:DAY, kind:'in',  ts:at(8,25), geo:'6.9271, 79.8612', members:['p1','p2'] },
  { id:'u2', date:DAY, kind:'in',  ts:at(9,10), geo:'6.9271, 79.8612', members:['p3'] },
  { id:'u3', date:DAY, kind:'out', ts:at(17,5), geo:'6.9280, 79.8600', members:['p1','p3'] }
];

const LATE = A.lateAfter('08:30', 15);            // 08:45

console.log('\nthe clock');
{
  is('minutes into the day',        A.minsOf(at(8,25)), 505);
  is('and back out as a time',      A.hm(505), '08:25');
  is('a timestamp reads as a time', A.fmt(at(17,5)), '17:05');
  is('and nothing reads as a dash', A.fmt(null), '—');
  is('late is the start plus grace', A.hm(LATE), '08:45');
  is('a missing setting still answers', A.hm(A.lateAfter()), '08:45');
  is('and so does a broken one',    A.hm(A.lateAfter('nonsense', 'x')), '08:45');
}

console.log('\nthe day the sheet is built from');
{
  is('only that date counts',       A.ofDay(RECS.concat([{date:'2026-05-11',kind:'in',ts:1,members:[]}]), DAY).length, 3);
  is('a reference is quotable',     A.refFor(DAY, 1747000001234), 'A20260512-1234');
}

console.log('\nthe sheet');
{
  const sheet = A.buildSheet(PEOPLE, RECS, DAY, LATE);
  is('one row per person on the roster, present or not', sheet.length, 4);

  const nimal = sheet.find(r => r.id === 'p1');
  is('in at the photo he is in',    nimal.in, '08:25');
  is('out at the photo he is in',   nimal.out, '17:05');
  is('before the grace runs out is on time', nimal.status, 'On time');
  is('the hours are the difference', nimal.hours, '8.67');
  is('and the location came off the photo', nimal.inGeo, '6.9271, 79.8612');

  const ajith = sheet.find(r => r.id === 'p3');
  is('after it is late',            [ajith.in, ajith.status, ajith.late], ['09:10','Late',true]);

  /* clocked in, no photo out: the day is not closed and the hours are not a
     number yet - half a day is not a duration */
  const kasun = sheet.find(r => r.id === 'p2');
  is('in but not out says so',      kasun.status, 'On time · in');
  is('and has no hours',            [kasun.out, kasun.hours, kasun.closed], ['—','—',false]);

  /* the useful half of an attendance sheet is who did not come */
  const sunil = sheet.find(r => r.id === 'p4');
  is('a name in no photo is absent', [sunil.status, sunil.present, sunil.in], ['Absent', false, '—']);
}

console.log('\ntwo photos at the start of one shift');
{
  const twice = RECS.concat([
    { id:'u4', date:DAY, kind:'in', ts:at(8,10), geo:'x', members:['p1'] }
  ]);
  const nimal = A.buildSheet(PEOPLE, twice, DAY, LATE).find(r => r.id === 'p1');
  /* being in either photo is being there, and the earliest is when he arrived */
  is('the earliest clock-in wins',  nimal.in, '08:10');

  const twiceOut = RECS.concat([
    { id:'u5', date:DAY, kind:'out', ts:at(18,30), geo:'x', members:['p1'] }
  ]);
  const late = A.buildSheet(PEOPLE, twiceOut, DAY, LATE).find(r => r.id === 'p1');
  is('and the latest clock-out',    late.out, '18:30');
}

console.log('\nwhat the four tiles say');
{
  const sheet = A.buildSheet(PEOPLE, RECS, DAY, LATE);
  const st = A.stats(sheet, A.ofDay(RECS, DAY));
  is('photos, names ticked, present, late',
     [st.photos, st.named, st.present + '/' + st.roster, st.late],
     [3, 5, '3/4', 1]);
}

console.log('\nticking a face on and off');
{
  const rec = RECS[0];
  const on = A.toggleMember(rec, 'p4');
  is('a name goes on',              on.members, ['p1','p2','p4']);
  const off = A.toggleMember(on, 'p2');
  is('and comes off again',         off.members, ['p1','p4']);
  /* the record handed in is not touched, so a save that fails leaves the
     screen showing what is actually stored */
  is('the original is left alone',  rec.members, ['p1','p2']);
}

console.log('\nthe device, and the day it remembers');
{
  const now = at(12,0);
  is('nothing filed yet',           A.deviceState(null, now).next, 'in');
  is('clocked in, out is next',     A.deviceState({in:at(8,0), expires:now+1}, now).next, 'out');
  is('both filed, the day is done', A.deviceState({in:at(8,0), out:at(17,0), expires:now+1}, now).done, true);
  /* a phone left on a shelf is ready for tomorrow, not stuck on yesterday */
  is('an expired day is a fresh one', A.deviceState({in:at(8,0), out:at(17,0), expires:now-1}, now),
     {in:null, out:null, next:'in', done:false});
  is('the hours it shows',          A.hoursBetween(at(8,0), at(17,0)), '9.00');
  is('and none until both ends',    A.hoursBetween(at(8,0), null), '');
}

console.log('\nthe roster');
{
  is('a name is required',          A.cleanPerson({ name:'', role:'Rigger' }), null);
  const p = A.cleanPerson({ name:'  Nimal  ', role:' Rigger ' });
  is('and is trimmed',              [p.name, p.role], ['Nimal','Rigger']);
  is('an id is minted if there is none', p.id.length > 3, true);
  is('a role may be blank',         A.cleanPerson({ name:'Kasun' }).role, '');
  is('sort first, then the name',
     A.sortPeople([{name:'Zoe',sort:2},{name:'Ann',sort:2},{name:'Bob',sort:1}]).map(x=>x.name),
     ['Bob','Ann','Zoe']);
}

console.log('\nsomebody on leave');
{
  const LEAVE = [{ day: DAY, person: 'p4', label: 'Leave', note: 'Told me on Friday' }];
  const sheet = A.buildSheet(PEOPLE, RECS, DAY, LATE, LEAVE);
  const sunil = sheet.find(r => r.id === 'p4');
  /* not the same fact as not turning up, and a sheet that calls both Absent is
     wrong about somebody who asked in advance */
  is('a marked day is leave, not absent', [sunil.status, sunil.leave, sunil.present], ['Leave', true, false]);
  is('and the note comes with it',        sunil.note, 'Told me on Friday');
  is('nobody else is touched',            sheet.find(r => r.id === 'p1').status, 'On time');

  /* marked on leave and came in anyway: the photograph is the fact */
  const CAME = [{ day: DAY, person: 'p3', label: 'Leave' }];
  const ajith = A.buildSheet(PEOPLE, RECS, DAY, LATE, CAME).find(r => r.id === 'p3');
  is('a photo outranks the mark',         [ajith.status, ajith.leave], ['Late', false]);

  /* a mark for another day is not this day's business */
  const OTHER = [{ day: '2026-05-11', person: 'p4', label: 'Leave' }];
  is('yesterday\'s leave is not today\'s',
     A.buildSheet(PEOPLE, RECS, DAY, LATE, OTHER).find(r => r.id === 'p4').status, 'Absent');

  const st = A.stats(sheet, A.ofDay(RECS, DAY));
  is('leave is counted apart from absent', [st.present, st.leave, st.absent], [3, 1, 0]);
  const none = A.stats(A.buildSheet(PEOPLE, RECS, DAY, LATE), A.ofDay(RECS, DAY));
  is('and with no marks it is all absent', [none.leave, none.absent], [0, 1]);

  const x = A.exportRows(sheet, DAY, LATE);
  is('the export note says both',         /1 on leave · 0 absent/.test(x.note), true);
}

console.log('\nthe dates on offer');
{
  const opts = A.dateOpts(DAY, 4);
  is('newest first, ten days back',  opts.map(o => o.value),
     ['2026-05-12','2026-05-11','2026-05-10','2026-05-09']);
  is('and today says so',            /^Today · /.test(opts[0].label), true);
}

console.log('\nwhat the export writes');
{
  const sheet = A.buildSheet(PEOPLE, RECS, DAY, LATE);
  const x = A.exportRows(sheet, DAY, LATE);
  is('a heading row',               x.head.length, 8);
  is('and one row per person',      x.rows.length, 4);
  is('the absent one is in it too', x.rows[3][0], 'Sunil');
  is('the note counts the day',     /3 of 4 present · 1 late/.test(x.note), true);
  is('and says where late begins',  /after 08:45/.test(x.note), true);
}

console.log('\na month of it');
{
  is('every day of May',          A.monthDays('2026-05').length, 31);
  is('and February is short',     A.monthDays('2026-02').length, 28);
  is('a month still running stops at today',
     A.monthDays('2026-05', '2026-05-12').slice(-1), ['2026-05-12']);
  is('a month already over does not',
     A.monthDays('2026-04', '2026-05-12').length, 30);
  is('nonsense is no month',      A.monthDays('bad'), []);

  const sheet = A.buildSheet(PEOPLE, RECS, DAY, LATE);
  const by = id => sheet.filter(r => r.id === id)[0];
  is('on time and closed is P',   A.dayCode(by('p1')), 'P');
  is('late and closed is L',      A.dayCode(by('p3')), 'L');
  is('in but not out is dotted',  A.dayCode(by('p2')), 'P·');
  is('nobody is A',               A.dayCode(by('p4')), 'A');
  is('on leave is LV',
     A.dayCode(A.buildSheet(PEOPLE, RECS, DAY, LATE,
       [{ day:DAY, person:'p4', label:'Leave', note:'' }]).filter(r => r.id === 'p4')[0]), 'LV');
}

console.log('\nthe team, a month across');
{
  const leave = [{ day:DAY, person:'p4', label:'Leave', note:'Told me on Friday' }];
  const x = A.monthTeamRows(PEOPLE, RECS, leave, '2026-05', LATE, '2026-05-12');
  is('a column per day so far, plus both ends', x.head.length, 2 + 12 + 5);
  is('the first day column is 1',   x.head[2], '1');
  is('and the last is the 12th',    x.head[13], '12');
  is('a row per person',            x.rows.length, 4);
  /* the 12th is the 12th column of days: 2 name columns + 11 earlier days */
  is('Nimal was there that day',    x.rows[0][13], 'P');
  is('Ajith was late',              x.rows[2][13], 'L');
  is('Sunil was on leave',          x.rows[3][13], 'LV');
  is('Nimal: one day present',      x.rows[0].slice(-5), [1, 0, 0, 11, 8.67]);
  is('Sunil: one on leave, no hours', x.rows[3].slice(-5), [0, 0, 1, 11, 0]);
  is('Kasun has no hours, being still in', x.rows[1].slice(-1), [0]);
  is('the legend explains the dot', /a dot means no clock-out/.test(x.note), true);
  is('nothing before the month leaks in',
     A.monthTeamRows(PEOPLE, RECS, [], '2026-04', LATE, '2026-05-12').rows[0][2], 'A');
}

console.log('\none person, a month down');
{
  const leave = [{ day:'2026-05-11', person:'p1', label:'Leave', note:'Wedding' }];
  const x = A.monthPersonRows(PEOPLE[0], RECS, leave, '2026-05', LATE, '2026-05-12');
  is('a row per day, a gap and a total', x.rows.length, 12 + 2);
  is('the day he worked',           x.rows[11].slice(0, 3), ['2026-05-12', A.weekdayOf('2026-05-12'), '08:25']);
  is('the day before he was off',   x.rows[10][7], 'Leave');
  is('and the note came with it',   x.rows[10][8], 'Wedding');
  is('the total is his hours',      x.rows[13][6], 8.67);
  is('and counts the month',        x.rows[13][7], '1 present · 0 late · 1 on leave · 10 absent');
  is('his name is on it',           /Nimal/.test(x.title), true);
  is('and his role',                /^Rigger · /.test(x.note), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
