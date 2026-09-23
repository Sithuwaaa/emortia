-- Emortia · migration 030 — Austin SWAP materials
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- What this is for: an Airtel tower and a Dialog tower become one site. One of
-- the two comes down - usually the Airtel one - and some of what is on it, and
-- sometimes some of what is on the other, is taken off. The warehouse needs to
-- be told exactly what came off which tower, with the serial numbers; and some
-- of it is not going to the warehouse at all but straight onto another site,
-- which has to be said too, or it is written off as missing.
--
-- The engineer or the team on site files it. One row per visit; the materials
-- themselves are a list inside the row, because a material line only means
-- anything as part of the swap it came off.
--
-- Nothing here is a substitute for the policies. The tiers do the refusing:
-- may_read('tool:swap') is staff and the owner, set in feature_locks below.

-- ─────────────────────────────────────────────────────────────── the records

create table if not exists swap_records (
  id            uuid primary key default gen_random_uuid(),

  -- the two towers, and which of them is going
  airtel_site   text,
  airtel_name   text,
  dialog_site   text,
  dialog_name   text,
  removed       text not null default 'airtel',   -- airtel | dialog | both
  visited_on    date,
  team          text,

  -- [{ from:'airtel'|'dialog', code, name, qty,
  --    dest:'wh'|'remap', remap_site, remap_name,
  --    serials:[{ sn, photo }], note }]
  --
  -- The serials carry their own photograph: a serial nobody can read back off
  -- a picture is a serial the warehouse will argue about. The photo is a path
  -- inside the `swap` bucket, not the image.
  items         jsonb not null default '[]'::jsonb,

  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  created_name  text
);

-- newest first, and looked up by either tower
create index if not exists swap_records_created_idx on swap_records (created_at desc);
create index if not exists swap_records_airtel_idx  on swap_records (upper(airtel_site));
create index if not exists swap_records_dialog_idx  on swap_records (upper(dialog_site));

alter table swap_records enable row level security;

drop policy if exists "swap_read"   on swap_records;
drop policy if exists "swap_insert" on swap_records;
drop policy if exists "swap_update" on swap_records;
drop policy if exists "swap_delete" on swap_records;

create policy "swap_read" on swap_records
  for select using (may_read('tool:swap'));

-- whoever files it is stamped on it
create policy "swap_insert" on swap_records
  for insert with check (may_read('tool:swap') and created_by = auth.uid());

-- your own to correct, and the owner's to correct after you
create policy "swap_update" on swap_records
  for update
  using      (is_owner() or (may_read('tool:swap') and created_by = auth.uid()))
  with check (is_owner() or (may_read('tool:swap') and created_by = auth.uid()));

create policy "swap_delete" on swap_records
  for delete using (is_owner());

create or replace function swap_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists swap_touch_trg on swap_records;
create trigger swap_touch_trg before update on swap_records
  for each row execute function swap_touch();

-- so a record filed on a phone at the tower appears on the laptop in the
-- office without anybody refreshing anything
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'swap_records'
  ) then
    alter publication supabase_realtime add table swap_records;
  end if;
end $$;

-- ────────────────────────────────────────────────────── the serial photographs

-- Private, like every other bucket here. A serial number photographed on a
-- tower is an asset record; a public bucket would put the lot on a guessable
-- URL. The tool asks for a signed link at the moment it shows one, and those
-- expire. Nothing is resized on the way up - a serial you cannot read is
-- worth nothing - so the ceiling is the same 50MB the ESN bucket has.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('swap', 'swap', false, 52428800,
        array['image/png','image/jpeg','image/webp','image/gif','image/bmp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 52428800,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','image/bmp'];

drop policy if exists "swap_obj_read"   on storage.objects;
drop policy if exists "swap_obj_insert" on storage.objects;
drop policy if exists "swap_obj_delete" on storage.objects;

create policy "swap_obj_read" on storage.objects
  for select using (bucket_id = 'swap' and may_read('tool:swap'));

create policy "swap_obj_insert" on storage.objects
  for insert with check (bucket_id = 'swap' and may_read('tool:swap'));

create policy "swap_obj_delete" on storage.objects
  for delete using (bucket_id = 'swap' and (owner = auth.uid() or is_owner()));

-- ───────────────────────────────────────────────────────────────── the switch
--
-- Without this row feature_tier() answers 'mine' for a key nobody has set, and
-- the tool would be shut to everyone but the owner - which is the safe way
-- round, and not what is wanted for something the team files from the field.
insert into feature_locks (feature, tier) values ('tool:swap', 'tooway')
on conflict (feature) do nothing;

-- ═══════════════════════════════════════════════════════════════════ check
--
--   select feature, tier from feature_locks where feature = 'tool:swap';
--   -- tool:swap | tooway
--
--   select count(*) from swap_records;
--   select id, public from storage.buckets where id = 'swap';   -- swap | f
