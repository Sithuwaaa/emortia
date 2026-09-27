-- Emortia · migration 033 — a leave booking is one thing
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 019 first. Independent of 032; either order is fine.
--
-- WHAT THIS FIXES
--
-- attend_leave stores one row per day, which is right: the sheet asks "was
-- this person on leave on this date" and that is a per-day question. But the
-- office does not book leave a day at a time. Somebody says they are away from
-- the 29th to the 1st, and that is one act.
--
-- With only (day, person) to go on, the page had to guess where a booking
-- began and ended by looking for runs of consecutive days in whatever it had
-- loaded - and it loads a month at a time. So a booking of 29 Sep to 1 Oct
-- looked like a two-day booking in September, and cancelling it left 1 Oct
-- behind. That orphan is not a cosmetic problem: it marks somebody on leave on
-- a day they are working, and the October report is wrong from its first line
-- with nothing on screen to explain why.
--
-- Widening the fetch to the neighbouring month would fix that one span and
-- break again on 31 Dec - 2 Jan, or on anything crossing three months. The
-- run is not something to infer. It is something to record.
--
-- So every day written in one act carries the same booking id, and cancelling
-- is "delete where booking = this", which does not care what month is on
-- screen or how many the span crosses.

-- ───────────────────────────────────────────────────────────── the column

alter table attend_leave add column if not exists booking text not null default '';

comment on column attend_leave.booking is
  'Which act of booking wrote this day. Every day of one booking shares it, so a booking can be cancelled as one thing across any number of months.';

create index if not exists attend_leave_booking on attend_leave (booking);

-- ──────────────────────────────────────────────────── the rows already there

-- Existing rows have no booking id and the runs they came from are not written
-- down anywhere, so they are reconstructed the only way left: consecutive days
-- for the same person with the same label are treated as one booking. That is
-- the same guess the page used to make, made once here rather than freshly on
-- every render - and from now on the guess is never needed again.
--
-- (day - row_number()) is constant across a run of consecutive dates and
-- changes at every gap, which is what groups them.

update attend_leave l
   set booking = r.bk
  from (
    select day, person,
           'lv-' || to_char(min(day) over w, 'YYYYMMDD') || '-' ||
           substr(md5(person || '|' || label || '|' ||
                      to_char(min(day) over w, 'YYYYMMDD')), 1, 10) as bk
      from (
        select day, person, label,
               day - (row_number() over (partition by person, label order by day))::int as grp
          from attend_leave
         where booking = ''
      ) s
    window w as (partition by person, label, grp)
  ) r
 where l.day = r.day and l.person = r.person and l.booking = '';

-- ═══════════════════════════════════════════════════════════════════ check
--
-- Nothing should be left without a booking id:
--   select count(*) from attend_leave where booking = '';   -- expect 0
--
-- And a booking should be whole - this lists every one that crosses a month,
-- which is exactly the shape that used to break:
--   select booking, person, min(day) as from_day, max(day) as to_day, count(*)
--     from attend_leave
--    group by booking, person
--   having to_char(min(day),'YYYY-MM') <> to_char(max(day),'YYYY-MM')
--    order by from_day;
--
-- The device path is untouched: a token still cannot read or write leave.
