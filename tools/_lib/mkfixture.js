/* mkfixture.js - the real tool page, with no database behind it.

     node mkfixture.js <repoRoot> <tool> [...]

   Why this exists: every browser check this month - contrast, canvas
   pixels, computed style, geometry - loaded the live tool, which opens a
   Supabase client on parse and pulls rows nobody was measuring. None of
   those checks needed a single real row.

   HOW IT AVOIDS THE DATABASE, without changing a line of production code:
   supabase-config.js says, in its own comment, that until the keys are
   filled in "the tools fall back to the data.json committed in the
   repository, so the site keeps working - it just will not sync". db.js
   honours that at the one seam it has:

       function client(){ if (!CFG.url || !CFG.anonKey) return Promise.resolve(null); ... }

   So the harness is the real index.html with one script injected ahead of
   db.js that blanks the config. No network, no client, no subscription -
   through a path the code already had and already documents.

   It is GENERATED, never committed - .gitignore carries the __fixture.html
   glob beside the __hdr.html one. It sits next to the real page so every
   relative path - ../_lib/, img/, the skins - resolves exactly as it does
   in production. The page is otherwise byte-identical, which is the whole
   point: this is still the rendered page, not a mock of it.

   Seeded rows are SYNTHETIC. Invented names, invented sites. The repo is
   public and the fixtures are not. */

const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const TOOLS = process.argv.slice(3);
if (!ROOT || !TOOLS.length) {
  console.error('usage: node mkfixture.js <repoRoot> <tool> [tool...]');
  process.exit(2);
}

/* Injected before any of the tool's own scripts. Blanking the config is
   what stops the client being built at all; the rest is scaffolding so the
   page has something to lay out. */
const STUB = `<script>
/* ---- generated check harness, not part of the site ---- */
window.SUPABASE_CONFIG = { url: '', anonKey: '' };   /* no client, no network */
window.__EM_FIXTURE = true;
/* A signed-in-looking local session so the gate does not hold the page.
   It reaches nothing: there is no client to reach it with. */
try {
  localStorage.setItem('em-access', JSON.stringify({
    user: 'fixture', email: 'fixture@localhost', epoch: '1',
    since: Date.now(), until: Date.now() + 864e5, role: 'owner', roleKnown: true
  }));
} catch (e) {}
/* Synthetic rows so the states that only render WITH data are reachable -
   a completed task, a removed one, a carried-over one. Invented throughout. */
try {
  const today = new Date().toISOString().slice(0, 10);
  const back = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  localStorage.setItem('whattodo_tasks', JSON.stringify([
    { id: 'fx1', title: 'Check the north gate lamp', day: today,
      steps: [{ t: 'Collect the lamp', done: true }, { t: 'Fit it', done: false }], done: false },
    { id: 'fx2', title: 'File the week report', day: back(1),
      steps: [{ t: 'Draft', done: true }], done: true, doneAt: back(1) + 'T09:00:00Z' },
    { id: 'fx3', title: 'Return the spare cable', day: back(3),
      steps: [], done: false, deleted_at: back(2) + 'T10:00:00Z' }
  ]));
} catch (e) {}
</script>
`;

for (const tool of TOOLS) {
  const src = path.join(ROOT, 'tools', tool, 'index.html');
  const out = path.join(ROOT, 'tools', tool, '__fixture.html');
  if (!fs.existsSync(src)) { console.error('no such tool: ' + tool); process.exit(1); }
  const html = fs.readFileSync(src, 'utf8');

  /* AFTER supabase-config.js, not before it. The first attempt sat in front
     of every script and was simply overwritten: supabase-config.js assigns
     window.SUPABASE_CONFIG itself and loads later, so the blanked config
     lasted about four lines. It has to go between that file and db.js,
     which is the only window where the value is set and not yet read. */
  const m = /<script[^>]*supabase-config\.js[^>]*><\/script>/i.exec(html);
  if (!m) { console.error(tool + ': no supabase-config.js tag to sit behind'); process.exit(1); }
  const at = m.index + m[0].length;

  fs.writeFileSync(out, html.slice(0, at) + '\n' + STUB + html.slice(at));
  const kb = n => (n / 1024).toFixed(1) + ' KB';
  console.log('  ' + tool + '  ->  tools/' + tool + '/__fixture.html   ' +
    kb(html.length) + ' + ' + STUB.length + ' B stub');
}
