-- Emortia · migration 042 — WH24: the per-row facts the widening produces
--
-- NOT URGENT. The tool works without this: wh24Publish drops what the table
-- cannot take and writes the rest, and every column below is DERIVED - each
-- one is recomputed from timeline, gins and phase on the next load. Running
-- this saves that recomputation and lets the facts be queried; it does not
-- unlock anything.
--
-- Run in Supabase → SQL Editor. Safe to run more than once: every statement
-- is add-column-if-not-exists. Nothing is dropped, nothing is rewritten, and
-- the 384 rows already there do not move - a new column on an existing row is
-- null until the next sync fills it.
--
-- WHY IT IS NEEDED AT ALL
--
-- The widening added fourteen facts to a row and no columns to hold them.
-- PostgREST refuses the WHOLE upsert over one unknown key, so the first sync
-- after it failed with "Could not find the 'confirmations' column of
-- 'wh24_tickets' in the schema cache" - which the error translator reported
-- as "WH24 Material Checker is not switched on yet - run migration 036",
-- while the page behind the dialog was reading 384 rows out of that table.
--
-- Three of these have been reported as an unrun migration when the migration
-- was run. The cause was never the database.

alter table wh24_tickets add column if not exists order_no            text;
alter table wh24_tickets add column if not exists grn                 text;
alter table wh24_tickets add column if not exists notes               integer;
alter table wh24_tickets add column if not exists unattributed        boolean not null default false;
alter table wh24_tickets add column if not exists confirmations       integer;
alter table wh24_tickets add column if not exists confirmed_on        jsonb not null default '[]'::jsonb;
alter table wh24_tickets add column if not exists docs_failed         integer;
alter table wh24_tickets add column if not exists removed             jsonb not null default '[]'::jsonb;
alter table wh24_tickets add column if not exists site_lines          jsonb not null default '[]'::jsonb;
alter table wh24_tickets add column if not exists initiation_status   text;
alter table wh24_tickets add column if not exists initiation_status_a text;
alter table wh24_tickets add column if not exists initiation_status_b text;
alter table wh24_tickets add column if not exists status_from         text;
alter table wh24_tickets add column if not exists status_agree        boolean;

-- No policy changes. 036 made the table owner-write and tool-read and 040
-- left that alone; a column inherits the table's policies, so there is
-- nothing here to grant.

-- ─────────────────────────────────────────────────────────────────── verify
--
--   select column_name from information_schema.columns
--    where table_name = 'wh24_tickets' order by column_name;
--     -- 33 rows
--
-- After the next sync, the detail is on the rows:
--
--   select count(*) filter (where unattributed) as unattributed,
--          count(*) filter (where notes > 1)    as multi_issuance,
--          count(*) filter (where status_agree is false) as status_clash
--     from wh24_tickets;
