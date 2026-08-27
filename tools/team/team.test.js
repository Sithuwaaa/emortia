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

console.log('\nwhat a copied row says');
{
  const p = TEAMS[0].people[0];
  is('the sheet\'s own columns, in its own order',
     T.COLUMNS, ['Name','Mobile Number','ID No','Company Name','Role']);
  is('a row is those five, tab separated',
     T.rowText(p),
     'Ayomi Ranasinghe\t0700000011\t700000011V\tTooway Solutions (Pvt) Ltd\tTL');
  /* A gap must stay a gap. Dropping the empty NIC would slide the company
     left into the ID column, and a paste back into the workbook would file
     somebody's employer as their identity card. */
  is('a missing value leaves its cell empty',
     T.rowText({ name:'X', mobile:'077', nic:'', company:'Co', role:'' }), 'X\t077\t\tCo\t');
  is('and every row has the same number of cells',
     T.pools(TEAMS).people.every(x => T.rowText(x).split('\t').length === 5), true);
  is('the heading line matches the columns',
     T.headerText(), 'Name\tMobile Number\tID No\tCompany Name\tRole');
  is('a vehicle reads across the same way',
     T.vehicleText(TEAMS[0].vehicles[0]), 'AA-1111\tCrew Cab\tChandana');
  is('an undriven one still keeps its cell',
     T.vehicleText(TEAMS[1].vehicles[0]), 'BB-2222\tCrew Cab\t');
  is('a whole list comes out one to a line',
     T.sheet(TEAMS[0].people, T.rowText).split('\n').map(l => l.split('\t')[0]),
     ['Ayomi Ranasinghe','Buddhi Weeratunga','Chandana Ekanayake']);
  is('the number is left exactly as filed', T.phone('0700000011'), '0700000011');
  is('and nothing stays nothing',           T.phone(null), '');
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

console.log('\nreading a workbook');
{
  /* One sheet per team, the tab named after the team - which is how the
     office actually keeps it. Row 1 is the heading; column E carries the role
     with no heading at all, exactly as on the real sheet. */
  const H = ['Name','Mobile  Number','ID No','Company Name',''];
  const BOOK = [
    { name:'Inhouse', rows:[ H,
      ['Ayomi Ranasinghe','0700000011','700000011V','Tooway Solutions (Pvt) Ltd','TL'],
      ['Buddhi Weeratunga','0700000012','900000012V','Tooway Solutions (Pvt) Ltd','SE'] ]},
    { name:'Lucky', rows:[ H,
      ['Dilshan Wickrama','0700000024','200000000024','Tooway Solutions (Pvt) Ltd','MEMBER'] ]}
  ];
  const r = T.readWorkbook(BOOK);
  is('a tab per team, named for the team',   r.teams.map(t => t.team), ['Inhouse','Lucky']);
  is('and slugged the same way as the rest', r.teams.map(t => t.id), ['inhouse','lucky']);
  is('everybody on their own tab',           r.teams.map(t => t.people.length), [2, 1]);
  is('the columns land where they should',
     r.teams[0].people[0],
     { name:'Ayomi Ranasinghe', mobile:'0700000011', nic:'700000011V',
       company:'Tooway Solutions (Pvt) Ltd', role:'TL' });
  /* the double space in "Mobile  Number" is on the real sheet */
  is('a heading with odd spacing still matches', r.teams[0].people[0].mobile, '0700000011');
  /* sixteen team tabs share one layout, so this is said once and not
     sixteen times */
  is('the unlabelled column is read as the role, and said so once',
     r.warnings.filter(w => /Column E/.test(w)).length, 1);

  /* the headings are not always on row 1 */
  const LATE = [{ name:'Amal', rows:[
    ['All Team Details', '', ''], [], ['Name','Mobile Number','ID No'],
    ['Chandana Ekanayake','0700000013','800000013V'] ]}];
  is('a banner above the table does not fool it',
     T.readWorkbook(LATE).teams[0].people.map(p => p.name), ['Chandana Ekanayake']);

  /* a Team column, if the sheet happens to carry one, beats the tab name */
  const MIXED = [{ name:'Sheet1', rows:[
    ['Team','Name','Mobile Number'], ['Manoj','Someone','0700000099'] ]}];
  is('a Team column wins over the tab name',
     T.readWorkbook(MIXED).teams.map(t => t.team), ['Manoj']);

  is('a sheet with no Name column is skipped and said so',
     T.readWorkbook([{ name:'Notes', rows:[['just','some','text']] }]).warnings.length, 1);
  is('and an empty workbook is simply empty',
     T.readWorkbook([]).teams, []);
  is('column letters read the way Excel writes them',
     [0, 4, 25, 26].map(T.colName), ['A','E','Z','AA']);
}

console.log('\nwhat an upload would actually change');
{
  const sheetOf = people => [{ id:'inhouse', team:'Inhouse', people, vehicles:[] }];
  const A = { name:'Ayomi Ranasinghe', mobile:'0700000011', nic:'700000011V',
              company:'Tooway Solutions (Pvt) Ltd', role:'TL' };
  const B = { name:'Buddhi Weeratunga', mobile:'0700000012', nic:'900000012V',
              company:'Tooway Solutions (Pvt) Ltd', role:'SE' };
  const HAVE = [{ id:'inhouse', team:'Inhouse',
    people:[Object.assign({ id:'p1' }, A), Object.assign({ id:'p2' }, B)], vehicles:[] }];

  /* the whole point: the same sheet a second time moves nothing */
  const again = T.planImport(sheetOf([A, B]), HAVE);
  is('the same sheet twice writes nothing', again.counts.writes, 0);
  is('and says so plainly',  T.planSummary(again),
     'Nothing has changed – all 2 rows already match.');

  /* one number corrected: one row moves, the other does not */
  const fixed = T.planImport(sheetOf([A, Object.assign({}, B, { mobile:'0700000099' })]), HAVE);
  is('one corrected number is one write', fixed.counts, {
    teams:0, add:0, update:1, same:1, addV:0, updateV:0, sameV:0, missing:0, writes:1 });
  is('and it keeps the row it was',       fixed.update[0].id, 'p2');
  is('and says what it is overwriting',
     T.changesOn(fixed.update[0]), [{ field:'mobile', from:'0700000012', to:'0700000099' }]);

  /* a person is recognised by NIC, so a name spelt differently on the second
     sheet is an edit rather than a stranger */
  const renamed = T.planImport(sheetOf([A, Object.assign({}, B, { name:'B. Weeratunga' })]), HAVE);
  is('a respelt name is the same person', renamed.counts.add, 0);
  is('and shows as a change of name',
     T.changesOn(renamed.update[0]).map(c => c.field), ['name']);

  const added = T.planImport(sheetOf([A, B, { name:'New Person', mobile:'0700000077',
    nic:'770000077V', company:'Tooway Solutions (Pvt) Ltd', role:'MEMBER' }]), HAVE);
  is('somebody new is one insert',        added.counts.add, 1);
  is('a whole new team comes with them',
     T.planImport([{ id:'kamal', team:'Kamal', people:[A], vehicles:[] }], HAVE).counts.teams, 1);

  /* Nothing is ever deleted by an import. A sheet for one team must not be
     able to empty the other fifteen, and even inside the team it covers, a
     row it does not mention is reported rather than removed. */
  const short = T.planImport(sheetOf([A]), HAVE);
  is('a row the sheet omits is reported',  short.missing.map(m => m.name), ['Buddhi Weeratunga']);
  is('and is not counted as a write',      short.counts.writes, 0);
  const other = [{ id:'lucky', team:'Lucky', people:[Object.assign({ id:'p9' }, A)], vehicles:[] }];
  is('a team the sheet never mentions is left entirely alone',
     T.planImport(sheetOf([A, B]), HAVE.concat(other)).missing, []);

  /* the same driver filed under two teams is two rows, not one */
  is('identity is scoped to the team',
     T.identity('inhouse', A) === T.identity('lucky', A), false);
  /* and a fingerprint has to notice every field it covers */
  is('a changed role is a changed row',
     T.fingerprint(A) === T.fingerprint(Object.assign({}, A, { role:'PM' })), false);
  is('a changed company too',
     T.fingerprint(A) === T.fingerprint(Object.assign({}, A, { company:'Other' })), false);
  is('but the id and sort order are not part of it',
     T.fingerprint(A), T.fingerprint(Object.assign({ id:'zzz', sort:9 }, A)));

  is('the summary reads as a sentence',
     T.planSummary(added), '1 new member, and 2 already right.');

  /* A team's id was minted at some point in the past and need not be what
     slug() would produce today - the real directory carries "janaka-2-" where
     this would now say "janaka-2". Matching on the id alone made that team,
     and all three people in it, look brand new on every single upload. */
  const OLD = [{ id:'janaka-2-', team:'Janaka (2)',
                 people:[Object.assign({ id:'q1' }, A)], vehicles:[] }];
  const bySlug = [{ id:T.slug('Janaka (2)', []), team:'Janaka (2)', people:[A], vehicles:[] }];
  is('a team is matched by its name, not only its id',
     T.planImport(bySlug, OLD).counts, { teams:0, add:0, update:0, same:1, addV:0,
                                         updateV:0, sameV:0, missing:0, writes:0 });
  is('and the id it already had is the one kept',
     T.planImport([{ id:'janaka-2', team:'Janaka (2)',
                     people:[A, { name:'Someone New', mobile:'0700000055', nic:'550000055V' }],
                     vehicles:[] }], OLD).add[0].teamId, 'janaka-2-');

  /* A workbook of people says nothing at all about vehicles. Reporting every
     van in the directory as missing from a sheet that never had a vehicle
     column is noise, and noise next to the word "missing" is worse than noise. */
  const WITHVANS = [{ id:'inhouse', team:'Inhouse',
    people:[Object.assign({ id:'p1' }, A)],
    vehicles:[{ id:'v1', reg:'AA-1111', kind:'Crew Cab', driver:'' }] }];
  is('a people-only sheet does not report the vans as missing',
     T.planImport(sheetOf([A]), WITHVANS).missing, []);
  is('but a sheet that does carry vehicles still reports one it drops',
     T.planImport([{ id:'inhouse', team:'Inhouse', people:[A],
                     vehicles:[{ reg:'ZZ-9999' }] }], WITHVANS)
       .missing.map(m => m.name), ['AA-1111']);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
