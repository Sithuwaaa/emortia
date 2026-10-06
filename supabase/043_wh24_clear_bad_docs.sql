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
-- STEP 3 — forget the paths on the rows. This is the repair.
--
-- Sets path back to '' on every document entry inside wh24_tickets.gins. The
-- key stays, so the row shape is exactly what the page writes; it is the value
-- the page tests, and '' is falsy.
--
-- WITH ORDINALITY and the ORDER BY are not decoration: jsonb_agg has no
-- defined order without them, and the order of this array is the order the
-- documents are listed on the ticket.
--
-- After this the tool shows no Download button on any row, which is the truth,
-- and the next sync will fetch all of those documents again.
-- ---------------------------------------------------------------------------
update public.wh24_tickets
set gins = (
      select jsonb_agg(jsonb_set(g, '{path}', '""'::jsonb) order by ord)
      from jsonb_array_elements(gins) with ordinality as e(g, ord)
    )
where jsonb_typeof(gins) = 'array'
  and jsonb_array_length(gins) > 0
  and gins::text like '%"path"%';

-- ---------------------------------------------------------------------------
-- STEP 4 — check it took.
--
-- stored must be 0. If it is not, step 3 matched nothing: say so rather than
-- running it again.
-- ---------------------------------------------------------------------------
select count(*)                                              as ticket_rows,
       count(*) filter (where gins::text like '%"path": "_%'
                           or gins::text like '%"path":"_%')  as stored
from public.wh24_tickets;

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
