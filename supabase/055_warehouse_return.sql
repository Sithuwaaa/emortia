-- 055_warehouse_return.sql  ·  material coming back from a site
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Needs 054.
--
-- WHY NOW. Nothing is out at the moment. Build the return path before the
-- first out-and-back cycle and there is never any cleanup; build it after
-- and every row that went out the wrong way has to be found and unpicked
-- by hand.
--
-- WHY IT IS A NOTE AND NOT A TABLE. A return is the same kind of event as
-- every other movement: a dated piece of paper with lines on it. Making it
-- kind 'RTN' means it numbers itself through wh_next, prints through the
-- note printer, deletes-and-undoes through wh_delete_note, and shows up in
-- an item's history through wh_lines - all machinery that already exists
-- and is already tested. A separate table would have needed its own copy
-- of every one of those.
--
-- IT POINTS AT THE NOTE IT REVERSES. wh_notes.reverses names the OBN, so
-- the link is made by returning FROM that note rather than by matching a
-- serial afterwards. Nothing is guessed.
--
-- THE THREE CASES, AND WHY THEY DIFFER
--
--   THE WHOLE THING BACK -> THE ORIGINAL ROW IS FLIPPED. Not a new row.
--   This is the bug that made this migration necessary: wh_inbound is
--   insert-only, so booking a return in as an SRN created a SECOND row for
--   one physical unit and left the first one 'out' for ever. One unit is
--   one row for its whole life.
--
--   PART OF IT BACK -> THE ROW SPLITS. Ten went out, four come back: the
--   original keeps six and stays out on that OBN, a new row holds the four
--   that are in. Both remain traceable to the OBN - the six by out_note,
--   the four through this RTN's reverses and the return line's
--   returns_line pointer.
--
--   CABLE CANNOT BE UN-CUT. 232 m went out and 40 m comes back. That 40 m
--   is a loose piece; the drum is physically shorter for ever and is NOT
--   touched. This is exactly where a return differs from deleting a note:
--   deleting gives the metres back because the cut never happened, and a
--   real return cannot, because it did. The offcut books in as its own
--   Cable item with no drum name.
--
-- HOW MUCH IS STILL OUT ON A LINE is computed, never stored twice:
-- the outbound line's qty minus everything returned against it, through
-- wh_lines.returns_line. That works for all three cases, including after a
-- split, where the returned material is a different row with a different
-- id. The outbound line itself is history and is never edited.
--
-- in_note IS NOT REWRITTEN BY A RETURN. It records the note a unit was
-- first booked in on, which a return does not change. The return shows in
-- the item's history as an RTN line against it. Only material that never
-- existed here before - a cable offcut - gets in_note set to the RTN.
--
-- THE SIDE DOOR IS CLOSED AT THE SAME TIME. A serial typed into an SRN row
-- that belongs to something currently out is refused and told which note
-- to return it on. SRN keeps its real meaning: material that never left
-- this warehouse - dismantled by others, REDEP, a site this warehouse
-- never issued to. Without this, the old wrong path stays open beside the
-- new right one and both get used.
--
-- GRN IS DELIBERATELY NOT GUARDED THE SAME WAY. A delivery genuinely can
-- carry a serial that was misread off a worn plate somewhere else, and the
-- page already warns on a duplicate without blocking it. SRN is different
-- because an SRN for something that is out is always the wrong note.

-- --------------------------------------------------------------- schema
alter table wh_notes drop constraint if exists wh_notes_kind_check;
alter table wh_notes add  constraint wh_notes_kind_check
  check (kind in ('GRN','SRN','OBN','RTN'));

alter table wh_notes add column if not exists reverses text references wh_notes(id);
alter table wh_lines add column if not exists returns_line bigint references wh_lines(id);
create index if not exists wh_lines_returns on wh_lines (returns_line);

insert into wh_counters(kind,n) values ('RTN',0) on conflict do nothing;

-- ------------------------------------------- the side door, as a helper
-- A helper and not an inline block, because wh_inbound is rewritten by
-- more than one migration and the check has to survive whichever version
-- of it ends up last. wh-inbound-guard.test.js asserts that the last
-- definition in supabase/ still calls this.
create or replace function wh_assert_returnable(p_sn text) returns void
language plpgsql security definer set search_path = public as $$
declare o text;
begin
  if coalesce(p_sn,'') = '' or p_sn like 'DMY-%' then return; end if;
  select out_note into o from wh_items
   where lower(sn) = lower(p_sn) and status = 'out' limit 1;
  if o is not null then
    raise exception 'Serial % is still out on %. Return it there - a site return is for material that never left this warehouse.', p_sn, o;
  end if;
end $$;

-- ------------------------------------------------------------ the return
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
      /* a piece cut off a drum: the drum stays short, this is new stock */
      insert into wh_items(code,name,cat,uom,qty,bin,project,status,source,
                           in_note,in_date,from_site,from_site_name,cond,is_new)
      values (rec.code, rec.name, rec.cat, 'M', want, nullif(it->>'bin',''), rec.project, 'in', 'return',
              nid, d, n.site_id, n.site_name,
              coalesce(nullif(it->>'cond',''),'Good'), false)
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
      insert into wh_items(code,name,cat,uom,qty,bin,project,status,source,
                           in_note,in_date,from_site,from_site_name,cond,is_new)
      values (rec.code, rec.name, rec.cat, rec.uom, want, nullif(it->>'bin',''), rec.project, 'in', rec.source,
              rec.in_note, d, n.site_id, n.site_name,
              coalesce(nullif(it->>'cond',''),'Good'), false)
      returning id into newid;
      tgt := newid;
    end if;

    insert into wh_lines(note_id,item_id,line_no,qty,remarks,returns_line)
    values (nid, tgt, ln, want, nullif(it->>'remarks',''), rec.lid);
  end loop;

  return nid;
end $$;

-- ------------------------------- an outbound note with returns is locked
-- Undoing an issue that has already been partly answered would leave the
-- return pointing at a line that no longer exists. The return comes off
-- first, which is also the order the paper went.
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
    'restored', restored, 'drums', freed, 'removed', removed, 'sent_back', back);
end $$;

-- --------------------------------- wh_inbound, with the side door closed
-- Rewritten from 048 with one addition: every SRN row's serial is checked
-- against what is currently out. Everything else is unchanged.
create or replace function wh_inbound(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  k text := p->>'kind'; nid text; it jsonb; ln int := 0; iid bigint; q numeric;
  d date := coalesce(nullif(p->>'date','')::date, current_date);
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  if k not in ('GRN','SRN') then raise exception 'kind must be GRN or SRN'; end if;
  if k = 'SRN' and coalesce(p->>'site_id','') = '' then raise exception 'A site return needs the site ID it came from.'; end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one material.'; end if;
  nid := wh_next(k);
  insert into wh_notes(id,kind,note_date,project,reservation_no,ref,site_id,site_name,removed_on,by_name)
  values (nid, k, d, nullif(p->>'project',''),
          case when k = 'GRN' then nullif(p->>'reservation_no','') end,
          nullif(p->>'ref',''), nullif(upper(p->>'site_id'),''), nullif(p->>'site_name',''),
          nullif(p->>'removed_on','')::date, nullif(p->>'by',''));
  for it in select * from jsonb_array_elements(p->'items') loop
    ln := ln + 1;
    /* THE SIDE DOOR. An SRN for something that is still out is always
       the wrong note, so it is refused and told where to go instead.
       Added by 055; everything else in this function is 048 verbatim. */
    if k = 'SRN' then perform wh_assert_returnable(nullif(it->>'sn','')); end if;
    if nullif(it->>'drum_name','') is not null then
      if (it->>'drum_upper')::numeric <= (it->>'drum_lower')::numeric then
        raise exception 'Drum %: the upper reading must be above the lower.', it->>'drum_name'; end if;
      q := (it->>'drum_upper')::numeric - (it->>'drum_lower')::numeric;
    elsif it->>'read_start' is not null then
      q := abs((it->>'read_end')::numeric - (it->>'read_start')::numeric);
    else
      q := coalesce(nullif(it->>'qty','')::numeric, 1);
    end if;
    insert into wh_items(code,name,cat,uom,qty,sn,bin,project,status,source,cond,in_note,in_date,
                         from_site,from_site_name,reservation_no,drum_name,drum_lower,drum_upper,drum_cur,
                         read_start,read_end,is_new)
    values (nullif(it->>'code',''), it->>'name', nullif(it->>'cat',''), coalesce(nullif(it->>'uom',''),'EA'), q,
            nullif(it->>'sn',''), coalesce(nullif(it->>'bin',''), nullif(p->>'bin','')), nullif(p->>'project',''),
            'in', case when k = 'SRN' then 'return' else 'new' end,
            case when k = 'SRN' then coalesce(nullif(it->>'cond',''),'Good') end,
            nid, d, nullif(upper(p->>'site_id'),''), nullif(p->>'site_name',''),
            case when k = 'GRN' then nullif(p->>'reservation_no','') end,
            nullif(it->>'drum_name',''), (it->>'drum_lower')::numeric, (it->>'drum_upper')::numeric, (it->>'drum_upper')::numeric,
            (it->>'read_start')::numeric, (it->>'read_end')::numeric,
            coalesce((it->>'is_new')::boolean, false))
    returning id into iid;
    insert into wh_lines(note_id,item_id,line_no,qty) values (nid, iid, ln, q);
  end loop;
  return nid;
end $$;

revoke all on function wh_return(jsonb), wh_assert_returnable(text), wh_delete_note(text), wh_inbound(jsonb) from public, anon;
grant execute on function wh_return(jsonb), wh_assert_returnable(text), wh_delete_note(text), wh_inbound(jsonb) to authenticated;
