# Scheduling the EOW Slack report (Sundays 22:00 Amsterdam, DST-aware)

The end-of-week summary posts to the **same #eod webhook** as the daily report, one hour after Sunday's final EOD (which fires at 21:00). Same DST problem as the EOD: `Europe/Amsterdam` is **CEST** (UTC+2) in summer and **CET** (UTC+1) in winter, and `pg_cron` can't change `cron.timezone` without a server restart (not available on Supabase). So we register **two cron jobs** — one per offset — and let the edge function gate on the actual local day + hour. Net effect: exactly one send each Sunday night, DST handled automatically.

`pg_cron` and `pg_net` are already enabled by migration `0010_eod_schedule.sql`; nothing extra to enable here. The two cron jobs below are registered separately (one-time, with a `service_role` JWT injected at runtime) so the JWT never lands in this public repo.

## Register the schedule

In **Supabase Dashboard → SQL Editor**, replace `<YOUR_SERVICE_ROLE_KEY>` with the value from **Settings → API → `service_role`**, then run:

```sql
-- Drop any prior schedule under these names (no-ops if absent)
do $o$ begin perform cron.unschedule('eow-report-amsterdam-cest'); exception when others then null; end $o$;
do $o$ begin perform cron.unschedule('eow-report-amsterdam-cet');  exception when others then null; end $o$;

-- 22:00 Amsterdam during CEST (Apr–Oct, UTC+2) = 20:00 UTC, Sundays (dow 0)
select cron.schedule('eow-report-amsterdam-cest', '0 20 * * 0', $cron$
  select net.http_post(
    url := 'https://ecdqlgigczmiilvztsno.supabase.co/functions/v1/eow-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  ) as request_id;
$cron$);

-- 22:00 Amsterdam during CET (Nov–Mar, UTC+1) = 21:00 UTC, Sundays (dow 0)
select cron.schedule('eow-report-amsterdam-cet', '0 21 * * 0', $cron$
  select net.http_post(
    url := 'https://ecdqlgigczmiilvztsno.supabase.co/functions/v1/eow-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  ) as request_id;
$cron$);
```

The function checks the current Amsterdam day + hour: unless it's **Sunday 22:00** the call returns `{ ok: false, skipped: "..." }` and Slack is never hit. So during CEST only the 20:00 UTC firing actually sends; during CET only the 21:00 UTC firing does.

> Note on `dow`: with `cron.timezone` at its UTC default, `0 21 * * 0` triggers Sunday **21:00 UTC**, which is still Sunday in Amsterdam — so the dow stays correct across the offset. The CEST row at `0 20 * * 0` is likewise Sunday in both zones. No Saturday/Monday spill.

## Verifying

```sql
select jobname, schedule, active from cron.job where jobname like 'eow-%' order by jobname;
-- → eow-report-amsterdam-cest | 0 20 * * 0 | t
-- → eow-report-amsterdam-cet  | 0 21 * * 0 | t

-- Last 5 outbound EOW events (cron + manual button):
select event_type, status, response_payload, created_at
from integrations_log
where provider = 'slack' and event_type = 'eow_report'
order by created_at desc limit 5;

-- pg_net call results (from cron):
select id, status_code, left(content::text, 120) as body, created
from net._http_response
order by id desc limit 5;
```

## Pausing without unscheduling

The function checks `automation_settings.weekly_report.enabled`. Toggle it off in **CRM → Integrations → Automations** to skip cron sends without removing the cron jobs. Manual button presses always send (admin override).

## Manual trigger from the Dashboard

The "Send Weekly" button on the Manager Dashboard calls the function with the admin's JWT. The function bypasses the day/time gate AND the toggle for manual calls — so you always see the message in Slack, regardless of when you click. Mid-week, it reports the **current week-to-date** (Monday 00:00 → now); to backfill a completed week, POST `{ "week_start": "YYYY-MM-DD" }` with a Monday.
