-- Emortia · 043 — WH24: heal the document bucket by overwriting it
--
-- ============================ WHAT THIS IS =================================
--
-- NOT a schema migration. A one-off repair, run once, by hand, in the SQL
-- editor. It changes no table definition and adds no column. 044 can be a
-- real migration without a gap.
--
-- NOTHING IS DELETED. The first draft of this file tried to DELETE FROM
-- storage.objects and could not: Supabase blocks it with a trigger,
--
--   42501: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead.
--
-- which is the right call, and in this case it stopped a deletion that was
-- never needed. The bucket overwrites itself:
--
--   * wh24PutDoc uploads with upsert: true (db.js), so a second upload to a
--     path REPLACES what is there rather than failing.
--   * wh24DocPath is a pure function of the ticket id, the stream, the site
--     and the GI or report number. No date, no counter, no random segment,
--     nothing from the sync that produced it. The same document is always the
--     same path.
--
-- So clearing the paths off the rows is the whole repair. The next sync
-- re-fetches every document, verifies it, and writes the real bytes over the
-- zero-byte object already sitting at that path. Given this bucket is the one
-- part of the system with no backup, a repair that never deletes is strictly
-- better than one that does.
--
-- WHY THE FILES ARE BAD
--
-- Every file stored before tools/wh24 build v49 is zero bytes, all of them the
-- same way. pdf.js TRANSFERS the ArrayBuffer it is handed. The instant the
-- sync called getDocument({data: buf}) to read a GIN, that buffer was detached
-- in the page's thread - the bytes had moved to the pdf.js worker - and the
-- buffer kept for upload was that same, now-empty object. Blob([a detached
-- buffer]) is an empty blob. Supabase stored it without an error, the signed
-- URL resolved, the row got a path and a Download button, and Chrome said
-- "Failed to load PDF document". Nothing anywhere reported a failure.
--
-- WHY THE PATHS HAVE TO GO
--
-- A row that carries a path is a row the tool believes is stored: it draws a
-- Download button for it, and knownFiles() tells the next sync not to bother
-- downloading that file again. Leave the paths and nothing is ever re-fetched,
-- so nothing is ever overwritten, so no amount of syncing fixes anything.

-- ---------------------------------------------------------------------------
-- STEP 1 — LOOK FIRST.
--
-- SELECT on storage.objects is allowed; only DELETE is blocked. This is the
-- answer to "are the files bad": bytes is what is actually stored.
--
-- Expect every row to be 0. If any file comes back in the tens of thousands,
-- STOP - that one was written by v49 or later and is real, and something else
-- is going on that needs explaining before you touch anything.
-- ---------------------------------------------------------------------------
select name,
       (metadata->>'size')::bigint as bytes,
       created_at
from storage.objects
where bucket_id = 'wh24-docs'
order by bytes, name;

-- ---------------------------------------------------------------------------
-- STEP 2 — the same thing as one line, if the list is long.
--
-- files   how many objects are in the bucket
-- empty   how many are zero bytes - the broken ones
-- good    how many carry a believable amount of PDF
--
-- Keep this query. It is also STEP 7, and the pair of numbers before and after
-- is the proof the repair worked.
-- ---------------------------------------------------------------------------
select count(*)                                                                 as files,
       count(*) filter (where coalesce((metadata->>'size')::bigint, 0) = 0)      as empty,
       count(*) filter (where coalesce((metadata->>'size')::bigint, 0) >= 1024)  as good
from storage.objects
where bucket_id = 'wh24-docs';

-- ---------------------------------------------------------------------------
-- STEP 0 — SHOW THE DATA. Run this before anything, and believe it over every
-- comment in this file.
--
-- One row, the whole gins value, unmodified and indented. This is where the
-- path lives and what it looks like. Everything below is written against what
-- this prints, and if it ever disagrees with this file, this file is wrong.
-- ---------------------------------------------------------------------------
select id, stream, jsonb_array_length(gins) as documents, jsonb_pretty(gins) as gins
from public.wh24_tickets
where jsonb_typeof(gins) = 'array' and jsonb_array_length(gins) > 0
order by id desc
limit 1;

-- ---------------------------------------------------------------------------
-- STEP 3 — forget the paths on the rows. This is the repair.
--
-- Sets path back to '' on every document entry inside wh24_tickets.gins. The
-- key stays, so the row shape is exactly what the page writes; it is the value
-- the page tests, and '' is falsy.
--
-- THIS VERSION REPORTS WHAT IT DID.
--
-- The first version did not, and it cost an evening. An UPDATE with no
-- RETURNING prints "Success. No rows returned" in the Supabase SQL editor
-- whether it changed every row or none of them - the message is about the
-- absence of a result set, not the absence of work. Paired with a broken
-- verification query it was indistinguishable from doing nothing.
--
--   rows_changed    ticket rows whose gins were rewritten
--   paths_cleared   document entries that actually had a path to clear
--
-- 0 AND 0 MEANS ALREADY DONE, not failed. There was nothing left carrying a
-- path. Step 4 is what confirms it either way.
--
-- Nothing here matches on text. A row is selected because one of its document
-- entries has a non-empty 'path' VALUE, found by walking the array; and each
-- entry is rewritten with jsonb_set, not by editing a string. `? 'path'` keeps
-- an entry that never had the key from gaining one.
--
-- WITH ORDINALITY and the ORDER BY are not decoration: jsonb_agg has no
-- defined order without them, and the order of this array is the order the
-- documents are listed on the ticket.
-- ---------------------------------------------------------------------------
with target as (
  select t.id,
         t.stream,
         (select coalesce(jsonb_agg(
                   case when e.g ? 'path'
                        then jsonb_set(e.g, '{path}', '""'::jsonb)
                        else e.g end
                   order by e.ord), '[]'::jsonb)
            from jsonb_array_elements(t.gins) with ordinality as e(g, ord)) as cleared,
         (select count(*)
            from jsonb_array_elements(t.gins) as e(g)
           where coalesce(e.g ->> 'path', '') <> '') as had
    from public.wh24_tickets t
   where jsonb_typeof(t.gins) = 'array'
     and jsonb_array_length(t.gins) > 0
),
changed as (
  update public.wh24_tickets t
     set gins = target.cleared
    from target
   where t.id = target.id
     and t.stream = target.stream
     and target.had > 0
  returning target.had
)
select count(*)              as rows_changed,
       coalesce(sum(had), 0) as paths_cleared
from changed;

-- ---------------------------------------------------------------------------
-- STEP 4 — check it took.
--
-- rows_claiming_a_file and documents_claiming_a_file must both be 0.
--
-- THE FIRST VERSION OF THIS QUERY WAS WRONG AND IS WHY STEP 3 LOOKED BROKEN.
-- It tested gins::text LIKE '%"path": "_%'. In LIKE, `_` matches ANY single
-- character - including the closing quote - so '{"path": ""}' matched it. The
-- query counted every row that had a path KEY, empty or not, and could never
-- return 0 while any document existed anywhere. It reported 365 "stored" rows
-- after a successful clear and that is exactly what it was built to report.
--
--   select '{"path": ""}' like '%"path": "_%';   -- true. That was the bug.
--
-- This version walks the array and compares the VALUE. No LIKE, no ::text, no
-- pattern that has to be reasoned about.
--
--   ticket_rows                 every row in the table
--   rows_claiming_a_file        rows with at least one non-empty path
--   documents_claiming_a_file   document entries with a non-empty path
--   documents_in_total          document entries altogether - this one does
--                               NOT go to 0, and is here so a 0 above can be
--                               told from an empty table
-- ---------------------------------------------------------------------------
select count(*)                        as ticket_rows,
       count(*) filter (where p.n > 0) as rows_claiming_a_file,
       coalesce(sum(p.n), 0)           as documents_claiming_a_file,
       coalesce(sum(p.docs), 0)        as documents_in_total
from public.wh24_tickets t
cross join lateral (
  select count(*) filter (where coalesce(e.g ->> 'path', '') <> '') as n,
         count(*)                                                   as docs
  from jsonb_array_elements(
         case when jsonb_typeof(t.gins) = 'array' then t.gins else '[]'::jsonb end
       ) as e(g)
) p;

-- ---------------------------------------------------------------------------
-- STEP 5 — not SQL. Set "Tickets since" back far enough.
--
-- A file is only overwritten if this sync actually fetches it, and the sync
-- only reads tickets raised on or after that date. Any ticket outside the
-- window keeps its zero-byte file in the bucket and its row stays honest but
-- empty - no button, "held in WorkHub24" - until a later sync covers it.
--
-- So before syncing, move the date back to at least the oldest ticket in
-- step 1's list. One wide sync now, then back to normal.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- STEP 6 — not SQL. Hard-refresh the tool, check it is v49, sync, publish.
--
-- This sync is slower than usual: it re-downloads every document, because none
-- of them have a path any more. That is once.
--
-- The publish dialog now says, in every case and never silently:
--   N documents stored.
--   N documents could NOT be stored … <reason>
--   N files were refused – not PDFs: <filenames>
--   No new documents to store.
--
-- Anything that is not a PDF from its first four bytes, or is under a
-- kilobyte, is refused before it is read and named in that dialog. A refused
-- document produces no entry, no button and no placeholder on the row - the
-- tool says nothing about it rather than offering something broken.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- STEP 7 — run STEP 2 again.
--
-- empty must be 0 and good must equal files. If empty is still non-zero, those
-- are files whose tickets the sync did not reach - widen "Tickets since"
-- further and publish again. They are harmless where they are: no row points
-- at them, so nothing offers them to anybody.
-- ---------------------------------------------------------------------------
