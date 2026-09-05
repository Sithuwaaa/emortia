-- Emortia · migration 018 — Daily Attendance
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- A photo is the record. Somebody on the shared device takes one picture of
-- whoever is starting the shift; the time and the location are stamped on it
-- at that moment rather than typed afterwards. The same again at the end. The
-- office then ticks the faces it can see, and the sheet fills itself in.
--
-- Two things are kept: who is on the roster, and one row per photograph. The
-- photograph itself goes in a private bucket - a face and a location together
-- is the most personal thing this site holds, and a public bucket would put
-- both on a guessable URL.

-- ─────────────────────────────────────────────────────────────── the roster

create table if not exists attend_people (
  id          text primary key,
  name        text not null,
  role        text not null default '',
  sort        int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table attend_people add constraint attend_people_name_shape
  check (length(btrim(name)) between 1 and 80) not valid;

create index if not exists attend_people_sort on attend_people (sort, name);

-- ─────────────────────────────────────────────────────── one row per photo

create table if not exists attend_records (
  id          text primary key,
  day         date not null,
  kind        text not null check (kind in ('in','out')),
  taken_at    timestamptz not null,
  geo         text not null default '',
  photo       text not null default '',      -- path inside the `attend` bucket
  members     jsonb not null default '[]'::jsonb,  -- attend_people.id, ticked by the office
  ref         text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

-- the page asks for one day at a time, newest photo first
create index if not exists attend_records_day on attend_records (day, taken_at desc);

alter table attend_people   enable row level security;
alter table attend_records  enable row level security;

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public' and tablename in ('attend_people','attend_records')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Reading is the tier. The roster has to be readable by whoever names the
-- faces, and the records by whoever reads the sheet.
create policy "attend_people_read" on attend_people
  for select using (may_read('tool:attendance'));
create policy "attend_records_read" on attend_records
  for select using (may_read('tool:attendance'));

-- The roster is the owner's: it decides what every sheet is measured against,
-- and a name quietly removed would make somebody's absence disappear with it.
create policy "attend_people_write" on attend_people
  for all using (is_owner()) with check (is_owner());

-- Filing a photograph is the whole tool, so anyone who can open it may add
-- one, and may tick the names in it. Deleting is the owner's alone - a record
-- of who was where is not something a shared device should be able to erase.
create policy "attend_records_insert" on attend_records
  for insert with check (may_read('tool:attendance'));
create policy "attend_records_update" on attend_records
  for update using (may_read('tool:attendance')) with check (may_read('tool:attendance'));
create policy "attend_records_delete" on attend_records
  for delete using (is_owner());

-- so a photo filed on the shared phone appears on the office laptop
do $$
declare t text;
begin
  foreach t in array array['attend_people','attend_records'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = t)
    then execute format('alter publication supabase_realtime add table %I', t); end if;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────── the photographs

-- Private, and more firmly than the others. An ESN screenshot is a piece of
-- equipment; this is somebody's face with a time and a set of coordinates
-- beside it. 4MB is past anything the device sends, because the page shrinks
-- every photo to 560px before it leaves the phone.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attend', 'attend', false, 4194304, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 4194304,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "attend_obj_read"   on storage.objects;
drop policy if exists "attend_obj_insert" on storage.objects;
drop policy if exists "attend_obj_delete" on storage.objects;

create policy "attend_obj_read" on storage.objects
  for select using (bucket_id = 'attend' and may_read('tool:attendance'));
create policy "attend_obj_insert" on storage.objects
  for insert with check (bucket_id = 'attend' and may_read('tool:attendance'));
create policy "attend_obj_delete" on storage.objects
  for delete using (bucket_id = 'attend' and is_owner());

-- ─────────────────────────────────────────────────────────────── the switch

insert into feature_locks (feature, tier) values ('tool:attendance', 'tooway')
on conflict (feature) do nothing;

-- ═══════════════════════════════════════════════════════════════════ check
--
--   select count(*) from attend_people;
--   select day, kind, count(*) from attend_records group by day, kind order by day desc;
--
-- And nothing without a session. From a signed-out console both must be empty:
--   await (await fetch(URL + '/rest/v1/attend_people?select=id&limit=1',
--          { headers: { apikey: ANON } })).json()
--   await (await fetch(URL + '/rest/v1/attend_records?select=id&limit=1',
--          { headers: { apikey: ANON } })).json()
