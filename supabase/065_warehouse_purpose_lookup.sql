-- 065_warehouse_purpose_lookup.sql  ·  Purpose is a list like the others
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Needs 059.
--
-- WHY THIS MIGRATION EXISTS AT ALL. Purpose has been six words hardcoded
-- into warehouse.js since the tool was written - Repair, Return to vendor,
-- Loan, Transfer, Testing, Scrap - and a warehouse that has been running
-- for years has more reasons to move a thing than six. It becomes a list
-- in wh_lookups like project, party, source and vendor already are.
--
-- THE PART THAT IS NOT OBVIOUS FROM THE FILES. 059 gave wh_lookups a CHECK
-- constraint naming the five kinds it knew about:
--
--   CHECK (kind = ANY (ARRAY['project','party','source','vendor','location']))
--
-- 'purpose' is not in it, so the insert that adds a new purpose is refused
-- by Postgres, not by the page. That matters more than it sounds: the page
-- swallows the failure. lookAdd() ends in a bare catch(e){} and the Add
-- button toasts "added" whether or not anything was written. Without this
-- migration the user types a new purpose, is told it was saved, and finds
-- it gone on the next load, with nothing anywhere saying why. Widening the
-- constraint is the whole fix; the silent-catch is a separate bug and is
-- being fixed in the page.
--
-- Re-running is safe: the constraint is replaced by name, and the seed
-- rows are ON CONFLICT DO NOTHING.

-- the same five kinds, plus the sixth
alter table wh_lookups drop constraint if exists wh_lookups_kind_check;
alter table wh_lookups add constraint wh_lookups_kind_check
  check (kind = any (array['project','party','source','vendor','location','purpose']));

-- the six that were hardcoded, so the list is not empty on first load
insert into wh_lookups(kind, name) values
  ('purpose', 'Repair'),
  ('purpose', 'Return to vendor'),
  ('purpose', 'Loan'),
  ('purpose', 'Transfer'),
  ('purpose', 'Testing'),
  ('purpose', 'Scrap')
on conflict do nothing;

-- and any purpose already written on a note that is not one of those six.
-- Notes were free to carry anything before this; none of it is lost.
insert into wh_lookups(kind, name)
  select distinct 'purpose', btrim(purpose)
  from wh_notes
  where purpose is not null and btrim(purpose) <> ''
on conflict do nothing;

-- what you should see: purpose with six rows or more
select kind, count(*) as n, string_agg(name, ', ' order by name) as names
from wh_lookups group by kind order by kind;
