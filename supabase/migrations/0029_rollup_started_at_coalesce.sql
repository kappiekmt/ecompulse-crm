-- 0029 — Stop the rollup views from silently dropping calls with no start time.
--
-- Both objection_rollup (0024) and loss_reason_rollup (0028) bucketed by
-- calls.started_at and filtered `where started_at is not null`. A call that
-- arrives without a start time (Fathom omits scheduled_start_time, or a manual
-- call) is recorded fine and keeps its objections / lost_reason, but vanishes
-- from the aggregate cards on the Objections page — a silent under-count.
--
-- Fix: bucket by coalesce(started_at, created_at) (created_at is NOT NULL) and
-- drop the null filter, so every tagged call surfaces. Column shapes are
-- unchanged, so no frontend / type changes are needed.

create or replace view objection_rollup as
select
  c.closer_id,
  o.id as objection_id,
  o.label,
  o.category,
  date_trunc('week', coalesce(c.started_at, c.created_at) at time zone 'Europe/Amsterdam')::date as week_start,
  count(*) as occurrences,
  array_agg(c.id order by coalesce(c.started_at, c.created_at) desc) as example_call_ids
from call_objections co
  join calls c on c.id = co.call_id
  join objections o on o.id = co.objection_id
group by c.closer_id, o.id, o.label, o.category,
         date_trunc('week', coalesce(c.started_at, c.created_at) at time zone 'Europe/Amsterdam')::date;

create or replace view loss_reason_rollup as
select
  c.closer_id,
  c.lost_reason,
  date_trunc('week', coalesce(c.started_at, c.created_at) at time zone 'Europe/Amsterdam')::date as week_start,
  count(*) as occurrences,
  array_agg(c.id order by coalesce(c.started_at, c.created_at) desc) as example_call_ids
from calls c
where c.outcome = 'lost'
  and c.lost_reason is not null
group by c.closer_id, c.lost_reason,
         date_trunc('week', coalesce(c.started_at, c.created_at) at time zone 'Europe/Amsterdam')::date;
