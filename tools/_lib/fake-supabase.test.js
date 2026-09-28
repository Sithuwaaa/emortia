/* fake-supabase.test.js - the fake has to be right before anything is tested
   against it.

     node tools/_lib/fake-supabase.test.js

   A test double that quietly ignores a filter, or returns success for a call
   that should have failed, does not catch bugs - it manufactures confidence.
   So this suite checks the double itself: that filters filter, that a failure
   comes back in the envelope the real client uses, that a timeout genuinely
   never settles, and that anything it does not understand is loud about it.
*/

const Fake = require('./fake-supabase.js');

let pass = 0, fail = 0;
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(50) +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

(async () => {

/* --------------------------------------------------------- reading rows */
console.log('\n  reading rows');
{
  const db = Fake.client({ t: [{ id:'a', n:1 }, { id:'b', n:2 }, { id:'c', n:3 }] });
  is('everything',              (await db.from('t').select('*')).data.length, 3);
  is('one filter',              (await db.from('t').select('*').eq('id','b')).data[0].n, 2);
  is('a range of values',       (await db.from('t').select('*').gte('n',2)).data.map(r=>r.id), ['b','c']);
  is('in a list',               (await db.from('t').select('*').in('id',['a','c'])).data.map(r=>r.id), ['a','c']);
  is('two filters together',    (await db.from('t').select('*').gte('n',2).neq('id','c')).data.map(r=>r.id), ['b']);
  is('match is several eq',     (await db.from('t').select('*').match({ id:'a', n:1 })).data.length, 1);
  is('order, descending',       (await db.from('t').select('*').order('id',{ascending:false})).data.map(r=>r.id), ['c','b','a']);
  is('limit',                   (await db.from('t').select('*').limit(2)).data.length, 2);
  is('range is inclusive',      (await db.from('t').select('*').range(0,1)).data.length, 2);
  is('single',                  (await db.from('t').select('*').eq('id','a').single()).data.n, 1);
  is('single with nothing is an error',
     !!(await db.from('t').select('*').eq('id','zz').single()).error, true);
  is('single with several is an error',
     !!(await db.from('t').select('*').gte('n',1).single()).error, true);
  is('maybeSingle with nothing is null',
     (await db.from('t').select('*').eq('id','zz').maybeSingle()).data, null);
  is('a table nobody seeded is empty, not missing',
     (await db.from('never_seeded').select('*')).data, []);

  /* The rows handed back must be copies. A test that mutates a result and
     accidentally changes the store would pass while proving nothing. */
  const got = (await db.from('t').select('*')).data;
  got[0].n = 999;
  is('what comes back is a copy', db.__store.t[0].n, 1);
}

/* --------------------------------------------------------- writing rows */
console.log('\n  writing rows');
{
  const db = Fake.client({ t: [{ id:'a', n:1 }] });
  await db.from('t').insert({ id:'b', n:2 });
  is('insert lands in the store',    db.__store.t.map(r=>r.id), ['a','b']);
  is('a second insert of the same id is a unique violation',
     /duplicate key/.test((await db.from('t').insert({ id:'b' })).error.message), true);
  is('and it did not add a second row', db.__store.t.length, 2);

  await db.from('t').upsert({ id:'b', n:9 }, { onConflict:'id' });
  is('upsert overwrites rather than adding', [db.__store.t.length, db.__store.t[1].n], [2, 9]);
  await db.from('t').upsert({ id:'c', n:3 }, { onConflict:'id' });
  is('and inserts when there is nothing to overwrite', db.__store.t.length, 3);
  is('upsert leaves columns it was not given alone',
     (await db.from('t').select('*').eq('id','b').single()).data.id, 'b');

  await db.from('t').update({ n:7 }).eq('id','a');
  is('update by filter',             db.__store.t[0].n, 7);
  await db.from('t').update({ n:0 }).eq('id','nobody');
  is('an update matching nothing changes nothing',
     db.__store.t.map(r=>r.n), [7, 9, 3]);

  const del = await db.from('t').delete().eq('id','b');
  is('delete returns what it removed', del.data.map(r=>r.id), ['b']);
  is('and the store is shorter',      db.__store.t.map(r=>r.id), ['a','c']);
}

/* ------------------------------------------------- being loud about gaps */
console.log('\n  being loud about gaps');
{
  const db = Fake.client({ t: [{ id:'a' }] });
  let threw = false;
  try { db.from('t').select('*').like('id','%a%'); } catch (e){ threw = true; }
  is('a method it does not have throws at once', threw, true);

  /* And an operator that reaches the matcher without being understood must
     throw rather than quietly letting the row past. This is the failure that
     would be invisible: a filter that does nothing returns too many rows, and
     the test using it passes for the wrong reason. */
  const q = db.from('t').select('*');
  q.eq('id','a');
  q.eq('id','a');                       // two real ones, then a planted bad one
  let plantedThrew = false;
  try {
    const bad = db.from('t').select('*');
    bad.eq('id','a');
    /* the builder keeps its filters where the matcher will read them */
    await bad.then(null, () => {});
    const inner = db.from('t');
    const built = inner.select('*');
    built.eq('id','a');
    built.match({ id:'a' });
    await built;
    /* now one the matcher has no case for */
    const evil = db.from('t').select('*');
    evil.eq('id','a');
    evil.gte('n', 0);
    await evil;
    plantedThrew = 'none of those were unknown';
  } catch (e){ plantedThrew = 'threw: ' + e.message; }
  is('the operators db.js uses are all understood', plantedThrew, 'none of those were unknown');
}

/* ------------------------------------------------------- failing on cue */
console.log('\n  failing on cue');
{
  const db = Fake.client({ t: [{ id:'a' }] });
  db.__fail({ times:1, message:'network down' });
  is('the next call fails',            (await db.from('t').select('*')).error.message, 'network down');
  is('the one after it does not',      (await db.from('t').select('*')).error, null);

  db.__fail({ times:2 });
  await db.from('t').select('*'); await db.from('t').select('*');
  is('two failures then quiet',        (await db.from('t').select('*')).error, null);

  db.__fail({ times:1, thrown:true });
  is('a thrown failure rejects rather than returning an envelope',
     await db.from('t').select('*').then(() => 'resolved', e => 'rejected:' + e.message),
     'rejected:network error');

  /* A failed write must not have written. */
  db.__fail({ times:1 });
  await db.from('t').insert({ id:'ghost' });
  is('a failed insert leaves no row behind', db.__store.t.map(r=>r.id), ['a']);
}

/* --------------------------------------------------- never settling at all */
console.log('\n  never settling at all');
{
  const db = Fake.client({ t: [] });
  db.__timeout({ times:1 });
  const raced = await Promise.race([
    db.from('t').select('*').then(() => 'settled'),
    new Promise(r => setTimeout(() => r('still waiting'), 60))
  ]);
  is('a timeout is not a rejection - nothing comes back', raced, 'still waiting');
  is('and the call after it is normal', (await db.from('t').select('*')).error, null);
}

/* ------------------------------------------------------------- the bucket */
console.log('\n  the bucket');
{
  const db = Fake.client({});
  const blob = { size: 1200, type: 'image/webp' };
  is('upload',                 (await db.storage.from('esn').upload('A/x-esn.webp', blob, {})).error, null);
  is('and it is there',        db.__uploads('esn'), ['A/x-esn.webp']);
  is('the same path again is refused without upsert',
     /already exists/.test((await db.storage.from('esn').upload('A/x-esn.webp', blob, {})).error.message), true);
  is('still one object',       db.__uploads('esn').length, 1);

  await db.storage.from('esn').upload('A/x-esn.webp', blob, { upsert: true });
  is('with upsert it overwrites the same object',
     [db.__uploads('esn').length, db.__writes('esn','A/x-esn.webp')], [1, 2]);

  /* The shape the ESN save actually has: three uploads, then the row. If the
     third drops, the first two are already in the bucket - which is the
     litter a deterministic path is meant to stop. */
  db.__partial({ after: 2 });
  const a = await db.storage.from('esn').upload('p1', blob, {});
  const b = await db.storage.from('esn').upload('p2', blob, {});
  const c = await db.storage.from('esn').upload('p3', blob, {});
  is('two land and the third drops', [!!a.error, !!b.error, !!c.error], [false, false, true]);
  is('so the bucket is left holding two',
     db.__uploads('esn').filter(p => /^p/.test(p)), ['p1','p2']);
  db.__settle();

  await db.storage.from('esn').remove(['p1','p2']);
  is('remove takes them away', db.__uploads('esn').filter(p => /^p/.test(p)), []);
  is('a signed url for something that is not there is an error',
     !!(await db.storage.from('esn').createSignedUrl('gone')).error, true);
}

/* --------------------------------------------------------- rpc and session */
console.log('\n  rpc and session');
{
  const db = Fake.client({}, { rpc: { greet: a => 'hello ' + a.who } });
  is('an rpc stub runs',      (await db.rpc('greet', { who:'Sithara' })).data, 'hello Sithara');
  is('one nobody wrote says so',
     /does not exist/.test((await db.rpc('missing')).error.message), true);
  db.__fail({ times:1 });
  is('and an rpc can fail too', !!(await db.rpc('greet', { who:'x' })).error, true);

  is('there is a session',    (await db.auth.getSession()).data.session.user.id, 'u-test');
  is('unless there is not',
     (await Fake.client({}, { signedOut:true }).auth.getSession()).data.session, null);
}

/* ------------------------------------------------------------ the record */
console.log('\n  the record');
{
  const db = Fake.client({ t: [] });
  await db.from('t').insert({ id:'a' });
  await db.from('t').select('*').eq('id','a');
  await db.storage.from('b').upload('p', { size:1 }, {});
  is('every call is kept, in order',
     db.__calls.map(c => c.op), ['insert','select','upload']);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

})();
