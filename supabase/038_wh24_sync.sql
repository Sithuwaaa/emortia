-- Emortia · migration 038 — WH24: when WorkHub was last ASKED
-- Run in Supabase → SQL Editor → New query. Safe to run more than once, by
-- construction: create-if-missing, drop-policy-before-create, and a seed row
-- guarded by on conflict do nothing. Nothing here drops or rewrites data.
--
-- WHY
--
-- wh24_tickets.synced_at is stamped when a row is WRITTEN. A sync that runs
-- perfectly and finds nothing to change writes nothing, so synced_at does not
-- move - and the header went on saying "Synced 6 h ago" whether the last sync
-- was six hours ago, six minutes ago, or had never happened at all. Those are
-- three different situations and the tool showed one sentence for all three.
--
-- Checking and changing are different events and need two different times.
-- The changed time is already on the rows. This is the checked time.
--
-- It cannot live in localStorage. Three people read this tool on three
-- laptops and one of them syncs; stored in the browser, the two who do not
-- sync would see "never checked" for ever, which is the same lie pointing the
-- other way. It is one fact about the data, so it belongs beside the data.
--
-- ONE ROW, FOR EVER
--
-- Not a log. The question is "how old is what I am looking at", and that has
-- exactly one answer at a time. A history table would need pruning and would
-- answer a question nobody asked.

create table if not exists wh24_sync (
  id            integer primary key default 1,
  checked_at    timestamptz,                  -- WorkHub was last asked
  published_at  timestamptz,                  -- something last actually changed
  tickets       integer,                      -- how many came back
  changed       integer,                      -- how many of them differed
  checked_by    text,
  constraint wh24_sync_one_row check (id = 1)
);

comment on table wh24_sync is
  'One row. When WorkHub24 was last asked, as distinct from when a ticket last changed.';

insert into wh24_sync (id) values (1) on conflict (id) do nothing;

alter table wh24_sync enable row level security;

drop policy if exists "wh24_s_read"  on wh24_sync;
drop policy if exists "wh24_s_write" on wh24_sync;

-- Anyone who can open the tool needs to know how old the numbers are. That is
-- the whole point: the two who do not sync are the ones who cannot otherwise
-- tell.
create policy "wh24_s_read" on wh24_sync
  for select using (may_read('tool:wh24'));

-- Only the owner syncs, so only the owner can say when a sync happened.
create policy "wh24_s_write" on wh24_sync
  for all using (is_owner()) with check (is_owner());

-- so a sync on the laptop moves the other two screens without a reload
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'wh24_sync')
  then alter publication supabase_realtime add table wh24_sync; end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════ check
--
--   select * from wh24_sync;                 -- exactly one row, id = 1
--   select count(*) from wh24_sync;          -- 1, and 1 again after a re-run
--
--   insert into wh24_sync (id) values (2);
--   -- must FAIL on wh24_sync_one_row. If it succeeds the table is a log and
--   -- the page will read whichever row it happens to get first.
--
-- Run the whole file twice. The second run must change nothing:
--   select checked_at from wh24_sync;        -- same value both times
--
-- And signed out, with the anon key alone, this must be REFUSED - 42501,
-- not a 201. It is the one table on this tool a signed-out stranger could
-- otherwise use to tell everybody the data is fresh when it is not:
--
--   await fetch(URL + '/rest/v1/wh24_sync', { method:'POST',
--     headers:{ apikey: ANON, 'Content-Type':'application/json',
--               Prefer:'resolution=merge-duplicates' },
--     body: JSON.stringify({ id:1, checked_at:'2030-01-01T00:00:00Z' }) })
