-- Emortia · migration 044 — WH24: what the ticket was before this sync
--
-- NOT URGENT, and the tool does not break without it. wh24Publish already
-- drops a column the table does not have and writes the rest, so an unrun
-- 044 costs the notification feed its verdicts and nothing else: every line
-- reads "updated" instead of "reserving → collected". No sync fails, no row
-- is lost, no other feature notices.
--
-- Run in Supabase → SQL Editor. Safe to run more than once - add-column-if-
-- not-exists, nothing dropped and nothing rewritten. The rows already there
-- stay null until their next sync fills them, and null is read as "we do not
-- know", which is the honest answer for a row written before this existed.
--
-- WHY IT IS NEEDED
--
-- The feed wants to say "25308 reserving → rejected". The only thing a row
-- carries about when it changed is synced_at, and synced_at says that the
-- ROW was written, not WHAT about it moved - a corrected title or a new
-- document path writes a fresh stamp too. Reading a state change out of it
-- would be the tool announcing something that never happened.
--
-- The sync already knows. It compares sig(old) with sig(rec) to decide
-- whether to write at all, and at that moment it is holding both versions.
-- So the old state is written onto the row as it goes - one column, no
-- second query, nothing to keep in step.
--
-- THE EMPTY STRING IS NOT NULL HERE, and the difference is load-bearing:
--
--     ''      this row is NEW - there was no previous state
--     null    unknown - written before 044, or by a page talking to a
--             database that does not have this column yet
--     a state what it was, e.g. 'reserving'
--
-- Collapsing those two would make every row written before today announce
-- itself as a brand new ticket.

alter table wh24_tickets add column if not exists prev_state text;

comment on column wh24_tickets.prev_state is
  'The state this ticket was in before the sync that last wrote this row. '
  '''''  means the row was new. null means unknown - written before migration 044. '
  'Set by wh24Publish from the comparison it already makes; never set by hand.';

-- No index. It is read only as part of a row the page has already loaded,
-- never filtered on, and an index on a column of nine repeated values would
-- cost writes and buy nothing.
