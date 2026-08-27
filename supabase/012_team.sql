-- Emortia · migration 012 — the team directory
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- Why this is a table and not a file.
--
-- The directory is names, mobile numbers and NIC numbers for about ninety
-- people. This repository is public and GitHub Pages serves every file in it,
-- so the same list committed as team-data.js would be sitting at
-- emortia.com/tools/team/team-data.js for anyone who guessed the path - no
-- sign-in, no account, nothing to get past. The sign-in on the tools is a gate
-- on a room with open windows and it has always said so. A hundred people's
-- NIC numbers are not something to put behind a gate like that.
--
-- Here the row-level policies are the real thing: signed in to read, and only
-- the owner to write. Nothing about the directory reaches the repository.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- the teams

create table if not exists team_groups (
  id          text primary key,             -- slug, so a member row keeps its team across a rename
  team        text not null,
  source      text not null default 'other',-- 'sheet' | 'other' | 'custom', which list it came off
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -------------------------------------------------------------- the people

create table if not exists team_people (
  id          uuid primary key default gen_random_uuid(),
  team_id     text not null references team_groups(id) on delete cascade,
  name        text not null,
  mobile      text,
  nic         text,                          -- "ID No" on the sheet
  company     text,
  role        text,
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists team_people_team on team_people (team_id);

-- ------------------------------------------------------------- the vehicles

create table if not exists team_vehicles (
  id          uuid primary key default gen_random_uuid(),
  team_id     text not null references team_groups(id) on delete cascade,
  reg         text not null,                 -- "Vehicle No"
  kind        text,                          -- Crew Cab, Bolero, Van…
  driver      text,
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists team_vehicles_team on team_vehicles (team_id);

-- ------------------------------------------------------------------ locking

alter table team_groups   enable row level security;
alter table team_people   enable row level security;
alter table team_vehicles enable row level security;

-- Reading needs an account AND the switch to be open.
--
-- The switch is checked here rather than only in the page, and that is the
-- whole difference between a lock and a curtain. A page that hides itself
-- still has the rows in it, and anybody signed in could have asked the API
-- for them directly with the switch shut - which is exactly the thing the
-- switch is supposed to prevent. So the policy asks the same question the
-- page asks, and the page becomes a courtesy on top of a real answer.
create or replace function team_open() returns boolean
  language sql stable security definer set search_path = public as $$
    select coalesce((select unlocked from feature_locks where feature = 'tool:team'), false)
$$;

drop policy if exists "team_groups_read"   on team_groups;
drop policy if exists "team_people_read"   on team_people;
drop policy if exists "team_vehicles_read" on team_vehicles;

create policy "team_groups_read" on team_groups for select using (
  auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid
  or (auth.role() = 'authenticated' and team_open()));
create policy "team_people_read" on team_people for select using (
  auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid
  or (auth.role() = 'authenticated' and team_open()));
create policy "team_vehicles_read" on team_vehicles for select using (
  auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid
  or (auth.role() = 'authenticated' and team_open()));

-- Writing is the owner's alone, whatever the switch says. Opening the
-- directory to the team lets them read and copy it; it does not let them
-- rewrite somebody's NIC number.
drop policy if exists "team_groups_write"   on team_groups;
drop policy if exists "team_people_write"   on team_people;
drop policy if exists "team_vehicles_write" on team_vehicles;

create policy "team_groups_write" on team_groups for all
  using      (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid)
  with check (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid);
create policy "team_people_write" on team_people for all
  using      (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid)
  with check (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid);
create policy "team_vehicles_write" on team_vehicles for all
  using      (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid)
  with check (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid);

-- ------------------------------------------------------------- housekeeping

create or replace function team_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists team_groups_touch   on team_groups;
drop trigger if exists team_people_touch   on team_people;
drop trigger if exists team_vehicles_touch on team_vehicles;

create trigger team_groups_touch   before update on team_groups
  for each row execute function team_touch();
create trigger team_people_touch   before update on team_people
  for each row execute function team_touch();
create trigger team_vehicles_touch before update on team_vehicles
  for each row execute function team_touch();

-- so a member added on the phone appears on the laptop without a reload
do $$
declare t text;
begin
  foreach t in array array['team_groups','team_people','team_vehicles'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = t)
    then execute format('alter publication supabase_realtime add table %I', t); end if;
  end loop;
end $$;

-- ------------------------------------------------------------- the switch

-- Shut, like everything of mine. Migration 011 made the table; this only adds
-- the row for the directory so the switch has something to turn.
insert into feature_locks (feature, unlocked) values ('tool:team', false)
on conflict (feature) do nothing;

-- The directory itself is not in this file, and must not be put in it: this
-- file is in the repository too. The one-time seed is written to .work/,
-- which is gitignored. After that the tool does the adding.
