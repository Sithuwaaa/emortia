-- 068_warehouse_overissue_and_returned_piece.sql
--     ·  a drum that has gone out cannot be cut again
--
-- Run once in Supabase - SQL Editor. Safe to re-run. Needs 067.
--
-- THE HOLE. wh_outbound has two drum branches. The whole-drum branch
-- checks `if L.status <> 'in' then raise`. The cut branch checked only
-- whether the length asked for exceeded drum_upper - drum_lower - and
-- those two readings DO NOT MOVE when a drum goes out whole, because
-- nothing was cut off it. So a drum issued entire still answered with
-- its full remaining length, and the next cut sailed through.
--
-- It has already happened. One 500 m drum has four outbound lines
-- against it totalling 640 m: three cuts covering its range exactly,
-- and a whole-drum issue in the middle of them. The last 140 m was
-- taken off a drum that was no longer in the warehouse.
--
-- THIS DOES NOT REPAIR THE DATA, and should not. Two of those notes
-- are to the same destination on the same day for the same 140 m,
-- which looks like one delivery entered twice - but which of the two
-- is the duplicate is his to say, not mine to guess. The fix stops it
-- happening again; the existing note is a question for him.
--
-- The length test stays and runs after the status test, because "it is
-- already out" and "there is not that much left on it" are different
-- answers and the person at the counter should get the true one.
--
-- AND A RETURNED PIECE BELONGS TO ITS DRUM. Two returns have booked
-- lengths back in off named drums, and both landed as items with
-- drum_name null and no readings - indistinguishable from cable that
-- arrived on a lorry. wh_items.from_drum records which spool a piece
-- came off. The readings stay null until he measures it, and the
-- PARENT'S RANGE IS NOT TOUCHED: the range is a continuous physical
-- measure and the cuts against it are its audit trail, so splicing a
-- returned length back on would claim a join that never happened and
-- make the cut history impossible to reconstruct.
--
-- He cannot give it readings today either, because wh_update_item
-- refuses to name anything that was not booked in as a drum - which a
-- returned piece never is. from_drum marks exactly those, so they can
-- be named and nothing else can. The uniqueness check stays.
--
-- The bodies below are the live definitions verbatim - wh_outbound as
-- 067 left it, wh_return as 055_warehouse_return left it,
-- wh_update_item as 066_warehouse_item_edit_reaches_everything left it - plus the
-- changes above.

alter table wh_items add column if not exists from_drum text;

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
  insert into wh_notes(id,kind,note_date,note_time,project,site_id,site_name,dest,party,purpose,party_ref,
                       requested_by,receiver,vehicle,driver,driver_nic,contact,issued_by,issued_contact)
  values (nid,'OBN',d,nullif(p->>'time','')::time,nullif(p->>'project',''),
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
        /* 068: A DRUM THAT HAS LEFT THE BUILDING CANNOT BE CUT.
           The whole-drum branch below has always checked status; this
           one checked only the length, and the two readings do not move
           when a drum goes out whole - so a drum issued entire still
           reported its full remaining length and the next cut passed.
           500 m left a 500 m drum and then 140 m more left it.
           The length test stays and runs after, because "it is already
           out" and "there is not that much left" are different answers
           and he should get the true one. */
        if L.status <> 'in' then
          raise exception 'Drum % went out whole on % - there is nothing left on it to cut.',
            L.drum_name, coalesce(L.out_note, 'an outbound note'); end if;
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
        /* 062: A WHOLE DRUM CARRIES ITS LENGTH. The quantity on the
           line is the metres on the drum as it leaves, worked out
           from the live range rather than read off wh_items.qty -
           same number today, but the span is the definition and
           qty is a cached answer to it. The note says what the site
           is actually receiving. */
        insert into wh_lines(note_id,item_id,line_no,qty,cut_from,cut_to,remarks)
        values (nid, L.id, ln,
                case when L.drum_name is not null then L.drum_upper - L.drum_lower
                     else L.qty end,
                L.read_end, L.read_start, nullif(it->>'remarks',''));
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

create or replace function wh_return(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  nid text; obn text := p->>'obn'; n wh_notes; d date := coalesce(nullif(p->>'date','')::date, current_date);
  it jsonb; ln int := 0; rec record; want numeric; left_out numeric; newid bigint; tgt bigint;
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  select * into n from wh_notes where id = obn for update;
  if not found then raise exception 'There is no note %.', coalesce(obn,'(none)'); end if;
  if n.kind <> 'OBN' then raise exception '% is a %, not an outbound note. Only what went out can come back.', obn, n.kind; end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then
    raise exception 'Mark at least one line as returned.'; end if;

  nid := wh_next('RTN');
  insert into wh_notes(id,kind,note_date,project,site_id,site_name,party,reverses,by_name,ref)
  values (nid,'RTN',d,n.project,n.site_id,n.site_name,n.party,obn,
          nullif(p->>'by',''), nullif(p->>'ref',''));

  for it in select * from jsonb_array_elements(p->'items') loop
    ln := ln + 1;
    select l.id as lid, l.qty as lqty, l.cut_from, l.cut_to, l.item_id,
           i.code, i.name, i.cat, i.uom, i.qty as iqty, i.sn, i.status, i.out_note,
           i.source, i.in_note, i.project, i.drum_name
      into rec
      from wh_lines l join wh_items i on i.id = l.item_id
     where l.id = (it->>'line_id')::bigint and l.note_id = obn;
    if not found then raise exception 'Line % is not on %.', it->>'line_id', obn; end if;

    want := coalesce(nullif(it->>'qty','')::numeric, rec.lqty);
    select rec.lqty - coalesce(sum(r.qty),0) into left_out
      from wh_lines r where r.returns_line = rec.lid;
    if want <= 0 then raise exception 'How much of % is coming back?', coalesce(rec.sn, rec.name); end if;
    if want > left_out then
      raise exception 'Only % of % is still out on % - % has already come back.',
        left_out, coalesce(rec.sn, rec.name), obn, rec.lqty - left_out;
    end if;

    if rec.cut_from is not null then
      /* 068: A PIECE CUT OFF A DRUM BELONGS TO THAT DRUM. It is still
         its own object - it was cut off and brought back, and nothing
         rejoined it - but it came off a named spool and saying which
         one is the difference between "100 m of cable appeared" and
         "100 m came back off that drum". from_drum carries the name;
         the readings stay null until he measures it.

         THE PARENT'S RANGE IS NOT TOUCHED, deliberately. The range is
         a continuous physical measure and the cuts against it are its
         audit trail. Splicing 100 m back on would claim a join that
         did not happen and make the cut history impossible to
         reconstruct. */
      insert into wh_items(code,name,cat,uom,qty,bin,project,status,source,
                           in_note,in_date,from_site,from_site_name,cond,is_new,from_drum)
      values (rec.code, rec.name, rec.cat, 'M', want, nullif(it->>'bin',''), rec.project, 'in', 'return',
              nid, d, n.site_id, n.site_name,
              coalesce(nullif(it->>'cond',''),'Good'), false, rec.drum_name)
      returning id into newid;
      tgt := newid;

    elsif want = rec.iqty and rec.status = 'out' and rec.out_note = obn then
      /* all of it: the row that went out is the row that comes back */
      update wh_items set status='in', out_note=null, out_date=null,
             site_id=null, site_name=null, party=null,
             from_site = n.site_id, from_site_name = n.site_name,
             bin  = coalesce(nullif(it->>'bin',''), bin),
             cond = coalesce(nullif(it->>'cond',''), cond, 'Good')
       where id = rec.item_id;
      tgt := rec.item_id;

    else
      /* part of it: six stay out on that note, four come back as their own row */
      if rec.sn is not null and rec.sn <> '' and rec.sn not like 'DMY-%' then
        raise exception '% carries a serial, so it is one unit - it comes back whole or not at all.', rec.sn;
      end if;
      if rec.status <> 'out' or rec.out_note is distinct from obn then
        raise exception '% is not out on % any more.', coalesce(rec.sn, rec.name), obn;
      end if;
      update wh_items set qty = qty - want where id = rec.item_id;
      /* 068: and so does part of a drum that went out whole. Same
         reasoning - it came off a named spool, so the row says which. */
      insert into wh_items(code,name,cat,uom,qty,bin,project,status,source,
                           in_note,in_date,from_site,from_site_name,cond,is_new,from_drum)
      values (rec.code, rec.name, rec.cat, rec.uom, want, nullif(it->>'bin',''), rec.project, 'in', rec.source,
              rec.in_note, d, n.site_id, n.site_name,
              coalesce(nullif(it->>'cond',''),'Good'), false, rec.drum_name)
      returning id into newid;
      tgt := newid;
    end if;

    insert into wh_lines(note_id,item_id,line_no,qty,remarks,returns_line)
    values (nid, tgt, ln, want, nullif(it->>'remarks',''), rec.lid);
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
    /* 068: A RETURNED PIECE MAY BE NAMED. "A drum is named when it is
       booked in" is right for anything that arrived as stock, and
       wrong for the one thing that did not: a length cut off a drum
       and brought back, which arrives with no name because nobody had
       measured it yet. from_drum marks exactly those, so they can be
       named later and nothing else can. The uniqueness check below
       still runs - two drums sharing a name is how a cut stops being
       traceable. */
    if i.drum_name is null and i.from_drum is null then
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

revoke all on function wh_outbound(jsonb) from public, anon;
grant execute on function wh_outbound(jsonb) to authenticated;
revoke all on function wh_return(jsonb) from public, anon;
grant execute on function wh_return(jsonb) to authenticated;
revoke all on function wh_update_item(jsonb) from public, anon;
grant execute on function wh_update_item(jsonb) to authenticated;
