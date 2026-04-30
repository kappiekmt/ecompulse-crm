# Scheduling the EOD Slack report

The migration `0010_eod_schedule.sql` enables `pg_cron` and `pg_net`. The cron job itself isn't in the migration because it embeds the project's `service_role` JWT, which would leak in this public repo.

To register (or rotate) the schedule, run this SQL in **Supabase Dashboard → SQL Editor**, replacing `<YOUR_SERVICE_ROLE_KEY>` with the value from **Settings → API → `service_role`**:

```sql
-- Drop any prior schedule under the same name (no-op if absent)
do $outer$
begin
  perform cron.unschedule('eod-report-daily-2100-dubai');
exception when others then
  null;
end
$outer$;

-- 17:00 UTC = 21:00 Asia/Dubai (Dubai stays UTC+4 year-round, no DST)
select cron.schedule('eod-report-daily-2100-dubai', '0 17 * * *', $cron$
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

## Verifying the schedule

```sql
select jobname, schedule from cron.job;
-- → eod-report-daily-2100-dubai | 0 17 * * *

-- Manually trigger once (queues an http_post in pg_net):
select net.http_post(
  url := 'https://ecdqlgigczmiilvztsno.supabase.co/functions/v1/eod-report',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
  ),
  body := '{}'::jsonb
);

-- Last 3 deliveries from pg_net:
select id, status_code, left(content::text, 150) as body
from net._http_response
order by id desc limit 3;

-- Audit trail of every EOD send:
select event_type, status, response_payload, error, created_at
from integrations_log
where provider = 'slack' and event_type like 'eod_report%'
order by created_at desc limit 10;
```

## Pausing without unscheduling

The function checks `automation_settings.daily_eod_reports.enabled`. Toggle it off in **CRM → Integrations → Automations** to skip sends without removing the cron job. The cron still fires; the edge function just returns `{ok:false, skipped:"automation disabled"}`.

## Manual trigger from the Dashboard

The "Send Team EOD" button on the Dashboard calls the function with `{ test: true }` so the message is prefixed `🧪 TEST · `. Useful for verifying formatting.
