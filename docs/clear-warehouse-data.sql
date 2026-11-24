-- docs/clear-warehouse-data.sql  ·  empty the warehouse, keep the tool
--
-- NOT A MIGRATION, AND NOT IN supabase/. Everything in that folder is
-- counted as a migration - the accounting test says so and is right to -
-- so a script you run deliberately, once, when you want the warehouse
-- empty does not live there. Re-running it is harmless and pointless.
--
-- I could not run this for you. My Supabase calls come back "You do not
-- have permission", so nothing in this session has touched the database
-- and this file is the whole of what I can do about it.
--
-- WHAT IT CLEARS: the stock and the paperwork.
--
--     wh_lines     every line on every note
--     wh_items     every item, drum and returned piece
--     wh_notes     every GRN, SRN, OBN and RTN
--
-- and it puts the note numbers back where 048 started them, so the next
-- GRN is 0001 and the next OBN continues the paper book at 1117.
--
-- WHAT IT KEEPS, deliberately:
--
--     wh_materials   the material codes
--     wh_lookups     projects, parties, purposes, vendors, warehouses, bins
--
-- Those are reference data. Clearing them would mean retyping every
-- project and every bin before the first note could be filed, and
-- nothing about an empty warehouse requires it. If you do want them
-- gone, the two lines at the bottom are there, commented out.
--
-- IT DOES NOT TOUCH ANY OTHER TOOL. Site Access, attendance, ESN,
-- designs, WH24 and the rest are untouched - "all data" here means the
-- warehouse's own tables and nothing else. If you meant something wider
-- than that, say so and I will write that script instead; I have
-- deliberately not guessed.
--
-- Order matters: lines reference items and notes, so they go first.

begin;

delete from wh_lines;
delete from wh_items;
delete from wh_notes;

-- back to where 048 set them
update wh_counters set n = 0    where kind in ('GRN','SRN','DMY');
update wh_counters set n = 1116 where kind = 'OBN';

-- and if you want the lists gone too, uncomment these:
-- delete from wh_lookups;
-- delete from wh_materials;

commit;

-- what you should see: four zeros, and the counters back at the start
select (select count(*) from wh_lines)  as lines,
       (select count(*) from wh_items)  as items,
       (select count(*) from wh_notes)  as notes,
       (select count(*) from wh_lookups) as lookups_kept,
       (select count(*) from wh_materials) as materials_kept;
select kind, n from wh_counters order by kind;
