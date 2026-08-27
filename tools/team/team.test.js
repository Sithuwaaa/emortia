/* team.test.js - what the directory works out.

     node tools/team/team.test.js
*/

const T = require('./team.js');

let pass = 0, fail = 0;
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(54) + show(got) + (ok ? '' : '   want ' + show(want)));
}

/* A stand-in for the real thing, shaped the same way and invented throughout.

   Nobody here is a real person. Test fixtures are committed, this repository
   is public and GitHub Pages serves it, so a fixture built out of the actual
   directory would publish the mobile numbers and NIC numbers that the whole
   design exists to keep off the disk - see supabase/012_team.sql. The shapes
   that matter are kept: the two NIC formats, one malformed, one person filed
   in two teams, an undriven vehicle, and a member with no role. */
const CO = 'Tooway Solutions (Pvt) Ltd';
const TEAMS = [
  { id:'inhouse', team:'Inhouse', source:'sheet',
    people:[
      { id:'p1', name:'Ayomi Ranasinghe', mobile:'0700000011', nic:'700000011V',   role:'TL',     company:CO },
      { id:'p2', name:'Buddhi Weeratunga', mobile:'0700000012', nic:'900000012V',  role:'SE',     company:CO },
      { id:'p3', name:'Chandana Ekanayake', mobile:'0700000013', nic:'800000013V', role:'DRIVER', company:CO }],
    vehicles:[ { id:'v1', reg:'AA-1111', kind:'Crew Cab', driver:'Chandana' } ] },
  { id:'lucky', team:'Lucky', source:'sheet',
    people:[
      { id:'p4', name:'Dilshan Wickrama', mobile:'0700000024', nic:'200000000024', role:'MEMBER', company:CO }],
    vehicles:[ { id:'v2', reg:'BB-2222', kind:'Crew Cab', driver:'' } ] },
  { id:'manoj', team:'Manoj', source:'sheet',
    people:[
      /* the same driver, filed in two teams - that is normal and not a fault */
      { id:'p5', name:'Chandana Ekanayake', mobile:'0700000013', nic:'800000013V', role:'', company:CO }],
    vehicles:[] }
];

console.log('\nhow many of what');
{
  is('five people, three teams, two vehicles', T.counts(TEAMS), { teams:3, people:5, vehicles:2 });
  is('nothing at all counts to nothing',       T.counts([]),    { teams:0, people:0, vehicles:0 });
  is('and so does no list',                    T.counts(null),  { teams:0, people:0, vehicles:0 });
  is('every person carries their team',
     T.pools(TEAMS).people.map(p => p.team), ['Inhouse','Inhouse','Inhouse','Lucky','Manoj']);
}

console.log('\nthe number, and where it is going');
{
  is('at home it is left alone',       T.phone('0700000011'), '0700000011');
  is('abroad the zero comes off',      T.phone('0700000011', true), '+94700000011');
  /* keeping the 0 would give +940700000011, which dials nothing */
  is('and is not merely prefixed',     T.phone('0700000011', true).indexOf('+940'), -1);
  is('one already in full is left',    T.phone('+94700000011', true), '+94700000011');
  is('nothing stays nothing',          T.phone('', true), '');
  is('and so does no number at all',   T.phone(null, true), '');
}

console.log('\nwhat a copied row says');
{
  const p = TEAMS[0].people[0];
  is('tabs for a spreadsheet',
     T.rowText(p, { format:'tab' }), 'Ayomi Ranasinghe\t0700000011\t700000011V');
  is('the company too when asked',
     T.rowText(p, { format:'tab', company:true }),
     'Ayomi Ranasinghe\t0700000011\t700000011V\tTooway Solutions (Pvt) Ltd');
  is('commas for a CSV',
     T.rowText(p, { format:'comma' }), 'Ayomi Ranasinghe, 0700000011, 700000011V');
  /* a tab pasted into WhatsApp collapses, so the message form uses dashes */
  is('dashes for a message',
     T.rowText(p, { format:'dash' }), 'Ayomi Ranasinghe – 0700000011 – 700000011V');
  is('the number on its own',          T.rowText(p, { format:'phone' }), '0700000011');
  is('and abroad, on its own',         T.rowText(p, { format:'phone', intl:true }), '+94700000011');
  is('an unknown format falls to tabs',
     T.rowText(p, { format:'nope' }).indexOf('\t') > -1, true);
  /* a missing NIC must not leave a dangling separator on the end */
  is('a gap does not leave a stray tab',
     T.rowText({ name:'X', mobile:'077', nic:'' }, { format:'tab' }), 'X\t077');
  is('a vehicle reads across the same way',
     T.vehicleText(TEAMS[0].vehicles[0], { format:'comma' }), 'AA-1111, Crew Cab, Chandana');
  is('an undriven one does not trail',
     T.vehicleText(TEAMS[1].vehicles[0], { format:'comma' }), 'BB-2222, Crew Cab');
  is('a whole list comes out one to a line',
     T.sheet(TEAMS[0].people, T.rowText, { format:'phone' }).split('\n'),
     ['0700000011','0700000012','0700000013']);
  is('four ways out, each with a reason',
     T.FORMATS.every(f => f.name && f.note && f.note.length > 12), true);
}

console.log('\nfinding somebody');
{
  const v = q => T.view(TEAMS, 'ALL', q).people.map(p => p.name);
  is('by name',            v('buddhi'), ['Buddhi Weeratunga']);
  is('by part of a name',  v('wickra'),    ['Dilshan Wickrama']);
  is('by mobile',          v('0700000024'), ['Dilshan Wickrama']);
  /* a number read off a phone screen arrives with spaces in it */
  is('by a spaced mobile', v('070 000 0024'), ['Dilshan Wickrama']);
  is('by NIC',             v('900000012V'),  ['Buddhi Weeratunga']);
  /* the company is the same on every row, and "...pvtltd" contains "tl" -
     searching it matched everybody, so it is not searched */
  is('by role',            v('TL'),          ['Ayomi Ranasinghe']);
  /* both words have to land, and not necessarily on the same field - this is
     the way somebody actually looks for a person they half remember */
  is('team and name together', v('lucky dilshan'), ['Dilshan Wickrama']);
  is('and the wrong pairing finds nobody', v('lucky buddhi'), []);
  is('case does not matter',   v('BUDDHI'), ['Buddhi Weeratunga']);
  is('nobody matches nonsense', v('zzzz'), []);
  is('an empty search is everybody', v('').length, 5);

  is('a team on its own is that team',
     T.view(TEAMS, 'lucky', '').people.map(p => p.name), ['Dilshan Wickrama']);
  /* searching has to cross teams even from inside one, or the answer hides
     exactly when the person turns out to be filed somewhere else */
  is('but a search from inside one still crosses them',
     T.view(TEAMS, 'lucky', 'buddhi').people.map(p => p.name), ['Buddhi Weeratunga']);
  is('and says it is a search',  T.view(TEAMS, 'lucky', 'x').scope, 'search');
  is('a vehicle is found by its driver',
     T.view(TEAMS, 'ALL', 'chandana').vehicles.map(v2 => v2.reg), ['AA-1111']);
  is('and a team view brings its own',
     T.view(TEAMS, 'manoj', '').vehicles, []);
}

console.log('\nnaming a new team');
{
  const taken = TEAMS.map(t => t.id);
  is('a plain name slugs plainly',  T.slug('Wasantha', taken), 'wasantha');
  is('spaces and case go',          T.slug('New  Team B', taken), 'new-team-b');
  is('punctuation goes too',        T.slug('Janaka (2)', taken), 'janaka-2');
  /* a second Lucky must not quietly become the first Lucky and swallow it */
  is('a name already used is suffixed', T.slug('Lucky', taken), 'lucky-2');
  is('and again after that',        T.slug('Lucky', taken.concat(['lucky-2'])), 'lucky-3');
  is('a name of pure punctuation still gets one', T.slug('///', taken), 'team');
  is('and nothing at all does too', T.slug('', taken), 'team');
}

console.log('\nwhether an ID number looks like one');
{
  is('the old shape passes',        T.nicNote('700000011V'), '');
  is('the X ending too',            T.nicNote('123456789X'), '');
  is('lower case is still fine',    T.nicNote('800000013v'), '');
  is('the new twelve digits pass',  T.nicNote('200000000024'), '');
  /* one row in the real sheet carries thirteen digits - this is that shape */
  is('thirteen digits is flagged',  T.nicNote('1000000000024'), 'Too long for an NIC (13 digits)');
  is('nine bare digits are flagged', T.nicNote('700000011'), 'Nine digits with no V or X');
  is('rubbish is flagged',          T.nicNote('hello'), 'Not an NIC shape');
  is('and an empty one says so',    T.nicNote(''), 'No ID number');
  /* it marks and never refuses: the sheet is the record, not this tool */
  is('nothing here rejects a person',
     T.checkPerson({ name:'X', teamId:'inhouse', nic:'nonsense' }), '');

  is('two spellings are one number',
     T.nicKey('800000013v'), T.nicKey('800000013V'));
  /* the same driver in two teams is normal and must not be reported */
  is('the same person in two teams is fine', T.duplicates(TEAMS), []);
  const twice = [{ id:'t', team:'T', people:[
    { name:'A', nic:'700000011V' }, { name:'A again', nic:'700000011v' }], vehicles:[] }];
  is('the same number twice in one team is not',
     T.duplicates(twice).map(d => d.name), ['A again']);
  is('and it says who it clashes with', T.duplicates(twice)[0].first, 'A');
}

console.log('\nwhat a form insists on');
{
  is('a person needs a name',    T.checkPerson({ teamId:'inhouse' }), 'A name, please.');
  is('and a team',               T.checkPerson({ name:'X' }), 'Pick a team.');
  is('a name and a team is enough',
     T.checkPerson({ name:'X', teamId:'inhouse' }), '');
  is('a mobile of letters is refused',
     T.checkPerson({ name:'X', teamId:'inhouse', mobile:'ring me' }),
     'That does not look like a mobile number.');
  is('but a spaced one is not',
     T.checkPerson({ name:'X', teamId:'inhouse', mobile:'070 000 0013' }), '');
  is('a vehicle needs its number', T.checkVehicle({ teamId:'inhouse' }), 'A vehicle number, please.');
  is('and a team as well',         T.checkVehicle({ reg:'LK-1' }), 'Pick a team.');
  is('a team needs a name',        T.checkTeam({}, TEAMS), 'A team name, please.');
  is('and must not already exist',
     T.checkTeam({ name:'lucky' }, TEAMS), 'There is already a team called lucky.');
  is('a new one is allowed',       T.checkTeam({ name:'Wasantha' }, TEAMS), '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
