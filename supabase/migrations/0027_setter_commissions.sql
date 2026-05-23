-- 0027 — Setter commissions
--
-- Setters now also earn a configurable percentage of cash collected on the
-- deals they originally set (booked). commission_records becomes
-- recipient-agnostic: a `recipient_role` column distinguishes closer rows
-- from setter rows, and the existing `closer_id` column keeps its name but
-- now holds whichever team_member receives the row (closer or setter).
--
-- Each payment can therefore generate up to two commission rows — one for
-- the deal's closer, one for the lead's setter — so the historical UNIQUE
-- (payment_id) constraint becomes UNIQUE (payment_id, recipient_role).
--
-- team_members.commission_pct is reused: it's "this team member's commission
-- rate" regardless of role. Setters start at NULL → 0% until an admin sets
-- their rate on the Team page.

-- 1. recipient_role column ────────────────────────────────────────────────
alter table commission_records
  add column if not exists recipient_role text not null default 'closer'
    check (recipient_role in ('closer', 'setter'));

-- 2. Relax payment_id uniqueness so closer + setter rows can coexist ──────
alter table commission_records
  drop constraint if exists commission_records_payment_id_key;

create unique index if not exists commission_records_payment_role_uniq
  on commission_records (payment_id, recipient_role);

-- 3. Trigger: fan out to closer AND setter on each new payment ────────────
create or replace function create_commission_on_payment()
returns trigger
language plpgsql
security definer
as $fn$
declare
  v_lead_id      uuid;
  v_closer_id    uuid;
  v_closer_rate  numeric(5,2);
  v_setter_id    uuid;
  v_setter_rate  numeric(5,2);
begin
  if new.is_refund then return new; end if;
  if not (
    (tg_op = 'INSERT' and new.paid_at is not null)
    or (tg_op = 'UPDATE' and new.paid_at is not null and old.paid_at is null)
  ) then
    return new;
  end if;
  if new.deal_id is null then return new; end if;

  select
    d.lead_id,
    d.closed_by_id,
    coalesce(cl_tm.commission_pct, 0),
    l.setter_id,
    coalesce(st_tm.commission_pct, 0)
  into
    v_lead_id, v_closer_id, v_closer_rate, v_setter_id, v_setter_rate
  from deals d
  left join leads l         on l.id  = d.lead_id
  left join team_members cl_tm on cl_tm.id = d.closed_by_id
  left join team_members st_tm on st_tm.id = l.setter_id and st_tm.is_active
  where d.id = new.deal_id;

  if v_lead_id is null then return new; end if;

  -- Closer row (only if there's a closer with a non-zero rate)
  if v_closer_id is not null and v_closer_rate > 0 then
    insert into commission_records (
      payment_id, installment_id, deal_id, lead_id, closer_id, recipient_role,
      payment_amount_cents, commission_rate, commission_amount_cents, earned_at
    ) values (
      new.id, new.installment_id, new.deal_id, v_lead_id, v_closer_id, 'closer',
      new.amount_cents, v_closer_rate,
      round(new.amount_cents * v_closer_rate / 100.0)::integer,
      coalesce(new.paid_at, now())
    ) on conflict (payment_id, recipient_role) do nothing;
  end if;

  -- Setter row (only if the lead has an active setter with a non-zero rate)
  if v_setter_id is not null and v_setter_rate > 0 then
    insert into commission_records (
      payment_id, installment_id, deal_id, lead_id, closer_id, recipient_role,
      payment_amount_cents, commission_rate, commission_amount_cents, earned_at
    ) values (
      new.id, new.installment_id, new.deal_id, v_lead_id, v_setter_id, 'setter',
      new.amount_cents, v_setter_rate,
      round(new.amount_cents * v_setter_rate / 100.0)::integer,
      coalesce(new.paid_at, now())
    ) on conflict (payment_id, recipient_role) do nothing;
  end if;

  return new;
end;
$fn$;

-- 4. View: per-deal numbers, with setter columns alongside closer ─────────
-- cash / outstanding count each PAYMENT once (filter on closer rows so dual
-- recipient rows don't double-count); closer + setter commissions are summed
-- and projected independently. setter_id appended at the end so existing
-- columns stay in the same position (Postgres won't let CREATE OR REPLACE
-- VIEW reorder columns).
create or replace view deal_commission_summary as
select
  d.id          as deal_id,
  d.lead_id,
  d.closed_by_id as closer_id,
  d.amount_cents as contract_amount_cents,
  coalesce(sum(cr.payment_amount_cents)    filter (where cr.recipient_role = 'closer' and cr.status <> 'clawed_back'), 0)::integer
    as cash_collected_cents,
  coalesce(sum(cr.commission_amount_cents) filter (where cr.recipient_role = 'closer' and cr.status <> 'clawed_back'), 0)::integer
    as commission_earned_cents,
  greatest(
    d.amount_cents - coalesce(sum(cr.payment_amount_cents) filter (where cr.recipient_role = 'closer' and cr.status <> 'clawed_back'), 0),
    0
  )::integer as outstanding_cents,
  coalesce(cl_tm.commission_pct, 10.00) as current_rate,
  round(
    greatest(d.amount_cents - coalesce(sum(cr.payment_amount_cents) filter (where cr.recipient_role = 'closer' and cr.status <> 'clawed_back'), 0), 0)
    * coalesce(cl_tm.commission_pct, 10.00) / 100.0
  )::integer as projected_remaining_commission_cents,
  count(cr.id) filter (where cr.recipient_role = 'closer') as payments_received_count,
  (select count(*) from deal_installments di where di.deal_id = d.id) as installments_planned,
  -- NEW columns appended below — order preserves existing positions.
  l.setter_id   as setter_id,
  coalesce(sum(cr.commission_amount_cents) filter (where cr.recipient_role = 'setter' and cr.status <> 'clawed_back'), 0)::integer
    as setter_commission_earned_cents,
  coalesce(st_tm.commission_pct, 0)     as setter_rate,
  round(
    greatest(d.amount_cents - coalesce(sum(cr.payment_amount_cents) filter (where cr.recipient_role = 'closer' and cr.status <> 'clawed_back'), 0), 0)
    * coalesce(st_tm.commission_pct, 0) / 100.0
  )::integer as projected_remaining_setter_commission_cents
from deals d
left join leads l            on l.id  = d.lead_id
left join team_members cl_tm on cl_tm.id = d.closed_by_id
left join team_members st_tm on st_tm.id = l.setter_id
left join commission_records cr on cr.deal_id = d.id
where d.status = 'won'
group by d.id, d.lead_id, d.closed_by_id, l.setter_id, d.amount_cents,
         cl_tm.commission_pct, st_tm.commission_pct;
