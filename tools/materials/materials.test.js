/* materials.test.js - what the material list works out.

     node tools/materials/materials.test.js

   Every code and description in here is invented. The real list is Dialog's
   and lives in Supabase; this repository is public, and a fixture built from
   the real sheets would publish the thing the tool exists to keep behind a
   sign-in.
*/

const M = require('./materials.js');

let pass = 0, fail = 0;
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(54) + show(got) + (ok ? '' : '   want ' + show(want)));
}

/* the export: one row per material, the same eight columns every time */
const EXPORT = [
  ['Type','Material Description','Material Code','Model','Vendor','Remarks','Category 1','Category 2'],
  ['Antenna','EXM_Panel_Antenna_1800','1000000101','APX-1800','HUA','','Macro',''],
  ['RRU PWR','EXM_PWR_CABLE_10AWG_2CORE','1000000102','Exm DC 10AWG','HUA','','',''],
  ['Radio','EXM_RRU_2100_40W','1000000103','RRU9999','ERIC','','',''],
  ['','','','','','','',''],                       // the blank spacer rows they leave
  ['Fibers','EXM_FOPC_LC/APC_SM_2m','1000000104','','','','','']
];

/* a category sheet: its own columns, its own extra knowledge */
const ANTENNAS = [
  ['','','','','','','Dispose'],                   // the title row above the headings
  ['Material','Material Description','Vendor','Macro/Lamp','Port Type','Band','Total Disposal'],
  ['1000000101','EXM_Panel_Antenna_1800_65deg_18dBi','Huawei','Macro','4.3-10F','1.8GHz','Dispose'],
  ['1000000105','EXM_Omni_Antenna_2600','Kathrein','Lamp','DINF','2.6GHz','']
];

const NOTES = [                                     // not a material master
  ['Materil code','Material Name','Qty.'],
  ['1000000109','EXM_Something','50Nos']
];

console.log('\nwhat counts as a material');
{
  is('a seven to twelve digit code',      [M.isCode('1000000101'), M.isCode('12345678901')], [true, true]);
  is('and nothing else',                  [M.isCode('ABC'), M.isCode('123'), M.isCode(''), M.isCode('-')], [false,false,false,false]);
  is('a category sheet is a master',      M.isMasterSheet('Antennas'), true);
  is('so is the export',                  M.isMasterSheet('table-export'), true);
  /* procurement notes are a list of things somebody asked for, not of what a
     material is - folding them in would put order lines in the catalogue */
  is('a requirement list is not',         M.isMasterSheet('Material requirement'), false);
  is('nor is the indent sheet',           M.isMasterSheet('Ind FP'), false);
  is('the sheet name decides the type',   M.typeForSheet('Radios'), 'Radio');
  is('and the export defers to its own',  M.typeForSheet('table-export'), '');
}

console.log('\nfinding the headings, wherever they are');
{
  is('the export heads its first row',    M.findHeader(EXPORT), 0);
  is('the antennas sheet heads its second', M.findHeader(ANTENNAS), 1);
  is('a sheet with no headings says so',  M.findHeader([['a','b'],['c','d']]), -1);
}

console.log('\nreading one sheet');
{
  const rows = M.readSheet('table-export', EXPORT);
  is('every coded row, and only those',   rows.length, 4);
  is('the blank spacer is not a material', rows.map(r=>r.code).indexOf(''), -1);
  is('the type comes off the row',        rows[0].type, 'Antenna');
  is('and the other columns are kept',    rows[0].attrs.Model, 'APX-1800');

  const ants = M.readSheet('Antennas', ANTENNAS);
  is('a category sheet types itself',     ants.map(r=>r.type), ['Antenna','Antenna']);
  is('and carries what only it knows',    ants[0].attrs['Port Type'], '4.3-10F');
  is('a notes sheet reads as nothing',    M.readSheet('Material requirement', NOTES).length, 0);
}

console.log('\ntidying the vendor');
{
  is('two spellings are one company',     [M.normVendor('HUA'), M.normVendor('Huawei')], ['Huawei','Huawei']);
  is('and so are the other two',          [M.normVendor('ERIC'), M.normVendor('ericsson')], ['Ericsson','Ericsson']);
  /* the Jumpers sheet has a port type sitting in the vendor column; it stays
     readable in the attributes and stays out of the filter */
  is('a port type in the vendor column is not a vendor',
     M.normVendor('4.3-10M TO NM JUMPER'), '');
  is('and neither is nothing',            M.normVendor(''), '');
}

console.log('\nmerging the two on the material code');
{
  const recs = M.readWorkbook({ 'table-export': EXPORT, 'Antennas': ANTENNAS, 'Material requirement': NOTES });
  const all = M.collate(recs);
  is('one record per code',               all.length, 5);
  is('in the order the spine had them',   all.map(r=>r.code),
     ['1000000101','1000000102','1000000103','1000000104','1000000105']);

  const ant = all.find(r=>r.code==='1000000101');
  /* the export truncates; the category sheet does not */
  is('the fuller description wins',       ant.desc, 'EXM_Panel_Antenna_1800_65deg_18dBi');
  is('the type is settled once',          ant.type, 'Antenna');
  is('the vendor is tidied',              ant.vendor, 'Huawei');
  is('the export column survives',        ant.attrs.Model, 'APX-1800');
  is('and so does the sheet-only one',    ant.attrs['Port Type'], '4.3-10F');
  is('a code only the sheet had is in',   all.find(r=>r.code==='1000000105').type, 'Antenna');
}

console.log('\nan upload adds and corrects, and leaves the rest alone');
{
  const first = M.collate(M.readWorkbook({ 'table-export': EXPORT }));
  is('the list starts at four',           first.length, 4);

  /* the same file again */
  const again = M.planUpload(M.readWorkbook({ 'table-export': EXPORT }), first);
  is('the same file changes nothing',     [again.added, again.changed, again.unchanged], [0, 0, 4]);
  is('and writes nothing',                again.write.length, 0);

  /* the antennas sheet: one material corrected, one new */
  const withAnts = M.planUpload(M.readWorkbook({ 'Antennas': ANTENNAS }), first);
  is('one corrected, one added, three untouched',
     [withAnts.added, withAnts.changed, withAnts.unchanged], [1, 1, 3]);
  is('only those two are written',        withAnts.write.map(r=>r.code), ['1000000101','1000000105']);
  is('and the total is five',             withAnts.total, 5);

  /* a material the upload never mentions is not deleted - each file covers
     part of the list and neither is the whole of it */
  is('nothing is removed by an upload',
     withAnts.total >= first.length, true);
}

console.log('\nthe filters');
{
  const all = M.collate(M.readWorkbook({ 'table-export': EXPORT, 'Antennas': ANTENNAS }));
  const f = M.facets(all);
  is('types are counted from the data',   f.types.map(t=>t.name+':'+t.count),
     ['Antenna:2','Fibers:1','Radio:1','RRU PWR:1']);
  is('and so are the vendors',            f.vendors.map(v=>v.name+':'+v.count),
     ['Huawei:2','Ericsson:1','Kathrein:1']);

  is('a type narrows it',                 M.view(all,{type:'Antenna'}).map(r=>r.code),
     ['1000000101','1000000105']);
  is('a vendor narrows it further',       M.view(all,{type:'Antenna',vendor:'Kathrein'}).map(r=>r.code),
     ['1000000105']);
  is('a code finds its material',         M.view(all,{q:'1000000103'}).map(r=>r.desc), ['EXM_RRU_2100_40W']);
  is('every word has to land',            M.view(all,{q:'antenna 2600'}).map(r=>r.code), ['1000000105']);
  is('and one that does not sinks it',    M.view(all,{q:'antenna 9999'}).length, 0);
  /* the attributes are searched too: nobody remembers the description, they
     remember the model on the label */
  is('a model number is searchable',      M.view(all,{q:'rru9999'}).map(r=>r.code), ['1000000103']);
  is('so is a port type',                 M.view(all,{q:'4.3-10f'}).map(r=>r.code), ['1000000101']);
  is('an empty search is everything',     M.view(all,{}).length, 5);
}

console.log('\nwhat the panel shows and what the button copies');
{
  const all = M.collate(M.readWorkbook({ 'table-export': EXPORT, 'Antennas': ANTENNAS }));
  const ant = all.find(r=>r.code==='1000000101');
  const d = M.details(ant);
  is('the ones worth reading first come first',
     d.slice(0,3).map(x=>x.k), ['Vendor','Model','Category 1']);
  is('a blank column is not a row of dashes',
     d.some(x=>!x.v), false);

  /* the code alone by default: it is going into SAP, and anything attached to
     it is something to delete */
  is('copy gives the code',               M.copyText(ant), '1000000101');
  is('or the description, asked for',     M.copyText(ant,'desc'), 'EXM_Panel_Antenna_1800_65deg_18dBi');
  is('or the row, tab separated',         M.copyText(ant,'row').split('\t').length, 4);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
