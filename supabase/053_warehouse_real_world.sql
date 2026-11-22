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
create or replace function wh_inbound(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  k text := p->>'kind'; nid text; it jsonb; ln int := 0; iid bigint; q numeric;
  d date := coalesce(nullif(p->>'date','')::date, current_date);
  loc boolean := coalesce((p->>'is_local')::boolean, false);
  src text := nullif(trim(p->>'from_wh'),'');
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  if k not in ('GRN','SRN') then raise exception 'kind must be GRN or SRN'; end if;
  if k = 'SRN' and coalesce(p->>'site_id','') = '' then raise exception 'A site return needs the site ID it came from.'; end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one material.'; end if;

  if src is not null then insert into wh_sources(name) values (src) on conflict do nothing; end if;

  nid := wh_next(k);
  insert into wh_notes(id,kind,note_date,project,reservation_no,ref,site_id,site_name,removed_on,by_name,from_wh,is_local)
  values (nid, k, d, nullif(p->>'project',''),
          case when k = 'GRN' then nullif(p->>'reservation_no','') end,
          nullif(p->>'ref',''), nullif(upper(p->>'site_id'),''), nullif(p->>'site_name',''),
          nullif(p->>'removed_on','')::date, nullif(p->>'by',''), src, loc);

  for it in select * from jsonb_array_elements(p->'items') loop
    ln := ln + 1;
    if nullif(it->>'drum_name','') is not null then
      if (it->>'drum_upper')::numeric <= (it->>'drum_lower')::numeric then
        raise exception '% %: the upper reading must be above the lower.',
          initcap(coalesce(nullif(it->>'pack',''),'drum')), it->>'drum_name'; end if;
      q := (it->>'drum_upper')::numeric - (it->>'drum_lower')::numeric;
    elsif it->>'read_start' is not null then
      q := abs((it->>'read_end')::numeric - (it->>'read_start')::numeric);
    else
      q := coalesce(nullif(it->>'qty','')::numeric, 1);
    end if;
    insert into wh_items(code,name,cat,uom,qty,sn,bin,project,status,source,cond,in_note,in_date,
                         from_site,from_site_name,reservation_no,drum_name,drum_lower,drum_upper,drum_cur,
                         read_start,read_end,is_new,pack,from_wh)
    values (nullif(it->>'code',''), it->>'name', nullif(it->>'cat',''), coalesce(nullif(it->>'uom',''),'EA'), q,
            nullif(it->>'sn',''), coalesce(nullif(it->>'bin',''), nullif(p->>'bin','')), nullif(p->>'project',''),
            'in',
            case when k = 'SRN' then 'return' when loc then 'local' else 'new' end,
            case when k = 'SRN' then coalesce(nullif(it->>'cond',''),'Good') end,
            nid, d, nullif(upper(p->>'site_id'),''), nullif(p->>'site_name',''),
            case when k = 'GRN' then nullif(p->>'reservation_no','') end,
            nullif(it->>'drum_name',''), (it->>'drum_lower')::numeric, (it->>'drum_upper')::numeric, (it->>'drum_upper')::numeric,
            (it->>'read_start')::numeric, (it->>'read_end')::numeric,
            coalesce((it->>'is_new')::boolean, false),
            case when nullif(it->>'drum_name','') is not null
                 then coalesce(nullif(it->>'pack',''),'drum') end,
            src)
    returning id into iid;
    insert into wh_lines(note_id,item_id,line_no,qty,remarks)
    values (nid, iid, ln, q, nullif(it->>'remarks',''));
  end loop;
  return nid;
end $$;

revoke all on function wh_inbound(jsonb) from public, anon;
grant execute on function wh_inbound(jsonb) to authenticated;
