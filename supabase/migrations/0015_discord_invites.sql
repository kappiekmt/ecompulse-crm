-- 0015 — Discord invite tracking on students.
--
-- Stores the one-time invite URL the bot generates per student so the
-- thank-you flow can hand it to them and admins can re-issue when needed.
-- Auto-applied via supabase db query to avoid colliding with the
-- still-unapplied 0014_coaching_tier migration on the payments branch.

alter table students
  add column if not exists discord_invite_url text,
  add column if not exists discord_invite_code text,
  add column if not exists discord_invite_expires_at timestamptz;
