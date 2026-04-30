-- 0011 — Lead booking lifecycle fields + new stage values.
--
-- The lead detail drawer needs to surface:
--   • when the lead was booked (booked_at)
--   • when the call is scheduled (scheduled_at)
--   • when it was cancelled (cancelled_at)
--   • when the deal was won/lost (closed_at)
--   • where the lead came from (source)
--   • the lead's budget (budget_cents)
--   • Calendly's cancel + reschedule URLs (so the drawer can surface buttons)
--
-- New stage values: cancelled, follow_up_short, follow_up_long.

-- ============================================================================
-- 1. Extend lead_stage enum
-- ============================================================================
alter type lead_stage add value if not exists 'cancelled';
alter type lead_stage add value if not exists 'follow_up_short';
alter type lead_stage add value if not exists 'follow_up_long';

-- ============================================================================
-- 2. Add columns to leads
-- ============================================================================
alter table leads
  add column if not exists source text,
  add column if not exists booked_at timestamptz,
  add column if not exists scheduled_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists budget_cents integer,
  add column if not exists calendly_cancel_url text,
  add column if not exists calendly_reschedule_url text,
  add column if not exists calendly_event_id text;

create index if not exists leads_scheduled_at_idx on leads(scheduled_at);
create index if not exists leads_booked_at_idx on leads(booked_at desc);
create index if not exists leads_source_idx on leads(source);

-- Backfill: leads that already exist get their booked_at = created_at when stage was 'booked'.
update leads
set booked_at = created_at
where booked_at is null
  and stage in ('booked', 'confirmed', 'showed', 'no_show', 'pitched', 'won', 'lost', 'onboarding', 'active_student', 'churned', 'refunded');
