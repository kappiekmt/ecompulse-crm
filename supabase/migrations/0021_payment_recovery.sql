-- 0021 — Failed-payment recovery loop.
--
-- Adds status tracking + recovery metadata to deal_installments, an
-- append-only payment_recovery_events log, a separate payment_status on
-- students (kept distinct from onboarding_status so coach/Discord flows
-- aren't disturbed), and a feature flag.
--
-- The cron functions check-overdue-payments + payment-recovery-sequence
-- read the new columns; the lead drawer renders the events timeline.

-- 1. Installment status enum ────────────────────────────────────────────────
do $$ begin
  create type installment_status as enum (
    'scheduled', 'paid', 'failed', 'recovering', 'written_off', 'refunded'
  );
exception when duplicate_object then null;
end $$;

-- 2. deal_installments columns ──────────────────────────────────────────────
alter table deal_installments
  add column if not exists status installment_status not null default 'scheduled',
  add column if not exists failed_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists recovery_attempts integer not null default 0,
  add column if not exists last_recovery_attempt_at timestamptz,
  add column if not exists grace_period_days integer not null default 3,
  add column if not exists written_off_at timestamptz,
  add column if not exists written_off_by uuid references team_members(id) on delete set null;

-- Backfill: rows with paid_at set are 'paid', everything else stays 'scheduled'.
update deal_installments
  set status = 'paid'
  where paid_at is not null
    and status = 'scheduled';

-- Cron query: "find scheduled installments past their grace period." This
-- index covers it.
create index if not exists deal_installments_status_due_idx
  on deal_installments(status, due_date)
  where status in ('scheduled', 'failed', 'recovering');

-- 3. Recovery events log ────────────────────────────────────────────────────
-- event_type is text with a CHECK constraint instead of an enum so the
-- sequence stages can evolve without further migrations.
create table if not exists payment_recovery_events (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references deal_installments(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  event_type text not null check (event_type in (
    'overdue_detected',
    'reminder_sent',
    'closer_notified',
    'admin_escalated',
    'access_paused',
    'access_resumed',
    'resolved',
    'written_off',
    'marked_recovering',
    'closer_contacted_customer',
    'closer_unable_to_reach'
  )),
  actor_team_member_id uuid references team_members(id) on delete set null,
  is_system boolean not null default false,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_recovery_events_installment_idx
  on payment_recovery_events(installment_id, event_type);
create index if not exists payment_recovery_events_lead_idx
  on payment_recovery_events(lead_id, created_at desc);

alter table payment_recovery_events enable row level security;

-- Closers + setters see events on their assigned leads; admin sees all.
-- Service role bypasses RLS as usual (used by cron functions).
create policy payment_recovery_events_select on payment_recovery_events
  for select to authenticated using (
    current_team_role() = 'admin'
    or exists (
      select 1 from leads l
      where l.id = payment_recovery_events.lead_id
        and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
    )
  );

create policy payment_recovery_events_admin_write on payment_recovery_events
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- Closers can append events on their own leads (so "I contacted them" and
-- "unable to reach" from the Slack DM action buttons aren't admin-gated).
create policy payment_recovery_events_closer_insert on payment_recovery_events
  for insert to authenticated
  with check (
    exists (
      select 1 from leads l
      where l.id = payment_recovery_events.lead_id
        and (current_team_role() = 'admin' or l.closer_id = current_team_member_id())
    )
    and event_type in (
      'closer_contacted_customer',
      'closer_unable_to_reach',
      'marked_recovering'
    )
  );

-- 4. Student payment_status ─────────────────────────────────────────────────
-- Distinct from onboarding_status so we don't perturb coach/Discord flows.
alter table students
  add column if not exists payment_status text not null default 'active'
    check (payment_status in ('active', 'paused_payment', 'reactivated', 'churned'));

create index if not exists students_payment_status_idx on students(payment_status)
  where payment_status <> 'active';

-- 5. Feature flag ───────────────────────────────────────────────────────────
insert into automation_settings (key, display_name, description, enabled)
values (
  'recovery_enabled',
  'Payment recovery loop',
  'Daily overdue detection, closer + admin escalations, and Day-14 access pause. Toggle off to halt all recovery cron actions.',
  true
)
on conflict (key) do nothing;
