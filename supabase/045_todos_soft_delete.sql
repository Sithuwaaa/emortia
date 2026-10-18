-- Emortia · migration 045 — What To Do: removing a task without losing it
--
-- Run in Supabase → SQL Editor. Safe to run more than once - add-column-if-
-- not-exists, nothing dropped and nothing rewritten. Existing rows get null,
-- which means "not removed", which is what every one of them is.
--
-- WHY
--
-- The × on a task card hard-deleted the row: one DELETE, no undo, the task
-- and every step inside its note gone for good. It was gated by the
-- owner-only RLS policy from 015 and by a confirm box, but a confirm box is
-- not an undo - it asks you to be certain, it does not let you be wrong.
-- The control was disabled on 13 October and stays disabled until this
-- column exists.
--
-- WHAT deleted_at MEANS
--
--     null         the task is live
--     a timestamp  the task was removed at that moment
--
-- Every read in the tool filters it. There is exactly one read path -
-- listTodos in tools/_lib/db.js - which is what makes a soft delete
-- defensible here: a missed filter would show a removed task as a live one,
-- and with one place to miss, it is checked by a test rather than by hope.

alter table todos add column if not exists deleted_at timestamptz;

comment on column todos.deleted_at is
  'When this task was removed. null means live. Set by removeTodo, cleared '
  'by restoreTodo, and read as a filter by listTodos. The sweep hard-deletes '
  'rows older than 30 days ONLY where done = false - completed work is a '
  'permanent record and is never purged on any schedule.';

-- The index is partial on purpose. Almost every row is live, so an index
-- over the whole column would be a long list of nulls that nothing reads.
-- The only queries that touch deleted_at by value are the "Recently
-- removed" list and the sweep, and both want exactly this subset.
create index if not exists todos_deleted_idx
  on todos (deleted_at)
  where deleted_at is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- THE SWEEP NEVER TOUCHES COMPLETED WORK
--
-- The page purges rows removed more than 30 days ago, but only where
-- done = false. A task that was finished and then removed stays
-- soft-deleted and restorable indefinitely.
--
-- THIS MEANS THE ARCHIVE GROWS WITHOUT BOUND, AND THAT IS INTENDED.
-- Completed work is a record to look back on - "what did I finish last
-- August" is a question worth being able to answer next year. Nobody should
-- "fix" this later by adding a retention window to done rows. The table is
-- a personal job list; at a few hundred rows a year the growth is nothing,
-- and the value of a permanent record is not nothing.
--
-- The rule is enforced in db.js (purgeRemoved filters .eq('done', false))
-- and asserted in tools/whattodo/todo.test.js, which checks that a
-- completed task is never selected for purging at any age.
-- ─────────────────────────────────────────────────────────────────────────
