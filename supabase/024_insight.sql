-- Emortia · migration 024 — who is visiting, and from what
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 023 first.
--
-- WHAT THIS RECORDS, AND WHAT IT DELIBERATELY DOES NOT
--
-- A row per page view: when, which page, whether the person was signed in and
-- as whom, and a coarse description of the machine (phone or desktop, which
-- browser, timezone, language, window width). Plus a row per sign-in.
--
-- It does NOT record IP addresses. Two reasons, and the second is the real
-- one. First, it would not work: every request arrives through Supabase's
-- pooler, so inet_client_addr() is the pooler's address and not the visitor's.
-- Second, an IP is personal data under the GDPR and the PDPA, and none of the
-- questions being asked here - how many people, how often, on what, from where
-- in the world roughly - need one. Timezone answers "roughly where" without
-- identifying anybody.
--
-- Instead there are two ids, both made in the browser and both meaningless
-- anywhere else:
--   visitor  a random string kept in localStorage. Says "this is the same
--            browser as last week", which is what new-versus-returning means.
--            Cleared when they clear site data, as it should be.
--   sess     a random string kept in sessionStorage. Says "this is one sitting".
--
-- Neither is derived from anything about the person. They cannot be worked
-- backwards into a name, and a visitor who signs in is joined to a name only
-- because they signed in.
--
-- Nothing here is readable by anyone but the owner. The write path is one
-- security-definer function; the tables refuse every direct select except
-- is_owner(), and the aggregate functions check is_owner() before they count.

-- ═══════════════════════════════════════════════════════════════ the tables

create table if not exists visits (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  day        date not null default (now() at time zone 'Asia/Colombo')::date,
  path       text not null default '/',
  ref        text not null default '',        -- referrer host only, never the full URL
  visitor    text not null,
  sess       text not null,
  signed_in  boolean not null default false,
  who        text not null default '',
  device     text not null default '',        -- phone | tablet | desktop
  browser    text not null default '',
  tz         text not null default '',
  lang       text not null default '',
  w          int  not null default 0          -- window width, for knowing what to design for
);

create index if not exists visits_day  on visits (day);
create index if not exists visits_vis  on visits (visitor);
create index if not exists visits_at   on visits (at desc);

create table if not exists sign_ins (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  who      text not null default '',
  uid      uuid,
  visitor  text not null default '',
  device   text not null default '',
  browser  text not null default ''
);

create index if not exists sign_ins_at on sign_ins (at desc);

alter table visits   enable row level security;
alter table sign_ins enable row level security;

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public' and tablename in ('visits','sign_ins')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Reading is the owner's alone, and there is no insert policy at all: every
-- write goes through the function below, which is the only thing that may add
-- a row and adds it with the server's own clock.
create policy "visits_read"   on visits   for select using (is_owner());
create policy "sign_ins_read" on sign_ins for select using (is_owner());

-- ══════════════════════════════════════════════════════════ writing a visit

create or replace function track_visit(
  p_path text, p_ref text, p_visitor text, p_sess text,
  p_device text, p_browser text, p_tz text, p_lang text, p_w int
) returns void
language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  -- Nothing enormous, and nothing empty. A visitor id is made by the browser
  -- and is always the same shape; anything else is somebody poking at it.
  if p_visitor is null or length(p_visitor) not between 8 and 64 then return; end if;
  if p_sess    is null or length(p_sess)    not between 8 and 64 then return; end if;

  -- The same browser reloading the same page over and over is one visit, not
  -- forty. Half a minute is long enough to swallow a double-load and short
  -- enough that moving between pages still counts.
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

revoke all on function track_visit(text,text,text,text,text,text,text,text,int) from public;
grant execute on function track_visit(text,text,text,text,text,text,text,text,int) to anon, authenticated;

-- A sign-in names itself from the session rather than from what the page says,
-- so one account cannot file a sign-in as another.
create or replace function track_signin(p_visitor text, p_device text, p_browser text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into sign_ins (who, uid, visitor, device, browser)
  values (coalesce((select username from profiles where id = auth.uid()), ''),
          auth.uid(), left(coalesce(p_visitor,''), 64),
          left(coalesce(p_device,''), 16), left(coalesce(p_browser,''), 24));
end $$;

revoke all on function track_signin(text,text,text) from public;
grant execute on function track_signin(text,text,text) to authenticated;

-- ═════════════════════════════════════════════════════════════ reading it

-- Every one of these checks is_owner() itself. They are security definer so
-- they can count rows the caller cannot select, which means the check has to
-- be inside them rather than left to a policy.

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
                      select visitor from visits where day >= d
                       group by visitor having count(distinct day) > 1) r)
    ) from visits where day >= d);
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
  -- The column is chosen from a fixed list rather than interpolated, so this
  -- cannot be turned into "any column you like" by whoever calls it.
  if p_field not in ('path','device','browser','tz','lang','ref','who') then
    raise exception 'Not a field you can group by.';
  end if;
  d := (now() at time zone 'Asia/Colombo')::date - (n - 1);
  return query execute format($f$
    select coalesce(nullif(%I, ''), '(none)')::text, count(*), count(distinct visitor)
      from visits where day >= $1
     group by 1 order by 2 desc limit $2 $f$, p_field)
    using d, greatest(1, least(p_limit, 50));
end $$;

-- The machines that have signed in, newest first. Supabase does not let a
-- browser enumerate live auth sessions, so this is what can honestly be shown:
-- every device that has signed in, who signed in on it, and when it was last
-- seen. A device is "still signed in" only in the sense that nobody has signed
-- out of it - it is a history of sign-ins, not a list of live sessions.
create or replace function insight_devices(p_days int default 90)
returns table (who text, device text, browser text, visitor text,
               sign_ins bigint, first_at timestamptz, last_at timestamptz, last_seen timestamptz)
language plpgsql security definer set search_path = public as $$
declare n int := greatest(1, least(p_days, 365));
begin
  if not is_owner() then raise exception 'Not yours to read.'; end if;
  return query
    select s.who, s.device, s.browser, s.visitor,
           count(*), min(s.at), max(s.at),
           (select max(v.at) from visits v where v.visitor = s.visitor)
      from sign_ins s
     where s.at > now() - (n || ' days')::interval
     group by s.who, s.device, s.browser, s.visitor
     order by max(s.at) desc
     limit 60;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'insight_summary(int)', 'insight_daily(int)',
    'insight_by(text,int,int)', 'insight_devices(int)']
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════ check
--
-- As the owner:
--   select insight_summary(30);
--   select * from insight_daily(14);
--   select * from insight_by('path', 30);
--   select * from insight_devices(90);
--
-- As anybody else, all four should refuse, and:
--   select * from visits;      -- 0 rows, not an error
--
-- And with the anon key and no session at all, this should work and add a row:
--   select track_visit('/', '', 'abcdefgh12345678', 'abcdefgh12345678',
--                      'desktop', 'Firefox', 'Asia/Colombo', 'en', 1440);
