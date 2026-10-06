-- Emortia · 043 — WH24: empty the document bucket and forget the paths
--
-- ============================ WHAT THIS IS =================================
--
-- NOT a schema migration. A one-off repair, run once, by hand, in the SQL
-- editor. It changes no table definition and adds no column. 044 can be a
-- real migration without a gap.
--
-- WHY
--
-- Every file stored in wh24-docs before tools/wh24 build v49 is corrupt, and
-- all of them the same way: zero bytes.
--
-- pdf.js TRANSFERS the ArrayBuffer it is handed. The instant the sync called
-- getDocument({data: buf}) to read a GIN, that buffer was detached in the
-- page's thread - the bytes had moved to the pdf.js worker. The buffer kept
-- for upload was that same, now-empty object. Blob([a detached buffer]) is an
-- empty blob. Supabase stored the empty object without an error, the signed
-- URL resolved, the row got a path, the row got a Download button, and Chrome
-- said "Failed to load PDF document". Nothing anywhere reported a failure.
--
-- So the bucket holds correctly named, correctly keyed, zero-byte files. They
-- are not recoverable and not worth keeping: every one is a copy of a document
-- WorkHub24 still holds and the next sync will fetch again.
--
-- The paths have to go too. A row that carries a path is a row the tool
-- believes is stored: it shows a Download button for it, and knownFiles()
-- tells the next sync not to bother downloading it. Clearing the bucket and
-- leaving the paths would give you several hundred rows pointing at files that
-- are not there, which the sync would never replace. Both halves or neither.

-- ---------------------------------------------------------------------------
-- STEP 1 — LOOK FIRST. Do not delete anything yet.
--
-- This is the answer to "are the files bad". bytes is what is actually stored.
-- If every row comes back 0, that is the detached-buffer bug and all of it
-- goes. If some are tens of thousands of bytes, those were written by v49 or
-- later and are real - stop here and say so rather than running step 3.
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
-- files      how many objects are in the bucket
-- empty      how many are zero bytes - the broken ones
-- real       how many carry a believable amount of PDF in them
-- ---------------------------------------------------------------------------
select count(*)                                                       as files,
       count(*) filter (where coalesce((metadata->>'size')::bigint, 0) = 0)    as empty,
       count(*) filter (where coalesce((metadata->>'size')::bigint, 0) >= 1024) as real
from storage.objects
where bucket_id = 'wh24-docs';

-- ---------------------------------------------------------------------------
-- STEP 3 — empty the bucket.
--
-- THIS CANNOT BE UNDONE AND STORAGE HAS NO BACKUP. It is safe here only
-- because every file in it is a zero-byte copy of a document WorkHub24 still
-- holds. Run step 1 first and be satisfied that is true.
--
-- The bucket itself and its four policies from 041 are untouched - this empties
-- it, it does not drop it, so nothing needs re-creating afterwards.
--
-- A note on what this does and does not reach: this deletes the rows Storage
-- lists objects from, so the files stop existing as far as every API, signed
-- URL and dashboard listing is concerned. The underlying blobs may linger in
-- the object store as orphans counting towards storage usage. At a few hundred
-- empty files that is nothing. Deleting them from the dashboard instead would
-- be exact, but these live in one folder per ticket and there are hundreds of
-- folders, so that is an afternoon of clicking for no gain.
-- ---------------------------------------------------------------------------
delete from storage.objects
where bucket_id = 'wh24-docs';

-- ---------------------------------------------------------------------------
-- STEP 4 — forget the paths on the rows.
--
-- Sets path back to '' on every document entry inside wh24_tickets.gins. The
-- key stays, so the row shape is exactly what the page writes; it is the value
-- the page tests, and '' is falsy.
--
-- After this the tool shows no Download button on any row, which is the truth,
-- and the next sync will fetch all of those documents again because
-- knownFiles() counts a file as known only once it has a path.
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
-- STEP 5 — check it took.
--
-- stored must be 0. If it is not, step 4 matched nothing: say so rather than
-- running it again.
-- ---------------------------------------------------------------------------
select count(*)                                              as ticket_rows,
       count(*) filter (where gins::text like '%"path": "_%'
                           or gins::text like '%"path":"_%')  as stored
from public.wh24_tickets;

-- ---------------------------------------------------------------------------
-- STEP 6 — not SQL. Hard-refresh the tool, check the footer says v49, then
-- sync and publish.
--
-- This sync is slower than usual: it re-downloads every document, because
-- none of them have a path any more. That is once.
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
