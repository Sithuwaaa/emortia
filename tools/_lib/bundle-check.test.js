/* bundle-check.test.js - the bundle check, shown catching the thing it
   was written for.

     node tools/_lib/bundle-check.test.js

   The failure it exists for: a bundle built before a fix landed, whose
   patch applies cleanly and removes the fix anyway. A clean apply is
   not evidence, so the test that matters is "does it SAY what would be
   removed", not "does it run". */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'tools', '_lib', 'bundle-check.js');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ok   ' + name); return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

const run = d => execFileSync('node', [TOOL, d], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bundlechk-'));

console.log('--- the bundle check, against bundles that are wrong ---');

/* A real file from the repository, minus a line. That line is "a fix
   that landed after the bundle was built" as far as the tool can tell -
   which is exactly the situation it cannot be allowed to miss. */
const TARGET = 'tools/_lib/motion.css';
const real = fs.readFileSync(path.join(ROOT, TARGET), 'utf8');
const lines = real.replace(/\r\n/g, '\n').split('\n');
const victim = lines.find(l => l.trim().startsWith('.dust-layer'));

{
  const d = tmp();
  fs.mkdirSync(path.join(d, 'tools', '_lib'), { recursive: true });
  fs.writeFileSync(path.join(d, TARGET), lines.filter(l => l !== victim).join('\n'));
  const out = run(d);
  is('a whole-file bundle missing a line reports it as a removal',
     out.includes('-' + ' ' + victim.trim().slice(0, 60)) || out.includes(victim.trim().slice(0, 40)), true);
  is('and says plainly that lines would be removed', /LINE\(S\) WOULD BE REMOVED/.test(out), true);
  fs.rmSync(d, { recursive: true, force: true });
}

{
  /* the same file, unchanged: nothing to say */
  const d = tmp();
  fs.mkdirSync(path.join(d, 'tools', '_lib'), { recursive: true });
  fs.writeFileSync(path.join(d, TARGET), real);
  const out = run(d);
  is('an up-to-date bundle removes nothing', /Nothing in main would be removed/.test(out), true);
  fs.rmSync(d, { recursive: true, force: true });
}

{
  /* a patch whose minus lines are real, current lines - the shape that
     applied cleanly and reverted a pushed fix */
  const d = tmp();
  const patch = [
    'diff --git a/' + TARGET + ' b/' + TARGET,
    '--- a/' + TARGET,
    '+++ b/' + TARGET,
    '@@ -1,2 +1,2 @@',
    ' context',
    '-' + victim,
    '+something else',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(d, 'change.patch'), patch);
  const out = run(d);
  is('a patch has its removed lines read out', out.includes(victim.slice(0, 50)), true);
  is('and is told that applying cleanly proves nothing',
     /A clean apply says nothing about whether it is current/.test(out)
     || /applies cleanly: NO/.test(out), true);
  fs.rmSync(d, { recursive: true, force: true });
}

{
  /* a bundle that declares no base is told so */
  const d = tmp();
  fs.mkdirSync(path.join(d, 'tools', '_lib'), { recursive: true });
  fs.writeFileSync(path.join(d, TARGET), real);
  const out = run(d);
  is('a bundle with no declared base is called out', /base:\s+NOT DECLARED/.test(out), true);
  fs.rmSync(d, { recursive: true, force: true });
}

{
  /* A declared base is resolved and measured against HEAD. HEAD itself
     is used, not HEAD~1: CI checks out with actions/checkout@v4, which
     is shallow by default, so HEAD~1 is not a revision there. This test
     passed locally and failed in CI for exactly that reason, which is
     the sort of thing a test that reaches for git has to assume. */
  const d = tmp();
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), 'Built from base ' + sha + '\n');
  fs.mkdirSync(path.join(d, 'tools', '_lib'), { recursive: true });
  fs.writeFileSync(path.join(d, TARGET), real);
  const out = run(d);
  is('a declared base is resolved and measured against HEAD',
     /HEAD is 0 commit\(s\) ahead of it/.test(out), true);
  fs.rmSync(d, { recursive: true, force: true });
}

{
  /* a base that is not a commit here is said to be one, rather than
     being treated as zero commits behind */
  const d = tmp();
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), 'Built from base deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
  fs.mkdirSync(path.join(d, 'tools', '_lib'), { recursive: true });
  fs.writeFileSync(path.join(d, TARGET), real);
  const out = run(d);
  is('a base this repository does not have is called out',
     /NOT A COMMIT IN THIS REPOSITORY/.test(out), true);
  fs.rmSync(d, { recursive: true, force: true });
}

{
  /* a bundle whose paths line up with nothing says so rather than
     reporting a clean bill of health */
  const d = tmp();
  fs.writeFileSync(path.join(d, 'not-in-this-repo.txt'), 'hello\n');
  const out = run(d);
  is('a bundle matching no file in the repo is not called clean',
     /Nothing in the bundle matches a file/.test(out), true);
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
