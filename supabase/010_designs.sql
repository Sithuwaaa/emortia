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

-- Emortia · migration 010 — design sheets on the server
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- What this is for: a design book is dropped into the extractor on one
-- machine and the result has been living in that browser's IndexedDB ever
-- since. Open the tool anywhere else and it is empty. This puts the extracted
-- sites on the server so an upload from the laptop is there on the desktop.
--
-- The rule that shapes the table: when the same book comes back with one site
-- altered, only that site is written. So a site is a row of its own with a
-- fingerprint against it, not a blob of 245 sites rewritten every time.

-- ────────────────────────────────────────────────────────────── the sites

create table if not exists design_sites (
  id          uuid primary key default gen_random_uuid(),

  -- The 2026 MBB new-sites book and the 2025 HBB upgrade book describe
  -- different work, sometimes on the same site. Keyed together so one never
  -- overwrites the other.
  scope       text not null,
  site_id     text not null,

  -- the whole extracted site, as the parser produced it
  data        jsonb not null default '{}'::jsonb,

  -- what the data hashed to when it was written. The upload compares against
  -- this and skips anything that matches, which is what stops 245 rows being
  -- touched to record one changed azimuth.
  fingerprint text not null,

  -- Which project the site belongs to. The 2026 MBB book carries this per
  -- row in "New AP Batch Name" and holds nineteen different batches in one
  -- file, so it is a property of the site and not of the upload. Books with
  -- no such column fall back to the programme name.
  project     text,

  batch       text,                       -- the file it came from
  first_seen  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid(),

  unique (scope, site_id)
);

create index if not exists design_sites_scope_idx on design_sites (scope, site_id);
create index if not exists design_sites_seen_idx  on design_sites (scope, updated_at desc);
create index if not exists design_sites_proj_idx  on design_sites (project);

alter table design_sites enable row level security;

drop policy if exists "design_read"  on design_sites;
drop policy if exists "design_write" on design_sites;

-- signed in: may read everything, the same as the site list
create policy "design_read" on design_sites
  for select using (auth.role() = 'authenticated');

-- signed in: may upload. A design book is team data, not personal.
create policy "design_write" on design_sites
  for all
  using      (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create or replace function design_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists design_touch_trg on design_sites;
create trigger design_touch_trg before update on design_sites
  for each row execute function design_touch();

-- ──────────────────────────────────────────────────────────── the uploads

-- Every upload leaves a line, so "what came in on Tuesday and what did it
-- change" is answerable. Without it there is a current state and no history,
-- and the first question after a vendor resend is always what moved.
create table if not exists design_batches (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null,
  file_name   text,
  sites       integer not null default 0,
  added       integer not null default 0,
  changed     integer not null default 0,
  unchanged   integer not null default 0,
  changed_ids text[],                     -- which sites moved, for the tab to list
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid default auth.uid(),
  uploaded_name text
);

create index if not exists design_batches_when_idx on design_batches (uploaded_at desc);

alter table design_batches enable row level security;

drop policy if exists "design_batch_read"  on design_batches;
drop policy if exists "design_batch_write" on design_batches;

create policy "design_batch_read" on design_batches
  for select using (auth.role() = 'authenticated');

create policy "design_batch_write" on design_batches
  for insert with check (auth.role() = 'authenticated');

-- so an upload on the laptop appears on the desktop without a reload
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'design_sites')
  then alter publication supabase_realtime add table design_sites; end if;
end $$;
