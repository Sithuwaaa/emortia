-- Emortia · migration 009 — UMPT password, and room for bigger screenshots
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.

-- ─────────────────────────────────────────────────────────── the password

-- The UMPT's own login, kept with the site it belongs to. This is the
-- board's credential, not a person's — it is what the next engineer needs to
-- get into the same cabinet, and hunting for it in a chat thread is how it
-- gets lost.
--
-- Worth being clear about what this is: it sits in the row like everything
-- else, and every signed-in member of the team can read it, exactly as they
-- can read the ESN and the O&M IP. That is the point of the tool. It is not
-- hashed and it is not encrypted, because a password nobody can read back is
-- no use to the person standing at the site. Keep it to equipment logins.
alter table esn_records add column if not exists umpt_password text;

comment on column esn_records.umpt_password is
  'UMPT board login for this site. Readable by any signed-in member of the team.';

-- ────────────────────────────────────────────────────── bigger screenshots

-- Screenshots go up exactly as they were taken — nothing is resized and
-- nothing is re-encoded, so an ESN stays readable when it is zoomed into. A
-- full-resolution grab off a 4K screen can pass fifty megabytes, and being
-- refused at that point means going back to the site. A hundred is past
-- anything a print screen produces.
update storage.buckets
   set file_size_limit = 104857600
 where id = 'esn';

-- and while we are here, allow the formats a modern screenshot tool emits
update storage.buckets
   set allowed_mime_types = array[
        'image/png','image/jpeg','image/webp','image/gif','image/bmp',
        'image/avif','image/heic','image/heif','image/tiff']
 where id = 'esn';
