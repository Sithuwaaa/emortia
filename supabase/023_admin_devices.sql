-- Emortia · migration 023 — the office admin runs the whole attendance tool
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 022 first.
--
-- WHAT THIS CHANGES
--
-- 020 gave the admin role Daily Attendance and Team Directory, and 019 had
-- already made attend_devices the owner's alone. Both were right at the time
-- and together they left the tool half-usable: an admin could name faces, mark
-- leave, correct a time and take somebody off the roster, but could not issue
-- the link the photographs arrive through, or stop one when a phone was lost.
-- Running the tool includes handing a phone its link.
--
-- So the device links follow the tool. is_office_admin() is the same test that
-- already governs the roster and the records - it is the owner, or an account
-- carrying the admin role, and nobody else. Staff are not admitted here: a
-- device link is a standing permission to file attendance from a phone, which
-- is a wider thing than reading the sheet.
--
-- The token itself is unchanged in every other respect. It is still never
-- returned by attend_submit() or attend_device_today(), still readable only
-- through this policy, and still the only thing that makes the plain screen
-- work.

do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'attend_devices'
  loop
    execute format('drop policy if exists %I on public.attend_devices', r.policyname);
  end loop;
end $$;

create policy "attend_devices_all" on attend_devices
  for all using (is_office_admin()) with check (is_office_admin());

-- The photographs the office files by hand go through storage, not the row, on
-- the one path that still uses the bucket. Same reasoning: whoever runs the
-- tool may add to it. Anonymous callers are still refused outright - the plain
-- screen writes through attend_submit() and touches no bucket at all.
drop policy if exists "attend_obj_insert" on storage.objects;
create policy "attend_obj_insert" on storage.objects
  for insert with check (bucket_id = 'attend' and is_office_admin());

drop policy if exists "attend_obj_delete" on storage.objects;
create policy "attend_obj_delete" on storage.objects
  for delete using (bucket_id = 'attend' and is_office_admin());

-- Removing a photograph from a record is guarded by the trigger 019 added,
-- which asked is_owner(). An admin who may delete the whole record but not the
-- picture inside it is a rule with no idea behind it, so it asks the same
-- question the rest of the tool asks.
create or replace function attend_guard_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.photo_data, '') <> '' and coalesce(new.photo_data, '') = ''
     and not is_office_admin() then
    raise exception 'Only the office may remove a photograph.';
  end if;
  return new;
end $$;

-- attend_records delete was is_owner() in 018, for the same reason and with the
-- same conclusion: the person who runs the sheet is the person who corrects it.
drop policy if exists "attend_records_delete" on attend_records;
create policy "attend_records_delete" on attend_records
  for delete using (is_office_admin());

-- ═══════════════════════════════════════════════════════════════════ check
--
-- As the admin account:
--   select count(*) from attend_devices;                    -- the links, not an error
--   insert into attend_devices (id, label, token)
--   values ('dtest', 'test', encode(gen_random_bytes(18),'hex'));   -- allowed
--   delete from attend_devices where id = 'dtest';
--
-- As a staff account, all three should be refused, and:
--   select count(*) from attend_devices;                    -- 0 rows, not an error
