-- 0025 — Closer call statistics view.
--
-- Surfaces per-closer rollups from the new `calls` table: total calls, avg
-- duration, close rate (closed_won / non-pending outcomes), and how many
-- calls Claude flagged for sales-lead review.
--
-- Read by:
--   - useCloserCallStats() in src/lib/queries/calls.ts
--   - the Reports page's "Calls" block
--   - the per-closer dashboard

create or replace view closer_call_stats_v as
with totals as (
  select
    c.closer_id,
    count(*) as calls_total,
    count(*) filter (where c.started_at >= now() - interval '30 days') as calls_30d,
    count(*) filter (where c.started_at >= now() - interval '7 days') as calls_7d,
    count(*) filter (where c.outcome = 'closed_won') as closes,
    count(*) filter (where c.outcome in ('pending')) as untagged_outcomes,
    count(*) filter (where c.outcome not in ('pending')) as tagged_outcomes,
    count(*) filter (where (c.ai_review->>'needs_review')::boolean is true) as needs_review,
    (avg(c.duration_seconds))::integer as avg_duration_seconds,
    (avg(((c.ai_review->>'framework_score')::numeric))) as avg_framework_score
  from calls c
  where c.closer_id is not null
  group by c.closer_id
)
select
  tm.id as closer_id,
  tm.full_name,
  coalesce(t.calls_total, 0) as calls_total,
  coalesce(t.calls_30d, 0) as calls_30d,
  coalesce(t.calls_7d, 0) as calls_7d,
  coalesce(t.closes, 0) as closes,
  coalesce(t.untagged_outcomes, 0) as untagged_outcomes,
  coalesce(t.tagged_outcomes, 0) as tagged_outcomes,
  coalesce(t.needs_review, 0) as needs_review,
  coalesce(t.avg_duration_seconds, 0) as avg_duration_seconds,
  case
    when coalesce(t.tagged_outcomes, 0) = 0 then 0
    else round(100.0 * t.closes::numeric / t.tagged_outcomes, 1)
  end as close_rate_pct,
  round(coalesce(t.avg_framework_score, 0)::numeric, 1) as avg_framework_score
from team_members tm
left join totals t on t.closer_id = tm.id
where tm.is_active = true and tm.role in ('closer', 'admin');

-- RLS is inherited from the underlying tables (calls). A closer who isn't an
-- admin will only see rows whose closer_id matches their own member id —
-- because calls.select policy filters out other closers' rows, the aggregate
-- over those rows collapses to zero. That's fine; the closer dashboard only
-- shows their own row anyway.
