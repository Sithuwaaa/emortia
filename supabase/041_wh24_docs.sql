-- Emortia · migration 041 — WH24: the ticket PDFs, keyed by (ticket, stream)
--
-- ============================ READ THIS FIRST ==============================
--
-- SUPABASE STORAGE IS NOT COVERED BY DATABASE BACKUPS. On any plan. The
-- nightly backup, the PITR window and your own weekly dump to R2 are all
-- Postgres only: they copy tables, not buckets.
--
-- So the moment a PDF lives in this bucket it is THE ONLY PART OF THIS SYSTEM
-- WITH NO BACKUP AT ALL. Deleting it deletes it. There is no restore.
--
-- That is survivable here, and only because of where these files come from:
-- every one of them is a copy of a document WorkHub24 already holds, fetched
-- by the sync from the card it is attached to. Losing the bucket costs a
-- re-sync, not a document. Nothing is generated here and nothing originates
-- here - if that ever changes, this comment stops being true and the bucket
-- needs a backup before it does.
--
-- WHAT IT WOULD TAKE TO ADD THE BUCKET TO THE WEEKLY JOB
--
--   The weekly job runs pg_dump against the database. Storage is an S3-style
--   object store behind the same project, so it needs a second step rather
--   than a flag on the first:
--
--     1. a service-role key (NOT the anon key - the bucket is private)
--     2. `supabase storage cp -r ss://wh24-docs ./wh24-docs` with the CLI,
--        or an S3 client pointed at the project's storage endpoint with that
--        key, which is the same thing without the CLI
--     3. the result folded into the same R2 upload the dump already does
--
--   Two practical notes. The copy is incremental only if you make it so - the
--   CLI will re-download everything otherwise - so list the bucket and skip
--   what R2 already has by name, since these names never change once written.
--   And the service-role key must not live in the repo: it bypasses every
--   policy below.
--
-- ===========================================================================
--
-- Run in Supabase → SQL Editor. Safe to run more than once: the bucket is
-- created only if missing, and the policies are dropped before they are made.
--
-- WHY KEYED ON THE PAIR
--
-- A PH2 card carries TWO documents - the Advantis stream issues on a Goods
-- Issue Note and the ACE stream on an Activity Report. Keyed on the ticket
-- alone the second would overwrite the first, and the tool would offer the
-- Advantis note while you were reading the ACE row. The path carries the
-- stream for the same reason 039 put it in the primary key.
--
--   wh24-docs/<ticket_id>/<stream or _>/<site>__<stream>__<number>.pdf
--
-- The name is built so a human can tell what a file is without opening it:
-- the site it belongs to, which vendor stream, and the GI or report number.
-- '_' stands in for the empty stream that PH1 and Bulk use, because a path
-- segment cannot be empty.

-- ─────────────────────────────────────────────────────────────── the bucket
--
-- Private. These are internal warehouse documents with site codes, material
-- codes and equipment serials on them, and a public bucket is a public URL
-- for anyone who guesses a ticket number.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wh24-docs', 'wh24-docs', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 20971520,
      allowed_mime_types = array['application/pdf'];

-- ─────────────────────────────────────────────────────────────── the policies
--
-- The same shape as 040: the team reads, the owner writes. Reading is what
-- the tool is for; writing happens only during a sync, which is the owner's.

drop policy if exists "wh24_docs_read"   on storage.objects;
drop policy if exists "wh24_docs_insert" on storage.objects;
drop policy if exists "wh24_docs_update" on storage.objects;
drop policy if exists "wh24_docs_delete" on storage.objects;

create policy "wh24_docs_read" on storage.objects
  for select using (bucket_id = 'wh24-docs' and may_read('tool:wh24'));

create policy "wh24_docs_insert" on storage.objects
  for insert with check (bucket_id = 'wh24-docs' and is_owner());

create policy "wh24_docs_update" on storage.objects
  for update using (bucket_id = 'wh24-docs' and is_owner())
          with check (bucket_id = 'wh24-docs' and is_owner());

create policy "wh24_docs_delete" on storage.objects
  for delete using (bucket_id = 'wh24-docs' and is_owner());

-- ───────────────────────────────────────────────────────── where it is stored
--
-- The path goes on the gin entry inside wh24_tickets.gins, which is jsonb and
-- needs no migration to carry one more key. Nothing here alters that table:
-- a row written before this migration simply has no path on its documents,
-- and the page shows the document's name without a download link, which is
-- the honest state rather than a broken button.

-- ─────────────────────────────────────────────────────────────────── verify
--
--   select id, public, file_size_limit from storage.buckets where id = 'wh24-docs';
--     -- one row, public false, 20971520
--
--   select policyname, cmd from pg_policies
--    where tablename = 'objects' and policyname like 'wh24_docs%'
--    order by policyname;
--     -- four rows: delete, insert, read (SELECT), update
--
-- The real check is from a signed-in Tooway session: a read of a path in this
-- bucket succeeds and an upload to it comes back 403. A successful upload
-- means the insert policy did not take.
