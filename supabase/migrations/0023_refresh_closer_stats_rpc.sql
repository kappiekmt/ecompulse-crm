-- 0023 — RPC helper for refreshing the closer stats materialized view.
--
-- Edge functions can't issue raw `REFRESH MATERIALIZED VIEW`, so we wrap
-- it in a SECURITY DEFINER function that the service-role JWT can call
-- via PostgREST RPC.

create or replace function refresh_closer_stats_daily()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  refresh materialized view concurrently closer_stats_daily;
end;
$fn$;

revoke all on function refresh_closer_stats_daily() from public;
grant execute on function refresh_closer_stats_daily() to service_role;
