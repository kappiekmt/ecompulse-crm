# Scheduling the EOW Slack report (Sundays 22:00 Amsterdam, DST-aware)

> **Status: already registered** (May 2026) — `eow-report-amsterdam-cest` and
> `eow-report-amsterdam-cet` exist in `cron.job` and are `active`. This doc is
> the reference for how they were created / how to recreate them.

The end-of-week summary posts to the **same #eod webhook** as the daily report, one hour after Sunday's final EOD (which fires at 21:00). Same DST problem as the EOD: `Europe/Amsterdam` is **CEST** (UTC+2) in summer and **CET** (UTC+1) in winter, and `pg_cron` can't change `cron.timezone` without a server restart (not available on Supabase). We solve it the same way every other job in this project does — **two cron rows split by month-range**: a CEST row that only fires April–October and a CET row that only fires November–March. Exactly one is ever in season, so only one fires each Sunday. (The function *also* self-gates on the local day+hour as a belt-and-suspenders check.)

`pg_cron` and `pg_net` are already enabled by migration `0010_eod_schedule.sql`; nothing extra to enable here.

## Register the schedule

These were registered via `supabase db query --linked`, reading the `service_role` token straight out of the existing EOD job so it never gets typed or committed:

```sql
do $do$
declare
  v_tok text;
  v_url text := 'https://ecdqlgigczmiilvztsno.supabase.co/functions/v1/eow-report';
begin
  select (regexp_match(command, 'Bearer ([A-Za-z0-9._-]+)'))[1] into v_tok
    from cron.job where jobname = 'eod-report-amsterdam-cest' limit 1;

  if exists (select 1 from cron.job where jobname = 'eow-report-amsterdam-cest') then
    perform cron.unschedule('eow-report-amsterdam-cest');
  end if;
  if exists (select 1 from cron.job where jobname = 'eow-report-amsterdam-cet') then
    perform cron.unschedule('eow-report-amsterdam-cet');
  end if;

  -- 22:00 Amsterdam, Sundays. CEST (Apr–Oct) = 20:00 UTC; CET (Nov–Mar) = 21:00 UTC.
  perform cron.schedule('eow-report-amsterdam-cest', '0 20 * 4-10 0', format($cmd$
  select net.http_post(url := %L,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
    body := '{}'::jsonb) as request_id;
$cmd$, v_url, v_tok));

  perform cron.schedule('eow-report-amsterdam-cet', '0 21 * 1-3,11,12 0', format($cmd$
  select net.http_post(url := %L,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
    body := '{}'::jsonb) as request_id;
$cmd$, v_url, v_tok));
end
$do$;
```

If you ever rotate the `service_role` key, re-run this block — it re-reads the (new) token from the EOD job, so update the EOD job first (or swap the source).

The function also checks the Amsterdam day + hour: unless it's **Sunday 22:00** it returns `{ ok: false, skipped: "..." }` and Slack is never hit — verified at registration time (a Friday test returned exactly that).

## Verifying

```sql
select jobname, schedule, active from cron.job where jobname like 'eow-%' order by jobname;
-- → eow-report-amsterdam-cest | 0 20 * 4-10 0      | t
-- → eow-report-amsterdam-cet  | 0 21 * 1-3,11,12 0 | t

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

## Forcing a send from SQL (server-side test)

To verify the report end-to-end without the dashboard, POST `{ "force": true }` with the `service_role` token — it bypasses the Sunday/22:00/toggle gate but still requires valid auth. The cron never sets `force`. Used to verify the schedule at registration time:

```sql
do $do$
declare v_tok text;
begin
  select (regexp_match(command,'Bearer ([A-Za-z0-9._-]+)'))[1] into v_tok
    from cron.job where jobname='eod-report-amsterdam-cest' limit 1;
  perform net.http_post(
    url := 'https://ecdqlgigczmiilvztsno.supabase.co/functions/v1/eow-report',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_tok),
    body := '{"force":true}'::jsonb);
end $do$;
-- then check: select status, response_payload->>'status', error from integrations_log
--             where event_type='eow_report' order by created_at desc limit 1;
```
