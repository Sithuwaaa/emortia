-- 060_warehouse_inbound_remarks.sql  ·  a remark typed in is a remark kept
--
-- Run once in Supabase → SQL Editor. Safe to re-run. Needs 059.
--
-- wh_lines has had a remarks column since 048 and wh_outbound has always
-- written to it. wh_inbound never did: it inserted note_id, item_id,
-- line_no and qty and stopped. So a remark typed on a delivery or a site
-- return went into the payload, was accepted by jsonb without a murmur,
-- and was dropped.
--
-- Adding the column to the grid alone would have fixed outbound and left
-- inbound silently discarding every word of it - worse than not offering
-- the box at all, because the typist would have had every reason to
-- believe it had been kept.
--
-- WH-PAYLOAD.TEST.JS COULD NOT HAVE CAUGHT THIS, AND IT IS WORTH SAYING
-- WHY. remarks IS read by the function - on the outbound side - so
-- nothing was ever sent with nowhere to land. That guard checks a key is
-- read somewhere in the function it is sent to, not that it is read on
-- the branch the payload actually takes. A key read on one path and
-- ignored on another is invisible to it.

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
    insert into wh_lines(note_id,item_id,line_no,qty,remarks)
    values (nid, iid, ln, q, nullif(it->>'remarks',''));
  end loop;
  return nid;
end $$;

revoke all on function wh_inbound(jsonb) from public, anon;
grant execute on function wh_inbound(jsonb) to authenticated;
