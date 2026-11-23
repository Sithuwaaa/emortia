-- 061_warehouse_row_level_site_reservation.sql  ·  per row, not per note
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Needs 060.
--
-- Many items arrive on the same day, for different sites, against
-- different reservations. His own All Collected tab has been row-level
-- on both for 1,261 rows; the tool was the only thing insisting a note
-- had one of each.
--
-- NO NEW COLUMNS. wh_items.reservation_no, from_site and from_site_name
-- have been per item since 048. wh_inbound simply copied the note-level
-- value onto every row. It now reads the row first and falls back to the
-- note when the row leaves it blank, so a note with one reservation
-- still behaves exactly as it did.
--
-- The note-level reservation stays GRN-only, as it was. A row-level one
-- is taken on any kind, because if he has written a reservation against
-- a returned item there is no reason to throw it away.
--
-- THE SITE-RETURN GUARD MOVES WITH IT. An SRN still has to say where
-- the material came from, so the check is now per row - row or note,
-- either will do - and it names the row number when it refuses.

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
                         read_start,read_end,is_new,pack,from_wh,vendor)
    values (nullif(it->>'code',''), it->>'name', nullif(it->>'cat',''), coalesce(nullif(it->>'uom',''),'EA'), q,
            nullif(it->>'sn',''), coalesce(nullif(it->>'bin',''), nullif(p->>'bin','')), nullif(p->>'project',''),
            'in', case when rdp then 'redep' when k = 'SRN' then 'return'
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
            src, vnd)
    returning id into iid;
    insert into wh_lines(note_id,item_id,line_no,qty,remarks)
    values (nid, iid, ln, q, nullif(it->>'remarks',''));
  end loop;
  return nid;
end $$;

revoke all on function wh_inbound(jsonb) from public, anon;
grant execute on function wh_inbound(jsonb) to authenticated;
