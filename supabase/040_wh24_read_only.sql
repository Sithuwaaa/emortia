-- Emortia · migration 040 — WH24: Tooway reads it, the owner writes it
-- Run in Supabase → SQL Editor → New query. Safe to run more than once, by
-- construction: it only drops and recreates four policies. No table, column,
-- key, index or row is touched, and nothing already written is lost.
--
-- WHY
--
-- 036 let anyone who can open the tool set a collected date, on the reasoning
-- that the team is who stands at the counter. That is no longer wanted. The
-- tool is the record of what the warehouse is holding and what has come out of
-- it, and a record two people can both write is a record neither of them can
-- rely on: a date Tooway sets and a date the owner sets are indistinguishable
-- afterwards, and the waiting count - the one number the whole tool exists to
-- produce - is computed from exactly that date.
--
-- So: Tooway reads. The owner writes. Reading is unchanged and stays on
-- may_read('tool:wh24'), so nobody loses sight of anything; what goes is the
-- insert and the update.
--
-- wh24_tickets and wh24_sync were already owner-only, from 036 and 038. Marks
-- were the one hole, and they were the only hole: the page's writes are
-- wh24Publish, wh24Mark and wh24NoteCheck, and the first and last land on
-- those two already-closed tables.

-- ───────────────────────────────────────────────────────────── the marks
--
-- Named the same as in 036 so this replaces those policies rather than sitting
-- beside them. A policy left behind would still grant on its own - Postgres
-- ORs permissive policies together - so the drops are the load-bearing half of
-- this migration, not tidying.

drop policy if exists "wh24_m_read"   on wh24_marks;
drop policy if exists "wh24_m_insert" on wh24_marks;
drop policy if exists "wh24_m_update" on wh24_marks;
drop policy if exists "wh24_m_delete" on wh24_marks;

-- unchanged from 036: the whole team sees every collected date, every name and
-- every note. This migration takes away writing, not looking.
create policy "wh24_m_read" on wh24_marks
  for select using (may_read('tool:wh24'));

create policy "wh24_m_insert" on wh24_marks
  for insert with check (is_owner());

create policy "wh24_m_update" on wh24_marks
  for update using (is_owner()) with check (is_owner());

create policy "wh24_m_delete" on wh24_marks
  for delete using (is_owner());

-- The touch trigger stays as it is. updated_by is still stamped from
-- auth.uid(), which from here on will only ever be the owner's - and that is
-- worth keeping rather than simplifying away, because the day this is relaxed
-- again the column is already there and already right.

-- ──────────────────────────────────────────────────────────── verify
--
-- Expect six rows, and every cmd except the two SELECTs qualified by
-- is_owner():
--
--   select tablename, policyname, cmd, qual, with_check
--     from pg_policies
--    where tablename like 'wh24%'
--    order by tablename, policyname;
--
--   wh24_marks    wh24_m_delete  DELETE  is_owner()
--   wh24_marks    wh24_m_insert  INSERT          (with_check) is_owner()
--   wh24_marks    wh24_m_read    SELECT  may_read('tool:wh24'::text)
--   wh24_marks    wh24_m_update  UPDATE  is_owner()   (with_check) is_owner()
--   wh24_sync     wh24_s_read    SELECT  may_read('tool:wh24'::text)
--   wh24_sync     wh24_s_write   ALL     is_owner()   (with_check) is_owner()
--   wh24_tickets  wh24_t_read    SELECT  may_read('tool:wh24'::text)
--   wh24_tickets  wh24_t_write   ALL     is_owner()   (with_check) is_owner()
--
-- Eight rows, not six - the tickets and sync pairs are from 036 and 038 and
-- are listed here so the whole picture is visible in one query.
--
-- The real check is from a signed-in Tooway session, not from here: a mark
-- written from the browser console must come back 403 with 42501, "new row
-- violates row-level security policy for table wh24_marks". A 200 means a 036
-- policy is still in place.
