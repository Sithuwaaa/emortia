-- Emortia · migration 017 — the material list
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- Two files describe the same 2,422 materials from different directions: an
-- export with one row each and a common set of columns, and a workbook of
-- per-category sheets that carry what the export cannot - an antenna's port
-- type, a fibre's polish, a radio's band - and five hundred codes the export
-- never had.
--
-- One row per material code, and the attributes as jsonb, because every
-- category wants different columns and a table wide enough for all of them
-- would be forty columns of which each row filled six.
--
-- It is Dialog's material master, so it lives here rather than in the
-- repository, at the tooway tier, with writing kept to the owner. The same
-- reasoning as the site lists in 016: a file in that repository is a file
-- GitHub Pages serves to anyone who asks for it.

create table if not exists materials (
  code        text primary key,             -- the SAP material code, 7-12 digits
  descr       text not null default '',
  type        text not null default '',     -- Antenna, Radio, Fibers, PWR …
  vendor      text not null default '',     -- normalised: Huawei, Ericsson, …
  attrs       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

-- The three the page filters and sorts on.
create index if not exists materials_type_idx   on materials (type);
create index if not exists materials_vendor_idx on materials (vendor);
create index if not exists materials_attrs_idx  on materials using gin (attrs);

alter table materials enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'materials'
  loop
    execute format('drop policy if exists %I on public.materials', r.policyname);
  end loop;
end $$;

create policy "materials_read" on materials
  for select using (may_read('tool:materials'));

-- Uploading is the owner's. The team reads and copies codes; a mistyped
-- material code that everyone then orders against is not a small mistake.
create policy "materials_write" on materials
  for all using (is_owner()) with check (is_owner());

create or replace function materials_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end $$;

drop trigger if exists materials_touch_trg on materials;
create trigger materials_touch_trg before update on materials
  for each row execute function materials_touch();

-- so an upload on the laptop reaches the phone without a reload
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'materials')
  then alter publication supabase_realtime add table materials; end if;
end $$;

-- ------------------------------------------------------------- the switch

insert into feature_locks (feature, tier) values ('tool:materials', 'tooway')
on conflict (feature) do nothing;

-- ═══════════════════════════════════════════════════════════════════ check
--
--   select count(*) from materials;                       -- 2422 after the upload
--   select type, count(*) from materials group by type order by 2 desc;
--   select vendor, count(*) from materials where vendor <> '' group by vendor order by 2 desc;
--
-- And nothing without a session. From a signed-out console this must be empty:
--   await (await fetch(URL + '/rest/v1/materials?select=code&limit=1',
--          { headers: { apikey: ANON } })).json()
