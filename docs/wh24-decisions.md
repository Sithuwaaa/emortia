# WH24 Material Checker — the decisions

Settled, with reasons. Written down so neither of us re-argues them, and so
that the next person to open this file does not "fix" something that is the way
it is on purpose.

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

#### The collision, and when it actually matters

Two GINs issued against one reservation both save as the same name and the
browser adds `(1)`. Accepted. But the cases are not equally harmless:

- **GIN + Activity Report — cannot collide.** The report carries no reservation
  and no GI, so it falls through to its own report number. Asserted, because it
  is the case that would have been worst: two vendors' paperwork under one name.
- **Two GINs, same reservation, same date** — a partial issuance and its
  remainder. Annoying. The files differ only by material lines and either one
  opens to tell you which.
- **Two GINs, same reservation, different dates** — *this* is the confusing one.
  Two identically named files issued weeks or months apart, with nothing in the
  name to say which is which, at exactly the moment you are reconciling when
  material moved. `(1)` is assigned by download order, not by date.
- **Two GINs, same reservation, different streams** — same problem across
  vendors.

The query that finds all four in the live data is in the reply that shipped
this; the classes are the finding, the counts are per-database.
