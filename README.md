<p align="center"><img src="icons/icon-512.png" alt="Emortia" width="110"></p>

<h1 align="center">Emortia</h1>

The site at **[emortia.com](https://emortia.com)** - sixteen working tools for telecom
field and office work, and the songs and poems that are the other half of it.

Built and kept by Sithara Perera.

---

## What this is

A static site. No framework, no build step, no bundler, no `package.json`. HTML, CSS
and plain JavaScript, served by GitHub Pages straight out of this repository, with
Supabase behind it for the data and a service worker in front of it so the tools keep
working on a phone with no signal at the bottom of a site.

The tools are the point. They were each written for a job that was being done by hand
— reading a design workbook, finding a jumper colour code, working out what can be
collected from the warehouse this week — and they are used in the field, not demoed.

---

## The one rule

**Every file in this repository is served at emortia.com.** There is no private
directory. A workbook committed here is a workbook published, at a guessable URL,
wanting no account and no session.

This has gone wrong before. Two lookup datasets — several thousand sites with their
contacts and access permissions, and thousands of technical profiles — were committed
once and sat openly readable until they were deleted and purged from the history. Both
tools read Supabase now and nothing else, and `.gitignore` carries a line for each one
so nothing puts them back by accident.

So: **no operational data in this repository.** Not as a fixture, not under `.work/`,
not in a test, not in a commit message. Test fixtures use invented values only.

---

## Layout

```
index.html              the whole site — home, music, poetry, the tool
                        directory, the dashboard and the owner page
Emortia.html            a byte-identical copy of index.html, mirrored by
                        hand — see docs/wh24-decisions.md
sw.js                   the service worker  (bump VERSION on every deploy)
pwa.js, manifest.json   home-screen install
tools/                  the sixteen tools, one folder each
tools/_lib/             everything shared
supabase/               numbered SQL migrations, 002 → 045 — 43 files,
                        034 absent; whether it was renumbered or dropped
                        is not recorded
docs/                   decisions and proposals
.github/workflows/      weekly database backup to R2
```

### `tools/_lib` — the shared half

The main ones. This is not a file index and does not try to be — files land here
without this table needing a line.

| file | what it holds |
|---|---|
| `access.js` | the tool registry and the three tiers, who may open what, and the account chip and its menu — the shared theme switch and the animation setting live there too, with the cross-tab listener that carries a change to pages already open |
| `db.js` | every Supabase call the tools make |
| `category.css` | the five colour families, the single source for tool chrome |
| `nav.css`, `theme.css` | the bar and the light/dark themes |
| `authgate.js`, `owner.js` | sign-in and owner mode |
| `sapdocs.js`, `qr.js`, `lookup.js` | parsers and lookups used by more than one tool |

### The sixteen tools

Grouped the way the directory groups them. The group a tool belongs to is declared
once, in `access.js`, and everything else follows from it — so this list matches what
`access.js` returns, Poetry included. Poetry is a lockable feature rather than a tool
with a folder of its own, which is why the count is sixteen and the list is seventeen.

**Emortia** — Poetry, Video & Artwork, What To Do
**Design & materials** — BOM Builder, Design Extractor, GIN Extractor, Material Codes, WH24 Material Checker
**Field operations** — Austin SWAP, ESN Sharing, Field Config, RF Jumper Codes
**People & work** — Daily Attendance, Team Directory
**Site intelligence** — Project Update, Site Access Lookup, Site Data Lookup

---

## Access

Three tiers: `public`, `tooway`, `mine`. Signing in decides what the page *draws*.

The database decides what may be *read*. Row-level security policies in
`supabase/015_roles_and_tiers.sql` and after are what actually refuse — everything in
the browser is running on someone else's machine, so when the two disagree the database
wins. That is the way round it has to be.

---

## Running it locally

Any static server from the repository root:

```bash
python3 -m http.server 8899
```

Then open `http://localhost:8899/`. Supabase is reached over the network, so the tools
that read it need a connection; the parsers and the offline tools do not.

---

## Tests

Plain `node`, no test framework, no dependencies. Each file runs on its own:

```bash
node tools/_lib/family.test.js      # colour families and tool groups agree
node tools/_lib/db.schema.test.js   # every db.js call matches a migration
node tools/_lib/regex.test.js       # no regex has lost its backslashes
node tools/wh24/wh24.test.js        # and so on
```

**23 test files across 16 tools, and the cover is uneven.** Some tools have several —
wh24 and design-extractor have three each. **Four tool folders have none: GIN Extractor,
RF Jumper Codes, Site Access Lookup, Site Data Lookup.** Named here because a README
that implies full coverage is worse than one that says where the holes are.

GIN Extractor is the exception to its own line. The folder has no test file, but the
parsing is not in the folder — both SAP documents are read by `tools/_lib/sapdocs.js`,
shared with WH24, and that carries 97 assertions. What was untested there was not the
parsing but the **refusal**: whether the reader can tell a note that issued nothing
from a note whose table it no longer recognises. It could not, and `tableFound` is the
answer; see the decisions file. The other three are UI over a Supabase read, which
fails loudly.

`family.test.js` is the strictest and exists for a specific bug: tool pages used to each
pick their own accent colour, so a tool showed one colour on the directory and opened in
another. It ties three places together — the group in `access.js`, the `data-cat` on the
page, and the block in `category.css` — and refuses a tool that declares an accent of its
own.

**A guard is never relaxed to match the code it guards.** If a measured value fails an
assertion, the value changes. When a threshold genuinely has to move, the old one stays
in the file as a dated comment.

**And a fix is not verified until it is read off the rendered page.** Source edits are
not evidence. A correction can be complete in the file and absent on the screen — a
shared sheet using `!important`, a later stylesheet winning the cascade, a service worker
holding the last deploy. That has happened enough times here to be a rule.

---

## Deploying

Push to `main`. GitHub Pages serves it; `CNAME` points at emortia.com and `.nojekyll`
stops Jekyll touching it.

**Bump `VERSION` in `sw.js` on every deploy.** Nothing else in that file needs touching.
Changing the string changes the worker's bytes, which is what makes the browser install
a new one; activating it deletes every cache that is not the current version's, so
nothing from the last deploy survives into this one.

HTML and JS are network-first, always — a stale page is a fallback for when the network
is genuinely gone, never a first choice. The suite was broken once by a worker that
answered `if (cached) return cached` to everything, including its own config; fifteen
deploys went out underneath it.

---

## Database

Migrations are numbered and run in order against Supabase. They are additive — an
`alter table ... add column if not exists` runs twice without complaint, and the ones
written before that was a rule are the ones that caused trouble.

A GitHub Action dumps the database to Cloudflare R2 every Sunday at **18:00 UTC**
(`0 18 * * 0` — half past eleven on Sunday night in Colombo), and on demand from the
Actions tab. Three passes, in order: roles, schema, data. A schema-only dump
restores an empty database, which is the worst kind of backup — the kind that looks like
it worked.

**Supabase Storage is not covered by any database backup, on any plan.** Files in buckets
are backed up separately or not at all.

---

## Decisions

`docs/wh24-decisions.md` is the standing record: what was decided, when, why, and which
earlier decision it reversed. Reversals are written as reversals — the superseded entry
stays, with the date it stopped applying. The point is that the next person to look at a
value finds the reasoning, not just the number, and does not "fix" something back to the
way it was broken.

`docs/whattodo-delete-proposal.md` was written to be read and argued with before
anything was wired, and it was — **the feature shipped**. Migration 045 added
`deleted_at`; `removeTodo` soft-deletes rather than destroying; restore, the bin and
purge are all wired; removing takes a two-step confirm and can be undone; and a
finished task is never swept, whatever its age. The document stays listed because it
is now the record of how that was decided, which outlasts the decision.

---

## Licence

No open licence. The code is public so it can be served; it is not offered for reuse.
Not accepting contributions — this is one person's working toolkit, and a pull request
would be read but not merged.

Questions are welcome through the site.
