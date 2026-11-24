/* wh-drum-guards.test.js - a drum that has gone out cannot be cut.

     node tools/_lib/wh-drum-guards.test.js

   wh_outbound has two drum branches and they did not agree. The
   whole-drum branch has always checked `L.status <> 'in'`. The cut
   branch checked only whether the length asked for exceeded
   drum_upper - drum_lower.

   Those two readings DO NOT MOVE when a drum goes out whole, because
   nothing is cut off it - the row just changes status. So a drum
   issued entire still answered with its full remaining length and the
   next cut passed the only test there was. It has already happened
   once: one 500 m drum carries four outbound lines totalling 640 m.

   This reads the LAST definition of wh_outbound, because a function
   has one definition and the last one wins. A guard added in 068 and
   dropped by a later re-emission would be a silent regression of
   exactly the kind this file exists to catch. */

const fs = require('fs');
const path = require('path');

const SQLDIR = path.join(__dirname, '..', '..', 'supabase');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* the last definition of one function, and which file it came from */
function lastDef(fn) {
  const files = fs.readdirSync(SQLDIR).filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  let body = null, from = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SQLDIR, f), 'utf8').replace(/\r/g, '');
    const m = sql.match(new RegExp('create or replace function ' + fn + '\\([^)]*\\)[\\s\\S]*?\\$\\$;', 'i'));
    if (m) { body = m[0]; from = f; }
  }
  return { body, from };
}

/* comments explain the guard; they must not stand in for it */
const code = sql => sql.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

/* the cut branch runs from the drum test to the else that ends it */
function cutBranch(body) {
  const src = code(body);
  const start = src.indexOf("if L.drum_name is not null and not coalesce((it->>'whole')");
  if (start < 0) return '';
  const end = src.indexOf('\n      else', start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}
function wholeBranch(body) {
  const src = code(body);
  const start = src.indexOf('\n      else', src.indexOf("if L.drum_name is not null"));
  if (start < 0) return '';
  const end = src.indexOf('\n      end if;', start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

/* THE BODY MOVED AND THE INVARIANT DID NOT. 069 lifted wh_outbound's
   per-item body into wh_add_outbound_line, so create and edit add a
   line through one implementation. Everything below asks the same
   questions of the same code; only its address changed. Falling back
   to the parent keeps this file honest against a database where 069
   has not been applied. */
const itemBody = (parent, helper) => {
  const h = lastDef(helper);
  return h.body ? h : lastDef(parent);
};
const ob = itemBody('wh_outbound', 'wh_add_outbound_line');
console.log('--- a drum that has gone out cannot be cut ---');
console.log('  the outbound item body lives in ' + ob.from + '\n');

is('the outbound item body was found', !!ob.body, true);
const cut = cutBranch(ob.body), whole = wholeBranch(ob.body);
is('the cut branch was found', cut.length > 200, true);
is('the whole-drum branch was found', whole.length > 100, true);

is('the cut branch refuses a drum that is not in stock', /L\.status\s*<>\s*'in'/.test(cut), true);
is('and says so about the drum, by name', /Drum % went out whole on %/.test(ob.body), true);
is('the whole-drum branch still checks it too', /L\.status\s*<>\s*'in'/.test(whole), true);
is('the length test is still there as well', /len > L\.drum_upper - L\.drum_lower/.test(cut), true);

/* order matters: "it is already out" and "there is not that much left"
   are different answers and the counter should get the true one */
is('status is tested before length',
   cut.indexOf("L.status <> 'in'") < cut.indexOf('len > L.drum_upper'), true);

/* ---- prove it by breaking ---- */
console.log('\n  --- and the same reading of the version that let it through ---');
{
  const files = fs.readdirSync(SQLDIR).filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .filter(f => parseInt(f, 10) < 68);
  let before = null, from = null;
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SQLDIR, f), 'utf8').replace(/\r/g, '');
    const m = sql.match(/create or replace function wh_outbound\([^)]*\)[\s\S]*?\$\$;/i);
    if (m) { before = m[0]; from = f; }
  }
  /* before 068 the body was still inside wh_outbound, so this one
     really is the right place to look */
  is('the definition before 068 was found', !!before, true);
  console.log('  (it is ' + from + ')');
  is('its cut branch had no status check', /L\.status\s*<>\s*'in'/.test(cutBranch(before)), false);
  is('while its whole-drum branch did', /L\.status\s*<>\s*'in'/.test(wholeBranch(before)), true);
  is('which is the disagreement, in one line',
     [/L\.status/.test(cutBranch(before)), /L\.status/.test(wholeBranch(before))], [false, true]);
}

/* the arithmetic of what happened, so the number is in the file and
   not only in a commit message. A 500 m drum, three cuts covering its
   whole range, and a whole-drum issue in among them. */
{
  const span = 565 - 65;
  const issued = 240 + 120 + 140 + 140;
  is('the drum held 500 m', span, 500);
  is('and 640 m was issued off it', issued, 640);
  is('which is 140 more than it had', issued - span, 140);
}

/* ---- a returned piece belongs to its drum, and only to it ---- */
console.log('\n--- a length that came back off a drum ---');
{
  const rt = lastDef('wh_return'), ui = lastDef('wh_update_item');
  console.log('  wh_return last defined in ' + rt.from);
  console.log('  wh_update_item last defined in ' + ui.from + '\n');
  const R = code(rt.body), U = code(ui.body);

  is('a piece cut off a drum records which drum', /from_drum\)/.test(R), true);
  is('and it is the source item\'s own drum name', /rec\.drum_name\)/.test(R), true);
  is('both branches that make a new row from a drum carry it',
     (R.match(/rec\.drum_name\)/g) || []).length, 2);

  /* THE ONE THING THIS MUST NOT DO. The parent's range is a continuous
     physical measure and the cuts against it are its audit trail. A
     returned length was cut off and never rejoined, so splicing it
     back would claim a join that did not happen - and the cut history
     could not be reconstructed afterwards. */
  is('the parent drum\'s readings are never written by a return',
     /update wh_items set[^;]*drum_(upper|lower)/i.test(R), false);
  is('nor its original readings',
     /update wh_items set[^;]*orig_(upper|lower)/i.test(R), false);

  /* and he can measure it afterwards, which he could not before */
  is('naming is allowed for a piece that came off a drum',
     /i\.drum_name is null and i\.from_drum is null/.test(U), true);
  is('and still refused for anything else',
     /is not a drum\. A drum is named when it is booked in/.test(U), true);
  is('the uniqueness check is still there',
     /There is already a drum called/.test(U), true);
  is('which is what makes a cut traceable',
     /lower\(drum_name\) = lower\(p->>'drum_name'\)/.test(U), true);
}

/* ---- prove it by breaking ---- */
console.log('\n  --- and the same reading of the versions before 068 ---');
{
  const before = fn => {
    const files = fs.readdirSync(SQLDIR).filter(f => /^\d+_.*\.sql$/.test(f))
      .sort((x, y) => parseInt(x, 10) - parseInt(y, 10)).filter(f => parseInt(f, 10) < 68);
    let body = null;
    for (const f of files) {
      const sql = fs.readFileSync(path.join(SQLDIR, f), 'utf8').replace(/\r/g, '');
      const m = sql.match(new RegExp('create or replace function ' + fn + '\\([^)]*\\)[\\s\\S]*?\\$\\$;', 'i'));
      if (m) body = m[0];
    }
    return body ? code(body) : '';
  };
  is('wh_return did not record the drum', /from_drum/.test(before('wh_return')), false);
  is('and wh_update_item refused to name the piece',
     /i\.drum_name is null and i\.from_drum is null/.test(before('wh_update_item')), false);
  is('it refused on drum_name alone, which a returned piece never has',
     /if i\.drum_name is null then/.test(before('wh_update_item')), true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
