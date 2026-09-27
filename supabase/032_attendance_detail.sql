-- Emortia · migration 032 — the attendance redesign's missing columns
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 018, 019 and 031 first.
--
-- WHAT THIS ADDS AND WHY
--
-- The redesign asks the roster four questions the roster cannot answer. It
-- shows which crew somebody is on, the phone to ring them on, the site they
-- work out of, and the name of the place a photograph was taken - and none
-- of those exist. The design fills them with invented data, which is fine in
-- a mockup and is a lie in a tool: a screen that shows "Kollupitiya" beside a
-- clock-in that has only a pair of coordinates is making it up.
--
-- So the columns are added rather than the numbers faked.
--
--   crew   which crew a person goes out with. Four of them today, but it is
--          free text rather than an enum: crews are a fact about how the work
--          is organised this year, and the table should not have to be altered
--          when a fifth one is formed.
--   phone  so the office can ring somebody who has not clocked in. It is
--          personal data and it is readable on the same tier the roster
--          already is - the same people who can see who was absent.
--   site   the place somebody normally works out of, which is the answer to
--          "where should this person be" rather than "where were they".
--
-- And attend_sites, which is how a photograph gets a place name. A record
-- carries coordinates; a place name is a separate fact about the world, and
-- the only honest way to put one on a screen is to look it up. The page
-- resolves a clock-in to the nearest site within a few hundred metres and
-- shows the coordinates alone when nothing is near - which is the truth when
-- somebody has clocked in from a site nobody has written down yet.

-- ───────────────────────────────────────────────────────── the roster grows

alter table attend_people add column if not exists crew  text not null default '';
alter table attend_people add column if not exists phone text not null default '';
alter table attend_people add column if not exists site  text not null default '';

comment on column attend_people.crew  is 'Which crew this person goes out with. Free text: a fifth crew should not need a migration.';
comment on column attend_people.phone is 'Personal data. Readable on the same tier as the rest of the roster, and never by a device token.';
comment on column attend_people.site  is 'Where this person normally works out of - not where a photograph was taken.';

create index if not exists attend_people_crew on attend_people (crew);

-- ────────────────────────────────────────────────────── the places, by name

-- A handful of rows, written by the office. Latitude and longitude as numbers
-- rather than a string, because the page measures distances against them.
create table if not exists attend_sites (
  id         text primary key,
  name       text not null,
  lat        double precision not null,
  lng        double precision not null,
  radius_m   int not null default 400,    -- how close counts as "here"
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table attend_sites add constraint attend_sites_name_shape
  check (length(btrim(name)) between 1 and 80) not valid;

alter table attend_sites enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'attend_sites'
  loop
    execute format('drop policy if exists %I on public.attend_sites', r.policyname);
  end loop;
end $$;

-- Read on the tool's tier, written by the owner. A site list is the thing
-- every sheet is described against, the same as the roster is.
create policy "attend_sites_read"  on attend_sites
  for select using (may_read('tool:attendance'));
create policy "attend_sites_write" on attend_sites
  for all using (is_owner()) with check (is_owner());

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'attend_sites')
  then alter publication supabase_realtime add table attend_sites; end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════ check
--
-- The device path is untouched: a token still cannot read any of this. From a
-- signed-out console with the anon key, all of these stay empty:
--   select * from attend_people;  select * from attend_sites;
--
-- To start the site list off - the office fills in the rest:
--   insert into attend_sites (id, name, lat, lng) values
--     ('s1','Rajagiriya office', 6.9085, 79.8944),
--     ('s2','Kollupitiya',       6.9161, 79.8506),
--     ('s3','Moratuwa',          6.7714, 79.8835),
--     ('s4','Nugegoda',          6.8645, 79.9017)
--   on conflict (id) do nothing;
--
-- And to put the crews on the roster:
--   update attend_people set crew = 'Crew A' where id in ('...');
