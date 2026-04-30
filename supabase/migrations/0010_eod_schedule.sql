-- 0010 — Enable pg_cron + pg_net so the EOD Slack report can be scheduled.
--
-- The actual cron job is registered separately (one-time, with an admin token
-- injected at runtime) so the service_role JWT never lands in git. See
-- supabase/scripts/schedule-eod.md for the registration steps.

create extension if not exists pg_cron;
create extension if not exists pg_net;
