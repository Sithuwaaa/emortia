/* config.test.js - what the field reference works out.

     node tools/field-config/config.test.js
*/

const C = require('./config.js');

let pass = 0, fail = 0;
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(52) + show(got) + (ok ? '' : '   want ' + show(want)));
}

/* Shaped like the real document and invented throughout. The real one holds
   the UMPT passwords and the LMT logins; test fixtures are committed and this
   repository is public, so none of the actual values are in here. */
const DOC = [
  { id:'huawei', name:'Huawei', sub:'MW + BBU', groups:[
    { id:'hw-bbu', name:'BBU (UMPT)', sections:[
      { title:'Logging in', kicker:'LMT / FTP', kvs:[
        { k:'LAP IP', v:'10.0.0.1' },
        { k:'FTP user name', v:'operator' }]},
      { title:'UMPT passwords', kicker:'try in order',
        chips:['ExamplePass@1','ExamplePass@2','ExamplePass@3'] },
      { title:'Check commands', kicker:'DSP / LST', cmds:[
        { label:'RRU serial number', cmd:'DSP BRDMFRINFO: CN=0, SRN=70, SN=0;' },
        { label:'Cell details', cmd:'DSP CELL' }]},
      { title:'VLANs', kicker:'transport', kvs:[
        { k:'1250', v:'GSM' }, { k:'1800', v:'4G' }]}
    ]},
    { id:'hw-mw', name:'MW (RTN)', sections:[
      { title:'Reference documents', kicker:'RTN 905',
        notes:['Kept as-is until the written steps are added.'],
        docs:[{ name:'RTN 905 Presentation', kind:'PDF', href:'#rtn905' }]}
    ]}
  ]},
  { id:'ericsson', name:'Ericsson', sub:'Baseband', groups:[
    { id:'er-bb', name:'Baseband', sections:[
      { title:'Moshell session', kicker:'Cygwin',
        steps:[{ n:'01', t:'Run Cygwin Terminal as administrator.' },
               { n:'02', t:'Run moshell and log in.' }],
        cmds:[{ label:'Start Moshell', cmd:'moshell 169.254.2.2' },
              { label:'Ping check', cmd:'mcc Router=vr_OAM ping', note:'two packets is enough' }]}
    ]}
  ]}
];

console.log('\nhow much is in it');
{
  is('vendors, groups and entries', C.totals(DOC), { vendors:2, groups:3, entries:15 });
  is('an empty document counts to nothing', C.totals([]), { vendors:0, groups:0, entries:0 });
  is('and so does no document at all',      C.totals(null), { vendors:0, groups:0, entries:0 });
  is('a section counts every kind it holds',
     C.countSection(DOC[0].groups[0].sections[0]), 2);
  /* notes are counted too - a documents-only section is not empty */
  is('a group adds its sections up', C.countGroup(DOC[0].groups[1]), 2);
  is('a vendor adds its groups up',  C.countVendor(DOC[0]), 11);   // 9 in the BBU group, 2 in the MW one
}

console.log('\nwhat a row says for the purpose of finding it');
{
  is('a command reads as label, command and note',
     C.textOf({ label:'Ping check', cmd:'mcc ping', note:'twice' }), 'ping check mcc ping twice');
  is('a key/value reads as both halves', C.textOf({ k:'1250', v:'GSM' }), '1250 gsm');
  is('a plain string is itself',         C.textOf('ExamplePass@1'), 'examplepass@1');
  is('nothing reads as nothing',         C.textOf(null), '');
  is('every word has to land',           C.hit('moshell cygwin terminal', 'cygwin moshell'), true);
  is('and one that does not sinks it',   C.hit('moshell cygwin', 'cygwin ericsson'), false);
  is('an empty search matches anything', C.hit('whatever', ''), true);
}

console.log('\nlooking something up');
{
  const v = q => C.view(DOC, 'huawei', 'hw-bbu', q);

  is('no search gives the group you picked',
     v('').sections.map(s => s.title),
     ['Logging in','UMPT passwords','Check commands','VLANs']);
  is('and says so',                    v('').scope, 'group');

  /* a search crosses vendors - the thing you half remember is usually filed
     under one you were not looking at */
  is('a search crosses every vendor',
     v('moshell').sections.map(s => s.where), ['Ericsson · Baseband']);
  is('and says it is a search',        v('moshell').scope, 'search');

  /* asking for the passwords should hand over the whole list, not the one
     chip that happens to contain the word */
  is('a title match brings the whole section',
     v('passwords').sections[0].chips.length, 3);
  is('a value match brings only what matched',
     v('DSP CELL').sections[0].cmds.map(c => c.label), ['Cell details']);
  /* somebody in a cabinet remembers the label, not the command */
  is('a command is found by what it is for',
     v('serial number').sections[0].cmds.map(c => c.cmd),
     ['DSP BRDMFRINFO: CN=0, SRN=70, SN=0;']);
  is('two words across a vendor and a section',
     v('huawei vlan').sections.map(s => s.title), ['VLANs']);
  is('nothing matches nonsense',       v('zzzz').sections, []);

  is('the vendor tabs know which is on',
     v('').vendors.map(x => x.name + (x.on ? '*' : '')), ['Huawei*','Ericsson']);
  is('and carry their own totals',
     v('').vendors.map(x => x.entries), [11, 4]);
  is('the group tabs too',
     v('').groups.map(x => x.name + (x.on ? '*' : '')), ['BBU (UMPT)*','MW (RTN)']);

  /* an unknown vendor or group must land somewhere rather than blank */
  is('an unknown vendor falls to the first',
     C.view(DOC, 'nope', 'nope', '').vendorName, 'Huawei');
  is('an unknown group falls to the first',
     C.view(DOC, 'huawei', 'nope', '').groupName, 'BBU (UMPT)');
  is('an empty document says it is empty', C.view([], 'x', 'y', '').scope, 'empty');

  /* ZTE has a tab before it has any content. An empty vendor has to be a
     place you can stand rather than something that breaks on the way in. */
  const WITHZTE = DOC.concat([{ id:'zte', name:'ZTE', sub:'nothing filed yet', groups:[] }]);
  const z = C.view(WITHZTE, 'zte', '', '');
  is('an empty vendor still opens',        z.vendorName, 'ZTE');
  is('with no groups and no sections',     [z.groups.length, z.sections.length], [0, 0]);
  is('and does not claim to be a group',   z.groupName, '');
  is('it counts as a vendor and nothing else',
     C.totals(WITHZTE), { vendors:3, groups:3, entries:15 });
  is('its tab shows zero',
     z.vendors.filter(x => x.id === 'zte')[0].entries, 0);
  is('an empty vendor is not a broken document', C.check(WITHZTE), []);
  /* and it must not swallow a search that has nothing to do with it */
  is('searching from it still crosses the others',
     C.view(WITHZTE, 'zte', '', 'moshell').sections.map(s => s.where), ['Ericsson · Baseband']);

  /* a section of nothing but notes is not a search hit - the notes describe
     the things around them and on their own answer nothing */
  is('notes alone do not make a hit',
     C.filterSection({ title:'X', notes:['a note about vlan'] }, 'vlan', ''), null);
}

console.log('\nwhat comes out on a click');
{
  const cmd = { label:'Start Moshell', cmd:'moshell 169.254.2.2' };
  /* the label must not travel with it - this is going straight into an LMT
     window, where anything extra is a syntax error */
  is('a command copies as the command', C.copyText('cmds', cmd), 'moshell 169.254.2.2');
  is('a key/value copies the value',    C.copyText('kvs', { k:'LAP IP', v:'10.0.0.1' }), '10.0.0.1');
  is('a chip copies itself',            C.copyText('chips', 'ExamplePass@1'), 'ExamplePass@1');
  is('a step copies its words',         C.copyText('steps', { n:'01', t:'Run Cygwin.' }), 'Run Cygwin.');
  is('an unknown kind copies nothing',  C.copyText('images', {}), '');

  const whole = C.sectionText(DOC[1].groups[0].sections[0]);
  is('a whole section keeps the order',
     whole.split('\n').slice(0, 2), ['01  Run Cygwin Terminal as administrator.',
                                     '02  Run moshell and log in.']);
  is('and puts a note under its command',
     whole.indexOf('-- two packets is enough') > whole.indexOf('mcc Router=vr_OAM ping'), true);
  is('with no blank line left hanging',  /\n$/.test(whole), false);
}

console.log('\nwhether the document is usable at all');
{
  is('the real shape passes clean', C.check(DOC), []);
  is('something that is not a list is refused',
     C.check({}), ['The reference should be a list of vendors.']);
  is('a vendor with no id is named',
     C.check([{ name:'X', groups:[] }]), ['vendor 1 (X) has no id.']);
  is('two vendors sharing an id is caught',
     C.check([{ id:'a', name:'A' }, { id:'a', name:'B' }]),
     ['two vendors share the id "a".']);
  is('an empty section is caught',
     C.check([{ id:'a', name:'A', groups:[{ id:'g', name:'G', sections:[{ title:'T' }] }] }]),
     ['vendor 1 (A), group 1, "T" is empty.']);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
