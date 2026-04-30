-- 0008 — Outbound webhook subscriptions for Zapier (and Make, n8n, custom).
--
-- The admin creates one subscription per Zapier Catch Hook (or any URL) and
-- picks which CRM events should POST to it. Every delivery attempt is logged
-- in webhook_deliveries for debugging + retry.

-- ============================================================================
-- 1. Tables
-- ============================================================================
create table webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_url text not null,
  event_types text[] not null check (array_length(event_types, 1) > 0),
  signing_secret text,                              -- for HMAC-SHA256, optional
  is_active boolean not null default true,
  description text,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_delivered_at timestamptz,
  last_status text                                  -- 'success' | 'failed' | null
);

create index webhook_subscriptions_active_idx
  on webhook_subscriptions using gin(event_types)
  where is_active;

create trigger webhook_subscriptions_set_updated_at
  before update on webhook_subscriptions
  for each row execute function set_updated_at();

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references webhook_subscriptions(id) on delete cascade,
  event_type text not null,
  event_id text not null,
  payload jsonb not null,
  status text not null check (status in ('pending', 'success', 'failed')),
  attempts integer not null default 1,
  response_status integer,
  response_body_preview text,
  error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index webhook_deliveries_sub_created_idx
  on webhook_deliveries(subscription_id, created_at desc);
create index webhook_deliveries_status_idx
  on webhook_deliveries(status, created_at desc);

-- Bump the parent subscription's last_* fields when a delivery lands.
create or replace function bump_subscription_last_delivery()
returns trigger language plpgsql as $$
begin
  update webhook_subscriptions
    set last_delivered_at = new.created_at,
        last_status = new.status
    where id = new.subscription_id;
  return new;
end;
$$;

create trigger webhook_deliveries_bump_subscription
  after insert on webhook_deliveries
  for each row execute function bump_subscription_last_delivery();

-- ============================================================================
-- 2. Row Level Security — admin only
-- ============================================================================
alter table webhook_subscriptions enable row level security;
alter table webhook_deliveries enable row level security;

create policy webhook_subscriptions_admin on webhook_subscriptions
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

create policy webhook_deliveries_admin on webhook_deliveries
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- ============================================================================
-- 3. Realtime — let the UI watch deliveries land live
-- ============================================================================
alter publication supabase_realtime add table webhook_subscriptions;
alter publication supabase_realtime add table webhook_deliveries;
