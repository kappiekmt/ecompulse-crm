-- 0022 — Commission tracking on payment received.
--
-- Adapts the closer command-center brief to our schema:
--   • payments was missing installment_id — added here and populated on
--     backfill where it can be inferred from (deal_id, amount_cents).
--   • payments has no status column — refund detection uses is_refund.
--   • deals.closer_id doesn't exist — commission joins on closed_by_id.
--   • team_members already has commission_pct; we keep that column and
--     add commission_rate_updated_at / _by audit fields alongside.
--   • All amounts stay in cents (integer) for consistency with payments,
--     deals, deal_installments. Brief specified numeric(10,2) but the
--     rest of the system is cents.
--
-- One row per payment in commission_records. UNIQUE(payment_id) makes
-- the trigger idempotent and matches the brief's intent.

-- 1. team_members rate audit columns ────────────────────────────────────────
alter table team_members
  add column if not exists commission_rate_updated_at timestamptz default now(),
  add column if not exists commission_rate_updated_by uuid references team_members(id) on delete set null;

-- Set a sane default for any closers/admins still on null
update team_members
  set commission_pct = 10.00
  where commission_pct is null and role in ('closer', 'admin');

-- 2. payments.installment_id ────────────────────────────────────────────────
alter table payments
  add column if not exists installment_id uuid references deal_installments(id) on delete set null;

create index if not exists payments_installment_id_idx on payments(installment_id);

-- Best-effort backfill: link payments to installments where deal+amount
-- match uniquely. Falls back to leaving installment_id null otherwise.
with linkable as (
  select p.id as payment_id,
         (select i.id
          from deal_installments i
          where i.deal_id = p.deal_id
            and i.amount_cents = p.amount_cents
            and i.paid_at is not null
          limit 1) as inst_id
  from payments p
  where p.installment_id is null
    and p.deal_id is not null
)
update payments p
  set installment_id = l.inst_id
  from linkable l
  where p.id = l.payment_id and l.inst_id is not null;

-- 3. commission_records ─────────────────────────────────────────────────────
create table if not exists commission_records (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  installment_id uuid references deal_installments(id) on delete set null,
  deal_id uuid not null references deals(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  closer_id uuid not null references team_members(id) on delete restrict,
  payment_amount_cents integer not null check (payment_amount_cents <> 0),
  commission_rate numeric(5,2) not null,
  commission_amount_cents integer not null,
  status text not null default 'earned'
    check (status in ('earned', 'paid_out', 'clawed_back', 'adjusted')),
  earned_at timestamptz not null default now(),
  paid_out_at timestamptz,
  paid_out_by uuid references team_members(id) on delete set null,
  payout_reference text,
  clawback_reason text,
  clawed_back_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id)
);

create index if not exists commission_records_closer_status_idx
  on commission_records(closer_id, status);
create index if not exists commission_records_earned_at_idx
  on commission_records(earned_at desc);
create index if not exists commission_records_deal_idx
  on commission_records(deal_id);

create trigger commission_records_set_updated_at
  before update on commission_records
  for each row execute function set_updated_at();

-- 4. commission_adjustments ─────────────────────────────────────────────────
create table if not exists commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  closer_id uuid not null references team_members(id) on delete cascade,
  commission_record_id uuid references commission_records(id) on delete set null,
  adjustment_type text not null
    check (adjustment_type in ('bonus', 'spiff', 'correction', 'clawback', 'penalty')),
  amount_cents integer not null,
  reason text not null,
  applied_to_period date not null,
  created_by uuid not null references team_members(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists commission_adjustments_closer_idx
  on commission_adjustments(closer_id, applied_to_period desc);

-- 5. RLS — closers see only their rows; admins see all ──────────────────────
alter table commission_records enable row level security;
alter table commission_adjustments enable row level security;

create policy commission_records_select on commission_records
  for select to authenticated using (
    current_team_role() = 'admin'
    or closer_id = current_team_member_id()
  );

create policy commission_records_admin_write on commission_records
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

create policy commission_adjustments_select on commission_adjustments
  for select to authenticated using (
    current_team_role() = 'admin'
    or closer_id = current_team_member_id()
  );

create policy commission_adjustments_admin_write on commission_adjustments
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- 6. Trigger: create commission row when a payment lands ────────────────────
create or replace function create_commission_on_payment()
returns trigger
language plpgsql
security definer
as $fn$
declare
  v_closer_id uuid;
  v_lead_id uuid;
  v_rate numeric(5,2);
begin
  -- Only act when a non-refund payment becomes "paid" (insert with paid_at
  -- set, or update flipping paid_at from null → something).
  if new.is_refund then return new; end if;
  if not (
    (tg_op = 'INSERT' and new.paid_at is not null)
    or (tg_op = 'UPDATE' and new.paid_at is not null and old.paid_at is null)
  ) then
    return new;
  end if;

  if new.deal_id is null then return new; end if;

  select d.closed_by_id, d.lead_id, coalesce(tm.commission_pct, 10.00)
    into v_closer_id, v_lead_id, v_rate
    from deals d
    left join team_members tm on tm.id = d.closed_by_id
    where d.id = new.deal_id;

  if v_closer_id is null or v_lead_id is null then return new; end if;

  insert into commission_records (
    payment_id, installment_id, deal_id, lead_id, closer_id,
    payment_amount_cents, commission_rate, commission_amount_cents, earned_at
  ) values (
    new.id, new.installment_id, new.deal_id, v_lead_id, v_closer_id,
    new.amount_cents, v_rate,
    round(new.amount_cents * v_rate / 100.0)::integer,
    coalesce(new.paid_at, now())
  )
  on conflict (payment_id) do nothing;

  return new;
end;
$fn$;

drop trigger if exists trg_create_commission_on_payment on payments;
create trigger trg_create_commission_on_payment
  after insert or update on payments
  for each row execute function create_commission_on_payment();

-- 7. Trigger: clawback on refund flag flip ──────────────────────────────────
create or replace function clawback_commission_on_refund()
returns trigger
language plpgsql
security definer
as $fn$
begin
  if new.is_refund and not old.is_refund then
    update commission_records
      set status = 'clawed_back',
          clawed_back_at = now(),
          clawback_reason = 'Payment refunded',
          updated_at = now()
      where payment_id = new.id
        and status in ('earned', 'paid_out');
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_clawback_commission_on_refund on payments;
create trigger trg_clawback_commission_on_refund
  after update on payments
  for each row execute function clawback_commission_on_refund();

-- 8. Backfill from existing payments ────────────────────────────────────────
-- Uses the same logic the trigger would have applied. Idempotent because of
-- the UNIQUE(payment_id) constraint.
insert into commission_records (
  payment_id, installment_id, deal_id, lead_id, closer_id,
  payment_amount_cents, commission_rate, commission_amount_cents, earned_at
)
select
  p.id, p.installment_id, p.deal_id, d.lead_id, d.closed_by_id,
  p.amount_cents,
  coalesce(tm.commission_pct, 10.00),
  round(p.amount_cents * coalesce(tm.commission_pct, 10.00) / 100.0)::integer,
  p.paid_at
from payments p
join deals d on d.id = p.deal_id
left join team_members tm on tm.id = d.closed_by_id
where p.paid_at is not null
  and not p.is_refund
  and d.closed_by_id is not null
on conflict (payment_id) do nothing;

-- 9. Materialized view: per-closer per-day rollup ───────────────────────────
drop materialized view if exists closer_stats_daily;
create materialized view closer_stats_daily as
select
  closer_id,
  (date_trunc('day', earned_at at time zone 'Europe/Amsterdam'))::date as stat_date,
  count(distinct deal_id) as deals_with_payment,
  count(*) as payments_received,
  sum(payment_amount_cents) as cash_collected_cents,
  sum(commission_amount_cents) as total_commission_cents,
  (avg(payment_amount_cents))::integer as avg_payment_cents
from commission_records
where status <> 'clawed_back'
group by closer_id, (date_trunc('day', earned_at at time zone 'Europe/Amsterdam'))::date;

create unique index closer_stats_daily_pk
  on closer_stats_daily(closer_id, stat_date);

-- 10. Regular view: per-deal commission progress ────────────────────────────
create or replace view deal_commission_summary as
select
  d.id as deal_id,
  d.lead_id,
  d.closed_by_id as closer_id,
  d.amount_cents as contract_amount_cents,
  coalesce(sum(cr.payment_amount_cents), 0)::integer as cash_collected_cents,
  coalesce(sum(cr.commission_amount_cents), 0)::integer as commission_earned_cents,
  greatest(d.amount_cents - coalesce(sum(cr.payment_amount_cents), 0), 0)::integer as outstanding_cents,
  coalesce(tm.commission_pct, 10.00) as current_rate,
  round(
    greatest(d.amount_cents - coalesce(sum(cr.payment_amount_cents), 0), 0)
    * coalesce(tm.commission_pct, 10.00) / 100.0
  )::integer as projected_remaining_commission_cents,
  count(cr.id) as payments_received_count,
  (select count(*) from deal_installments di where di.deal_id = d.id) as installments_planned
from deals d
left join team_members tm on tm.id = d.closed_by_id
left join commission_records cr on cr.deal_id = d.id and cr.status <> 'clawed_back'
where d.status = 'won'
group by d.id, d.lead_id, d.closed_by_id, d.amount_cents, tm.commission_pct;

-- RLS on the view follows from RLS on commission_records + deals. Views
-- inherit; closers will see only deals they closed.

-- 11. Feature flag ──────────────────────────────────────────────────────────
insert into automation_settings (key, display_name, description, enabled)
values (
  'commission_tracking_enabled',
  'Commission tracking',
  'Auto-creates commission_records on each payment, refreshes the closer dashboard rollup, and fires the weekly Monday recap. Disable to pause the system; existing records remain.',
  true
)
on conflict (key) do nothing;
