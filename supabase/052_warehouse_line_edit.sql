-- 052_warehouse_line_edit.sql  ·  Tooway Warehouse: one line, one item
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Needs 050.
--
-- 050 deletes a whole note and undoes everything on it. That is the wrong
-- size of tool when one row of five is wrong. These two are the small ones:
--
--   wh_delete_line   take ONE line off a note, undoing just that line
--                    (by wh_lines.id - the one thing that identifies a line)
--   wh_update_item   correct ONE item's details
--
-- THE UNDO IS THE SAME UNDO. A line removed from an outbound note puts that
-- item back exactly as deleting the whole note would - status, drum reading,
-- a direct issue removed with it. There is one rule for what a line means,
-- not one for notes and a looser one for lines.
--
-- THE LAST LINE IS REFUSED. A note with no lines is not a note, it is a
-- number with a date on it. Taking the last one off asks you to delete the
-- note instead, which is the thing you actually meant.
--
-- LINE NUMBERS ARE NOT CLOSED UP. Line 2 of four goes and the rest stay 1,
-- 3, 4. The printed note numbers its rows as it draws them, so nothing on
-- paper has a gap; renumbering the stored rows would rewrite history to
-- make a display tidier.
--
-- WHAT wh_update_item WILL AND WILL NOT CHANGE
--   Always: name, category, unit, bin, serial, condition. Words about a
--   thing, which is what a correction usually is - a dummy SN replaced with
--   the real one, a name typed wrong.
--   Only while it is still here and has never gone out: quantity and drum
--   readings. Those ARE the stock. Changing the quantity of something that
--   has already been issued would make the note that issued it a lie, and
--   the note is the record. It refuses by name and says where it went.

-- ------------------------------------------------------- one line off a note
create or replace function wh_delete_line(p_line_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n wh_notes; L record; total int; what text; p_note text;
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
         i.drum_name, i.drum_cur, i.drum_lower, i.drum_upper
    into L
    from wh_lines l join wh_items i on i.id = l.item_id
   where l.id = p_line_id;
  if not found then raise exception 'There is no line %.', p_line_id; end if;
  what := coalesce(L.sn, L.name);

  if n.kind = 'OBN' then
    if L.source = 'direct' and L.out_note = p_note then
      delete from wh_lines where id = L.id;
      delete from wh_items where id = L.iid;
    elsif L.drum_name is not null then
      if L.drum_cur + L.qty > L.drum_upper then
        raise exception 'Drum % cannot take % m back: it reads % and ends at %. Undo the later cut first.',
          L.drum_name, L.qty, L.drum_cur, L.drum_upper;
      end if;
      update wh_items set drum_cur = drum_cur + L.qty, qty = drum_cur + L.qty - drum_lower
       where id = L.iid;
      delete from wh_lines where id = L.id;
    else
      if L.out_note is distinct from p_note then
        raise exception '% is not on this note any more - it went out on %.', what, coalesce(L.out_note, 'another note');
      end if;
      update wh_items set status = 'in', out_note = null, out_date = null,
                          site_id = null, site_name = null, party = null
       where id = L.iid;
      delete from wh_lines where id = L.id;
    end if;
  else
    if L.in_note is distinct from p_note then
      raise exception '% was not booked in on this note.', what;
    end if;
    if L.status = 'out' then
      raise exception '% has already gone out on %. Delete that note first.', what, coalesce(L.out_note, 'an outbound note');
    end if;
    if L.drum_name is not null and L.drum_cur is distinct from L.drum_upper then
      raise exception 'Drum % has been cut - it reads % and came in at %. Undo the cut first.',
        L.drum_name, L.drum_cur, L.drum_upper;
    end if;
    delete from wh_lines where item_id = L.iid;
    delete from wh_items where id = L.iid;
  end if;

  return jsonb_build_object('note', p_note, 'line', p_line_id, 'what', what);
end $$;

-- -------------------------------------------------------- correct one item
create or replace function wh_update_item(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare i wh_items; iid bigint := (p->>'id')::bigint; touches_stock boolean;
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
    cond = coalesce(nullif(p->>'cond',''), cond)
  where id = iid;

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

revoke all on function wh_delete_line(bigint), wh_update_item(jsonb) from public, anon;
grant execute on function wh_delete_line(bigint), wh_update_item(jsonb) to authenticated;
