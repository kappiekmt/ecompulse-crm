# Scheduling the EOD Slack report (21:00 Amsterdam, DST-aware)

`Europe/Amsterdam` switches between **CEST** (UTC+2, summer) and **CET** (UTC+1, winter). Since `pg_cron` requires a server restart to change `cron.timezone` (we don't have that on Supabase), we schedule **two cron jobs** — one for each offset — and let the edge function gate on the actual local hour. Net effect: exactly one send per day, automatic DST handling.

The migration `0010_eod_schedule.sql` enables `pg_cron` and `pg_net`. The two cron jobs are registered separately (one-time, with a `service_role` JWT injected at runtime) so the JWT never lands in this public repo.

## Register the schedule

In **Supabase Dashboard → SQL Editor**, replace `<YOUR_SERVICE_ROLE_KEY>` with the value from **Settings → API → `service_role`**, then run:

```sql
-- Drop any prior schedule under these names (no-ops if absent)
do $o$ begin perform cron.unschedule('eod-report-amsterdam-cest'); exception when others then null; end $o$;
do $o$ begin perform cron.unschedule('eod-report-amsterdam-cet');  exception when others then null; end $o$;

-- 21:00 Amsterdam during CEST (Apr–Oct, UTC+2) = 19:00 UTC
select cron.schedule('eod-report-amsterdam-cest', '0 19 * * *', $cron$
  select net.http_post(
    url := 'https://ecdqlgigczmiilvztsno.supabase.co/functions/v1/eod-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  ) as request_id;
$cron$);

-- 21:00 Amsterdam during CET (Nov–Mar, UTC+1) = 20:00 UTC
select cron.schedule('eod-report-amsterdam-cet', '0 20 * * *', $cron$
  select net.http_post(
    url := 'https://ecdqlgigczmiilvztsno.supabase.co/functions/v1/eod-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  ) as request_id;
$cron$);
```

The function checks the current Amsterdam hour: if it's not 21, the call returns `{ ok: false, skipped: "not 21:00 amsterdam" }` and Slack is never hit. So during CEST only the 19:00 UTC firing actually sends; during CET only the 20:00 UTC firing does.

## Verifying

```sql
select jobname, schedule, active from cron.job order by jobname;
-- → eod-report-amsterdam-cest | 0 19 * * * | t
-- → eod-report-amsterdam-cet  | 0 20 * * * | t

-- Last 5 outbound EOD events (cron + manual button):
select event_type, status, response_payload, created_at
from integrations_log
where provider = 'slack' and event_type = 'eod_report'
order by created_at desc limit 5;

-- pg_net call results (from cron):
select id, status_code, left(content::text, 120) as body, created
from net._http_response
order by id desc limit 5;
```

## Pausing without unscheduling

The function checks `automation_settings.daily_eod_reports.enabled`. Toggle it off in **CRM → Integrations → Automations** to skip cron sends without removing the cron jobs. Manual button presses always send (admin override).

## Manual trigger from the Dashboard

The "Send Team EOD" button on the Dashboard calls the function with the admin's JWT. The function bypasses the time gate AND the toggle for manual calls — so you always see the message in Slack, regardless of hour.
