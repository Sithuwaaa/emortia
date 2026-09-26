-- Emortia · migration 031 — the clock, one person at a time
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
-- Run 018 and 019 first.
--
-- WHAT THIS ADDS AND WHY
--
-- 019 gave the crews a way to file a photograph with no account: a link with
-- a token in it, and one function that takes a picture and gives back nothing.
-- That function is device-level. It answers "this phone clocked in at 06:12",
-- and the office ticks the faces afterwards.
--
-- The clock screen is a different shape of the same idea: one person, on a
-- shared phone, who picks their name once and then taps a single button. That
-- needs three things 019 has no way to do, so they are here rather than bent
-- out of the old ones - 019 keeps working exactly as it does, and the screen
-- it serves is untouched.
--
--   1. The roster, to a device with no session. Reading attend_people needs
--      may_read('tool:attendance'), which the crews will never have. Without
--      it there is no name to pick. So: one function, names only, and only to
--      a live token.
--
--   2. Per-person state, from the server. A phone that was closed, restarted
--      or flat must be able to ask "am I clocked in?" and be told the truth by
--      something other than its own storage.
--
--   3. Writes that can be retried safely. The screen keeps a failed save on
--      the device and sends it again later, so the same clock-in will arrive
--      twice whenever a reply is lost on the way back - the write went in, the
--      phone never heard. The caller names the row, and a second arrival with
--      the same name is a no-op that still answers "filed". Without this the
--      retry loop is a duplicate factory.
--
-- What a token can still do is only this: file a photograph for itself, read
-- the roster of names, and ask about one person's own day. It cannot read a
-- record, a photograph, another day, another device, or anything at all in
-- the rest of the database.

-- ──────────────────────────────────────────────── finding one person's rows

-- Both functions below ask "which records name this person", which without
-- an index is a scan of every photograph ever filed. members is jsonb, so
-- the containment operators want GIN - and the default opclass rather than
-- jsonb_path_ops, because jsonb_path_ops indexes @> and not the ? these
-- queries use.
create index if not exists attend_records_members
  on attend_records using gin (members);

-- and the status query walks back by time across days
create index if not exists attend_records_taken
  on attend_records (taken_at desc);

-- ────────────────────────────────────────────────── who is on the roster

-- Names and nothing else. Not the photographs, not the records, not the
-- device table - and only ever to a token that is live.
create or replace function attend_roster(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare dev attend_devices%rowtype;
begin
  select * into dev from attend_devices where token = p_token and active limit 1;
  if not found then
    return json_build_object('ok', false, 'why', 'This device link is not recognised.');
  end if;

  return json_build_object('ok', true, 'people', coalesce((
    select json_agg(json_build_object('id', id, 'name', name, 'role', role)
                    order by sort, name)
      from attend_people where active), '[]'::json));
end $$;

revoke all on function attend_roster(text) from public;
grant execute on function attend_roster(text) to anon, authenticated;

-- ──────────────────────────────────────────── am I clocked in right now?

-- The one question the screen cannot answer for itself. Asked on every open,
-- because the device's own memory is not evidence: it survives being closed,
-- but not being reinstalled, and it is wrong the moment somebody clocks out
-- on a different phone.
--
-- A shift that crosses midnight is still a shift, so this looks at the last
-- eighteen hours rather than at the calendar day alone. Somebody who clocked
-- in at ten last night is still clocked in at two this morning.
create or replace function attend_status(p_token text, p_person text) returns json
language plpgsql security definer set search_path = public as $$
declare
  dev  attend_devices%rowtype;
  last attend_records%rowtype;
  nm   text;
begin
  select * into dev from attend_devices where token = p_token and active limit 1;
  if not found then
    return json_build_object('ok', false, 'why', 'This device link is not recognised.');
  end if;

  select name into nm from attend_people where id = p_person and active;
  if nm is null then
    return json_build_object('ok', false, 'why', 'That name is not on the roster any more.');
  end if;

  select * into last from attend_records
   where members ? p_person
     and taken_at > now() - interval '18 hours'
   order by taken_at desc limit 1;

  return json_build_object(
    'ok', true,
    'name', nm,
    /* the server's clock, so the screen can work out how long they have been
       on without trusting the handset's idea of the time */
    'now', now(),
    'state', case when found and last.kind = 'in' then 'in' else 'out' end,
    'since', case when found and last.kind = 'in' then last.taken_at else null end);
end $$;

revoke all on function attend_status(text, text) from public;
grant execute on function attend_status(text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────── filing one person's stamp

-- p_id is the caller's name for the row. The phone makes it before it sends,
-- keeps it with the queued photograph, and uses the same one on every retry -
-- so a reply lost on the way back costs a second request and nothing else.
create or replace function attend_clock(
  p_token text, p_person text, p_kind text, p_geo text, p_photo text, p_id text
) returns json
language plpgsql security definer set search_path = public as $$
declare
  dev   attend_devices%rowtype;
  today date := (now() at time zone 'Asia/Colombo')::date;
  nm    text;
  n     int;
  rid   text;
  at_   timestamptz;
begin
  if p_kind not in ('in','out') then
    return json_build_object('ok', false, 'why', 'That is not a clock-in or a clock-out.');
  end if;
  if p_photo is null or length(p_photo) < 100 or length(p_photo) > 600000 then
    return json_build_object('ok', false, 'why', 'That photo is the wrong size.');
  end if;
  -- the caller names the row, but it does not get to choose the shape
  if p_id is null or p_id !~ '^C[0-9a-f]{24,40}$' then
    return json_build_object('ok', false, 'why', 'That is not a usable record id.');
  end if;

  select * into dev from attend_devices where token = p_token and active limit 1;
  if not found then
    return json_build_object('ok', false, 'why', 'This device link is not recognised. Ask Sithara for a new one.');
  end if;

  select name into nm from attend_people where id = p_person and active;
  if nm is null then
    return json_build_object('ok', false, 'why', 'That name is not on the roster any more.');
  end if;

  -- Already filed: the write landed and the answer went missing. Say yes
  -- again, with the time it actually went in, and change nothing.
  select taken_at into at_ from attend_records where id = p_id;
  if found then
    return json_build_object('ok', true, 'kind', p_kind, 'at', at_, 'again', true);
  end if;

  -- A person files two stamps a day, four if a shift is split. Twenty is far
  -- past honest use and still stops a forwarded link filling the table.
  select count(*) into n from attend_records
   where day = today and members ? p_person;
  if n >= 20 then
    return json_build_object('ok', false, 'why', 'That is too many stamps for one day. Tell the office.');
  end if;

  rid := p_id;
  insert into attend_records (id, day, kind, taken_at, geo, photo, photo_data, members, ref)
  values (rid, today, p_kind, now(), coalesce(p_geo, ''), '', p_photo,
          jsonb_build_array(p_person),
          'C:' || dev.id || ':' || p_person)
  on conflict (id) do nothing;

  select taken_at into at_ from attend_records where id = rid;
  update attend_devices set last_used = now() where id = dev.id;

  -- The time comes back from the server because the server is what wrote it.
  -- A handset's clock can be wrong, and can be set wrong on purpose.
  return json_build_object('ok', true, 'kind', p_kind, 'at', at_);
end $$;

revoke all on function attend_clock(text, text, text, text, text, text) from public;
grant execute on function attend_clock(text, text, text, text, text, text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════ check
--
-- With the anon key and no session, using a live token:
--   select attend_roster('<token>');                       -- the names
--   select attend_status('<token>', '<person id>');         -- out, to start
--   select attend_clock('<token>','<person>','in','6.9, 79.8','data:image/jpeg;base64,...','C0123456789abcdef01234567');
--   select attend_status('<token>', '<person id>');         -- in, with a since
--   -- the same id again is a no-op that still says ok, and adds no row:
--   select attend_clock('<token>','<person>','in','','data:image/jpeg;base64,...','C0123456789abcdef01234567');
--
-- And nothing else is readable on that path. All three stay empty:
--   select * from attend_records;  select * from attend_people;  select * from attend_devices;
