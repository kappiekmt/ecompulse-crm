-- 0014 — Turn SOPs into a proper onboarding hub.
--
-- Adds metadata for ordering, summarising, estimating read time, and pinning
-- SOPs to a role-specific "starter pack" that new team members work through
-- on day 1. Adds sop_reads to track which SOPs each member has marked done.

alter table sops
  add column if not exists description text,
  add column if not exists pinned_for_onboarding boolean not null default false,
  add column if not exists display_order integer not null default 0,
  add column if not exists read_time_minutes integer,
  add column if not exists slug text;

-- Regular unique index on slug. Postgres treats NULLs as distinct so SOPs
-- without a slug don't conflict; only two non-null slugs do.
create unique index if not exists sops_slug_unique on sops(slug);

create index if not exists sops_category_order_idx on sops(category, display_order);
create index if not exists sops_pinned_idx
  on sops(display_order)
  where pinned_for_onboarding = true and is_archived = false;

-- ============================================================================
-- sop_reads — one row per (member, sop) once they've read it.
-- ============================================================================
create table if not exists sop_reads (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references sops(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (sop_id, team_member_id)
);

create index if not exists sop_reads_member_idx on sop_reads(team_member_id);

alter table sop_reads enable row level security;

create policy sop_reads_select on sop_reads
  for select to authenticated using (
    current_team_role() = 'admin'
    or team_member_id = current_team_member_id()
  );

create policy sop_reads_insert_own on sop_reads
  for insert to authenticated
  with check (team_member_id = current_team_member_id());

create policy sop_reads_delete_own on sop_reads
  for delete to authenticated
  using (team_member_id = current_team_member_id());

-- ============================================================================
-- Seed: a starter pack of SOPs for each role.
-- These show up under "Onboarding Starter Pack" on day 1.
-- Idempotent — uses on conflict (slug) do nothing so re-runs are safe.
-- ============================================================================
insert into sops (slug, category, title, description, body_md, visible_to, pinned_for_onboarding, display_order, read_time_minutes)
values
  (
    'welcome-to-ecompulse',
    'onboarding',
    '👋 Welcome to EcomPulse',
    'What we do, who you are joining, and how the next two weeks will go.',
    $md$# Welcome to EcomPulse

You've just joined a sales operation that turns paid traffic into 1:1 strategy calls and converts those calls into program enrolments. This page is your map.

## What we do
- We sell info products / coaching programs to e-commerce operators.
- Calendly is the front door — every booking lands here, the closer takes the call, and the deal flows through Stripe → Discord → Whop.

## How the team is structured
- **Closers** run strategy calls and close deals.
- **Setters** book those calls (DMs, ad funnels, referrals).
- **Coaches** deliver the program after the sale.
- **Admin** owns the operation end-to-end.

## Your first 48 hours
1. Read the SOPs pinned for your role (see below).
2. Set your Slack ID in the CRM (Team → your row → Slack ID) so you actually get pinged.
3. Shadow one strategy call (closers) or one onboarding session (coaches).
4. Hit your DM for any blockers.

That's it. Welcome aboard 🎯
$md$,
    array['admin','closer','setter','coach']::team_role[],
    true, 0, 3
  ),
  (
    'closer-day-one',
    'onboarding',
    '🎯 Your first week as a Closer',
    'How a closer''s day flows, what to do before/during/after every call, and how to log outcomes.',
    $md$# Your first week as a Closer

## Daily rhythm
- **Morning:** open the CRM dashboard. "Today's calls" lists every booking assigned to you.
- **For each call (in order):**
  1. Click the lead → review pre-call SOP checklist.
  2. Toggle **Pre-call started** ON in the drawer when you've done research + sent the WhatsApp pre-call SOP message.
  3. Take the call.
  4. Click the matching status pill (`showed`, `no_show`, `pitched`, `closed`, `lost`) — that auto-logs a `call_outcomes` row and advances the lead's stage.
- **End of day:** the CRM auto-fires the EOD report at 21:00 Amsterdam — your stats land in #eod.

## Pre-call SOP (do this 15+ minutes before)
1. Read the lead's email + IG to get context.
2. Send the WhatsApp pre-call message (button on the Slack #bookings notification — opens with the template prefilled).
3. Mark **Pre-call started** ON.

## On the call
- Frame: "I'll ask 6-7 questions, then I'll show you a path that makes sense or tell you it doesn't fit."
- Discovery → Diagnosis → Prescription → Pitch → Close.
- See *Discovery call structure* SOP for the deeper breakdown.

## After the call
- Click the right status pill on the lead (don't skip — it drives your stats).
- Add notes if there's nuance the next person should know.
- If pitched but not closed: tag the lead `Warm` or `Hot`, set follow-up cadence.
$md$,
    array['admin','closer']::team_role[],
    true, 1, 4
  ),
  (
    'setter-day-one',
    'onboarding',
    '📅 Your first week as a Setter',
    'How bookings flow, what counts toward your rate, and how to keep your show rate high.',
    $md$# Your first week as a Setter

## What you own
You source leads through DMs / outbound and book them onto a closer's Calendly. The CRM auto-attributes the booking to you when your `setter_id` is set on the lead.

## How leads come in
- **IG DMs / outbound:** you take the conversation; once they're warm, send the booking link.
- **Inbound funnel:** ad → landing page → public API → CRM. Setter assignment may need a manual nudge (see Lead drawer → Assignments).

## What you're measured on (visible on your dashboard)
- **Bookings** — total calls booked
- **Show rate** — % of your bookings where the lead actually showed
- **Conversion** — % of your bookings that became a deal

The show rate is the biggest leverage point. Tactics:
- Confirm with a personal message 24h and 1h before the call.
- Make the lead feel they have to confirm — otherwise the slot is given away.
- Send the closer's pre-call message via WhatsApp once the booking lands.
$md$,
    array['admin','setter']::team_role[],
    true, 1, 3
  ),
  (
    'coach-day-one',
    'onboarding',
    '🎓 Your first week as a Coach',
    'How students reach you, the onboarding chain, and what your coach dashboard shows.',
    $md$# Your first week as a Coach

## How students reach you
1. Lead pays via Stripe → CRM creates a `students` row.
2. Admin (or auto-rule) assigns them to you.
3. Onboarding chain fires: Discord invite → Whop access → kickoff session booked.

## Your dashboard
- **My students** — everyone assigned to you, grouped by onboarding status.
- **Pending onboarding** — new students who haven't started.
- **In progress** — students mid-onboarding.
- **Active students** — fully onboarded.

## Day 1 with a new student
- Watch their student detail screen.
- Check Discord/Whop status.
- Schedule the kickoff session.
- Document anything unusual in their notes.
$md$,
    array['admin','coach']::team_role[],
    true, 1, 3
  ),
  (
    'pre-call-sop-checklist',
    'pre_call',
    'Pre-call SOP — research checklist',
    'The exact 5-step checklist every closer runs through 15+ minutes before a strategy call.',
    $md$# Pre-call SOP — research checklist

Run this 15+ minutes before every call. The CRM tracks completion via the **Pre-call started** toggle on the lead.

## Checklist
1. **Lead profile** — name, business, role
2. **Their funnel** — what page brought them in, which UTM, any free content downloaded
3. **Money math** — rough revenue / margin if visible (LinkedIn, IG bio, website)
4. **Pain hypothesis** — based on the above, what's their #1 likely problem
5. **Custom hook** — one sentence in the WhatsApp message that shows you actually looked

## WhatsApp pre-call message
The Slack #bookings notification has a primary green button "📱 WhatsApp (pre-call SOP)" that opens WhatsApp with a templated message prefilled. Edit the last sentence to add your custom hook before sending.

## Why we do this
Show rate jumps from ~50% to ~80% when the lead has had real, personalized contact in the 24h before the call.
$md$,
    array['admin','closer']::team_role[],
    false, 0, 4
  ),
  (
    'discovery-call-structure',
    'on_call',
    'Discovery call structure',
    'The 7-question framework: Diagnosis → Pain → Prescription → Pitch → Close.',
    $md$# Discovery call structure

## Frame in the first 60 seconds
> "I'll ask you 6-7 questions to understand where you are, and at the end I'll either show you a path that makes sense or tell you it doesn't fit. Sound fair?"

## The 7 questions
1. Walk me through what you do today — products, channels, scale.
2. What's working really well right now?
3. What's the #1 bottleneck you'd remove if you could?
4. How long has that bottleneck been there?
5. What have you tried so far?
6. If we removed it, what does the next 12 months look like for you?
7. What's holding you back from going hard at it now?

## Pitch structure
- Recap their words (mirror)
- Diagnose: "Here's what's actually happening…"
- Prescribe: "Here's what would fix it…"
- Bridge: "We do this every day with people in your situation."
- Offer: program structure + price + start date
- Close: "Does that feel like the right path?"

## If they object
See *Objection handling cheat sheet* SOP.
$md$,
    array['admin','closer']::team_role[],
    false, 0, 5
  ),
  (
    'objection-handling',
    'on_call',
    'Objection handling cheat sheet',
    'Stock responses to the four most common objections: price, time, partner, "I''ll think about it".',
    $md$# Objection handling cheat sheet

## Price
> "I hear you. Quick question — if it cost €1, would you do it? So it's not really price, it's whether you believe this works for you. Let's talk about that."

## Time
> "Most of our students are also overwhelmed when they start. The reason this works is that we do the heavy lifting upfront so you spend less time, not more. If it took 4 hrs/week and added 6-figures, would you find the 4 hours?"

## Partner / Spouse
> "Totally fair. What would they need to see to be on board? Let's prep that conversation together — I can join the call with them if helpful."

## "I'll think about it"
> "Cool. What specifically are you going to think about? Let's just talk through it now — that's what I'm here for."

## Don't argue
If a no is a real no, take it. Mark `lost` with a reason in the CRM. No sob stories.
$md$,
    array['admin','closer']::team_role[],
    false, 1, 4
  ),
  (
    'log-call-outcomes',
    'post_call',
    'Logging call outcomes',
    'How to use the status pills correctly — they drive your stats, the EOD, and pipeline reports.',
    $md$# Logging call outcomes

After every call, click the matching status pill in the lead drawer:

| Status | When to use |
|---|---|
| `showed` | Lead joined and talked to you |
| `no_show` | Lead didn't join, didn't reschedule on time |
| `pitched` | You delivered the offer — they haven't said yes/no yet |
| `closed` | They said yes, payment expected |
| `lost` | They said no — pick a reason in the notes |
| `cancelled` | They cancelled before the call (use Calendly's cancel page) |
| `follow_up_short` | Pitched but want a quick callback (within days) |
| `follow_up_long` | Pitched but want a longer pause |

Each click writes a `call_outcomes` row. Don't skip — your show rate / close rate / cash collected rolls up from these.
$md$,
    array['admin','closer']::team_role[],
    false, 0, 2
  ),
  (
    'admin-invite-team-members',
    'onboarding',
    'Inviting & removing team members',
    'How to add closers/setters/coaches and remove them cleanly.',
    $md$# Inviting & removing team members

## Invite
1. **Team → Invite member**.
2. Fill name + email + role + timezone + Slack ID (paste from Slack profile → ⋯ → Copy member ID).
3. Hit *Send invite*. Supabase emails them a magic link. They click → set a password → land in the CRM.

## Remove
- Soft remove: row → **Pause** (sets `is_active = false` — keeps history, blocks sign-in).
- Hard remove: row → red trash icon → confirm. Deletes the auth user + team_members row. Their leads / students get unassigned (NOT deleted).

You can't delete yourself.
$md$,
    array['admin']::team_role[],
    false, 0, 2
  )
on conflict (slug) do nothing;
