-- Emortia · migration 035 — the days the country is not working
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 019 first. Independent of 032 and 033.
--
-- WHAT THIS ADDS AND WHY
--
-- The sheet had two states for a day somebody did not clock in: on leave, or
-- absent. A Poya day was an absence. So was Independence Day, and so was every
-- day of the Sinhala and Tamil New Year - twenty-five people marked as not
-- turning up on a day the office was shut.
--
-- A holiday is a fact about the country and not about a person, so it lives in
-- its own table and the sheet reads it. A day on this list is not an absence
-- and not leave; it is its own thing, and it has its own column in the export.
-- Somebody who came in anyway still counts as present - a photograph outranks
-- the calendar.
--
-- WHY THE DATES ARE NOT IN HERE
--
-- Poya days follow the moon: there are twelve or thirteen a year and they move
-- every year. The Sinhala and Tamil New Year is set astrologically, and the
-- mercantile and bank holiday lists are gazetted and are not identical to one
-- another. None of that can be worked out in code, and a wrong holiday is
-- worse than no holiday - it would mark a working day as a day off and quietly
-- take it out of everybody's attendance.
--
-- So the table ships empty and the office fills it from the gazette. There is
-- a screen for it on the dashboard; the SQL at the bottom is for doing a whole
-- year in one go. Do not take the dates from memory, including mine. Take them
-- from the published list.

create table if not exists attend_holidays (
  day        date primary key,
  name       text not null,
  kind       text not null default 'public',   -- public | poya | mercantile | bank
  created_at timestamptz not null default now()
);

alter table attend_holidays add constraint attend_holidays_name_shape
  check (length(btrim(name)) between 1 and 80) not valid;

comment on table attend_holidays is
  'The days the country is not working. A day here is neither an absence nor leave. Filled from the gazette by the office; the dates cannot be computed.';
comment on column attend_holidays.kind is
  'public, poya, mercantile or bank. Free enough that a day which is two of those can be filed as the one that matters to this office.';

alter table attend_holidays enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'attend_holidays'
  loop
    execute format('drop policy if exists %I on public.attend_holidays', r.policyname);
  end loop;
end $$;

-- Read on the tool's tier, the same as the roster: everybody who reads a sheet
-- needs to know which days were holidays or the sheet does not make sense.
-- Written by anyone who can edit, because filling in next year's Poya days is
-- clerical work and not an act of administration.
create policy "attend_holidays_read"  on attend_holidays
  for select using (may_read('tool:attendance'));
create policy "attend_holidays_write" on attend_holidays
  for all using (may_write('tool:attendance')) with check (may_write('tool:attendance'));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'attend_holidays')
  then alter publication supabase_realtime add table attend_holidays; end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════ check
--
-- The device path is untouched: a token cannot read this.
--   select * from attend_holidays;     -- empty from a signed-out console
--
-- To fill a year in one go, from the gazetted list - the three below are the
-- fixed-date ones and are here as a shape to copy, not as a complete year.
-- The Poya days and the New Year are deliberately absent; put in the real
-- dates from the published calendar.
--
--   insert into attend_holidays (day, name, kind) values
--     ('2026-02-04', 'Independence Day', 'public'),
--     ('2026-05-01', 'May Day',          'public'),
--     ('2026-12-25', 'Christmas Day',    'public')
--   on conflict (day) do update set name = excluded.name, kind = excluded.kind;
--
-- And to see what a month has on it:
--   select day, name, kind from attend_holidays
--    where day >= '2026-09-01' and day <= '2026-09-30' order by day;
