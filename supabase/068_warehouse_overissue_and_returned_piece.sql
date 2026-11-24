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
-- The body below is 067's wh_outbound verbatim plus that check.

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

revoke all on function wh_outbound(jsonb) from public, anon;
grant execute on function wh_outbound(jsonb) to authenticated;
