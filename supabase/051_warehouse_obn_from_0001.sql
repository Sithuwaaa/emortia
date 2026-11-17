-- 051_warehouse_obn_from_0001.sql  ·  OBN numbers start at 0001
--
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- 048 started the OBN counter at 1116 so the first note printed here would
-- be OBN-26-1117 and carry on from the paper book, and it left OBN without
-- the four-digit padding the other kinds get - 1117, not 1117 padded. That
-- is no longer wanted: the warehouse numbers its own notes from the start.
--
-- So OBN is now exactly like GRN and SRN: counted from zero, printed with
-- four digits. The next outbound note is OBN-26-0001.
--
-- WHAT THIS DOES NOT DO. It does not rename notes that already exist.
-- OBN-26-1117 keeps the number it was issued and printed under; a number on
-- a note that has been handed to somebody is not ours to change afterwards.
-- Delete it from the page if it was a test - that puts its stock back - and
-- the counter below is already at zero either way.
--
-- Re-running is safe but note what it means: it sets the counter back to 0,
-- so run it once, before the numbers you want to keep are issued.

-- the same shape as GRN and SRN: no special case for OBN any more
create or replace function wh_next(k text) returns text
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  update wh_counters set n = n + 1 where kind = k returning n into v;
  if v is null then raise exception 'unknown counter %', k; end if;
  return k || '-' || to_char(current_date,'YY') || '-' || lpad(v::text, 4, '0');
end $$;

revoke all on function wh_next(text) from public, anon;
grant execute on function wh_next(text) to authenticated;

-- and back to the beginning
update wh_counters set n = 0 where kind = 'OBN';
