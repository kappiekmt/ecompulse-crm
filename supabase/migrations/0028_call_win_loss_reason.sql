-- 0028 — Win/Loss reason capture on calls.
--
-- When a closer tags a call's outcome as closed_won or lost, they now fill in a
-- short structured form: a primary reason category + (for lost-to-competitor)
-- the competitor name. The narrative still lives in calls.outcome_notes.
--
-- Adds:
--   - win_reason_category / loss_reason_category enums
--   - calls.won_reason, calls.lost_reason, calls.lost_to_competitor
--   - loss_reason_rollup view (mirrors objection_rollup) so admins can see
--     *why* deals are dying, per closer, per week.
--
-- No new RLS: the columns live on `calls`, so existing calls policies govern
-- them. The view is owned by the definer and filtered the same way the
-- objection_rollup view is consumed.

-- ============================================================================
-- 1. Enums
-- ============================================================================
create type win_reason_category as enum (
  'urgency_pain',          -- strong felt pain / urgency to solve now
  'trust_rapport',         -- built trust / strong rapport
  'roi_value',             -- clear ROI / value case landed
  'social_proof',          -- testimonials / case studies / peers
  'payment_flexibility',   -- payment plan / financing made it doable
  'offer_bonus',           -- offer stack / bonus / scarcity
  'follow_up_persistence', -- closed on persistence / good follow-up
  'other'
);

create type loss_reason_category as enum (
  'price',          -- couldn't / wouldn't pay
  'timing',         -- not the right time
  'authority',      -- needed another decision-maker's sign-off
  'trust',          -- didn't believe it would work for them
  'no_need',        -- no real fit / problem
  'spouse',         -- partner/spouse said no
  'went_cold',      -- ghosted / stopped responding
  'competitor',     -- chose a competitor / alternative
  'other'
);

-- ============================================================================
-- 2. Columns
-- ============================================================================
alter table calls
  add column if not exists won_reason win_reason_category,
  add column if not exists lost_reason loss_reason_category,
  add column if not exists lost_to_competitor text;

-- Partial indexes so the rollups / dashboards stay fast.
create index if not exists calls_won_reason_idx on calls(won_reason)
  where won_reason is not null;
create index if not exists calls_lost_reason_idx on calls(lost_reason)
  where lost_reason is not null;

-- Keep the data honest: a reason only makes sense for its matching outcome.
-- (Closers can't, e.g., leave a lost_reason on a won call.)
alter table calls
  add constraint calls_won_reason_requires_won
    check (won_reason is null or outcome = 'closed_won'),
  add constraint calls_lost_reason_requires_lost
    check (lost_reason is null or outcome = 'lost');

-- ============================================================================
-- 3. Loss-reason rollup view — why are we losing, per closer, per week?
-- ============================================================================
create or replace view loss_reason_rollup as
select
  c.closer_id,
  c.lost_reason,
  date_trunc('week', c.started_at at time zone 'Europe/Amsterdam')::date as week_start,
  count(*) as occurrences,
  array_agg(c.id order by c.started_at desc) as example_call_ids
from calls c
where c.outcome = 'lost'
  and c.lost_reason is not null
  and c.started_at is not null
group by c.closer_id, c.lost_reason,
         date_trunc('week', c.started_at at time zone 'Europe/Amsterdam')::date;
