#!/usr/bin/env node
/* bundle-check.js - what would this handoff bundle TAKE AWAY?

     node tools/_lib/bundle-check.js <unzipped-bundle-dir>
     node tools/_lib/bundle-check.js <dir> --base 4cc70b1

   WHY THIS EXISTS. Three bundles have now carried work backwards, and
   one of them silently reverted a fix that was already pushed.

   That one is worth describing exactly, because it is the whole reason
   for the shape of this tool. The bundle's patch applied cleanly -
   `git apply --check` was happy - because its `-` lines really were
   present in the file. They were present because they were the lines of
   a fix that had landed AFTER the bundle was built. Applying the patch
   removed them. Nothing in the diff said "revert"; the change simply
   did not contain them any more, and the author of the bundle never
   knew they existed.

   A clean apply is therefore not evidence of anything. The question is
   never "does this fit", it is "what is in main that this does not
   have". So that is the only question this asks.

   THE BASE SHA IS THE FIRST THING IT LOOKS FOR. A bundle built from a
   known commit can be reasoned about; one that declares no base cannot,
   and that is worth saying out loud rather than discovering later.

   HOW IT COMPARES. By line SET, not by position. A line that exists in
   main and not in the bundle is a removal, wherever it sits. That means
   a moved line reads as neither added nor removed, which is the right
   trade here: this tool is not trying to produce a patch, it is trying
   to answer one question without ever missing a yes. */

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
const baseArg = (() => { const i = args.indexOf('--base'); return i >= 0 ? args[i + 1] : null; })();

if (!dir) {
  console.error('usage: node tools/_lib/bundle-check.js <unzipped-bundle-dir> [--base <sha>]');
  process.exit(2);
}
if (!fs.existsSync(dir)) { console.error('no such directory: ' + dir); process.exit(2); }

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
const SKIP = /(^|\/)(\.git|node_modules)(\/|$)/;

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (SKIP.test(p.replace(/\\/g, '/'))) continue;
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/* ---- 1. the base it was built from ---------------------------------- */

function declaredBase() {
  if (baseArg) return { sha: baseArg, where: '--base' };
  for (const f of walk(dir)) {
    if (!/HANDOFF\.md$|README|\.base$|BASE$/i.test(path.basename(f))) continue;
    const t = fs.readFileSync(f, 'utf8');
    const m = t.match(/\b(?:base|built from|against|from commit)\b[^\n]*?\b([0-9a-f]{7,40})\b/i)
           || t.match(/\b([0-9a-f]{40})\b/);
    if (m) return { sha: m[1], where: path.relative(dir, f).replace(/\\/g, '/') };
  }
  return null;
}

const base = declaredBase();
console.log('--- what would this bundle take away? ---');
console.log('  bundle: ' + dir);
if (!base) {
  console.log('  base:   NOT DECLARED. Nothing in the bundle names the commit it was');
  console.log('          built from, so how far behind it is cannot be worked out.');
} else {
  let behind = null, known = true;
  try { git('cat-file', '-e', base.sha + '^{commit}'); }
  catch (e) { known = false; }
  if (known) {
    try { behind = git('rev-list', '--count', base.sha + '..HEAD').trim(); } catch (e) {}
  }
  console.log('  base:   ' + base.sha + '  (from ' + base.where + ')'
    + (!known ? '  - NOT A COMMIT IN THIS REPOSITORY'
       : behind != null ? '  - HEAD is ' + behind + ' commit(s) ahead of it' : ''));
  if (known && behind && +behind > 0)
    console.log('          Everything in those ' + behind + ' commits is at risk of being undone.');
}
console.log('');

/* ---- 2. patches: what do their minus lines actually remove? ---------- */

const patches = walk(dir).filter(f => /\.(patch|diff)$/i.test(f));
const reports = [];

for (const pf of patches) {
  const text = fs.readFileSync(pf, 'utf8');
  let clean = null;
  try { execFileSync('git', ['apply', '--check', pf], { cwd: ROOT, stdio: 'pipe' }); clean = true; }
  catch (e) { clean = false; }
  /* removals per target file */
  const byFile = new Map();
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) { cur = m[1]; if (!byFile.has(cur)) byFile.set(cur, []); continue; }
    if (!cur) continue;
    if (/^-(?!--)/.test(line)) byFile.get(cur).push(line.slice(1));
  }
  reports.push({ kind: 'patch', file: path.relative(dir, pf).replace(/\\/g, '/'), clean, byFile });
}

/* ---- 3. whole files: what is in main that the bundle does not have? -- */

for (const f of walk(dir)) {
  if (/\.(patch|diff)$/i.test(f)) continue;
  const relp = path.relative(dir, f).replace(/\\/g, '/');
  /* the bundle may nest its files under a folder; match on the tail */
  let target = null;
  for (const cand of [relp, relp.replace(/^[^/]+\//, '')]) {
    if (fs.existsSync(path.join(ROOT, cand))) { target = cand; break; }
  }
  if (!target) continue;
  let mine;
  try { mine = git('show', 'HEAD:' + target); } catch (e) { continue; }
  const theirs = fs.readFileSync(f, 'utf8');
  const norm = t => t.replace(/\r\n/g, '\n').split('\n');
  const a = norm(mine), b = new Set(norm(theirs).map(x => x.trim()));
  const gone = a.filter(l => l.trim() !== '' && !b.has(l.trim()));
  const added = new Set(norm(theirs).map(x => x.trim()));
  for (const l of a) added.delete(l.trim());
  reports.push({ kind: 'file', file: relp, target, gone, addedCount: [...added].filter(x => x !== '').length });
}

/* ---- 4. say it ------------------------------------------------------- */

let removals = 0;
for (const r of reports) {
  if (r.kind === 'patch') {
    const total = [...r.byFile.values()].reduce((n, v) => n + v.length, 0);
    console.log('  PATCH  ' + r.file + '   applies cleanly: ' + (r.clean ? 'yes' : 'NO'));
    if (r.clean) console.log('         A clean apply says nothing about whether it is current.');
    for (const [t, lines] of r.byFile) {
      if (!lines.length) continue;
      removals += lines.length;
      console.log('    ' + t + '  -' + lines.length + ' line(s):');
      lines.slice(0, 12).forEach(l => console.log('      - ' + l.slice(0, 100)));
      if (lines.length > 12) console.log('      … and ' + (lines.length - 12) + ' more');
    }
    if (!total) console.log('    removes nothing.');
  } else {
    console.log('  FILE   ' + r.file + '  ->  ' + r.target
      + '   +' + r.addedCount + ' / -' + r.gone.length);
    if (r.gone.length) {
      removals += r.gone.length;
      r.gone.slice(0, 12).forEach(l => console.log('      - ' + l.trim().slice(0, 100)));
      if (r.gone.length > 12) console.log('      … and ' + (r.gone.length - 12) + ' more');
    }
  }
}

if (!reports.length) {
  console.log('  Nothing in the bundle matches a file in this repository.');
  console.log('  Either it is all new, or its paths do not line up - check before applying.');
}

console.log('');
if (removals) {
  console.log('  ' + removals + ' LINE(S) WOULD BE REMOVED. Read them. A line that is in main and');
  console.log('  not in the bundle is either a deliberate deletion or work the bundle');
  console.log('  never knew about, and the bundle cannot tell you which.');
} else {
  console.log('  Nothing in main would be removed.');
}
process.exit(0);
