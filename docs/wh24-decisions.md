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
