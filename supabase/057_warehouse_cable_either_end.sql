-- 057_warehouse_cable_either_end.sql  ·  a cut has an end
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Needs 056.
--
-- RUN THIS WHILE EVERY DRUM STILL READS FULL. Today all three do, so the
-- backfill below is exact. Cut anything from the low end first and the
-- migration would have to work out which end moved from numbers that no
-- longer say.
--
-- WHAT WAS WRONG. drum_cur was a single pointer and a cut only ever
-- subtracted from it, so cutting from the LOW end could not be expressed
-- at all. Doing it anyway left drum_cur describing a drum that does not
-- exist, and nothing said a word - the quantity still looked plausible.
--
-- WHAT REPLACES IT. drum_lower and drum_upper are now the LIVE range:
-- where the cable physically starts and ends right now. orig_lower and
-- orig_upper record what came in. A cut names its end - the upper falls
-- or the lower rises - and what is left is always upper minus lower,
-- whichever end moved. "Has this been cut?" stops being a comparison
-- against one pointer and becomes "is the live range still the original
-- range", which is true for both ends.
--
-- drum_cur IS RETIRED, NOT KEPT IN SYNC. It is derivable from the live
-- range, and a derivable copy with two readers is a copy that will
-- disagree with itself. Every function that read it is re-emitted below.
--
-- wh_lines.cut_end records which end each cut came off, because the undo
-- has to put the metres back where they came from. Until now
-- wh_delete_note and wh_delete_line always added back on top, which for
-- a low-end cut restores the wrong end of the drum and leaves the total
-- right and the readings wrong - the worst shape of error, because the
-- number you check agrees with you.
--
-- Existing lines are backfilled to 'upper', which is what they must have
-- been: it was the only end that could be cut.

alter table wh_items add column if not exists orig_lower numeric;
alter table wh_items add column if not exists orig_upper numeric;

-- what came in. For a drum already cut from the top, the original upper
-- is the old drum_upper and the LIVE upper becomes where it now reads.
update wh_items set orig_lower = coalesce(orig_lower, drum_lower),
                    orig_upper = coalesce(orig_upper, drum_upper)
 where drum_name is not null;
update wh_items set drum_upper = drum_cur
 where drum_name is not null and drum_cur is not null and drum_cur < drum_upper;

-- the quantity is the span, always
update wh_items set qty = drum_upper - drum_lower where drum_name is not null;

alter table wh_lines add column if not exists cut_end text
  check (cut_end in ('upper','lower'));
update wh_lines set cut_end = 'upper' where cut_from is not null and cut_end is null;

-- and the pointer goes, once nothing reads it any more
alter table wh_items drop column if exists drum_cur;


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
                         from_site,from_site_name,reservation_no,drum_name,drum_lower,drum_upper,orig_lower,orig_upper,
                         read_start,read_end,is_new,pack,from_wh,vendor)
    values (nullif(it->>'code',''), it->>'name', nullif(it->>'cat',''), coalesce(nullif(it->>'uom',''),'EA'), q,
            nullif(it->>'sn',''), coalesce(nullif(it->>'bin',''), nullif(p->>'bin','')), nullif(p->>'project',''),
            'in', case when rdp then 'redep' when k = 'SRN' then 'return'
                       when loc then 'local' else 'new' end,
            case when k = 'SRN' then coalesce(nullif(it->>'cond',''),'Good') end,
            nid, d, nullif(upper(p->>'site_id'),''), nullif(p->>'site_name',''),
            case when k = 'GRN' then nullif(p->>'reservation_no','') end,
            nullif(it->>'drum_name',''), (it->>'drum_lower')::numeric, (it->>'drum_upper')::numeric,
            (it->>'drum_lower')::numeric, (it->>'drum_upper')::numeric,
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
  if dst = 'party' then insert into wh_parties(name) values (prt) on conflict do nothing; end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    ln := ln + 1;
    if it->>'item_id' is not null then
      select * into L from wh_items where id = (it->>'item_id')::bigint for update;
      if not found then raise exception 'Item % is not in the warehouse list.', it->>'item_id'; end if;
      if L.drum_name is not null then
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

create or replace function wh_delete_note(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n wh_notes; rec record; freed int := 0; removed int := 0; restored int := 0; back int := 0; blocker text;
begin
  if not is_owner() then raise exception 'Only the owner can delete a note.'; end if;
  select * into n from wh_notes where id = p_id for update;
  if not found then raise exception 'There is no note %.', p_id; end if;

  if n.kind = 'OBN' then
    select r.id into blocker from wh_notes r where r.reverses = p_id limit 1;
    if blocker is not null then
      raise exception '% has a return against it (%). Delete that first.', p_id, blocker;
    end if;
    /* give everything back, newest line first so a drum cut twice on one
       note unwinds in the order it was cut */
    for rec in select l.*, i.id as iid, i.sn, i.name, i.source, i.out_note,
                    i.drum_name, i.drum_lower, i.drum_upper, i.orig_lower, i.orig_upper
             from wh_lines l join wh_items i on i.id = l.item_id
             where l.note_id = p_id order by l.line_no desc loop
      if rec.source = 'direct' and rec.out_note = p_id then
        delete from wh_lines where item_id = rec.iid;
        delete from wh_items where id = rec.iid;
        removed := removed + 1;
      elsif rec.drum_name is not null then
        /* 057: give the metres back to the END THEY CAME OFF. Before
           this they always went back on top, which restored the wrong
           end of any drum cut from the low end. */
        if coalesce(rec.cut_end,'upper') = 'upper' then
          if rec.drum_upper + rec.qty > rec.orig_upper then
            raise exception 'Drum % cannot take % m back on top: it reads % and came in at %. Undo the later cut first.',
              rec.drum_name, rec.qty, rec.drum_upper, rec.orig_upper;
          end if;
          update wh_items set drum_upper = drum_upper + rec.qty,
                              qty = (drum_upper + rec.qty) - drum_lower where id = rec.iid;
        else
          if rec.drum_lower - rec.qty < rec.orig_lower then
            raise exception 'Drum % cannot take % m back at the low end: it starts at % and came in at %. Undo the later cut first.',
              rec.drum_name, rec.qty, rec.drum_lower, rec.orig_lower;
          end if;
          update wh_items set drum_lower = drum_lower - rec.qty,
                              qty = drum_upper - (drum_lower - rec.qty) where id = rec.iid;
        end if;
        freed := freed + 1;
      else
        if rec.out_note is distinct from p_id then
          raise exception '% is not on this note any more - it went out on %.',
            coalesce(rec.sn, rec.name), coalesce(rec.out_note, 'another note');
        end if;
        update wh_items set status = 'in', out_note = null, out_date = null,
                            site_id = null, site_name = null, party = null
         where id = rec.iid;
        restored := restored + 1;
      end if;
    end loop;

  elsif n.kind = 'RTN' then
    /* UNDOING A RETURN PUTS IT BACK OUT, by the same three shapes it came
       in by. Which shape a line was is read off the outbound line it
       answers - returns_line - not stored a second time. */
    for rec in select r.id as rid, r.qty, r.item_id, r.returns_line,
                      ol.item_id as orig_item, ol.cut_from,
                      i.sn, i.name, i.status, i.out_note
               from wh_lines r
               join wh_lines ol on ol.id = r.returns_line
               join wh_items i on i.id = r.item_id
              where r.note_id = p_id loop
      if rec.status <> 'in' then
        raise exception '% has gone out again on %. Delete that note first.',
          coalesce(rec.sn, rec.name), coalesce(rec.out_note,'another note');
      end if;
      if rec.item_id = rec.orig_item then
        /* it was a flip: send the same row back out on the note it was on */
        update wh_items set status='out', out_note=n.reverses, out_date=(select note_date from wh_notes where id=n.reverses),
               site_id=(select site_id from wh_notes where id=n.reverses),
               site_name=(select site_name from wh_notes where id=n.reverses),
               party=(select party from wh_notes where id=n.reverses),
               from_site=null, from_site_name=null
         where id = rec.item_id;
        back := back + 1;
      else
        /* a split or a cable offcut: the row only exists because of this
           return. A split gives its quantity back to the row it came off;
           an offcut gives nothing back, because the drum was never
           restored in the first place. */
        delete from wh_lines where item_id = rec.item_id;
        delete from wh_items where id = rec.item_id;
        if rec.cut_from is null then
          update wh_items set qty = qty + rec.qty where id = rec.orig_item;
        end if;
        removed := removed + 1;
      end if;
    end loop;

  else   /* GRN or SRN: the items it created go, if they are all still here */
    for rec in select i.* from wh_lines l join wh_items i on i.id = l.item_id
             where l.note_id = p_id loop
      if rec.in_note is distinct from p_id then
        raise exception '% was not booked in on this note.', coalesce(rec.sn, rec.name);
      end if;
      if rec.status = 'out' then
        raise exception '% has already gone out on %. Delete that note first.',
          coalesce(rec.sn, rec.name), coalesce(rec.out_note, 'an outbound note');
      end if;
      if rec.drum_name is not null
         and (rec.drum_upper is distinct from rec.orig_upper
              or rec.drum_lower is distinct from rec.orig_lower) then
        raise exception 'Drum % has been cut - it reads %-% and came in at %-%. Undo the cut first.',
          rec.drum_name, rec.drum_lower, rec.drum_upper, rec.orig_lower, rec.orig_upper;
      end if;
    end loop;
    for rec in select i.id from wh_lines l join wh_items i on i.id = l.item_id
             where l.note_id = p_id loop
      delete from wh_lines where item_id = rec.id;
      delete from wh_items where id = rec.id;
      removed := removed + 1;
    end loop;
  end if;

  delete from wh_lines where note_id = p_id;
  delete from wh_notes where id = p_id;
  return jsonb_build_object('note', p_id, 'kind', n.kind,
    'restored', restored, 'drums', freed, 'removed', removed, 'sent_back', back);
end $$;

create or replace function wh_delete_line(p_line_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n wh_notes; rec record; total int; what text; p_note text;
begin
  if not is_owner() then raise exception 'Only the owner can remove a line.'; end if;
  select note_id into p_note from wh_lines where id = p_line_id;
  if p_note is null then raise exception 'There is no line %.', p_line_id; end if;
  select * into n from wh_notes where id = p_note for update;
  if not found then raise exception 'There is no note %.', p_note; end if;

  select count(*) into total from wh_lines where note_id = p_note;
  if total <= 1 then
    raise exception 'That is the only line on %. Delete the note instead - it does the same thing and leaves nothing behind.', p_note;
  end if;

  select l.*, i.id as iid, i.sn, i.name, i.source, i.status, i.in_note, i.out_note,
         i.drum_name, i.drum_lower, i.drum_upper, i.orig_lower, i.orig_upper
    into rec
    from wh_lines l join wh_items i on i.id = l.item_id
   where l.id = p_line_id;
  if not found then raise exception 'There is no line %.', p_line_id; end if;
  what := coalesce(rec.sn, rec.name);

  if n.kind = 'OBN' then
    if rec.source = 'direct' and rec.out_note = p_note then
      delete from wh_lines where id = rec.id;
      delete from wh_items where id = rec.iid;
    elsif rec.drum_name is not null then
      /* 057: back onto the end it came off, same rule as the whole note */
      if coalesce(rec.cut_end,'upper') = 'upper' then
        if rec.drum_upper + rec.qty > rec.orig_upper then
          raise exception 'Drum % cannot take % m back on top: it reads % and came in at %. Undo the later cut first.',
            rec.drum_name, rec.qty, rec.drum_upper, rec.orig_upper;
        end if;
        update wh_items set drum_upper = drum_upper + rec.qty,
                            qty = (drum_upper + rec.qty) - drum_lower where id = rec.iid;
      else
        if rec.drum_lower - rec.qty < rec.orig_lower then
          raise exception 'Drum % cannot take % m back at the low end: it starts at % and came in at %. Undo the later cut first.',
            rec.drum_name, rec.qty, rec.drum_lower, rec.orig_lower;
        end if;
        update wh_items set drum_lower = drum_lower - rec.qty,
                            qty = drum_upper - (drum_lower - rec.qty) where id = rec.iid;
      end if;
      delete from wh_lines where id = rec.id;
    else
      if rec.out_note is distinct from p_note then
        raise exception '% is not on this note any more - it went out on %.', what, coalesce(rec.out_note, 'another note');
      end if;
      update wh_items set status = 'in', out_note = null, out_date = null,
                          site_id = null, site_name = null, party = null
       where id = rec.iid;
      delete from wh_lines where id = rec.id;
    end if;
  else
    if rec.in_note is distinct from p_note then
      raise exception '% was not booked in on this note.', what;
    end if;
    if rec.status = 'out' then
      raise exception '% has already gone out on %. Delete that note first.', what, coalesce(rec.out_note, 'an outbound note');
    end if;
    if rec.drum_name is not null
       and (rec.drum_upper is distinct from rec.orig_upper
            or rec.drum_lower is distinct from rec.orig_lower) then
      raise exception 'Drum % has been cut - it reads %-% and came in at %-%. Undo the cut first.',
        rec.drum_name, rec.drum_lower, rec.drum_upper, rec.orig_lower, rec.orig_upper;
    end if;
    delete from wh_lines where item_id = rec.iid;
    delete from wh_items where id = rec.iid;
  end if;

  return jsonb_build_object('note', p_note, 'line', p_line_id, 'what', what);
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


-- ----------------------------- wh_delete_item also read the pointer
-- Missed on the first pass and caught by wh-return.test.js: it is the one
-- function 057 does not otherwise touch, so dropping the column would
-- have broken it at runtime, and only for somebody deleting a drum.

create or replace function wh_delete_item(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i wh_items; onnotes int;
begin
  if not is_owner() then raise exception 'Only the owner can delete an item.'; end if;
  select * into i from wh_items where id = p_id for update;
  if not found then raise exception 'There is no item %.', p_id; end if;
  if i.status = 'out' then
    raise exception '% has gone out on %. Delete that note instead, which brings it back first.',
      coalesce(i.sn, i.name), coalesce(i.out_note, 'an outbound note');
  end if;
  /* 057: cut or not is the live range against what came in, which is
     true for a drum cut from either end. drum_cur is gone. */
  if i.drum_name is not null
     and (i.drum_upper is distinct from i.orig_upper
          or i.drum_lower is distinct from i.orig_lower) then
    raise exception 'Drum % has been cut - it reads %-% and came in at %-%.',
      i.drum_name, i.drum_lower, i.drum_upper, i.orig_lower, i.orig_upper;
  end if;
  select count(*) into onnotes from wh_lines l
   where l.item_id = p_id and l.note_id is distinct from i.in_note;
  if onnotes > 0 then
    raise exception '% is on % other note(s). Delete those first.', coalesce(i.sn, i.name), onnotes;
  end if;
  delete from wh_lines where item_id = p_id;
  delete from wh_items where id = p_id;
  return jsonb_build_object('item', p_id, 'name', i.name);
end $$;

revoke all on function wh_inbound(jsonb), wh_outbound(jsonb), wh_delete_note(text), wh_delete_line(bigint), wh_delete_item(bigint), wh_update_item(jsonb) from public, anon;
grant execute on function wh_inbound(jsonb), wh_outbound(jsonb), wh_delete_note(text), wh_delete_line(bigint), wh_delete_item(bigint), wh_update_item(jsonb) to authenticated;
