-- Emortia · migration 019 — the device link, for people with no account
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 018 first.
--
-- WHAT CHANGED AND WHY
--
-- 018 assumed whoever clocked in was signed in. The people this is for are
-- not: they are the crews, they have no account on the site and are not going
-- to be given one, and asking them to remember a password to photograph
-- themselves at six in the morning is asking the tool to be ignored.
--
-- So the clock-in screen becomes a page with no sign-in at all, and the thing
-- that lets it write is a link rather than a session. The link carries a token
-- that the owner makes once and saves to the shared phone's home screen. It is
-- a capability: whoever holds the link can file a photo for that device, and
-- can do nothing else - not read a record, not read the roster, not see a
-- name, not see another day. The whole surface is one function that takes a
-- photograph and gives back nothing but "filed".
--
-- BE CLEAR ABOUT WHAT THIS IS. A link is a weaker thing than a password: it
-- sits in a browser history and it can be forwarded. What it buys is that the
-- crews can use the tool at all, and what it risks is somebody filing a
-- photograph that should not be there - which the office sees, and can
-- discount, because a face it does not recognise is not a name it will tick.
-- Reading is untouched: nothing on this path can see anything.

create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────── the devices

create table if not exists attend_devices (
  id          text primary key,
  label       text not null default '',      -- "Janaka crew phone"
  token       text not null unique,
  active      boolean not null default true,
  last_used   timestamptz,
  created_at  timestamptz not null default now()
);

alter table attend_devices enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'attend_devices'
  loop
    execute format('drop policy if exists %I on public.attend_devices', r.policyname);
  end loop;
end $$;

-- The owner alone, both ways. The token is stored as it is written, not
-- hashed, because the owner has to be able to look the link up again months
-- later when the phone is replaced - and a row only the owner can read is
-- where a capability link belongs. Nothing else in the database can see it,
-- and the function below never returns it.
create policy "attend_devices_all" on attend_devices
  for all using (is_owner()) with check (is_owner());

-- ─────────────────────────────────── the photo moves into the row

-- 018 put the photograph in a private bucket and handed the grid a signed
-- link. That needed a session to upload, which is exactly what this path does
-- not have - and an anon write policy on a storage bucket is a much wider door
-- than one function. A 560px JPEG is fifty kilobytes; it goes in the row.
alter table attend_records add column if not exists photo_data text;

comment on column attend_records.photo_data is
  'The photograph itself, as a data URI. Small on purpose: the phone shrinks it to 560px before it is sent.';

-- ─────────────────────────────────────────────────── filing without a session

-- security definer, so it writes as the owner of the function rather than as
-- the anonymous caller, and every check that matters happens inside it.
create or replace function attend_submit(
  p_token text, p_kind text, p_geo text, p_photo text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  dev  attend_devices%rowtype;
  today date := (now() at time zone 'Asia/Colombo')::date;
  n    int;
  newid text;
begin
  if p_kind not in ('in','out') then
    return json_build_object('ok', false, 'why', 'That is not a clock-in or a clock-out.');
  end if;
  -- 60KB of base64 is a 560px photograph; ten times that is somebody else
  if p_photo is null or length(p_photo) < 100 or length(p_photo) > 600000 then
    return json_build_object('ok', false, 'why', 'That photo is the wrong size.');
  end if;

  select * into dev from attend_devices where token = p_token and active limit 1;
  if not found then
    return json_build_object('ok', false, 'why', 'This device link is not recognised. Ask Sithara for a new one.');
  end if;

  -- A device files two photographs a day. The cap is what stops a link that
  -- has been forwarded from becoming a way to fill the table.
  select count(*) into n from attend_records
   where day = today and ref like 'D:' || dev.id || ':%';
  if n >= 6 then
    return json_build_object('ok', false, 'why', 'This device has already filed today.');
  end if;

  newid := 'A' || replace(gen_random_uuid()::text, '-', '');
  insert into attend_records (id, day, kind, taken_at, geo, photo, photo_data, members, ref)
  values (newid, today, p_kind, now(), coalesce(p_geo, ''), '', p_photo, '[]'::jsonb,
          'D:' || dev.id || ':' || to_char(now(), 'HH24MI'));

  update attend_devices set last_used = now() where id = dev.id;

  -- Nothing comes back but the fact that it worked. No id to guess with, no
  -- roster, no other day, no other device.
  return json_build_object('ok', true, 'kind', p_kind);
end $$;

revoke all on function attend_submit(text, text, text, text) from public;
grant execute on function attend_submit(text, text, text, text) to anon, authenticated;

-- What this device has filed today, so the plain screen can show its own two
-- stamps. Times only - no names, no photograph, no other device.
create or replace function attend_device_today(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare
  dev   attend_devices%rowtype;
  today date := (now() at time zone 'Asia/Colombo')::date;
  t_in  timestamptz;
  t_out timestamptz;
begin
  select * into dev from attend_devices where token = p_token and active limit 1;
  if not found then return json_build_object('ok', false); end if;

  select min(taken_at) into t_in  from attend_records
   where day = today and kind = 'in'  and ref like 'D:' || dev.id || ':%';
  select max(taken_at) into t_out from attend_records
   where day = today and kind = 'out' and ref like 'D:' || dev.id || ':%';

  return json_build_object('ok', true, 'label', dev.label,
                           'in', t_in, 'out', t_out);
end $$;

revoke all on function attend_device_today(text) from public;
grant execute on function attend_device_today(text) to anon, authenticated;

-- ───────────────────────────────── the bucket is not on this path any more

-- Nothing anonymous may write to storage. The photographs the plain screen
-- files go in the row; the bucket keeps whatever 018 already put in it and
-- takes nothing new from an unsigned caller.
drop policy if exists "attend_obj_insert" on storage.objects;
create policy "attend_obj_insert" on storage.objects
  for insert with check (bucket_id = 'attend' and is_owner());

-- ═══════════════════════════════════════════════════════════════════ check
--
-- Make the first device link (the owner does this from the Office screen, but
-- by hand it is):
--   insert into attend_devices (id, label, token)
--   values ('d1', 'Crew phone', encode(gen_random_bytes(18), 'hex'));
--   select 'https://emortia.com/attendance/?d=' || token from attend_devices;
--
-- And prove the anonymous path is one-way. With the anon key and no session:
--   select attend_submit('<the token>', 'in', '6.92, 79.86', 'data:image/jpeg;base64,...');  -- works
--   select * from attend_records;                                                            -- empty
--   select * from attend_people;                                                             -- empty
--   select * from attend_devices;                                                            -- empty

-- ────────────────────────────────────────────── who may remove a photograph

-- Deleting a record is already the owner's alone (018). Clearing the picture
-- out of a record is an update, and updates are the whole tier's, because
-- ticking a face is an update - so without this, anybody who can open the tool
-- could quietly erase the evidence a sheet is built on while leaving the sheet
-- looking untouched. RLS cannot say "this column, not that one", so a trigger
-- says it instead. Adding a picture, or replacing one, is still ordinary work.
create or replace function attend_guard_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.photo_data, '') <> '' and coalesce(new.photo_data, '') = ''
     and not is_owner() then
    raise exception 'Only the owner may remove a photograph.';
  end if;
  return new;
end $$;

drop trigger if exists attend_guard_photo on attend_records;
create trigger attend_guard_photo
  before update on attend_records
  for each row execute function attend_guard_photo();

-- ══════════════════════════════════════════════════════════════════ leave

-- Somebody who asked for the day off is not the same fact as somebody who did
-- not turn up, and a sheet that calls both Absent is wrong about the first.
-- One row per person per day, set by the office; a photograph always outranks
-- it, because if they were marked on leave and came in anyway, they were here.
create table if not exists attend_leave (
  day        date not null,
  person     text not null references attend_people(id) on delete cascade,
  label      text not null default 'Leave',
  note       text not null default '',
  set_at     timestamptz not null default now(),
  set_by     uuid default auth.uid(),
  primary key (day, person)
);

create index if not exists attend_leave_day on attend_leave (day);

alter table attend_leave enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'attend_leave'
  loop
    execute format('drop policy if exists %I on public.attend_leave', r.policyname);
  end loop;
end $$;

-- Marking leave is daily clerical work, the same as ticking a face, so anyone
-- who can open the tool may do it. Clearing one is the same act in reverse.
create policy "attend_leave_read" on attend_leave
  for select using (may_read('tool:attendance'));
create policy "attend_leave_write" on attend_leave
  for all using (may_read('tool:attendance')) with check (may_read('tool:attendance'));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'attend_leave')
  then alter publication supabase_realtime add table attend_leave; end if;
end $$;
