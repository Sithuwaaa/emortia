-- Emortia · migration 029 — the RF jumper colour codes get a switch
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- The tool itself needs no table: the chart is a reference drawing, rebuilt
-- as data in tools/rf-jumper/chart.js. What it needs is its row here, so the
-- Owner page can set who opens it. Until this runs, feature_tier() answers
-- 'mine' for a key nobody has set, so the tool is shut to everyone but the
-- owner - the safe way round, and not what is wanted for a field reference.

insert into feature_locks (feature, tier) values ('tool:rf-jumper', 'tooway')
on conflict (feature) do nothing;

-- ═══════════════════════════════════════════════════════════════════ check
--
--   select feature, tier from feature_locks where feature = 'tool:rf-jumper';
--   -- tool:rf-jumper | tooway
