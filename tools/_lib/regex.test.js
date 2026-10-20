/* regex.test.js - a backslash that did not survive being written down.

     node tools/_lib/regex.test.js

   WHY THIS IS A TEST AND NOT A NOTE IN A DOCUMENT.

   It has happened twice. First a pattern built as a string lost its escape -
   '\s' became 's', so it matched the letter s and nothing else it was meant
   to. "Build regexes from literals, not from strings" went into the
   decisions file, and then it happened again anyway: \d became d, and
   realDay() rejected every date it was handed, including real ones.

   A rule in a document asks to be remembered at the one moment it matters.
   This asks nothing. It fails the suite.

   TWO FAULTS, NOT ONE. They look alike and they are not:

     new RegExp('\\d{4}')   a pattern built from a string. Every backslash
                            has to be doubled, and each hand that touches it
                            is another chance to lose one. This is the rule
                            that was written down.

     /^(d{4})-(d{2})$/      a literal that ALREADY lost its backslashes.
                            There is nothing to double here and the rule as
                            written does not describe it - which is exactly
                            why the second one got through. d{4} is valid: it
                            means four letter d's. Nobody has ever wanted
                            that, so it reads as damage.

   Both are checked. The second is the one that would have caught today.

   HOW IT READS THE SOURCE. Not by scanning text: 'http://x' and a comment
   mentioning /\d+/ would both register, and a guard that cries wolf gets
   switched off. It runs a small lexer that knows where it is - in a string,
   in a comment, in a regex literal - and only looks inside the regexes.
*/

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function is(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(52) +
    (typeof got === 'object' ? JSON.stringify(got) : String(got)) +
    (ok ? '' : '   want ' + (typeof want === 'object' ? JSON.stringify(want) : String(want))));
}

/* ---- the lexer -------------------------------------------------------

   Enough JavaScript to tell a regex from a division sign, which is the only
   genuinely hard part. The trick is the same one every tokeniser uses: a
   '/' starts a regex only where a VALUE could not already have ended. After
   an identifier, a number, a ')' or a ']' the slash is division; after '=',
   '(', ',', 'return' and friends it opens a pattern. */
const BEFORE_VALUE = /[({[,;:!&|?+\-*/%~^=<>]$|\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

function scanRegexes(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  let prev = '';                       /* significant text before this point */
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; prev += '\n'; continue; }

    /* comments */
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2; continue;
    }

    /* strings and templates - skipped wholesale, with their escapes */
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n') { line++; if (q !== '`') break; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      prev += 'x';                     /* a string is a value */
      continue;
    }

    /* a regex literal, if a value could not have just ended */
    if (c === '/') {
      const tail = prev.replace(/\s+$/, '');
      if (BEFORE_VALUE.test(tail) || tail === '') {
        const start = i, startLine = line;
        i++;
        let cls = false, ok = false;
        while (i < n) {
          const d = src[i];
          if (d === '\\') { i += 2; continue; }
          if (d === '\n') break;                       /* unterminated: not a regex */
          if (d === '[') cls = true;
          else if (d === ']') cls = false;
          else if (d === '/' && !cls) { ok = true; i++; break; }
          i++;
        }
        if (ok) {
          while (i < n && /[dgimsuvy]/.test(src[i])) i++;
          out.push({ body: src.slice(start + 1, i).replace(/\/[dgimsuvy]*$/, ''),
                     text: src.slice(start, i), line: startLine });
          prev += 'x';
          continue;
        }
        i = start + 1; prev += '/'; continue;
      }
      i++; prev += '/'; continue;
    }

    prev += c;
    if (prev.length > 64) prev = prev.slice(-64);
    i++;
  }
  return out;
}

/* new RegExp(' ... ') where the string carries a backslash AND is the whole
   argument.

   STATIC ONLY, and that distinction is the whole of it. A pattern that is
   known when it is written should be a literal - writing it as a string
   doubles every backslash for no gain, which is the hazard. But a pattern
   assembled around a value:

       new RegExp('alter\\s+table\\s+' + table + '\\s+add column', 'g')

   has no literal form, and there are twenty-one of those in this repository
   doing honest work. A guard that failed them would be switched off within
   the week, and then it would be guarding nothing. So the test is not "is
   there a backslash in a string" but "could this have been a literal". */
const NEW_REGEXP = /new\s+RegExp\s*\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*([,)])/g;

/* A class shorthand that lost its backslash. \d \w \s \b and their negations
   are the ones that turn into ordinary letters, and d{4} / w+ / s* are not
   things anybody writes on purpose. Inside a character class [abc] a bare d
   is perfectly normal, so those are left alone. */
function strippedEscapes(body) {
  const hits = [];
  let cls = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') { cls = true; continue; }
    if (c === ']') { cls = false; continue; }
    if (cls) continue;
    if (!/[dwsbDWSB]/.test(c)) continue;
    const before = body[i - 1], after = body[i + 1];
    /* a letter in a word is just a letter: only flag one that is quantified
       or grouped the way a class shorthand would be */
    if (!/[{+*?]/.test(after || '')) continue;
    if (/[A-Za-z0-9_]/.test(before || '')) continue;
    if (after === '{' && !/^\{\d/.test(body.slice(i + 1))) continue;
    hits.push(c + (after === '{' ? (body.slice(i + 1).match(/^\{[^}]*\}/) || [''])[0] : after));
  }
  return hits;
}

/* ---- the lexer, on patterns whose answers are known ------------------- */
{
  const probe = `
    const a = /^(\\d{4})-(\\d{2})$/;
    const b = 10 / 2 / 5;                      // division, not a regex
    const url = 'https://example.com/a/b';     // a string
    /* a comment with /\\d+/ in it */
    const c = x.replace(/\\s+/g, ' ');
    const d = [1,2].map(v => v / 2);
  `;
  const found = scanRegexes(probe);
  is('finds only the real regex literals', found.length, 2);
  is('reads the first one whole', found[0].text, '/^(\\d{4})-(\\d{2})$/');
  is('division is not a regex', found.some(r => r.text.indexOf('2 / 5') >= 0), false);
  is('a url inside a string is skipped', found.some(r => r.text.indexOf('example') >= 0), false);
}

/* ---- the two faults, on fixtures that are known to be bad ------------- */
{
  const good = '/^(\\d{4})-(\\d{2})-(\\d{2})$/';
  const bad  = '/^(d{4})-(d{2})-(d{2})$/';
  is('a correct literal is clean',      strippedEscapes(good.slice(1, -1)), []);
  is('the literal that shipped today',  strippedEscapes(bad.slice(1, -1)).length, 3);
  is('\\s+ stripped to s+ is caught',    strippedEscapes('^s+$'), ['s+']);
  is('\\w* stripped to w* is caught',    strippedEscapes('w*'), ['w*']);
  is('a bare letter is not a fault',    strippedEscapes('^draft$'), []);
  is('a letter in a class is not one',  strippedEscapes('[dws]+'), []);
  is('a quantified literal d is spared when escaped', strippedEscapes('\\d{4}'), []);

  /* static or assembled - the distinction the guard turns on */
  const hits = src => {
    NEW_REGEXP.lastIndex = 0;
    let n = 0, m;
    while ((m = NEW_REGEXP.exec(src))) if (m[2].indexOf('\\') >= 0) n++;
    return n;
  };
  is('a static pattern written as a string is caught',
     hits("var re = new RegExp('\\\\d{4}');"), 1);
  is('with a flags argument, still caught',
     hits("var re = new RegExp('\\\\s+', 'g');"), 1);
  is('a pattern built around a value is left alone',
     hits("var re = new RegExp('alter\\\\s+table\\\\s+' + t + '\\\\s+add', 'g');"), 0);
  is('a string carrying no escape is not the point',
     hits("var re = new RegExp('abc');"), 0);
}

/* ---- and now the codebase -------------------------------------------- */
const ROOT = path.resolve(__dirname, '..', '..');
const SKIP = new Set(['node_modules', 'img', 'media', 'fonts']);
/* Anything hidden is either tooling or somebody else's library - .tools holds
   945KB of minified SheetJS, and a guard about how WE write regexes has no
   business failing on a vendored file nobody here is going to edit. */
const hidden = name => name.charAt(0) === '.';
/* This file is full of deliberate examples of both faults. Checking itself
   would be the one false positive the whole design is trying to avoid. */
const SELF = path.resolve(__filename);

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name) || hidden(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html)$/.test(name) && p !== SELF) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
const fromString = [];
const stripped = [];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');

  NEW_REGEXP.lastIndex = 0;
  let m;
  while ((m = NEW_REGEXP.exec(src))) {
    if (m[2].indexOf('\\') < 0) continue;              /* no escapes, no risk */
    fromString.push(rel + ':' + (src.slice(0, m.index).split('\n').length) + '  ' + m[0].slice(0, 60));
  }

  /* HTML carries its script in tags; everything else is script already */
  const chunks = /\.html$/.test(f)
    ? (src.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [])
        .map(b => b.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, ''))
    : [src];

  for (const chunk of chunks) {
    for (const r of scanRegexes(chunk)) {
      const hits = strippedEscapes(r.body);
      if (hits.length) stripped.push(rel + '  ' + r.text + '   looks like ' + hits.join(' '));
    }
  }
}

console.log('\n  scanned ' + files.length + ' files');
if (fromString.length) { console.log('\n  built from a string:'); fromString.forEach(h => console.log('    ' + h)); }
if (stripped.length) { console.log('\n  escapes that look stripped:'); stripped.forEach(h => console.log('    ' + h)); }
console.log('');

is('no regex is built from a string with a backslash', fromString, []);
is('no regex literal has lost its backslashes', stripped, []);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
