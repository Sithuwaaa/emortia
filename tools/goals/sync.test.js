/* sync.test.js - a slept device must not put the year back.

     node tools/goals/sync.test.js

   THE BUG. goalsSave upserted every column of every goal on every edit,
   persist() ran after every edit, and updated_at was written and never
   compared. Last-writer-wins on whole rows. Four ways that showed:

     1 a laptop that had been asleep writes its whole stale list over a
       phone edit, while the person is changing something unrelated
     2 an edit made during a reload round trip is discarded by S = fresh
     3 a goal deleted elsewhere is resurrected, because it is still in
       the array being upserted
     4 a delete made after a failed load never reaches the server,
       because lastIds was nulled and nothing was left to diff

   THE RULE EVERYTHING HERE IS WRITTEN AGAINST. A refused write and a
   lost delete must not look the same from the page. This is the
   must-report-failure shape in the one tool where nobody would notice -
   a goal is checked once a month, so a silently dropped edit has weeks
   to look like forgetfulness.

   Fixtures are invented.
*/
const fs = require('fs');
const path = require('path');
const Store = require(path.join(__dirname, 'store.js'));

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

const STAMP = '2026-11-03T08:00:00.000+00:00';
const LATER = '2026-11-03T09:30:00.000+00:00';
const row = (id, name, saved, stamp) => ({ id, name, cat: 'self', target: 1000,
  saved: saved == null ? 0 : saved, month: null, year: 2026, note: '', done: false,
  updated_at: stamp || STAMP });

/* a server that behaves the way the real one does under the conditions */
function server(rows) {
  const db = new Map();
  (rows || []).forEach(r => db.set(String(r.id), Object.assign({}, r)));
  const calls = [];
  return {
    db, calls,
    api: {
      goalsLoad: async () => ({ cur: 'Rs', goals: [...db.values()].map(r => Object.assign({}, r)), error: null }),
      goalsCurrency: async () => true,
      goalsWrite: async (g, expected) => {
        calls.push({ op: 'write', id: g.id, expected });
        const have = db.get(String(g.id));
        if (!expected) {
          if (have) return { ok: false, refused: true, error: 'already on the server, created elsewhere' };
          const stamp = LATER;
          db.set(String(g.id), Object.assign({}, g, { updated_at: stamp }));
          return { ok: true, refused: false, error: null, stamp };
        }
        if (!have || have.updated_at !== expected)
          return { ok: false, refused: true, error: 'changed on another device since this page read it' };
        const stamp = LATER;
        db.set(String(g.id), Object.assign({}, g, { updated_at: stamp }));
        return { ok: true, refused: false, error: null, stamp };
      },
      goalsRemove: async (id, expected) => {
        calls.push({ op: 'delete', id: String(id), expected });
        const have = db.get(String(id));
        if (!have) return { ok: true, refused: false, error: null, already: true };
        if (expected && have.updated_at !== expected)
          return { ok: false, refused: true, error: 'changed on another device since this page read it' };
        db.delete(String(id));
        return { ok: true, refused: false, error: null, already: false };
      }
    }
  };
}

/* store.js picks its backend at load time from window.DB, so the remote
   path is reached by giving it a window and calling use() with the remote
   marker the module itself installed. Simplest honest route: drive load()
   and save() with window.DB present and mode forced. */
function remote(s) {
  global.window = { DB: s.api };
  Store.use(null);
  /* use(null) sets mode 'local'; the module only flips to remote at import
     time. Re-import with the window already in place. */
  delete require.cache[require.resolve(path.join(__dirname, 'store.js'))];
  const S = require(path.join(__dirname, 'store.js'));
  return S;
}

(async () => {

  /* ---- 0. the harness is really on the remote path ------------------- */
  {
    const s = server([row('a', 'Invented Camera', 100)]);
    const St = remote(s);
    is('the store is syncing, or none of this tests the bug', St.syncing(), true);
    const first = await St.load();
    is('and it loaded from the server', first.goals.length, 1);
    is('remembering the stamp it came with', !!St.__seen()['a'].stamp, true);
  }

  /* ---- 1. THE SLEPT DEVICE -------------------------------------------
     Laptop holds A at saved 100 and B. Phone sets A to 500. Laptop, still
     stale, edits B. A must not move. */
  {
    const s = server([row('a', 'Invented Camera', 100), row('b', 'Invented Course', 0)]);
    const St = remote(s);
    const laptop = await St.load();

    s.db.set('a', Object.assign({}, s.db.get('a'), { saved: 500, updated_at: LATER }));

    const edited = St.upsert(laptop, Object.assign({}, laptop.goals.find(g => g.id === 'b'), { saved: 250 }));
    const r = await St.save(edited);

    is('THE PHONE EDIT SURVIVES', s.db.get('a').saved, 500);
    is('the laptop edit landed',  s.db.get('b').saved, 250);
    is('and A was never written at all',
       s.calls.filter(c => c.op === 'write' && c.id === 'a').length, 0);
    is('nothing was refused, because nothing collided', r.refused, []);
    is('and the result says one write', [r.ok, r.wrote, r.deleted], [true, 1, 0]);
  }

  /* ---- 1b. and when the SAME goal collides, it is refused and said --- */
  {
    const s = server([row('a', 'Invented Camera', 100)]);
    const St = remote(s);
    const laptop = await St.load();
    s.db.set('a', Object.assign({}, s.db.get('a'), { saved: 500, updated_at: LATER }));

    const edited = St.upsert(laptop, Object.assign({}, laptop.goals[0], { saved: 120 }));
    const r = await St.save(edited);

    is('THE STALE WRITE IS REFUSED, NOT APPLIED', s.db.get('a').saved, 500);
    is('ok is false',             r.ok, false);
    is('and it names the goal',   r.refused.map(x => [x.name, x.what]), [['Invented Camera', 'save']]);
    is('as refused, not failed',  r.failed, []);
  }

  /* ---- 2. AN EDIT DURING THE ROUND TRIP ------------------------------ */
  {
    const s = server([row('a', 'Invented Camera', 100), row('b', 'Invented Course', 0)]);
    const St = remote(s);
    const before = await St.load();
    /* the person types while the reload is in flight */
    const typing = St.upsert(before, Object.assign({}, before.goals.find(g => g.id === 'b'), { saved: 70 }));
    /* and the reload comes back with the server's older copy of b */
    const fresh = await St.load();
    const merged = St.merge(typing, fresh);

    is('THE TYPING SURVIVES THE RELOAD', merged.goals.find(g => g.id === 'b').saved, 70);
    is('and the untouched goal takes the server copy',
       merged.goals.find(g => g.id === 'a').saved, 100);
    is('a wholesale replace would have lost it',
       fresh.goals.find(g => g.id === 'b').saved, 0);
  }

  /* ---- 3. THE RESURRECTED DELETE ------------------------------------- */
  {
    const s = server([row('a', 'Invented Camera', 100), row('c', 'Invented Trip', 0)]);
    const St = remote(s);
    const laptop = await St.load();
    s.db.delete('c');                               /* the phone deletes C */

    const edited = St.upsert(laptop, Object.assign({}, laptop.goals.find(g => g.id === 'a'), { saved: 150 }));
    await St.save(edited);

    is('C STAYS DELETED', s.db.has('c'), false);
    is('because it was never written', s.calls.filter(c => c.op === 'write' && c.id === 'c').length, 0);
    is('and the edit that was made still landed', s.db.get('a').saved, 150);
  }

  /* ---- 4. A DELETE AFTER A FAILED LOAD ------------------------------- */
  {
    const s = server([row('a', 'Invented Camera', 100), row('d', 'Invented Lens', 0)]);
    const St = remote(s);
    const good = await St.load();

    /* the next load fails - no connection */
    s.api.goalsLoad = async () => ({ cur: null, goals: null, error: 'No connection just now.' });
    const after = await St.load();
    is('the failed load says so', !!after.error, true);

    /* and the person deletes D anyway */
    const gone = St.remove(good, 'd');
    const r = await St.save(gone);

    is('THE DELETE REACHES THE SERVER', s.db.has('d'), false);
    is('and is reported as one delete', [r.ok, r.deleted], [true, 1]);
    is('conditioned on the stamp, not blind',
       s.calls.filter(c => c.op === 'delete' && c.id === 'd')[0].expected, STAMP);
  }

  /* ---- 5. THE RULE: A LOST DELETE AND A REFUSED ONE DIFFER ----------- */
  {
    const s = server([row('e', 'Invented Desk', 0)]);
    const St = remote(s);
    const st0 = await St.load();
    /* somebody else edits E; this device tries to delete it */
    s.db.set('e', Object.assign({}, s.db.get('e'), { saved: 9, updated_at: LATER }));
    const r = await St.save(St.remove(st0, 'e'));

    is('the goal is STILL THERE',  s.db.has('e'), true);
    is('and save says so',         r.ok, false);
    is('as a refusal naming the delete',
       r.refused.map(x => [x.name, x.what]), [['Invented Desk', 'delete']]);
    is('and does not count it as deleted', r.deleted, 0);
  }
  {
    /* the other side of the same coin: already gone is SUCCESS, not a
       refusal - otherwise two devices deleting the same goal both get an
       error and neither believes it worked */
    const s = server([row('f', 'Invented Chair', 0)]);
    const St = remote(s);
    const st0 = await St.load();
    s.db.delete('f');
    const r = await St.save(St.remove(st0, 'f'));
    is('a goal already gone is not an error', [r.ok, r.refused.length, r.failed.length], [true, 0, 0]);
  }

  /* ---- 6. the page must read .ok, not the object -------------------- */
  const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').split('\r\n').join('\n');
  is('save() returns a result object, never a bare boolean',
     /return \{ ok: !refused\.length && !failed\.length,/.test(
       fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8')), true);
  is('AND THE PAGE READS .ok RATHER THAN THE TRUTHY OBJECT',
     /const r = await Store\.save\(S\);/.test(PAGE) && /return r\.ok;/.test(PAGE), true);
  is('the old boolean test is gone, which would have passed on every failure',
     /if \(!ok\) toast/.test(PAGE), false);
  is('a refusal gets its own sentence',  /r\.refused\.length/.test(PAGE), true);
  is('and a failure a different one',    /r\.failed\.length/.test(PAGE), true);
  is('the reload merges instead of replacing',
     /S = Store\.merge\(S, fresh\); render\(\);/.test(PAGE), true);
  is('and S = fresh wholesale is gone',  /\{ S = fresh; render\(\); \}/.test(PAGE), false);

  /* ---- 7. and the writes really are conditioned --------------------- */
  const DB_SRC = fs.readFileSync(path.join(__dirname, '..', '_lib', 'db.js'), 'utf8')
    .split('\r\n').join('\n');
  is('the update matches on updated_at',
     /\.eq\('id', g\.id\)\.eq\('updated_at', expected\)/.test(DB_SRC), true);
  is('an empty result is a REFUSAL, not a success',
     /if \(!data \|\| !data\.length\)\s*\n\s*return \{ ok: false, refused: true/.test(DB_SRC), true);
  is('a new goal is INSERTed, so a duplicate id cannot silently overwrite',
     /\.insert\(row\)\.select\('id,updated_at'\)/.test(DB_SRC), true);
  is('goalsSave, which wrote every column of every goal, is gone',
     /async function goalsSave\(/.test(DB_SRC), false);
  is('and updated_at is read back, or there is nothing to condition on',
     /GOAL_COLS = 'id,name,cat,target,saved,month,year,note,done,updated_at'/.test(DB_SRC), true);

  /* ---- 8. THE REAL db.js FUNCTIONS, NOT MY FAKE OF THEM --------------
     Everything above drives a server I wrote in this file, which is right
     for the four modes - they are about what the STORE decides to send.
     But it means breaking db.js's refusal logic changed nothing here, and
     I found that out by trying: the break that reported a refused delete
     as a success produced no failure at all. A guard for the
     must-report-failure rule that cannot fail is the exact shape this
     repository keeps paying for.

     So the two functions are lifted out of db.js and driven against the
     shared fake, which models update-with-select, delete-with-select and
     a real duplicate-key violation. */
  const { lift } = require(path.join(__dirname, '..', '_lib', 'reachable.js'));
  const Fake = require(path.join(__dirname, '..', '_lib', 'fake-supabase.js'));

  const writeSrc = lift(DB_SRC, 'goalsWrite');
  const rmSrc = lift(DB_SRC, 'goalsRemove');
  is('goalsWrite was found in db.js', typeof writeSrc === 'string' && writeSrc.length > 300, true);
  is('goalsRemove was found in db.js', typeof rmSrc === 'string' && rmSrc.length > 200, true);

  const realDb = db => new Function('client', 'GOALS', 'goalsWhy',
    'async ' + writeSrc + '\nasync ' + rmSrc + '\nreturn { goalsWrite, goalsRemove };'
  )(async () => db, 'goals', m => m);

  const goal = (id, saved) => ({ id, name: 'Invented ' + id, cat: 'self',
    target: 1000, saved: saved || 0, month: null, year: 2026, note: '', done: false });

  {
    const db = Fake.client({ goals: [Object.assign(goal('a', 100), { updated_at: STAMP })] });
    const R = realDb(db);
    const ok = await R.goalsWrite(goal('a', 150), STAMP);
    is('a write with the stamp it read is accepted', [ok.ok, ok.refused], [true, false]);
    const back = await db.from('goals').select('saved').eq('id', 'a').maybeSingle();
    is('and the row really moved', back.data.saved, 150);
    is('and a fresh stamp comes back to condition the next write', !!ok.stamp, true);
  }
  {
    const db = Fake.client({ goals: [Object.assign(goal('a', 100), { updated_at: LATER })] });
    const R = realDb(db);
    const r = await R.goalsWrite(goal('a', 150), STAMP);
    is('A STALE STAMP IS REFUSED BY db.js ITSELF', [r.ok, r.refused], [false, true]);
    is('and says why',  /changed on another device/.test(r.error), true);
  }
  {
    const db = Fake.client({ goals: [Object.assign(goal('a', 100), { updated_at: STAMP })] });
    const R = realDb(db);
    const r = await R.goalsWrite(goal('a', 1), null);     /* believes it is new */
    is('creating a goal that already exists is REFUSED, not an overwrite',
       [r.ok, r.refused], [false, true]);
  }
  {
    const db = Fake.client({ goals: [Object.assign(goal('e', 0), { updated_at: LATER })] });
    const R = realDb(db);
    const r = await R.goalsRemove('e', STAMP);
    is('A DELETE WHOSE STAMP MOVED IS REFUSED BY db.js ITSELF',
       [r.ok, r.refused], [false, true]);
  }
  {
    const db = Fake.client({ goals: [] });
    const R = realDb(db);
    const r = await R.goalsRemove('f', STAMP);
    is('AND A GOAL ALREADY GONE IS A SUCCESS, which is the other half',
       [r.ok, r.refused, r.already], [true, false, true]);
  }

  /* ---- 9. the page's branch, asserted so it bites -------------------
     The first version of this checked that `r.refused.length` appeared
     somewhere in the file, which stayed true when the `if` itself was
     changed to `if (!r)` - the condition that is false for every
     outcome. It now asserts the branch. */
  is('THE REFUSED BRANCH IS KEYED ON r.refused.length',
     /if \(r\.refused\.length\)\{/.test(PAGE), true);
  is('and the failed branch on r.failed.length',
     /\} else if \(r\.failed\.length\)\{/.test(PAGE), true);
  is('NOTHING IN persist TESTS THE RESULT OBJECT FOR TRUTHINESS',
     /if \(!r\)[\s{]/.test(PAGE), false);
  is('nor keeps the old boolean name',  /const ok = await Store\.save/.test(PAGE), false);

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
