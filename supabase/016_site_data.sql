-- Emortia · migration 016 — the Site Data table, and the end of the bundled copy
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- WHY THIS EXISTS
--
-- Migration 015 put the two lookup tools behind the tooway tier. It did not
-- help either of them, because neither was really reading the database:
--
--   tools/site-access/data.json   1.6 MB   5,934 sites, depot, contact,
--                                          access permissions
--   tools/site-data/data.json     4.4 MB   13,000+ sites, technical profiles
--
-- Both files were committed, and GitHub Pages serves every file in this
-- repository, so both were readable at a guessable URL with no account, no
-- session and nothing to get past. A row level policy on `sites` is not a
-- boundary while the same rows sit beside it as a static file.
--
-- So the files are gone, the fallback that read them is gone, and Site Data
-- gets the table it never had. From here both tools read the database or they
-- read nothing.
--
-- ORDER MATTERS. Run this, then open each tool signed in as the owner and
-- upload the workbook. Until the upload the tool will say it has no data,
-- because that is now the truth: there is no copy in the repository to fall
-- back to, and that is the whole point.

-- ─────────────────────────────────────────────────────── the technical sheet

-- Shaped like `sites` from migration 002, and for the same reason: the sheet
-- has forty-odd columns, several of them not valid unquoted identifiers, and
-- the tool keys its labels, groups and search config off the sheet's own
-- headings. The whole row goes in as jsonb under those headings, with the two
-- fields worth indexing lifted out as generated columns.
create table if not exists site_data (
  site_id     text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

alter table site_data add column if not exists site_name text
  generated always as (data->>'Site_Name') stored;
alter table site_data add column if not exists district text
  generated always as (data->>'District') stored;

create index if not exists site_data_district_idx on site_data (district);
create index if not exists site_data_gin_idx      on site_data using gin (data);

alter table site_data enable row level security;

-- Every policy on it, then the two that should be there. Same reasoning as
-- 015: policies are OR-ed, so a permissive one left standing would let
-- everything past the rule written under it.
do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'site_data'
  loop
    execute format('drop policy if exists %I on public.site_data', r.policyname);
  end loop;
end $$;

create policy "site_data_read" on site_data
  for select using (may_read('tool:site-data'));

create policy "site_data_write" on site_data
  for all using (is_owner()) with check (is_owner());

create or replace function site_data_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists site_data_touch_trg on site_data;
create trigger site_data_touch_trg before update on site_data
  for each row execute function site_data_touch();

-- so an upload on the laptop reaches the phone without a reload
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'site_data')
  then alter publication supabase_realtime add table site_data; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════ check
--
-- Before the upload this is 0, and the tool says it has nothing. After it,
-- it should be the row count off the sheet:
--   select count(*) from site_data;
--   select key, row_count, updated_at from datasets order by key;
--
-- And nothing should be readable without a session. From a signed-out
-- browser console, both of these must come back empty:
--   await (await fetch(URL + '/rest/v1/site_data?select=site_id&limit=1',
--          { headers: { apikey: ANON } })).json()
--   await (await fetch(URL + '/rest/v1/sites?select=site_id&limit=1',
--          { headers: { apikey: ANON } })).json()
