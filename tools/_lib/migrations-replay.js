/* migrations-replay.js - which migrations can no longer be run.

     node tools/_lib/migrations-replay.js

   WHY THIS EXISTS. I was asked which migrations needed running, could
   not read the database, derived an order from the file names, and said
   so. The order was right about the files and useless as instructions:
   ten of the eleven were already applied, and three of them COULD NOT
   HAVE RUN AT ALL against the schema the others leave behind.

     056 seeds wh_vendors          - 059 drops wh_vendors
     057 reads drum_cur            - 057 itself drops drum_cur
     059 selects from wh_projects,
         wh_parties, wh_sources    - 059 drops all three

   That is not bad luck, it is arithmetic. A migration that removes what
   an earlier one wrote to makes the earlier one unrepeatable by
   construction, and a list derived from file order cannot see it. So
   this walks the folder in order and reports every file that references
   a table or a column that it, or a later file, takes away.

   WHAT IT IS NOT. It does not say what is applied. Nothing in this repo
   can: the files do not know. A file-derived order is unverified, and
   has to be labelled that way wherever it is printed.

   Exported: conflicts() -> [{file, needs, droppedBy, kind}] */

const fs = require('fs');
const path = require('path');

const SQLDIR = path.join(__dirname, '..', '..', 'supabase');

/* comments are prose. A migration that says "wh_vendors is gone" in a
   header must not read as a reference to it - which is most of them,
   because these files explain themselves at length.

   CARRIAGE RETURNS GO FIRST, and the reason is the whole point of
   docs/reading-the-migration-state.md. In JS, . does not match \r, so
   --.*$ cannot match a comment on a CRLF line: $ sits after the \r and
   the match fails. The comment then survives stripping and every table
   named in a header counts as a reference.

   This file is LF in the repository and CRLF in a fresh clone on
   Windows, which is how CI checks it out - so the same folder gave two
   different answers, LF saying 053 needs wh_sources and CRLF saying it
   needs wh_parties and wh_projects as well, from its header prose. I
   wrote the document about this trap and then walked into it in the
   same hour. */
const strip = sql => sql
  .replace(/\r/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

function files() {
  return fs.readdirSync(SQLDIR)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map(f => ({ file: f, n: parseInt(f, 10), sql: strip(fs.readFileSync(path.join(SQLDIR, f), 'utf8')) }));
}

/* what a file takes away */
function dropsIn(sql) {
  const out = [];
  for (const m of sql.matchAll(/\bdrop\s+(?:table|view|materialized\s+view)\s+(?:if\s+exists\s+)?([a-z_][\w.]*)/gi))
    out.push({ kind: 'table', table: m[1].split('.').pop().toLowerCase() });
  for (const m of sql.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?([a-z_][\w.]*)[\s\S]*?\bdrop\s+column\s+(?:if\s+exists\s+)?([a-z_]\w*)/gi))
    out.push({ kind: 'column', table: m[1].split('.').pop().toLowerCase(), col: m[2].toLowerCase() });
  return out;
}

/* does a file USE a name - not counting the statement that removes it */
const without = (sql, d) => d.kind === 'table'
  ? sql.replace(new RegExp('drop\\s+(?:table|view|materialized\\s+view)\\s+(?:if\\s+exists\\s+)?' + d.table + '\\b', 'gi'), ' ')
  : sql.replace(new RegExp('drop\\s+column\\s+(?:if\\s+exists\\s+)?' + d.col + '\\b', 'gi'), ' ');

const word = (sql, name) => new RegExp('\\b' + name + '\\b', 'i').test(sql);

function uses(sql, d) {
  const s = without(sql, d);
  return d.kind === 'table' ? word(s, d.table) : (word(s, d.table) && word(s, d.col));
}

/* A FILE THAT DROPS SOMETHING AND PUTS IT STRAIGHT BACK is not a
   hazard, and two of them do exactly that: 002 drops sites.site_name
   and adds it again as a generated column on the next line, 015 does
   the same to feature_locks.unlocked. Re-running either is fine. What
   makes a file unrepeatable is a drop with nothing after it, which is
   what 057 did to drum_cur and 059 did to the four one-column tables. */
function healedBy(sql, d) {
  const dropAt = sql.search(d.kind === 'table'
    ? new RegExp('drop\\s+(?:table|view|materialized\\s+view)\\s+(?:if\\s+exists\\s+)?' + d.table + '\\b', 'i')
    : new RegExp('drop\\s+column\\s+(?:if\\s+exists\\s+)?' + d.col + '\\b', 'i'));
  if (dropAt < 0) return false;
  const after = sql.slice(dropAt);
  return d.kind === 'table'
    ? new RegExp('create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?' + d.table + '\\b', 'i').test(after)
    : new RegExp('add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?' + d.col + '\\b', 'i').test(after);
}

function conflicts() {
  const all = files();
  const out = [];
  for (let j = 0; j < all.length; j++) {
    for (const d of dropsIn(all[j].sql)) {
      if (healedBy(all[j].sql, d)) continue;
      const name = d.kind === 'table' ? d.table : d.table + '.' + d.col;
      for (let i = 0; i <= j; i++) {
        if (!uses(all[i].sql, d)) continue;
        out.push({ file: all[i].file, needs: name, droppedBy: all[j].file, kind: d.kind });
      }
    }
  }
  /* one line per (file, name) pair, earliest dropper first */
  const seen = new Set();
  return out.filter(c => { const k = c.file + '|' + c.needs; if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { conflicts, files, dropsIn, uses, strip, healedBy };

if (require.main === module) {
  const c = conflicts();
  console.log('migrations-replay  ' + files().length + ' files in supabase/\n');
  if (!c.length) {
    console.log('  every file could still run against the schema the others leave behind.');
  } else {
    console.log('  THESE CANNOT BE RE-RUN against the final schema:\n');
    const by = new Map();
    for (const x of c) { if (!by.has(x.file)) by.set(x.file, []); by.get(x.file).push(x); }
    for (const [f, xs] of by)
      for (const x of xs)
        console.log('    ' + f.padEnd(44) + ' needs ' + x.needs.padEnd(22) + ' removed by ' + x.droppedBy);
    console.log('\n  ' + by.size + ' file(s). A run order taken from the file names is');
    console.log('  UNVERIFIED and, for these, impossible. What is actually applied');
    console.log('  can only come from the database.');
  }
  process.exit(0);
}
