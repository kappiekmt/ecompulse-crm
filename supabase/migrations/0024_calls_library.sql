-- 0024 — Call recording library (Fathom integration)
--
-- Adds:
--   - calls: one row per recorded sales call (Fathom or manual upload).
--   - call_action_items: action items extracted from the call.
--   - objections: catalog of objection types (price, timing, authority...).
--   - call_objections: many-to-many tying calls to the objections raised.
--
-- Plus:
--   - Trigger that auto-advances a lead's pipeline stage when a call outcome
--     is tagged (e.g. outcome='closed_won' → leads.stage='won').
--   - RLS so closers only see their own calls; admins see everything.

-- ============================================================================
-- 1. Enums
-- ============================================================================
create type call_outcome as enum (
  'pending',         -- no outcome tagged yet
  'closed_won',      -- prospect signed
  'follow_up',       -- needs another call
  'no_show',         -- didn't attend
  'not_qualified',   -- ICP miss
  'pitched',         -- pitched but no decision
  'lost'             -- pitched and declined
);

create type objection_category as enum (
  'price', 'timing', 'authority', 'trust', 'need', 'spouse', 'other'
);

create type call_source as enum ('fathom', 'manual');

-- ============================================================================
-- 2. Tables
-- ============================================================================

create table calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  closer_id uuid references team_members(id) on delete set null,
  deal_id uuid references deals(id) on delete set null,

  -- Provider identifiers — fathom_id is unique so webhook retries are idempotent.
  source call_source not null default 'fathom',
  fathom_id text unique,
  fathom_share_url text,
  recording_url text,
  transcript_url text,

  -- Call metadata.
  title text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,

  -- Participants. host_email is what we match to a closer; attendee_emails is
  -- what we match to a lead (first non-host email wins).
  host_email text,
  attendee_emails text[],

  -- Content.
  summary text,        -- Fathom AI summary
  transcript text,     -- full transcript (nullable; can be huge)

  -- Outcome — manually tagged by the closer, drives pipeline automation.
  outcome call_outcome not null default 'pending',
  outcome_notes text,
  outcome_tagged_by uuid references team_members(id) on delete set null,
  outcome_tagged_at timestamptz,

  -- AI review (Claude pass). jsonb so we can evolve the score shape without
  -- migrations: { framework_score, strengths[], improvements[], needs_review }
  ai_review jsonb,
  ai_reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calls_lead_id_idx on calls(lead_id);
create index calls_closer_id_idx on calls(closer_id);
create index calls_deal_id_idx on calls(deal_id);
create index calls_started_at_idx on calls(started_at desc);
create index calls_outcome_idx on calls(outcome);
create index calls_needs_review_idx on calls((ai_review->>'needs_review'))
  where ai_review is not null;

create trigger calls_set_updated_at
  before update on calls
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------

create table call_action_items (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  description text not null,
  assignee text,           -- free text from Fathom ("Sarah" / "the prospect")
  due_date date,
  completed boolean not null default false,
  completed_at timestamptz,
  source call_source not null default 'fathom',
  created_at timestamptz not null default now()
);

create index call_action_items_call_id_idx on call_action_items(call_id);
create index call_action_items_open_idx on call_action_items(call_id)
  where completed = false;

-- ----------------------------------------------------------------------------

create table objections (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  description text,
  category objection_category not null default 'other',
  created_at timestamptz not null default now()
);

-- Seed the common ones so the catalog is useful out of the box.
insert into objections (label, category, description) values
  ('Too expensive',           'price',     'Price is the main blocker.'),
  ('Need to think about it',  'timing',    'Wants time to decide — usually a soft no.'),
  ('Not the right time',      'timing',    'Cash flow, project conflict, life event.'),
  ('Need to talk to spouse',  'spouse',    'Partner is the decision-maker.'),
  ('Need to talk to partner', 'authority', 'Business partner sign-off required.'),
  ('Already tried something similar', 'trust', 'Burned by a previous program.'),
  ('Will I get results?',     'trust',     'Doubts the outcome is achievable for them.'),
  ('Not sure I have time',    'need',      'Capacity / commitment objection.'),
  ('Want to do it alone',     'need',      'Thinks they can DIY.');

-- ----------------------------------------------------------------------------

create table call_objections (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  objection_id uuid not null references objections(id) on delete cascade,
  quote text,                  -- excerpt from the transcript
  source call_source not null default 'manual',
  created_at timestamptz not null default now(),
  unique(call_id, objection_id)
);

create index call_objections_call_id_idx on call_objections(call_id);
create index call_objections_objection_id_idx on call_objections(objection_id);

-- ============================================================================
-- 3. Outcome → lead stage trigger
-- ============================================================================
-- When a call's outcome changes from 'pending' to a terminal value, advance
-- the linked lead. Closers can still manually override afterwards from the
-- Pipeline board.

create or replace function apply_call_outcome_to_lead()
returns trigger language plpgsql security definer
set search_path = public as $fn$
declare
  target_stage lead_stage;
begin
  -- Only act when outcome actually changed and we have a lead.
  if new.outcome = old.outcome then return new; end if;
  if new.lead_id is null then return new; end if;

  target_stage := case new.outcome
    when 'closed_won'    then 'won'::lead_stage
    when 'lost'          then 'lost'::lead_stage
    when 'pitched'       then 'pitched'::lead_stage
    when 'no_show'       then 'no_show'::lead_stage
    when 'follow_up'     then 'pitched'::lead_stage   -- still in active pursuit
    when 'not_qualified' then 'lost'::lead_stage
    else null
  end;

  if target_stage is null then return new; end if;

  update leads
     set stage = target_stage,
         closed_at = case
           when target_stage in ('won', 'lost') then coalesce(closed_at, now())
           else closed_at
         end
   where id = new.lead_id;

  insert into activities (lead_id, actor_id, type, payload)
  values (
    new.lead_id,
    new.outcome_tagged_by,
    'call.outcome_tagged',
    jsonb_build_object(
      'call_id', new.id,
      'outcome', new.outcome,
      'previous_outcome', old.outcome,
      'new_stage', target_stage,
      'notes', new.outcome_notes
    )
  );

  return new;
end;
$fn$;

create trigger calls_apply_outcome
  after update of outcome on calls
  for each row execute function apply_call_outcome_to_lead();

-- ============================================================================
-- 4. Row Level Security
-- ============================================================================
alter table calls enable row level security;
alter table call_action_items enable row level security;
alter table objections enable row level security;
alter table call_objections enable row level security;

-- calls — same model as leads: admins see all, closers see their own, setters
-- see calls on leads they brought in.
create policy calls_select on calls
  for select to authenticated using (
    current_team_role() = 'admin'
    or closer_id = current_team_member_id()
    or (
      lead_id is not null and exists (
        select 1 from leads l
        where l.id = calls.lead_id
          and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
      )
    )
  );

-- Admins + the call's closer can update (e.g. tag outcome, add notes).
create policy calls_update on calls
  for update to authenticated using (
    current_team_role() = 'admin' or closer_id = current_team_member_id()
  );

-- Inserts come from the Fathom webhook (service role) or admins for manual
-- upload. Authenticated insert is restricted to admins.
create policy calls_admin_insert on calls
  for insert to authenticated
  with check (current_team_role() = 'admin');

create policy calls_admin_delete on calls
  for delete to authenticated using (current_team_role() = 'admin');

-- call_action_items — visible/editable if you can see the parent call.
create policy call_action_items_select on call_action_items
  for select to authenticated using (
    exists (
      select 1 from calls c
      where c.id = call_action_items.call_id
        and (
          current_team_role() = 'admin'
          or c.closer_id = current_team_member_id()
          or (c.lead_id is not null and exists (
            select 1 from leads l
            where l.id = c.lead_id
              and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
          ))
        )
    )
  );

create policy call_action_items_write on call_action_items
  for all to authenticated using (
    exists (
      select 1 from calls c
      where c.id = call_action_items.call_id
        and (current_team_role() = 'admin' or c.closer_id = current_team_member_id())
    )
  ) with check (
    exists (
      select 1 from calls c
      where c.id = call_action_items.call_id
        and (current_team_role() = 'admin' or c.closer_id = current_team_member_id())
    )
  );

-- objections — everyone can read; only admins can manage the catalog.
create policy objections_select on objections
  for select to authenticated using (true);

create policy objections_admin_write on objections
  for all to authenticated
  using (current_team_role() = 'admin')
  with check (current_team_role() = 'admin');

-- call_objections — same visibility as the parent call.
create policy call_objections_select on call_objections
  for select to authenticated using (
    exists (
      select 1 from calls c
      where c.id = call_objections.call_id
        and (
          current_team_role() = 'admin'
          or c.closer_id = current_team_member_id()
          or (c.lead_id is not null and exists (
            select 1 from leads l
            where l.id = c.lead_id
              and (l.closer_id = current_team_member_id() or l.setter_id = current_team_member_id())
          ))
        )
    )
  );

create policy call_objections_write on call_objections
  for all to authenticated using (
    exists (
      select 1 from calls c
      where c.id = call_objections.call_id
        and (current_team_role() = 'admin' or c.closer_id = current_team_member_id())
    )
  ) with check (
    exists (
      select 1 from calls c
      where c.id = call_objections.call_id
        and (current_team_role() = 'admin' or c.closer_id = current_team_member_id())
    )
  );

-- ============================================================================
-- 5. Aggregate view — top objections per closer per period
-- ============================================================================
create or replace view objection_rollup as
select
  c.closer_id,
  o.id as objection_id,
  o.label,
  o.category,
  date_trunc('week', c.started_at at time zone 'Europe/Amsterdam')::date as week_start,
  count(*) as occurrences,
  array_agg(c.id order by c.started_at desc) as example_call_ids
from call_objections co
  join calls c on c.id = co.call_id
  join objections o on o.id = co.objection_id
where c.started_at is not null
group by c.closer_id, o.id, o.label, o.category,
         date_trunc('week', c.started_at at time zone 'Europe/Amsterdam')::date;
