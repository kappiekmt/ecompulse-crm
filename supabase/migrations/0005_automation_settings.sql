-- 0005 — Automation toggles for the Integrations page.
-- Each row is a feature flag the admin can switch on/off without touching code.

create table automation_settings (
  key text primary key,
  display_name text not null,
  description text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references team_members(id) on delete set null
);

create trigger automation_settings_set_updated_at
  before update on automation_settings
  for each row execute function set_updated_at();

alter table automation_settings enable row level security;

-- Anyone authenticated reads (so non-admin code paths can check `enabled`).
create policy automation_settings_select on automation_settings
  for select to authenticated using (true);

-- Only admins toggle.
create policy automation_settings_admin_write on automation_settings
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- Seed the canonical automations the EcomPulse flow needs.
insert into automation_settings (key, display_name, description, enabled) values
  ('new_call_booked',
   'New call booked',
   'Slack notification when a lead books a call (Calendly + Zapier).',
   true),
  ('call_cancelled',
   'Call cancelled',
   'Slack notification when a lead cancels via Calendly.',
   true),
  ('payment_received',
   'Payment received / deal closed',
   'Slack notification on payment webhook or manual close.',
   true),
  ('outbound_zapier_cancel',
   'Outbound Zapier on cancel / reschedule',
   'Fires the cancel/reschedule webhook to Zapier when a lead''s status changes.',
   true),
  ('daily_eod_reports',
   'Daily EOD reports',
   'Individual closer / setter EODs + team summary at 21:00 Dubai.',
   true),
  ('weekly_report',
   'Weekly report (Sundays)',
   'Weekly team performance summary.',
   true),
  ('pre_call_15m_reminder',
   '15-min pre-call reminder',
   'Slack ping to the assigned closer 15 minutes before each strategy call.',
   true),
  ('onboarding_chain',
   'Onboarding chain on payment',
   'Discord invite + Whop access + coach assignment after Stripe checkout completes.',
   true)
on conflict (key) do nothing;
