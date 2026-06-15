-- 0030 — Multiple roles per team member (e.g. closer AND setter).
--
-- WHAT CHANGES
--   team_members.roles team_role[]  → source of truth for permissions.
--   team_members.role (scalar)      → kept as an auto-maintained PRIMARY role
--                                      (highest-precedence role in the set).
--                                      Used for the default dashboard tab,
--                                      display, and backward compatibility.
--
-- All role-based RLS policies + reporting views move off the single-value
-- current_team_role() onto multi-role helpers has_role() / has_any_role() /
-- current_team_roles(). current_team_role() is retained (returns the primary)
-- for any back-compat callers.
--
-- Translation applied uniformly:
--   current_team_role() = 'admin'            → has_role('admin')
--   current_team_role() in (a, b, …)         → has_any_role(a, b, …)
--   current_team_role() = any(visible_to)    → current_team_roles() && visible_to
-- Identity checks (closer_id/setter_id/coach_id = current_team_member_id())
-- are unchanged.

begin;

-- ============================================================================
-- 1. Schema: add roles[] (source of truth), backfill from scalar role
-- ============================================================================
-- Add nullable first, backfill, THEN set NOT NULL — no unsafe '{}' default, so
-- there is never a window where a row can land with an empty roles array.
alter table team_members
  add column if not exists roles team_role[];

update team_members
  set roles = array[role]::team_role[]
  where roles is null or array_length(roles, 1) is null;

alter table team_members alter column roles set not null;

alter table team_members
  drop constraint if exists team_members_roles_not_empty;
alter table team_members
  add constraint team_members_roles_not_empty check (array_length(roles, 1) >= 1);

-- Keep the scalar `role` (primary) consistent with `roles` by precedence:
-- admin > coach > closer > setter. Lets the app write either column. Hardened
-- against NULL/empty so a bad write fails loudly rather than slipping a NULL
-- into roles (which would silently misbehave in RLS role checks).
create or replace function sync_primary_role()
returns trigger language plpgsql as $$
begin
  -- Legacy path: caller set scalar `role` but not `roles` → fold into the set.
  if tg_op = 'UPDATE'
     and new.role is distinct from old.role
     and new.roles is not distinct from old.roles then
    if new.role is not null and not (new.role = any(new.roles)) then
      new.roles := array_append(new.roles, new.role);
    end if;
  end if;

  -- Strip any NULLs that may have crept in (NULL in roles would break checks).
  if new.roles is not null then
    new.roles := array_remove(new.roles, null);
  end if;

  -- Never allow an empty set: fall back to the scalar role, else fail loudly.
  if new.roles is null or array_length(new.roles, 1) is null then
    if new.role is not null then
      new.roles := array[new.role]::team_role[];
    else
      raise exception 'team_members: at least one role is required (id=%)', new.id;
    end if;
  end if;

  -- Derive the primary role from the set by precedence.
  new.role := case
    when 'admin'  = any(new.roles) then 'admin'::team_role
    when 'coach'  = any(new.roles) then 'coach'::team_role
    when 'closer' = any(new.roles) then 'closer'::team_role
    when 'setter' = any(new.roles) then 'setter'::team_role
    else new.roles[1]
  end;

  if new.role is null then
    raise exception 'team_members: could not derive a primary role (id=%)', new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists team_members_sync_primary_role on team_members;
create trigger team_members_sync_primary_role
  before insert or update on team_members
  for each row execute function sync_primary_role();

-- ============================================================================
-- 2. Multi-role helper functions
-- ============================================================================
create or replace function current_team_roles()
returns team_role[] language sql stable security definer as $$
  select roles from team_members where user_id = auth.uid() limit 1;
$$;

create or replace function has_role(check_role team_role)
returns boolean language sql stable security definer as $$
  select coalesce(check_role = any(current_team_roles()), false);
$$;

create or replace function has_any_role(variadic check_roles team_role[])
returns boolean language sql stable security definer as $$
  select coalesce(current_team_roles() && check_roles, false);
$$;

-- current_team_role() is intentionally left as-is: it reads the scalar `role`
-- column, which is now the auto-maintained primary role.

-- ============================================================================
-- 3. Recreate role-dependent RLS policies with multi-role helpers
-- ============================================================================

-- ---- team_members (0001) ----
drop policy if exists team_members_admin_write on team_members;
create policy team_members_admin_write on team_members
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- leads (0001) ----
drop policy if exists leads_select on leads;
create policy leads_select on leads
  for select to authenticated using (
    has_role('admin')
    or closer_id = current_team_member_id()
    or setter_id = current_team_member_id()
  );

drop policy if exists leads_insert on leads;
create policy leads_insert on leads
  for insert to authenticated
  with check (has_any_role('admin', 'closer', 'setter'));

drop policy if exists leads_update on leads;
create policy leads_update on leads
  for update to authenticated
  using (
    has_role('admin')
    or closer_id = current_team_member_id()
    or setter_id = current_team_member_id()
  );

drop policy if exists leads_admin_delete on leads;
create policy leads_admin_delete on leads
  for delete to authenticated using (has_role('admin'));

-- ---- deals (0001) ----
drop policy if exists deals_select on deals;
create policy deals_select on deals
  for select to authenticated using (
    has_role('admin')
    or exists (
      select 1 from leads l
      where l.id = deals.lead_id
        and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
    )
  );

drop policy if exists deals_admin_write on deals;
create policy deals_admin_write on deals
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- students (0001) ----
drop policy if exists students_select on students;
create policy students_select on students
  for select to authenticated using (
    has_role('admin')
    or coach_id = current_team_member_id()
  );

drop policy if exists students_admin_write on students;
create policy students_admin_write on students
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));
-- students_coach_update is identity-only (coach_id) — unchanged.

-- ---- activities (0001) ----
drop policy if exists activities_select on activities;
create policy activities_select on activities
  for select to authenticated using (
    has_role('admin')
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

drop policy if exists activities_insert on activities;
create policy activities_insert on activities
  for insert to authenticated
  with check (has_any_role('admin', 'closer', 'setter', 'coach'));

-- ---- integrations_log (0001) ----
drop policy if exists integrations_log_admin on integrations_log;
create policy integrations_log_admin on integrations_log
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- lead_tags / lead_tag_assignments (0002) ----
drop policy if exists lead_tags_admin_write on lead_tags;
create policy lead_tags_admin_write on lead_tags
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

drop policy if exists lead_tag_assignments_select on lead_tag_assignments;
create policy lead_tag_assignments_select on lead_tag_assignments
  for select to authenticated using (
    has_role('admin')
    or exists (
      select 1 from leads l
      where l.id = lead_tag_assignments.lead_id
        and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
    )
  );

drop policy if exists lead_tag_assignments_write on lead_tag_assignments;
create policy lead_tag_assignments_write on lead_tag_assignments
  for all to authenticated
  using (
    has_role('admin')
    or exists (
      select 1 from leads l
      where l.id = lead_tag_assignments.lead_id
        and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
    )
  )
  with check (true);

-- conversations / conversation_participants / messages: chat feature was
-- dropped in 0009_remove_chat.sql — those tables no longer exist, so their
-- old role-based policies are gone with them. Nothing to translate here.

-- ---- payments (0002) ----
drop policy if exists payments_select on payments;
create policy payments_select on payments
  for select to authenticated using (
    has_role('admin')
    or (
      lead_id is not null and exists (
        select 1 from leads l
        where l.id = payments.lead_id
          and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
      )
    )
  );

drop policy if exists payments_admin_write on payments;
create policy payments_admin_write on payments
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- imports / import_rows / integration_configs (0002) ----
drop policy if exists imports_admin on imports;
create policy imports_admin on imports
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

drop policy if exists import_rows_admin on import_rows;
create policy import_rows_admin on import_rows
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

drop policy if exists integration_configs_admin on integration_configs;
create policy integration_configs_admin on integration_configs
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- sops (0002) — read by role overlap with visible_to ----
drop policy if exists sops_select on sops;
create policy sops_select on sops
  for select to authenticated using (
    current_team_roles() && visible_to
  );

drop policy if exists sops_admin_write on sops;
create policy sops_admin_write on sops
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- call_outcomes (0002) ----
drop policy if exists call_outcomes_select on call_outcomes;
create policy call_outcomes_select on call_outcomes
  for select to authenticated using (
    has_role('admin')
    or closer_id = current_team_member_id()
  );

drop policy if exists call_outcomes_insert on call_outcomes;
create policy call_outcomes_insert on call_outcomes
  for insert to authenticated with check (
    has_any_role('admin', 'closer')
  );

drop policy if exists call_outcomes_update on call_outcomes;
create policy call_outcomes_update on call_outcomes
  for update to authenticated using (
    has_role('admin') or closer_id = current_team_member_id()
  );

-- ---- reminders (0002) ----
drop policy if exists reminders_select on reminders;
create policy reminders_select on reminders
  for select to authenticated using (
    has_role('admin')
    or team_member_id = current_team_member_id()
  );

drop policy if exists reminders_write on reminders;
create policy reminders_write on reminders
  for all to authenticated
  using (
    has_role('admin')
    or team_member_id = current_team_member_id()
  )
  with check (true);

-- ---- notifications (0002) ----
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications
  for select to authenticated using (
    has_role('admin')
    or recipient_id = current_team_member_id()
  );
-- notifications_update_own is identity-only (recipient_id) — unchanged.

drop policy if exists notifications_admin_write on notifications;
create policy notifications_admin_write on notifications
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- storage.objects (0003) ----
drop policy if exists "call_recordings_admin" on storage.objects;
create policy "call_recordings_admin"
  on storage.objects for all to authenticated
  using (bucket_id = 'call-recordings' and has_role('admin'))
  with check (bucket_id = 'call-recordings' and has_role('admin'));

drop policy if exists "imports_admin" on storage.objects;
create policy "imports_admin"
  on storage.objects for all to authenticated
  using (bucket_id = 'imports' and has_role('admin'))
  with check (bucket_id = 'imports' and has_role('admin'));

drop policy if exists "sop_attachments_admin_write" on storage.objects;
create policy "sop_attachments_admin_write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'sop-attachments' and has_role('admin'));

-- ---- api_keys (0004) ----
drop policy if exists api_keys_admin on api_keys;
create policy api_keys_admin on api_keys
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- automation_settings (0005) ----
drop policy if exists automation_settings_admin_write on automation_settings;
create policy automation_settings_admin_write on automation_settings
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- webhook_subscriptions / webhook_deliveries (0008) ----
drop policy if exists webhook_subscriptions_admin on webhook_subscriptions;
create policy webhook_subscriptions_admin on webhook_subscriptions
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

drop policy if exists webhook_deliveries_admin on webhook_deliveries;
create policy webhook_deliveries_admin on webhook_deliveries
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- sop_reads (0014) ----
drop policy if exists sop_reads_select on sop_reads;
create policy sop_reads_select on sop_reads
  for select to authenticated using (
    has_role('admin')
    or team_member_id = current_team_member_id()
  );

-- ---- profit_splits (0019) ----
drop policy if exists profit_splits_admin_select on profit_splits;
create policy profit_splits_admin_select on profit_splits
  for select to authenticated using (has_role('admin'));

drop policy if exists profit_splits_admin_write on profit_splits;
create policy profit_splits_admin_write on profit_splits
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- deal_installments + deals_closer_insert (0020) ----
drop policy if exists deal_installments_admin_write on deal_installments;
create policy deal_installments_admin_write on deal_installments
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

drop policy if exists deals_closer_insert on deals;
create policy deals_closer_insert on deals
  for insert to authenticated
  with check (
    has_any_role('closer', 'admin')
    and exists (
      select 1 from leads l
      where l.id = deals.lead_id
        and (has_role('admin') or l.closer_id = current_team_member_id())
    )
  );

drop policy if exists deal_installments_closer_insert on deal_installments;
create policy deal_installments_closer_insert on deal_installments
  for insert to authenticated
  with check (
    exists (
      select 1 from deals d
      join leads l on l.id = d.lead_id
      where d.id = deal_installments.deal_id
        and (has_role('admin') or l.closer_id = current_team_member_id())
    )
  );

-- ---- payment_recovery_events (0021) ----
drop policy if exists payment_recovery_events_select on payment_recovery_events;
create policy payment_recovery_events_select on payment_recovery_events
  for select to authenticated using (
    has_role('admin')
    or exists (
      select 1 from leads l
      where l.id = payment_recovery_events.lead_id
        and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
    )
  );

drop policy if exists payment_recovery_events_admin_write on payment_recovery_events;
create policy payment_recovery_events_admin_write on payment_recovery_events
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

drop policy if exists payment_recovery_events_closer_insert on payment_recovery_events;
create policy payment_recovery_events_closer_insert on payment_recovery_events
  for insert to authenticated
  with check (
    exists (
      select 1 from leads l
      where l.id = payment_recovery_events.lead_id
        and (has_role('admin') or l.closer_id = current_team_member_id())
    )
    and event_type in (
      'closer_contacted_customer',
      'closer_unable_to_reach',
      'marked_recovering'
    )
  );

-- ---- commission_records / commission_adjustments (0022) ----
drop policy if exists commission_records_select on commission_records;
create policy commission_records_select on commission_records
  for select to authenticated using (
    has_role('admin')
    or closer_id = current_team_member_id()
  );

drop policy if exists commission_records_admin_write on commission_records;
create policy commission_records_admin_write on commission_records
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

drop policy if exists commission_adjustments_select on commission_adjustments;
create policy commission_adjustments_select on commission_adjustments
  for select to authenticated using (
    has_role('admin')
    or closer_id = current_team_member_id()
  );

drop policy if exists commission_adjustments_admin_write on commission_adjustments;
create policy commission_adjustments_admin_write on commission_adjustments
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

-- ---- calls + call_action_items + objections + call_objections (0024) ----
drop policy if exists calls_select on calls;
create policy calls_select on calls
  for select to authenticated using (
    has_role('admin')
    or closer_id = current_team_member_id()
    or (
      lead_id is not null and exists (
        select 1 from leads l
        where l.id = calls.lead_id
          and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
      )
    )
  );

drop policy if exists calls_update on calls;
create policy calls_update on calls
  for update to authenticated using (
    has_role('admin') or closer_id = current_team_member_id()
  );

drop policy if exists calls_admin_insert on calls;
create policy calls_admin_insert on calls
  for insert to authenticated
  with check (has_role('admin'));

drop policy if exists calls_admin_delete on calls;
create policy calls_admin_delete on calls
  for delete to authenticated using (has_role('admin'));

drop policy if exists call_action_items_select on call_action_items;
create policy call_action_items_select on call_action_items
  for select to authenticated using (
    exists (
      select 1 from calls c
      where c.id = call_action_items.call_id
        and (
          has_role('admin')
          or c.closer_id = current_team_member_id()
          or (c.lead_id is not null and exists (
            select 1 from leads l
            where l.id = c.lead_id
              and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
          ))
        )
    )
  );

drop policy if exists call_action_items_write on call_action_items;
create policy call_action_items_write on call_action_items
  for all to authenticated using (
    exists (
      select 1 from calls c
      where c.id = call_action_items.call_id
        and (has_role('admin') or c.closer_id = current_team_member_id())
    )
  ) with check (
    exists (
      select 1 from calls c
      where c.id = call_action_items.call_id
        and (has_role('admin') or c.closer_id = current_team_member_id())
    )
  );

drop policy if exists objections_admin_write on objections;
create policy objections_admin_write on objections
  for all to authenticated
  using (has_role('admin'))
  with check (has_role('admin'));

drop policy if exists call_objections_select on call_objections;
create policy call_objections_select on call_objections
  for select to authenticated using (
    exists (
      select 1 from calls c
      where c.id = call_objections.call_id
        and (
          has_role('admin')
          or c.closer_id = current_team_member_id()
          or (c.lead_id is not null and exists (
            select 1 from leads l
            where l.id = c.lead_id
              and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
          ))
        )
    )
  );

drop policy if exists call_objections_write on call_objections;
create policy call_objections_write on call_objections
  for all to authenticated using (
    exists (
      select 1 from calls c
      where c.id = call_objections.call_id
        and (has_role('admin') or c.closer_id = current_team_member_id())
    )
  ) with check (
    exists (
      select 1 from calls c
      where c.id = call_objections.call_id
        and (has_role('admin') or c.closer_id = current_team_member_id())
    )
  );

-- ============================================================================
-- 4. Recreate reporting views that filtered on the scalar role
-- ============================================================================

-- Closer leaderboard — anyone whose roles include 'closer'.
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
where 'closer' = any(tm.roles) and tm.is_active = true
group by tm.id, tm.full_name;

-- Setter leaderboard — anyone whose roles include 'setter'.
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
where 'setter' = any(tm.roles) and tm.is_active = true
group by tm.id, tm.full_name;

-- Closer call stats — anyone whose roles include 'closer' or 'admin'.
create or replace view closer_call_stats_v as
with totals as (
  select
    c.closer_id,
    count(*) as calls_total,
    count(*) filter (where c.started_at >= now() - interval '30 days') as calls_30d,
    count(*) filter (where c.started_at >= now() - interval '7 days') as calls_7d,
    count(*) filter (where c.outcome = 'closed_won') as closes,
    count(*) filter (where c.outcome in ('pending')) as untagged_outcomes,
    count(*) filter (where c.outcome not in ('pending')) as tagged_outcomes,
    count(*) filter (where (c.ai_review->>'needs_review')::boolean is true) as needs_review,
    (avg(c.duration_seconds))::integer as avg_duration_seconds,
    (avg(((c.ai_review->>'framework_score')::numeric))) as avg_framework_score
  from calls c
  where c.closer_id is not null
  group by c.closer_id
)
select
  tm.id as closer_id,
  tm.full_name,
  coalesce(t.calls_total, 0) as calls_total,
  coalesce(t.calls_30d, 0) as calls_30d,
  coalesce(t.calls_7d, 0) as calls_7d,
  coalesce(t.closes, 0) as closes,
  coalesce(t.untagged_outcomes, 0) as untagged_outcomes,
  coalesce(t.tagged_outcomes, 0) as tagged_outcomes,
  coalesce(t.needs_review, 0) as needs_review,
  coalesce(t.avg_duration_seconds, 0) as avg_duration_seconds,
  case
    when coalesce(t.tagged_outcomes, 0) = 0 then 0
    else round(100.0 * t.closes::numeric / t.tagged_outcomes, 1)
  end as close_rate_pct,
  round(coalesce(t.avg_framework_score, 0)::numeric, 1) as avg_framework_score
from team_members tm
left join totals t on t.closer_id = tm.id
where tm.is_active = true and tm.roles && array['closer','admin']::team_role[];

commit;
