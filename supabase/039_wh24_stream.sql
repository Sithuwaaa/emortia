-- Emortia · migration 039 — WH24: one row per vendor stream
-- Run in Supabase → SQL Editor → New query. Safe to run more than once, by
-- construction: add-column-if-missing, a primary key swapped only when it is
-- not already the pair, create-or-replace for the view. No data is dropped or
-- rewritten, and the 384 rows already there do not move.
--
-- WHY
--
-- A PH2 card is a site work order carrying TWO parallel vendor streams -
-- Advantis and ACE - each with its own reservation, its own material table,
-- its own GRN and its own issuance note. They are issued on different days by
-- different vendors. One row per card can hold only one done_at, so it would
-- call the card ready when only half of it was, and the other half would be
-- invisible.
--
-- The blocker was never the tickets table. It is wh24_marks: its primary key
-- is ticket_id, so there is exactly ONE collected-date per card. Collect
-- Advantis today and ACE next week and the second cannot be recorded at all.
-- Per-stream collection needs per-stream marks, which is why both tables move
-- together or neither does.
--
-- PH1 and Bulk are single-stream and keep one row per card: their stream is
-- '', which is also what every existing row gets from the default. Only PH2
-- splits.

alter table wh24_tickets add column if not exists stream text not null default '';
alter table wh24_marks   add column if not exists stream text not null default '';

comment on column wh24_tickets.stream is
  'Vendor stream within the card - Advantis, ACE. Empty for PH1 and Bulk, which have one.';
comment on column wh24_marks.stream is
  'Which stream was collected. Empty matches a single-stream ticket.';

-- ──────────────────────────────────────────────────────────── the keys
--
-- Swapped only when the existing key is a single column, so a second run
-- finds the pair already in place and does nothing. The old key is dropped by
-- name rather than blindly: on a re-run there is nothing to drop.

do $$
declare n int;
begin
  select cardinality(c.conkey) into n
    from pg_constraint c join pg_class t on t.oid = c.conrelid
   where t.relname = 'wh24_tickets' and c.contype = 'p';
  if n = 1 then
    alter table wh24_tickets drop constraint wh24_tickets_pkey;
    alter table wh24_tickets add primary key (id, stream);
  end if;
end $$;

do $$
declare n int;
begin
  select cardinality(c.conkey) into n
    from pg_constraint c join pg_class t on t.oid = c.conrelid
   where t.relname = 'wh24_marks' and c.contype = 'p';
  if n = 1 then
    alter table wh24_marks drop constraint wh24_marks_pkey;
    alter table wh24_marks add primary key (ticket_id, stream);
  end if;
end $$;

-- the card is still a thing you look up on its own, key or no key
create index if not exists wh24_tickets_id_idx on wh24_tickets (id);

-- ───────────────────────────────────────────────────────────── the view
--
-- stream is appended at the END of the select list, which is the only shape
-- change create or replace view accepts - so this stays a replace and nothing
-- reading the view breaks while it is being replaced.
--
-- The JOIN is the real change: a mark now belongs to a ticket AND a stream.
-- Without that second condition an Advantis collection would mark the ACE row
-- collected as well, which is the precise mistake this migration exists to
-- make impossible.
--
-- THE STATE LADDER BELOW IS STILL PH1'S WORDING and is deliberately untouched
-- here. PH2 and Bulk readiness is decided in the sync, not in this ladder; the
-- ladder is rewritten in the same change that widens the sync, once the
-- readiness rules are agreed. See the foot of 037.

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
       t.phase, t.workflow,
       t.stream
  from wh24_tickets t
  left join wh24_marks m on m.ticket_id = t.id and m.stream = t.stream
  cross join lateral (select coalesce(m.collected_on,
                        (t.wh_collected_at at time zone 'Asia/Colombo')::date) as collected_on) c;

-- ═══════════════════════════════════════════════════════════════════ check
--
--   select column_name from information_schema.columns
--    where table_name in ('wh24_tickets','wh24_marks') and column_name = 'stream';
--   -- two rows
--
--   select t.relname, c.conname, cardinality(c.conkey) as cols
--     from pg_constraint c join pg_class t on t.oid = c.conrelid
--    where t.relname like 'wh24_%' and c.contype = 'p';
--   -- wh24_tickets and wh24_marks both 2
--
--   select count(*) from wh24_tickets;              -- still 384
--   select count(*) from wh24_tickets where stream <> '';   -- 0 until PH2 syncs
--
--   select relname, reloptions from pg_class where relname = 'wh24_status';
--   -- {security_invoker=true}   -- the replace must not have dropped it
--
-- Run the whole file twice. The second run must change nothing:
--   select count(*) from wh24_tickets;              -- same both times
--   -- and the two primary keys must still report 2 columns, not have been
--   -- dropped and rebuilt
--
-- And the thing this exists to prevent, once PH2 rows exist: marking one
-- stream collected must leave the other alone.
--   select id, stream, collected_on from wh24_status where id = <a PH2 card>;
--   -- one row per stream, and only the one you marked carries a date
