-- 054_warehouse_item_edit_widen.sql  ·  correcting the rest of the words
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Needs 052.
--
-- WHY. The real warehouse is being loaded by hand, from paper and from
-- memory, and the three fields most likely to be typed wrong were the three
-- wh_update_item would not change: the material code, the project, and a
-- drum's name. Correcting any of them meant deleting the whole note and
-- filing it again, which is the wrong size of tool for a typo.
--
-- They are words about a thing, not stock, so they join the always-allowed
-- set beside name, category, unit, bin, serial and condition.
--
-- THE STOCK GUARDS ARE UNTOUCHED. Quantity and drum readings still refuse
-- once the item has gone out or is on an outbound note, and still refuse on
-- a drum that has been cut. Nothing below widens them; the section is
-- copied forward exactly as 052 wrote it.
--
-- WHAT ALLOWING EACH FIELD ACTUALLY COSTS, written down because each one
-- has a consequence that is not obvious from "let them edit it":
--
--   code       is_new MEANS "this code is not in Material Codes". It is set
--              from the page when an item is booked in, so changing the code
--              and leaving is_new alone would make it a lie - an item
--              renamed to a known code would sit on the New materials
--              worklist for ever, and one renamed to an unknown code would
--              vanish from it. So is_new is recomputed from materials
--              whenever the code is sent, by the same rule the page uses.
--              An item with no code at all is not a new material code; it is
--              an uncategorised item, and is_new is false.
--
--   project    Clearable, deliberately. A local purchase belongs to no
--              project, and the page has to be able to say so.
--
--   drum_name  Renameable, NOT erasable. wh_items has a unique index on
--              lower(drum_name), so a rename can collide - that used to
--              surface as a bare Postgres unique-violation, and now it names
--              the item already holding the name. Blanking it is refused:
--              drum_lower, drum_upper and drum_cur would stay behind and the
--              row would be a drum with no name rather than not a drum. To
--              un-drum something, delete the line and book it in again.
--              A non-drum item whose form posts an empty drum_name is not an
--              error and does nothing, so the edit form can send every field
--              back without a special case.
--
--              Renaming a drum DOES change what an already-printed note
--              shows, because the note draws the drum's name from the item
--              rather than storing it. That is the point - the name is being
--              corrected - but it is worth knowing that OBN-26-0004 will
--              read differently afterwards.

create or replace function wh_update_item(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare i wh_items; iid bigint := (p->>'id')::bigint; touches_stock boolean; holder text;
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  select * into i from wh_items where id = iid for update;
  if not found then raise exception 'There is no item %.', coalesce(iid::text,'(none)'); end if;

  /* words about the thing: always allowed */
  update wh_items set
    name = coalesce(nullif(p->>'name',''), name),
    cat  = coalesce(p->>'cat',  cat),
    uom  = coalesce(nullif(p->>'uom',''), uom),
    bin  = coalesce(p->>'bin',  bin),
    sn   = coalesce(p->>'sn',   sn),
    cond = coalesce(nullif(p->>'cond',''), cond),
    code    = case when p ? 'code'    then nullif(p->>'code','')    else code end,
    project = case when p ? 'project' then nullif(p->>'project','') else project end
  where id = iid;

  /* is_new is a fact about the code, so it follows the code */
  if p ? 'code' then
    update wh_items set is_new = (code is not null
      and not exists (select 1 from materials m where m.code = wh_items.code))
     where id = iid;
  end if;

  /* a drum may be renamed, not un-named */
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

  /* ---- from here down this is 052, unchanged ---- */
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

  /* an uncut drum reads at its upper mark, and its quantity is the span */
  update wh_items
     set drum_cur = drum_upper,
         qty = drum_upper - drum_lower
   where id = iid and drum_name is not null;
  /* a loose cable piece measures what its two readings say */
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
