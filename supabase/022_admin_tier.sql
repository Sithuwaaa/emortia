-- Emortia · migration 022 — a fourth audience: the office admins
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 021 first.
--
-- WHAT THIS ADDS
--
-- Three tiers could say "anyone", "the team", and "me". They could not say
-- "the office, but not the team" - which is the one shape an office admin
-- needs, and the reason the two tools they keep had to be named in a list
-- rather than described by a tier.
--
-- So a fourth: 'admin'. Narrower than tooway, not wider. The office admins and
-- the owner reach it; staff do not.
--
--   public   anyone, signed out included
--   tooway   an account carrying the staff role, and me
--   admin    an account carrying the admin role, and me - the team shut out
--   mine     me alone
--
-- Nothing moves onto the new tier here. Every tool sits exactly where it sat
-- five minutes ago, and an admin still keeps Daily Attendance and Team
-- Directory through admin_tools(), which is unchanged. This migration widens
-- what a tier is allowed to be and teaches may_read() the fourth answer; which
-- tools go there is a decision made on the Owner page, one switch at a time.

alter table feature_locks drop constraint if exists feature_locks_tier_shape;
alter table feature_locks add constraint feature_locks_tier_shape
  check (tier in ('public', 'tooway', 'admin', 'mine'));

-- One call, four answers. The admin clause is two things joined: the tier, and
-- the two tooway tools that are theirs whatever tier those sit on. Staff are
-- untouched, the owner is untouched, and a null role still reaches only what
-- is public.
create or replace function may_read(f text) returns boolean
  language sql stable security definer set search_path = public as $$
    select case feature_tier(f)
             when 'public' then true
             when 'tooway' then
                  is_owner()
               or coalesce(my_role(), '') = 'staff'
               or (coalesce(my_role(), '') = 'admin' and f = any (admin_tools()))
             when 'admin' then
                  is_owner()
               or coalesce(my_role(), '') = 'admin'
             else is_owner()
           end
$$;

-- feature_tier() falls back to 'mine' for a key nobody has set, which is still
-- the right way round: a tool nobody has decided about is the owner's.

-- ═══════════════════════════════════════════════════════════════════ check
--
-- As the admin account, with nothing yet moved onto the new tier:
--
--   select f, may_read(f) from unnest(array[
--     'tool:attendance','tool:team','tool:site-access','tool:esn']) f;
--   -- attendance t, team t, the other two f
--
-- Then move one tool there from the Owner page and read it again as staff:
--
--   select may_read('tool:attendance');   -- as staff, false once it is 'admin'
--                                         -- as the admin, still true
