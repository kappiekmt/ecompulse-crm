-- 0031 — Fix Cash Collected / Order Value being inflated by a join fan-out.
--
-- kpi_snapshot_v (dashboard headline) and closer_performance_v (leaderboard)
-- flat-joined leads → call_outcomes → deals → payments and then SUM()'d the
-- payment / deal amounts. When a lead has multiple deals or call_outcomes, each
-- payment row gets multiplied by (#call_outcomes × #deals) for that lead, so the
-- sums over-count. The count(distinct …) columns were unaffected (distinct
-- dedupes the multiplied rows) — only the plain SUM()s were wrong.
--
-- Fix: aggregate each table independently (no cross join), like daily_metrics_v
-- already does. Output columns + semantics are unchanged.

begin;

-- ── kpi_snapshot_v ───────────────────────────────────────────────────────────
create or replace view kpi_snapshot_v as
with
  pay as (
    select coalesce(sum(amount_cents) filter (where is_refund = false), 0) as cash_collected_cents
    from payments
  ),
  dl as (
    select
      coalesce(sum(amount_cents) filter (where status = 'won'), 0) as order_value_cents,
      count(*) filter (where status = 'won') as wins,
      count(*) filter (where status in ('won', 'lost')) as decisive
    from deals
  ),
  ld as (
    select count(*) as calls_booked
    from leads
  ),
  co as (
    select
      count(*) filter (where result in ('showed', 'no_show')) as showed_or_no_show,
      count(*) filter (where result = 'showed') as showed,
      count(*) filter (where result in ('rescheduled', 'no_show')) as cancels_or_no_shows
    from call_outcomes
  )
select
  pay.cash_collected_cents,
  dl.order_value_cents,
  ld.calls_booked,
  case when co.showed_or_no_show = 0 then 0
       else round(100.0 * co.showed::numeric / co.showed_or_no_show, 1) end as show_up_rate_pct,
  case when dl.decisive = 0 then 0
       else round(100.0 * dl.wins::numeric / dl.decisive, 1) end as conversion_rate_pct,
  case when ld.calls_booked = 0 then 0
       else round(100.0 * co.cancels_or_no_shows::numeric / ld.calls_booked, 1) end as cancel_rate_pct,
  case when ld.calls_booked = 0 then 0
       else dl.order_value_cents / ld.calls_booked end as avg_order_per_call_cents,
  case when dl.wins = 0 then 0
       else dl.order_value_cents / dl.wins end as avg_order_per_close_cents
from pay, dl, ld, co;

-- ── closer_performance_v ──────────────────────────────────────────────────────
-- The count(distinct …) columns were already correct; only cash_collected_cents
-- (a plain SUM) was fanned out. Make it an independent per-closer subquery and
-- drop the payments join.
create or replace view closer_performance_v as
select
  tm.id as closer_id,
  tm.full_name,
  count(distinct l.id) filter (where l.stage in ('booked','confirmed')) as calls_booked,
  count(distinct co.id) filter (where co.result = 'showed') as calls_showed,
  count(distinct co.id) filter (where co.result in ('pitched','closed')) as calls_pitched,
  count(distinct d.id) filter (where d.status = 'won') as deals_won,
  count(distinct d.id) filter (where d.status = 'lost') as deals_lost,
  coalesce((
    select sum(p.amount_cents)
    from payments p
    join leads pl on pl.id = p.lead_id
    where pl.closer_id = tm.id and p.is_refund = false
  ), 0) as cash_collected_cents,
  case
    when count(distinct co.id) filter (where co.result in ('showed','no_show')) = 0 then 0
    else round(
      100.0 * count(distinct co.id) filter (where co.result = 'showed')::numeric
      / count(distinct co.id) filter (where co.result in ('showed','no_show'))
    , 1)
  end as show_rate_pct,
  case
    when count(distinct co.id) filter (where co.result = 'showed') = 0 then 0
    else round(
      100.0 * count(distinct d.id) filter (where d.status = 'won')::numeric
      / count(distinct co.id) filter (where co.result = 'showed')
    , 1)
  end as close_rate_pct
from team_members tm
left join leads l on l.closer_id = tm.id
left join call_outcomes co on co.closer_id = tm.id
left join deals d on d.lead_id = l.id
where 'closer' = any(tm.roles) and tm.is_active = true
group by tm.id, tm.full_name;

commit;
