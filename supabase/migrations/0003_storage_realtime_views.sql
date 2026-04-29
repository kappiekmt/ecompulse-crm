-- 0003 — Storage buckets, Realtime publication, and reporting views.

-- ============================================================================
-- 1. Storage buckets
-- ============================================================================
-- Avatars are public-readable; everything else is private and signed-URL only.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('lead-attachments', 'lead-attachments', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('call-recordings', 'call-recordings', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('sop-attachments', 'sop-attachments', false)
on conflict (id) do nothing;

-- Storage RLS — only authenticated users; admins write to imports & recordings.
create policy "avatars_authenticated_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

create policy "avatars_owner_write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars_owner_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "lead_attachments_authenticated"
  on storage.objects for all to authenticated
  using (bucket_id = 'lead-attachments')
  with check (bucket_id = 'lead-attachments');

create policy "call_recordings_admin"
  on storage.objects for all to authenticated
  using (bucket_id = 'call-recordings' and current_team_role() = 'admin')
  with check (bucket_id = 'call-recordings' and current_team_role() = 'admin');

create policy "imports_admin"
  on storage.objects for all to authenticated
  using (bucket_id = 'imports' and current_team_role() = 'admin')
  with check (bucket_id = 'imports' and current_team_role() = 'admin');

create policy "sop_attachments_authenticated_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'sop-attachments');

create policy "sop_attachments_admin_write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'sop-attachments' and current_team_role() = 'admin');

-- ============================================================================
-- 2. Realtime publication
-- ============================================================================
-- These tables get pushed to subscribers in real time so the UI updates without
-- polling. Add new ones here as they're built.
alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table deals;
alter publication supabase_realtime add table students;
alter publication supabase_realtime add table activities;
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table call_outcomes;
alter publication supabase_realtime add table reminders;

-- ============================================================================
-- 3. Reporting views — power the dashboard KPIs and charts
-- ============================================================================

-- Booked vs showed vs closed counts per lead — used by funnel reports.
create or replace view lead_funnel_v as
select
  l.id as lead_id,
  l.created_at,
  l.stage,
  l.closer_id,
  l.setter_id,
  exists (select 1 from call_outcomes co where co.lead_id = l.id and co.result = 'showed') as did_show,
  exists (select 1 from call_outcomes co where co.lead_id = l.id and co.result = 'pitched') as was_pitched,
  exists (select 1 from deals d where d.lead_id = l.id and d.status = 'won') as is_won,
  coalesce((select sum(p.amount_cents) from payments p where p.lead_id = l.id and p.is_refund = false), 0) as cash_collected_cents
from leads l;

-- Per-day rollup — fast to query for the time-series charts.
create or replace view daily_metrics_v as
with payment_days as (
  select
    date_trunc('day', paid_at)::date as day,
    sum(case when is_refund = false then amount_cents else 0 end) as cash_collected_cents,
    sum(case when is_refund = true then -amount_cents else 0 end) as refunds_cents
  from payments
  group by 1
),
booking_days as (
  select date_trunc('day', created_at)::date as day, count(*) as calls_booked
  from leads
  where stage <> 'new'
  group by 1
),
deal_days as (
  select date_trunc('day', closed_at)::date as day,
         sum(amount_cents) as order_value_cents,
         count(*) filter (where status = 'won') as wins,
         count(*) filter (where status = 'lost') as losses
  from deals
  where closed_at is not null
  group by 1
)
select
  d.day,
  coalesce(p.cash_collected_cents, 0) as cash_collected_cents,
  coalesce(p.refunds_cents, 0) as refunds_cents,
  coalesce(b.calls_booked, 0) as calls_booked,
  coalesce(d.order_value_cents, 0) as order_value_cents,
  coalesce(d.wins, 0) as wins,
  coalesce(d.losses, 0) as losses
from (
  select day from payment_days
  union select day from booking_days
  union select day from deal_days
) d
left join payment_days p on p.day = d.day
left join booking_days b on b.day = d.day
left join deal_days  on  deal_days.day  = d.day;

-- Closer leaderboard — drives "Leaderboard — Cash Collected" and Team Performance.
create or replace view closer_performance_v as
select
  tm.id as closer_id,
  tm.full_name,
  count(distinct l.id) filter (where l.stage in ('booked','confirmed')) as calls_booked,
  count(distinct co.id) filter (where co.result = 'showed') as calls_showed,
  count(distinct co.id) filter (where co.result in ('pitched','closed')) as calls_pitched,
  count(distinct d.id) filter (where d.status = 'won') as deals_won,
  count(distinct d.id) filter (where d.status = 'lost') as deals_lost,
  coalesce(sum(p.amount_cents) filter (where p.is_refund = false), 0) as cash_collected_cents,
  case
    when count(distinct co.id) filter (where co.result in ('showed','no_show')) = 0 then 0
    else round(
      100.0 * count(distinct co.id) filter (where co.result = 'showed')::numeric
      / count(distinct co.id) filter (where co.result in ('showed','no_show'))
    , 1)
  end as show_rate_pct,
  case
    when count(distinct co.id) filter (where co.result = 'showed') = 0 then 0
    else round(
      100.0 * count(distinct d.id) filter (where d.status = 'won')::numeric
      / count(distinct co.id) filter (where co.result = 'showed')
    , 1)
  end as close_rate_pct
from team_members tm
left join leads l on l.closer_id = tm.id
left join call_outcomes co on co.closer_id = tm.id
left join deals d on d.lead_id = l.id
left join payments p on p.lead_id = l.id
where tm.role = 'closer' and tm.is_active = true
group by tm.id, tm.full_name;

-- Setter leaderboard.
create or replace view setter_performance_v as
select
  tm.id as setter_id,
  tm.full_name,
  count(distinct l.id) as bookings_made,
  count(distinct l.id) filter (where l.stage in ('won','active_student')) as bookings_to_sale,
  case
    when count(distinct l.id) = 0 then 0
    else round(100.0 * count(distinct l.id) filter (where l.stage in ('won','active_student'))::numeric / count(distinct l.id), 1)
  end as conversion_rate_pct
from team_members tm
left join leads l on l.setter_id = tm.id
where tm.role = 'setter' and tm.is_active = true
group by tm.id, tm.full_name;

-- KPI snapshot used by the 8 stat cards on the dashboard.
create or replace view kpi_snapshot_v as
with windowed as (
  select
    coalesce(sum(d.amount_cents) filter (where d.status = 'won'), 0) as order_value_cents,
    coalesce(sum(p.amount_cents) filter (where p.is_refund = false), 0) as cash_collected_cents,
    count(distinct l.id) as calls_booked,
    count(distinct co.id) filter (where co.result in ('showed','no_show')) as showed_or_no_show,
    count(distinct co.id) filter (where co.result = 'showed') as showed,
    count(distinct co.id) filter (where co.result in ('rescheduled','no_show')) as cancels_or_no_shows,
    count(distinct d.id) filter (where d.status = 'won') as wins,
    count(distinct d.id) filter (where d.status in ('won','lost')) as decisive
  from leads l
  left join call_outcomes co on co.lead_id = l.id
  left join deals d on d.lead_id = l.id
  left join payments p on p.lead_id = l.id
)
select
  cash_collected_cents,
  order_value_cents,
  calls_booked,
  case when showed_or_no_show = 0 then 0 else round(100.0 * showed::numeric / showed_or_no_show, 1) end as show_up_rate_pct,
  case when decisive = 0 then 0 else round(100.0 * wins::numeric / decisive, 1) end as conversion_rate_pct,
  case when calls_booked = 0 then 0 else round(100.0 * cancels_or_no_shows::numeric / calls_booked, 1) end as cancel_rate_pct,
  case when calls_booked = 0 then 0 else order_value_cents / calls_booked end as avg_order_per_call_cents,
  case when wins = 0 then 0 else order_value_cents / wins end as avg_order_per_close_cents
from windowed;
