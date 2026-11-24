-- 066_warehouse_item_edit_reaches_everything.sql  ·  four fields the
--     inbound writes and the editor could not reach
--
-- Run once in Supabase - SQL Editor. Safe to re-run. Needs 063.
--
-- WHAT IS WRONG. 061 moved site and reservation onto the row, 063 added
-- the row's own remarks, and 053 put the warehouse it came from on the
-- note. All four are written correctly - verified against the live data,
-- where the two drums booked in this morning both carry their
-- reservation and their warehouse. But wh_update_item accepts eighteen
-- fields and not one of these is among them, so the edit form cannot
-- correct any of them. A reservation number typed wrong at the counter
-- stays wrong for good.
--
-- That is worse than a missing box on a form, because the function
-- ignores keys it does not recognise: adding the inputs to the page
-- WITHOUT this migration gives an edit dialog that accepts a corrected
-- reservation, reports success, and changes nothing. The page is being
-- fixed in the same round; this is the half that has to land first.
--
-- Everything else in this function is 063 unchanged.

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
                   then p->>'source' else source end,
    /* 063: an item's own remark. Sent only when the sheet changed it,
       so an edit that does not mention remarks leaves it alone, and an
       emptied box really does clear it. */
    remarks = case when p ? 'remarks' then nullif(p->>'remarks','') else remarks end,
    /* 066: the four the inbound writes and the editor could not reach.
       Same shape as the others - sent only when the form changed it, so
       an edit that does not mention them leaves them alone, and an
       emptied box really does clear it. */
    reservation_no = case when p ? 'reservation_no' then nullif(p->>'reservation_no','') else reservation_no end,
    site_id        = case when p ? 'site_id'        then nullif(p->>'site_id','')        else site_id end,
    site_name      = case when p ? 'site_name'      then nullif(p->>'site_name','')      else site_name end,
    from_wh        = case when p ? 'from_wh'        then nullif(p->>'from_wh','')        else from_wh end
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
  if i.drum_name is not null
     and (i.drum_upper is distinct from i.orig_upper
          or i.drum_lower is distinct from i.orig_lower) then
    raise exception 'Drum % has been cut - it reads %-% and came in at %-%. Undo the cut before changing its readings.',
      i.drum_name, i.drum_lower, i.drum_upper, i.orig_lower, i.orig_upper;
  end if;

  update wh_items set
    qty        = coalesce(nullif(p->>'qty','')::numeric, qty),
    drum_lower = coalesce(nullif(p->>'drum_lower','')::numeric, drum_lower),
    drum_upper = coalesce(nullif(p->>'drum_upper','')::numeric, drum_upper),
    read_start = coalesce(nullif(p->>'read_start','')::numeric, read_start),
    read_end   = coalesce(nullif(p->>'read_end','')::numeric, read_end)
  where id = iid;

  /* an uncut drum's live range IS what came in, and its quantity is the
     span. 057 retired drum_cur: the span is the only truth. */
  update wh_items
     set orig_lower = drum_lower, orig_upper = drum_upper,
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

revoke all on function wh_update_item(jsonb) from public, anon;
grant execute on function wh_update_item(jsonb) to authenticated;
