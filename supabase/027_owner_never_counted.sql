-- Emortia · migration 027 — the owner is never a visitor, by uid this time
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Complete in itself: if 025 never ran, this does its work too.
--
-- WHY AGAIN
--
-- 025 stopped recording the owner and deleted what was already there, but it
-- found the old rows by matching profiles.username against visits.who - a
-- string against a string. That misses more than it should: a row filed before
-- the username was set carries an empty who, a browser that only ever visited
-- signed out never carries a name at all, and any difference in spelling or
-- case leaves the row standing. The panel kept showing a number made mostly of
-- me.
--
-- This does it by uid, which is not a spelling. Every visit now records who
-- filed it, the aggregates refuse to count anything filed by the owner, and
-- the cleanup deletes by the same test. A string comparison is not load
-- bearing anywhere in it.

-- ─────────────────────────────────────────────── who filed the row

alter table visits add column if not exists uid uuid;
create index if not exists visits_uid on visits (uid);

comment on column visits.uid is
  'The account that filed this view, or null for a visitor with no session. Used to keep the owner out of his own figures.';

create or replace function track_visit(
  p_path text, p_ref text, p_visitor text, p_sess text,
  p_device text, p_browser text, p_tz text, p_lang text, p_w int
) returns void
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  -- me, working. Not a visit. This is the first line of the function on
  -- purpose: nothing about the owner is written down at all.
  if is_owner() then return; end if;

  if p_visitor is null or length(p_visitor) not between 8 and 64 then return; end if;
  if p_sess    is null or length(p_sess)    not between 8 and 64 then return; end if;

  select count(*) into recent from visits
   where visitor = p_visitor and path = left(coalesce(p_path,'/'), 120)
     and at > now() - interval '30 seconds';
  if recent > 0 then return; end if;

  insert into visits (path, ref, visitor, sess, signed_in, who, uid,
                      device, browser, platform, tz, lang, w)
  values (left(coalesce(p_path,'/'), 120),
          left(coalesce(p_ref,''), 80),
          p_visitor, p_sess,
          auth.uid() is not null,
          coalesce((select username from profiles where id = auth.uid()), ''),
          auth.uid(),
          left(coalesce(p_device,''), 16),
          left(coalesce(p_browser,''), 24),
          '',
          left(coalesce(p_tz,''), 48),
          left(coalesce(p_lang,''), 16),
          greatest(0, least(coalesce(p_w,0), 10000)));
end $$;

create or replace function track_signin(
  p_visitor text, p_device text, p_browser text, p_platform text default ''
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if is_owner() then return; end if;
  insert into sign_ins (who, uid, visitor, device, browser, platform)
  values (coalesce((select username from profiles where id = auth.uid()), ''),
          auth.uid(), left(coalesce(p_visitor,''), 64),
          left(coalesce(p_device,''), 16), left(coalesce(p_browser,''), 24),
          left(coalesce(p_platform,''), 24));
end $$;

-- ─────────────────────────── the browsers that are mine

-- A browser is one random id. Any id that has ever filed a row while signed in
-- as the owner is the owner's machine, and everything it did signed out is the
-- owner too. This is the one place the connection is made, so the aggregates
-- and the cleanup below cannot disagree about it.
create or replace function my_visitors() returns setof text
language sql stable security definer set search_path = public as $$
  select distinct visitor from visits where uid = owner_uid()
  union
  select distinct visitor from sign_ins where uid = owner_uid()
$$;

-- ───────────────────────────────── nothing of mine is counted

create or replace function insight_summary(p_days int default 30) returns json
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Colombo')::date - (greatest(1, least(p_days, 365)) - 1);
begin
  if not is_owner() then raise exception 'Not yours to read.'; end if;
  return (
    select json_build_object(
      'days',      greatest(1, least(p_days, 365)),
      'visits',    count(*),
      'visitors',  count(distinct visitor),
      'sittings',  count(distinct sess),
      'signed',    count(*) filter (where signed_in),
      'people',    count(distinct who) filter (where who <> ''),
      'today',     count(*) filter (where day = (now() at time zone 'Asia/Colombo')::date),
      'returning', (select count(*) from (
                      select visitor from visits
                       where day >= d and uid is distinct from owner_uid()
                         and visitor not in (select my_visitors())
                       group by visitor having count(distinct day) > 1) r)
    ) from visits
     where day >= d and uid is distinct from owner_uid()
       and visitor not in (select my_visitors()));
end $$;

create or replace function insight_daily(p_days int default 30)
returns table (day date, visits bigint, visitors bigint)
language plpgsql security definer set search_path = public as $$
declare n int := greatest(1, least(p_days, 365));
begin
  if not is_owner() then raise exception 'Not yours to read.'; end if;
  return query
    select g::date, count(v.id), count(distinct v.visitor)
      from generate_series((now() at time zone 'Asia/Colombo')::date - (n - 1),
                           (now() at time zone 'Asia/Colombo')::date, '1 day') g
      left join visits v on v.day = g::date
                        and v.uid is distinct from owner_uid()
                        and v.visitor not in (select my_visitors())
     group by g order by g;
end $$;

create or replace function insight_by(p_field text, p_days int default 30, p_limit int default 12)
returns table (label text, visits bigint, visitors bigint)
language plpgsql security definer set search_path = public as $$
declare
  n int := greatest(1, least(p_days, 365));
  d date;
begin
  if not is_owner() then raise exception 'Not yours to read.'; end if;
  if p_field not in ('path','device','browser','tz','lang','ref','who','platform') then
    raise exception 'Not a field you can group by.';
  end if;
  d := (now() at time zone 'Asia/Colombo')::date - (n - 1);
  return query execute format($f$
    select coalesce(nullif(%I, ''), '(none)')::text, count(*), count(distinct visitor)
      from visits
     where day >= $1 and uid is distinct from owner_uid()
       and visitor not in (select my_visitors())
     group by 1 order by 2 desc limit $2 $f$, p_field)
    using d, greatest(1, least(p_limit, 50));
end $$;

create or replace function insight_devices(p_days int default 90)
returns table (who text, device text, browser text, platform text, visitor text,
               sign_ins bigint, first_at timestamptz, last_at timestamptz,
               last_seen timestamptz, cut_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare n int := greatest(1, least(p_days, 365));
begin
  if not is_owner() then raise exception 'Not yours to read.'; end if;
  return query
    select s.who, s.device, s.browser, max(s.platform), s.visitor,
           count(*), min(s.at), max(s.at),
           (select max(v.at) from visits v where v.visitor = s.visitor),
           (select o.at from signed_out o where o.visitor = s.visitor)
      from sign_ins s
     where s.at > now() - (n || ' days')::interval
       and s.uid is distinct from owner_uid()
     group by s.who, s.device, s.browser, s.visitor
     order by max(s.at) desc
     limit 60;
end $$;

-- ─────────────────────────────── and the ones already counted

-- Rows the owner filed while signed in, by uid. Then everything from any
-- browser of his, signed in or not. Then anything still carrying his name,
-- for rows written before the uid column existed.
--
-- This is a delete. Look first if you want to:
--   select count(*) from visits
--    where uid = owner_uid() or visitor in (select my_visitors());

delete from visits
 where uid = owner_uid()
    or visitor in (select my_visitors())
    or lower(who) = lower(coalesce((select username from profiles where id = owner_uid()), '(no such username)'));

delete from sign_ins
 where uid = owner_uid()
    or lower(who) = lower(coalesce((select username from profiles where id = owner_uid()), '(no such username)'));

-- ═══════════════════════════════════════════════════════════════════ check
--
-- As the owner:
--   select insight_summary(30);        -- should be small, and none of it mine
--   select count(*) from visits where uid = owner_uid();          -- 0
--
-- Then open the site as yourself and reload a few times:
--   select insight_summary(1);         -- unchanged. You are not a visitor.
--
-- If you would rather simply start again from nothing, the table is a week old
-- and mostly was mine:
--   -- truncate visits; truncate sign_ins;
