-- 048_tooway_warehouse.sql  ·  Tooway Warehouse (replaces Austin SWAP in the Tools list)
--
-- Run once in Supabase → SQL Editor. Safe to re-run (everything is "if not exists"
-- or "or replace"). It does NOT touch swap_records or anything Austin SWAP filed.
--
-- Shape
--   wh_notes      one row per note: GRN (inbound new stock), SRN (inbound site
--                 return), OBN (outbound to a site or a 3rd party)
--   wh_items      one row per physical thing: a serialised unit, a bulk line,
--                 a cable drum (drum_*), or a loose cable piece (read_*).
--                 status 'in' = in the warehouse, 'out' = issued.
--                 source 'new' | 'return' | 'direct' (issued without ever being
--                 received - local purchase etc.)
--   wh_lines      which items are on which note, in printed order; for a drum
--                 cut or a cable piece cut_to → cut_from are the two readings
--   wh_materials  per material code: pinned to the Overview, minimum qty
--   wh_parties    3rd parties (Fame, DAR, Browns, … grows as you type new ones)
--   wh_projects   project list
--   wh_counters   note / dummy-SN numbering, only touched by wh_next()
--
-- Who: reading and saving need may_read('tool:warehouse') (feature_locks,
-- tier starts at 'mine' = owner only; open it to Tooway later from the Owner
-- page like the other tools). Deleting anything is owner only.

-- ---------------------------------------------------------------- tables
create table if not exists wh_counters(kind text primary key, n integer not null default 0);
-- OBN starts after 1116 so the first printed note continues the paper book
-- (last paper note seen: 1116). Change 1116 before running if that is wrong.
insert into wh_counters(kind,n) values ('GRN',0),('SRN',0),('OBN',1116),('DMY',0)
  on conflict (kind) do nothing;

create table if not exists wh_notes(
  id            text primary key,                       -- GRN-26-0001 / SRN-26-0001 / OBN-26-1117
  kind          text not null check (kind in ('GRN','SRN','OBN')),
  note_date     date not null default current_date,
  project       text,
  reservation_no text,                                  -- GRN only
  ref           text,                                   -- supplier DN / PO, or the paper return note no
  site_id       text, site_name text,                   -- SRN: where it came from · OBN to site: where it went
  removed_on    date,                                   -- SRN, optional
  dest          text check (dest in ('site','party')),  -- OBN
  party text, purpose text, party_ref text,             -- OBN to a 3rd party
  by_name text, requested_by text, receiver text, vehicle text, driver text, contact text, issued_by text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

create table if not exists wh_items(
  id             bigint generated always as identity primary key,
  code           text,                                  -- Material Codes code; null for a local purchase with no code
  name           text not null,
  cat            text,                                  -- short category: RRU, AAU, Fibers, Power …
  uom            text not null default 'EA',
  qty            numeric not null default 1,            -- drums: what is left on the drum
  sn             text,                                  -- DMY-26-0001 style = dummy, to be corrected
  bin            text,                                  -- A-01-01, RB-01, DY-01 …
  project        text,
  status         text not null default 'in' check (status in ('in','out')),
  source         text not null default 'new' check (source in ('new','return','direct')),
  cond           text check (cond in ('Good','Faulty','Scrap')),
  in_note        text references wh_notes(id),
  in_date        date,
  from_site text, from_site_name text,
  reservation_no text,
  out_note       text references wh_notes(id),
  out_date       date,
  site_id text, site_name text, party text,
  drum_name      text,
  drum_lower     numeric, drum_upper numeric, drum_cur numeric,   -- cuts come off the outer end: drum_cur counts down
  read_start     numeric, read_end numeric,                       -- a loose cable piece
  is_new         boolean not null default false,                  -- code not in Material Codes when it arrived
  updated_at     timestamptz not null default now()
);
create unique index if not exists wh_items_drum_name on wh_items (lower(drum_name)) where drum_name is not null;
create index if not exists wh_items_code   on wh_items (code);
create index if not exists wh_items_sn     on wh_items (sn);
create index if not exists wh_items_status on wh_items (status);

create table if not exists wh_lines(
  id        bigint generated always as identity primary key,
  note_id   text   not null references wh_notes(id) on delete cascade,
  item_id   bigint not null references wh_items(id),
  line_no   int    not null,
  qty       numeric not null,
  cut_from  numeric, cut_to numeric,
  remarks   text
);
create index if not exists wh_lines_note on wh_lines (note_id);
create index if not exists wh_lines_item on wh_lines (item_id);

create table if not exists wh_materials(
  code text primary key, pinned boolean not null default false, min_qty numeric,
  updated_at timestamptz not null default now());
create table if not exists wh_parties(name text primary key);
create table if not exists wh_projects(name text primary key);
insert into wh_parties(name) values ('Fame'),('DAR'),('Browns') on conflict do nothing;
-- Starting project list; more are added from the page with "+ New project…".
insert into wh_projects(name) values ('Austin'),('Dankotuwa MBB/HBB'),('Lamp Pole') on conflict do nothing;

create or replace function wh_touch() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists wh_items_touch on wh_items;
create trigger wh_items_touch before update on wh_items for each row execute function wh_touch();
drop trigger if exists wh_materials_touch on wh_materials;
create trigger wh_materials_touch before update on wh_materials for each row execute function wh_touch();

-- ---------------------------------------------------------------- the gate
insert into feature_locks(feature, tier) values ('tool:warehouse','mine')  -- unlocked is GENERATED ALWAYS AS (tier <> 'mine')
  on conflict (feature) do nothing;

alter table wh_counters  enable row level security;   -- no policies: only wh_next() touches it
alter table wh_notes     enable row level security;
alter table wh_items     enable row level security;
alter table wh_lines     enable row level security;
alter table wh_materials enable row level security;
alter table wh_parties   enable row level security;
alter table wh_projects  enable row level security;

do $$ declare t text; begin
  foreach t in array array['wh_notes','wh_items','wh_lines','wh_materials','wh_parties','wh_projects'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select using (may_read(''tool:warehouse''))', t);
    execute format('drop policy if exists %1$s_delete on %1$s', t);
    execute format('create policy %1$s_delete on %1$s for delete using (is_owner())', t);
  end loop;
end $$;
-- Edits the page makes directly (everything else goes through the functions below):
--   wh_items: correct a dummy SN, rename a new material
--   wh_materials: pin / minimum   ·   wh_projects, wh_parties: add one
drop policy if exists wh_items_update on wh_items;
create policy wh_items_update on wh_items for update using (may_read('tool:warehouse')) with check (may_read('tool:warehouse'));
drop policy if exists wh_materials_write on wh_materials;
create policy wh_materials_write on wh_materials for insert with check (may_read('tool:warehouse'));
drop policy if exists wh_materials_update on wh_materials;
create policy wh_materials_update on wh_materials for update using (may_read('tool:warehouse')) with check (may_read('tool:warehouse'));
drop policy if exists wh_projects_insert on wh_projects;
create policy wh_projects_insert on wh_projects for insert with check (may_read('tool:warehouse'));
drop policy if exists wh_parties_insert on wh_parties;
create policy wh_parties_insert on wh_parties for insert with check (may_read('tool:warehouse'));

-- ---------------------------------------------------------------- numbering
create or replace function wh_next(k text) returns text
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  update wh_counters set n = n + 1 where kind = k returning n into v;
  if v is null then raise exception 'unknown counter %', k; end if;
  return case when k = 'OBN' then k || '-' || to_char(current_date,'YY') || '-' || v
              else k || '-' || to_char(current_date,'YY') || '-' || lpad(v::text, 4, '0') end;
end $$;

-- ---------------------------------------------------------------- inbound
-- p = {kind:'GRN'|'SRN', date, project, reservation_no, ref, site_id, site_name,
--      removed_on, by, bin, items:[{code,name,cat,uom,qty,sn,bin,cond,is_new,
--      drum_name,drum_lower,drum_upper, read_start,read_end}]}
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

-- ---------------------------------------------------------------- outbound
-- p = {date, project, dest:'site'|'party', site_id, site_name, party, purpose, party_ref,
--      requested_by, receiver, vehicle, driver, contact, issued_by,
--      items:[ {item_id, cut, remarks}                       -- from stock (cut = metres, drums only)
--            | {code,name,cat,uom,qty,sn,is_new,read_start,read_end,remarks} ]}   -- direct issue
create or replace function wh_outbound(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  nid text; it jsonb; ln int := 0; L wh_items; len numeric; iid bigint; q numeric;
  dst text := coalesce(nullif(p->>'dest',''),'site');
  d date := coalesce(nullif(p->>'date','')::date, current_date);
  sid text := nullif(upper(p->>'site_id'),''); prt text := nullif(trim(p->>'party'),'');
begin
  if not may_read('tool:warehouse') then raise exception 'not allowed'; end if;
  if dst = 'site'  and sid is null then raise exception 'Type the site ID first.'; end if;
  if dst = 'party' and prt is null then raise exception 'Type the 3rd party company.'; end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one item.'; end if;
  nid := wh_next('OBN');
  insert into wh_notes(id,kind,note_date,project,site_id,site_name,dest,party,purpose,party_ref,
                       requested_by,receiver,vehicle,driver,contact,issued_by)
  values (nid,'OBN',d,nullif(p->>'project',''),
          case when dst='site' then sid end, case when dst='site' then nullif(p->>'site_name','') end,
          dst, case when dst='party' then prt end, case when dst='party' then nullif(p->>'purpose','') end,
          case when dst='party' then nullif(p->>'party_ref','') end,
          nullif(p->>'requested_by',''), nullif(p->>'receiver',''), nullif(p->>'vehicle',''),
          nullif(p->>'driver',''), nullif(p->>'contact',''), nullif(p->>'issued_by',''));
  if dst = 'party' then insert into wh_parties(name) values (prt) on conflict do nothing; end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    ln := ln + 1;
    if it->>'item_id' is not null then
      select * into L from wh_items where id = (it->>'item_id')::bigint for update;
      if not found then raise exception 'Item % is not in the warehouse list.', it->>'item_id'; end if;
      if L.drum_name is not null then
        len := nullif(it->>'cut','')::numeric;
        if len is null or len <= 0 or len > L.drum_cur - L.drum_lower then
          raise exception 'Drum % has % m left.', L.drum_name, L.drum_cur - L.drum_lower; end if;
        update wh_items set drum_cur = drum_cur - len, qty = drum_cur - len - drum_lower where id = L.id;
        insert into wh_lines(note_id,item_id,line_no,qty,cut_from,cut_to,remarks)
        values (nid, L.id, ln, len, L.drum_cur - len, L.drum_cur, nullif(it->>'remarks',''));
      else
        if L.status <> 'in' then raise exception '% is not in stock (it went out on %).', coalesce(L.sn, L.name), L.out_note; end if;
        update wh_items set status='out', out_note=nid, out_date=d,
               site_id   = case when dst='site' then sid end,
               site_name = case when dst='site' then nullif(p->>'site_name','') end,
               party     = case when dst='party' then prt end,
               project   = coalesce(nullif(p->>'project',''), project)
         where id = L.id;
        insert into wh_lines(note_id,item_id,line_no,qty,cut_from,cut_to,remarks)
        values (nid, L.id, ln, L.qty, L.read_end, L.read_start, nullif(it->>'remarks',''));
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

revoke all on function wh_next(text), wh_inbound(jsonb), wh_outbound(jsonb) from public, anon;
grant execute on function wh_next(text), wh_inbound(jsonb), wh_outbound(jsonb) to authenticated;

-- ---------------------------------------------------------------- live updates
do $$ begin
  begin alter publication supabase_realtime add table wh_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table wh_notes; exception when duplicate_object then null; end;
end $$;
