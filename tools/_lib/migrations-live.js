/* migrations-live.js - does the DATABASE have this migration, or only
   the repository?

     node tools/_lib/migrations.test.js --live

   WHY THIS EXISTS, in one sentence each way round:

     054 sat unrun for a day while the guard that validated it was green,
     because every guard in this repository reads files.

     Then, a day later, 054 was reported as still outstanding when it had
     been live for hours - the same blind spot, pointing the other way.

   Both were wrong, both were confident, and neither could have been
   caught by anything in the suite, because nothing in the suite had ever
   asked the database a question.

   WHAT IT CHECKS. A migration that creates a table or a column is
   already covered - migrations.js probes for it. The gap is the
   function-only migration, which creates nothing to probe. So for each
   of those this takes a MARKER out of the function body - a line long
   and specific enough to belong to that version and no other - and
   asserts the live pg_proc.prosrc contains it. If a later migration
   re-emitted the function, the marker comes from the last definition,
   which is the one the database should be running.

   WHY IT CANNOT GATE CI. It needs credentials, and a public repository
   is the last place to put them. Run it either side of applying a
   migration; with no token it exits 2, which the runner reads as a
   declared skip rather than a pass.

   It asks through the Supabase management API because pg_proc is not in
   the public schema and PostgREST will not serve it. Nothing is
   installed for this: one HTTPS POST. */

'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..', '..');
const SQLDIR = path.join(ROOT, 'supabase');

/* ---- the markers, from the files ------------------------------------ */

/* A MARKER HAS TO PROVE RECENCY, NOT JUST IDENTITY, and the first
   version of this got that wrong in a way worth recording. It picked any
   line unique among the latest definitions - which for most functions
   was the `declare` line. But a declare line is usually identical in the
   version before it, so a database still running 056 would have matched
   a marker taken from 057 and been reported up to date. The guard would
   have been confidently wrong in exactly the direction it exists to
   prevent.
   So a marker must appear in the LAST definition and in NONE of the
   earlier ones. That is the only property that answers the question
   being asked: is the database running THIS version, or an older one? */
function markers() {
  const files = fs.readdirSync(SQLDIR).filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const all = new Map();            // fn -> [{body, from}, ...] in order
  for (const f of files) {
    const sql = fs.readFileSync(path.join(SQLDIR, f), 'utf8');
    const rx = /create\s+or\s+replace\s+function\s+([a-z_][a-z0-9_]*)\s*\([^)]*\)([\s\S]*?)\$\$;/gi;
    let m;
    while ((m = rx.exec(sql))) {
      const k = m[1].toLowerCase();
      if (!all.has(k)) all.set(k, []);
      all.get(k).push({ body: m[2], from: f });
    }
  }
  const out = [];
  for (const [fn, defs] of all) {
    const last = defs[defs.length - 1];
    const earlier = new Set();
    for (let i = 0; i < defs.length - 1; i++) for (const l of lines(defs[i].body)) earlier.add(l);
    const cand = lines(last.body).filter(l => l.length >= 40 && !earlier.has(l));
    out.push({ fn, from: last.from, versions: defs.length, marker: cand[0] || null,
               why: cand.length ? null
                 : (defs.length > 1
                    ? 'every line in it also appears in an earlier version, so no line can tell them apart'
                    : 'no line in it is long enough to be a marker') });
  }
  return out;
}
/* Candidate lines: executable body only. Comments are out because they
   get copied forward verbatim; so is the function header, because
   "language plpgsql security definer set search_path = public as $$" is
   the same in every function in this repository and would match any of
   them - a marker that matches anything proves nothing. */
function lines(body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, '\n').split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('--')
      && !/^(begin|end|declare)$/i.test(l)
      && !/^language\s+plpgsql/i.test(l)
      && !/^returns\s/i.test(l)
      && !/^(security\s+definer|set\s+search_path|stable|volatile|immutable)\b/i.test(l));
}

/* ---- asking the database -------------------------------------------- */

function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try {
    const cfg = fs.readFileSync(path.join(__dirname, 'supabase-config.js'), 'utf8');
    const m = cfg.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (m) return m[1];
  } catch (e) {}
  return null;
}

function query(sql, token, ref) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request({
      host: 'api.supabase.com', method: 'POST',
      path: '/v1/projects/' + ref + '/database/query',
      headers: { 'Authorization': 'Bearer ' + token,
                 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let t = '';
      res.on('data', d => t += d);
      res.on('end', () => {
        if (res.statusCode !== 200 && res.statusCode !== 201)
          return reject(new Error('HTTP ' + res.statusCode + ': ' + t.slice(0, 200)));
        try { resolve(JSON.parse(t)); } catch (e) { reject(new Error('unreadable reply: ' + t.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = projectRef();
  const M = markers();

  console.log('--- is the database running what the repository says? ---');
  console.log('  function-only migrations to check: ' + M.length);

  if (!token || !ref) {
    console.log('');
    console.log('COULD NOT RUN - no credentials.');
    console.log('  Set SUPABASE_ACCESS_TOKEN (a personal access token) to run this.');
    console.log('  It is deliberately not available in CI: this repository is public,');
    console.log('  and a guard that reads the database needs something CI must not have.');
    console.log('  Run it either side of applying a migration.');
    process.exit(2);
  }

  const names = [...new Set(M.map(m => m.fn))];
  const sql = 'select proname, prosrc from pg_proc where proname in ('
    + names.map(n => "'" + n.replace(/'/g, "''") + "'").join(',') + ')';
  let rows;
  try { rows = await query(sql, token, ref); }
  catch (e) {
    console.log('\nCOULD NOT RUN - ' + e.message);
    process.exit(2);
  }
  const live = new Map();
  for (const r of (Array.isArray(rows) ? rows : [])) live.set(r.proname, r.prosrc || '');

  let pass = 0, fail = 0, unknown = 0;
  for (const m of M) {
    const src = live.get(m.fn);
    if (!m.marker) {
      unknown++;
      console.log('  ?    ' + m.fn + '  (' + m.from + ') - ' + m.why);
      continue;
    }
    if (src == null) {
      fail++;
      console.log('FAIL ' + m.fn + '  (' + m.from + ') is NOT IN THE DATABASE AT ALL');
      continue;
    }
    if (src.includes(m.marker)) { pass++; console.log('  ok   ' + m.fn + '  (' + m.from + ')'); }
    else {
      fail++;
      console.log('FAIL ' + m.fn + '  the database is running an OLDER version than ' + m.from);
      console.log('       missing: ' + m.marker.slice(0, 90));
    }
  }

  console.log('');
  console.log(pass + ' up to date, ' + fail + ' behind or missing, ' + unknown + ' unknown');
  /* the same rule the file-based checker uses: never call a run clean
     while anything is unknown */
  if (unknown) console.log('A function with no usable marker cannot be checked, so this run is not clean.');
  console.log('\n' + pass + ' passed, ' + (fail + unknown) + ' failed\n');
  process.exit(fail + unknown ? 1 : 0);
}

module.exports = { markers, lines, main };
if (require.main === module) main();
