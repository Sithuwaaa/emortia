-- Emortia · migration 037 — WH24: which app a ticket came from
-- Run in Supabase → SQL Editor → New query. Safe to run more than once, and
-- this time by construction: every statement below is add-if-missing,
-- create-or-replace, or an update guarded on the column still being null.
-- Nothing here drops or rewrites data.
--
-- WHY
--
-- 036 was built reading one WorkHub workflow - Material Reservation PH1 -
-- and the tickets table had no way to say so. Reservations also go through
-- PH2, and a dashboard that silently holds half of them does not look as
-- though it is holding half of them: "can collect now: 3" when the answer is
-- 7 reads exactly like a working tool. Before the sync is widened, a ticket
-- has to be able to say where it came from, or there is no way to tell
-- afterwards which half you were looking at.
--
-- TWO COLUMNS, NOT ONE
--
--   workflow   the WorkHub workflow id, 'w8b6c7c686c'. The ground truth. It
--              does not change when somebody renames the app in WorkHub.
--   phase      the short label - 'PH1', 'PH2' - for the screen and the
--              export, where an id means nothing to a reader.
--
-- Deliberately NO check constraint listing the phases. A third phase is the
-- thing most likely to happen next, and a constraint naming two of them would
-- fail the first sync that found a third - loudly, mid-write, having already
-- upserted part of a batch. Text, and the sync writes what it read.

alter table wh24_tickets add column if not exists workflow text;
alter table wh24_tickets add column if not exists phase    text;

comment on column wh24_tickets.workflow is
  'WorkHub workflow id the ticket was read from. Ground truth; survives renames.';
comment on column wh24_tickets.phase is
  'Short label for that workflow - PH1, PH2 - for the screen and the export.';

create index if not exists wh24_tickets_phase_idx on wh24_tickets (phase);

-- A no-op on an empty table, which is what this is today: 036 is run and
-- nothing has been synced. It is here so that if a PH1-only sync has already
-- happened by the time this is run, those rows are labelled rather than left
-- blank. Guarded on null, so a re-run cannot relabel a PH2 ticket as PH1.
update wh24_tickets
   set workflow = 'w8b6c7c686c', phase = 'PH1'
 where workflow is null and phase is null;

-- ───────────────────────────────────────────────────────────── the view again
--
-- The two columns are appended to the END of the select list on purpose:
-- create or replace view will accept new columns added at the end, and
-- refuses any other change to the shape. So this stays a replace rather than
-- a drop, and nothing that reads the view breaks while it is being replaced.
--
-- THE STATE LADDER BELOW IS UNCHANGED, AND IS STILL PH1'S WORDING. That is
-- not an oversight - it is the part that cannot be written until the stage
-- names PH2 actually uses have been read off WorkHub. Widening the sync
-- before that is what would put PH2 tickets on screen in the wrong state.
-- See the note at the foot of this file.

create or replace view wh24_status with (security_invoker = true) as
select t.id, t.site, t.site_name, t.wo, t.reservation, t.stage, t.team, t.status,
       (t.done_at at time zone 'Asia/Colombo')::date                    as ready_on,
       c.collected_on,
       m.collected_by,
       case when c.collected_on is not null                     then 'collected'
            when t.done_at is not null                          then 'ready'
            when t.stage ilike 'System Issuance Pending%'       then 'issuing'
            when t.stage ilike '%shortage%'                     then 'shortage'
            when t.stage ilike '%reject%'                       then 'rejected'
            else 'reserving' end                                 as state,
       (t.done_at is not null and c.collected_on is null)       as can_collect,
       case when t.done_at is not null then
         coalesce(c.collected_on, (now() at time zone 'Asia/Colombo')::date)
           - (t.done_at at time zone 'Asia/Colombo')::date end   as days_waiting,
       t.wh_updated_at, t.synced_at,
       t.phase, t.workflow
  from wh24_tickets t
  left join wh24_marks m on m.ticket_id = t.id
  cross join lateral (select coalesce(m.collected_on,
                        (t.wh_collected_at at time zone 'Asia/Colombo')::date) as collected_on) c;

-- ═══════════════════════════════════════════════════════════════════ check
--
--   select column_name, data_type from information_schema.columns
--    where table_name = 'wh24_tickets' and column_name in ('phase','workflow');
--   -- two rows, both text
--
--   select relname, reloptions from pg_class where relname = 'wh24_status';
--   -- {security_invoker=true}   -- the replace must not have dropped it
--
--   select phase, state, count(*) from wh24_status group by phase, state
--    order by phase, state;
--   -- after the first widened sync: both PH1 and PH2 present, and no PH2 row
--   -- sitting in a state that does not match what WorkHub says it is in
--
-- Run it twice. The second run must change nothing:
--   select count(*) from wh24_tickets where phase is null;   -- same both times
--
-- ═════════════════════════════════════════════════ what this does NOT fix
--
-- This migration only lets a ticket say where it came from. It does not
-- widen the sync and it does not touch the state logic, because both of
-- those need the PH2 stage strings first, and those are in WorkHub where
-- this file cannot see them. Still outstanding after running this:
--
--   workhub.js   reads one hardcoded workflow id and must read the full set
--   wh24.js      isDone/isPending/state() are regexes on PH1's wording, and
--                they run at SYNC time - a PH2 "ready" stage worded any other
--                way leaves done_at null, and the ticket never appears as
--                collectable at all
--   this view    the ladder above, same wording, same problem
