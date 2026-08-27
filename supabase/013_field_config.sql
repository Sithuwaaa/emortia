-- Emortia · migration 013 — the field config reference, and a row per switch
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- Why this is a table and not a file, again.
--
-- The reference holds the UMPT passwords, the LMT logins, the FTP account and
-- the Wi-Bas admin credentials. This repository is public and GitHub Pages
-- serves every file in it, so the same list committed as config-data.js would
-- put Dialog's BBU passwords on the open internet at a guessable path. That is
-- a worse thing to publish than the directory was.
--
-- One row holding one JSON document, because the whole reference is edited
-- rarely and read constantly, and a document keeps the vendors, groups and
-- sections in the shape the page already renders.

create table if not exists field_config (
  id          text primary key default 'main',
  doc         jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

alter table field_config enable row level security;

-- Reading needs an account AND the switch open - the same shape as the
-- directory in 012, and for the same reason: a page that hides itself still
-- has the passwords in it, and anybody signed in could have asked the API
-- directly. The policy is the lock; the page is the courtesy.
create or replace function field_config_open() returns boolean
  language sql stable security definer set search_path = public as $$
    select coalesce((select unlocked from feature_locks
                     where feature = 'tool:field-config'), false)
$$;

drop policy if exists "field_config_read"  on field_config;
drop policy if exists "field_config_write" on field_config;

create policy "field_config_read" on field_config for select using (
  auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid
  or (auth.role() = 'authenticated' and field_config_open()));

create policy "field_config_write" on field_config for all
  using      (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid)
  with check (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid);

create or replace function field_config_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end $$;

drop trigger if exists field_config_touch_trg on field_config;
create trigger field_config_touch_trg before update on field_config
  for each row execute function field_config_touch();

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'field_config')
  then alter publication supabase_realtime add table field_config; end if;
end $$;

-- ------------------------------------------------------- a row per switch

-- Every feature gets a row, so the switch on the Owner page is the only thing
-- that decides and the page never has to fall back on an assumption.
--
-- The six the team already works with every day go in open, because that is
-- what they are today and this migration must not quietly take them away. The
-- five that are the owner's go in shut, which is also what they are today.
insert into feature_locks (feature, unlocked) values
  ('journal',              false),
  ('tool:lyric-video',     false),
  ('tool:whattodo',        false),
  ('tool:project-update',  false),
  ('tool:team',            false),
  ('tool:field-config',    false),
  ('tool:esn',             true),
  ('tool:design-extractor',true),
  ('tool:bom',             true),
  ('tool:site-access',     true),
  ('tool:site-data',       true),
  ('tool:gin-extractor',   true)
on conflict (feature) do nothing;   -- a switch already thrown keeps its answer

-- The reference itself is not in this file and must not be put in it: this
-- file is in the repository too. The one-time seed is written to .work/,
-- which is gitignored.
