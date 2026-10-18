# Removing a task in What To Do – proposal

Written 13 October 2026. **Nothing here is built.** The × is disabled on the
page as of this date and stays disabled until this is agreed.

---

## 1. What the × did, in plain words

You asked four questions. The answers, read out of the code rather than
remembered:

**Does it hard-delete, soft-delete, or hide?**
**Hard-delete.** `db.js` → `removeTodo(id)` issues
`client.from('todos').delete().eq('id', id)`. The row is gone from Postgres.
There is no `deleted_at` column on `todos` and no archive table.

**Is there an undo?**
**No.** There is a `confirm()` box before it, naming the task and counting
its steps, and that is all. A confirmation is not an undo – it asks you to be
certain, it does not let you be wrong. Once the round trip returns, the task
is unrecoverable from inside the tool.

**What happens to the task's sub-steps?**
**They go with it, and nothing is orphaned.** The steps are not rows – they
are `[x]` / `[ ]` lines inside the `note` column on the same row. Deleting
the row deletes the note and therefore the steps. This is the one genuinely
safe property of the current design: there is no second table to leave
dangling.

**Is there an RLS rule, or does it go straight through?**
**There is a rule, and it is owner-only.** Migration `015_roles_and_tiers`
replaced the original policy with:

```sql
create policy "todos_write" on todos
  for all using (is_owner()) with check (is_owner());
```

`for all` covers DELETE. So only the owner can delete; a signed-in reader
with `tool:whattodo` read access gets a policy error, which the page shows as
a toast. It does **not** go straight through.

### So: how bad was it

It is a hard delete with no undo, which is what you asked me to check for. It
was gated by an owner-only RLS policy and a confirm box, so it was not
*open* – but on your own account, one mis-click past a dialog destroyed a
task and every step in it, permanently, with a list that runs back to 7
August behind it. **Disabled this turn**, as instructed: the button renders
greyed with a reason on hover, carries no `data-rm`, and no click handler is
bound to it. `removeTask` and `DB.removeTodo` are left in place, unreferenced,
so agreeing this proposal is a wiring change rather than a rebuild.

---

## 2. What I propose

### The shape: soft delete with a visible, time-boxed undo

Three options, with what each actually costs.

**A. Hard delete + an undo toast (10 seconds)**
The delete is held in the page for ten seconds; the toast offers Undo; if it
expires the row goes for real. Cheap, no migration.
*Why not:* the undo lives in a browser tab. Close the tab, reload, or let the
realtime subscription redraw, and the only copy of the task is gone. It
protects against the mis-click and nothing else.

**B. Soft delete – `deleted_at` on `todos`** ← **recommended**
One nullable column. Delete sets it; every read filters it out; a "Recently
removed" view lists the last 30 days and restores with one click; rows older
than 30 days are swept by a scheduled job or simply left (the table is tiny).
*Cost:* migration 045, plus a filter on every read path.
*The risk you'd be taking on:* a filter that is missed shows a deleted task
as a live one. That is real, and it is the reason I argued against soft
delete in the original comment. It is containable, because `listTodos` in
`db.js` is the **only** read path – one function, one filter, and the
schema test can assert it.

**C. Archive table – move the row to `todos_deleted`**
Strongest isolation: a missed filter is impossible because the row is not in
`todos` any more.
*Why not:* a second table, a second RLS policy, and restore becomes a
cross-table move. More machinery than a personal job list earns.

### Recommendation: **B**, with these specifics

1. **Migration 045** – `alter table todos add column if not exists deleted_at timestamptz;`
   plus a partial index `on todos (deleted_at) where deleted_at is not null`.
2. **`db.js`** – `removeTodo` becomes an `update` setting `deleted_at = now()`.
   `listTodos` gains `.is('deleted_at', null)`. A new `restoreTodo(id)` nulls it.
   The hard `delete()` stays available as `purgeTodo(id)`, used only by the
   sweep, never by the page.
3. **The page** – the × soft-deletes with **no confirm dialog**, because the
   undo replaces it: the card slides out and a toast says
   `Removed "AP Approvals LP" · Undo`. Dropping the dialog is the point – a
   dialog you click through every time trains you to click through it.
4. **"Recently removed"** – a line under the done-tasks line, same pattern:
   `3 removed in the last 30 days · show`. Each row restores with one click.
5. **The sweep** – anything with `deleted_at` older than 30 days is purged.
   I would rather run this from the page on load (one `delete` with a `lt`
   filter, owner-only, costs nothing) than add a cron job.
6. **Tests** – the schema test asserts `listTodos` filters `deleted_at`;
   `todo.test.js` gets the restore-window arithmetic. The 30-day boundary is
   the kind of off-by-one that only a test catches.

**What I will not do without you saying so:** purge on any schedule shorter
than 30 days, or add a "delete permanently" control to the page. If you want
the second one, say so and it gets its own confirm, because *that* one is
genuinely final.

---

## ANSWERED AND BUILT — 18 October 2026

Everything below this line is the decision as taken. Where it differs from
my recommendation above, the decision wins and the recommendation is left
standing so the reasoning can be compared later.

**B – soft delete with `deleted_at`.** Migration `045_todos_soft_delete.sql`.

**The two-step confirm STAYS, and the Undo toast as well.** I had argued for
dropping the dialog on the grounds that one you click through daily trains
you to click through it. Overruled, on two grounds I accept: every other
tool on the site asks twice before anything is lost, and consistency across
the suite beats the fatigue argument when deleting a task is rare rather
than daily.

They are kept together deliberately, because **they catch different
mistakes**: the confirm catches the mis-click, the undo catches the decision
regretted ten seconds later. Neither does the other's job.

**30-day sweep, BUT IT NEVER TOUCHES A COMPLETED TASK.**

- The sweep purges only tasks that were never completed.
- A done task that is removed stays soft-deleted and restorable
  **indefinitely**. It is never purged, on any schedule, at any age.

### The archive grows without bound, and that is intended

Say it plainly, because the next person to read this will be tempted to
"fix" it: **there is no retention limit on removed completed tasks, and
adding one would be a regression, not a tidy-up.**

Completed work is a permanent record. "What did I finish last August" is a
question worth being able to answer next year, and a sweep that quietly ate
the answer after thirty days would be destroying exactly the thing the
archive is for. At a few hundred rows a year the growth costs nothing.

This is enforced in three places so it cannot drift:

| where | what holds it |
| --- | --- |
| `db.js` | `purgeRemoved` carries `.eq('done', false)` |
| `todo.js` | `purgeable()` returns false for any `done` task |
| tests | the sweep is asserted empty of completed rows at every age, including ten years on |

**A removed task leaves the counts the moment it leaves the list.** No
change – it is removed, not hidden, so "4 of 7 done" keeps matching what is
on screen.

### Search reaches the archive

- Completed tasks are searched as well as open ones. They were always in
  the list – the done-line only hides them from the day's view – so this
  needed no special case.
- **A finished result is marked `Done` and dated by when it was finished**,
  not when it was scheduled. A search for work completed in May that showed
  the day it was once planned for would be answering a different question.
- **Removed tasks stay out by default**, with an "Include removed" switch in
  the results header. They were removed, not hidden; finding one in an
  ordinary search would make "remove" look as though it had not worked.
- The fixture runs back **300 days** with completed and removed tasks at
  several ages, not a week of open ones.

### What is on screen

- The **×** is live again, behind `Ask.twice` – the same box the rest of the
  site uses. Step two names the task, counts its steps, and says what
  happens next, which differs for finished and unfinished work.
- **Undo** sits in the toast for 12 seconds.
- **"N removed · show"** under the done line. Each row gives the age of the
  removal and its fate: `28 days left` for an unfinished one, `finished ·
  kept` for a completed one.
- The sweep runs from the page, at most once a day, 2.5s after first paint.

### One thing I could not exercise

`removeTodo` translates a missing-column error into "run migration 045".
Signed out, the auth check returns first, so that branch was not reached on
the rendered page. Its presence is asserted in `db.schema.test.js`. The
guarantee that actually matters – that it can never silently hard-delete –
does not depend on it: `removeTodo` contains no `.delete(` at all, and the
test asserts that too.

---

## 3. The questions this proposal asked

- **B, A, or C?** (I recommend B.)
- **30 days**, or a different window?
- Should a removed task still count in the calendar and the stats while it
  sits in the restore window? **My suggestion: no** – it is removed; it
  should leave the counts the moment it leaves the list, or "4 of 7 done"
  stops matching what is on screen.

Answered on 18 October - see the section above.
