-- ⚠ SUPERSEDED IN PART BY MIGRATION 015.
--
-- The policies below still say auth.role() = 'authenticated', which asks only
-- whether an account exists. 015 replaced every one of them with the three
-- tiers - public / tooway / mine, read off profiles.role and feature_locks.tier
-- - and dropped these by name on the way through.
--
-- The table and column statements here are still current and still safe to
-- re-run. The policy statements are not: running this file again would put the
-- weaker rule back alongside the newer one, and policies are OR-ed, so the
-- weaker one would win. If you do re-run it, run 015 afterwards.

-- Emortia · migration 011 — unlocking owner-only things for the team
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- What this is for: three tools and the journal are the owner's alone, and
-- every so often one of them needs opening up - somebody else has to file a
-- project update this week, or use the lyric tool for a release. Editing a
-- file and pushing it to do that is the wrong shape of job. This is a switch.
--
-- Locked is the default and always the default: a feature with no row here is
-- owner-only, so adding a new owner-only thing needs nothing done here, and a
-- failed read leaves everything shut rather than open.

create table if not exists feature_locks (
  feature     text primary key,
  unlocked    boolean not null default false,
  note        text,                        -- why it was opened, for later
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

alter table feature_locks enable row level security;

drop policy if exists "locks_read"  on feature_locks;
drop policy if exists "locks_write" on feature_locks;

-- Everyone signed in may read them. They have to: a tool has to know whether
-- it is open before it decides whether to let somebody in.
create policy "locks_read" on feature_locks
  for select using (auth.role() = 'authenticated');

-- Only the owner may set them. This is the whole point of the table, and it
-- is enforced here rather than in the page - a switch that only the interface
-- hides is not a lock at all.
create policy "locks_write" on feature_locks
  for all
  using      (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid)
  with check (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid);

create or replace function locks_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists locks_touch_trg on feature_locks;
create trigger locks_touch_trg before update on feature_locks
  for each row execute function locks_touch();

-- the four that exist today, all shut, which is how they are now
insert into feature_locks (feature, unlocked) values
  ('journal',              false),
  ('tool:lyric-video',     false),
  ('tool:whattodo',        false),
  ('tool:project-update',  false)
on conflict (feature) do nothing;

-- so a switch thrown on the phone reaches the laptop without a reload
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'feature_locks')
  then alter publication supabase_realtime add table feature_locks; end if;
end $$;
