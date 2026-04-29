-- 0002 — Tables for sidebar features:
-- Lead Tags, DM Chat, IG Chat, Import Leads, Import Payments, Integrations,
-- Help & SOPs, Command Center (call outcomes, reminders, notifications).

-- ============================================================================
-- 1. Enums
-- ============================================================================
create type conversation_kind as enum ('dm', 'ig');
create type conversation_status as enum ('open', 'snoozed', 'closed');
create type message_direction as enum ('inbound', 'outbound');
create type import_kind as enum ('leads', 'payments');
create type import_status as enum ('pending', 'processing', 'complete', 'failed');
create type import_row_status as enum ('pending', 'imported', 'skipped', 'error');
create type call_result as enum ('showed', 'no_show', 'pitched', 'closed', 'lost', 'rescheduled');
create type reminder_status as enum ('scheduled', 'sent', 'cancelled', 'failed');
create type notification_kind as enum (
  'booking_created',
  'pre_call_reminder',
  'payment_received',
  'student_assigned',
  'automation_failed',
  'mention',
  'system'
);

-- ============================================================================
-- 2. Lead tags (Lead Tags page)
-- ============================================================================
create table lead_tags (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  description text,
  color text not null default 'muted', -- maps to Badge variant
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table lead_tag_assignments (
  lead_id uuid not null references leads(id) on delete cascade,
  tag_id uuid not null references lead_tags(id) on delete cascade,
  assigned_by uuid references team_members(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (lead_id, tag_id)
);

create index lead_tag_assignments_tag_idx on lead_tag_assignments(tag_id);

-- ============================================================================
-- 3. Conversations & Messages (DM Chat, IG Chat)
-- ============================================================================
create table conversations (
  id uuid primary key default uuid_generate_v4(),
  kind conversation_kind not null,
  lead_id uuid references leads(id) on delete set null,
  external_id text,                       -- e.g. IG thread ID
  external_handle text,                   -- e.g. @ig_username
  subject text,
  status conversation_status not null default 'open',
  assigned_to uuid references team_members(id) on delete set null,
  last_message_at timestamptz,
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, external_id)
);

create index conversations_assigned_idx on conversations(assigned_to);
create index conversations_lead_idx on conversations(lead_id);
create index conversations_kind_status_idx on conversations(kind, status);

create table conversation_participants (
  conversation_id uuid not null references conversations(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (conversation_id, team_member_id)
);

create table messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction message_direction not null,
  sender_team_member_id uuid references team_members(id) on delete set null,
  sender_external_handle text,
  body text not null,
  attachments jsonb,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on messages(conversation_id, created_at desc);

create trigger conversations_set_updated_at
  before update on conversations
  for each row execute function set_updated_at();

-- Bump conversation last_message_at on new message.
create or replace function bump_conversation_last_message()
returns trigger language plpgsql as $$
begin
  update conversations
    set last_message_at = new.created_at,
        unread_count = unread_count + case when new.direction = 'inbound' then 1 else 0 end
    where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_bump_conversation
  after insert on messages
  for each row execute function bump_conversation_last_message();

-- ============================================================================
-- 4. Payments ledger (Import Payments + Stripe webhook)
-- ============================================================================
create table payments (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid references leads(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,
  amount_cents integer not null check (amount_cents <> 0),
  currency text not null default 'EUR',
  paid_at timestamptz not null,
  stripe_charge_id text unique,
  stripe_payment_intent_id text,
  source text not null default 'stripe', -- 'stripe' | 'manual' | 'import'
  is_refund boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create index payments_paid_at_idx on payments(paid_at desc);
create index payments_lead_idx on payments(lead_id);
create index payments_deal_idx on payments(deal_id);

-- ============================================================================
-- 5. Imports (Import Leads + Import Payments pages)
-- ============================================================================
create table imports (
  id uuid primary key default uuid_generate_v4(),
  kind import_kind not null,
  filename text,
  storage_path text,
  status import_status not null default 'pending',
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  skipped_rows integer not null default 0,
  error_rows integer not null default 0,
  started_by uuid references team_members(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index imports_kind_status_idx on imports(kind, status);

create table import_rows (
  id uuid primary key default uuid_generate_v4(),
  import_id uuid not null references imports(id) on delete cascade,
  row_number integer not null,
  raw jsonb not null,
  status import_row_status not null default 'pending',
  result_lead_id uuid references leads(id) on delete set null,
  result_payment_id uuid references payments(id) on delete set null,
  error text,
  created_at timestamptz not null default now()
);

create index import_rows_import_idx on import_rows(import_id, row_number);

-- ============================================================================
-- 6. Integration configs (Integrations page)
-- ============================================================================
create table integration_configs (
  id uuid primary key default uuid_generate_v4(),
  provider text not null unique,
  is_connected boolean not null default false,
  display_name text,
  -- Encrypt secrets at the application layer; this column is jsonb for non-sensitive config.
  config jsonb not null default '{}'::jsonb,
  -- secrets are referenced by Vault, never inlined here. Store secret name only.
  secret_ref text,
  connected_by uuid references team_members(id) on delete set null,
  connected_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger integration_configs_set_updated_at
  before update on integration_configs
  for each row execute function set_updated_at();

-- ============================================================================
-- 7. SOPs (Help & SOPs page)
-- ============================================================================
create table sops (
  id uuid primary key default uuid_generate_v4(),
  category text not null,    -- 'pre_call', 'on_call', 'post_call', 'onboarding', 'coach'
  title text not null,
  body_md text not null,
  visible_to team_role[] not null default array['admin','closer','setter','coach']::team_role[],
  version integer not null default 1,
  is_archived boolean not null default false,
  created_by uuid references team_members(id) on delete set null,
  updated_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sops_category_idx on sops(category);

create trigger sops_set_updated_at
  before update on sops
  for each row execute function set_updated_at();

-- ============================================================================
-- 8. Call outcomes (closer logs result of strategy call)
-- ============================================================================
create table call_outcomes (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid not null references leads(id) on delete cascade,
  closer_id uuid references team_members(id) on delete set null,
  scheduled_for timestamptz,
  occurred_at timestamptz,
  result call_result not null,
  reason text,
  notes text,
  created_at timestamptz not null default now()
);

create index call_outcomes_lead_idx on call_outcomes(lead_id);
create index call_outcomes_closer_idx on call_outcomes(closer_id);
create index call_outcomes_occurred_idx on call_outcomes(occurred_at desc);

-- ============================================================================
-- 9. Reminders (15-min pre-call, follow-up, payment-plan checkpoints)
-- ============================================================================
create table reminders (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid references leads(id) on delete cascade,
  team_member_id uuid references team_members(id) on delete cascade,
  kind text not null,           -- 'pre_call_15m' | 'followup' | 'payment_plan'
  fire_at timestamptz not null,
  status reminder_status not null default 'scheduled',
  payload jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index reminders_fire_idx on reminders(status, fire_at);
create index reminders_lead_idx on reminders(lead_id);

-- ============================================================================
-- 10. Notifications (Command Center inbox)
-- ============================================================================
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  recipient_id uuid not null references team_members(id) on delete cascade,
  kind notification_kind not null,
  title text not null,
  body text,
  link text,
  related_lead_id uuid references leads(id) on delete set null,
  related_student_id uuid references students(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_recipient_unread_idx
  on notifications(recipient_id, created_at desc)
  where read_at is null;

-- ============================================================================
-- 11. Row Level Security
-- ============================================================================
alter table lead_tags enable row level security;
alter table lead_tag_assignments enable row level security;
alter table conversations enable row level security;
alter table conversation_participants enable row level security;
alter table messages enable row level security;
alter table payments enable row level security;
alter table imports enable row level security;
alter table import_rows enable row level security;
alter table integration_configs enable row level security;
alter table sops enable row level security;
alter table call_outcomes enable row level security;
alter table reminders enable row level security;
alter table notifications enable row level security;

-- lead_tags: everyone authenticated reads; admin writes.
create policy lead_tags_select on lead_tags
  for select to authenticated using (true);
create policy lead_tags_admin_write on lead_tags
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- lead_tag_assignments: visible if you can see the underlying lead.
create policy lead_tag_assignments_select on lead_tag_assignments
  for select to authenticated using (
    current_team_role() = 'admin'
    or exists (
      select 1 from leads l
      where l.id = lead_tag_assignments.lead_id
        and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
    )
  );
create policy lead_tag_assignments_write on lead_tag_assignments
  for all to authenticated
  using (
    current_team_role() = 'admin'
    or exists (
      select 1 from leads l
      where l.id = lead_tag_assignments.lead_id
        and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
    )
  )
  with check (true);

-- conversations: participants + admin only.
create policy conversations_select on conversations
  for select to authenticated using (
    current_team_role() = 'admin'
    or assigned_to = current_team_member_id()
    or exists (
      select 1 from conversation_participants cp
      where cp.conversation_id = conversations.id
        and cp.team_member_id = current_team_member_id()
    )
  );
create policy conversations_insert on conversations
  for insert to authenticated with check (
    current_team_role() in ('admin','closer','setter')
  );
create policy conversations_update on conversations
  for update to authenticated using (
    current_team_role() = 'admin'
    or assigned_to = current_team_member_id()
    or exists (
      select 1 from conversation_participants cp
      where cp.conversation_id = conversations.id
        and cp.team_member_id = current_team_member_id()
    )
  );

create policy conversation_participants_select on conversation_participants
  for select to authenticated using (
    current_team_role() = 'admin'
    or team_member_id = current_team_member_id()
  );
create policy conversation_participants_admin_write on conversation_participants
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

create policy messages_select on messages
  for select to authenticated using (
    current_team_role() = 'admin'
    or exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and (
          c.assigned_to = current_team_member_id()
          or exists (
            select 1 from conversation_participants cp
            where cp.conversation_id = c.id and cp.team_member_id = current_team_member_id()
          )
        )
    )
  );
create policy messages_insert on messages
  for insert to authenticated with check (
    current_team_role() in ('admin','closer','setter')
  );

-- payments: admin sees all; closer/setter see payments tied to their leads.
create policy payments_select on payments
  for select to authenticated using (
    current_team_role() = 'admin'
    or (
      lead_id is not null and exists (
        select 1 from leads l
        where l.id = payments.lead_id
          and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
      )
    )
  );
create policy payments_admin_write on payments
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- imports: admin only.
create policy imports_admin on imports
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');
create policy import_rows_admin on import_rows
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- integration_configs: admin only.
create policy integration_configs_admin on integration_configs
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- sops: read based on visible_to roles; admin writes.
create policy sops_select on sops
  for select to authenticated using (
    current_team_role() = any(visible_to)
  );
create policy sops_admin_write on sops
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- call_outcomes: admin sees all; closer sees their own.
create policy call_outcomes_select on call_outcomes
  for select to authenticated using (
    current_team_role() = 'admin'
    or closer_id = current_team_member_id()
  );
create policy call_outcomes_insert on call_outcomes
  for insert to authenticated with check (
    current_team_role() in ('admin','closer')
  );
create policy call_outcomes_update on call_outcomes
  for update to authenticated using (
    current_team_role() = 'admin' or closer_id = current_team_member_id()
  );

-- reminders: admin all; team member their own.
create policy reminders_select on reminders
  for select to authenticated using (
    current_team_role() = 'admin'
    or team_member_id = current_team_member_id()
  );
create policy reminders_write on reminders
  for all to authenticated
  using (
    current_team_role() = 'admin'
    or team_member_id = current_team_member_id()
  )
  with check (true);

-- notifications: only the recipient (and admin) can read.
create policy notifications_select on notifications
  for select to authenticated using (
    current_team_role() = 'admin'
    or recipient_id = current_team_member_id()
  );
create policy notifications_update_own on notifications
  for update to authenticated
  using (recipient_id = current_team_member_id())
  with check (recipient_id = current_team_member_id());
create policy notifications_admin_write on notifications
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- ============================================================================
-- 12. Seed default lead tags
-- ============================================================================
insert into lead_tags (name, description, color) values
  ('Hot', 'Strong fit, high intent — fast follow-up.', 'destructive'),
  ('Warm', 'Replied, not yet booked.', 'warning'),
  ('Cold', 'Initial outreach only.', 'muted'),
  ('VIP', 'High AOV, white-glove handling.', 'default'),
  ('Referral', 'Came from a current student.', 'success')
on conflict (name) do nothing;

-- Seed default integration_configs rows so the Integrations page lists them
-- even before any are connected.
insert into integration_configs (provider, display_name) values
  ('calendly', 'Calendly'),
  ('stripe', 'Stripe'),
  ('slack', 'Slack'),
  ('discord', 'Discord'),
  ('whop', 'Whop'),
  ('activecampaign', 'ActiveCampaign'),
  ('gmail', 'Gmail'),
  ('google_sheets', 'Google Sheets'),
  ('instagram', 'Instagram'),
  ('claude', 'Claude API')
on conflict (provider) do nothing;
