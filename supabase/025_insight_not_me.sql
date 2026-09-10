-- Emortia · migration 025 — stop counting my own visits
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 024 first.
--
-- WHY
--
-- The panel was answering "how many people came here" with a number mostly
-- made of me. Two hundred and sixty-five views and a hundred and eighty-one of
-- them signed in, on a site that had been open a week: that is the owner
-- reloading his own pages while he builds them, and it drowns the handful of
-- real visits underneath it.
--
-- The owner is not a visitor to his own site. From here the write path simply
-- declines to record anything the owner does - the check sits inside
-- track_visit, which is security definer and already knows who is calling, so
-- there is nothing the browser could get wrong or be told to lie about.
--
-- Everyone else is unchanged: an office admin, the team on the staff role, and
-- anybody at all with no account are all still counted.

create or replace function track_visit(
  p_path text, p_ref text, p_visitor text, p_sess text,
  p_device text, p_browser text, p_tz text, p_lang text, p_w int
) returns void
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  -- me, working. Not a visit.
  if is_owner() then return; end if;

  if p_visitor is null or length(p_visitor) not between 8 and 64 then return; end if;
  if p_sess    is null or length(p_sess)    not between 8 and 64 then return; end if;

  select count(*) into recent from visits
   where visitor = p_visitor and path = left(coalesce(p_path,'/'), 120)
     and at > now() - interval '30 seconds';
  if recent > 0 then return; end if;

  insert into visits (path, ref, visitor, sess, signed_in, who, device, browser, tz, lang, w)
  values (left(coalesce(p_path,'/'), 120),
          left(coalesce(p_ref,''), 80),
          p_visitor, p_sess,
          auth.uid() is not null,
          coalesce((select username from profiles where id = auth.uid()), ''),
          left(coalesce(p_device,''), 16),
          left(coalesce(p_browser,''), 24),
          left(coalesce(p_tz,''), 48),
          left(coalesce(p_lang,''), 16),
          greatest(0, least(coalesce(p_w,0), 10000)));
end $$;

create or replace function track_signin(p_visitor text, p_device text, p_browser text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if is_owner() then return; end if;          -- signing into my own site is not news
  insert into sign_ins (who, uid, visitor, device, browser)
  values (coalesce((select username from profiles where id = auth.uid()), ''),
          auth.uid(), left(coalesce(p_visitor,''), 64),
          left(coalesce(p_device,''), 16), left(coalesce(p_browser,''), 24));
end $$;

-- ══════════════════════════ and the ones already counted

-- Everything above only stops new rows. These clear the ones already there.
--
-- Rows the owner filed while signed in name him outright. The harder half is
-- the same browser signed out - those rows carry no name and look exactly like
-- a stranger's. What gives them away is the visitor id: it is one random
-- string per browser, so any id that has ever been seen alongside the owner's
-- name is the owner's browser, signed in or not.
--
-- This is a delete and it does not come back. Read the select first if you
-- want to see what it is about to take.
--
--   select count(*) from visits where visitor in (
--     select distinct v.visitor from visits v
--      join profiles p on lower(p.username) = lower(v.who)
--     where p.id = owner_uid());

delete from visits
 where visitor in (
   select distinct v.visitor from visits v
     join profiles p on lower(p.username) = lower(v.who)
    where p.id = owner_uid()
 );

delete from sign_ins
 where uid = owner_uid();

-- ═══════════════════════════════════════════════════════════════════ check
--
-- As the owner, after running this:
--   select track_visit('/', '', 'ownercheck000000', 'ownercheck000000',
--                      'desktop', 'Chrome', 'Asia/Colombo', 'en', 1440);
--   select count(*) from visits where visitor = 'ownercheck000000';   -- 0
--
-- And the panel should now be showing numbers small enough to be true.
