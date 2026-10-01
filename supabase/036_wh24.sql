-- Emortia · migration 036 — WH24 Material Checker
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- WHAT THIS IS FOR
--
-- Every material reservation Tooway raises goes through Dialog's WorkHub24:
-- Infomate reserve it, ACE issue it in SAP,
-- and the moment the System Issuance Done task opens the materials are sitting
-- at the warehouse waiting for us. WorkHub tells you a ticket is ready. It does
-- not tell you how long it has been ready, and it is not where the serials
-- are - those are on the Goods Issue Note PDF attached to the ticket.
--
-- So two tables, because two different people write them:
--
--   wh24_tickets   what WorkHub says. One row per ticket, rewritten whole
--                     on every sync. Only the owner syncs, from the WorkHub tab
--                     with the bookmark, so only the owner writes here.
--
--   wh24_marks     what we say. The day the materials were actually picked
--                     up, and a note. Whoever has the tool can set it - the
--                     person at the warehouse counter is the one who knows -
--                     and a sync never touches it, so a date typed in is not
--                     wiped the next time WorkHub is read.
--
-- The page reads both and the date in wh24_marks wins over WorkHub's own.
--
-- SCOPE, added after this migration was run: it was built reading ONE WorkHub
-- workflow, Material Reservation PH1. Reservations also go through PH2. See
-- 037, which adds the column that says which app a ticket came from, and its
-- closing note for what is still outstanding - the sync and the state logic
-- both still read PH1's wording only.

-- ─────────────────────────────────────────────────────────────── the tickets

create table if not exists wh24_tickets (
  id              integer primary key,          -- the WorkHub ticket ID, 25301
  site            text,                         -- PU5093
  site_name       text,                         -- Marawila_Hospital_Lamp
  wo              text,                         -- the Indent / WO it was raised against
  reservation     text,                         -- '1772793 / 1764338' as WorkHub writes it
  stage           text,                         -- System Issuance Done
  team            text,                         -- ACE, Infomate Team, Advantis
  status          text not null default 'inprogress',   -- inprogress | completed

  wh_created_at   timestamptz,
  wh_updated_at   timestamptz,                  -- the newest event on its timeline
  done_at         timestamptz,                  -- System Issuance Done opened: ready to collect
  wh_collected_at timestamptz,                  -- System Issuance Done closed in WorkHub

  -- [{ n:'System Issuance Pending - ACE', s:'DONE'|'NEW', c:iso, d:iso|null }]
  timeline        jsonb not null default '[]'::jsonb,

  -- what was asked for, each line with what the GIN says was issued against it
  -- [{ code, desc, qty, uom,
  --    gin:{ res, gi, date, sloc, wbs, qty, uom, sn:[...] } | null }]
  lines           jsonb not null default '[]'::jsonb,

  -- the notes themselves, in case one carries a line nothing asked for
  -- [{ file, res, gi, date, sloc, wbs, mv, items:[{ code, qty, uom, sn:[...] }] }]
  gins            jsonb not null default '[]'::jsonb,

  synced_at       timestamptz not null default now()
);

create index if not exists wh24_tickets_site_idx on wh24_tickets (upper(site));
create index if not exists wh24_tickets_done_idx on wh24_tickets (done_at desc);

alter table wh24_tickets enable row level security;

drop policy if exists "wh24_t_read"  on wh24_tickets;
drop policy if exists "wh24_t_write" on wh24_tickets;

create policy "wh24_t_read" on wh24_tickets
  for select using (may_read('tool:wh24'));

-- WorkHub is read from the owner's browser and the owner's alone. A sync from
-- somebody else's session would be somebody else's WorkHub login, and that is
-- not a thing the team should be doing on Tooway's behalf.
create policy "wh24_t_write" on wh24_tickets
  for all using (is_owner()) with check (is_owner());

-- ───────────────────────────────────────────────────────────────── the marks

create table if not exists wh24_marks (
  ticket_id     integer primary key,
  collected_on  date,                 -- null is "not yet", and the count runs
  collected_by  text,                 -- the name, as typed - who went
  note          text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid default auth.uid()
);

alter table wh24_marks enable row level security;

drop policy if exists "wh24_m_read"   on wh24_marks;
drop policy if exists "wh24_m_insert" on wh24_marks;
drop policy if exists "wh24_m_update" on wh24_marks;
drop policy if exists "wh24_m_delete" on wh24_marks;

create policy "wh24_m_read" on wh24_marks
  for select using (may_read('tool:wh24'));

-- Anyone who can open the tool can say a ticket was collected, and correct
-- it. It is one date and one name, it is stamped with who changed it last,
-- and the team is who is standing at the counter.
create policy "wh24_m_insert" on wh24_marks
  for insert with check (may_read('tool:wh24'));

create policy "wh24_m_update" on wh24_marks
  for update using (may_read('tool:wh24')) with check (may_read('tool:wh24'));

create policy "wh24_m_delete" on wh24_marks
  for delete using (is_owner());

create or replace function wh24_marks_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end $$;

drop trigger if exists wh24_marks_touch_trg on wh24_marks;
create trigger wh24_marks_touch_trg before insert or update on wh24_marks
  for each row execute function wh24_marks_touch();

-- a date set on the phone at the warehouse shows on the laptop without a reload
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'wh24_tickets')
  then alter publication supabase_realtime add table wh24_tickets; end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'wh24_marks')
  then alter publication supabase_realtime add table wh24_marks; end if;
end $$;


-- ───────────────────────────────────────────── can I collect it? in one place
--
-- The question the whole tool exists to answer, asked of the database rather
-- than worked out in each browser: so the Owner page, a phone, or a query in
-- SQL Editor all get the same answer. security_invoker, so the view reads
-- with the caller's rights and the policies above still decide who sees what
-- - a view without it reads as its creator and walks straight past RLS.
--
-- Days are counted in Colombo time: a ticket issued at 11pm on the 30th was
-- issued on the 30th here, whatever UTC says.

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
       t.wh_updated_at, t.synced_at
  from wh24_tickets t
  left join wh24_marks m on m.ticket_id = t.id
  cross join lateral (select coalesce(m.collected_on,
                        (t.wh_collected_at at time zone 'Asia/Colombo')::date) as collected_on) c;

-- ───────────────────────────────────────────────────────────────── the switch

insert into feature_locks (feature, tier) values ('tool:wh24', 'tooway')
on conflict (feature) do nothing;

-- ═══════════════════════════════════════════════════════════════════ check
--
--   select feature, tier from feature_locks where feature = 'tool:wh24';
--   -- tool:wh24 | tooway
--
--   select count(*) from wh24_tickets;                   -- 107 after the first sync
--   select id, site, site_name, ready_on, days_waiting
--     from wh24_status where can_collect order by days_waiting desc;
--   -- what is sitting at the warehouse right now
--
--   select state, count(*) from wh24_status group by state;
--
-- ─────────────────────────────────────────────── and nothing without a session
--
-- CAREFUL WITH THE OBVIOUS TEST. This one:
--
--   await (await fetch(URL + '/rest/v1/wh24_tickets?select=id&limit=1',
--          { headers: { apikey: ANON } })).json()        -- []
--
-- passes on an empty table whether the policies work or not. A table with no
-- rows returns [] to everybody, so run on a fresh migration it proves only
-- that PostgREST can see the table. It is worth running - it is just not
-- worth believing until there are rows. Come back to it after the first sync,
-- when it has to return [] signed out and the tickets signed in.
--
-- Until then, test the WRITE instead, which does not need a single row to
-- mean something. Signed out, with the anon key alone, this must be REFUSED -
-- a 401 or 403 with 42501, "new row violates row-level security policy":
--
--   await fetch(URL + '/rest/v1/wh24_marks', { method:'POST',
--     headers:{ apikey: ANON, 'Content-Type':'application/json' },
--     body: JSON.stringify({ ticket_id: -1, collected_on: '2026-01-01' }) })
--
-- A 201 there means the marks table is open to the whole internet, and that
-- is true at zero rows as much as at ten thousand.
--
-- And from SQL, where the answer does not depend on the data at all:
--
--   select relname, relrowsecurity, relforcerowsecurity from pg_class
--    where relname in ('wh24_tickets','wh24_marks');     -- both t
--   select tablename, policyname, cmd from pg_policies
--    where tablename like 'wh24%' order by tablename, policyname;   -- 6 rows
--   select relname, reloptions from pg_class where relname = 'wh24_status';
--   -- {security_invoker=true}
