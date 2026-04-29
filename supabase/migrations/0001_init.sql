-- EcomPulse CRM — initial schema
-- Run in Supabase SQL editor (Project → SQL → New query) after creating the project.

-- ============================================================================
-- 1. Extensions
-- ============================================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================================
-- 2. Enums
-- ============================================================================
create type team_role as enum ('admin', 'closer', 'setter', 'coach');

create type lead_stage as enum (
  'new',
  'booked',
  'confirmed',
  'showed',
  'no_show',
  'pitched',
  'won',
  'lost',
  'onboarding',
  'active_student',
  'churned',
  'refunded'
);

create type deal_status as enum ('open', 'won', 'lost', 'refunded');
create type onboarding_status as enum ('pending', 'in_progress', 'complete');
create type integration_direction as enum ('inbound', 'outbound');
create type integration_status as enum ('pending', 'success', 'failed', 'retrying');

-- ============================================================================
-- 3. Tables
-- ============================================================================

-- Team members — closers, setters, coaches, admins.
-- user_id links to auth.users when the person has logged in at least once.
create table team_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  email text not null unique,
  role team_role not null,
  slack_user_id text,
  timezone text,
  commission_pct numeric(5,2),
  capacity integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index team_members_role_idx on team_members(role);
create index team_members_user_id_idx on team_members(user_id);

-- Leads — the central record. Everything ties back here.
create table leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  instagram text,
  timezone text,
  stage lead_stage not null default 'new',
  closer_id uuid references team_members(id) on delete set null,
  setter_id uuid references team_members(id) on delete set null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  source_landing_page text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_stage_idx on leads(stage);
create index leads_closer_id_idx on leads(closer_id);
create index leads_setter_id_idx on leads(setter_id);
create index leads_email_idx on leads(email);

-- Deals — financial side of a lead. A lead can have multiple deals (downsells, renewals).
create table deals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  program text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'EUR',
  payment_plan jsonb,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_payment_intent_id text,
  status deal_status not null default 'open',
  lost_reason text,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index deals_lead_id_idx on deals(lead_id);
create index deals_status_idx on deals(status);
create index deals_stripe_customer_idx on deals(stripe_customer_id);

-- Students — created on Stripe payment success, holds onboarding state.
create table students (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade,
  coach_id uuid references team_members(id) on delete set null,
  program text not null,
  discord_user_id text,
  whop_membership_id text,
  onboarding_status onboarding_status not null default 'pending',
  onboarding_checklist jsonb,
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index students_coach_id_idx on students(coach_id);
create index students_lead_id_idx on students(lead_id);

-- Activities — audit log of every notable event tied to a lead/student.
create table activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  actor_id uuid references team_members(id) on delete set null,
  type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index activities_lead_id_idx on activities(lead_id);
create index activities_student_id_idx on activities(student_id);
create index activities_type_idx on activities(type);
create index activities_created_at_idx on activities(created_at desc);

-- Integration log — every webhook in and API call out, with retries and errors.
create table integrations_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  direction integration_direction not null,
  event_type text not null,
  status integration_status not null,
  request_payload jsonb,
  response_payload jsonb,
  error text,
  retry_count integer not null default 0,
  related_lead_id uuid references leads(id) on delete set null,
  created_at timestamptz not null default now()
);

create index integrations_log_provider_idx on integrations_log(provider);
create index integrations_log_status_idx on integrations_log(status);
create index integrations_log_created_at_idx on integrations_log(created_at desc);

-- ============================================================================
-- 4. Updated-at triggers
-- ============================================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_set_updated_at
  before update on leads
  for each row execute function set_updated_at();

create trigger students_set_updated_at
  before update on students
  for each row execute function set_updated_at();

-- ============================================================================
-- 5. Helper — current user's role
-- ============================================================================
create or replace function current_team_role()
returns team_role language sql stable security definer as $$
  select role from team_members where user_id = auth.uid() limit 1;
$$;

create or replace function current_team_member_id()
returns uuid language sql stable security definer as $$
  select id from team_members where user_id = auth.uid() limit 1;
$$;

-- ============================================================================
-- 6. Row Level Security
-- ============================================================================
alter table team_members enable row level security;
alter table leads enable row level security;
alter table deals enable row level security;
alter table students enable row level security;
alter table activities enable row level security;
alter table integrations_log enable row level security;

-- team_members: everyone authenticated can read (needed for assignment dropdowns);
-- only admins can write.
create policy team_members_select on team_members
  for select to authenticated using (true);

create policy team_members_admin_write on team_members
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- leads: admins see all; closers/setters see only their assigned leads.
create policy leads_select on leads
  for select to authenticated using (
    current_team_role() = 'admin'
    or closer_id = current_team_member_id()
    or setter_id = current_team_member_id()
  );

create policy leads_insert on leads
  for insert to authenticated
  with check (current_team_role() in ('admin', 'closer', 'setter'));

create policy leads_update on leads
  for update to authenticated
  using (
    current_team_role() = 'admin'
    or closer_id = current_team_member_id()
    or setter_id = current_team_member_id()
  );

create policy leads_admin_delete on leads
  for delete to authenticated using (current_team_role() = 'admin');

-- deals: admins see all; closer/setter see deals on their leads.
create policy deals_select on deals
  for select to authenticated using (
    current_team_role() = 'admin'
    or exists (
      select 1 from leads l
      where l.id = deals.lead_id
        and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
    )
  );

create policy deals_admin_write on deals
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- students: admins see all; coaches see only their assigned students.
create policy students_select on students
  for select to authenticated using (
    current_team_role() = 'admin'
    or coach_id = current_team_member_id()
  );

create policy students_admin_write on students
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

create policy students_coach_update on students
  for update to authenticated
  using (coach_id = current_team_member_id())
  with check (coach_id = current_team_member_id());

-- activities: visible if you can see the underlying lead or student.
create policy activities_select on activities
  for select to authenticated using (
    current_team_role() = 'admin'
    or (
      lead_id is not null and exists (
        select 1 from leads l
        where l.id = activities.lead_id
          and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
      )
    )
    or (
      student_id is not null and exists (
        select 1 from students s
        where s.id = activities.student_id and s.coach_id = current_team_member_id()
      )
    )
  );

create policy activities_insert on activities
  for insert to authenticated
  with check (current_team_role() in ('admin', 'closer', 'setter', 'coach'));

-- integrations_log: admins only.
create policy integrations_log_admin on integrations_log
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');
