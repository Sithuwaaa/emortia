-- Emortia · migration 014 — a password in front of deleting
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- This is not a second lock against other people. Nobody but the owner can
-- write to the directory at all - migration 012 settles that in the policies,
-- and it has not changed. This is a lock against the owner's own hand: a row
-- removed by a mis-click is gone from every device at once, and there is no
-- undo behind it.
--
-- So the password is stored the way passwords are stored even though the only
-- person it is kept from is the person who set it: a salt and a PBKDF2 hash,
-- never the password. The row is readable only by the owner, which means the
-- page can check an attempt without the hash ever being public.
--
-- Forgotten it? Delete the row here and the tool will offer to set a new one.

create table if not exists owner_gate (
  id          text primary key default 'team-delete',
  salt        text not null,
  hash        text not null,
  iter        int  not null default 210000,
  updated_at  timestamptz not null default now()
);

alter table owner_gate enable row level security;

drop policy if exists "owner_gate_all" on owner_gate;

-- Read and write both, owner only. Nobody else has any business knowing
-- whether a gate is even set.
create policy "owner_gate_all" on owner_gate for all
  using      (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid)
  with check (auth.uid() = '9ac28d61-aa17-43ce-85a1-f8cd2fe131f6'::uuid);

create or replace function owner_gate_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists owner_gate_touch_trg on owner_gate;
create trigger owner_gate_touch_trg before update on owner_gate
  for each row execute function owner_gate_touch();

-- No row is seeded. Until one exists the tool will not delete anything and
-- says so, which is the safe way round: a gate that has never been set should
-- refuse rather than wave things through.
