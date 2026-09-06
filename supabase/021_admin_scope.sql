-- Emortia · migration 021 — the office admin reads two tools, not thirteen
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 020 first.
--
-- WHAT THIS CORRECTS
--
-- 020 made an office admin count as staff for every reading question, which
-- was more than was asked for and more than the role needs. Staff read the
-- whole tooway tier: site access permissions, the team directory's NIC numbers
-- and mobiles, ESN records, site technical data, the materials list. An office
-- admin was given the role to keep two tools, and keeping two tools does not
-- require being able to read eleven others.
--
-- After this, an admin reads exactly the two tools they may write, plus
-- anything public. Everywhere else they are treated as somebody with no role
-- at all: the tool does not open.
--
-- profiles is the one deliberate exception, and it stays as it is. Reading the
-- team's usernames is how a record shows a name instead of an email, which is
-- the thing 006 existed to fix - and a username is not what this migration is
-- protecting.

-- ═════════════════════════ first, the constraint 020 left behind

-- 020 wrote its check under a new name, profiles_role_check, and never dropped
-- the one 015 had already put on the same column - profiles_role_shape, which
-- allows owner and staff and nothing else. Both were in force, so the column
-- had to satisfy both, and `update profiles set role = 'admin'` was refused by
-- the older one. The role existed everywhere except in the table that holds it.
--
-- One constraint from here on, under 020's name.
alter table profiles drop constraint if exists profiles_role_shape;
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role is null or role in ('owner', 'staff', 'admin'));

-- The two, in one place. A function rather than a literal repeated in a
-- policy, so the next tool an admin is meant to keep is added once and the
-- answer changes everywhere at the same moment.
create or replace function admin_tools() returns text[]
  language sql immutable as $$
    select array['tool:attendance', 'tool:team']
$$;

comment on function admin_tools() is
  'The features the admin role may read and write. Everything else is the owner''s or the staff tier''s.';

-- One call, three answers, and the middle one now asks which feature rather
-- than only which tier. The owner is unaffected; staff are unaffected; a null
-- role is unaffected. Only 'admin' reads differently, and it reads less.
create or replace function may_read(f text) returns boolean
  language sql stable security definer set search_path = public as $$
    select case feature_tier(f)
             when 'public' then true
             when 'tooway' then
                  is_owner()
               or coalesce(my_role(), '') = 'staff'
               or (coalesce(my_role(), '') = 'admin' and f = any (admin_tools()))
             else is_owner()
           end
$$;

-- is_office_admin() is left as it is, but pinned to the same list so that the
-- writing answer can never be wider than the reading one.
create or replace function is_office_admin() returns boolean
  language sql stable security definer set search_path = public as $$
    select is_owner()
        or coalesce((select role from profiles where id = auth.uid()), '') = 'admin'
$$;

create or replace function may_write(f text) returns boolean
  language sql stable security definer set search_path = public as $$
    select is_owner()
        or (coalesce(my_role(), '') = 'admin' and f = any (admin_tools()))
$$;

grant execute on function admin_tools(), may_write(text) to anon, authenticated;

-- is_staff() keeps counting an admin as staff, because profiles_read uses it
-- and that is the one thing they should still see. Every tool policy goes
-- through may_read(), which no longer agrees.

-- ═══════════════════════════════════════════════════════════════════ check
--
-- Signed in as the admin account, this should be two rows and not thirteen:
--
--   select f, may_read(f) from unnest(array[
--     'tool:attendance','tool:team','tool:site-access','tool:site-data',
--     'tool:esn','tool:materials','tool:field-config','tool:bom',
--     'tool:gin-extractor','tool:design-extractor','tool:project-update',
--     'tool:whattodo','journal']) f
--    where may_read(f);
--
-- Expected: tool:attendance, tool:team, and journal if it is still public.
-- And as a staff account, every tooway tool as before.
