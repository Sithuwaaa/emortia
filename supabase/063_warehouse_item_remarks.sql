-- 063_warehouse_item_remarks.sql  ·  a remark about the thing itself
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Needs 062.
--
-- wh_lines.remarks has existed since 048: a note about THIS LINE of
-- THIS NOTE - why these six were issued, what the driver was told.
-- wh_items had nothing, so a remark about the item itself - the box is
-- dented, the plate is unreadable, this one was swapped under warranty
-- - had nowhere to land. The inbound row has had a Remarks box all
-- along and it was only ever reaching the line, which is why the fact
-- disappeared from the item the moment you looked at it in Inventory.
--
-- One column, and two functions re-emitted whole to use it: wh_inbound
-- writes the row's remark onto the item as well as onto the line, and
-- wh_update_item lets it be corrected afterwards.
--
-- wh_outbound is NOT touched. Its remark is per line - what was said
-- when this went out - and that is the right place for it. A
-- direct-issue row still records its remark on the line only.
--
-- Both bodies below are the live definitions verbatim - wh_inbound as
-- 061 left it, wh_update_item as 057 left it - plus the remarks lines.
-- A function has one definition and the last one wins, so re-emitting
-- whole is the only way to change one safely.

alter table wh_items add column if not exists remarks text;

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
  /* 061: a site return still has to say where it came from, but the
     answer may now be per row. Checked inside the loop instead. */
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one material.'; end if;
  nid := wh_next(k);
  insert into wh_notes(id,kind,note_date,project,reservation_no,ref,site_id,site_name,removed_on,by_name,from_wh,is_local)
  values (nid, k, d, nullif(p->>'project',''),
          case when k = 'GRN' then nullif(p->>'reservation_no','') end,
          nullif(p->>'ref',''), nullif(upper(p->>'site_id'),''), nullif(p->>'site_name',''),
          nullif(p->>'removed_on','')::date, nullif(p->>'by',''), src, loc);
  for it in select * from jsonb_array_elements(p->'items') loop
    ln := ln + 1;
    if k = 'SRN' and coalesce(nullif(it->>'site_id',''), nullif(p->>'site_id',''), '') = '' then
      raise exception 'Row % of a site return needs the site ID it came from - on the row or on the note.', ln;
    end if;
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
                         from_site,from_site_name,reservation_no,drum_name,drum_lower,drum_upper,orig_lower,orig_upper,
                         read_start,read_end,is_new,pack,from_wh,vendor,remarks)
    values (nullif(it->>'code',''), it->>'name', nullif(it->>'cat',''), coalesce(nullif(it->>'uom',''),'EA'), q,
            nullif(it->>'sn',''), coalesce(nullif(it->>'bin',''), nullif(p->>'bin','')), nullif(p->>'project',''),
            'in', case when rdp then 'redep' when k = 'SRN' then 'return'
                       when loc then 'local' else 'new' end,
            case when k = 'SRN' then coalesce(nullif(it->>'cond',''),'Good') end,
            nid, d,
            /* 061: ROW FIRST, then the note. Many items arrive the same
               day for different sites against different reservations -
               1,261 rows of his own sheet are row-level on both - and
               the columns have been per item since 048. Only the
               copying was note-wide. */
            coalesce(nullif(upper(it->>'site_id'),''), nullif(upper(p->>'site_id'),'')),
            coalesce(nullif(it->>'site_name',''), nullif(p->>'site_name','')),
            coalesce(nullif(it->>'reservation_no',''),
                     case when k = 'GRN' then nullif(p->>'reservation_no','') end),
            nullif(it->>'drum_name',''), (it->>'drum_lower')::numeric, (it->>'drum_upper')::numeric,
            (it->>'drum_lower')::numeric, (it->>'drum_upper')::numeric,
            (it->>'read_start')::numeric, (it->>'read_end')::numeric,
            coalesce((it->>'is_new')::boolean, false),
            case when nullif(it->>'drum_name','') is not null
                 then coalesce(nullif(it->>'pack',''),'drum') end,
            src, vnd, nullif(it->>'remarks',''))
    returning id into iid;
    insert into wh_lines(note_id,item_id,line_no,qty,remarks)
    values (nid, iid, ln, q, nullif(it->>'remarks',''));
  end loop;
  return nid;
end $$;

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
    remarks = case when p ? 'remarks' then nullif(p->>'remarks','') else remarks end
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

revoke all on function wh_inbound(jsonb) from public, anon;
grant execute on function wh_inbound(jsonb) to authenticated;
revoke all on function wh_update_item(jsonb) from public, anon;
grant execute on function wh_update_item(jsonb) to authenticated;
