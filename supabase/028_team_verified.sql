-- Emortia · migration 028 — a person in the directory can be marked verified
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Needs 020 and 021 (is_office_admin), and 006 (profiles.username).
--
-- WHAT THE MARK MEANS
--
-- Somebody in the office has checked this person's name, mobile number, ID
-- number, company and role against the person or their papers. It is a
-- statement made by a named account on a date, so it is stored with both.
--
-- WHO MAY MAKE IT
--
-- The owner and the office admins - is_office_admin(), the same test that
-- already lets them write the directory. Staff read the mark and cannot set
-- it. The check is here, in the function, not only in which buttons the page
-- draws.
--
-- WHAT UNDOES IT
--
-- Changing any of the five things it vouches for. A mark that survived an
-- edit would be vouching for a number nobody checked, so the trigger below
-- takes it off the moment one of them changes. Moving somebody to another
-- team does not: the team is where they are filed, not who they are.
--
-- The mark can only be set through team_verify(), which is the thing that
-- records who and when. A plain update that tries to write the three columns
-- directly has them put back as they were.

alter table team_people add column if not exists verified_at   timestamptz;
alter table team_people add column if not exists verified_by   uuid;
alter table team_people add column if not exists verified_name text;

comment on column team_people.verified_at is
  'When an owner or office admin marked this record checked. Cleared by any edit to name, mobile, nic, company or role.';

-- ───────────────────────────────────────────────────────── setting it

create or replace function team_verify(p_id uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_office_admin() then
    raise exception 'Only the owner or an office admin may verify a record.';
  end if;

  -- tells the trigger this write is the verification itself, for this
  -- transaction only
  perform set_config('team.verifying', 'on', true);

  update team_people
     set verified_at   = case when p_on then now() else null end,
         verified_by   = case when p_on then auth.uid() else null end,
         verified_name = case when p_on
                              then coalesce((select username from profiles where id = auth.uid()), '')
                              else null end
   where id = p_id;

  if not found then
    raise exception 'That person is not in the directory any more.';
  end if;

  perform set_config('team.verifying', '', true);
end $$;

revoke all on function team_verify(uuid, boolean) from public;
grant execute on function team_verify(uuid, boolean) to authenticated;

-- ────────────────────────────────────────────────────── and losing it

create or replace function team_people_verified_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('team.verifying', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- a new row, or one brought in from a workbook, has been checked by nobody
    new.verified_at := null; new.verified_by := null; new.verified_name := null;
    return new;
  end if;

  if (new.name, new.mobile, new.nic, new.company, new.role)
     is distinct from (old.name, old.mobile, old.nic, old.company, old.role) then
    new.verified_at := null; new.verified_by := null; new.verified_name := null;
  else
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
    new.verified_name := old.verified_name;
  end if;
  return new;
end $$;

drop trigger if exists team_people_verified on team_people;
create trigger team_people_verified before insert or update on team_people
  for each row execute function team_people_verified_guard();

-- ═══════════════════════════════════════════════════════════════════ check
--
-- As the owner or an admin, with the id of somebody in the directory:
--   select team_verify('<a team_people id>', true);
--   select name, verified_at, verified_name from team_people where id = '<that id>';
--       -- a time and your username
--   update team_people set mobile = mobile || '' where id = '<that id>';
--       -- unchanged value: the mark stays
--   update team_people set role = coalesce(role, '') || ' ' where id = '<that id>';
--   select verified_at from team_people where id = '<that id>';
--       -- null: an edit took it off (put the role back afterwards)
--
-- As a staff account:
--   select team_verify('<that id>', true);
--       -- Only the owner or an office admin may verify a record.
