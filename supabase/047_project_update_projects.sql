-- 047  Project Update: the Excel browser's projects, synced.
--
-- The browser half has kept its projects in IndexedDB since it shipped,
-- which means a project created on the laptop does not exist on the phone
-- and does not exist for anybody else. Same reason Year Goals needed a
-- table.
--
-- TWO TABLES, NOT ONE, and not the `books` shape. `books` is one row per
-- dataset with every sheet in a single jsonb column, and that is right for
-- `books`: it has exactly two rows, forever, and the dashboard reads all of
-- it every time. None of that holds here.
--
--   * cardinality - projects are unbounded and keep every upload as history
--   * a project is NEVER read whole; the list view needs none of its rows
--   * realtime ships the entire row, and a project-shaped row would be
--     200-570 kB and growing. Oversized payloads are dropped silently,
--     which is a failure this repository has already paid for once.
--
-- Measured on four real workbooks before any of this was written:
--
--   a project of two workbooks     204-572 kB stored, 39-60 kB on the wire
--   the biggest single sheet       141 kB stored, 10.2 kB on the wire
--   one card on the project list   165 B stored, 141 B on the wire
--   every sheet of every project   776 kB stored, 88 kB on the wire
--
-- 88 kB against 278 B is the whole reason pu_reports.payload lives in its
-- own row and is never selected unless a sheet is actually opened.

create table if not exists public.pu_projects (
  id          text primary key,
  name        text not null,
  client      text        not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  -- Summary, written at upload time so the list view never reads a row of
  -- a sheet. Without these, drawing "30% done" on a card means profiling
  -- every row of every sheet of every project, which is the select('*')
  -- shape with extra steps.
  n_files     integer not null default 0,
  n_sheets    integer not null default 0,
  n_rows      integer not null default 0,
  pct         integer,                       -- null when no status column
  -- The output of harvestSites, not the rows it reads: the MOD panel needs
  -- site ids from every row, and this is 2.7 kB where the rows are 30 kB.
  sites       jsonb not null default '{}'::jsonb
);

create table if not exists public.pu_reports (
  id          text primary key,
  project_id  text not null references public.pu_projects(id) on delete cascade,
  file        text not null,
  sheet       text not null,
  uploaded    timestamptz not null default now(),
  -- the per-sheet summary a tile draws, again so the tile needs no payload
  n_rows      integer not null default 0,
  n_cols      integer not null default 0,
  kind        text    not null default 'list',   -- mat | trk | list
  pct         integer,
  items       integer,
  short       integer,
  -- THE ONLY BIG COLUMN IN EITHER TABLE. { cols: [...], rows: [[...]] }.
  -- Selected by id, when a sheet is opened, and at no other time.
  payload     jsonb not null default '{}'::jsonb
);

create index if not exists pu_reports_project_idx on public.pu_reports (project_id);
create index if not exists pu_reports_latest_idx  on public.pu_reports (project_id, file, sheet, uploaded desc);

alter table public.pu_projects enable row level security;
alter table public.pu_reports  enable row level security;

-- Reads follow books exactly: anyone the feature is granted to sees
-- everything. Writes are owner-only, also like books - a teammate's
-- half-uploaded project sitting in a shared list is not reversible, and
-- opening writes up later is.
drop policy if exists pu_projects_read  on public.pu_projects;
drop policy if exists pu_projects_write on public.pu_projects;
create policy pu_projects_read  on public.pu_projects for select
  using (may_read('tool:project-update'));
create policy pu_projects_write on public.pu_projects for all
  using (is_owner()) with check (is_owner());

drop policy if exists pu_reports_read  on public.pu_reports;
drop policy if exists pu_reports_write on public.pu_reports;
create policy pu_reports_read  on public.pu_reports for select
  using (may_read('tool:project-update'));
create policy pu_reports_write on public.pu_reports for all
  using (is_owner()) with check (is_owner());

-- REALTIME ON pu_projects ONLY, and this is not an oversight.
--
-- postgres_changes sends the whole changed row. A pu_reports row carries
-- the payload - up to 141 kB measured, and nothing stops it being larger -
-- and Supabase drops oversized payloads without telling the client. A
-- subscription that silently stops delivering is worse than none, because
-- the tool looks like it is listening.
--
-- pu_projects rows are a few hundred bytes. The tool watches those, and
-- when one changes it refetches that project's report METADATA. Payloads
-- never travel over the socket.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pu_projects'
  ) then
    alter publication supabase_realtime add table public.pu_projects;
  end if;
end $$;

-- Deliberately NOT added to supabase_realtime: public.pu_reports.
-- If a later migration adds it, read the paragraph above first.
