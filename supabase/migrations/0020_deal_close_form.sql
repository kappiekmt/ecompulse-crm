-- 0020 — Closer-driven deal logging.
--
-- Closers fill in tier + custom payment schedule from the Pipeline. Slack is
-- notified on insert. This migration:
--   1. Extends coaching_tier with 'nick_1_on_1' (was bucketed under one_on_one).
--   2. Adds closed_by + closer-visible notes to deals.
--   3. Creates deal_installments — the closer-defined custom schedule, one
--      row per scheduled payment with its own due date.
--   4. Lets closers insert deals + installments on leads they own (so they
--      don't need admin to log a close).

-- 1. Tier enum bump ─────────────────────────────────────────────────────────
do $$ begin
  alter type coaching_tier add value if not exists 'nick_1_on_1';
exception when others then null;
end $$;

-- 2. Deal columns ───────────────────────────────────────────────────────────
alter table deals
  add column if not exists closed_by_id uuid references team_members(id) on delete set null,
  add column if not exists notes text;

create index if not exists deals_closed_by_idx on deals(closed_by_id);

-- 3. Installments ───────────────────────────────────────────────────────────
create table if not exists deal_installments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  seq integer not null,
  amount_cents integer not null check (amount_cents > 0),
  due_date date not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (deal_id, seq)
);

create index if not exists deal_installments_deal_id_idx on deal_installments(deal_id);
create index if not exists deal_installments_due_date_idx on deal_installments(due_date);

alter table deal_installments enable row level security;

-- Visibility: piggybacks on deals_select. If you can read the deal, you can
-- read its installments.
create policy deal_installments_select on deal_installments
  for select to authenticated using (
    exists (select 1 from deals d where d.id = deal_installments.deal_id)
  );

create policy deal_installments_admin_write on deal_installments
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- 4. Closer can log a close on their own leads ─────────────────────────────
create policy deals_closer_insert on deals
  for insert to authenticated
  with check (
    current_team_role() in ('closer', 'admin')
    and exists (
      select 1 from leads l
      where l.id = deals.lead_id
        and (current_team_role() = 'admin' or l.closer_id = current_team_member_id())
    )
  );

create policy deal_installments_closer_insert on deal_installments
  for insert to authenticated
  with check (
    exists (
      select 1 from deals d
      join leads l on l.id = d.lead_id
      where d.id = deal_installments.deal_id
        and (current_team_role() = 'admin' or l.closer_id = current_team_member_id())
    )
  );
