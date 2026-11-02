/* lazy.test.js - opening the list must not touch a payload.

     node tools/project-update/lazy.test.js

   THIS IS docs-reachable POINTED THE OTHER WAY. That test asks whether a
   stored thing still ARRIVES on the page. This one asks whether a thing
   that should have stayed where it is was DRAGGED OFF THE SERVER anyway.
   Same failure shape, opposite sign, and the same reason neither shows up
   on its own: a page that quietly moves a megabyte looks exactly like a
   page that does not.

   WHAT IT COST LAST TIME. wh24Subscribe called a full reload per changed
   row per open tab - 689 reloads of a 1.28 MB read, about 882 MB in a
   day, and PostgREST at 96% of a month's egress. Nothing was broken.
   Everything worked. It was just moving data nobody looked at.

   Projects are bigger than tickets. Measured on four real workbooks,
   before any of this was written:

     every sheet of every project     776 kB   -   88 kB on the wire
     one card on the project list     165 B    -  141 B on the wire
     the biggest single sheet         141 kB   - 10.2 kB on the wire

   325x, widening every month because the tool keeps every upload as
   history and the cards never do.

   WHY IT ASSERTS ON THE REQUEST, NOT THE RESPONSE. fake-supabase records
   what a call asked for and deliberately does not apply it - a fake that
   filtered columns would answer "the row came back small" and hide the
   bug. So the question here is not what came back. It is WHAT WAS ASKED
   FOR. A select naming `payload` has already cost the bytes by the time
   anything is returned.

   Fixtures are invented: no real project name, file name or sheet name.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const Fake = require(path.join(ROOT, 'tools', '_lib', 'fake-supabase.js'));

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.log('FAIL ' + label + '\n  got  ' + a + '\n  want ' + b);
};

/* ---- 0. the harness guards itself ------------------------------------
   A recorder that records nothing passes everything. It must also be
   AWAITED to record at all - the builder is lazy, and the first version
   of this guard asserted on a query it never ran, which the guard then
   caught. That is the guard working. */
async function selfCheck() {
  const db = Fake.client({ t: [{ id: 1, a: 1, b: 2 }] });
  await db.from('t').select('a,b').eq('id', 1).maybeSingle();
  is('the fake records what a call asked for', db.__calls.length > 0, true);
  is('and records the column list',            db.__calls[0] && db.__calls[0].cols, 'a,b');
  const db2 = Fake.client({ t: [] });
  await db2.from('t').select('*');
  is('star is recorded as star',               db2.__calls[0] && db2.__calls[0].cols, '*');
}

/* ---- 1. db.js is the thing under test, loaded for real ----------------
   Not a copy of its column lists, so the STRUCTURAL assertions below -
   no payload, no wildcard - hold whatever those lists happen to contain.

   But reading them out of db.js is not how this test notices a column
   being added. It is how it fails to. When PU_REP_META gained n_done,
   this test gained n_done with it and said nothing; the drift was caught
   by the guard written for the count itself. A list that co-varies with
   the thing it checks is db.js echoing itself. Section 2b is the part
   that does not move. */
const DB_SRC = fs.readFileSync(path.join(ROOT, 'tools', '_lib', 'db.js'), 'utf8')
  .split('\r\n').join('\n');

const colsOf = fn => {
  const at = DB_SRC.indexOf('async function ' + fn + '(');
  if (at < 0) return null;
  const next = DB_SRC.indexOf('\n  async function ', at + 1);
  const scope = DB_SRC.slice(at, next < 0 ? at + 1600 : next);
  const m = /\.select\(([^)]*)\)/.exec(scope);
  if (!m) return null;
  const e = m[1].trim();
  const lit = /^'([^']*)'$/.exec(e);
  if (lit) return lit[1];
  const named = /^[A-Z_][A-Z_0-9]*$/.exec(e);
  if (named) {
    const arr = new RegExp('const ' + e + '\\s*=\\s*\\[([\\s\\S]*?)\\]\\.join').exec(DB_SRC);
    if (arr) return (arr[1].match(/'([a-z_0-9]+)'/g) || []).map(s => s.replace(/'/g, '')).join(',');
  }
  return e;
};

const LIST    = colsOf('puProjects');
const META    = colsOf('puReports');
const PAYLOAD = colsOf('puPayload');
const SITES   = colsOf('puSites');

is('puProjects declares what it selects', typeof LIST === 'string' && LIST.length > 0, true);
is('puReports declares what it selects',  typeof META === 'string' && META.length > 0, true);
is('puPayload declares what it selects',  typeof PAYLOAD === 'string', true);

/* ---- 2. THE ASSERTION THIS FILE EXISTS FOR ---------------------------- */
const names = s => String(s).split(',').map(x => x.trim()).filter(Boolean);
const HEAVY = ['payload', 'sites'];
/* A star select asks for the payload without ever spelling it. Treating
   '*' as "not payload" is how a wildcard slips past a column check - and
   wh24Load's select('*') is the reason this file exists, so the wildcard
   is the first thing it should refuse to be fooled by. */
const asksFor = (cols, col) => { const c = String(cols).trim();
  return c === '*' || c.split(',').some(x => x.trim() === col); };

console.log('\nwhat each read asks the server for');
console.log('  list      ' + LIST);
console.log('  reports   ' + META);
console.log('  payload   ' + PAYLOAD);
console.log('  sites     ' + SITES);

is('THE LIST DOES NOT ASK FOR payload',
   asksFor(LIST, 'payload'), false);
is('THE LIST DOES NOT ASK FOR sites either - 2.7 kB a project, and the card shows none of it',
   asksFor(LIST, 'sites'), false);
is('and it is not a star select, which would ask for both',
   LIST.trim(), LIST.trim().replace('*', '!STAR!'));
is('the report list does not ask for payload',
   asksFor(META, 'payload'), false);
is('the report list is not a star select either',
   META.indexOf('*') < 0, true);

/* the other half: the lazy fetch must actually fetch */
is('payload() DOES ask for payload', names(PAYLOAD).includes('payload'), true);
is('and asks for nothing else heavy',
   names(PAYLOAD).filter(n => HEAVY.includes(n)), ['payload']);
is('sites() asks for sites',          names(SITES).includes('sites'), true);
is('and sites() does not drag the payload along',
   names(SITES).includes('payload'), false);

/* ---- 2b. THE ALLOWLIST, WHICH DOES NOT MOVE --------------------------
   A literal set of permitted columns per read, stated here and nowhere
   else. Any column db.js asks for that is not in its set fails.

   This is the only place a reader can see what the shape is SUPPOSED to
   be, stated independently of what db.js currently says. Section 2 can
   tell you the list is free of payload; it cannot tell you the list is
   right. Adding a column to a read now costs one line here, and that
   line is a sentence saying what draws it.

   ONE DIRECTION ONLY, deliberately. A column removed from db.js does not
   fail here, because narrowing a read is the thing this file wants. A
   column the page needs and stops getting is the business of whatever
   guard reads it - which is how the n_done drift was actually caught,
   and not here. */
const ALLOW = {
  list: {
    id:         'the row key, and the card href',
    name:       'the card title',
    client:     'the card subtitle',
    created_at: 'shown on the card',
    updated_at: 'shown, and the sort order',
    n_files:    'a card count, written at upload',
    n_sheets:   'a card count, written at upload',
    n_rows:     'a card count, written at upload',
    pct:        'the bar on the card'
  },
  reports: {
    id:         'the row key, and what puPayload is called with',
    project_id: 'the filter',
    file:       'the tile heading',
    sheet:      'the tile heading',
    uploaded:   'shown, and the sort order that picks the latest',
    n_rows:     'the tile count',
    n_cols:     'the tile count',
    kind:       'which tile is drawn - mat | trk | list',
    pct:        'the tile bar',
    n_done:     'N done / N open, EXACT. Not re-derived from pct: see 047',

    items:      'the mat tile count',
    short:      'the mat tile count'
  },
  payload: { id: 'the row key', payload: 'the point of the call' },
  sites:   { id: 'the row key', sites: 'the harvest the MOD panel reads' }
};

const notAllowed = (cols, allow) => names(cols).filter(n => !(n in allow));

is('THE LIST ASKS FOR NOTHING THAT IS NOT ON THE ALLOWLIST',
   notAllowed(LIST, ALLOW.list), []);
is('nor does the report list',    notAllowed(META, ALLOW.reports), []);
is('nor the payload fetch',       notAllowed(PAYLOAD, ALLOW.payload), []);
is('nor the site harvest',        notAllowed(SITES, ALLOW.sites), []);

/* An allowlist is also the obvious place to make a failure go away by
   widening it, so it cannot be allowed to permit the one thing this file
   exists to keep off the wire. */
is('and no allowlist permits a heavy column on a read that should not carry it',
   ['list', 'reports'].filter(k => HEAVY.some(h => h in ALLOW[k])), []);
is('the allowlists are not empty, which would pass by vacuity',
   Object.keys(ALLOW).filter(k => Object.keys(ALLOW[k]).length === 0), []);

/* ---- 3. the same question of the store, by driving it ----------------
   Section 2 reads the source. This drives the real store against a fake
   client and watches every call it makes, because a column list that is
   narrow in db.js proves nothing if the store calls something else. */
const Store = require(path.join(__dirname, 'store.js'));

function stub(db) {
  /* the thin slice of window.DB the store uses, wired to the fake */
  const P = 'pu_projects', R = 'pu_reports';
  return {
    puProjects: async () => {
      const { data, error } = await db.from(P).select(LIST).order('updated_at', { ascending: false });
      return { rows: data || [], error: error ? error.message : null };
    },
    puReports: async (id) => {
      const { data, error } = await db.from(R).select(META).eq('project_id', id)
        .order('uploaded', { ascending: false });
      return { rows: data || [], error: error ? error.message : null };
    },
    puPayload: async (id) => {
      const { data, error } = await db.from(R).select(PAYLOAD).eq('id', id).maybeSingle();
      return { payload: data ? data.payload : null, error: error ? error.message : null };
    },
    puSites: async (id) => {
      const { data, error } = await db.from(P).select(SITES).eq('id', id).maybeSingle();
      return { sites: data ? data.sites : null, error: error ? error.message : null };
    }
  };
}

const PROJECTS = [
  { id: 'p1', name: 'Invented Rollout', client: 'Invented Client',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-27T00:00:00Z',
    n_files: 2, n_sheets: 20, n_rows: 3202, pct: 30,
    sites: { own: [['QQ9001', { n: 'Invented_Site_One', w: ['Invented Tab'] }]], hubs: [] } }
];
const REPORTS = [
  { id: 'r1', project_id: 'p1', file: 'Invented A.xlsx', sheet: 'Invented Tab',
    uploaded: '2026-10-27T00:00:00Z', n_rows: 2627, n_cols: 12,
    kind: 'trk', pct: 42, items: null, short: null,
    payload: { cols: ['A', 'B'], rows: [['1', '2'], ['3', '4']] } }
];

(async () => {
  await selfCheck();

  const db = Fake.client({ pu_projects: PROJECTS, pu_reports: REPORTS });
  global.window = { DB: stub(db) };
  Store.use('remote');

  console.log('\ndriving the store');

  /* opening the tool */
  const cards = await Store.list();
  is('the list came back', cards.length, 1);
  is('and the card carries its counts without any sheet being read',
     [cards[0].n_sheets, cards[0].n_rows, cards[0].pct], [20, 3202, 30]);
  const afterList = db.__calls.slice();
  is('OPENING THE LIST ASKED FOR NO PAYLOAD',
     afterList.filter(c => asksFor(c.cols, 'payload')).map(c => c.table + ' ' + c.cols), []);
  is('and touched pu_reports not at all',
     afterList.filter(c => c.table === 'pu_reports').length, 0);

  /* opening a project */
  const metas = await Store.reports('p1');
  is('the report list came back', metas.length, 1);
  is('with the tile numbers and no data', [metas[0].n_rows, metas[0].kind, metas[0].pct], [2627, 'trk', 42]);
  is('OPENING A PROJECT ASKED FOR NO PAYLOAD',
     db.__calls.slice(afterList.length).filter(c => asksFor(c.cols, 'payload')).length, 0);
  const afterOpen = db.__calls.length;

  /* the MOD panel */
  const harvest = await Store.sites('p1');
  is('the site harvest came back', !!(harvest && harvest.own), true);
  is('and still asked for no payload',
     db.__calls.slice(afterOpen).filter(c => asksFor(c.cols, 'payload')).length, 0);
  const afterSites = db.__calls.length;

  /* opening a sheet - and only now */
  const data = await Store.payload('r1');
  is('the payload came back', data && data.rows.length, 2);
  is('AND ONLY NOW WAS A PAYLOAD ASKED FOR',
     db.__calls.slice(afterSites).filter(c => asksFor(c.cols, 'payload')).length, 1);
  is('by a single id, not a list',
     db.__calls[db.__calls.length - 1].filters.some(f => f.col === 'id' && f.val === 'r1'), true);

  /* ---- 4. the prune switch, off --------------------------------------
     Written, tested, not running. Flipping KEEP_VERSIONS turns it on. */
  console.log('\nthe prune, as a switch rather than a retrofit');
  is('it ships keeping everything', Store.KEEP_VERSIONS, Infinity);
  const threeVersions = [
    { id: 'a3', file: 'F', sheet: 'S', uploaded: 300 },
    { id: 'a2', file: 'F', sheet: 'S', uploaded: 200 },
    { id: 'a1', file: 'F', sheet: 'S', uploaded: 100 },
    { id: 'b1', file: 'G', sheet: 'S', uploaded: 100 }
  ];
  is('and so discards nothing', Store.stale(threeVersions), []);
  /* and that the sweep is real rather than a stub: the same list through
     a store whose constant has been set to 2 */
  const src = fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8');
  const two = src.replace('var KEEP_VERSIONS = Infinity;', 'var KEEP_VERSIONS = 2;');
  const S2 = (() => { const m = { exports: {} };
    new Function('module', 'exports', two)(m, m.exports); return m.exports; })();
  is('set to 2, it names the versions it would drop', S2.stale(threeVersions), ['a1']);
  is('and keeps the newest of every other sheet',
     S2.stale(threeVersions).includes('b1'), false);

  /* ---- 5. the subscription is on the small table --------------------- */
  console.log('\nthe subscription');
  const dbSrc = DB_SRC;
  is('puSubscribe watches pu_projects', /c\.channel\('pu_projects_live'\)[\s\S]{0,200}table: PU_PROJ\b/.test(dbSrc), true);
  is('and nothing subscribes to pu_reports',
     /table:\s*PU_REP\b[^]{0,80}postgres_changes|postgres_changes[^]{0,120}table:\s*PU_REP\b/.test(dbSrc), false);
  is('it goes through liveChannel, so it reconciles and tears down',
     /async function puSubscribe[\s\S]{0,400}return liveChannel\(/.test(dbSrc), true);
  is('the migration publishes pu_projects',
     /alter publication supabase_realtime add table public\.pu_projects/.test(
       fs.readFileSync(path.join(ROOT, 'supabase', '047_project_update_projects.sql'), 'utf8')), true);
  is('and does not publish pu_reports',
     /add table public\.pu_reports/.test(
       fs.readFileSync(path.join(ROOT, 'supabase', '047_project_update_projects.sql'), 'utf8')), false);

  /* ---- 5b. pu_reports STAYS OUT OF THE PUBLICATION -------------------
     The assertion above reads 047 and only 047, which is the same
     mistake as reading a column list out of the thing it checks: it
     says the migration that created the table did not publish it, and
     a migration published later is exactly how it would get published.
     047's own closing comment asks the next person to read the
     paragraph first. Comments do not run.

     WHAT IT WOULD COST. pu_reports carries `payload` - 141 kB measured
     on one sheet, with nothing bounding it. postgres_changes ships the
     whole changed row, and Supabase drops oversized payloads silently,
     so publishing this table rebuilds the 882 MB fan-out with the
     heaviest column in the project attached AND a subscription that
     stops delivering without saying so. There is no version of this
     that is a small mistake.

     So every .sql in the folder, not one of them. */
  const SQLDIR = path.join(ROOT, 'supabase');
  const sqls = fs.readdirSync(SQLDIR).filter(f => /\.sql$/.test(f)).sort();
  is('there are migrations to be wrong about', sqls.length > 20, true);

  const publishes = [], dynamic = [];
  sqls.forEach(f => {
    const src = fs.readFileSync(path.join(SQLDIR, f), 'utf8')
      .split('\r\n').join('\n')
      /* a commented-out line is not a statement, and 047 ends with a
         paragraph that says the table name on purpose */
      .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    if (/add\s+table\s+(?:public\s*\.\s*)?pu_reports\b/i.test(src)) publishes.push(f);
    /* 018 adds tables through format('… add table %I', t) over a list.
       A name assembled at run time cannot be read off the page, so a
       file that does that AND mentions pu_reports is refused rather
       than assumed innocent. */
    if (/add\s+table\s+%[IsL]/i.test(src) && /pu_reports/i.test(src)) dynamic.push(f);
  });

  is('NO MIGRATION ADDS pu_reports TO supabase_realtime', publishes, []);
  is('and none builds a publication add from a name this test cannot read',
     dynamic, []);
  /* the other half, or the guard above passes in a repo that publishes
     nothing at all and proves nothing about either table */
  is('while pu_projects IS published, so the pair is actually asserted',
     sqls.filter(f => /add\s+table\s+(?:public\s*\.\s*)?pu_projects\b/i
       .test(fs.readFileSync(path.join(SQLDIR, f), 'utf8'))), ['047_project_update_projects.sql']);

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
