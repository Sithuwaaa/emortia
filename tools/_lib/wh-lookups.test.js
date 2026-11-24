/* wh-lookups.test.js - one lookup mechanism, and no silent adds.

     node tools/_lib/wh-lookups.test.js

   THE FILE HAD TWO. lookBox was an <input> backed by a <datalist>; its
   comment said "no modal, no separate + new button to forget to wire
   up", which was true of itself. askProject was a <select> with a
   literal "+ New project…" option, hardcoded to project in four places.
   Neither was wrong. Having both was: the same question was asked two
   different ways depending on the field, and Purpose was a third way
   again - six words compiled into the page. The reason there were two
   is that nobody removed the first when the second was written, so this
   asserts that there is now one, by name.

   AND NO SILENT ADD. lookAdd ended in catch(e){} and the Add button
   toasted success on the next line regardless. 065 widened the CHECK
   constraint that was refusing new purposes; it cannot fix a page that
   does not look. These assertions run the real lookAdd against a
   failing DB and read what it returns. */

const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', 'warehouse', 'warehouse.js');
const D = path.join(__dirname, 'db.js');
const src = fs.readFileSync(W, 'utf8');
const dbsrc = fs.readFileSync(D, 'utf8');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* comments are prose about the old code, so they must not be read as
   the old code still being there */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ')
                   .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const live = code(src);

console.log('--- one mechanism ---');
is('lookBox is gone', /\blookBox\s*\(/.test(live), false);
is('the NEWPJ constant is gone', /\bNEWPJ\b/.test(live), false);
is('the hardcoded PURPOSES array is gone', /\bPURPOSES\b/.test(live), false);
is('and the three name arrays it fed', /\b(PARTIES|VENDORS|SOURCES)\b/.test(live), false);
is('pickBox is the component', /function pickBox\(/.test(live), true);
is('and there is exactly one of it', (live.match(/function pickBox\(/g) || []).length, 1);
is('no field builds its own <datalist> any more', /<datalist/.test(live), false);

/* ---- the component, run ---- */
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const grab = re => (src.match(re) || [''])[0];
const sandbox = [
  grab(/const LOOKLABEL=\{[\s\S]*?\};/),
  grab(/const NEWOPT=[^\n]*/),
  grab(/const isNewOpt=[^\n]*/),
  grab(/function pickBox\(kind,o\)\{[\s\S]*?\n\}/)
].join('\n');
is('the component was found whole', sandbox.length > 400, true);

const made = new Function('esc', 'LOOK', 'lookList',
  sandbox + '; return {pickBox,NEWOPT,isNewOpt,LOOKLABEL};');
const LOOK = { project: ['Austin D2', 'RRU Removal'], party: ['Browns', 'DAR', 'Fame'],
  source: [], vendor: [], location: ['DY-01'],
  purpose: ['Loan', 'Repair', 'Return to vendor', 'Scrap', 'Testing', 'Transfer'] };
const { pickBox, NEWOPT, isNewOpt, LOOKLABEL } = made(esc, LOOK, k => LOOK[k] || []);

const opts = html => [...html.matchAll(/<option([^>]*)>([^<]*)</g)]
  .map(m => ({ attrs: m[1], text: m[2] }));

console.log('\n--- every list offers its own add ---');
for (const kind of ['project', 'party', 'purpose', 'vendor', 'source', 'location']) {
  const o = opts(pickBox(kind, {}));
  const last = o[o.length - 1];
  is(kind + ' ends with a + New option', /^\+ New /.test(last.text), true);
  is(kind + " names itself in it", last.text, '+ New ' + LOOKLABEL[kind] + '…');
  is(kind + ' carries its kind in the value', last.attrs.includes('value="' + NEWOPT(kind) + '"'), true);
}

console.log('\n--- the three his screenshots were about ---');
{
  const p = opts(pickBox('party', { value: 'DAR' }));
  is('party lists the live rows', p.map(x => x.text).slice(1, 4), ['Browns', 'DAR', 'Fame']);
  is('and selects the one it was given', p.find(x => x.attrs.includes('selected')).text, 'DAR');
  const u = opts(pickBox('purpose', { value: 'Repair' }));
  is('purpose comes from the list, not from the page',
     u.map(x => x.text).includes('Return to vendor'), true);
  is('purpose has eight options: blank, six, and the add', u.length, 8);
  const j = opts(pickBox('project', { value: 'Austin D2' }));
  is('project still works the way it always did',
     j.map(x => x.text), ['Pick a project…', 'Austin D2', 'RRU Removal', '+ New project…']);
}

console.log('\n--- a value the list has never heard of ---');
{
  /* a note written before its list existed, or a bin that arrived
     through the Excel import. A select that dropped it would silently
     rewrite the row to whatever its first option happened to be. */
  const o = opts(pickBox('purpose', { value: 'Swapped under warranty' }));
  is('it is kept as an option', o.map(x => x.text).includes('Swapped under warranty'), true);
  is('and it is the selected one',
     o.find(x => x.attrs.includes('selected')).text, 'Swapped under warranty');
  is('the list is still offered under it', o.map(x => x.text).includes('Repair'), true);
  const b = opts(pickBox('location', { value: 'IMPORTED-BIN' }));
  is('same for a bin off the importer',
     b.find(x => x.attrs.includes('selected')).text, 'IMPORTED-BIN');
}
{
  const o = opts(pickBox('project', {}));
  is('with no value the blank option is the selected one',
     o[0].attrs.includes('selected'), true);
  is('and nothing else is', o.filter(x => x.attrs.includes('selected')).length, 1);
}

console.log('\n--- the marker, which the guards test for ---');
is('a + New value is recognised', isNewOpt(NEWOPT('purpose')), true);
is('a real name is not', isNewOpt('Repair'), false);
is('nor is an empty one', isNewOpt(''), false);
is('nor undefined', isNewOpt(undefined), false);
/* three callers: the listener and the two project guards. The
   definition is an arrow - isNewOpt=v=> - so it is not one of them; I
   wrote >= 4 expecting it to be, which was arithmetic and not a weaker
   rule. Naming the three is the tighter statement. */
is('the inbound project guard tests the marker, not a literal',
   /if\(!nIn\.local&&\(!pj\|\|isNewOpt\(pj\)\)\)/.test(live), true);
is('and so does the outbound one',
   /if\(!nDn\.project\|\|isNewOpt\(nDn\.project\)\)/.test(live), true);
is('three callers in all, the listener and those two',
   (live.match(/isNewOpt\(/g) || []).length, 3);
is('and no literal "+ New project" is compared against anywhere',
   /===\s*'\+ New/.test(live) || /\+ New project…'\s*(?:===|!==)/.test(live), false);
is('one listener serves every kind',
   /!isNewOpt\(el\.value\)\) return;\s*\n\s*askNew\(el,el\.value\.slice\(5\)\)/.test(live), true);

/* ---- no silent add: the real lookAdd, against a DB that refuses ---- */
console.log('\n--- what lookAdd says happened ---');
{
  const body = grab(/async function lookAdd\(kind,name\)\{[\s\S]*?\n\}/);
  is('lookAdd was found', body.length > 100, true);
  const run = (DB, list) => new Function('DB', 'LOOK', 'lookList',
    body + '; return lookAdd;')(DB, { purpose: list.slice() }, () => list);

  const okDb = { whAddLookup: async () => {} };
  const noDb = { whAddLookup: async () => { throw new Error('violates check constraint "wh_lookups_kind_check"'); } };

  return (async () => {
    const a = await run(okDb, [])('purpose', 'Swap');
    is('a written row says it was added', a, { ok: true, added: true });

    const b = await run(noDb, [])('purpose', 'Swap');
    is('a refused row says it was not', [b.ok, b.added], [false, false]);
    is('and says why', /check constraint/.test(b.why), true);

    const c = await run(noDb, ['Repair'])('purpose', 'Repair');
    is('a name already in the list needs no write', c, { ok: true, added: false });
    const d = await run(noDb, [])('purpose', '   ');
    is('nor does a blank one', d, { ok: true, added: false });

    /* THE BUG THIS IS ABOUT: the old body swallowed it and returned
       undefined, so the caller could not have known either way */
    const old = `async function lookAdd(kind,name){
      name=String(name==null?'':name).trim(); if(!name) return;
      if(lookList(kind).includes(name)) return;
      try{ await DB.whAddLookup(kind,name); }catch(e){}
    }`;
    const oldFn = new Function('DB', 'LOOK', 'lookList', old + '; return lookAdd;')(noDb, {}, () => []);
    is('the version that swallowed it returned nothing at all',
       await oldFn('purpose', 'Swap'), undefined);

    console.log('\n--- and nobody claims an add that did not happen ---');
    is('the Add button refuses to toast on a failed write',
       /if\(!r\.ok\) throw new Error\('Could not save that '\+label/.test(live), true);
    is('the save path reports it on the success instead of swallowing it',
       /was not remembered for next time/.test(live), true);
    is('and it no longer calls lookAdd without looking',
       /\bawait lookAdd\([^)]*\);(?!\s*if)/.test(live.replace(/const r=await lookAdd/g, 'X')), false);

    console.log('\n--- a failed read is not an empty warehouse ---');
    is('db.js no longer throws the reason away',
       /whAll\(c, 'wh_lookups', 'name'\)\.catch\(\(\) => \[\]\)/.test(dbsrc), false);
    is('it names the failure', /lookupError = whErr\(e\)/.test(dbsrc), true);
    is('and hands it back with the rest', /lookups, lookupError, error: null/.test(dbsrc), true);
    is('the page says it once per load', /d\.lookupError&&d\.lookupError!==lookWarned/.test(live), true);

    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(fail ? 1 : 0);
  })();
}
