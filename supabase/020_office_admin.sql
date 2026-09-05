-- Emortia · migration 020 — the office admin
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 015 through 019 first.
--
-- WHAT THIS ADDS AND WHY
--
-- 015 gave the account three shapes: owner, staff, or nothing. Staff can read
-- whatever the tier lets them read and write almost nothing - every write on
-- the tools went through is_owner(). That is right for the datasets that are
-- the owner's record of something: a site's access permissions, an NIC number,
-- a materials list.
--
-- It is wrong for the two tools that are somebody's daily clerical job. Naming
-- faces in a photograph, correcting an attendance record, keeping the team
-- directory current - those are the office admin team's work, and routing them
-- through one person is how a sheet stops being kept.
--
-- So: a fourth role, 'admin'. It reads what staff read - nothing is opened up -
-- and it writes on exactly two tools: Daily Attendance and Team Directory.
-- Everywhere else it is staff and no more.
--
-- WHAT IT DELIBERATELY DOES NOT GET
--
--   · device links (attend_devices). Those are credentials, not data. A link
--     is a standing permission to file attendance from a phone, and handing
--     out standing permissions stays with the owner.
--   · the delete password (owner_gate), the feature tiers (feature_locks),
--     and who has which role (profiles.role). An admin who could edit roles
--     could make themselves the owner.
--   · every other tool. Site Access, Site Data, ESN, Materials, Field Config,
--     BOM, the design tools: read as before, write not at all.

-- ═════════════════════════════════════════════════════════════ the role

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role is null or role in ('owner', 'staff', 'admin'));

comment on column profiles.role is
  'owner - everything. admin - reads as staff, and writes Daily Attendance and Team Directory. staff - reads the tooway tier. null - the public tier only.';

-- ══════════════════════════════════════════════════════════ asking about it

-- An admin is staff for every reading question. This is the whole of what the
-- new role opens up on the reading side: nothing.
create or replace function is_staff() returns boolean
  language sql stable security definer set search_path = public as $$
    select is_owner()
        or coalesce((select role from profiles where id = auth.uid()), '')
             in ('staff', 'admin')
$$;

-- And the writing question, for the two tools that have one. The owner is an
-- office admin and more, so every rule below is a single call.
create or replace function is_office_admin() returns boolean
  language sql stable security definer set search_path = public as $$
    select is_owner()
        or coalesce((select role from profiles where id = auth.uid()), '') = 'admin'
$$;

grant execute on function is_office_admin() to anon, authenticated;

-- ═══════════════════════════════════════════════ daily attendance (018/019)

-- The roster. Adding a name, correcting a role, taking somebody off.
drop policy if exists "attend_people_write" on attend_people;
create policy "attend_people_write" on attend_people
  for all using (is_office_admin()) with check (is_office_admin());

-- Deleting a record - a photograph filed by mistake. Inserting and updating
-- were already the tier's, because ticking a face is the tool working.
drop policy if exists "attend_records_delete" on attend_records;
create policy "attend_records_delete" on attend_records
  for delete using (is_office_admin());

-- Removing a photograph out of a record it keeps. 019 made this the owner's
-- through a trigger, because RLS cannot say "this column, not that one".
create or replace function attend_guard_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.photo_data, '') <> '' and coalesce(new.photo_data, '') = ''
     and not is_office_admin() then
    raise exception 'Only the owner or an office admin may remove a photograph.';
  end if;
  return new;
end $$;

-- The bucket 018 left behind, for the same reason.
drop policy if exists "attend_obj_insert" on storage.objects;
create policy "attend_obj_insert" on storage.objects
  for insert with check (bucket_id = 'attend' and is_office_admin());
drop policy if exists "attend_obj_delete" on storage.objects;
create policy "attend_obj_delete" on storage.objects
  for delete using (bucket_id = 'attend' and is_office_admin());

-- attend_devices is NOT here. See the note at the top: a device link is a
-- credential, and it stays with the owner.

-- ═══════════════════════════════════════════════════ team directory (012)

drop policy if exists "team_groups_write"   on team_groups;
drop policy if exists "team_people_write"   on team_people;
drop policy if exists "team_vehicles_write" on team_vehicles;

create policy "team_groups_write" on team_groups
  for all using (is_office_admin()) with check (is_office_admin());
create policy "team_people_write" on team_people
  for all using (is_office_admin()) with check (is_office_admin());
create policy "team_vehicles_write" on team_vehicles
  for all using (is_office_admin()) with check (is_office_admin());

-- ═════════════════════════════════════════ what stays exactly as it was

-- Named rather than assumed, because "everything else is still owner-only" is
-- the sentence this migration has to be able to make. If any of these comes
-- back as anything but is_owner(), something below has gone wrong.
do $$
declare bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('attend_devices','owner_gate','feature_locks','field_config',
                       'esn_records','materials','sites','site_data')
     and cmd in ('ALL','INSERT','UPDATE','DELETE')
     and qual is not null
     and qual not like '%is_owner%';
  if bad is not null then
    raise warning 'A write policy that should be owner-only is not: %', bad;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════ the account
--
-- Make the person first, then give them the role. Supabase → Authentication →
-- Users → Add user, with sithu.ayesh@gmail.com and a password, and tick
-- "Auto Confirm User" so they are not waiting on an email. Then:
--
--   update profiles set role = 'admin'
--    where id = (select id from auth.users where email = 'sithu.ayesh@gmail.com');
--
-- If profiles has no row for them yet, sign in once as that account first -
-- the row is made on the way in - then run the update as the owner. The role
-- column refuses to be set by anybody but the owner (015's trigger), so this
-- has to be run from the SQL editor or while signed in as yourself.
--
-- To check it took:
--
--   select u.email, p.role from profiles p join auth.users u on u.id = p.id
--    where p.role is not null order by p.role;
