-- Emortia · migration 026 — naming the machines, and signing one out
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 025 first.
--
-- WHAT THIS CAN AND CANNOT DO
--
-- Supabase will not let a browser end somebody else's session. Killing a
-- session outright needs the service-role key, and the service-role key cannot
-- live in a page that GitHub Pages serves to the whole world - it would let
-- anyone who viewed source do anything to the database.
--
-- So this is the honest version, and it is worth knowing exactly what it is:
-- the owner marks a browser as signed out, and that browser signs itself out
-- the next time it loads any page of the site. It is a note left for the
-- machine rather than a hand reaching into it.
--
--   · a browser that is open and idle stays signed in until it loads a page
--   · a browser that never comes back never reads the note - but it also
--     never gets anything new out of the database, because its token expires
--     and refreshing it is what will read the note
--   · it cannot be undone by the person signed out: the note outranks their
--     session until the owner lifts it
--
-- For a personal site with four accounts that is the right trade. If a phone
-- is genuinely lost, the certain fix is still to change that account's
-- password in Supabase, which ends every session it has everywhere.

-- ───────────────────────────────────────────── what a machine is called

-- The device rows said "phone · Chrome". Two people on Android Chrome were
-- indistinguishable, which is no use when the question is which machine to
-- sign out. The platform makes it "Android · Chrome" and "Windows · Chrome".
alter table sign_ins add column if not exists platform text not null default '';
alter table visits   add column if not exists platform text not null default '';

comment on column sign_ins.platform is
  'Windows, macOS, Android, iOS, Linux - coarse on purpose. Not a fingerprint.';

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

revoke all on function track_signin(text, text, text, text) from public;
grant execute on function track_signin(text, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────── the note itself

create table if not exists signed_out (
  visitor  text primary key,
  at       timestamptz not null default now(),
  by       uuid default auth.uid(),
  note     text not null default ''
);

alter table signed_out enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'signed_out'
  loop
    execute format('drop policy if exists %I on public.signed_out', r.policyname);
  end loop;
end $$;

-- Only the owner writes it, and only the owner reads the list. A person can
-- ask about their own browser through the function below and learn one
-- timestamp about themselves - nothing about anybody else's machine.
create policy "signed_out_owner" on signed_out
  for all using (is_owner()) with check (is_owner());

create or replace function revoke_device(p_visitor text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Only the owner may sign a device out.'; end if;
  if p_visitor is null or length(p_visitor) not between 8 and 64 then return; end if;
  insert into signed_out (visitor, at, by, note)
  values (p_visitor, now(), auth.uid(), left(coalesce(p_note,''), 120))
  on conflict (visitor) do update set at = now(), by = auth.uid();
end $$;

create or replace function unrevoke_device(p_visitor text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Only the owner may lift this.'; end if;
  delete from signed_out where visitor = p_visitor;
end $$;

-- What a browser asks about itself on the way in. It gets one timestamp for
-- the id it already knows, or null. There is no way to walk the table with it.
create or replace function revoked_at(p_visitor text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  if auth.uid() is null then return null; end if;
  select at into t from signed_out where visitor = p_visitor;
  return t;
end $$;

revoke all on function revoke_device(text, text), unrevoke_device(text), revoked_at(text) from public;
grant execute on function revoke_device(text, text), unrevoke_device(text) to authenticated;
grant execute on function revoked_at(text) to authenticated;

-- ───────────────────────────────── the device list learns both

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
     group by s.who, s.device, s.browser, s.visitor
     order by max(s.at) desc
     limit 60;
end $$;

-- ═══════════════════════════════════════════════════════════════════ check
--
-- As the owner:
--   select * from insight_devices(90);          -- platform and cut_at now on it
--   select revoke_device('<a visitor id>');     -- leave the note
--   select * from signed_out;
--   select unrevoke_device('<that id>');        -- take it back
--
-- As that account, in that browser, on the next page load: signed out.
-- As anybody else: revoke_device refuses.
