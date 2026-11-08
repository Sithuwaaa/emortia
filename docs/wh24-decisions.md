# WH24 Material Checker — the decisions

Settled, with reasons. Written down so neither of us re-argues them, and so
that the next person to open this file does not "fix" something that is the way
it is on purpose.

---

# Standing rules — read these first

## A tool is finalised when Sithara says so

After that, **its own files are not touched unless that tool is the subject
of the request.** Not to tidy something noticed in passing, not to apply a
pattern that has just been agreed elsewhere, not because a guard would be
greener. Raise it and wait.

A finished tool is finished because it works and it has been used, and the
cost of being wrong in it is paid by somebody standing at a warehouse
counter rather than by the person who made the change.

## A change to `db.js` or anything in `tools/_lib/` is a change to all seventeen tools

This is the rule the one above does not cover, and it is the one that has
actually broken things. Both of 26 October's breakages came from shared
code while every tool file sat untouched: a narrowed read took the Download
button off every opened WH24 ticket, and a duplicated class map painted the
Year Goals card in another tool's colours.

Before a change to shared code ships, it has **two halves, and they belong
to different people.** Saying "I checked it" without naming which half was
done is how the same sentence came to mean two different things.

### Claude's half — the code-level pass

1. **Name every tool that calls the thing being changed.** Not "the tools
   that use db.js" — the specific functions, and who calls them.
2. **Say what each one would show if the change were wrong.** Out loud, in
   the commit or the report. "The Download button would not render" is the
   sentence that was never written, and writing it would have been enough.
3. **Read every callback**, not only the ones that look relevant. The false
   toast was in three call sites; four tools were named as affected and the
   other six were cleared only by reading what their reloads actually did.
4. **Report a before/after table, one row per tool.**

This half is exhaustive and mechanical, and it is good at what it is good
at: it found all three toast sites and all ten `liveChannel` callers.

### Sithara's half — the signed-in pass

He opens the named tools on **emortia.com, signed in**, and looks.

**Claude cannot do this and must not try.** The browser pane is not signed
in to his account and must not be. A fixture, a localhost page and a green
suite are all the same thing here: they prove the code does what it was
written to do, not that the tool still does what it is for.

### The handover is the last section of the report, every time

Not a courtesy at the end of a good report — the required final section.
It names:

- **which tools** to open,
- **what to do on each** (leave it backgrounded and come back, change a row
  from another device, open a ticket),
- **what he should see**, and what would mean it is wrong.

### And the change is not verified until that half is done

Say so plainly rather than letting a push read as completion. Two shared-code
breakages in three days were caught at exactly that step — the Download
button, and the false toast — and in both cases the code-level pass had
already come back clean and the suite had already come back green.

**That is not the rule failing. That is the rule working.** But it only
works if the handover is expected rather than remembered, which is why it
is a required section and not a habit.

> **If that list is long enough to be tedious, that is the signal the change
> is bigger than it looks — not a reason to skip the list.**

The tedium is the information. A shared-code change whose blast radius is
one tool is a small change; one whose radius is eleven is an architectural
decision wearing a small diff, and the length of the list is the only thing
that says which it is before it ships.

### Why the suite does not discharge this

Every guard in this repository was written after something went wrong, and
therefore watches a thing that has already gone wrong once. A shared-code
change can be green across two thousand assertions and still remove a
feature, because no test asserted the feature was reachable — which is
precisely what happened. `tools/wh24/docs-reachable.test.js` exists for
that one chain now. The other sixteen tools have no equivalent.

So the suite tells you that what was checked still holds. It cannot tell
you that what you removed was unused.


Each of these was paid for by a bug. The reason matters more than the rule —
a rule without its reason gets tidied away by the next person who finds it
inconvenient.

---

## 1. Never assert what WorkHub does not record

No record, no claim.

A Bulk request has no issuance step anywhere in its workflow, so nothing on the
card is evidence that any material moved. A Bulk row therefore never enters
"Can collect", has its own band, and shows **not tracked** rather than *not
yet* — because *not yet* implies somebody is going to fetch it.

The same rule is why a PH2 stream with no issuance note is not ready no matter
what its stage says, and why a document the tool has not stored is named on the
ticket rather than given a download button that would not work.

## 2. Problems are per ticket, not per tool

Isolate and label them. Never hedge the healthy rows to cover the broken ones.

The temptation with every ambiguous case is to qualify everything — brackets
everywhere, "approximately" everywhere — and the result is a tool nobody can
read and a backlog nobody can act on.

So a row the tool can state confidently reads plainly: exact date, exact day
count, no brackets and no qualifiers. A row it cannot is pulled into **Needs
checking** with one sentence saying why, and settled by hand. Exceptions being
visible and few is the point.

## 3. When two readings are possible, show the range

Never pick the one that makes the backlog look smaller.

An unattributed collection lies between the earliest confirmation that could
have been it and the latest on the card. The row says both ends and both day
counts — *110 to 293 days* — not the near end alone. One qualifying
confirmation collapses the bracket to a single date, and the row reads like any
other.

This applies only inside Needs checking. See rule 2.

## 4. Errors must under-claim readiness, never over-claim

A missed row costs a delay. A phantom row costs a wasted trip to the warehouse
and, the second time it happens, the team's trust in the whole tool.

So every ambiguous case resolves towards *not ready*: no readable date means
not ready, no note means not ready, a confirmation that might belong to another
stream still stops this one's clock. The counts under-report rather than
over-report, and an under-count that announces itself is fine — one that looks
like good news is not, which is why Needs checking carries a count beside the
collectable one.

## 5. Verify by exercising the code path

A check that passes when the thing under test is not running is not a check.

Three times this has mattered:

- A signed-out read returned `200 []` from three tables — which is what you get
  whether RLS works or not when the tables are empty. The check passed for the
  wrong reason.
- A green suite proved nothing because the fixture had been written to agree
  with the code rather than with the form. Correcting the stage names broke five
  tests, all of them the fixture.
- The dry run showed 0 collectable PH1 rows, so PH1's collection path never ran
  in it. It had to be exercised deliberately against a card that has a closed
  Done task before it could be called audited.

Assert on real return values. Slice the shipped code and run it rather than
retyping a copy of it.

## 6. Three sources, three different rules, on purpose

**PH1 believes the stage.** The last task whose name starts *System Issuance
Done*, and `done_at` is when that task was created. This has held across 384
rows and the stage is PH1's only signal.

**PH2 believes the document.** A stream is ready when it has a reservation AND
an issuance note attached; the note is the binding half. A PH2 stream can show
*System Issuance Done - ACE* with no note attached at all — seen on real cards.
`done_at` is the note's own document date, and with more than one note it is the
**earliest**, because a second delivery must not make a row younger and bury the
oldest thing in the queue.

**Bulk takes the LAST completed initiation.** A repeated *Material Reservation
Initiation* means the earlier attempt was rejected and voided — initiated,
rejected two days later, re-initiated three months on. The earliest occurrence
is a dead end, not a start date.

Note that PH2's repetition rule and Bulk's are opposite. They are opposite
because the repetitions mean opposite things: another PH2 note is *more*
material, another Bulk initiation is the *first one voided*.

**Do not "fix" one of these to match another.** Making PH1 wait for a document
would empty its list. Making PH2 trust its stage would fill its list with
material nobody has issued.

## 7. Times are UTC in, Colombo out

WorkHub's GraphQL returns UTC with the zone marker missing — `2026-08-19T09:20:02`,
not `…Z`. Its own UI renders Asia/Colombo, so that card reads 02:50 PM there.

Proved from inside the data: WorkHub builds each card's title with a human
timestamp in it and also returns `created_date` for the same event, and across
the cards whose titles carry their creation time, title minus API is **+5.50 h
exactly**, every time.

So: `workhub.js` appends the Z that WorkHub omits, the database stores UTC, and
`localDay()` converts to the local day before any date arithmetic.

Getting this wrong by 5.5 hours does not look like a bug. It silently moves
anything issued after 18:30 Colombo into the previous day's bucket, so a row
reads one day younger than it is and sorts below rows it should sit above.
Nothing on screen would say so.

## 8. No real Dialog data in the repo

The repository is public and GitHub Pages serves every file in it.

Synthetic values only in fixtures, tests, comments and commit messages:
`SITE-001`, `MAT-0000001`, `SN-TEST-0001`, reservations in the `17000xx` range.
Real site codes, material codes, equipment serials, reservation numbers, order
numbers and people's names stay out — including out of `.work/`, which is
gitignored but is not a safe place to put them either.

Field NUMBERS and stage NAMES are form structure rather than data and are fine
to record; the values in those fields are not.

Every token in a fixture has been checked against a real dump for collisions.
Do that again when adding one.

---

## Known debt: the theme button is hidden, not removed

Every tool grew its own ☀/◐ button in its header. The setting moved into the
account menu — which is on every page, so one control instead of sixteen — and
the old buttons are now hidden by one rule in `tools/_lib/nav.css`:

```css
.hdr .theme, .hdr #themeBtn { display: none !important; }
```

**They are still in the markup of all sixteen tools.** This is deliberate, and
it is debt.

**Why hidden rather than deleted.** Each tool's own script binds to the button
on load — `$('themeBtn').onclick = …` — and several read it again when they
repaint their header. Deleting the element from sixteen files without also
editing sixteen scripts throws a TypeError on page load in every one of them,
which takes the whole tool down, not just the button.

**What removing it properly takes**, per tool:

1. delete the `<button class="theme" id="themeBtn">` from the header markup
2. delete that tool's `paintTheme()` and its `$('themeBtn').onclick = …`
3. leave the tool reading `document.documentElement.dataset.theme`, which
   `access.js` sets on the way in — the tool keeps its light mode, it just
   stops owning the switch
4. check the tool's own storage key: `access.js` writes every existing
   `*.theme` key as well as `em-theme`, so a tool that keeps reading its old
   key still works, but one whose key is only written by the deleted handler
   will stop remembering

It is sixteen small, identical, independently verifiable edits and no shared
code changes. Do them in one pass or not at all — half-done leaves two
controls disagreeing on some pages.

**Until then:** the button exists, is bound, and works. It is simply not
drawn. A tool that opens it another way would still toggle the theme, and
because `access.js` writes every `*.theme` key, the two would agree.

---

## The stream model, and why it is two rows

A PH2 card is a site work order carrying two parallel vendor streams. One row
per card could hold only one of their answers.

The evidence, which fell out of the ordering test rather than being assumed:

```
System Issuance Done - ACE   opened 2025-11-27
  the Activity Report attached to the ACE field     27.11.2025
System Issuance Done         opened 2026-03-05
  the Goods Issue Note attached to the Advantis field   05.03.2026
```

Two tracks on one card, three months apart, each vendor's document carrying the
date its **own** track opened, to the day. The suffixed track pairs with the
Activity Report and the unsuffixed one with the Goods Issue Note — and nothing
about that was inferred from the vendor names.

---

## Documents are stored byte for byte, or not at all

The rule, because it is the whole point of the feature: the file in the tool is
the file attached to the WorkHub card, unaltered. Nothing is generated,
rebuilt, re-rendered or reconstructed. A ticket with no document attached shows
**nothing** – no entry, no button, no placeholder. If it is not in WorkHub24 it
does not exist, and the tool says nothing rather than inventing something.

### What went wrong, and why nothing noticed

`pdf.js` **transfers** the ArrayBuffer handed to `getDocument({data: buf})`.
The moment the sync parsed a GIN, that buffer was detached in the page's
thread – the bytes had moved to the pdf.js worker. The buffer kept for upload
was that same, now-empty object.

`new Blob([a detached buffer])` is an empty blob. From there:

| layer | what it reported |
|---|---|
| `storage.upload` | success |
| the row | a path |
| the page | a Download button |
| `createSignedUrl` | a working URL |
| Chrome | *Failed to load PDF document* |

Every layer above and below called it a success. A zero-byte file is the one
kind of corrupt that nothing in the chain can see — which is the same shape as
the silent no-op before it: a failure whose only symptom is in a different
program.

An ArrayBuffer can be read once. The fix is to stop asking it to be read
twice: copy the bytes first, verify the copy, hand the **disposable** original
to pdf.js and let it detach that.

### Three checks, deliberately not shared

1. **On arrival**, before the bytes are used for anything: first four bytes are
   `%PDF` and length ≥ 1024 (`W.isPdf`). A 200 response carrying a sign-in page
   or a JSON error is a successful `fetch` and a successful `arrayBuffer()`, and
   it is called `.pdf` by the time anything looks at it. Four bytes settle it; a
   `content-type` header is the server's opinion, this is the file itself.
2. **At publish time**, again — publish is a separate click minutes after the
   read, and what broke this was a buffer that stopped being readable between
   the two.
3. **Inside `wh24PutDoc`**, which does not share the code above. It is the only
   function in the system that can write to that bucket, and the bucket has no
   backup. Both checks must be removed to get a broken file in.

A refusal is never silent: the publish dialog names the count and every
filename. A refused document produces no gin entry at all, so it cannot render
as a broken button; it is re-fetched on the next sync and refused again, loudly,
until the file in WorkHub is actually a PDF.

`knownFiles()` counts a file as known only once it has a **path** — once it is
genuinely in the store. Gating on the *name* instead meant a document already
parsed would never be downloaded again, so no amount of re-syncing could ever
fill the bucket for the rows that already existed.

**Repair:** `supabase/043_wh24_clear_bad_docs.sql` — look at the sizes, empty the
bucket, clear the paths off the rows. Both halves: a path with no file behind it
is a row the sync will never fix.

### The repair deletes nothing

Supabase blocks `DELETE FROM storage.objects` with a trigger
(`42501: Direct deletion from storage tables is not allowed`), which turned out
to stop a deletion that was never needed.

`wh24PutDoc` uploads with `upsert: true`, and `wh24DocPath` is a pure function
of the ticket id, the stream, the site and the GI or report number — no date,
no counter, no random segment, nothing from the sync that produced it. So the
same document is always the same path, and a re-sync writes the real bytes
**over** the zero-byte object already sitting there.

Clearing the paths off the rows is therefore the entire repair: no file is ever
removed from the one part of this system with no backup.

Both of those properties are now asserted in `db.schema.test.js`, because
neither breaks loudly. Put a timestamp in the path and every re-sync writes a
new object beside the broken one for ever; turn `upsert` off and the second
upload fails and every corrupt file stays corrupt. In both cases the dialog
would still say *N documents stored*.

One known hole in determinism, asserted rather than discovered: two documents
on the same ticket and stream that **both** fail to yield a number land on
`no-number.pdf` and the second overwrites the first. A document with no number
is a document nothing can name, so this is the behaviour rather than a bug.

The other limit is the sync window. A file is only overwritten if this sync
fetches it, and the sync reads only tickets raised on or after **Tickets
since** — so that date has to go back far enough to cover every ticket holding
a document, once. Anything missed keeps its zero-byte file and its row stays
truthful but empty: no path, no button, nothing offered to anybody.

### The fifth one, and it was the check

043 step 4 tested whether a document had been stored with

```sql
gins::text like '%"path": "_%'
```

In `LIKE`, `_` matches **any single character — including the closing quote**,
so `{"path": ""}` matched it. The query counted every row that had a `path`
*key*, empty or not. It could not return `0` while any document existed
anywhere in the table, so it reported 365 rows as stored immediately after they
had all been cleared, and the `UPDATE` took the blame.

Two things made it hold up for an evening:

- The `UPDATE` had no `RETURNING`, and an `UPDATE` with no `RETURNING` prints
  *Success. No rows returned* in the Supabase SQL editor whether it changed
  every row or none. The message is about the absence of a result set, not the
  absence of work.
- The verification query was confidently wrong in the direction of "not done",
  so re-running the `UPDATE` looked like the reasonable response.

This one is the inverse of the other four. The no-op upload, *All 0 tickets
already match* and the zero-byte files were all a **failure that read as
success**. This was **work that read as failure** — which is less dangerous and
more expensive, because the response to it is to do the work again.

The shared cause is the same every time: a count of zero, or a check that
cannot return the value meaning *fine*, rendered as something other than a
sentence.

**Fixed:** step 3 reports `rows_changed` and `paths_cleared` from a `RETURNING`,
so `0 / 0` now plainly means *already done*. Step 4 walks the array and compares
the value — no `LIKE`, no `::text`, no pattern to be reasoned about at eleven at
night. A new **step 0** prints one whole `gins` value with `jsonb_pretty`, so
the structure is read rather than assumed.

`db.schema.test.js` now refuses `<jsonb column>::text like` in any file under
`supabase/`, and — because a lint that matches nothing passes for ever —
asserts first that the pattern still catches the exact line step 4 shipped
with.

### A downloaded document is called by its reservation number

`1776693.pdf`. No site code, no GI number, no underscores.

The reservation is what the warehouse, the indent and the ticket are all filed
under, so it is the number a saved file has to carry. Taken from **the
document**, never the ticket: a ticket can carry two — 1764339 and 1776693 —
and each GIN names the one it was issued against.

Falling back to the GI number, then the report number, then `document.pdf`. An
Activity Report has neither a reservation nor a GI (`moveShape` sets both to
`''`), so without the fallback that file would have been called `.pdf`.

**The storage path did not change and must not.** `wh24DocPath` stays a pure
function of id/stream/site/gi, because `upsert` only overwrites in place while
a document's path never moves — and the objects already up there cannot be
deleted from SQL, so a rename orphans every one of them at an address nothing
can reach. The download name and the storage path are different things; only
one of them is free to change.

#### The collision, and how it is resolved

Two GINs issued against one reservation would save under one name. There are
**13 such tickets**, and every one is the same shape: same stream, two GINs,
**exactly one day apart** — a partial issuance and its remainder across
midnight, not two unrelated events. The earlier guess that "different dates"
meant two separate events was too coarse; these are one event spanning a date
boundary.

So where a name would be shared, the document date is appended **to each** of
them:

```
1718878 2026-04-28.pdf
1718878 2026-04-29.pdf
```

and where it would not, the name stays the bare reservation number. **Dates are
not appended to everything.**

Decided per ticket from the documents actually on it, never from a stored flag,
so it stays correct as documents are added or drop off. That is why `docsBox`
calls `W.docNames(gs)` once over the list and indexes the result, rather than
`W.docName(g)` inside the map: a name can only be known to collide against the
others on its own ticket.

Three tiers, and only the entries still clashing move to the next:

1. the reservation number
2. `+ date` – what tells a partial from its remainder, and what you are reading
   the document for
3. `+ GI number` – unique, but it identifies the paperwork rather than the
   movement, so it is a last resort

Then a numbered suffix as a guarantee, because sanitising can itself turn two
different numbers into one name, and **two files must never come down as one**.
Matched case-insensitively: the machines these land on do not tell
`Reservation.pdf` from `reservation.pdf`.

One case needs no help at all: **a GIN and an Activity Report cannot collide.**
The report carries no reservation and no GI, so it falls through to its own
report number. That was the case that would have been worst – two vendors'
paperwork under one name on a PH2 card – and it was never possible.

#### The name has to be signed in, not attached

`<a download="1718878 2026-04-29.pdf">` did nothing. **The `download`
attribute is ignored for cross-origin URLs** — the signed URL is on
`supabase.co` and the page is not, so the browser dropped the computed name and
saved the file under its storage path, `CM5736____4931212559.pdf`.

Everything above the browser reported success: the name was computed correctly,
it was on the button, and the test asserted it was on the button. Exactly the
shape of the zero-byte uploads — every layer agreeing while the only program
whose opinion matters disagrees.

The name has to be known **before** the URL is signed:

```js
createSignedUrl(path, 300, { download: '1718878 2026-04-29.pdf' })
```

Supabase answers that with `Content-Disposition: attachment`, which comes from
the same origin as the bytes and is therefore honoured.

**Consequence, deliberately accepted:** `attachment` makes the file **save**
rather than open in a tab. So `download=` and `target="_blank"` are both gone
from the anchor — the first because it never worked, the second because a
`Content-Disposition` response would flash a tab open and abandon it.

**One hazard found by reading `storage-js` rather than assuming it.** The option
is not sent as a body field; it is appended to the URL as `&download=<name>`,
and the whole URL is then passed through `encodeURI`, which leaves `& ? # + %`
untouched. A name containing any of those would be read as more URL and the
filename would truncate at the first one. `docClean` already strips everything
outside `A-Za-z0-9._ -`, so it cannot happen — and that is now asserted with
the reason attached, because the sanitiser otherwise looks like mere tidiness.

**The test changed with it.** `page.test.js` no longer checks `data-name` on the
element. It drives the real click handler against a fake `wh24DocLink` and
asserts the resolved name reaching the signing call, that no `download` or
`target` is set on the anchor, and that a colliding pair signs with both dates.
`db.schema.test.js` runs the real `wh24DocLink` against a fake client and reads
the options object it actually hands over — including that a missing name sends
no `download` option at all, rather than `download: ''`.

---

## The dark theme revision, and the logo reversal

Applied 12 October 2026. The five category colours, the three-rung elevation
ladder and the token table are the brief's; what follows is only the things
decided *against* an earlier instruction, or decided by measurement, so that
nobody reading the older notes "fixes" them back.

### The logo is the brand mark. It stays Emortia pink, everywhere.

`#d15873 → #87213c` on all sixteen tools and on the main site. It does not
take the category colour, it does not go neutral, and **nobody changes it
without Sithara asking for it.**

This entry replaces an earlier one that argued the disc should be neutral on
tool pages because pink is also one of the five family colours. That change
was never requested — it came out of an audit and was agreed between two
sessions rather than with the person whose brand it is — and it was reverted
on sight. It was not even self-consistent: the disc went white while the
account pill beside it stayed crimson, so the bar carried two different
answers about what the brand colour was.

The standing rule this produced, which is wider than the logo: **if it is
not on the list, raise it and wait.** Noticing something in passing is
useful; acting on it is not. That applies to the mark, the account pill, bar
geometry and anything else spotted while doing something adjacent.

### The bar flips with the theme. REVERSED 13 October.

The bar is the family's raised surface in **dark** and plain **white** in
**light**, with the ink and the 2px rule flipping to suit. Measured:

| family | dark bar / ink / rule | ink-on-bar | light bar / ink / rule | ink-on-bar |
| --- | --- | --- | --- | --- |
| design |    | 11.47 |    | 16.08 |
| emortia |    | 11.60 |    | 16.08 |
| field |    | 11.52 |    | 16.08 |
| people |    | 11.59 |    | 16.08 |
| site |    | 11.58 |    | 16.08 |

**This reverses the entry below**, which argued for one dark bar in both
themes. That was asked for after seeing a near-white bar in light mode and
withdrawn a day later after seeing both side by side against a design. The
older reasoning is kept because the *mechanism* it established is what made
this reversal a two-line change rather than another sweep of sixteen files.

---

### Superseded: the bar was --card-2 in both themes



`--navy` used to sit *below* `--bg` — the bar was the darkest thing on the
page. On a dark theme that is upside down: elevation is lightness, so the
raised thing must be the lighter thing. `--navy` is now the same value as
`--card-2`, the top rung, and is kept as a name only because sixteen tools
already say `var(--navy)`.

Three consequences that were **not** obvious and were each caught by
measurement rather than by reading the files:

1. **Every bar still said `color:#fff`.** Once the bar is near-white in light
   mode that is 1.13:1 — thirteen tools, invisible titles. The ink, the
   divider, the pill ground and the pill border were all chosen for a dark
   bar and were all wrong in exactly one theme.
2. **`theme.css` set the bar's shadow with `!important`.** `nav.css` turning
   it off looked applied and was not; three tools kept the 26px black blur.
   A shared sheet using `!important` means a correction can be complete in
   the source and absent on the screen.
3. **A surface token was being used as ink.** attendance's selected tab was
   `color:var(--navy)` on white — fine while `--navy` was dark, 1.14:1 after.
   A surface token is not an ink; the rule now reads `--text` on `--card`.

### Two numbers that look wrong and are not

**OKLab, not WCAG.** The ladder is `--bg` 0.195, `--card` 0.248, `--card-2`
0.300 in **OKLab lightness**. The same colours in WCAG relative luminance are
0.007, 0.016 and 0.027. Both are correct; they are different quantities.
Comparing one against the other is how a right value gets called wrong.

**`--disabled` is about 2.46:1 on `--card-2`, deliberately.** WCAG 1.4.3
exempts inactive components and Material's own disabled tier is 38% opacity.
Do not raise it to satisfy a checker.

### Rotating a hue does not preserve brightness

The tools directory's sixteen bands and five titles were re-hued to the new
families. Holding HSL lightness across a hue change does **not** hold
measured contrast — Site's title went 7.05:1 → 4.01 and Field's 7.05 → 3.98
purely from yellow→orange and cyan→blue, a change meant to touch only hue.
The generator now searches lightness back until each value measures what it
measured before, so the dimming done after "it crashes the eyes" survives.

---

## 043 is COMPLETE. Stop listing it as outstanding.

**Done.** Recorded here because it was re-reported as pending six times, each
time re-derived from a stale note rather than from anything observed. There
is nothing left to run.

- **Step 4 returned 451 / 0 / 0 / 617.**
- The wide sync ran afterwards.
- The `wh24-docs` bucket holds **617 verified PDFs** — real files, not the
  zero-byte objects that caused 043 to be written.
- Goods Issue Notes have been downloaded out of it on **three separate
  occasions**, by hand, successfully.

Why it kept coming back: I cannot see the live database, so "has 043 run?"
is not a question I can answer by looking. The honest default is to ask, and
the failure mode is to instead carry a months-old note forward as if it were
current state. **The note is the state now. Do not re-derive it.**

The related rule, already in memory and worth repeating here: never list a
migration as unrun. Ask, or read an entry like this one.

**Migration 044 (`prev_state`) is a different thing and is genuinely
optional** — unrun, the notification feed reads "updated" on every line
instead of "reserving → collected", `wh24Publish` drops the column and
retries, and nothing else notices.

---

## The dark ramp, 13 October: lifted, warmed, and a bar of its own

The bar changed and deployed, and still looked unchanged on screen. The
cause was not cache, not a recorded instruction and not a test assertion -
it was that the bar WAS `--card-2`, which measured **1.39:1** against the
page. Under the 1.50 separation floor two surfaces read as one colour.

So the ladder is four rungs now, not three, and the fourth is the bar:

| rung | OKLab L | emortia |
| --- | --- | --- |
| `--bg` | 0.220 | `#241619` |
| `--card` | 0.261 | `#2F1F23` |
| `--card-2` | 0.301 | `#3B282C` |
| `--bar` | 0.338 | `#47312F` |

**The other four families are derived, not chosen.** Each is the emortia
ramp with the hue rotated to its own accent at identical OKLab lightness -
one rule, five outputs, so the next change to the ramp moves all of them.
In OKLCH rather than HSL, because rotating a hue at constant HSL lightness
changes how light the colour looks: that is what cost the tools directory
its brightness and had to be searched back.

`--bar` is the nav bar and nothing else. `--navy` is the same value, kept
only because sixteen tools already say `var(--navy)`; anything new reads
`--bar`.

**One number I could not reproduce.** The brief gives bar-against-bg as
1.50:1; the stated values measure **1.45** by WCAG relative luminance. The
values are used as given and the figure is reported as measured rather than
as quoted - flagging it beats quietly nudging a colour to hit a number.

**`--muted` on the bar is 4.68-4.71** across the five. Above 4.5, below
Material medium-emphasis. Do not put muted text in the bar.

---

## The bar's lightness beats the design file, 13 October – final

Reversed three times in one day, so this is the entry that settles it.

**The floor is 1.50:1, bar against page, and it wins over any design file.**

The final What To Do design draws the bar as `rgba(255,240,242,.04)` over
the ground – about **1.08:1** – and separates it with a 2px rule and a glow
hung beneath. That was applied, because the design was the newer of the two
instructions. It was wrong, and the reason is on the record three times
over: `--card-2` at **1.39:1** was reported as "the bar looks unchanged" in
three consecutive reports, which is exactly where the 1.50 floor came from.
1.08 is further under it, not nearer.

A rule and a glow are **additions, not substitutes**. The eye reads
lightness. Both are kept, on top of a bar that is a rung of the ramp.

So `--bar` is back on the v71 rung, one step above `--card-2`, measured on
the rendered page at `localhost` and to be confirmed on emortia.com:

| family | `--bar` | bar ÷ page |
| --- | --- | --- |
| emortia | `#502A34` | **1.56** |
| design | `#2D3D1C` | 1.61 |
| field | `#203954` | 1.60 |
| people | `#373253` | 1.58 |
| site | `#4F2E1B` | 1.58 |

**The guard was relaxed to match the code it was guarding**, which is worth
recording on its own. `family.test.js` asserted "a slight lift, 1.02 to
1.25" while the 4% was in – an assertion rewritten to bless the thing it
existed to catch is not a guard. It now asserts `>= 1.50` and that the bar
is lighter than `--card-2`.

---

## Which rule governs the ground: the starfield, not flat

Two rules were given at different times and they contradict:

1. **Flat ground, earlier** – the page is burgundy 950 and nothing textures
   it; only the tiles and the bar lift off it.
2. **The starfield, in the final What To Do design** – seventy faint dots
   behind the page, and the design was approved after seeing it.

**The starfield governs, in What To Do only.** It is approved, it stays, and
flat ground must not come back as a "fix" to it.

The flat-ground rule still governs **every other tool** – nothing else grew
a texture, and nothing should without being asked for.

The dots are generated **once from a fixed seed**, not per render: a ground
that reshuffles every time a box is ticked is a ground you notice, which is
the opposite of what a background is for.

---

# Two standing rules, 13 October

These are not entries about a decision. They are rules about how the work is
done, and they are here because each one has already cost a day.

## A guard is never relaxed to match the code it guards

`family.test.js` asserted **1.02 to 1.25** while the 4% lift was in, which is
how the bar passed its own suite at **1.08**. An assertion rewritten to bless
the thing it exists to catch is not a guard, and a green suite that contains
one proves nothing.

**If a measured value fails an assertion, the value changes or I am asked.
The assertion does not.**

When an assertion genuinely must move:

- **the commit says why, in its own line** – not buried in a paragraph about
  something else;
- **the old threshold stays in the file as a comment, with the date it
  moved**, so the next person can see what it used to be and when it stopped
  being true.

## A fix is not verified until it is read off the rendered page

Today's gin-extractor edit went into `:root`, and `theme.css` loads after it,
so `html[data-theme="light"]` won outright. The page kept rendering
`rgb(31,154,104)` while the source read `#1C7A4F`, and the source looked
correct through three reports.

**That is the seventh instance:**

| # | what the source said | what the page did |
| --- | --- | --- |
| 1 | the shadow was turned off in `nav.css` | `theme.css` set it `!important` |
| 2 | the logo was reverted | CRLF left ten files untouched |
| 3 | the toasts were fixed | they read `--navy`, which had moved |
| 4 | the steps fixture passed | everything was dated today, so only the written path ran |
| 5 | step 4's filter looked right | the `LIKE` wildcard was never escaped |
| 6 | the bar had changed | it measured 1.39:1 and read as unchanged |
| 7 | light `--ok` was `#1C7A4F` | the page rendered `rgb(31,154,104)` |

**Source edits are not evidence.** Read the computed value off the element,
in both themes, before reporting anything as fixed.

One corollary learned the same day: the computed value may come back as
`color(srgb 0.93 0.44 0.49 / 0.55)`, not `rgba()`. Those are 0-1 floats, and
a parser that assumes 0-255 reads them as near-black – which produced a false
1.15:1 on a pill that actually measured 2.72:1. Parse both forms.

---

## The bar, fourth turn: the design wins after all, 13 October

The entry above – "the floor beats the design file" – is **superseded**. It
is left standing rather than edited, because the sequence is the useful part.

`--bar` is back to the design's 4% warm white over the ground, `#2B0F17` on
emortia, about **1.08:1** against the page. The footer moves with it: the
reminder bar reads the same token, which is why both changed at once.

**Why this reversal is not the same as the earlier one.** The 4% went in the
first time on my own reading of a design file, and I widened the test to let
it pass. This time Sithara put the two side by side on screen, found the v71
rung read as a grey-mauve band against the burgundy page, and said go with
the design. The value was changed by the person entitled to change it, and
the assertion followed afterwards – which is exactly the order the standing
rule requires.

**What makes it safe.** The bar carries no contrast requirement of its own:

| measured on the rendered page, What To Do, dark | |
| --- | --- |
| bar ink on the bar | **15.01** |
| the 2px rule on the bar | **6.20** |
| bar against the page | 1.08 |

(Both figures are *higher* than on the rung it replaced – 10.32 and 4.26 –
because a darker bar puts more distance under the same ink and the same
rule. Losing the lift did not cost legibility; it bought some.)

Only the last is small, and no text depends on it. The 1.50 floor still
governs everywhere it guards text.

**The floor is not withdrawn, and it is not a precedent.** A future "the
design says lighter text" does not get the same answer: this was granted
because nothing legible rests on the number.

---

## The ground, second reversal: the photograph governs What To Do

13 October. The rule recorded this morning – *the starfield governs the
ground in What To Do* – is **superseded**, the same way the bar entry was.
It is left standing above rather than edited, because the sequence is the
point: that rule was itself a reversal of the flat-ground rule, and this is
the third position the ground has held in one day.

**The photograph governs the ground in What To Do.** `media/backgroud/Magenta
Twilight Promenade.png`, Sithara's own image, exported into the tool.

**Flat ground still governs the other fifteen tools**, and the photo goes
nowhere near them: every rule is gated on `html[data-wtd-scene="on"]`, which
only this page sets.

### The starfield is dropped, not kept as a layer

Asked for my call, since I could see it and Sithara could not. Seventy faint
dots read as a night sky only while the ground is empty. Over the promenade
they land on trees, on the river, on lit buildings and on the umbrella –
places a star cannot be – so they stop reading as sky and start reading as
dirt on the lens. The photograph already does what the starfield was for.

Hidden rather than deleted: `STARS` and `starsHTML` remain, so turning the
scene off restores the sky in one attribute.

### What the photograph cost

| | |
| --- | --- |
| source PNG, 1672×941 | 2,542,720 B |
| `scene-1280.webp` | 140,732 B |
| `scene-1672.webp` | 200,664 B |

**The large export is 1672 wide, not the 2560 asked for.** The source is only
1672 across, so 2560 would have been an upscale: more bytes, no more detail.

### One background, and what it forced

The photograph is **not re-tinted for light mode** – it looks identical in
both themes. That has a consequence worth keeping written down:

- The ground is a dark photograph in **both** themes, so text sitting
  directly on the ground uses its own inks (`--ground-ink`, `--ground-dim`),
  identical in both themes. Text on a tile still follows the theme.
- Light mode's tiles go to **93%** opacity where dark stays at **72%**. A
  white tile at 72% over a dark photograph lands mid-grey, and the dark inks
  inside it measured 2.84–3.08. The photo was not available as a lever, so
  the tile was.

**Light mode does read over it.** 22 text pairs measured on the rendered page
against the real image, both themes: **zero failures**, light low 4.61, dark
low 6.18.

### The bars

Nearly solid (93%) rather than glass, after the footer at 80% picked up the
bright foliage at one end and stayed dark at the other. **Both glows removed**
– over a flat ground a hung shadow reads as lift; over a photograph it reads
as a smear. A single crisp rule separates them. Scoped: the other fifteen
tools keep their glow.

---

# Two more standing rules, 19 October

## A line-oriented grep cannot see a CSS rule

Asked to stop every nav-bar animation, I grepped for lines containing
`animation` and kept the ones whose **same line** also named `hdr`, `logo`
or `pill`. It found one source. Measuring `animationName` on the rendered
page found **seven more, in a fourth file and eight tools**.

Two ways the grep was structurally incapable of finding them, and both
happened at once:

- **A multi-line rule puts the selector and the animation on different
  lines.** `.logo{ … \n animation:tLogoFloat … }` – the line carrying
  `animation:` never mentions `.logo`, so no filter on that line can match
  it. A grep sees lines; CSS is made of rules.
- **An element nobody would think to name.** `field-config` animated
  `#tally`. It is in the bar. It matches none of the words anyone would put
  in a filter, because the filter is a guess about vocabulary.

**The inventory of what a page does is the computed value, never the source
text.** A grep is a hint about where to look. It is not an answer, and a
clean grep is not evidence of absence – only of a filter that matched
nothing.

What this cost: a commit that said "three sources" and was wrong by seven
animations, pushed before the measurement ran.

## A hex that no token names is invisible to every guard

The eleven project-update status hues: four were hex literals sitting in a
JavaScript array, seven were tokens. **The two worst contrasts measured
anywhere in the tool – 1.73 and 1.96 – were both literals.**

That is not a coincidence, it is the mechanism. A literal has no theme
pair, so nothing forces anyone to think about the other theme. It appears
in no stylesheet a guard reads. It cannot be found by searching for token
usages. The tokenised hues were merely poor and could be measured; the
untokenised ones could not be checked at all.

**Any new colour gets a token before it gets a usage.**

### And a guard cannot see a colour that is set inline

Worth stating plainly rather than leaving implied, because it is the gap
that let this tool's stat row escape the fill/text split entirely.

`family.test.js` finds text usages by looking for a literal
`color:var(--ok)` in a stylesheet. project-update never writes that. The
bucket colour goes into an inline `style="--k:…"` on the tile and
`style="--c:…"` on the chip, and the CSS only ever says `color:var(--k)`.
One indirection, and the colour is beyond the reach of a source-reading
guard – so when 84 text usages were moved onto the T variants, this tool's
eleven were not among them and nothing reported a miss.

The fix is not a cleverer regex. It is a test that starts from the **list of
colours** rather than from the usage: `tools/project-update/palette.test.js`
reads the `BUCKETS` array and the theme blocks, resolves each colour the way
the cascade does, and asserts all eleven clear 4.5:1 as a chip in both
themes. A twelfth bucket is checked the moment it is added.

That test also has to compose `category.css` over the tool's own block,
because the tool declares `--card:#142428` and `--muted:#5f7b81` while the
page actually paints `#2D1406` and `#776558`. Reading index.html alone
measured chips against a card that does not exist – caught because the
first run disagreed with the browser.

## A test that reads source is as blind as a fix that reads source

Fourth instance, so it gets its own rule rather than another note.

`palette.test.js`, on its first run, measured chips against
`--card:#142428` and `--muted:#5f7b81`, read from the tool's own `<style>`.
`category.css` paints `#2D1406` and `#776558` over them with `!important`.
**The test was asserting things about a card that does not exist.** It would
have passed or failed on fiction either way.

The three earlier instances were all fixes reading source – `theme.css`
beating `:root`, the CRLF logo revert, the `--ok` that rendered green while
the source said otherwise. This one is the same mistake wearing a guard's
clothes, which is worse: a wrong fix shows up on screen, a wrong guard
reports success.

**A test that asserts anything about colour must compose the cascade or read
the rendered value.** The token file is not the answer, in a guard any more
than in a fix.

## Screenshots are the channel for the Claude Design project

Settled 19 October, after an instruction went missing for days.

A rearrangement of What To Do - dashboard on top, tasks below, Add task
always visible, newest task first - was written in the Claude Design
project and never built, because **I could not see it**. Reading that
project's conversation panel from the browser returns a truncated load:
about 3,200 characters, ending at the most recent exchange, with older
entries never fetched. The rearrangement sat above the entries I could
read, so it was invisible while everything around it was legible.

Worse, the panel mixes threads for different files in the project, so what
looks like "the whattodo conversation" may be the project's, and there is
no way from inside the page to tell which part is missing.

**If something in that project is to be built, it comes as a screenshot.**

And the rule that matters more than the mechanism: **do not read that panel
and assume the thread is complete.** A design instruction that is half
visible is worse than one that is not visible at all - the half that loads
looks like the whole, so nothing prompts anyone to go looking for the rest.
The file contents cannot be read either: the preview is a different origin,
so only the prose is reachable, never the markup it describes.

Related: a design note written against a preview that stopped at the
sign-in screen is a guess, not a specification. The same project's
"date rows grow to fill the card's height to match the right column" was
written by an author who said in the same breath that they could not see
the result; measured, it would have stretched the calendar to three times
the screen. Measuring beats a design note that was never rendered.

## A test that does not change the assertion count is not running

19 October. A block of eleven assertions was appended to `wh24.test.js`
after the line that prints the summary. Every one of them executed; none of
them was counted. The run said **131 passed, 0 failed** before and **131
passed, 0 failed** after, and the only tell was that the number had not
moved.

**After adding assertions, check the count moved by roughly what was
added.** 131 → 142 is the proof they ran. 131 → 131 means they did not,
however green the output looks.

This is the same family as the guard rule, and slightly worse. A relaxed
guard reports success for code it did examine; a guard that never executes
reports success for code nothing examined, and converts "unverified" into
"verified" with no step in between where anyone could notice. A suite that
passes without running its checks is more dangerous than no suite, because
it is trusted.

## A regex built from a string loses its backslashes

The same day: `new RegExp('const ' + name + ' = (t => JSON\.stringify...')`
written into a file through a shell heredoc arrived as `JSON\.stringify`,
the string parser ate the single backslash, and the pattern became
`JSON.stringify` with `\s` reduced to `s`. It matched nothing.

It surfaced only because the helper throws when it finds nothing. Had it
returned null and been skipped, the assertions would have vanished exactly
as in the rule above.

**Write regex literals.** `/const sig = (t => JSON\.stringify\(\[[\s\S]*?\]\));/`
cannot lose a backslash, because nothing parses it as a string first.

---

# The main site is settled, 19 October

**The songs and the poems are finished work. `Emortia.html`, `media/` and
the homepage are not where work happens.**

Do not restructure them, do not remove files from them, and do not
optimise them unless Sithara asks for that specific thing by name. The
tools are where changes are made.

## A file in media/ that nothing references is not therefore spare

This is the rule that was missing, and it cost a commit that had to be
reverted before it was pushed.

I was asked about "44 MB of unreferenced originals" and I treated the PNGs
and JPEGs in `media/audio/art/` and `media/poems/art/` as masters sitting
beside their exports - redundant because `index.html` did not ask for
them. They are not. Separate photos are kept for separate purposes, and
**the reason is usually not in the repository at all.**

The evidence was already in front of me and I read it as a near miss
rather than as the finding it was: `lyric-video` was still loading seven
of those PNGs directly, and removing them would have broken video
rendering with no error. The homepage had been converted months earlier,
so the folder looked finished. Seven of twenty-two were live for a reason
that lived in a different tool. The other fifteen may be live for reasons
that live nowhere in the code.

**"Nothing links to it" is evidence about the code, not about the file.**
If something in `media/` looks redundant, ask - do not remove it.

## What was kept from that work

Nothing of the removal. 22 files, 42.4 MB, all still tracked; `.gitignore`
untouched; `lyric-video` back on the PNG masters it was always using.

Two things are kept because they are true regardless:

**The history is not purged** - see the decision below. That reasoning
never depended on the masters being spare.

**Measure the source before re-encoding.** I re-exported the `@2x` album
art at 1920 to cover the video tool's largest output, then measured and
found the masters are themselves only 1800px. There was nothing to gain
and the re-encode would have cost quality for no extra detail. Reverted
before it reached a commit.

## And the clone stays slow, deliberately

42 MB is slow, not dangerous. Clone speed is not worth touching the side
of the site that is finished.

---

# The history is not purged, 19 October

Recorded in its own right, because the reasoning holds whatever happens to
the files themselves - it survived the revert above unchanged.

The repository carries about 42 MB of image masters in its history and
will keep carrying them. **The slow clone is accepted, deliberately.**

Only a history rewrite removes a blob. That rewrite is what is being
refused.

## Why

**A rewrite changes every SHA in the repository, and this file cites
SHAs.** `8063524` is the commit explaining why `thissema@2x` exists at
1800px rather than 900; other entries name other commits. After a purge
those citations point at objects that do not exist, and the decision
record becomes a document full of dead references - worth less than the
clone time it bought.

That is the whole reason. Not risk, not effort: **the record is the
asset**, and a rewrite damages it.

## The exception, which is not this

**The two lookup datasets were purged**, and that was right. They held
real Dialog site codes, equipment serials and people's names in a public
repository. Leaving them was a data exposure, and an exposure outranks
everything, including this record.

**Bulk alone does not.** The question to ask of any future purge is not
"how big is it" but "is it exposed". If the answer is no, the answer to
the purge is no.

---

# If no ink clears the fill, the fill is wrong

A small rule with a wide reach, from the feed's status glyphs.

I needed an 11px glyph on a coloured chip. Filled with the light `--bad`
(`#c2405c`), it needs 4.5:1 against that fill - and **even pure black
reaches only 4.18**. There was no ink to find. I had been searching for
one.

**When no ink clears the contrast floor on a fill, the problem is the
device, not the colour.** Stop looking for a darker ink and change what is
being drawn: outlined instead of filled, text on the page's own ground
instead of on a chip, a larger glyph that qualifies as large text.

The glyphs are outlined now, which also puts each token back on the job it
was solved for - the T variants are text colours, and they are being used
as text.

This is the same failure as using a token for a job it was not solved
for, caught one step later. `family.test.js` refused the first attempt
(T variants as fills) and measured the second (base tokens, 4.18). Both
times the guard was right and my instinct was to keep adjusting the
colour.

## attend_sites is unused on purpose

20 October. `attend_sites`, its RLS policy from migration 032 and its write
API in `db.js` - `attendSiteSave`, `attendSiteRemove` - all exist and are
all unused. **No screen was ever built to write to them, and we are leaving
it that way deliberately.**

The table names a coordinate: `placeOf` would turn `6.9271,79.8612` into a
depot name on an attendance photo. With the table empty it returns `''`, so
every photo shows its coordinates and its map link and no name. **The
information is carried; only the label is missing, and the label was never
asked for.**

This came out of an audit of unused code rather than off anyone's list,
which is the reason it is being closed rather than built.

One thing was changed on the way out. The cell read *"not a known site"*,
which asserts a lookup that never happened - the coordinate was not checked
against a list and rejected, there is no list. It now reads **"no site list
yet"**, which is true and costs nothing.

### Seeding it from site_access was considered and set aside

`site_access` holds `Site_ID`, `Site_Name`, `Depot`, `Latitude` and
`Longitude` for **5,905 sites with usable coordinates** (5,940 rows, 35
without coordinates, none with coordinates but no name). It would seed
`attend_sites` completely.

**That is exactly why it was not done.** Copying 5,905 rows into a second
table is one fact in two places: a site renamed or moved in `site_access`
would leave `attend_sites` stale, nothing would catch it, and the tool
would name the wrong depot with full confidence. The same shape
`family.test.js` exists to prevent, at a scale where nobody would notice
the drift.

If the names are ever wanted, the design to reach for is `placeOf` reading
`site_access` directly, with `attend_sites` holding only what `site_access`
does not know - the office, the stores, a yard. That keeps the estate in
one place and makes the editor a handful of rows rather than a 5,905-row
management screen. The open questions are whether the attendance tool can
read `site_access` under its own RLS policy, what the lookup costs per
record, and whether anything else depends on `attend_sites` being the only
source. None of them were investigated, and the analysis stops here on
purpose.

---

## A rule in this file did not stop the thing it was written about

A pattern built as a string lost its escape: `\s` became `s`, so it matched
the letter s and nothing else it was meant to. The fix came with a line in
this document — *build regexes from literals, not from strings.*

Two days later it happened again. `\d` became `d`, and `realDay()` rejected
every date it was handed, including the real ones.

The rule was right and it was written down and it did not work, because a
rule in a document has to be remembered at the one moment it matters, by
someone who is thinking about something else. So it is a test now:
`tools/_lib/regex.test.js`, which fails the suite rather than asking to be
recalled.

**The second fault was not the one the rule described.** This matters more
than the rule did:

```
new RegExp('\d{4}')        a pattern built from a string — the written rule
/^(d{4})-(d{2})$/           a literal that already lost its backslashes
```

Nothing is doubled in the second. It is a regex literal, written correctly,
damaged on its way into the file — and `d{4}` is *valid*, meaning four
letter d's, so nothing complains. The rule as written does not describe it,
which is precisely how it got through. The guard checks both, and the
second is the one that would have caught the second fault.

The guard is deliberately narrow in one place. `new RegExp` is flagged only
when the pattern is **static** — when a literal was possible. Twenty-one
regexes in this repository are assembled around a value:

```js
new RegExp('alter\s+table\s+' + table + '\s+add column', 'g')
```

Those have no literal form. A guard that failed them would be switched off
inside a week, and then it would be guarding nothing.

### Why both were caught: the assertion looked at the value

Neither was found by reading. Both were found because the test decoded a
real return value.

A shape check passes with a regex that matches nothing. *Does it return an
array* — yes, an empty one. *Does it return a string* — yes, the wrong one.
`weekdayOf('2026-10-20')` returning `⚠` is only a failure if the test knows
it should have said `Tue`.

**Assert on the value, decoded, against a figure worked out independently.**
A test that only confirms the shape of an answer agrees with every wrong
answer of that shape.

---

## A single read near a transition is not a measurement

Turning the rain off was reported as leaving 17 lit pixels on the canvas —
a frozen last frame, "off that doesn't look off". On that number a fix was
asked for and made.

**The number was not real.** `stop()` already cleared, and `apply()` calls
it. Painting all 522,054 pixels of the backing store and running the old
clear left nothing behind, and off measures 0 immediately and stays 0
across repeated samples. The 17 came from one `getImageData` taken too
close to the transition.

The same error, in the other direction, a few minutes later: heavy rain
read as **0** lit pixels — a single sample that landed before the first
frame painted. Sampled twelve times across a second instead, it holds about
5,000, with lightning flashes to 225,728.

So the rule:

> **Sample across time, or do not quote a count.** Anything driven by a
> frame loop is being read while it is moving. One read catches whatever
> happened to be on screen at that instant, which is not the value — it is
> a sample of size one from a distribution nobody looked at.

Take a series. Report the maximum, or the steady state, and say which. A
number quoted from one read is a guess wearing a decimal point.

And the reason this is in this file rather than quietly fixed: **the change
landed anyway**, for a smaller reason that does hold — a clear that cannot
miss regardless of when `fit()` last ran. That the fix survived does not
make the original reason right. A wrong number that happens to point at a
defensible change is still a wrong number, and the next one may point
somewhere worse.

---

## index.html and Emortia.html are byte-identical twins, mirrored by hand

Both files are 447,785 bytes and identical to the byte. They have been
identical for at least sixty commits, every change has touched both in the
same commit, and **nothing enforces it** — no build step, no workflow, no
script. `backup.yml` is the only workflow and it backs up the database.

This is one fact in two places, which is the shape this repository has a
test for elsewhere. The failure mode is specific and nasty: edit one, miss
the other, and the site serves the old page from whichever path was not
touched. It will not look like a mirroring mistake. It will look like a
cache problem, and the first three things tried will be the service worker,
a hard refresh, and `VERSION` in `sw.js` — none of which is wrong-looking
enough to stop and none of which will help.

`README.md` calls `Emortia.html` "the music and poetry side". That was true
once. It is now a complete copy of the whole site, owner page included.

**Not fixed, on purpose.** The main site is settled, and consolidating two
entry points is exactly the kind of restructuring that rule exists to
prevent. Recorded instead, so that:

- anyone editing one edits the other, in the same commit;
- `cmp -s index.html Emortia.html` is the check, and it is one line;
- when a page change mysteriously fails to appear, this is read before the
  service worker is blamed.

If it is ever worth closing, the move is a guard in the suite — one
assertion that the two files match — not a refactor. That catches the
mistake at the moment it is made and changes nothing about how the site is
served.

---

## A function that knows it failed must say so in what it returns

Three times now, the same shape. Not three similar bugs — the same one, in
three places, and it cost something every time.

**1. `filesOf` returning `[]`.** A fetch that came back with nothing and a
fetch that found nothing looked identical to the caller. The sync reported
"0 new GINs" as a success.

**2. The GIN document count.** One signature answering two questions, so
"689 changed" and "689 re-synced, nothing changed" printed one above the
other, both true of the same rows.

**3. The SAP table parse.** `findHeader` returns `null` when it does not
recognise a column header. `parsePageItems` passed that back as `cols: null`.
`parseGIN` dropped it on the floor and returned the same object either way —
so a Goods Issue Note that issued nothing and a note whose table could not be
read were the same answer: `items: []`, and nothing to say which.

### What they have in common

In every one of them **the code knew recognition had failed, and discarded
that knowledge before returning.** The information existed. It was computed,
it was correct, and it was thrown away one or two frames below the caller
who needed it.

So the rule is not "parsers fail quietly", which is a complaint about
parsers. It is:

> **A function that knows it failed must say so in its return value.** Not in
> a log line nobody reads, not in a `console.warn`, and not in a proxy the
> caller is left to guess from. The caller cannot recover information the
> callee had and dropped.

### The proxy is the tell

Each time, the caller had invented a substitute for the signal it was not
given. The GIN Extractor guessed with:

```js
if (!doc.giNumber && doc.items.length === 0)   // "not a GIN? no data found"
```

The question mark in that message was the code admitting it did not know.
And the guess had a hole precisely where it mattered: a real note whose
column header SAP had renamed still yielded a GI number, so it missed this
branch and reported

```
ok   0 material(s) → 0 row(s) · GI 4700001234
```

in green, with two materials sitting on the paper. **When you find a caller
inferring a callee's state from the shape of its output, that is the bug.
The fix belongs in the callee.**

### What was done

`parseGIN` and `parseMovement` now set `tableFound` — true only when some
page carried a column header the reader understands. It is additive, so
nothing that ignores it changed. `ginShape` and `moveShape` carry it through,
because WH24 reads those shapes and not the documents behind them, and a
signal the caller cannot reach is a log line by another name.

Both callers were changed in the same pass, and the proxy was **removed**
rather than left beside the signal:

- **GIN Extractor** refuses on `!doc.tableFound`, and says which case it is:
  a GI number read but no table recognised, or no table at all.
- **WH24** keeps a separate `unreadable` pile. This mattered more. `r.gin` is
  an object whenever the page was read at all, so a drifted note arrived
  looking like a perfectly good one that happened to issue nothing — it would
  be stored against the ticket with no lines, the checker would find nothing
  outstanding, and the ticket would read as collected. That is the only
  failure on that page that ends with a drive to the warehouse for materials
  nobody has issued.

`tableFound: false` does **not** mean the document is worthless; the header
fields may be perfectly readable. It means the emptiness of `items` carries
no information and must never be reported as a count.

### Why the test is written the way it is

`sapdocs.test.js` went from 48 assertions to 76, and the new ones are mostly
about refusals rather than successes. The case that matters is a note with
all its rows present and one column heading renamed: everything else about it
is intact, **including its GI number**, which is exactly why the old proxy
waved it through.

The old proxy is kept in the suite as a test that it fails:

```js
const oldProxySaysBad = d => !d.giNumber && d.items.length === 0;
is('the old proxy waved the drifted note through', oldProxySaysBad(driftDoc), false);
is('the signal does not',                          driftDoc.tableFound,       false);
```

That is there so nobody reintroduces the guess believing it works.

The first version of the movement fixtures invented column labels the reader
never looks for — `Material Code` where SAP prints `Code`. They "passed" the
drift assertion for the wrong reason, because *every* such fixture is
unrecognised. Corrected to the real header, with one label renamed. A fixture
that fails for a reason other than the one under test proves nothing, and a
refusal test is especially easy to get accidentally right.

### The shuffled column, closed with one assertion rather than a model

`tableFound` catches a header this reader cannot recognise. It does not catch
a header it *can* recognise whose columns have moved underneath it — values
filed under the wrong keys, rows confidently wrong rather than absent. That is
the worse failure of the two, because it produces numbers somebody acts on.

It is not modelled and will not be. A description or a material code landing
in the quantity column is not a number, and that is one check:

```
non-empty, and not a number  ->  this row was not read correctly
```

**Non-empty and non-numeric, not merely non-numeric.** Empty is legitimate:
SAP sets the unit and the quantity too close to tell apart by x, both arrive
in the uom cell, and `ginShape` splits them afterwards. Refusing on empty
would refuse that repair before it ran.

`parseFloat` alone is not the test either — `parseFloat('5 EA')` is `5`, and a
quantity cell containing `5 EA` has not been read correctly even though a
number can be prised out of it. The check is that the whole cell is a number.

**A live bug had to be fixed before the check could exist.** The old line was

```js
qty: parseFloat(String(it.qty).replace(/,/g, '')) || it.qty,
```

`||` falls back on anything falsy, and `0` is falsy — so a genuine quantity of
**zero came out as the string `"0"`** and never as a number at all. The new
check would have refused it. The value was wrong, not the rule, which is the
standing rule about guards applied in the direction it is usually not: the
guard was right before it existed, and the data had to be corrected to meet
it.

Both callers refuse on `qtyUnread` exactly as they refuse `tableFound`. The
cost is one `filter` per document and three lines in each caller.

And the reason this is the right amount of work: the silent zero was
*invisible* — nothing on screen distinguished it from a real zero, which is
why it earned a signal, two callers and twenty-eight assertions. Garbage in a
quantity column announces itself. It needed a check, not an architecture.

### A stopped dev server does not fail loudly

The server had been down for 52 minutes and the page kept loading. The
service worker is network-first with a cache fallback, which is exactly the
behaviour this file argues for — offline, last known good beats nothing — and
it means a measuring session against a dead server reads yesterday's bytes
and reports them as today's. Nothing goes red. The page renders. The numbers
are real numbers about the wrong build.

It surfaced only because `fetch()` of a file that certainly exists returned
"Failed to fetch" while the page around it looked fine.

> **Check the server is up before a measuring session, not after.** One
> `fetch` of a known file, before the first measurement, not after a result
> looks wrong.

The scoping is the useful part, and it is worth doing rather than retracting
everything or nothing: name which measurements fell inside the window and
which predate it. Here the Animations work predated the stop and stands; only
the navigations after it were cache-served, and none of those numbers had been
used for a decision.

A second harness fault the same hour, caught the same way: the browser pane
was collapsed, so `innerWidth` was **0**, every canvas built from it was 0×0,
and a sampled ground came back as pure black in both themes — which would have
made cream text on a cream photograph look like 18:1. The measuring helpers
now throw when the sampled ground is uniformly black, and the probes assert
`innerWidth` is non-zero before reading anything.

**Both are the same lesson in different clothes: a measurement harness that
cannot fail is a harness that will quietly agree with you.** Give it something
it is allowed to refuse.

### Green is off Save and on Add, and both are deliberate

Two decisions about the same colour, pointing opposite ways. Recorded
together so neither is later "tidied up" into agreeing with the other.

**Save task is not green.** `.pri` was moved off `--chk-on` to the accent,
because that green is the tick colour and on a task tile it reads as *done*
rather than *save* — the button would have promised the thing was finished
before it was written.

**Add task is green.** The same token, on the floating button and on the
pill inside the New Task tile.

They are not in conflict because they are not the same claim:

> **Add promises "start something". Save would promise "this is finished".
> Different buttons, different claims.**

The design that introduced the green Add button did not reverse the burgundy
decision — it did not touch it. Save task is still the accent there, and
measures 4.89 in light and 6.66 in dark on the built page.

So: if someone finds green on one button and burgundy on another and reaches
for consistency, this is the entry that says the inconsistency is the point.
The colour is not decorating a button; it is naming what the button does.

A practical consequence: the ink differs too, and for the same reason the
palette already records. `--chk-ink` is sized for the green, `--iv-ink` for
the accent, and each button carries the ink that belongs to the fill it sits
on. Swapping one for the other is how `.pri` once measured 4.19.

---

## Amended: screenshots are the channel for the THREAD, not for the FILE

The earlier rule in this file says screenshots are the channel for the
Claude Design project. That was set when the design conversation panel was
loading truncated, and for the conversation it is still right.

It was wrong as a general rule, and the cost was a whole build.

The design **file** is readable through the design MCP — `get_file` on the
project, by path. That was available and was not used. The tool was built
from screenshots of the rendered design instead, and the result was wrong in
almost every decision:

| built from the screenshot | what the file said |
|---|---|
| a solid green pill | a **clear glass** pill, blurred and white-edged, with a glossy green **bead** for the + |
| tint `rgba(247,241,232,.62)` | `rgba(40,10,20,.18)` |
| dark ground ink, solved and measured | the **light** ink, carried on a text-shadow |
| near-opaque tiles | 6% clear glass in dark; 68% frosted with blur and brightness in light |
| search left where it was | moved under the calendar |

"Green glass" became "make the button green", because **a screenshot of a
glass pill with a green bead looks like a green pill.** The screenshot was
not lying; it just cannot carry `backdrop-filter`, a gradient, or an alpha.

So, amended:

> **The conversation thread comes as screenshots. The design file is read
> through the MCP, every time, before building.** A screenshot is evidence
> that something looks wrong. It is not a specification.

### And it is the same failure as all the others this month, one level up

Every rule in this file from the past month is the same sentence with
different nouns:

- source edits are not evidence — **read the rendered page**
- a token file is not the rendered page — **read the computed value**
- a green suite is not a passing suite — **decode the return value**
- a canvas that exists is not a canvas that is raining — **count the pixels**
- a screenshot is not the design — **read the file**

In each one there was a way to check the real thing and a cheaper proxy that
looked like it. The proxy was taken every time, and every time it agreed
with whatever was already believed — which is what proxies do, because they
are missing exactly the information that would have disagreed.

> **When there is a way to read the actual artefact, read the actual
> artefact.** Not the thing that represents it, renders it, or describes it.
> The gap between a proxy and the thing is never random: it is precisely
> the part you cannot see, which is precisely where the mistake lives.

### The one place the design was overridden, and why

`#FFF8F2` over the brightest part of that sunset measures **1.41:1**. The
design carries it on a text-shadow, which works on a monitor indoors — where
the design was drawn — and does nothing on a phone in daylight, which is
where this tool is used.

The ink and the photograph are untouched. A scrim of the design's own tint
colour at 0.60 sits behind the glyphs only, feathered so it reads as a soft
pill rather than a bar, and the text-shadow stays on top of it.

`.scene` is `position:fixed`, so the photograph does not scroll — text
slides over a stationary sky. The scrim therefore travels with the text, and
the binding case is the brightest pixel in the column a run sweeps, not the
brightest behind it at rest.

|  | swept brightest | at the glyph edge | median |
|---|---|---|---|
| `.lq-sub` | 0.659 | **5.02** | 16.73 |
| `.tk-h .t` | 0.651 | **6.02** | 17.10 |
| `.tk-h .n` | 0.659 | **6.02** | 15.61 |

Overriding a design needs a reason that is about use rather than about
rules, and this one is: 1.41:1 against a bright sky is invisible outdoors.

### Run the FULL suite after a design import, not the suites for the files touched

`fab0f88` imported the design project's version of What To Do. The sapdocs
and wh24 suites were run; `family.test.js` was not, because the commit did
not touch anything it obviously owned.

It owned the thing that mattered. The design brought `#DC1F55` with an ivory
`#FFF5F7` on it, which renders at **4.498** — under the bar by two
thousandths. That sat on main for four commits.

> **A design import is exactly when the colour guard earns its keep, and
> exactly when it is least likely to be run.** It brings values the guard has
> never seen, chosen on someone else's screen, by someone who was not
> thinking about the contrast bar. Run everything.

The same applies to any import, regeneration or bulk replace: the suites to
run are not the ones whose files changed, but the ones whose *assumptions*
might have. A file-based heuristic picks the wrong set every time, because
the point of a guard is that it watches something the changed file does not
mention.

And the fix had a direction worth recording. The instinct was to darken the
near-white ink. The fill is dark — L=0.168 — so darkening the ink *closes*
the gap: `#F7EDEF` measures 4.19. Lighter is the way out, `#FFFAFB` at
4.649, and the design's fill is untouched. **Check which way the ratio moves
before choosing a shade**; on a dark fill a lighter ink is the fix and on a
pale one it is the opposite, and the word "darken" is not a direction.

---

# A standing rule, 26 October

## An optimisation that removes data from a page is proved against the feature that uses it, before it ships

`f725036` narrowed the WH24 page load from `select('*')` to an explicit
column list, excluding `timeline`, `gins` and `site_lines`, on the plan that
`gins` would be fetched when a ticket was opened. **That fetch was never
built.** `gins` carries the stored document paths, so from that commit on
every opened ticket rendered its material lines, its GIN reservation and its
GI number with **no Download button at all**, while 617 verified PDFs sat in
the bucket. Two days on main.

The optimisation was not wrong about the egress. It was wrong to ship the
half of the plan that takes the data away without the half that gives it
back, and nothing anywhere said so:

| layer | what it reported |
|---|---|
| the read | 451 rows, no error |
| the row | every column the list asked for |
| `docsBox` | `(t.gins \|\| [])` → `[]` → `''` |
| the page | a ticket that opens and looks complete |
| the suite | green |

`|| []` is the tell. A defensive default turns an **absent column** into an
**absent feature**, and the two are indistinguishable downstream — the same
shape as the zero-byte uploads and the silent no-op, one level up again.

**Nothing in the suite noticed, and this is the gap worth naming:** the
document work is thoroughly tested, but every one of those tests asserts
that a document was *stored* — the bytes verified, the path deterministic,
`upsert` on, the download name resolved. **Nothing asserts that a stored
document is reachable from the page.** The chain from a column in the read
to a button under an opened ticket had no guard on it anywhere, so removing
a link from that chain broke nothing any test could see.

So:

> **Removing data from a page is a change to every feature that reads it.
> Before it ships, name those features and exercise each one against the
> narrowed read — not the narrowed read on its own.** If the replacement
> fetch is part of the plan, it ships in the same commit or the narrowing
> does not ship.

And the test that was missing is the one to write: not "was it stored", but
**"does a stored document still arrive at a button"**, driven end to end
from what the read returns. Two notes on building it, both learned writing
today's throwaway version:

- **A fake that does not project passes either way.** A stand-in client
  returning every column whatever the `select` asked for reports a healthy
  row under the narrow read too. It has to honour the column list, or it is
  the `200 []` from an empty table again.
- **Assert the empty case in the same breath.** `docsBox` returning `''`
  for a row with no `gins` is what proves the check can see the bug; without
  it the test passes for ever on a page that renders nothing.

**Withdrawn, not reverted.** `wh24Load` reads `'*'` again on every call;
`f725036` was left in place because later commits sit on it. `WH24_LIST` and
`WH24_HEAVY` stay, with their accounting guard in `db.schema.test.js` — they
are the groundwork for the opened-ticket fetch whenever it is built, and the
guard still forces a decision about any column a later migration adds.

`wh24Narrow` had to come back with it, and that is the part a one-line fix
would have missed. It projected realtime payloads to the same narrow list,
so a row updated while the page was open would have had its `gins` stripped
on the way in — the Download button would have reappeared on load and then
vanished from any ticket that changed under it. **A read and the projection
that normalises it are one decision in two places.** Narrowing a realtime
payload saves nothing in any case: those bytes have already arrived.

**The egress is accepted, and recorded here so it is not re-optimised by
surprise:** ~1.28 MB a page load. The realtime change removed the 882 MB
multiplier — one full table read per changed row, per open tab — and that
was the cost that mattered. The remaining per-load figure is not worth a
feature.

---

## Third instance: the words and the facts came apart again

"0 new GINs" when the fetch had returned nothing. "not a known site" when
there was no site list at all. And now **"Updated from another device" on
every tab focus and every fifteen minutes**, when nothing had happened.

The same shape three times, and the tell is sharper each time:

> **The caller was handed the information it needed to be accurate, and
> dropped it on the floor.**

`liveChannel` calls its reload for four reasons and passes the reason in:
`undefined` for a real `postgres_changes` event, and a string for each of
the three reconciliation paths — becoming visible, the fifteen-minute
backstop, and the channel returning after a drop. Every caller wrote
`async () => {…}`, ignored the argument, and said the same sentence for all
four.

The reload is right to run in all four cases; that *is* the reconciliation
and it stays. Only the sentence was wrong. One parameter, already being
passed, already correct, discarded at the receiving end.

### What that costs

A tool that announces a change when nothing changed teaches you to stop
reading it. The first two instances cost a wrong number and a misleading
phrase; this one costs the credibility of every toast in the suite, because
after the third false "updated" nobody believes the true one either.

### And it was shared code again

Second time in three days. `liveChannel` went into `db.js` and reached ten
tools; four of them showed the false toast — materials, project update, and
both lookups through `lookup.js`. The other six were silent only because
their reloads happen to toast nothing.

Found by opening four tools by hand. **The shared-code rule at the top of
this file is exactly the check that should have found it**, and it was not
run: the change named no callers, said nothing about what each would show if
it were wrong, and nobody opened them afterwards.

### Why there is no further check for "did anything actually change"

Worth recording so it is not revisited. With the reason gated, a real event
on these channels already means this tool's own data moved: `ds-` and `bk-`
are filtered to one key, and materials shows every row of its table. So the
sentence is true whenever it is now said.

Comparing the fetched payload against what is on screen would add a second
way to be silently wrong — a comparison that says "nothing changed" when
something did is the original failure with the sign flipped — to guard a
case that the filter has already removed. The gate is the fix; equality
checking is not.

---

## Second instance: a measurement note did not survive being written down

27 October. This is the companion to *"A rule in this file did not stop the
thing it was written about"*, and it is the same lesson twice in one month:
**a rule that depends on somebody remembering it is not a rule. Make the
check refuse.**

### What happened, twice

A CSS colour can serialise as `color(srgb 0.93 0.44 0.49 / 0.55)` — channels
from 0 to 1, not 0 to 255. Read as a 0-to-255 triple it becomes near-black,
and a colour three quarters of the way to white measures as almost nothing.

- **~6 October**, the day-pill edge. The figure came out **1.15** when the
  truth was **2.72**. A colour change was nearly made on the strength of it.
- **27 October**, the Project Update status chips. Same serialisation, same
  misread. It produced a confident claim that **ten of eleven colours had
  never cleared 4.5 on a rendered page, through two previous solves**. They
  always had: 4.52. The claim was stated plainly, in a report, before it was
  checked — and withdrawn an hour later.

After the first one, a note was written: *normalise through a canvas*. The
note was in memory, where it was read at the start of the session. It did not
stop the second one.

### This is the regex shape

The date regex was broken twice with a comment above it saying not to break
it. It stopped being broken when `regex.test.js` started asserting on it.
Nothing about the comment was wrong; comments do not run.

So the note becomes `tools/_lib/contrast.js`, with
`tools/_lib/contrast.test.js` asserting its refusals. **A contrast harness
that can be handed `color(srgb …)` and hand back something it treats as
0-to-255 is the bug.** This one normalises that form, and refuses by name
anything it cannot normalise — `oklab()`, `oklch()`, `lab()`,
`color(display-p3 …)` — rather than half-reading it.

The guard that would have caught both: 0-to-255 channels are whole numbers,
0-to-1 channels are not, so a triple carrying fractions is refused outright
with the message naming this exact mistake.

`palette.test.js` carried its own hex reader and its own ratio; it uses the
harness now. There is one implementation.

### The two harness faults belong here too

Both are the measurement equivalent of the collapsed pane that sampled pure
black: **the harness answers, and the answer is about the wrong thing.**

1. **A shared canvas kept its previous `fillStyle`.** Assigning an
   unparseable colour to `ctx.fillStyle` is a silent no-op — the old colour
   stays — so a rejected value came back as whatever was measured last.
   White-on-navy measured **1.08**. The probe takes a fresh context per call
   and asserts the assignment was accepted.

2. **A run read computed styles across a theme switch.** It set
   `data-theme` and read before the style recalculation landed, so it
   reported dark's accent in light and light's in dark — the values were
   *swapped*, which is what gave it away. `withTheme()` flushes, waits two
   frames, and then requires a witness value to have changed; a theme that
   did not take is refused instead of measured.

Proved by breaking, five times: unscaled `color(srgb …)`; fractional
channels accepted; a refused `fillStyle` unnoticed; a theme that never
landed accepted; unknown serialisations given a silent default. Each caught
by the assertions written for it.

### The standing rule

**No ad-hoc contrast arithmetic.** Not in a test, not in a `javascript_tool`
call, not in a one-off probe. If a number is going to be quoted in a report
or used to justify changing a colour, it comes from the harness — because
the harness refuses, and a person reading a note does not.

And the smaller discipline underneath it, which is what actually failed:
**a measurement is not a finding until the harness that produced it has been
checked against a case whose answer is already known.** Black on white is 21.
If that does not come back 21, nothing else from that harness counts.

## A derived figure rendered as a measured one

1 November. This is a third shape, and it is worth separating from the two
already in this file because the failure is in neither of their places.

- *"A function that knows it failed must say so in what it returns"* is
  about **information discarded**: the code knew, and dropped it.
- *"Second instance: a measurement note did not survive being written
  down"* is about **a check that could not fail**: the harness answered,
  and the answer was about the wrong thing.

This one is about **output that does not admit what it is**. Nothing was
discarded and nothing was measured wrongly. A number was *reconstituted*
from a rounded one and then printed in the same typeface, to the same
precision, with the same confidence as the real thing.

### What happened

Moving the Excel browser's project list off row data meant the overview
could no longer count done rows — it has three columns and no rows. The
first version recovered the count from the stored percentage:

```js
const done = Math.round(pct * n_rows / 100);
```

`pct` is a whole-number column. At 2,627 rows one percentage point is
~26 rows, so the rounding carries about 13 rows of slack. A sheet with
exactly 1,000 done rows rendered:

```
998 done / 1,629 open          (the truth: 1,000 / 1,627)
```

Two off, in a figure nobody has any way to check from the page. The
tracker tile and the overview both print it. There is no asterisk, no
"~", no rounding note — **998 was printed exactly as confidently as
1,000 would have been**, and the only reason it was caught is that the
true count happened to be a round number and the rendered one was not.

### Why the fix was a stored count and not a wider pct

The obvious repair is a more precise percentage: make `pct` numeric,
carry two decimals, and the error drops to a fraction of a row.

**That is the worse fix, and it is worse for the reason that matters.**
A wider `pct` does not remove the drift; it shrinks it until it stops
being visible. At one decimal place a 2,627-row sheet is out by one row
at the margins instead of two — still wrong, still printed as exact, and
now with nothing round-numbered left to notice it against. The bug would
have survived as a permanent ±1 that reads as a data-entry error rather
than an arithmetic one.

So `pu_reports` carries `n_done integer` — the count the sheet actually
has, written at upload time by the same pass that computes `pct`. Nothing
is derived. Migration 047 gained the column and an idempotent
`add column if not exists`, because the file had been written and
circulated before it was first run.

Measured on the rendered page afterwards with the same 2,627-row tracker:
**1,000 and 1,627, exactly.**

### The standing rule

**A figure that was reconstituted is not the figure.** If the number on
screen was not the number counted, either store the number counted or
mark what is on screen as approximate — and prefer the first, because a
rendered "~998" invites the question "998 of what?" and the honest answer
is that the page does not know.

The corollary, which is the part that nearly went unlearned: **when a
derived figure is wrong, do not fix it by deriving it better.** Precision
and correctness are different axes, and adding precision to a wrong
derivation removes the evidence rather than the fault.

### What stands guard, and what did not

The count is checked by the assertion written for it, on the rendered
page, against a known sheet.

`lazy.test.js` did not catch it and could not have — but the reason is
instructive enough to record. That test reads its column lists out of
`db.js` rather than restating them, so when `PU_REP_META` was widened for
`n_done`, **the test widened with it and said nothing.** Reading from the
source is right for the structural assertions — no `payload`, no
wildcard, which hold whatever the list contains — and it is exactly wrong
as a record of what the list is supposed to be. A list that co-varies
with the thing it checks is the code echoing itself.

It now carries a literal allowlist: a permitted set per read, with one
line per column saying what draws it. A column `db.js` asks for that is
not in its set fails, so adding `n_done` would have cost the one line
that states why a card needs it. One direction only — a column *removed*
from a read does not fail there, because narrowing is what that file
wants, and a column the page stops getting is the business of the guard
that reads it.

Proved by breaking, three times: a light unlisted column (`created_by`)
added to the project list; the `n_done` line removed from the allowlist
while `db.js` still asked for it; and `payload` added to the allowlist to
make a failure go away, which the allowlist refuses to permit.

## The comparison goes before the cost, and that is now four times

2 November. Four instances, same shape, and the fourth was costing
a large multiple of the daily traffic of a 6.7 MB database.

**CORRECTED, 3 November.** The ~817 MB/day I reported here was wrong by
about eight times: it multiplied row counts by UNCOMPRESSED column sizes
and compared them to a gzipped wire. The real rate since 24 October is
nearer **100 MB/day**, and the 5.24 GB against a 5 GB ceiling came from
**three spike days in October**, not from the daily drip. The gates were
not the emergency the first version of this entry presented them as; they
lower the floor for next cycle, which is worth having and is not the same
claim. The ORDERING fault the entry is about is unchanged - the walk was
real, 100 full reads a day of a dataset last published on 1 October - and
so is every count taken by the last page of a walk. Only the megabytes
were invented, by a measurement nobody checked against a known answer.

1. **wh24Subscribe, 25 October.** A full table read per changed row per
   open tab. 689 rows at 1.28 MB is 882 MB in a day. Fixed by patching
   from the payload.
2. **The done count, 1 November.** `round(pct * n_rows / 100)` rendered
   998 where the sheet had 1,000, because the figure was rebuilt from a
   rounded one. Fixed by storing the count.
3. **The render after a reconcile, 1 November.** A whole list repainted
   on data that had not moved. Fixed by comparing before painting.
4. **The dataset loader, 2 November.** `fetchRemote` fetched
   `datasets.cols/row_count/updated_at`, used the column list, threw the
   timestamp away, and then walked six pages — 5,940 rows, ~4.2 MB of
   JSON, last published 1 October. Measured by the last page of each
   walk: **100 full walks a day, 0.93 of them per meta read.** The
   answer was in hand before the bill. `site_data` is 13,258 rows and
   has not moved in 58 days.

In every one of them the cheap question was already being asked, or
could be asked for a few bytes, and the expensive work happened first
anyway. Not a performance problem — an **ordering** problem. So the
tests assert the order, not just the result: a gate that reads all six
pages and then compares gives the right answer and pays the whole bill,
and `dataset-gate.test.js` break 6 is exactly that, and fails.

### A spec can be wrong in the safe-sounding direction

The instruction was to gate on `savedAt`. `savedAt` is
`updated_at.slice(0, 10)` — a **date**. Two publishes on the same day
would have compared equal and the second would never have reached a
device holding the first: a stale dataset served as current. That is a
wrong figure on screen, which was the one outcome the same instruction
forbade. The gate uses the full timestamp; `savedAt` stays as it was for
the pill, and `row_count` is checked too, because a cache truncated by a
storage quota has the right stamp and the wrong rows. Break 1 is the
specified version and it fails.

### An interrupted walk pays for every page and caches nothing

Found while taking the measurement, by flipping tabs every three seconds
and manufacturing the churn being measured: five walks started, one got
past page four. `fetchRemote` concatenates pages into one array and only
`cacheSet`s at the end, so a walk cut short writes nothing and the next
load starts from page zero. Every page it already pulled was paid for
and discarded.

With the gate this is now self-correcting rather than merely wasteful —
the stamp is written only by a **completed** walk, so an interrupted one
leaves no stamp and the next load re-walks, which is the right answer.
But on a slow connection a person who switches away mid-load pays twice
for doing so, and nothing tells them. Written down, not fixed.

And the measurement lesson underneath it: **a window in which nothing
happened is not evidence that a fix worked.** The first 35 minutes after
the gate deployed showed zero `sites` reads — and zero `datasets` reads,
which is what gave it away: `load()` had not been called at all. Proof
came from a deliberate sequence instead — load, wait for the walk to
finish, then two clean hide/show cycles, and look for a `datasets`
`0-0/*` with no `sites` pages after it.

### The reverse of the same mistake, in a check of my own

Verifying the deployed copy, I asserted
`js.indexOf('return UNCHANGED') < js.indexOf('const PAGE = 1000')` and
it came back true — against the **old** file, which contained no gate at
all. `indexOf` returns `-1` for a missing needle and `-1` is less than
everything. A check that passes hardest when the thing it checks for is
absent is the `palette.test.js` shape again. Both offsets are now
required to be present before they are ordered.

### wh24_tickets, the same fix on an exact marker

178 full walks a day, two pages, 1,308 kB. `wh24Publish` is the only
writer and stamps `synced_at` on every row of every chunk from one
hoisted value, so no write can land without moving the maximum; there
are no deletes, because a removal is the `removed` column, which is an
update, which is stamped. So `(count, max(synced_at))` cannot miss a
write, and PostgREST returns both in **one request of about a hundred
bytes**.

Named rather than hidden: the stamp is the publishing browser's clock,
not the server's, so two devices with skewed clocks could write a stamp
older than the current maximum and move neither it nor the count.
Publishing is owner-only and driven by the WorkHub24 bookmark from one
browser at a time. If that stops being true the exact version is a
server-side digest behind an rpc, not a cleverer timestamp.

`tickets: null` means *keep the ones you have* — never `[]`, which would
blank the list, and blanking the list is worse than the egress this is
meant to save.

### And a harness that could not model the call

The gate needed `select(cols, { count: 'exact' })`, and
`fake-supabase.js` did not model it: no count came back, so the gate's
condition could never be true under test. It also applied `limit`,
`order` and `range` without **recording** them, so a test could watch a
call go past and still not say whether it asked for one row or all of
them — which is the only question that family of tests exists to answer.
Both are modelled now and checked in the fake's own test. An untested
gate on a 1,308 kB read is not something to ship.

## A page nobody has looked at is not verified

3 November. Material Codes shipped **invisible** and every check I ran
said it was fine.

`.scrim` — the modal backdrop — carried the `hidden` attribute *and*
`display:flex`. The attribute works through one user-agent rule,
`[hidden]{display:none}`, and a UA rule loses to **any** author
declaration of the same property. So the backdrop stood over the whole
page permanently: dimming it, and swallowing every click. `.totop` had
the identical bug and was permanently on screen. Both `el.hidden = …`
paths were no-ops that read like they worked.

### What I checked, and why none of it could have found this

- the page parsed, 0 errors
- the deployed HTML contained `aside.side`, `section.panel`, `id="scrim"`,
  `function openDetail`
- computed styles resolved `--accent` to `#81D67B` dark and `#006400`
  light, both themes, on the rendered page

All true. All useless. **A contrast reading of 14.6:1 was taken on text
that was sitting under a scrim** — a generic selector returned an element
nobody could see, and `getComputedStyle` answered happily about it.

I had already written the disclosure: *"the browser pane reports 0×0, so
rows, facets, the modal and the copy buttons are unexercised."* That was
the right thing to say and I said it **and shipped anyway**. The
disclosure was not a caveat on the verification; it was the bug report,
and I filed it as a footnote.

Sithara found it with `elementFromPoint` at the coordinates of a
screenshot — the one method that asks *what is actually at this pixel*
rather than *what does this selector compute to*.

### The standing rule

**When the browser pane reports a 0×0 viewport, the visual check could
not be done. Say so, and do not ship the page until someone has looked.**

Not "verify what you can and note the rest". The layout, the stacking and
the hit-testing are exactly what a 0×0 pane cannot report, and they are
exactly where this class of bug lives. `getComputedStyle` is not a
substitute for a pair of eyes; it will describe, in confident detail, an
element that is behind an opaque sheet.

### And the class, not the instance

`[hidden]` silently doing nothing is the **vacuous `indexOf`** shape
again: a mechanism that does not do what the code says, that nothing
fails on, and that reads correctly in review.

`tools/_lib/hidden.test.js` now finds every element in every tool whose
visibility is driven by `hidden`, checks whether the page also sets
`display` on it, and requires the explicit override. It found **ten more,
in three tools nobody had reported**:

- **team** — `.btn[hidden]` on `importBtn`, `addPerson`, `addVehicle`.
  `$('importBtn').hidden = !mine()` had never worked: the owner-only
  buttons were shown to everyone. RLS still refused the writes, so it was
  a wrong-looking page rather than an open door.
- **wh24** — `.selbar`, `.newspop`, `.bm`, `.seg`. `selbar` is
  `position:fixed;bottom:0`, so the selection bar sat across the bottom
  of the tool permanently.
- **site-access** — `#fPanel`, `#tray`, `#plan`, `#detail`, `.ghost`, all
  driven from `unified.js`.

The guard has its own sensitivity check, because a scan that finds
nothing passes everything: it asserts it can still see the two elements
in Material Codes that are there by construction. Proved by breaking
three times — the original bug restored, one selector dropped from a
tool's override, and the scan blinded to `.scrim` altogether.

## The judgement call on the design backup was Sithara's, and it was wrong

Recorded at his request, and worth recording because the reasoning was
good and the conclusion was not.

The question was whether git history counts as a backup of the Claude
Design project's files before pushing over them. His ruling:

> git history is the backup for anything repo-derived. Only a file edited
> in the design app and never in the repo is irreplaceable, and the three
> backwards imports say there are none.

Every step of that is sound. Three successive imports had come back
pointing at older repo states, which is strong evidence the project is a
downstream snapshot. The inference was reasonable.

**It was wrong, and the counter-example was in the next file opened.**
`tools/materials/index.html` in the design project was the repo's page
*plus* a glass-and-photograph layer — a fixed `.scene` with a per-theme
tint, frosted panels (`--g-glass`, `--g-edge`, `--g-blur`), and a
floating back-to-top pill — that existed nowhere in git. Pushing the
repo's version over it would have destroyed work no history could return.

The evidence had said *the files I have looked at are derived*. It was
read as *the files are derived*. Three samples from a project of seven
hundred, chosen because they were the ones being imported, are not a
sample of the project.

**The backup rule stays exactly as written: read it before you overwrite
it, every time.** It cost two stopped attempts and most of a session, and
it paid for all of that in one file.

## A tool reporting zero is reporting its own state, not the world's

4 November. For two days I treated *"the browser pane reports a 0×0
viewport"* as a fact about the page. It was a fact about the **pane**,
which was collapsed. Opening it and setting a size gave a live 1400×900
viewport immediately.

Everything downstream of that misreading was wrong in the same direction:

- I could not measure the two-column layout, so I reported it unverified.
- I shipped Material Codes anyway, invisible under a permanently-up
  modal scrim, because the only check that would have caught it is the
  one the 0×0 reading told me was impossible.
- When I finally did look, the blocker was not the pane at all — it was
  the sign-in gate, a completely different problem with a completely
  different answer (render the real stylesheet against stand-in rows,
  the way `wh24/__fixture.html` already does here).

### This is the `indexOf` shape, in a new place

`indexOf` returns `-1` for a needle that is not there, and `-1` is less
than everything, so an ordering check passes hardest when the thing it
is checking for is **absent**. I wrote that one down a day earlier.

`innerWidth` returns `0` for a pane that is not being painted — and
every measurement taken through it then agrees, calmly, that nothing has
any size. Both are a sentinel value that reads as a measurement. Both
produce *more* confidence the less the instrument can actually see.

### The rule

**A zero, an empty, a `-1` or a `null` from an instrument is a claim
about the instrument until something independent says otherwise.**
Before reporting "I cannot measure X", establish that the measuring
thing is working at all — `getComputedStyle` on a known element,
`innerWidth` against a size you just set, a hash of black-on-white
coming back 21. The harness-checked-against-a-known-answer rule already
in this file is the same rule; this is it applied to *the harness being
switched off* rather than being wrong.

And the corollary that cost the most: **"I cannot see it" is a thing to
fix, not a thing to disclose and ship past.** The disclosure was
accurate and it was not a substitute for looking.

## Read before write, every time

Recorded as a habit rather than an incident, because the incident was
small and the habit is not.

`cat > .claude/launch.json` on a tracked file I had not read destroyed
the `emortia` http-server entry — the project's only dev-server config —
while adding a throwaway one for an image-encoding job. The restore was
clean because git had it. That is luck about *which* file it was, not
care about how it was written.

**The file you destroy is the one you did not know was there.** A
redirect that truncates, an `Edit` whose `old_string` you guessed, a
`write_files` over a path you have not listed — each is the same move:
writing to a target whose contents you have not established. The
established cost in this session alone is one dev-server config and two
stopped design-project pushes, and the pushes were stopped *because* the
same rule was followed deliberately — which is what found the one
irreplaceable file in a project of seven hundred.

Read it, then write it. The read is cheap in every case where it turns
out to be unnecessary, and it is the whole of the protection in the
cases where it is not.

## A gate proved under a load it was never designed for

4 November. The best evidence the materials gate works came from an
accident, and it is better evidence than the baseline comparison.

For about forty-five minutes on 3 November — 17:50 to 18:35, one IP, one
session — the Material Codes page reconciled roughly **once every 1.5
seconds**. 956 probes in a single hour, against 0 to 25 in every other
hour of the day. It was not a timer and not tab switching; 1.5 s is
`liveChannel`'s own cadence, either `soonish()`'s 1200 ms trailing edge
or the status path retrying at 1 s and 2 s before backing off. It
started as the gate shipped, stopped on its own, and has not recurred.

**What it produced: ~1,000 probes and essentially no walks.**

Pre-gate, that same storm would have been **~3,000 full page reads** of
2,422 rows — three paginated requests per reconcile, roughly 1.5 GB on
the wire in three quarters of an hour, on an account that had just gone
over a 5 GB monthly ceiling.

### Why this beats the before-and-after figure

The baseline comparison — 88 walks a day becoming a handful — measures
the gate under the traffic it was designed for, which is the traffic
whoever wrote it had in mind. Anybody can build something that holds at
the rate they imagined.

This measured it at **sixty times that rate**, driven by a fault nobody
predicted, with no warning and nobody watching. The gate did not
degrade, did not fall back to walking, and did not serve a stale list:
every one of those thousand reconciles asked the cheap question and got
a truthful answer. A guard that holds at the design load is a claim; a
guard that holds at sixty times it, during a fault, is a measurement.

### And the reading was already running

`RELOG.rate('materials')` would have printed **"THE THREE RECONCILE
PATHS CANNOT ACCOUNT FOR THIS"** and named the gaps under 1200 ms. That
is exactly the sentence the instrument was built to produce, it was live
in the page the whole time, and instead the question was answered by an
hour of log archaeology after the fact.

**The standing order: when a count looks strange, `rate()` comes before
the logs.** The instrument that can falsify a theory is worth nothing if
it is not the first thing asked.

## The identity channel and the personalisation channel are separable

5 November. The Material Codes design arrived with a seven-theme accent
picker, and `family.test.js` refused it: *no tool defines an accent of
its own* — the rule written because Material Codes showed maroon on the
directory and opened green.

It looked like a straight choice between the site's five-family identity
and a feature somebody wanted. It was not.

### The guard was written in terms of the mechanism, not the property

The property worth protecting is **what you see before clicking matches
what you see after**. "The tool's accent equals its family's accent" was
a *way of guaranteeing* that, and the assertion was written as the way
rather than as the thing. Same shape as gating a cache on `savedAt`'s
date when the property was "the server has nothing newer" and the date
was merely how it was being checked.

So the question became: does the directory tile follow the picked
accent? **Checked, not assumed, and the answer was no twice over.**

- The picker writes `localStorage.mat_accent`, a materials-only key.
  `grep -c mat_accent` over `index.html` and `Emortia.html` returns 0.
  The tile is a static `.tgrp-design{--gc:#40b337}`.
- All fourteen accent values sit outside the family hue, by **13.8° to
  48.9°**, against the 6° tolerance this repository already applies to
  the directory's own `.tgrp-*` colours. Picking "coral" opened a tool
  whose accent was teal `#4fc6a8` beneath a green tile.

So the property really was broken, not just the mechanism. The guard was
right for the wrong reason, which is still right.

### What saved it

Reading the themes properly: **every picked `--accent` was a green, and
the actual theme colour lived in `--codeInk`.** Forest's accent is
`#1f5d3a` with a brass `--codeInk:#8a6420`; coral's is a teal-green with
`--codeInk:#ff9f8a`. The picker was already carrying its personality in
a different token and only incidentally dragging the identity with it.

Two channels, not one. So they were separated: `--accent`,
`--accent-ink`, `--goHover` and `--glowSoft` were removed from all
fourteen rules, leaving them to inherit the family's values from
`category.css`, and the picker kept `--codeInk`, `--markBg`,
`--sideGlass`, `--selBg`, `--modalHead`, `--cpbEdge` and `--cpbInk`.

Removed rather than pinned to a literal: a hard-coded `#81D67B` in
fourteen places is fourteen more copies of a fact `category.css` already
owns, and this file exists because of a fact kept in two places.

**The guard passes unchanged. Nothing was relaxed, nothing re-plumbed,
and the tile matches the tool again.**

### What it cost, measured after the fact

The two paragraphs above were written before the check that could
contradict them, and the check contradicted part of them. The channels
are separable – that stands. But two of the seven pairs had been relying
on `--accent` to tell them apart, and pinning it removed a difference
you could see:

| pair | `--accent` apart, before | `--codeInk` apart, after |
|---|---|---|
| brass / forest | ΔE 33.3 | ΔE **8.5** |
| clay / coral   | ΔE 25.5 | ΔE **12.0** |

At 8.5 the two were indistinguishable in a side-by-side crop of the same
rows. So *something* was re-plumbed: the whole burden of telling the
seven apart moved onto one token that had only been carrying a secondary
part of it. The fix was to widen `--codeInk` rather than to unpin – see
the entry on deriving the ΔE floor – but the claim as first written was
wrong, and it was wrong in the direction of the author's own proposal.

## A conclusion committed ahead of its evidence

5 November, and the shape is this file's, not a tool's.

The entry above shipped in `07dd455` saying **"nothing was relaxed,
nothing re-plumbed"**. The measurement that would have tested that
sentence – render all seven with `--accent` pinned and look – had not
been run yet. It ran afterwards and said otherwise.

Being wrong in conversation costs a correction. Being wrong **in this
file** costs more, because a decisions entry is what a future reader
trusts *instead of* re-deriving. Somebody reading that paragraph in six
months would have taken "nothing was re-plumbed" as settled and not
measured the pairs, which is precisely the work the entry was there to
save them.

It is the same shape as a guard written in terms of the mechanism: the
conclusion was written from the reasoning that motivated the change
rather than from the artefact the change produced. A proxy agrees with
you. The page does not.

**The rule: a claim ships in the same commit as the measurement that
supports it, or it does not ship.** Not "ship it and verify after" – if
the verification is still to come, the entry says what was done and
stops there, and the conclusion waits for the commit that can prove it.

## The ΔE floor was measured, not chosen – and so was the ground

8 November. `--codeInk` had to carry the whole difference between the
seven accents, so it needed a number to clear. Two numbers, in fact,
and both were nearly got wrong.

### The ground is `--card`, not the photograph

The obvious ground for "is this code legible" is what is actually
painted behind it. So it was measured: the scene `.webp` drawn at
`center/cover` into a canvas, the `--tint` gradient composited on top,
then the panel glass and the zebra stripe, sampled only over the
panel's own bounding box.

    dark   ground runs  rgb(16,29,18) .. rgb(43,57,45)
    light  ground runs  rgb(155,156,155) .. rgb(243,245,244)

Against the **darkest** light-mode pixel, `#1d3b66` measures 4.08 and
`--muted` measures 3.29 – and `--muted` is shipped, on every tool, and
has been through the contrast work twice. A standard that condemns the
existing body text is not the standard this page is held to; it is a
different standard being smuggled in under one token.

What the repository actually governs is the opaque card: `family.test.js`
resolves `var(--card)` and measures against that. Dark `#142006`, light
`#ffffff`. So that is the ground used here, for consistency rather than
convenience, and the photograph finding is recorded as its own thing:
**text over the darkest parts of the scene image is below 4.5 across the
whole site, not just here.** It is not fixed in this change because it is
page-wide and was not asked for.

### The floor came from a blind staircase

Picking "ΔE 10 sounds about right" is the same error as picking 1200 ms
for the coalescing window by feel. So it was measured the same way.

Nine pairs per mode, ΔE 4 to 28, rendered as real code cells on the real
ground, **hue-rotated at constant lightness** – no pair separated by
being brighter, which is an easier discrimination than the one the
accents actually need. Shown in a shuffled order labelled only `P1..P9`,
judged before the key was read.

| judged | dark | light |
|---|---|---|
| same      | 3.9, 7.0, 9.2 | 3.7, 6.8, 8.8 |
| different | 10.8 and above | 10.8 and above |

A clean break in both modes: **9.2 was the largest failure, 10.8 the
smallest success.**

The floor is **14**, not 11. Three reasons, all from evidence already in
hand:

1. 10.8 was a success but a faint one – adopting it would make the
   weakest thing I could just about see the standard.
2. The staircase is an *easier* test than the real page. It shows the
   pair adjacent, same size, same ground, same instant. Nobody ever sees
   two accents that way: you pick one and live in it, so the real
   comparison is against memory, which is far weaker.
3. The one field pair measured at 12.0 – clay/coral before this change –
   read as borderline on the page itself. A floor at 12 would admit it.

14 clears the entire failure band, the faint band, and the borderline
field case, and sits well under 22.7, the smallest gap that read as
plainly different in the wild. It is reachable: the solved palette's
worst pair is 15.1 dark and 21.6 light.

### The palette is the quietest one that clears it, not the widest

First attempt maximised the minimum pairwise distance subject to 4.5:1.
It returned `#19f90f` and `#ff0fce`. Correct, and unusable – **separation
is a constraint, not an objective.**

The objective is to stay in the register the page already has. Each name
gets a target: the average lightness and chroma of the current seven, at
that name's own Lab hue. The search minimises total drift from those
targets subject to 4.5:1 on `--card` and every pair at or above 14.
Five of the seven land within ΔE 1 of their target; dark coral moves
6.3 and light ink 5.3, which is what clearing the floor cost.

    dark    coral #ffa79e  clay #f5b28e  brass #eace90  forest #9cc69a
            mint  #a8e9d8  ink  #8db3e4  plum  #f3acd2
    light   coral #a73836  clay #8a4319  brass #7a620d  forest #1f5c26
            mint  #007d69  ink  #004d86  plum  #8c3469

Looked at afterwards, all seven side by side in both modes, from the
values read back off the rendered page rather than out of the
stylesheet: seven.

**Still open, deliberately.** `--markBg`, `--cpbEdge` and `--cpbInk` were
not touched, so forest's search highlight is still gold and mint's is
still pale green – they were tuned to the *old* `--codeInk` and now
disagree with their own theme. Raised, not fixed: only `--codeInk` was
asked for.

## Fix the ink before the fill, and the polarity is per theme

The Disposed segment button measured **3.39:1** — white on `#e2607a`,
under the 4.5 floor.

My first instinct was to darken the *fill* to `#c2405c`, which measures
5.02. That is changing a colour somebody chose in order to fix a defect
in something else. **The fill is the design; the ink is the fix.**
`#2b0f16` on the untouched pink is 5.23.

Then I shipped it wrong, and the guard caught it mid-flight.

`--bad` flips with the theme: `#e2607a` in dark is a mid-light pink and
wants dark ink; `#c2405c` in light is deeper and wants white. Setting
`#2b0f16` for both **cleared dark at 5.23 and left light at 3.54** — one
theme fixed, the other broken, in the same edit. `family.test.js`
reported it on the next run, before it reached anybody.

The first repair was a separate `html[data-theme="light"]` override,
which the browser would have honoured and the test could not see: it
measures each rule independently and the override carried no background,
so the original rule still resolved against light's `--bad` and still
failed. **The test was right to keep failing.** A fix the guard cannot
see is a fix that the next edit silently undoes.

So the ink became `--badInk`, declared in both theme blocks, and one
rule is now correct in both: 5.23 dark, 5.02 light, measured through
`contrast.js`.

**Two rules out of it.** Fix the ink before the fill — a contrast
failure is not a licence to repaint somebody's chosen colour. And
polarity is **per theme, not per element**: a token that flips between
themes needs its partner to flip with it, and checking only the theme
you happen to be looking at is how you fix half of it.

## The first design import that was a superset

Every previous import of this project pointed backwards. The last one
was 21 hunks, 19 of which would have removed that week's work —
`store.js` unloaded, `const XDB` restored, `r.rows.length` back in the
tiles.

This one did not. `tools/materials/index.html` came back carrying **the
Supabase layer, the probe gate (`MSTAMP`/`since`), `RELOG.decide`, the
`[hidden]` override, the label table, the owner upload block and the
footer** — all intact — with the accent picker, the disposed filter and
the liquid-glass scrollbar added on top. A clean superset. It even named
the four WebP files encoded here the day before, and the one checked
decoded **byte-identical** to the repo's copy.

**That is the evidence the push was worth doing.** Pushing
`project-update/index.html` and `whattodo/index.html` into the design
project put the repo's current state where the design app could read it,
and the next thing it drew was built on top of that state instead of on
a snapshot from a fortnight earlier. Two stopped attempts and a lot of
argument about backups bought exactly one thing, and this is it.

The corollary: the imports were never going backwards because the design
app was careless. They went backwards because it was working from the
most recent thing it had been given, and nobody had given it anything
recent.
