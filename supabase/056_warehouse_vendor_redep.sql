-- 056_warehouse_vendor_redep.sql  ·  who owns it, and REDEP
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Needs 055.
--
-- TWO AXES, NOT ONE. "How did this arrive" and "whose material is it" are
-- different questions and the tool only had a box for the first.
--
--   source  how it got here: new on a delivery, back from a site, issued
--           direct without ever being received, bought locally, or REDEP -
--           redeployed material, pulled from one place and held for
--           another without any site return behind it.
--
--   vendor  who OWNS it. Dialog, Mobitel, Hutch.
--
-- Folding them into one column is tempting and wrong. Dialog material can
-- arrive on a delivery, come back from a site, or turn up as REDEP, and
-- the same three things happen to Mobitel material. Collapse them and
-- "what Dialog stock are we holding" stops being answerable at all,
-- because the answer is spread across three values of a column that is
-- also being used for something else.
--
-- VENDOR LIVES ON THE ITEM, NOT THE NOTE. It is a fact about the material,
-- and one delivery can carry more than one owner's stock. The form offers
-- it once per note because in practice a delivery is usually all one
-- owner's, and writes it onto each row as it saves - so what is STORED is
-- per item and can be corrected per item with the pencil. That is the
-- opposite of a note-wide column the rows read through at display time,
-- which is the shape being removed from "Default bin".
--
-- WH_INBOUND IS RE-EMITTED HERE because it has to read the new field, and
-- there is only ever one definition of it. It carries the side-door check
-- forward; wh-return.test.js asserts that on the LAST definition in
-- migration order, so a re-emission that dropped it would fail the build
-- rather than quietly reopening it.

-- ----------------------------------------------------------- the columns
alter table wh_items drop constraint if exists wh_items_source_check;
alter table wh_items add  constraint wh_items_source_check
  check (source in ('new','return','direct','local','redep'));

alter table wh_items add column if not exists vendor text;
create index if not exists wh_items_vendor on wh_items (vendor);

-- the owners, as a list rather than free text retyped each time
create table if not exists wh_vendors(name text primary key);
alter table wh_vendors enable row level security;
drop policy if exists wh_vendors_read   on wh_vendors;
create policy wh_vendors_read   on wh_vendors for select using (may_read('tool:warehouse'));
drop policy if exists wh_vendors_insert on wh_vendors;
create policy wh_vendors_insert on wh_vendors for insert with check (may_read('tool:warehouse'));
drop policy if exists wh_vendors_delete on wh_vendors;
create policy wh_vendors_delete on wh_vendors for delete using (is_owner());
insert into wh_vendors(name) values ('Dialog'),('Mobitel'),('Hutch') on conflict do nothing;

-- ------------------------------------------- the pencil can correct it
-- vendor joins the always-allowed set beside code, project and drum_name:
-- it is a word about the thing, not stock, so the guards in 054 are not
-- touched. Everything below the marked line is 054 unchanged.
create or replace function wh_update_item(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare i wh_items; iid bigint := (p->>'id')::bigint; touches_stock boolean; holder text;
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  select * into i from wh_items where id = iid for update;
  if not found then raise exception 'There is no item %.', coalesce(iid::text,'(none)'); end if;

  update wh_items set
    name = coalesce(nullif(p->>'name',''), name),
    cat  = coalesce(p->>'cat',  cat),
    uom  = coalesce(nullif(p->>'uom',''), uom),
    bin  = coalesce(p->>'bin',  bin),
    sn   = coalesce(p->>'sn',   sn),
    cond = coalesce(nullif(p->>'cond',''), cond),
    code    = case when p ? 'code'    then nullif(p->>'code','')    else code end,
    project = case when p ? 'project' then nullif(p->>'project','') else project end,
    vendor  = case when p ? 'vendor'  then nullif(p->>'vendor','')  else vendor end,
    source  = case when p ? 'source' and nullif(p->>'source','') is not null
                   then p->>'source' else source end
  where id = iid;

  if p ? 'code' then
    update wh_items set is_new = (code is not null
      and not exists (select 1 from materials m where m.code = wh_items.code))
     where id = iid;
  end if;

  if nullif(p->>'drum_name','') is not null
     and lower(nullif(p->>'drum_name','')) is distinct from lower(coalesce(i.drum_name,'')) then
    if i.drum_name is null then
      raise exception '% is not a drum. A drum is named when it is booked in.', coalesce(i.sn, i.name);
    end if;
    select coalesce(sn, name) into holder from wh_items
     where lower(drum_name) = lower(p->>'drum_name') and id <> iid;
    if holder is not null then
      raise exception 'There is already a drum called % (%). Drum names have to be unique - that is how a cut is traced back.',
        p->>'drum_name', holder;
    end if;
    update wh_items set drum_name = p->>'drum_name' where id = iid;
  elsif p ? 'drum_name' and nullif(p->>'drum_name','') is null and i.drum_name is not null then
    raise exception 'Drum % has to keep a name - its readings and its cuts are identified by it. Delete the line and book it in again if it is not a drum.',
      i.drum_name;
  end if;

  /* ---- from here down this is 054, unchanged ---- */
  touches_stock := (p ? 'qty') or (p ? 'drum_lower') or (p ? 'drum_upper')
                or (p ? 'read_start') or (p ? 'read_end');
  if not touches_stock then return iid; end if;

  if i.status = 'out' then
    raise exception 'The quantity of % cannot change: it went out on %. The note is the record of what was sent.',
      coalesce(i.sn, i.name), coalesce(i.out_note, 'an outbound note');
  end if;
  if exists (select 1 from wh_lines l join wh_notes n on n.id = l.note_id
              where l.item_id = iid and n.kind = 'OBN') then
    raise exception 'The quantity of % cannot change: it is on an outbound note already.', coalesce(i.sn, i.name);
  end if;
  if i.drum_name is not null and i.drum_cur is distinct from i.drum_upper then
    raise exception 'Drum % has been cut - it reads % and came in at %. Undo the cut before changing its readings.',
      i.drum_name, i.drum_cur, i.drum_upper;
  end if;

  update wh_items set
    qty        = coalesce(nullif(p->>'qty','')::numeric, qty),
    drum_lower = coalesce(nullif(p->>'drum_lower','')::numeric, drum_lower),
    drum_upper = coalesce(nullif(p->>'drum_upper','')::numeric, drum_upper),
    read_start = coalesce(nullif(p->>'read_start','')::numeric, read_start),
    read_end   = coalesce(nullif(p->>'read_end','')::numeric, read_end)
  where id = iid;

  update wh_items
     set drum_cur = drum_upper,
         qty = drum_upper - drum_lower
   where id = iid and drum_name is not null;
  update wh_items
     set qty = abs(read_end - read_start)
   where id = iid and drum_name is null and read_start is not null and read_end is not null;

  if (select drum_upper <= drum_lower from wh_items where id = iid and drum_name is not null) then
    raise exception 'The upper reading must be above the lower one.';
  end if;
  return iid;
end $$;


-- ------------------------------ wh_inbound, now also reading the owner
-- Re-emitted whole, from 055, because a function has one definition and
-- this one has to read vendor and REDEP. It carries the SRN side-door
-- check forward - wh-return.test.js asserts that on the LAST definition
-- in migration order, so dropping it here would fail the build.
create or replace function wh_inbound(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  k text := p->>'kind'; nid text; it jsonb; ln int := 0; iid bigint; q numeric;
  loc boolean := coalesce((p->>'is_local')::boolean, false);   -- 053
  src text := nullif(trim(p->>'from_wh'),'');                  -- 053
  vnd text := nullif(trim(p->>'vendor'),'');                   -- 056
  rdp boolean := nullif(p->>'source','') = 'redep';            -- 056
  d date := coalesce(nullif(p->>'date','')::date, current_date);
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  if k not in ('GRN','SRN') then raise exception 'kind must be GRN or SRN'; end if;
  if k = 'SRN' and coalesce(p->>'site_id','') = '' then raise exception 'A site return needs the site ID it came from.'; end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one material.'; end if;
  nid := wh_next(k);
  insert into wh_notes(id,kind,note_date,project,reservation_no,ref,site_id,site_name,removed_on,by_name,from_wh,is_local)
  values (nid, k, d, nullif(p->>'project',''),
          case when k = 'GRN' then nullif(p->>'reservation_no','') end,
          nullif(p->>'ref',''), nullif(upper(p->>'site_id'),''), nullif(p->>'site_name',''),
          nullif(p->>'removed_on','')::date, nullif(p->>'by',''), src, loc);
  for it in select * from jsonb_array_elements(p->'items') loop
    ln := ln + 1;
    /* THE SIDE DOOR. An SRN for something that is still out is always
       the wrong note, so it is refused and told where to go instead.
       Added by 055; everything else in this function is 048 verbatim. */
    if k = 'SRN' then perform wh_assert_returnable(nullif(it->>'sn','')); end if;
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
                         read_start,read_end,is_new,pack,from_wh,vendor)
    values (nullif(it->>'code',''), it->>'name', nullif(it->>'cat',''), coalesce(nullif(it->>'uom',''),'EA'), q,
            nullif(it->>'sn',''), coalesce(nullif(it->>'bin',''), nullif(p->>'bin','')), nullif(p->>'project',''),
            'in', case when rdp then 'redep' when k = 'SRN' then 'return'
                       when loc then 'local' else 'new' end,
            case when k = 'SRN' then coalesce(nullif(it->>'cond',''),'Good') end,
            nid, d, nullif(upper(p->>'site_id'),''), nullif(p->>'site_name',''),
            case when k = 'GRN' then nullif(p->>'reservation_no','') end,
            nullif(it->>'drum_name',''), (it->>'drum_lower')::numeric, (it->>'drum_upper')::numeric, (it->>'drum_upper')::numeric,
            (it->>'read_start')::numeric, (it->>'read_end')::numeric,
            coalesce((it->>'is_new')::boolean, false),
            case when nullif(it->>'drum_name','') is not null
                 then coalesce(nullif(it->>'pack',''),'drum') end,
            src, vnd)
    returning id into iid;
    insert into wh_lines(note_id,item_id,line_no,qty) values (nid, iid, ln, q);
  end loop;
  return nid;
end $$;

revoke all on function wh_update_item(jsonb), wh_inbound(jsonb) from public, anon;
grant execute on function wh_update_item(jsonb), wh_inbound(jsonb) to authenticated;
