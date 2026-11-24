-- 067_warehouse_outbound_time.sql  ·  an issue has a time, not just a day
--
-- Run once in Supabase - SQL Editor. Safe to re-run. Needs 066.
--
-- Material leaves the warehouse several times a day and the note only
-- recorded the date, so two issues to two sites an hour apart were
-- indistinguishable on paper and sorted arbitrarily on screen. The time
-- is what tells him which lorry a drum went on.
--
-- OUTBOUND ONLY, which is what he asked for. An inbound keeps its date:
-- a delivery is booked in when there is time to book it in, and the
-- clock on that is the hour someone sat down at the counter, not the
-- hour the material arrived. Recording it would look like a fact and be
-- a guess. wh_inbound is not touched.
--
-- NULLABLE ON PURPOSE. Every note already filed has no time and is not
-- going to acquire one; a default of now() would stamp historical notes
-- with the moment this migration ran, which is worse than empty. The
-- page prints the date alone when the time is null.
--
-- IT ALSO HAS TO BE CORRECTABLE, so wh_update_note is re-emitted with
-- it. That function ignores keys it does not recognise, so adding a
-- Time box to the note editor without this would give a dialog that
-- accepts a corrected time, reports success and changes nothing - which
-- is exactly what 066 was written about.
--
-- Both bodies below are the live definitions verbatim - wh_outbound as
-- 062_warehouse_whole_drum_qty left it, wh_update_note as
-- 050_warehouse_delete_edit left it - plus the lines above.

alter table wh_notes add column if not exists note_time time;

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

create or replace function wh_update_note(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare nid text := p->>'id';
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  if nid is null or not exists (select 1 from wh_notes where id = nid) then
    raise exception 'There is no note %.', coalesce(nid, '(none)'); end if;
  update wh_notes set
    note_date    = coalesce(nullif(p->>'note_date','')::date, note_date),
    /* 067: and the time, when the form sends one. Sent only on change,
       so a note edited for its driver does not lose its time - and an
       emptied box really does clear it, which is how a time typed onto
       the wrong note gets taken off again. */
    note_time    = case when p ? 'note_time' then nullif(p->>'note_time','')::time else note_time end,
    project      = coalesce(p->>'project', project),
    ref          = coalesce(p->>'ref', ref),
    reservation_no = coalesce(p->>'reservation_no', reservation_no),
    site_name    = coalesce(p->>'site_name', site_name),
    removed_on   = coalesce(nullif(p->>'removed_on','')::date, removed_on),
    purpose      = coalesce(p->>'purpose', purpose),
    party_ref    = coalesce(p->>'party_ref', party_ref),
    by_name      = coalesce(p->>'by_name', by_name),
    requested_by = coalesce(p->>'requested_by', requested_by),
    receiver     = coalesce(p->>'receiver', receiver),
    vehicle      = coalesce(p->>'vehicle', vehicle),
    driver       = coalesce(p->>'driver', driver),
    contact      = coalesce(p->>'contact', contact),
    issued_by    = coalesce(p->>'issued_by', issued_by)
  where id = nid;
  /* the two fields 049 added, only if 049 has been run */
  if exists (select 1 from information_schema.columns
             where table_name='wh_notes' and column_name='driver_nic') then
    execute 'update wh_notes set driver_nic = coalesce($2->>''driver_nic'', driver_nic),
             issued_contact = coalesce($2->>''issued_contact'', issued_contact) where id = $1'
      using nid, p;
  end if;
  return nid;
end $$;

revoke all on function wh_outbound(jsonb) from public, anon;
grant execute on function wh_outbound(jsonb) to authenticated;
revoke all on function wh_update_note(jsonb) from public, anon;
grant execute on function wh_update_note(jsonb) to authenticated;
