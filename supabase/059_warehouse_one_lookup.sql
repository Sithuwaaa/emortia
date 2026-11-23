-- 059_warehouse_one_lookup.sql  ·  five lists, one mechanism
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Needs 058, and needs
-- 053 and 056 to have run before it, because it reads the tables they
-- create. Numeric order already gives you that.
--
-- There were four of these tables and a fifth list with nowhere to live:
--
--   wh_projects   project names
--   wh_parties    3rd parties
--   wh_sources    the warehouses stock comes from       (053)
--   wh_vendors    who owns it                           (056)
--   WH locations  - no table at all, just whatever was typed into bin
--
-- Four tables with the same one column, four sets of policies, four add
-- functions and four "+ new" behaviours on the page. They were already
-- drifting: wh_sources and wh_vendors got a delete policy, the two older
-- ones never did. A fifth would have drifted further.
--
-- So: one table keyed by kind. One set of policies. One add function. The
-- page gets one component, which is the part that actually matters - five
-- bespoke "+ new" buttons is five chances to behave differently on a
-- Tuesday.
--
-- LOCATIONS ARE SEEDED FROM WHAT IS ALREADY IN USE. Every distinct bin on
-- an item becomes a location, because those names are real and retyping
-- them is how A-01-01 and A-1-1 end up as two places.
--
-- THE OLD TABLES ARE DROPPED, NOT LEFT BESIDE IT. Leaving them is how you
-- get two sources of truth and a page that reads the stale one.

create table if not exists wh_lookups(
  kind text not null check (kind in ('project','party','source','vendor','location')),
  name text not null,
  primary key (kind, name));
alter table wh_lookups enable row level security;
drop policy if exists wh_lookups_read   on wh_lookups;
create policy wh_lookups_read   on wh_lookups for select using (may_read('tool:warehouse'));
drop policy if exists wh_lookups_insert on wh_lookups;
create policy wh_lookups_insert on wh_lookups for insert with check (may_read('tool:warehouse'));
drop policy if exists wh_lookups_delete on wh_lookups;
create policy wh_lookups_delete on wh_lookups for delete using (is_owner());

-- carry everything across before anything is dropped
insert into wh_lookups(kind,name) select 'project', name from wh_projects on conflict do nothing;
insert into wh_lookups(kind,name) select 'party',   name from wh_parties  on conflict do nothing;
insert into wh_lookups(kind,name) select 'source',  name from wh_sources  on conflict do nothing;
insert into wh_lookups(kind,name) select 'vendor',  name from wh_vendors  on conflict do nothing;
insert into wh_lookups(kind,name)
  select distinct 'location', btrim(bin) from wh_items
   where nullif(btrim(bin),'') is not null on conflict do nothing;

drop table if exists wh_projects;
drop table if exists wh_parties;
drop table if exists wh_sources;
drop table if exists wh_vendors;

-- ------------------------------------- wh_outbound writes to the one list
create or replace function wh_outbound(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  nid text; it jsonb; ln int := 0; L wh_items; len numeric; iid bigint; q numeric;
  dst text := coalesce(nullif(p->>'dest',''),'site');
  d date := coalesce(nullif(p->>'date','')::date, current_date);
  cend text;   -- 057: which end a cut came off
  sid text := nullif(upper(p->>'site_id'),''); prt text := nullif(trim(p->>'party'),'');
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  if dst = 'site'  and sid is null then raise exception 'Type the site ID first.'; end if;
  if dst = 'party' and prt is null then raise exception 'Type the 3rd party company.'; end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one item.'; end if;
  nid := wh_next('OBN');
  insert into wh_notes(id,kind,note_date,project,site_id,site_name,dest,party,purpose,party_ref,
                       requested_by,receiver,vehicle,driver,driver_nic,contact,issued_by,issued_contact)
  values (nid,'OBN',d,nullif(p->>'project',''),
          case when dst='site' then sid end, case when dst='site' then nullif(p->>'site_name','') end,
          dst, case when dst='party' then prt end, case when dst='party' then nullif(p->>'purpose','') end,
          case when dst='party' then nullif(p->>'party_ref','') end,
          nullif(p->>'requested_by',''), nullif(p->>'receiver',''), nullif(p->>'vehicle',''),
          nullif(p->>'driver',''), nullif(p->>'driver_nic',''), nullif(p->>'contact',''),
          nullif(p->>'issued_by',''), nullif(p->>'issued_contact',''));
  /* 059: one list, five kinds. wh_parties is gone. */
  if dst = 'party' then insert into wh_lookups(kind,name) values ('party',prt) on conflict do nothing; end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    ln := ln + 1;
    if it->>'item_id' is not null then
      select * into L from wh_items where id = (it->>'item_id')::bigint for update;
      if not found then raise exception 'Item % is not in the warehouse list.', it->>'item_id'; end if;
      if L.drum_name is not null and not coalesce((it->>'whole')::boolean,false) then
        /* 057: the cut says WHICH END it came off. Cutting from the low
           end could not be expressed before - drum_cur only ever fell -
           so the numbers went quietly wrong. Remaining is always
           drum_upper - drum_lower, whichever end moved. */
        len := nullif(it->>'cut','')::numeric;
        cend := case when lower(coalesce(it->>'cut_end','upper')) = 'lower' then 'lower' else 'upper' end;
        if len is null or len <= 0 or len > L.drum_upper - L.drum_lower then
          raise exception 'Drum % has % m left.', L.drum_name, L.drum_upper - L.drum_lower; end if;
        if cend = 'upper' then
          update wh_items set drum_upper = drum_upper - len,
                 qty = (drum_upper - len) - drum_lower where id = L.id;
          insert into wh_lines(note_id,item_id,line_no,qty,cut_from,cut_to,remarks,cut_end)
          values (nid, L.id, ln, len, L.drum_upper - len, L.drum_upper, nullif(it->>'remarks',''), 'upper');
        else
          update wh_items set drum_lower = drum_lower + len,
                 qty = drum_upper - (drum_lower + len) where id = L.id;
          insert into wh_lines(note_id,item_id,line_no,qty,cut_from,cut_to,remarks,cut_end)
          values (nid, L.id, ln, len, L.drum_lower, L.drum_lower + len, nullif(it->>'remarks',''), 'lower');
        end if;
      else
        if L.status <> 'in' then raise exception '% is not in stock (it went out on %).', coalesce(L.sn, L.name), L.out_note; end if;
        update wh_items set status='out', out_note=nid, out_date=d,
               site_id   = case when dst='site' then sid end,
               site_name = case when dst='site' then nullif(p->>'site_name','') end,
               party     = case when dst='party' then prt end,
               project   = coalesce(nullif(p->>'project',''), project)
         where id = L.id;
        insert into wh_lines(note_id,item_id,line_no,qty,cut_from,cut_to,remarks)
        values (nid, L.id, ln, L.qty, L.read_end, L.read_start, nullif(it->>'remarks',''));
      end if;
    else
      -- direct issue: never received (local purchase, or not booked in yet)
      q := case when it->>'read_start' is not null then abs((it->>'read_end')::numeric - (it->>'read_start')::numeric)
                else coalesce(nullif(it->>'qty','')::numeric, 1) end;
      if nullif(it->>'name','') is null then raise exception 'Every manual row needs a material name.'; end if;
      insert into wh_items(code,name,cat,uom,qty,sn,project,status,source,out_note,out_date,site_id,site_name,party,
                           read_start,read_end,is_new)
      values (nullif(it->>'code',''), it->>'name', nullif(it->>'cat',''), coalesce(nullif(it->>'uom',''),'EA'), q,
              nullif(it->>'sn',''), nullif(p->>'project',''), 'out', 'direct', nid, d,
              case when dst='site' then sid end, case when dst='site' then nullif(p->>'site_name','') end,
              case when dst='party' then prt end,
              (it->>'read_start')::numeric, (it->>'read_end')::numeric, coalesce((it->>'is_new')::boolean,false))
      returning id into iid;
      insert into wh_lines(note_id,item_id,line_no,qty,cut_from,cut_to,remarks)
      values (nid, iid, ln, q, (it->>'read_end')::numeric, (it->>'read_start')::numeric, nullif(it->>'remarks',''));
    end if;
  end loop;
  return nid;
end $$;

revoke all on function wh_outbound(jsonb) from public, anon;
grant execute on function wh_outbound(jsonb) to authenticated;
