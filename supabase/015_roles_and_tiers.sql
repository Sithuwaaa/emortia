-- Emortia · migration 015 — three tiers, and a role on the account
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- WHAT THIS REPLACES
--
-- Until now a policy asked one of three questions: are you the owner's uid,
-- are you signed in at all (auth.role() = 'authenticated'), or nothing at all
-- (using (true)). None of those is the question the site actually wants to
-- ask. "Signed in" is not a permission - it is only proof that an account
-- exists, and an account is something anyone could have. And `using (true)`
-- on the site list, the workbooks and the job list meant those three were
-- readable by anyone holding the anon key, which is published in this
-- repository, which is public.
--
-- So there are three tiers now, and every policy asks which one a thing is in:
--
--   public   readable with no session at all.  The journal, and nothing else.
--   tooway   readable by an account carrying the 'staff' role, and by the
--            owner.  The working tools.
--   mine     the owner alone.
--
-- The tier is a property of the feature and lives in feature_locks, which is
-- what the Owner page's switches write. The role is a property of the account
-- and lives in profiles.role - 'owner', 'staff', or null. Null is the default
-- and it reaches nothing above public, which is the safe way round: an account
-- made tomorrow gets nothing until it is named.
--
-- Writing stays the owner's throughout, with two deliberate exceptions kept
-- from before, marked where they appear: filing an ESN and uploading a design
-- book are what those two tools ARE, and the team does both.

-- ═══════════════════════════════════════════════════════ who the owner is

-- The uid in one place instead of twenty. Everything below asks this function
-- rather than carrying the literal, so moving the account is one line.
create or replace function owner_uid() returns uuid
  language sql immutable as $$
    select '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid
$$;

-- ═══════════════════════════════════════════════════════════════ the role

alter table profiles add column if not exists role text;

alter table profiles drop constraint if exists profiles_role_shape;
alter table profiles add constraint profiles_role_shape
  check (role is null or role in ('owner', 'staff'));

comment on column profiles.role is
  'owner | staff | null. Null reaches nothing above the public tier. Set by the owner only.';

-- The owner's own row, so is_owner() agrees with owner_uid() from the start.
update profiles set role = 'owner' where id = owner_uid() and role is distinct from 'owner';

-- The team profile, if it has been made yet. A no-op until then, and the line
-- to copy for every account added afterwards:
--   update profiles set role = 'staff' where lower(username) = 'thename';
update profiles set role = 'staff'
 where lower(username) in ('tooway') and role is null;

-- ─────────────────────────────────────────── nobody promotes themselves

-- The update policy on profiles is "your own row", which is right for the
-- username and wrong for the role: without this, one UPDATE would make any
-- account an owner. Column grants would do it too, but a trigger holds
-- whatever else is granted later.
create or replace function profiles_role_is_owners() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and not (auth.uid() = owner_uid()
              or (select role from profiles where id = auth.uid()) = 'owner') then
    new.role := old.role;                 -- silently put back, not an error:
  end if;                                 -- a rename should still go through
  return new;
end $$;

drop trigger if exists profiles_role_guard on profiles;
create trigger profiles_role_guard before update on profiles
  for each row execute function profiles_role_is_owners();

-- ═════════════════════════════════════════════════════ asking about a role

-- security definer, so these read profiles without RLS and cannot recurse
-- into the policy that is asking them.
create or replace function my_role() returns text
  language sql stable security definer set search_path = public as $$
    select role from profiles where id = auth.uid()
$$;

-- The uid is kept alongside the role deliberately. If the role column is ever
-- wrong or the profile row missing, the owner would otherwise be locked out of
-- feature_locks and profiles both - which is the one state with no way back
-- from inside the site.
create or replace function is_owner() returns boolean
  language sql stable security definer set search_path = public as $$
    select auth.uid() = owner_uid()
        or coalesce((select role from profiles where id = auth.uid()), '') = 'owner'
$$;

-- The owner is staff and more, so every tooway-tier rule is one call.
create or replace function is_staff() returns boolean
  language sql stable security definer set search_path = public as $$
    select is_owner()
        or coalesce((select role from profiles where id = auth.uid()), '') = 'staff'
$$;

-- ══════════════════════════════════════════════════════ the tier per feature

create table if not exists feature_locks (
  feature     text primary key,
  unlocked    boolean not null default false,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

do $$
declare first_run boolean;
begin
  -- Whether this file has ever run here. The tiers below are the starting
  -- position, not a reset: run it twice after moving a switch and the switch
  -- keeps what it was moved to.
  first_run := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'feature_locks'
       and column_name = 'tier');

  if first_run then
    alter table feature_locks add column tier text;
    -- carry the old boolean across first, so nothing that was open shuts
    update feature_locks set tier = case when unlocked then 'tooway' else 'mine' end;
  end if;

  -- Every feature gets a row. The tiers are the ones asked for: the journal
  -- public, the working tools tooway, the two that are only ever mine shut.
  if first_run then
    insert into feature_locks (feature, tier) values
      ('journal',               'public'),
      ('tool:team',             'tooway'),
      ('tool:esn',              'tooway'),
      ('tool:project-update',   'tooway'),
      ('tool:bom',              'tooway'),
      ('tool:design-extractor', 'tooway'),
      ('tool:gin-extractor',    'tooway'),
      ('tool:site-access',      'tooway'),
      ('tool:site-data',        'tooway'),
      ('tool:field-config',     'tooway'),
      ('tool:lyric-video',      'mine'),
      ('tool:whattodo',         'mine')
    on conflict (feature) do update set tier = excluded.tier;
  else
    -- a later run only fills in features added since, at the safe tier
    insert into feature_locks (feature, tier) values
      ('journal',               'public'),
      ('tool:team',             'tooway'),
      ('tool:esn',              'tooway'),
      ('tool:project-update',   'tooway'),
      ('tool:bom',              'tooway'),
      ('tool:design-extractor', 'tooway'),
      ('tool:gin-extractor',    'tooway'),
      ('tool:site-access',      'tooway'),
      ('tool:site-data',        'tooway'),
      ('tool:field-config',     'tooway'),
      ('tool:lyric-video',      'mine'),
      ('tool:whattodo',         'mine')
    on conflict (feature) do nothing;
  end if;
end $$;

update feature_locks set tier = 'mine' where tier is null;

alter table feature_locks alter column tier set default 'mine';
alter table feature_locks alter column tier set not null;
alter table feature_locks drop constraint if exists feature_locks_tier_shape;
alter table feature_locks add constraint feature_locks_tier_shape
  check (tier in ('public', 'tooway', 'mine'));

-- `unlocked` becomes a shadow of the tier rather than a second answer to the
-- same question. Anything still reading the boolean keeps working and cannot
-- disagree with the tier, and writing it is now impossible by construction.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'feature_locks'
                and column_name = 'unlocked' and is_generated = 'NEVER') then
    alter table feature_locks drop column unlocked;
    alter table feature_locks add column unlocked boolean
      generated always as (tier <> 'mine') stored;
  end if;
end $$;

create or replace function feature_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end $$;

drop trigger if exists locks_touch_trg on feature_locks;
create trigger locks_touch_trg before update on feature_locks
  for each row execute function feature_touch();

-- ─────────────────────────────────────────────── the question every policy asks

create or replace function feature_tier(f text) returns text
  language sql stable security definer set search_path = public as $$
    select coalesce((select tier from feature_locks where feature = f), 'mine')
$$;

-- One call, three answers. A feature with no row is 'mine', so a tool added
-- to the site before its switch exists is shut rather than open - which is the
-- way round a mistake should fail.
create or replace function may_read(f text) returns boolean
  language sql stable security definer set search_path = public as $$
    select case feature_tier(f)
             when 'public' then true
             when 'tooway' then is_staff()
             else is_owner()
           end
$$;

grant execute on function feature_tier(text), may_read(text), is_owner(), is_staff(),
  my_role(), owner_uid() to anon, authenticated;

-- ═══════════════════════════════════ clearing the ground before rebuilding

-- Policies are OR-ed: one `using (true)` left behind on a table would let
-- everything past every rule written below it, and 001 is not in this
-- repository so its policy names cannot be listed by hand. Every policy on
-- the tables this file manages is dropped and then rebuilt, which is the only
-- way to be sure of what is left.
--
-- storage.objects is not in the list: it carries policies for buckets this
-- file knows nothing about, and those are dropped by name further down.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles','feature_locks','sites','datasets','books','todos',
                         'esn_records','design_sites','design_batches','lyric_projects',
                         'team_groups','team_people','team_vehicles','field_config',
                         'owner_gate','project_updates','imports','boms','bom_port_types')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════ the policies

-- ─────────────────────────────────────────────────────────────── profiles

-- Your own row always - the tool asks "who am I" on the way in. Staff may see
-- the team's names, because a filed record showing an email instead of a name
-- was the thing 006 set out to fix.
create policy "profiles_read" on profiles
  for select using (id = auth.uid() or is_staff());

-- Your own row, and only the username: the trigger above puts the role back.
create policy "profiles_update" on profiles
  for update using (id = auth.uid() or is_owner())
              with check (id = auth.uid() or is_owner());

-- ─────────────────────────────────────────────────────────── feature_locks

-- Readable by everyone, signed in or not, and that is not an oversight: a
-- public tier cannot work unless a page with no session can find out that
-- something is public. What it discloses is the list of switches and their
-- positions, which is what the Owner page shows on screen anyway.
create policy "locks_read" on feature_locks for select using (true);

create policy "locks_write" on feature_locks for all
  using (is_owner()) with check (is_owner());

-- ───────────────────────────────────── the site list  (tool:site-access)

do $$
begin
  if to_regclass('public.sites') is not null then
    execute $p$create policy "sites_read" on sites
      for select using (may_read('tool:site-access'))$p$;
    execute $p$create policy "sites_write" on sites
      for all using (is_owner()) with check (is_owner())$p$;
  end if;
end $$;

-- The heading list for both lookup tools, so either tier opens it.
create policy "datasets_read" on datasets
  for select using (may_read('tool:site-access') or may_read('tool:site-data'));
create policy "datasets_write" on datasets
  for all using (is_owner()) with check (is_owner());

-- ──────────────────────────────── the workbooks  (tool:project-update)

create policy "books_read" on books
  for select using (may_read('tool:project-update'));
create policy "books_write" on books
  for all using (is_owner()) with check (is_owner());

do $$
begin
  if to_regclass('public.project_updates') is not null then
    execute $p$create policy "pu_read" on project_updates
      for select using (may_read('tool:project-update'))$p$;
    execute $p$create policy "pu_write" on project_updates
      for all using (is_owner()) with check (is_owner())$p$;
  end if;
  if to_regclass('public.imports') is not null then
    execute $p$create policy "imports_read" on imports
      for select using (may_read('tool:project-update'))$p$;
    execute $p$create policy "imports_write" on imports
      for all using (is_owner()) with check (is_owner())$p$;
  end if;
end $$;

-- ─────────────────────────────────────── the job list  (tool:whattodo)

create policy "todos_read" on todos
  for select using (may_read('tool:whattodo'));
create policy "todos_write" on todos
  for all using (is_owner()) with check (is_owner());

-- ──────────────────────────────────────── filed ESNs  (tool:esn)

create policy "esn_read" on esn_records
  for select using (may_read('tool:esn'));

-- FIRST EXCEPTION to owner-only writing. Filing an ESN from the field is the
-- whole tool; a read-only ESN tool is not the same tool with fewer readers,
-- it is nothing. Gated on the tier all the same, so shutting the switch stops
-- the filing too.
create policy "esn_insert" on esn_records
  for insert with check (may_read('tool:esn') and created_by = auth.uid());

create policy "esn_update" on esn_records
  for update
  using      (is_owner() or (created_by = auth.uid() and may_read('tool:esn')))
  with check (is_owner() or (created_by = auth.uid() and may_read('tool:esn')));

create policy "esn_delete" on esn_records
  for delete using (is_owner());

-- ────────────────────────── the design books  (tool:design-extractor)

create policy "design_read" on design_sites
  for select using (may_read('tool:design-extractor'));

-- SECOND EXCEPTION, and the same reasoning: a design book is team data and
-- uploading one is what the tool does.
create policy "design_write" on design_sites
  for all
  using      (may_read('tool:design-extractor'))
  with check (may_read('tool:design-extractor'));

create policy "design_batch_read" on design_batches
  for select using (may_read('tool:design-extractor'));
create policy "design_batch_write" on design_batches
  for insert with check (may_read('tool:design-extractor'));

-- ─────────────────────────────── the BOM tables, if they exist  (tool:bom)

do $$
declare t text;
begin
  foreach t in array array['boms','bom_port_types'] loop
    if to_regclass('public.' || t) is not null then
      execute format($p$create policy "%s_read" on %I
        for select using (may_read('tool:bom'))$p$, t, t);
      execute format($p$create policy "%s_write" on %I
        for all using (is_owner()) with check (is_owner())$p$, t, t);
    end if;
  end loop;
end $$;

-- ──────────────────────────── the lyric projects  (tool:lyric-video)

-- Own rows only, as before, and now the tier on top: at 'mine' that is the
-- owner's own work, and if it is ever opened to tooway a staff member gets
-- their own projects rather than a window into anyone else's.
create policy "lyric_read" on lyric_projects
  for select using (created_by = auth.uid() and may_read('tool:lyric-video'));
create policy "lyric_insert" on lyric_projects
  for insert with check (created_by = auth.uid() and may_read('tool:lyric-video'));
create policy "lyric_update" on lyric_projects
  for update using (created_by = auth.uid() and may_read('tool:lyric-video'))
              with check (created_by = auth.uid() and may_read('tool:lyric-video'));
create policy "lyric_delete" on lyric_projects
  for delete using (created_by = auth.uid() and may_read('tool:lyric-video'));

-- ───────────────────────────────────── the directory  (tool:team)

create policy "team_groups_read" on team_groups
  for select using (may_read('tool:team'));
create policy "team_people_read" on team_people
  for select using (may_read('tool:team'));
create policy "team_vehicles_read" on team_vehicles
  for select using (may_read('tool:team'));

-- Opening the directory lets the team read and copy it. It has never let them
-- rewrite somebody's NIC number and it still does not.
create policy "team_groups_write" on team_groups
  for all using (is_owner()) with check (is_owner());
create policy "team_people_write" on team_people
  for all using (is_owner()) with check (is_owner());
create policy "team_vehicles_write" on team_vehicles
  for all using (is_owner()) with check (is_owner());

-- ──────────────────────────── the field reference  (tool:field-config)

create policy "field_config_read" on field_config
  for select using (may_read('tool:field-config'));
create policy "field_config_write" on field_config
  for all using (is_owner()) with check (is_owner());

-- ─────────────────────────────────────────────── the delete password

create policy "owner_gate_all" on owner_gate
  for all using (is_owner()) with check (is_owner());

-- ─────────────────── the two functions 012 and 013 left behind

-- They read `unlocked`, which is now generated from the tier, so they still
-- answer correctly - but they answer the old binary question and nothing
-- calls them any more. Redefined to point at the tier so that anything found
-- still using them gets the current answer rather than a stale one.
create or replace function team_open() returns boolean
  language sql stable security definer set search_path = public as $$
    select may_read('tool:team')
$$;
create or replace function field_config_open() returns boolean
  language sql stable security definer set search_path = public as $$
    select may_read('tool:field-config')
$$;

-- ══════════════════════════════════════════════════════════ the buckets

-- ESN screenshots follow the ESN records exactly.
drop policy if exists "esn_obj_read"   on storage.objects;
drop policy if exists "esn_obj_insert" on storage.objects;
drop policy if exists "esn_obj_delete" on storage.objects;

create policy "esn_obj_read" on storage.objects
  for select using (bucket_id = 'esn' and may_read('tool:esn'));
create policy "esn_obj_insert" on storage.objects
  for insert with check (bucket_id = 'esn' and may_read('tool:esn'));
create policy "esn_obj_delete" on storage.objects
  for delete using (bucket_id = 'esn' and (owner = auth.uid() or is_owner()));

-- Lyric files stay filed under their owner's uid, with the tier on top.
drop policy if exists "lyric_obj_read"   on storage.objects;
drop policy if exists "lyric_obj_insert" on storage.objects;
drop policy if exists "lyric_obj_delete" on storage.objects;

create policy "lyric_obj_read" on storage.objects
  for select using (bucket_id = 'lyric'
    and (storage.foldername(name))[1] = auth.uid()::text
    and may_read('tool:lyric-video'));
create policy "lyric_obj_insert" on storage.objects
  for insert with check (bucket_id = 'lyric'
    and (storage.foldername(name))[1] = auth.uid()::text
    and may_read('tool:lyric-video'));
create policy "lyric_obj_delete" on storage.objects
  for delete using (bucket_id = 'lyric'
    and (storage.foldername(name))[1] = auth.uid()::text);

-- ═══════════════════════════════════════════════ who am I, with the role

-- The site needs the role on the way in to know which tabs to draw. One row,
-- your own, and it is the only way the browser learns it - the role is not
-- readable from the session token.
create or replace function my_profile() returns table (username text, email text, role text)
language sql security definer stable set search_path = public as $$
  select p.username, p.email, p.role from profiles p where p.id = auth.uid();
$$;

revoke all on function my_profile() from public;
grant execute on function my_profile() to authenticated;

-- ═════════════════════════════════════════════════════════════════ check
--
-- Who is what:
--   select username, email, role from profiles order by role nulls last, username;
--
-- What is at which tier:
--   select feature, tier from feature_locks order by tier, feature;
--
-- Every policy now standing, and what it asks:
--   select tablename, policyname, cmd, qual from pg_policies
--    where schemaname = 'public' order by tablename, policyname;
--
-- Nothing should mention auth.role() any more:
--   select tablename, policyname from pg_policies
--    where schemaname = 'public' and qual like '%auth.role()%';
