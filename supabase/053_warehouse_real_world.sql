-- 053_warehouse_real_world.sql  ·  what the warehouse actually receives
--
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- The tool was built for one path: a reservation, from Dialog, onto a
-- project. The warehouse has been running for years and most of what is
-- about to be typed into it does not look like that. Four things it could
-- not say:
--
--   WHERE IT CAME FROM. Stock comes from several warehouses, not one
--     supplier. "Supplier DN / PO" was a free-text box for a document
--     number; a warehouse is a THING, with a name that repeats, so it is a
--     list you add to - wh_sources - the same shape as wh_parties.
--     The document number keeps its own field; they are two facts.
--
--   A LOCAL PURCHASE. Something bought in the market has no reservation,
--     no supplier DN and no project. source already had 'direct' for
--     something issued without ever being received; 'local' is its inbound
--     twin - received, but not from anybody's warehouse.
--
--   A ROLL. Cable arrives on a drum or in a roll. They measure the same way
--     and cut the same way; only the word differs, and the word is what the
--     storeman says. One column, not a second set of drum_* fields.
--
--   A SITE, ON NEW STOCK. wh_notes already carries site_id and site_name
--     for returns. Nothing stopped a GRN carrying them too - material does
--     arrive earmarked for a site - so wh_inbound now keeps them for both
--     kinds instead of only SRN.

-- ------------------------------------------------------------- warehouses
create table if not exists wh_sources(name text primary key);
alter table wh_sources enable row level security;
drop policy if exists wh_sources_read on wh_sources;
create policy wh_sources_read on wh_sources for select using (may_read('tool:warehouse'));
drop policy if exists wh_sources_insert on wh_sources;
create policy wh_sources_insert on wh_sources for insert with check (may_read('tool:warehouse'));
drop policy if exists wh_sources_delete on wh_sources;
create policy wh_sources_delete on wh_sources for delete using (is_owner());
-- no starting list, for the same reason wh_projects has none: a name nobody
-- typed is a name nobody meant.

-- --------------------------------------------------------------- columns
alter table wh_notes add column if not exists from_wh text;      -- which warehouse it came from
alter table wh_notes add column if not exists is_local boolean not null default false;
alter table wh_items add column if not exists pack text;         -- 'drum' | 'roll', cable only
alter table wh_items add column if not exists from_wh text;

do $$ begin
  begin alter table wh_items add constraint wh_items_pack_ck
        check (pack is null or pack in ('drum','roll'));
  exception when duplicate_object then null; end;
end $$;

-- 'local': received, but not from anybody's warehouse. The twin of 'direct',
-- which is issued without ever having been received.
alter table wh_items drop constraint if exists wh_items_source_check;
alter table wh_items add constraint wh_items_source_check
  check (source in ('new','return','direct','local'));

-- ---------------------------------------------------------- wh_inbound v2
-- p gains: from_wh, is_local, site_id/site_name on GRN as well as SRN, and
-- per item: pack ('drum'|'roll'), remarks.

-- WH_INBOUND IS NOT REDEFINED HERE, AND THAT IS DELIBERATE.
-- This migration was written before 055 and originally carried its own
-- rewrite of wh_inbound to read from_wh, is_local and pack. 055 re-emits
-- wh_inbound as well, to close the SRN side door, and 055 runs after this
-- file - so whichever ran last would silently win and the other's changes
-- would be gone with nothing said. wh-payload.test.js would have caught
-- it afterwards, as the page sending from_wh with nowhere to land, which
-- is exactly the failure that guard exists for.
--
-- So there is now ONE definition of wh_inbound, in 055, and it reads
-- everything: the columns below, the pack, and the side-door check. This
-- file creates what that function needs and stops there. Run 053 before
-- 055; numeric order already gives you that.
