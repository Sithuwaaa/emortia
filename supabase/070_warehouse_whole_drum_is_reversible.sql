-- 070_warehouse_whole_drum_is_reversible.sql
--     ·  a drum cannot be in stock and at a site at the same time
--
-- Run once in Supabase - SQL Editor. Safe to re-run. Needs 069.
--
-- TWO FAULTS IN ONE BRANCH, and 068 and 069 do not touch either.
--
-- wh_delete_note and wh_delete_line both restore a drum's metres when
-- an outbound line is removed, which is right for a CUT. The branch
-- was reached by "is this item a drum", not "was this line a cut" - so
-- a whole-drum issue went through it too. A whole-drum issue never
-- moved the readings; it set status='out'. The restore therefore added
-- metres to a range that had never been reduced, and nothing cleared
-- the status. One drum is in that state now: original 65-565, live
-- 65-565, 500 m, status 'out' - fully in stock and fully issued at
-- once, with 140 m of it physically on a site.
--
-- A whole-drum line has no cut_from, so it now falls to the branch
-- that was always right for it: clear status, out_note and out_date.
-- That branch also refuses a line that has since moved to another
-- note, which a whole-drum issue should answer to as much as anything
-- else does.
--
-- AND THE RESTORE GUARD WAS ASKING THE SMALLER QUESTION. It compared
-- the range against what came in, which cannot see a drum that is at
-- full span and still out. The span a drum is allowed is what came in
-- LESS everything still outstanding against it on other notes:
--
--     orig_span - sum(outstanding OBN qty) = live_span
--
-- That is the invariant, it is -140 on that drum today, and it is now
-- checked before any restore. tools/_lib/wh-drum-balance.js checks it
-- over every drum against the live database.
--
-- BOTH FUNCTIONS, because 069 made wh_delete_line the road a reconcile
-- takes to the same arithmetic. Fixing only the delete path would have
-- left the second caller wrong.
--
-- The bodies below are the live definitions verbatim - both as
-- 057_warehouse_cable_either_end left them - plus the changes above.

create or replace function wh_delete_note(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n wh_notes; rec record; freed int := 0; removed int := 0; restored int := 0; back int := 0; blocker text;
  owed numeric;   -- 070
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
      elsif rec.drum_name is not null and rec.cut_from is not null then
        /* 057: give the metres back to the END THEY CAME OFF. Before
           this they always went back on top, which restored the wrong
           end of any drum cut from the low end.

           070: AND ONLY A CUT LINE GETS ITS METRES BACK. This branch
           used to catch every line whose item was a drum, including a
           whole-drum issue - which never moved the readings, it moved
           the status. So deleting such a note added metres to a range
           that had never been reduced AND left status='out' behind,
           and the drum ended up fully in stock and fully issued at
           once. A whole-drum line has no cut_from, so it falls to the
           status branch below, where it belongs. */
        /* 070: AND NOT PAST WHAT THE OTHER NOTES STILL OWE. The test
           above only asks whether the range would exceed what came
           in. That is not the whole question: a drum can be at its
           original span and still be out, because a whole-drum issue
           moves status and leaves the readings alone. Restoring a cut
           onto such a drum takes it past full while 140 m of it is on
           a site. The span a drum is allowed is what came in less
           everything still outstanding against it elsewhere. */
        select coalesce(sum(l2.qty - coalesce(
                 (select sum(r2.qty) from wh_lines r2 where r2.returns_line = l2.id), 0)), 0)
          into owed
          from wh_lines l2 join wh_notes n2 on n2.id = l2.note_id
         where l2.item_id = rec.iid and n2.kind = 'OBN' and l2.id <> rec.id;
        if (rec.drum_upper - rec.drum_lower) + rec.qty
             > (rec.orig_upper - rec.orig_lower) - owed then
          raise exception 'Drum % cannot take % m back: it came in with % m and % m of it is still out on other notes.',
            rec.drum_name, rec.qty, rec.orig_upper - rec.orig_lower, owed;
        end if;
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
declare n wh_notes; rec record; total int; what text; p_note text; owed numeric;   -- 070
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
    elsif rec.drum_name is not null and rec.cut_from is not null then
      /* 057: back onto the end it came off, same rule as the whole note.
         070: and only a CUT line - a whole-drum issue never moved the
         readings, so it falls through to the status branch. This is
         the same fix as in wh_delete_note and it matters twice over
         now, because 069's reconcile removes lines through here. */
      /* 070: AND NOT PAST WHAT THE OTHER NOTES STILL OWE. The test
         above only asks whether the range would exceed what came
         in. That is not the whole question: a drum can be at its
         original span and still be out, because a whole-drum issue
         moves status and leaves the readings alone. Restoring a cut
         onto such a drum takes it past full while 140 m of it is on
         a site. The span a drum is allowed is what came in less
         everything still outstanding against it elsewhere. */
      select coalesce(sum(l2.qty - coalesce(
               (select sum(r2.qty) from wh_lines r2 where r2.returns_line = l2.id), 0)), 0)
        into owed
        from wh_lines l2 join wh_notes n2 on n2.id = l2.note_id
       where l2.item_id = rec.iid and n2.kind = 'OBN' and l2.id <> rec.id;
      if (rec.drum_upper - rec.drum_lower) + rec.qty
           > (rec.orig_upper - rec.orig_lower) - owed then
        raise exception 'Drum % cannot take % m back: it came in with % m and % m of it is still out on other notes.',
          rec.drum_name, rec.qty, rec.orig_upper - rec.orig_lower, owed;
      end if;
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

revoke all on function wh_delete_note(text) from public, anon;
grant execute on function wh_delete_note(text) to authenticated;
revoke all on function wh_delete_line(bigint) from public, anon;
grant execute on function wh_delete_line(bigint) to authenticated;
