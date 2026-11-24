-- 069_warehouse_reconcile.sql  ·  edit a whole note, not a row at a time
--
-- Run once in Supabase - SQL Editor. Safe to re-run. Needs 068.
--
-- Editing a note meant editing its header through wh_update_note and
-- then each row through its own pencil, and there was no way at all to
-- ADD a row: of the eleven wh_ functions, none inserts a line into a
-- note that already exists. wh_reconcile takes the whole note as the
-- form holds it and settles the difference.
--
-- IT IS BUILT ON THE FUNCTIONS THAT ALREADY DO THESE JOBS, not beside
-- them. The header goes through wh_update_note. Changed rows go
-- through wh_update_item, so every guard it raises still applies - a
-- quantity that cannot move because the thing went out, a drum that
-- has been cut, a name already taken. Removed rows go through
-- wh_delete_line, which is the only thing that knows how to give a cut
-- back to the end it came off, refusing when a later cut is in the
-- way; that logic is not written a second time anywhere.
--
-- ADDING a row needed somewhere to live, so the per-item bodies of
-- wh_inbound and wh_outbound are lifted VERBATIM into
-- wh_add_inbound_line and wh_add_outbound_line, and both parents are
-- re-emitted to call them. Create and edit now add a line through one
-- implementation. Two copies of an insert that long - and in the
-- outbound case carrying the whole cut arithmetic - would have drifted
-- inside a month.
--
-- ONE TRANSACTION. A plpgsql function is one, and nothing here catches
-- an exception, so a reconcile either lands whole or not at all. A
-- half-applied edit to an outbound note would leave stock in a state
-- no note describes.
--
-- OUTBOUND IS THE DANGEROUS DIRECTION and nothing is relaxed for it.
-- Its lines have already moved stock, so removing one undoes a cut and
-- changing one answers to wh_update_item. The issued quantity on an
-- outbound line is not editable here at all: it is what was handed
-- over and signed for.
--
-- Removing a line is owner-only, because wh_delete_line is - inherited,
-- not re-decided.

create or replace function wh_add_inbound_line(p_nid text, p_ln int, p jsonb, it jsonb)
  returns bigint
language plpgsql security definer set search_path = public as $$
declare
  nid text := p_nid; ln int := p_ln; iid bigint; q numeric;
  k text := p->>'kind';
  loc boolean := coalesce((p->>'is_local')::boolean, false);
  src text := nullif(trim(p->>'from_wh'),'');
  vnd text := nullif(trim(p->>'vendor'),'');
  rdp boolean := nullif(p->>'source','') = 'redep';
  d date := coalesce(nullif(p->>'date','')::date, current_date);
begin
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
            /* 064: THE ROW SAYS WHETHER IT WAS REDEPLOYED. On one site
               return some pieces go back to Dialog and some are kept and
               redeployed; a note-level toggle could not say that, so it
               made every row on the note agree. The row is asked first
               and the note is the fallback for anything still sending
               it, exactly as 061 did for the site and the reservation.
               Only 'redep' is taken from the row: 'return' and anything
               else fall through to what the note kind already decides,
               so a row cannot talk itself out of being a return. */
            'in', case when nullif(it->>'source','') = 'redep'
                         or coalesce(rdp, false) then 'redep'
                       when k = 'SRN' then 'return'
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
  return iid;
end $$;

create or replace function wh_add_outbound_line(p_nid text, p_ln int, p jsonb, it jsonb)
  returns bigint
language plpgsql security definer set search_path = public as $$
declare
  nid text := p_nid; ln int := p_ln; L wh_items; iid bigint; q numeric; len numeric; cend text;
  dst text := coalesce(nullif(p->>'dest',''),'site');
  sid text := nullif(upper(p->>'site_id'),'');
  prt text := nullif(trim(p->>'party'),'');
  d date := coalesce(nullif(p->>'date','')::date, current_date);
begin
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
  return coalesce(iid, L.id);
end $$;

create or replace function wh_inbound(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  k text := p->>'kind'; nid text; it jsonb; ln int := 0; iid bigint; q numeric;
  loc boolean := coalesce((p->>'is_local')::boolean, false);   -- 053
  src text := nullif(trim(p->>'from_wh'),'');                  -- 053
  vnd text := nullif(trim(p->>'vendor'),'');                   -- 056
  rdp boolean := nullif(p->>'source','') = 'redep';            -- 056, now a fallback
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
    /* 069: ONE PLACE THAT ADDS A LINE. This body moved to
       wh_add_inbound_line so that editing a note can add a row
       the same way creating one does. Two copies of an insert
       this long would have drifted inside a month. */
    perform wh_add_inbound_line(nid, ln, p, it);

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
    /* 069: moved to wh_add_outbound_line, for the same reason -
       and this one carries the cut arithmetic and every guard
       around it, which is the last thing that should exist twice. */
    perform wh_add_outbound_line(nid, ln, p, it);

  end loop;
  return nid;
end $$;

create or replace function wh_reconcile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  nid text := p->>'id'; n wh_notes; r jsonb; keep bigint[] := '{}';
  lid bigint; iid bigint; ln int;
  removed int := 0; changed int := 0; added int := 0;
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  select * into n from wh_notes where id = nid for update;
  if not found then raise exception 'There is no note %.', coalesce(nid,'(none)'); end if;
  if n.kind not in ('GRN','SRN','OBN') then
    raise exception '% is a %. A return is edited from the note it reverses, not on its own.', nid, n.kind;
  end if;
  if jsonb_array_length(coalesce(p->'rows','[]'::jsonb)) = 0 then
    raise exception 'A note has to keep at least one line. Delete the note instead - it does the same thing and leaves nothing behind.';
  end if;

  /* 1. THE HEADER, through the function that owns it. */
  if p ? 'header' then
    perform wh_update_note((p->'header') || jsonb_build_object('id', nid));
  end if;

  /* 2. which lines the form still shows */
  for r in select * from jsonb_array_elements(p->'rows') loop
    if nullif(r->>'line_id','') is not null then
      keep := keep || (r->>'line_id')::bigint;
    end if;
  end loop;

  /* 3. REMOVALS, through wh_delete_line. It is the only thing that
     knows how to give a cut back to the end it came off - two updates,
     one per end, with a refusal if a later cut is in the way - and
     writing that a second time is how the two copies start to
     disagree. Highest line_no first, so the drum unwinds in the order
     it was cut. Its owner-only check and its "that is the only line"
     refusal come with it, unrelaxed. */
  for lid in select id from wh_lines
              where note_id = nid and not (id = any(keep))
              order by line_no desc loop
    perform wh_delete_line(lid);
    removed := removed + 1;
  end loop;

  /* 4. CHANGES, through wh_update_item - which keeps every guard it
     raises: a quantity that cannot move because the thing went out, a
     drum that has been cut, a drum name that is already taken. */
  for r in select * from jsonb_array_elements(p->'rows') loop
    if nullif(r->>'line_id','') is null then continue; end if;
    select l.item_id into iid from wh_lines l
     where l.id = (r->>'line_id')::bigint and l.note_id = nid;
    if iid is null then raise exception 'Line % is not on %.', r->>'line_id', nid; end if;
    if r ? 'item' and jsonb_typeof(r->'item') = 'object' then
      perform wh_update_item((r->'item') || jsonb_build_object('id', iid));
      changed := changed + 1;
    end if;
    /* the line's own words. The quantity on an OUTBOUND line is what
       was handed over and is not edited here - 051 and 054 both say a
       number on a note already issued is not ours to rewrite, and the
       stock it moved is settled by wh_update_item or by removing the
       line outright. */
    if r ? 'remarks' then
      update wh_lines set remarks = nullif(r->>'remarks','') where id = (r->>'line_id')::bigint;
    end if;
  end loop;

  /* 5. NEW ROWS, added exactly the way the creating form adds them,
     because it is the same function doing it. */
  select coalesce(max(line_no),0) into ln from wh_lines where note_id = nid;
  for r in select * from jsonb_array_elements(p->'rows') loop
    if nullif(r->>'line_id','') is not null then continue; end if;
    ln := ln + 1;
    /* THE NOTE'S OWN DATE AND KIND, not the form's and not today's.
       Both helpers stamp the new item with in_date or out_date from
       the payload they are given, and a row added to a note filed
       last week belongs to last week. Overridden here rather than
       trusted from the page, because a page that forgot to send it
       would silently date the row today and nothing would say so. */
    if n.kind = 'OBN' then
      perform wh_add_outbound_line(nid, ln,
        coalesce(p->'note','{}'::jsonb) || jsonb_build_object('date', n.note_date), r);
    else
      perform wh_add_inbound_line(nid, ln,
        coalesce(p->'note','{}'::jsonb)
          || jsonb_build_object('kind', n.kind, 'date', n.note_date), r);
    end if;
    added := added + 1;
  end loop;

  return jsonb_build_object('note', nid, 'removed', removed, 'changed', changed, 'added', added);
end $$;

revoke all on function wh_add_inbound_line(text,int,jsonb,jsonb) from public, anon, authenticated;
revoke all on function wh_add_outbound_line(text,int,jsonb,jsonb) from public, anon, authenticated;
revoke all on function wh_inbound(jsonb) from public, anon;
grant execute on function wh_inbound(jsonb) to authenticated;
revoke all on function wh_outbound(jsonb) from public, anon;
grant execute on function wh_outbound(jsonb) to authenticated;
revoke all on function wh_reconcile(jsonb) from public, anon;
grant execute on function wh_reconcile(jsonb) to authenticated;
