-- 050_warehouse_delete_edit.sql  ·  Tooway Warehouse: delete and edit
--
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- WHY A FUNCTION AND NOT A DELETE. A note is not a record of itself, it is
-- the reason the stock moved. Deleting an outbound row and leaving the items
-- marked 'out' would leave the warehouse saying things are at a site that
-- were never sent. So deleting a note UNDOES it, and the undo and the delete
-- happen in one transaction or neither happens.
--
-- The database already refuses the naive version: wh_items.in_note and
-- .out_note are foreign keys to wh_notes(id) with no cascade, so a bare
-- delete raises a violation rather than silently orphaning anything. That is
-- the floor this builds on, not a thing to work around.
--
-- WHAT EACH UNDO MEANS
--   OBN  every item it sent comes back into stock; every drum cut is given
--        back; anything created BY the note (a direct issue, never received)
--        goes with the note, because it only ever existed as part of it.
--   GRN  the items it booked in are removed - but only if they are all still
--        here and untouched. One of them already issued, or a drum already
--        cut, and the whole delete is refused by name.
--   SRN  the same as GRN.
--
-- WHAT IT REFUSES, AND WHY IT SAYS WHICH
--   An undo that cannot be completed must not be half done. Each check names
--   the item and the note that blocks it, so the answer to "why can't I" is
--   on screen rather than in a log.
--
-- THE NUMBER IS NOT GIVEN BACK. wh_counters is untouched: OBN-26-1117 is
-- spent whether or not the note survives, exactly as a spoiled page in a
-- paper book is not re-used. Two notes with one number is the failure this
-- avoids, and a gap in the numbers is not a failure at all.
--
-- WHO. Deleting is is_owner(). Editing is may_read('tool:warehouse'), the
-- same as filing, because correcting a driver's name is not a destructive
-- act and the person who typed it is the person who should fix it.

-- ------------------------------------------------------------ delete a note
/* The loop variable is rec, not L. It was L, and these queries alias
   wh_lines as l - plpgsql folds identifiers to lower case, so l.* and
   l.note_id resolved to the declared variable rather than the alias, and
   every delete died with: record "l" is not assigned yet. The variable is
   renamed rather than the alias, because l for wh_lines reads naturally in
   the SQL and the next person would write it again. */
create or replace function wh_delete_note(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n wh_notes; rec record; freed int := 0; removed int := 0; restored int := 0;
begin
  if not is_owner() then raise exception 'Only the owner can delete a note.'; end if;
  select * into n from wh_notes where id = p_id for update;
  if not found then raise exception 'There is no note %.', p_id; end if;

  if n.kind = 'OBN' then
    /* give everything back, newest line first so a drum cut twice on one
       note unwinds in the order it was cut */
    for rec in select l.*, i.id as iid, i.sn, i.name, i.source, i.out_note,
                    i.drum_name, i.drum_cur, i.drum_lower, i.drum_upper
             from wh_lines l join wh_items i on i.id = l.item_id
             where l.note_id = p_id order by l.line_no desc loop
      if rec.source = 'direct' and rec.out_note = p_id then
        delete from wh_lines where item_id = rec.iid;
        delete from wh_items where id = rec.iid;
        removed := removed + 1;
      elsif rec.drum_name is not null then
        if rec.drum_cur + rec.qty > rec.drum_upper then
          raise exception 'Drum % cannot take % m back: it reads % and the drum ends at %. Undo the later cut first.',
            rec.drum_name, rec.qty, rec.drum_cur, rec.drum_upper;
        end if;
        update wh_items set drum_cur = drum_cur + rec.qty,
                            qty = drum_cur + rec.qty - drum_lower
         where id = rec.iid;
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
      if rec.drum_name is not null and rec.drum_cur is distinct from rec.drum_upper then
        raise exception 'Drum % has been cut - it reads % and came in at %. Undo the cut first.',
          rec.drum_name, rec.drum_cur, rec.drum_upper;
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
    'restored', restored, 'drums', freed, 'removed', removed);
end $$;

-- ------------------------------------------------------------ delete an item
-- One thing, on its own - a row typed twice, a dummy that should not be
-- there. Only while it is still here and nothing has happened to it.
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
  if i.drum_name is not null and i.drum_cur is distinct from i.drum_upper then
    raise exception 'Drum % has been cut - it reads % and came in at %.', i.drum_name, i.drum_cur, i.drum_upper;
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

-- ------------------------------------------------------------ edit a note
-- The words on a note, never its stock. Nothing here can move an item, which
-- is why it is may_read and not is_owner: a mistyped driver's name is for
-- whoever typed it to fix.
create or replace function wh_update_note(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare nid text := p->>'id';
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  if nid is null or not exists (select 1 from wh_notes where id = nid) then
    raise exception 'There is no note %.', coalesce(nid, '(none)'); end if;
  update wh_notes set
    note_date    = coalesce(nullif(p->>'note_date','')::date, note_date),
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

revoke all on function wh_delete_note(text), wh_delete_item(bigint), wh_update_note(jsonb) from public, anon;
grant execute on function wh_delete_note(text), wh_delete_item(bigint), wh_update_note(jsonb) to authenticated;
