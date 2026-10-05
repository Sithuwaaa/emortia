/* node tools/wh24/workhub.test.js

   THE TWO BUG CLASSES THIS EXISTS FOR, both of which surfaced only when
   somebody clicked a button:

     1. A GRAPHQL VARIABLE DECLARED NULLABLE while every call site passes a
        value. WorkHub wants String! for $contentId and refused the whole
        query. Deterministic - it fails identically every time - so there is
        no reason for it to fail on the warehouse laptop rather than here.

        The rule that makes it decidable WITHOUT the schema: GraphQL accepts a
        T! variable anywhere a T is wanted, and never a T where T! is
        required. So the strictest declaration every call site can satisfy is
        always the safe one, and a variable that is never passed null and is
        declared nullable is a latent failure waiting for the server to
        tighten.

     2. A BOOKMARKLET THAT IS A FROZEN COPY. If it can be built it can be
        checked: the file must parse as the javascript: URL it becomes, must
        carry a build marker for the page to compare, and must not contain a
        double-slash comment, which in a javascript: URL swallows everything
        after it.

   No browser and no network. */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'workhub.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + name + '\n  got  ' + a + '\n  want ' + b);
};

/* ============================================ 1. the variable declarations */

/* every `var Q_X = '...'` in the file */
const queries = {};
for (const m of SRC.matchAll(/var (Q_[A-Z]+) = '((?:[^'\\]|\\.)*)'/g)) queries[m[1]] = m[2];
is('every query was found', Object.keys(queries).sort(), ['Q_CARD', 'Q_LIST', 'Q_TASKS', 'Q_URL']);

/* declared variables, with their types */
function declared(q) {
  const head = /query \(([^)]*)\)/.exec(q);
  if (!head) return {};
  const out = {};
  head[1].split(',').forEach(p => {
    const m = /\$(\w+):\s*([\w!\[\]]+)/.exec(p.trim());
    if (m) out[m[1]] = m[2];
  });
  return out;
}

/* every gql(Q_X, { ... }) call site, and whether each value is literally null */
function callSites(name) {
  const out = [];
  const re = new RegExp('gql\\(' + name + ',\\s*\\{', 'g');
  let m;
  while ((m = re.exec(SRC))) {
    /* brace-match the object literal */
    let i = SRC.indexOf('{', m.index), d = 0, end = -1;
    for (let k = i; k < SRC.length; k++) {
      if (SRC[k] === '{') d++;
      else if (SRC[k] === '}') { d--; if (!d) { end = k + 1; break; } }
    }
    const body = SRC.slice(i, end);
    const vals = {};
    /* top-level keys only: depth 1 inside the literal */
    let depth = 0, key = null, start = 0;
    for (let k = 0; k < body.length; k++) {
      const ch = body[k];
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
      if (depth === 1 && key === null) {
        const km = /^\s*(\w+)\s*:/.exec(body.slice(k));
        if (km) { key = km[1]; k += km[0].length - 1; start = k + 1; }
      } else if (depth === 1 && key !== null && (ch === ',' || k === body.length - 2)) {
        vals[key] = body.slice(start, k).trim();
        key = null;
      }
    }
    out.push(vals);
  }
  return out;
}

const AUDIT = [];
for (const [name, q] of Object.entries(queries)) {
  const dec = declared(q);
  const sites = callSites(name);
  is(name + ' has at least one call site', sites.length > 0, true);
  for (const [v, type] of Object.entries(dec)) {
    const passed = sites.map(s => s[v]);
    const everNull = passed.some(p => p === undefined || p === 'null');
    const nonNull = /!$/.test(type);
    AUDIT.push({ name, v, type, everNull, nonNull, passed });

    /* THE RULE, both directions */
    if (everNull) {
      is(name + ' $' + v + ' is passed null, so must be declared nullable', nonNull, false);
    } else {
      is(name + ' $' + v + ' is always given a value, so must be declared non-null\n' +
         '       (a nullable one is what stopped the sync on $contentId)', nonNull, true);
    }
  }
}

console.log('\n  --- every variable in every query the sync sends ---');
console.log('  query    variable      declared        always passed?   verdict');
AUDIT.forEach(a => console.log('  ' + a.name.padEnd(9) + a.v.padEnd(14) +
  a.type.padEnd(16) + (a.everNull ? 'no, sometimes null' : 'yes').padEnd(17) +
  (a.everNull === a.nonNull ? 'WRONG' : 'ok')));
console.log('');

/* ======================================== 2. the bookmarklet can be built */

is('it parses as JavaScript', (() => {
  try { new Function(SRC); return true; } catch (e) { console.log('  ' + e.message); return false; }
})(), true);

/* A // comment inside a javascript: URL runs to the end of EVERYTHING after
   it, because the whole program is one line by the time it is a URL. */
const slashes = (SRC.match(/^[^'"\n]*\/\/(?![^\n]*['"])/gm) || [])
  .filter(l => !/https?:\/\//.test(l));
is('no double-slash comments, which a javascript: URL would swallow', slashes, []);

is('it carries a build marker', /var BUILD = '[^']+'/.test(SRC), true);
const BUILD = /var BUILD = '([^']+)'/.exec(SRC)[1];
is('and sends it with the data', SRC.includes('build: BUILD'), true);
is('and sends which sources it read', /sources: SOURCES\.map/.test(SRC), true);

/* the page must actually check both, and refuse rather than warn */
is('the page reads the current build out of the file',
   /var BUILD = '\(\[\^'\]\+\)'/.test(PAGE) || PAGE.includes("/var BUILD = '([^']+)'/"), true);
is('the page refuses a stale build', /data\.build !== WANT_BUILD/.test(PAGE), true);
is('and returns rather than offering Publish',
   /data\.build !== WANT_BUILD[\s\S]{0,900}?return;/.test(PAGE), true);
is('the page also checks which sources were read', /absent\.length/.test(PAGE), true);

/* the three workflow ids must be in the file the bookmark is built from */
const ids = [...SRC.matchAll(/id: '(w[0-9a-f]+)'/g)].map(m => m[1]);
is('all three sources are in the build', ids.length, 3);
is('and each phase is named', [...SRC.matchAll(/phase: '(\w+)'/g)].map(m => m[1]),
   ['PH1', 'PH2', 'Bulk']);

/* the encoded URL has to survive being a URL */
const url = 'javascript:' + encodeURIComponent(SRC);
is('the encoded bookmarklet is non-trivial', url.length > 4000, true);
is('and decodes back to exactly the file', decodeURIComponent(url.slice(11)), SRC);

console.log('  build ' + BUILD + ' · bookmarklet ' + url.length + ' characters encoded');
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
