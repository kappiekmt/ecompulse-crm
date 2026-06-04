# EcomPulse CRM — Architecture & Structure

EcomPulse CRM is a custom-built, role-aware sales-and-coaching CRM for an online-coaching / info-product business that sells high-ticket coaching programs through booked strategy calls. It runs the full lifecycle in one place — from an inbound Calendly booking, through the recorded sales call and close, into Stripe payment, student onboarding, commission accounting, and automated payment recovery — with every screen and every row scoped to the viewer's role (admin, closer, setter, or coach). The product is for the operating team of a single coaching brand: admins/owners who need full financial and operational visibility, closers and setters working the pipeline, and coaches running student onboarding.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [How It Works — Architecture, Roles & Lifecycle Flows](#3-how-it-works--architecture-roles--lifecycle-flows)
4. [Frontend](#4-frontend)
5. [Database Schema](#5-database-schema)
6. [Backend & Integrations](#6-backend--integrations)
7. [Repository Layout](#7-repository-layout)
8. [Notable Conventions & Design Decisions](#8-notable-conventions--design-decisions)

---

## 1. Overview

EcomPulse CRM is a single-page web application that operates the end-to-end revenue and delivery pipeline for an online-coaching / info-product sales business. It centralizes everything that happens to a prospect: a Calendly booking creates a lead, a Fathom-recorded strategy call gets AI-scored, a closer logs the deal, Stripe confirms payment, a student record is created and assigned to a coach for onboarding, and commissions plus payment-recovery sequences run automatically on top.

**Who uses it — four roles:**

| Role | What they do |
|---|---|
| **admin** | Owners/operators. Full visibility: all leads, deals, students, calls, payments, finance, commissions, team management, integrations, automations, imports, and API keys. |
| **closer** | Runs strategy calls on their assigned leads, tags call outcomes, and logs closes (deal + payment schedule). Sees their own pipeline, calls, objections, and commissions. |
| **setter** | Books and qualifies leads, manages the pipeline for leads assigned to them. No access to calls, coaching, or finance. |
| **coach** | Onboards and manages only their assigned students. No access to leads, sales, or finance. |

Navigation is gated by role in the UI, but **Row-Level Security in Postgres is the real access boundary** — the combination of role and record ownership (`closer_id` / `setter_id` / `coach_id` / `recipient_id`) governs every read and write.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| **Frontend framework** | React 19 (`createRoot` + `<StrictMode>`), single-page app (no SSR — `components.json` sets `"rsc": false`) |
| **Build tooling** | Vite 8 with `@vitejs/plugin-react` and `@tailwindcss/vite`; `@` alias → `./src` |
| **Language** | TypeScript ~6.0, strict bundler mode (project references: `tsconfig.json` → `tsconfig.app.json` + `tsconfig.node.json`) |
| **Styling** | Tailwind CSS v4 (CSS-first `@theme` tokens in `src/index.css`, no `tailwind.config`) |
| **UI components** | shadcn/ui (new-york style, base color slate, CSS variables) with `lucide-react` icons |
| **Routing** | React Router v7 (`react-router-dom`) |
| **Server state** | TanStack Query v5 |
| **Charts / DnD / Markdown** | recharts, `@dnd-kit/core` (pipeline kanban), `react-markdown` + `remark-gfm` (SOPs) |
| **Utilities** | `class-variance-authority`, `clsx`, `tailwind-merge` (wrapped in `src/lib/utils.ts`) |
| **Data/auth client** | `@supabase/supabase-js` |
| **Hosting** | Vercel (static `dist/` + `/api/*` rewrites) |
| **Backend** | Supabase — Postgres (+ RLS), Supabase Auth, Deno Edge Functions |
| **Database extensions** | `uuid-ossp`, `pgcrypto`, `pg_cron`, `pg_net` |
| **Scheduling** | Supabase `pg_cron` → `net.http_post` to the edge-function gateway |
| **AI** | Claude / Anthropic API (`claude-sonnet-4-6`) for call review, weekly recaps, AI-assisted Slack replies |
| **External integrations** | Calendly, Stripe, Slack (incoming webhooks + bot), Discord, Whop, ActiveCampaign, Fathom, plus Zapier/Make/n8n via a generic outbound event bus |

---

## 3. How It Works — Architecture, Roles & Lifecycle Flows

### 3.1 Architecture at a glance

The app is a Vite + React single-page app served as static assets by Vercel. Vercel rewrites proxy `/api/*` paths to Supabase Edge Functions, so inbound webhooks and the public API hit a first-party path (no exposed Supabase host). Everything else falls through to `index.html` (SPA routing). All data, auth, and business logic live in Supabase: Postgres with Row-Level Security as the security boundary, Supabase Auth for identity, and Deno Edge Functions for webhooks, crons, and notifications.

```
                         ┌───────────────────────────────────────────────┐
                         │  Browser SPA  (Vite + React, @ alias → src/)   │
                         │  AuthProvider → Supabase JS client (RLS-bound) │
                         └───────────────┬───────────────────────────────┘
                                         │ HTTPS
                                         ▼
                  ┌───────────────────────────────────────────────────────┐
                  │  Vercel  (static dist/ + rewrites in vercel.json)      │
                  │   /api/inbound/*      → public-api                     │
                  │   /api/webhooks/calendly|stripe|fathom|instagram       │
                  │   /api/slack/*        → slack-app                      │
                  │   /((?!api/).*)       → index.html  (SPA fallback)     │
                  └───────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  Supabase project  https://<project-ref>.supabase.co                       │
   │                                                                            │
   │  ┌── Auth ──────────┐   ┌── Postgres + RLS ───────────────────────────┐    │
   │  │ magic link /     │   │ leads · deals · deal_installments · students │    │
   │  │ password         │   │ calls · call_action_items · objections       │    │
   │  └──────────────────┘   │ payments · commission_records · activities   │    │
   │                         │ reminders · notifications · sops · api_keys  │    │
   │  ┌── Edge Functions ┐   │ webhook_subscriptions/_deliveries            │    │
   │  │ calendly-webhook  │  │ automation_settings · integration_configs    │    │
   │  │ stripe-webhook    │  │ triggers/RPCs (current_team_role,            │    │
   │  │ fathom-webhook    │  │   apply_call_outcome_to_lead, commissions…)  │    │
   │  │ review-call       │  └──────────────────────────────────────────────┘   │
   │  │ dispatch-reminders│   pg_cron → check-overdue-payments,                  │
   │  │ notify-* · eod/eow│             payment-recovery-sequence, eod/eow,      │
   │  │ public-api        │             dispatch-reminders (via Vault service_key)│
   │  └───────┬───────────┘                                                      │
   └──────────┼──────────────────────────────────────────────────────────────  ┘
              │ outbound (fetch / pg_net) + inbound webhooks
   ┌──────────┴───────────────────────────────────────────────────────────────┐
   │ Calendly · Stripe · Slack (incoming webhooks + bot) · Discord · Whop ·     │
   │ ActiveCampaign · Fathom · Claude (Anthropic API) · Zapier/Make subscribers │
   └────────────────────────────────────────────────────────────────────────────┘
```

Two outbound notification styles coexist: **native Slack** (incoming-webhook URLs and a Slack bot token, configured per-channel in `integration_configs.slack`) and a **generic event bus** (`webhook_subscriptions`) that fans the same CRM events out to Zapier/Make/n8n/custom URLs with optional HMAC signing.

### 3.2 Roles & access model

Four roles in the `team_role` enum: `admin`, `closer`, `setter`, `coach`. Identity flows from `auth.users` → `team_members` (joined by `user_id`). Two `security definer` helpers anchor every policy: `current_team_role()` and `current_team_member_id()`, both resolved from `auth.uid()`. Access is the combination of role **and** record ownership (`closer_id` / `setter_id` / `coach_id` / `recipient_id`). The sidebar (`nav.ts`) gates navigation by role, but RLS is the real boundary.

| Role | Sees / does | Key RLS rules |
|---|---|---|
| **admin** | Everything: all leads, deals, students, calls, payments, finance, commissions, team, integrations, automations, imports, API keys. | `current_team_role() = 'admin'` short-circuits nearly every `select`/`write` policy; admin-only on `deals`, `students` (write), `payments` (write), `integrations_log`, `imports`, `integration_configs`, `webhook_subscriptions/_deliveries`, `api_keys`, `profit_splits`, `commission_*` writes. |
| **closer** | Leads where `closer_id = me`; calls they hosted; objections; can log a close (insert `deals` + `deal_installments`) on their own leads; tag call outcomes; their own commission rows. | `leads_select`/`update` on `closer_id = me`; `calls_*` on `closer_id = me`; `deals_closer_insert` + `deal_installments_closer_insert` scoped to owned leads; `commission_records_select` on `closer_id = me`. |
| **setter** | Leads where `setter_id = me`; pipeline; can create/update those leads; sees deals/payments/activities on their leads. No calls/students/finance. | `leads`/`deals`/`payments`/`activities` select gated on `setter_id = me`; nav hides Calls, Coaching, Finance. |
| **coach** | Only students where `coach_id = me`; can update their own students; reads SOPs visible to coaches; sees activities on their students. No leads/sales/finance. | `students_select`/`students_coach_update` on `coach_id = me`; `activities_select` via student ownership; nav shows Dashboard, Command Center, Students, Help. |

`team_members` and the catalogs (`lead_tags`, `objections`, `automation_settings`, `sops` by `visible_to[]`) are readable by all authenticated users so assignment dropdowns and SOP gating work; writes stay admin-only. Edge Functions use the service-role client (`adminClient()`), which bypasses RLS — that's how webhooks write across leads they don't "own."

### 3.3 Core lead → student lifecycle

The `leads` row is the spine; the `lead_stage` enum tracks where each lead is (`new → booked → confirmed → showed/no_show → pitched → won/lost → onboarding → active_student → churned/refunded`, plus a `cancelled` stage and short/long follow-up stages added later).

1. **Booking** — `calendly-webhook` receives `invitee.created`. It matches the Calendly host email to an active `team_member` with role `closer`/`admin` → that's `closer_id`. It upserts the lead (`onConflict: email`) to stage `booked` with `booked_at`, `scheduled_at`, Calendly join/cancel/reschedule URLs, event id/name, and UTM attribution; inserts a `pre_call_15m` reminder at `scheduled_at − 15min` (cancelling any prior pending one); logs an `activities` row + `integrations_log`; emits the `call.booked` event; and posts a rich Slack alert to the bookings channel with an @-mention, a prefilled WhatsApp pre-call button, Join/Reschedule/Email/Open-in-CRM buttons. `invitee.canceled` downgrades the lead to `cancelled` **only when the cancel targets the lead's current booking** (reschedule-aware via `rescheduled`/`new_invitee`/event-URI comparison), always logging + notifying regardless.
2. **Pre-call SOP** — Seeded SOPs exist (a pre-call research checklist, discovery-call structure, objection cheat sheet, per-role onboarding starter packs) in the `sops` table, gated by `visible_to[]`. The closer toggles "Pre-call started" on the lead; the 15-min reminder surfaces pre-call status.
3. **Call** — Fathom records the call (see §3.4) → a `calls` row.
4. **Outcome tagging** — The closer tags the call's `outcome` in the drawer. Trigger `apply_call_outcome_to_lead()` auto-advances the lead's stage (`closed_won→won`, `lost`/`not_qualified→lost`, `pitched`/`follow_up→pitched`, `no_show→no_show`), stamps `closed_at`, and writes a `call.outcome_tagged` activity. `closed_won`/`lost` open a structured reason form.
5. **Close logged** — From the Pipeline, a closer logs the deal: a `deals` row (`closed_by_id = me`, `coaching_tier`, `amount_cents`, `notes`) plus a closer-defined custom `deal_installments` schedule (one row per payment with its own `due_date`). `notify-deal-closed` posts the deal + schedule to the payments Slack channel.
6. **Payment** — `stripe-webhook` on `checkout.session.completed` resolves the tier (amount-based first, then Stripe metadata, then the lead's `intended_tier`), flips the lead → `won`, inserts the `deals` row + `payments` row + activity, and emits `payment.received` + `deal.won`.
7. **Onboarding chain** — Still inside the Stripe handler, a `students` row is created (always, for data integrity) and, when the `onboarding_chain` automation is enabled, a coach is auto-assigned via `pickLeastLoadedCoach` (fewest pending/in-progress students among active coaches/admins). `seed_student_milestones()` seeds an `onboarding_checklist` template by program. `discord-invite` mints a one-time welcome-channel invite (saved on the student); Whop access + Discord roles are the next steps in the chain. Coach assignment fires a Slack "New student assigned" notice via the `notify_coach_assigned()` trigger.
8. **Ongoing** — Installments drive payment recovery (§3.5); each non-refund payment auto-creates a `commission_records` row (§3.5); refunds flip the deal to `refunded` and claw the commission back.

### 3.4 Sales-call sub-flow (Fathom)

`fathom-webhook` receives "meeting completed" (forgiving to Fathom's variable payload shape — flat or nested `meeting`/`recording`). It:
- **Matches the closer** by host email → active `team_member` (`closer`/`admin`).
- **Matches the lead** by the first attendee email that isn't the host → `leads`.
- **Links the deal** = the lead's most recent deal.
- **Upserts a `calls` row** (`onConflict: fathom_id`, so retries are idempotent) with recording/share/transcript URLs, timing, participants, and Fathom AI summary.
- **Replaces Fathom-sourced `call_action_items`** (Fathom is authoritative), logs a `call.recorded` activity, emits the `call.recorded` event.
- **Kicks off `review-call` fire-and-forget** when a transcript exists. `review-call` calls Claude (Sonnet, cached framework rubric in the system prompt) to score the call (discovery / pitch / objection / close), produce strengths/improvements, extract objections against the catalog, and set `needs_review`; the result lands in `calls.ai_review`.

The closer then tags `outcome` in the Call drawer. `closed_won`/`lost` opens the structured win/loss reason form (`win_reason_category` / `loss_reason_category` enums; `lost_to_competitor` free text), constrained so a reason matches its outcome. Objections tagged on a call (`call_objections`) roll up via the `objection_rollup` view (per closer, per week) into the Objection library and the "Why we're losing" card; loss reasons roll up via `loss_reason_rollup`.

### 3.5 Automations & notifications

- **Event dispatch** — Every webhook calls `dispatchEvent(event_type, data)` which fans out to all active `webhook_subscriptions` whose `event_types[]` contains the event. Each POST is HMAC-SHA256 signed when the subscription has a `signing_secret`, carries `X-Ecompulse-*` headers, has a 10s timeout, and is recorded in `webhook_deliveries` (success/failed, response preview, error); a trigger bumps the parent subscription's `last_delivered_at`/`last_status`. Realtime is enabled on both tables so the UI watches deliveries land live. Emitted events include `call.booked`, `call.cancelled`, `call.recorded`, `pre_call.reminder`, `payment.received`, `deal.won`, `payment.refunded`.
- **Slack** — Native incoming-webhook posts (bookings, cancellations, pre-call, deal-closed, payments, coach-assigned) plus a Slack bot (`slack-app`, `postMessage`) for interactive recovery alerts with action buttons; channels are configured per-purpose in `integration_configs.slack` and each post is mirrored to `integrations_log`. All notifications are gated by `automation_settings` feature flags.
- **Reminders** — `dispatch-reminders` (cron, service-role only) scans `reminders` for `status='scheduled' AND fire_at <= now()`, fires the `pre_call.reminder` event + Slack ping to the assigned closer 15 minutes before the call, then marks the reminder sent.
- **Scheduled reports** — `eod-report` (21:00 Amsterdam, gated by `daily_eod_reports`) and `eow-report` (`weekly_report`) build closer/setter/team performance summaries and post to Slack; manual admin fires bypass the time/toggle gate.
- **Payment recovery** — `check-overdue-payments` (daily, gated by `recovery_enabled`) flips scheduled installments past their per-row `grace_period_days` to `failed`, logs an `overdue_detected` event, and alerts. `payment-recovery-sequence` (daily) walks failed installments by days-since-failure: Day 1 reminder (stubbed email/SMS), Day 3 closer Slack ping with "I contacted them / Unable to reach" buttons, Day 7 admin escalation (`@here`), Day 14 access pause (flip `students.payment_status='paused_payment'`, Discord/Whop revoke logged pending). Each stage is idempotent against `payment_recovery_events`.
- **Commissions** — Trigger `create_commission_on_payment()` writes one `commission_records` row per non-refund payment (rate from `team_members.commission_pct`, default 10%), idempotent on `payment_id`; `clawback_commission_on_refund()` claws it back when `is_refund` flips. Rollups: `closer_stats_daily` (materialized, refreshed by `refresh-closer-stats`), `deal_commission_summary` view, and a weekly closer recap. Post-commission "house" profit is divided via the admin-only `profit_splits` ledger (seeded among the owners; real names redacted).

### 3.6 Security model

- **Auth** — Supabase Auth with magic-link invites (admins invite team members; they set a password) and password sign-in (`signInWithPassword`). The SPA's `AuthProvider` loads the `team_members` profile (id/role) for the signed-in user; nav and pages branch on that role.
- **RLS everywhere** — Every table has RLS enabled; policies are built on `current_team_role()` + record ownership (`closer_id`/`setter_id`/`coach_id`/`recipient_id`/`team_member_id`). Edge Functions deliberately use the service-role client to cross those boundaries for system writes; user-scoped functions (e.g. `discord-invite`) instead build a per-request client from the caller's JWT so RLS still applies.
- **Public API keys** — Issued in-app, stored only as a SHA-256 hash (`hashed_key`) plus a `prefix` for display; plaintext shown once at creation. Keys are scoped (`api_key_scope`: `lead.create`, `payment.create`, `read.basic`), revocable, and expirable. `verify_api_key(plaintext, scope)` is `security definer`, `execute`-granted to service-role only, and bumps `last_used_at`. `public-api` authenticates via this RPC before any write.
- **Inbound webhook secrets (named, never valued)** — Calendly verifies an HMAC over `t.body` using `CALENDLY_SIGNING_KEY` (with an explicit `signing_disabled` fallback that logs every accepted unsigned event); Stripe verifies the signature with `STRIPE_WEBHOOK_SECRET`; Fathom checks an `X-Fathom-Secret` header against `FATHOM_SHARED_SECRET` (Fathom doesn't HMAC-sign). System cron endpoints require a service request (project secret key / legacy service-role JWT). Cron-triggered functions and DB-trigger callbacks read the bearer from Supabase Vault (secret name `service_key`) at runtime via `pg_net`, so no credential is embedded in migration SQL or `pg_proc` metadata; rotation is a single Vault update. Integration credentials (Stripe keys, Slack/Discord tokens, etc.) live in `integration_configs`/Vault referenced by name, never inlined in code.

---

## 4. Frontend

### 4.1 App shell & routing

`src/App.tsx` is the root. It wraps everything in `QueryClientProvider` (a `QueryClient` configured with `staleTime: 30_000`, `refetchOnWindowFocus: false`) → `AuthProvider` → `BrowserRouter`.

Routing:
- Two public routes outside the shell: `/sign-in` (`SignIn`) and `/set-password` (`SetPassword`).
- All other routes are nested under a `<Route element={<ProtectedRoutes />}>` guard. `ProtectedRoutes` reads `useAuth()`; shows a "Loading…" state while `loading`, redirects to `/sign-in` when `isSupabaseConfigured && !session`, otherwise renders `<AppLayout />`. A catch-all `path="*"` redirects to `/`.
- `AppLayout` (`src/components/layout/AppLayout.tsx`) is a flex shell: fixed `Sidebar` plus a scrollable `<main>` rendering the routed page through `<Outlet />`.

**Auth** (`src/lib/auth.tsx`): `AuthProvider` holds `session`, `profile`, and `loading`. On mount it calls `supabase.auth.getSession()` and subscribes to `onAuthStateChange`. When a session exists it loads the team profile from the `team_members` table (selecting `id, full_name, email, role` by `user_id`) into a `TeamProfile`. Exposes `signIn(email, password)` (`signInWithPassword`) and `signOut`. A `useAuth()` hook throws if used outside the provider.

**Supabase client** (`src/lib/supabase.ts`): created from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env vars and typed with the generated `Database` type. Exports `isSupabaseConfigured`; when env vars are absent it falls back to placeholder URL/key and runs in "preview-only mode" (auth disabled, queries gated off), logging a console warning. Auth options: `persistSession`, `autoRefreshToken`, `detectSessionInUrl: true`.

**Sign-in flow:**
- **SignIn** (`src/pages/SignIn.tsx`) — email/password card; redirects to `/` if already signed in; renders a "Supabase isn't configured" notice instead of the form in preview mode.
- **SetPassword** (`src/pages/SetPassword.tsx`) — landing page for invited members clicking the magic link. Supabase auto-creates a session from the URL hash; the page collects + confirms a password (min 8 chars), calls `supabase.auth.updateUser({ password })`, then redirects to `/`. Also handles expired/invalid invite links and doubles as a password-recovery destination.

### 4.2 Navigation structure

Defined in `src/lib/nav.ts` as `NAV_SECTIONS` (array of `{ label, items }`, each item `{ label, to, icon, roles }`). `navSectionsForRole(role)` filters items by the member's `TeamRole` and drops empty sections; `Sidebar` calls it with `profile?.role ?? "admin"` (so preview/unloaded falls back to the admin view). Active link styling uses `NavLink`.

- **(top, unlabeled)**
  - Dashboard → `/` — admin, closer, setter, coach
  - Command Center → `/command-center` — admin, closer, setter, coach
- **Sales**
  - Leads → `/leads` — admin, closer, setter
  - Pipeline → `/pipeline` — admin, closer, setter
  - Calls → `/calls` — admin, closer
  - Objections → `/objections` — admin, closer
- **Coaching**
  - Students → `/students` — admin, coach
- **Finance** (all admin-only)
  - Finance → `/finance`
  - Payment recovery → `/finance/recovery`
  - Commissions → `/team/commissions`
- **Agency**
  - Team → `/team` — admin
  - Import Leads → `/import-leads` — admin
  - Import Payments → `/import-payments` — admin
  - Lead Tags → `/lead-tags` — admin
  - Integrations → `/integrations` — admin
  - Automations → `/automations` — admin
  - Help & SOPs → `/help` — admin, closer, setter, coach

The Sidebar (`src/components/layout/Sidebar.tsx`) also renders the EcomPulse brand header, an org switcher button (static), and a footer showing the signed-in member's initials/name/role with a Sign out button (shown only when a `session` exists).

### 4.3 Pages catalog

All in `src/pages/`:

- **Dashboard.tsx** — role router: renders one of four role dashboards from `src/pages/dashboards/` based on `profile.role`, defaulting to admin when no profile.
  - **dashboards/AdminDashboard.tsx** — team-wide KPIs, leaderboards, date-range filter, line charts.
  - **dashboards/CloserDashboard.tsx** — today's calls, my pipeline, commission KPI cards + outstanding deals.
  - **dashboards/SetterDashboard.tsx** — my bookings + booking-quality stats, commission sections.
  - **dashboards/CoachDashboard.tsx** — my students + onboarding queue with status states (pending/in_progress/complete).
- **CommandCenter.tsx** — role-specific daily "command center" (per-role description text).
- **Leads.tsx** — full leads table (Calendly bookings, ad funnels, manual entry) with filters.
- **Pipeline.tsx** — drag-and-drop kanban across lead stages (dnd-kit); drops update the lead instantly.
- **Calls.tsx** — call list/outcomes (title "Calls" for admin, "My calls" otherwise); admin sees all.
- **Objections.tsx** — objection library analytics (by call, closer, time).
- **Students.tsx** — coaching students ("Students" admin / "My students" coach).
- **Finance.tsx** — cash, commissions, profit split (admin-only).
- **Recovery.tsx** — at-risk installments + payment-recovery queue (admin-only).
- **Commissions.tsx** — per-closer earnings + payout management (admin-only).
- **Reports.tsx** — funnel conversion, closer/setter leaderboards, UTM performance.
- **Automations.tsx** — live health for every CRM automation; rows are clickable/testable.
- **Team.tsx** — manage members (roles, capacity, commission splits), invites.
- **ImportLeads.tsx** — CSV bulk lead import with column mapping + preview.
- **ImportPayments.tsx** — backfill historical Stripe charges / CSV of past payments.
- **LeadTags.tsx** — define tags closers/setters apply (drive ActiveCampaign segmentation + reports).
- **Integrations.tsx** — connect external tools (webhooks, API keys, subscriptions).
- **Help.tsx** — Help & SOPs; SOP library with onboarding "starter pack" pinning.
- **SignIn.tsx / SetPassword.tsx** — auth pages (see §4.1).

### 4.4 Component organization

`src/components/`:

- **layout/** — `AppLayout.tsx` (shell + `Outlet`), `Sidebar.tsx` (nav, brand, user footer).
- **calls/** — `CallDetailDrawer.tsx` (call detail/outcome editing), `CallStatsCard.tsx`.
- **leads/** — `CreateLeadDialog.tsx`, `LeadDetailDrawer.tsx`, `LogCloseDialog.tsx`, `PaymentScheduleSection.tsx`, `StageBadge.tsx`.
- **dashboard/** — reusable widgets: `CommissionSections.tsx` (`CommissionKpiCards`, `OutstandingDealsTable`), `DateRangeFilter.tsx`, `FilterSelect.tsx`, `Leaderboard.tsx`, `LineChartCard.tsx` (recharts), `TeamPerformance.tsx`.
- **integrations/** — `ApiKeysPanel.tsx`, `AutomationsCard.tsx`, `CalendlyAutoSetup.tsx`, `ConnectDialog.tsx`, `CopyableUrl.tsx`, `DeliveriesLog.tsx`, `IntegrationCardItem.tsx`, `SubscriptionDialog.tsx`, `WebhookEndpointCard.tsx`, `WebhookSubscriptionsPanel.tsx`.
- **sops/** — `SopDetailDrawer.tsx`, `SopEditDialog.tsx` (markdown SOP view/edit).
- **students/** — `StudentDetailDrawer.tsx`.
- **team/** — `InviteMemberDialog.tsx`.
- **ui/** — shadcn/ui new-york primitives: `badge`, `button`, `card`, `dialog`, `input`, `label`, `select`, `separator`, `sheet`, `switch`, `tabs`, `textarea`.
- **Top-level shared:** `PageHeader.tsx` (title + description header used by every page), `SectionHeader.tsx`, `StatCard.tsx`, `ContactForm.tsx`, `AutomationHealthBanner.tsx`.

### 4.5 Data layer

All server access goes through TanStack Query hooks in `src/lib/queries/*` (one module per domain). Pattern: each `useX()` wraps `useQuery` with an array `queryKey` (often parameterized by filters/period/profile id), `enabled: isSupabaseConfigured`, and a `queryFn` that calls `supabase.from(...).select(...)` (frequently against SQL views like `kpi_snapshot_v`, `daily_metrics_v`, `closer_performance_v`, `setter_performance_v`) and throws on error. Mutations use `useMutation` and invalidate the relevant query keys in `onSuccess` (e.g. logging a close invalidates `leads-list`, `lead`, `lead-payments`, `lead-deal`, `kpi-snapshot`, `closer-performance`).

Modules:
- **dashboard.ts** — KPI snapshot, daily metrics, closer/setter performance, team-member option lists; plus a pure `bucketMetrics()` helper for weekly/monthly chart bucketing.
- **leads.ts** — `useLeadsList(filters)`, `useLead(id)`, `useUpdateLead()`.
- **calls.ts** — `useCallsList(filters)`, `useCall(id)`, `useUpdateCallOutcome()`, `useToggleActionItem()`.
- **closes.ts** — `useLogClose()`, `useLeadDeal()`, `useMarkInstallmentPaid()`.
- **commissions.ts** — `useCloserDashboard()`, `useOutstandingDeals()`, `useRecentCommissions()`, `useCommissionLedger()`, `useTeamCommissionSummary()`, `useUpdateCommissionRate()`.
- **finance.ts** — `useFinanceReport(period)`, `useProfitSplits()`, `useUpdateProfitSplit()`.
- **recovery.ts** — `useRecoveryQueue()`, `useRecoveryKpis()`, `useBulkRecoveryAction()`.
- **students.ts** — `useStudentsList(filters)`, `useStudent(id)`, `useStudentCounts()`, `useUpdateStudent()`.
- **sops.ts** — `useSops()`, `useSop(id)`, `useSopReads()`, `useMarkSopRead()` / `useUnmarkSopRead()`.
- **team.ts** — `useTeamList()`, `useUpdateTeamMember()`, plus `inviteTeamMember()` (async fn, not a hook).
- **teamDelete.ts** — `useDeleteTeamMember()`.
- **me.ts** — current-user scoped data: `useMyTodayCalls()`, `useMyPipelineCounts()`, `useMyCloserStats(period)`, `useMySetterStats(period)`, `useMyStudents()`, `useMyStudentCounts()` (keyed by `profile?.id`).
- **automations.ts** — `useAutomationStatuses({ refetchIntervalMs })` (polling health checks).

Other `src/lib` helpers backing the UI: `apiKey.ts`, `automations-meta.ts`, `integrations.ts`, `slack.ts`, `tiers.ts`, `webhookEvents.ts`, `nav.ts`, `utils.ts`.

**Typing approach:** `src/lib/database.types.ts` is the generated Supabase types file (Tables/Views/Functions plus exported enum aliases: `LeadStage`, `TeamRole`, `ApiKeyScope`, `CallOutcome`, `ObjectionCategory`, `CallSource`, `WinReasonCategory`, `LossReasonCategory`, `Json`). The Supabase client is instantiated as `createClient<Database>(...)`, so all `.from().select()` calls and query-hook return shapes are statically typed from that single generated source; `nav.ts` and `auth.tsx` import `TeamRole` from it for role gating.

### 4.6 Styling / UX direction

Light, minimal, product-tool aesthetic (Linear/Attio-style). Theme is defined entirely in `src/index.css` via Tailwind v4 `@theme` design tokens:
- Font: **Inter** (`--font-sans: "Inter", ui-sans-serif, system-ui, …`), with antialiased smoothing.
- Near-white background (`--color-background: oklch(0.99 0 0)`), dark slate foreground, soft grey muted tones (`--color-muted`, `--color-muted-foreground`) and a very light border (`--color-border: oklch(0.92 …)`) — a soft-grey, low-contrast palette.
- Radius scale tokens (`--radius-sm` 0.375rem → `--radius-xl` 1rem) for consistently rounded cards/controls.
- Components consume these as CSS variables (e.g. `bg-[var(--color-card)]`, `text-[var(--color-muted-foreground)]`), giving a single-source, semantic-token theming approach rather than hard-coded Tailwind color classes. UI is built from shadcn/ui new-york primitives with lucide icons, drawers/sheets for detail views, and dialogs for create/edit actions.

---

## 5. Database Schema

### 5.1 Platform

Postgres on Supabase. Extensions: `uuid-ossp`, `pgcrypto` (UUID/hash helpers), plus `pg_cron` + `pg_net` (scheduled jobs + async HTTP from triggers, used for Slack/edge-function calls). Auth is Supabase Auth (`auth.users`); every team person is a `team_members` row linked by `user_id`. **Row Level Security is enabled on every application table** and gated by the caller's role + record ownership (see RLS Model below). Reporting views and several `SECURITY DEFINER` functions encode business logic. Secrets/JWTs are read from Supabase Vault at runtime (e.g. `service_key`), never inlined. A `supabase_realtime` publication pushes live changes for `leads`, `deals`, `students`, `activities`, `notifications`, `call_outcomes`, `reminders`, `webhook_subscriptions`, `webhook_deliveries`.

### 5.2 ENUM types

| Enum | Values |
|---|---|
| `team_role` | admin, closer, setter, coach |
| `lead_stage` | new, booked, confirmed, showed, no_show, pitched, won, lost, onboarding, active_student, churned, refunded, **cancelled, follow_up_short, follow_up_long** (added 0011) |
| `deal_status` | open, won, lost, refunded |
| `onboarding_status` | pending, in_progress, complete |
| `integration_direction` | inbound, outbound |
| `integration_status` | pending, success, failed, retrying |
| `import_kind` | leads, payments |
| `import_status` | pending, processing, complete, failed |
| `import_row_status` | pending, imported, skipped, error |
| `call_result` | showed, no_show, pitched, closed, lost, rescheduled |
| `reminder_status` | scheduled, sent, cancelled, failed |
| `notification_kind` | booking_created, pre_call_reminder, payment_received, student_assigned, automation_failed, mention, system |
| `api_key_scope` | lead.create, payment.create, read.basic |
| `coaching_tier` | fundament, groepscoaching, one_on_one, **coach_1_on_1** (added 0020) |
| `installment_status` | scheduled, paid, failed, recovering, written_off, refunded |
| `call_outcome` | pending, closed_won, follow_up, no_show, not_qualified, pitched, lost |
| `objection_category` | price, timing, authority, trust, need, spouse, other |
| `call_source` | fathom, manual |
| `win_reason_category` | urgency_pain, trust_rapport, roi_value, social_proof, payment_flexibility, offer_bonus, follow_up_persistence, other |
| `loss_reason_category` | price, timing, authority, trust, no_need, spouse, went_cold, competitor, other |

*Dropped in 0009:* `conversation_kind`, `conversation_status`, `message_direction` (chat feature cut). Several free-text status fields use CHECK constraints instead of enums: `payments.source`, `students.payment_status` (active/paused_payment/reactivated/churned), `commission_records.status` (earned/paid_out/clawed_back/adjusted), `commission_records.recipient_role` (closer/setter), `commission_adjustments.adjustment_type` (bonus/spiff/correction/clawback/penalty), `payment_recovery_events.event_type`, `webhook_deliveries.status`.

### 5.3 Tables by domain

#### Team & access

- **team_members** — closers/setters/coaches/admins. `id`, `user_id` (FK `auth.users`, unique, set-null), `full_name`, `email` (unique), `role : team_role`, `slack_user_id`, `timezone`, `commission_pct numeric(5,2)`, `capacity`, `is_active bool default true`, `commission_rate_updated_at/_by` (FK self, audit; added 0022). Read by all authenticated; admin-only write.
- **profit_splits** — house-profit division among owners (after commissions). `team_member_id` (FK, unique), `share_pct numeric(5,2)` CHECK 0–100, `display_order`. Admin-only RLS. (Seed rows redacted — three owner placeholders summing to 100%.)
- Commission rate lives on `team_members.commission_pct` (reused for both closer and setter rate).

#### Leads & pipeline

- **leads** — central record; everything ties back here. `id`, `full_name`, `email`, `phone`, `instagram`, `timezone`, `stage : lead_stage default new`, `closer_id`/`setter_id` (FK team_members, set-null), UTM fields (`utm_source/medium/campaign/content/term`), `source_landing_page`, `notes`, `created_at`, `updated_at` (trigger). Added later: `source`, `booked_at`, `scheduled_at`, `cancelled_at`, `closed_at`, `budget_cents`, `calendly_cancel_url`, `calendly_reschedule_url`, `calendly_event_id`, `calendly_event_name`, `calendly_join_url` (0011/0013); `pre_call_started bool`, `pre_call_started_at`, `pre_call_completed_at` (0012); `intended_tier text` (closer-set pitch target, 0016). Unique index on `email` (0007). Trigger `leads_set_updated_at`.
- **activities** — audit log of notable events. `lead_id`/`student_id` (FK cascade), `actor_id` (FK team_members), `type text`, `payload jsonb`, `created_at`. Visible if you can see the underlying lead/student.
- **lead_tags** — tag catalog. `name` (unique), `description`, `color` (Badge variant), `created_by`. Seeded with Hot/Warm/Cold/VIP/Referral. Read-all / admin-write.
- **lead_tag_assignments** — M:N lead↔tag. PK `(lead_id, tag_id)`, `assigned_by`, `assigned_at`. Writable by admin or the lead's closer/setter.
- **reminders** — pre-call/follow-up/payment-plan reminders. `lead_id`, `team_member_id`, `kind text` (pre_call_15m | followup | payment_plan), `fire_at`, `status : reminder_status`, `payload jsonb`, `completed_at`. Owner + admin RLS.
- **call_outcomes** — closer-logged result of a strategy call. `lead_id` (FK cascade), `closer_id`, `scheduled_for`, `occurred_at`, `result : call_result`, `reason`, `notes`. Closer sees own, admin all. Drives the funnel/KPI/leaderboard views.
- **notifications** — Command Center inbox. `recipient_id` (FK cascade), `kind : notification_kind`, `title`, `body`, `link`, `related_lead_id`, `related_student_id`, `read_at`. Recipient/admin RLS.

#### Deals, payments & commissions

- **deals** — financial side of a lead (a lead may have several). `lead_id` (FK cascade), `program`, `amount_cents` CHECK ≥0, `currency default EUR`, `payment_plan jsonb`, `stripe_customer_id`/`stripe_subscription_id`/`stripe_payment_intent_id`, `status : deal_status default open`, `lost_reason text`, `closed_at`, `coaching_tier` (0014), `closed_by_id` (FK team_members, the closer; 0020), `notes` (0020). RLS: admin + the deal's lead owners read; closers may insert deals on their own leads.
- **deal_installments** — closer-defined custom payment schedule, one row per scheduled payment. `deal_id` (FK cascade), `seq` (unique per deal), `amount_cents` CHECK >0, `due_date`, `paid_at`. Recovery columns (0021): `status : installment_status default scheduled`, `failed_at`, `failure_reason`, `recovery_attempts`, `last_recovery_attempt_at`, `grace_period_days default 3`, `written_off_at`, `written_off_by`. Visible if the parent deal is; closers can insert on their own leads.
- **payments** — payments ledger (Stripe webhook / manual / CSV import). `lead_id`/`deal_id` (set-null), `amount_cents` CHECK ≠0, `currency`, `paid_at`, `stripe_charge_id` (unique), `stripe_payment_intent_id`, `source default stripe`, `is_refund bool`, `notes`, `installment_id` (FK deal_installments; 0022). Admin write; lead owners read.
- **commission_records** — one commission row per (payment, recipient). `payment_id` (FK cascade), `installment_id`, `deal_id`, `lead_id`, `closer_id` (recipient — closer *or* setter; restrict), `recipient_role text` (closer/setter; 0027), `payment_amount_cents`, `commission_rate numeric(5,2)`, `commission_amount_cents`, `status` (earned/paid_out/clawed_back/adjusted), `earned_at`, `paid_out_at/_by`, `payout_reference`, `clawback_reason`, `clawed_back_at`, `notes`, `updated_at`. UNIQUE `(payment_id, recipient_role)`. Recipient sees own, admin all.
- **commission_adjustments** — manual bonuses/clawbacks/corrections. `closer_id`, `commission_record_id` (set-null), `adjustment_type` (bonus/spiff/correction/clawback/penalty), `amount_cents`, `reason`, `applied_to_period date`, `created_by`. Recipient/admin RLS.
- **payment_recovery_events** — append-only recovery timeline. `installment_id`/`deal_id`/`lead_id` (FK cascade), `event_type text` CHECK (overdue_detected, reminder_sent, closer_notified, admin_escalated, access_paused, access_resumed, resolved, written_off, marked_recovering, closer_contacted_customer, closer_unable_to_reach), `actor_team_member_id`, `is_system bool`, `metadata jsonb`. Lead owners read; closers may append the three "closer_*"/marked_recovering event types on their own leads.
- **imports** / **import_rows** — CSV import jobs (leads/payments) + per-row results (`raw jsonb`, `status : import_row_status`, `result_lead_id`/`result_payment_id`). Admin-only.

#### Coaching

- **students** — created on Stripe payment success; holds onboarding state. `lead_id`/`deal_id` (FK cascade), `coach_id` (FK team_members, set-null), `program`, `discord_user_id`, `whop_membership_id`, `onboarding_status : onboarding_status default pending`, `onboarding_checklist jsonb` (milestones), `coaching_tier` (0014), Discord invite fields `discord_invite_url/_code/_expires_at` (0015), `payment_status text` (active/paused_payment/reactivated/churned; 0021), `enrolled_at`, `updated_at` (trigger). Admin all; coach sees/updates own. Triggers: `students_seed_milestones` (BEFORE INSERT — seeds default milestone checklist by program), `students_coach_assigned` (AFTER coach_id change — Slack notify).
- *Milestones* are stored inline in `students.onboarding_checklist` (jsonb array of `{id, title, target_date}`), auto-seeded from per-program templates (Groepscoaching / 1-on-1) — there is no separate milestones table.
- **sops** — Help & SOPs / onboarding hub. `category text` (pre_call/on_call/post_call/onboarding/coach), `title`, `body_md`, `visible_to team_role[]`, `version`, `is_archived bool`, `created_by/updated_by`, plus `description`, `pinned_for_onboarding bool`, `display_order`, `read_time_minutes`, `slug` (unique; 0014). RLS: select gated by `current_team_role() = any(visible_to)`; admin write. Seeded with a role-based onboarding "starter pack" of SOPs (welcome, per-role day-one guides, pre-call/discovery/objection/outcome-logging playbooks) — bodies omitted per redaction.
- **sop_reads** — one row per (member, sop) when marked read. `sop_id`/`team_member_id` (FK cascade), `read_at`, UNIQUE `(sop_id, team_member_id)`. Member reads/writes own.

#### Calls & objections

- **calls** — one row per recorded sales call (Fathom or manual). `lead_id`/`closer_id`/`deal_id` (set-null), `source : call_source default fathom`, `fathom_id` (unique → idempotent webhook), `fathom_share_url`, `recording_url`, `transcript_url`, `title`, `started_at`, `ended_at`, `duration_seconds`, `host_email`, `attendee_emails text[]`, `summary`, `transcript`, `outcome : call_outcome default pending`, `outcome_notes`, `outcome_tagged_by/_at`, `ai_review jsonb` (Claude review: framework_score, strengths[], improvements[], needs_review), `ai_reviewed_at`, `created_at`, `updated_at`. **Win/loss capture (0028):** `won_reason : win_reason_category`, `lost_reason : loss_reason_category`, `lost_to_competitor text`, with CHECK constraints `won_reason only if outcome=closed_won` and `lost_reason only if outcome=lost`. RLS like leads (admin / own closer / lead owner); admin-only insert+delete (Fathom webhook uses service role). Trigger `calls_apply_outcome` → `apply_call_outcome_to_lead()`.
- **call_action_items** — action items extracted from a call. `call_id` (FK cascade), `description`, `assignee text`, `due_date`, `completed bool`, `completed_at`, `source`. Visible/editable via parent call.
- **objections** — catalog of objection types. `label` (unique), `description`, `category : objection_category default other`. Seeded (price/timing/spouse/authority/trust/need variants). Read-all; admin manages catalog.
- **call_objections** — M:N call↔objection. `call_id`/`objection_id` (FK cascade), `quote text`, `source`, UNIQUE `(call_id, objection_id)`. Visibility follows parent call.

#### Integrations & platform

- **integration_configs** — per-provider connection config (Integrations page). `provider` (unique), `is_connected bool`, `display_name`, `config jsonb`, `secret_ref text` (Vault name only — secrets never inlined), `connected_by/_at`, `last_synced_at`, `updated_at`. Seeded providers: calendly, stripe, slack, discord, whop, activecampaign, gmail, google_sheets, instagram, claude. Admin-only.
- **integrations_log** — every inbound webhook + outbound API call with retries/errors. `provider`, `direction : integration_direction`, `event_type`, `status : integration_status`, `request_payload`/`response_payload jsonb`, `error`, `retry_count`, `related_lead_id`. Admin-only. (Polled by the health-monitor cron.)
- **api_keys** — public REST API keys (hashed). `name`, `prefix` (unique, first 12 chars), `hashed_key` (sha256, unique), `scopes api_key_scope[] default {lead.create}`, `created_by`, `last_used_at`, `last_used_ip`, `revoked_at`, `expires_at`. Admin-only; verified via `verify_api_key()` (service role). Exposed read-safe via `api_keys_safe_v`.
- **webhook_subscriptions** — outbound webhook targets (Zapier/Make/n8n). `name`, `target_url`, `event_types text[]` CHECK non-empty, `signing_secret` (HMAC, optional), `is_active bool`, `description`, `created_by`, `last_delivered_at`, `last_status`. Admin-only. Trigger bumps last_* on delivery.
- **webhook_deliveries** — one row per delivery attempt. `subscription_id` (FK cascade), `event_type`, `event_id`, `payload jsonb`, `status` CHECK (pending/success/failed), `attempts`, `response_status`, `response_body_preview`, `error`, `delivered_at`. Admin-only; trigger `webhook_deliveries_bump_subscription`.
- **automation_settings** — admin feature flags (`key` PK, `display_name`, `description`, `enabled bool`, `updated_at/_by`). Read-all (so code paths can check `enabled`), admin-write. Seeded keys: new_call_booked, call_cancelled, payment_received, daily_eod_reports, weekly_report, pre_call_15m_reminder, onboarding_chain, recovery_enabled (0021), commission_tracking_enabled (0022). (`outbound_zapier_cancel` was seeded then removed in 0026.)

*Storage buckets (0003):* `avatars` (public), `lead-attachments`, `call-recordings`, `imports`, `sop-attachments` (private, RLS-gated by role/owner).

### 5.4 Views

| View | Summarizes |
|---|---|
| `lead_funnel_v` | Per-lead booked→showed→pitched→won flags + cash_collected_cents; powers funnel reports |
| `daily_metrics_v` | Per-day rollup: cash collected, refunds, calls booked, order value, wins, losses |
| `closer_performance_v` | Closer leaderboard: calls booked/showed/pitched, deals won/lost, cash, show-rate %, close-rate % |
| `setter_performance_v` | Setter leaderboard: bookings made, bookings→sale, conversion-rate % |
| `kpi_snapshot_v` | The 8 dashboard stat cards (cash, order value, show-up %, conversion %, cancel %, avg order/call & /close) |
| `api_keys_safe_v` | API keys without hash, with derived active/revoked status |
| `closer_stats_daily` (**materialized**) | Per-closer per-day commission rollup (deals, payments, cash, commission, avg payment), Europe/Amsterdam day buckets; refreshed via RPC |
| `deal_commission_summary` | Per-won-deal: cash collected, commission earned/outstanding, current rate, projected remaining; setter columns added 0027 |
| `closer_call_stats_v` | Per-closer call totals (7d/30d/all), closes, tagged/untagged outcomes, needs-review count, avg duration, close-rate %, avg framework score |
| `objection_rollup` | Top objections per closer per ISO week (occurrences + example call ids); buckets on `coalesce(started_at, created_at)` after 0029 |
| `loss_reason_rollup` | Loss reasons per closer per week for lost calls (0028); same coalesce fix in 0029 |

### 5.5 Key functions & triggers

- `set_updated_at()` — generic BEFORE-UPDATE trigger setting `updated_at = now()` (used on leads, students, sops, conversations[dropped], integration_configs, automation_settings, webhook_subscriptions, commission_records).
- `current_team_role()` — `security definer`, returns the caller's `team_role` from their `auth.uid()` mapping; the backbone of every RLS policy.
- `current_team_member_id()` — `security definer`, returns the caller's `team_members.id` for ownership checks.
- `apply_call_outcome_to_lead()` — on `calls.outcome` change, maps the outcome to a `lead_stage`, advances the lead, stamps `closed_at` for won/lost, and writes an `activities` row.
- `verify_api_key(plaintext, required_scope)` — `security definer`, sha256-hashes the key, returns the matching active/non-expired key id with the required scope, bumps `last_used_at`; granted to `service_role` only.
- `seed_student_milestones()` — BEFORE INSERT on students; fills `onboarding_checklist` from a per-program template (group / 1-on-1) unless the caller supplied milestones.
- `notify_coach_assigned()` — AFTER coach_id insert/change; reads the service JWT from Vault and `pg_net`-POSTs the notify-coach-assigned edge function (async, non-blocking).
- `create_commission_on_payment()` — AFTER insert/update on payments; on a non-refund payment becoming paid, fans out commission rows for the deal's closer and the lead's active setter (each only if their rate > 0), idempotent on `(payment_id, recipient_role)`.
- `clawback_commission_on_refund()` — AFTER update on payments; when `is_refund` flips true, sets matching earned/paid_out commission rows to `clawed_back`.
- `refresh_closer_stats_daily()` — `security definer` RPC (service_role) running `REFRESH MATERIALIZED VIEW CONCURRENTLY closer_stats_daily`; called by the 15-min cron edge function.
- `bump_subscription_last_delivery()` — AFTER insert on webhook_deliveries; updates the parent subscription's `last_delivered_at` / `last_status`.

### 5.6 RLS model

RLS is on for every application table and resolves around two `SECURITY DEFINER` helpers: `current_team_role()` (the caller's role) and `current_team_member_id()` (their member id). **Admins** see and write everything. **Closers/setters** are scoped by ownership — they can read/update only `leads` where they are the `closer_id` or `setter_id`, and that ownership cascades to child rows (`deals`, `payments`, `activities`, `lead_tag_assignments`, `calls`, `call_action_items`, `call_objections`, `payment_recovery_events`) via `EXISTS` sub-selects against the parent lead; closers may additionally insert deals/installments and tag-outcome calls on their own leads, and append specific recovery events. **Coaches** see/update only `students` where `coach_id` matches them (and child `activities`). Per-person tables (`reminders`, `notifications`, `sop_reads`, `commission_records`, `commission_adjustments`) are scoped to the owning member (recipient/team_member), with admins seeing all. Catalog/config tables (`team_members`, `lead_tags`, `objections`, `automation_settings`, `sops` via `visible_to`) are readable by all authenticated users but admin-write. Finance and platform tables (`profit_splits`, `integration_configs`, `integrations_log`, `imports`, `api_keys`, `webhook_subscriptions`/`webhook_deliveries`) are admin-only. Edge functions performing webhook ingestion or cron work use the `service_role` JWT, which bypasses RLS.

---

## 6. Backend & Integrations

### 6.1 Hosting model

The CRM is a **Vite SPA** (`framework: "vite"`, build → `dist/`) hosted on **Vercel**, backed by **Supabase** for Postgres, Auth, and Edge Functions (Deno runtime). The browser app never calls Supabase Edge Functions directly under a Supabase hostname — instead `vercel.json` rewrites stable `/api/*` paths on the app domain to `https://<project-ref>.supabase.co/functions/v1/<function>`. This keeps webhook URLs and the public API on the first-party domain (and dodges CORS/cookie issues).

Rewrite map (app domain redacted as `https://<app-domain>`; all destinations are the project's edge-function gateway):

| Source path (on `<app-domain>`) | Destination edge function |
|---|---|
| `POST /api/inbound/:path*` | `public-api/:path*` (REST API) |
| `POST /api/webhooks/calendly` | `calendly-webhook` |
| `POST /api/webhooks/stripe` | `stripe-webhook` |
| `POST /api/webhooks/instagram` | `instagram-webhook` *(rewrite declared; no function deployed yet)* |
| `POST /api/webhooks/fathom` | `fathom-webhook` |
| `/api/slack/:path*` | `slack-app/:path*` |
| `/((?!api/).*)` | `/index.html` (SPA fallback for all non-`/api` routes) |

**Self-auth pattern.** Functions that must accept unauthenticated POSTs from external systems or `pg_cron`/DB triggers set `verify_jwt = false` in `config.toml` and re-verify inside the function. Three flavors: (a) **provider signature** verified in-function (Calendly HMAC, Stripe signature, Slack signing secret, Fathom `X-Fathom-Secret`); (b) **bearer API key** RPC check (`public-api`); (c) **service-request gate** — `isServiceRequest(req)` in `_shared/supabase-admin.ts` accepts either the project secret key (`SB_SECRET_KEY`, preferred) or a legacy `service_role` JWT (decoded `role` claim), used by cron/trigger-only functions. Other functions keep `verify_jwt = true` and add an inline admin/role check.

### 6.2 Edge functions catalog

**Inbound webhooks** (all `verify_jwt = false`, signature/secret verified in-function; every event logged to `integrations_log`):

- **calendly-webhook** — Calendly v2 (`invitee.created`/`invitee.canceled`). New booking → upsert lead, assign closer, schedule a 15-min pre-call reminder; cancellation → cancel reminder; reschedule-aware. Verifies the `calendly-webhook-signature` HMAC, or accepts unsigned when the `signing_disabled` config flag is set (Calendly Standard tier issues no key). *Trigger: webhook.*
- **stripe-webhook** — Stripe (`checkout.session.completed`, `charge.succeeded`, `charge.refunded`, `customer.subscription.deleted`). Payment success → create deal + payment + activity, advance lead to `won`, resolve coaching tier (amount-first via `tiers.ts`, then metadata, then lead `intended_tier`), auto-assign least-loaded coach. Verifies the Stripe signature via `constructEventAsync`. *Trigger: webhook.* (Note: app-side close logging has largely moved to a manual "Log Close" dialog per `health-monitor` comments.)
- **fathom-webhook** — Fathom "Meeting completed" call recordings. Forgiving normalizer maps many Fathom payload shapes into the `calls` table (recording/share/transcript URLs, host/attendee emails, summary, action items), links to the lead's most recent open deal, then fire-and-forget invokes **review-call** for AI scoring. Optionally verifies `X-Fathom-Secret`. *Trigger: webhook.*
- **slack-app** — Single function with three sub-paths configured in the Slack app: `/commands` (slash commands `/lead`, `/note`, `/student`), `/events` (Events API incl. `url_verification`), `/interactivity` (buttons/modals). Verifies the Slack signing secret (`verifySlackSignature`); replies within 3s and defers slow work. Uses `SLACK_BOT_TOKEN`, and `ANTHROPIC_API_KEY` for AI-assisted replies. *Trigger: webhook.*
- **public-api** — see §6.5.
- *instagram-webhook* — rewrite + an `instagram` integration config exist (IG business account id, page access token, verify token), but no function directory is deployed.

**Automation / notification functions:**

- **review-call** — AI call review with **Claude** (`claude-sonnet-4-6`, cached system-prompt rubric). Scores a call transcript on EcomPulse's sales framework (discovery/pitch/objection/close sub-scores → `framework_score`), extracts objections, sets `needs_review` for unusually weak calls. *Trigger: invoked (auto from fathom-webhook; manual from the Calls UI via `functions.invoke`).* `verify_jwt = true` (default).
- **notify-deal-closed** (`verify_jwt = true`) — rich payments-channel Slack card after a closer logs a deal; uses admin client to read despite caller RLS. *Trigger: invoked from the app.*
- **notify-installment-paid** (`verify_jwt = true`) — per-installment payment card to the same payments channel. *Trigger: invoked.*
- **notify-commission-earned** (`verify_jwt = true`) — DMs the closer their commission cut after a payment (reads the `commission_records` row the `trg_create_commission_on_payment` trigger created). *Trigger: invoked from `closes.ts`.*
- **notify-coach-assigned** (`verify_jwt = false`, service-gated) — "New Student Assigned" Slack post. *Trigger: Postgres trigger on `students.coach_id` via `pg_net` (covers Stripe auto-assign, manual-payment auto-assign, and admin reassign); also accepts admin JWT for manual re-fire.*
- **dispatch-reminders** (`verify_jwt = false`, service-gated) — scans `reminders` where `status='scheduled' AND fire_at <= now()` and emits the matching outbound event (today: `pre_call_15m` → `pre_call.reminder`). *Trigger: cron (every minute).*
- **check-overdue-payments** (`verify_jwt = false`, service-gated) — finds scheduled installments past grace, flips to `failed`, logs `overdue_detected`, posts per-closer + admin rollup to the payment-failed channel. Idempotent; gated by `automation_settings.recovery_enabled`. *Trigger: cron, 09:00 Amsterdam.*
- **payment-recovery-sequence** (`verify_jwt = false`, service-gated) — escalation ladder per failed installment by days since `failed_at`: Day 1 reminder_sent → Day 3 closer_notified → Day 7 admin_escalated (@here) → Day 14 access_paused (flip `student.payment_status`; Discord/Whop revoke stubbed). Idempotent per-`event_type`. *Trigger: cron, 10:00 Amsterdam.*
- **refresh-closer-stats** (`verify_jwt = false`, service-gated) — refreshes the `closer_stats_daily` materialized view `CONCURRENTLY` via RPC. *Trigger: cron, every 15 min.*
- **discord-invite** (`verify_jwt = true`) — generates a one-time Discord welcome-channel invite, saves it on the student row. Caller must be admin or the student's coach (RLS via user JWT). *Trigger: invoked.*
- **calendly-setup** (`verify_jwt` default) — admin-only; provisions a Calendly v2 webhook subscription pointing at `/api/webhooks/calendly`, stores PAT + signing key + subscription URI in `integration_configs`. Idempotent (recreates to fetch a fresh signing key). *Trigger: invoked.*
- **admin-invite** — admin-only; sends a Supabase Auth `inviteUserByEmail` (lands on `/set-password`), inserts the `team_members` row (status `pending`), rolls back the auth user if the insert fails. *Trigger: invoked.*
- **admin-delete-user** — admin-only; deletes a `team_members` row + the `auth.users` record (FK `ON DELETE SET NULL` leaves their leads/students unassigned). Guards: caller is admin, can't delete self. *Trigger: invoked.*
- **slack-diagnostic** (`verify_jwt = false`, service/admin-gated) — probes the workspace via bot token to confirm channels exist / bot is a member / can post; returns per-channel status. *Trigger: invoked.*
- **automation-tests** (`verify_jwt = true`, inline admin check) — fires synthetic events at every wired Slack automation (`call_booked`, `call_cancelled`, `pre_call`, `eod`) and returns a per-automation pass/fail report. *Trigger: invoked from the admin Automations panel.*
- **test-fire** — admin-only; sends a synthetic event to one `webhook_subscriptions` row to verify a subscriber (e.g. a Zapier Catch Hook). RLS via caller JWT. *Trigger: invoked.*

**Reports / crons:**

- **eod-report** (`verify_jwt = false`) — end-of-day team report → Slack EOD webhook. Cron path only sends when Amsterdam hour = 21 and `daily_eod_reports` enabled; admin JWT (manual button) sends immediately. Optional `{date}` backfill. *Trigger: cron (21:00 Amsterdam) + manual.*
- **eow-report** (`verify_jwt = false`) — end-of-week report to the same EOD channel. Cron path gated to Sunday hour = 22 + `weekly_report` enabled; admin JWT sends week-to-date immediately. Optional `{week_start}` backfill. *Trigger: cron (Sun 22:00 Amsterdam) + manual.*
- **weekly-closer-recap** (`verify_jwt = false`, service-gated) — Monday 09:00 Amsterdam; per-closer recap DM (calls/showed/closed/close-rate/cash/commission vs prior-4-week baseline + anonymized rank) with one Claude coaching line. *Trigger: cron.*
- **health-monitor** (`verify_jwt = false`, service-gated) — every 30 min checks `integrations_log` + `automation_cron_health` for failures in the last 35 min and posts one summary card (broken automation + fix hint) to the Slack bookings webhook. *Trigger: cron.*

**Scheduling.** Crons are driven by Supabase **`pg_cron`** rows that `net.http_post` to the function gateway with the project secret/`service_role` token (the `isServiceRequest` gate authorizes them). Schedule SQL lives in migrations (e.g. `0010_eod_schedule.sql`, `0017_notify_coach_assigned.sql`); DST is handled by paired cron rows (summer/winter UTC offsets) per several function header notes.

### 6.3 Shared modules (`supabase/functions/_shared/`)

- **supabase-admin.ts** — `adminClient()` (service-key Supabase client), `serviceKey()`/`publishableKey()` (new `SB_SECRET_KEY`/`SB_PUBLISHABLE_KEY` preferred, legacy JWT fallback), `isServiceRequest()` cron/trigger gate, `logIntegration()`, `getIntegrationConfig()` (reads `integration_configs`), `isAutomationEnabled()` (fail-open toggle from `automation_settings`).
- **cors.ts** — shared CORS headers (allows `stripe-signature`, `calendly-webhook-signature`, etc.; POST/OPTIONS).
- **dispatch.ts** — outbound webhook dispatcher: fans an event out to active `webhook_subscriptions` matching the `event_type`, HMAC-signs the body (`X-Ecompulse-Signature`) per subscription secret, 10s timeout, logs each attempt to `webhook_deliveries`.
- **slack.ts** — incoming-webhook poster (`postToSlack`) + `leadDeepLink`, `slackMention`, `formatLocalTime`; pulls channel webhook URLs from `integration_configs.slack`.
- **slack-bot.ts** — Slack Web API client with a **bot token** (`postMessage`, `openConversation`, `sendDirectMessage`) plus `verifySlackSignature` (HMAC, 5-min timestamp window, timing-safe compare).
- **slack-card.ts** — standardized Block Kit card primitives (`ICON` set, `cardHeader`/`cardFooter`, `openInCrmButton`, `divider`) for visual consistency across all Slack notifications.
- **discord.ts** — tiny Discord REST v10 client (`Bot` auth): `createChannelInvite` (one-time invites) for the welcome flow.
- **tiers.ts** — coaching offer catalog (Fundament / Groepscoaching / 1-1 / coach 1-1 with `price_cents`); `tierByKey`, `tierByAmountCents` (nearest within €1,500). Mirror of `src/lib/tiers.ts`.
- **coach-assign.ts** — `pickLeastLoadedCoach()`: load-balances new enrollments to the active coach/admin with the fewest pending/in-progress students.
- **coaching-tier.ts** — `resolveCoachingTier()`: maps a Stripe price/product/metadata string to `fundament`/`groepscoaching`/`one_on_one` (most-specific-first, diacritic-insensitive).

### 6.4 Third-party integrations

Provider catalog and config schema live in `src/lib/integrations.ts`; saved values are stored in `integration_configs` (per-provider `config` JSON + `is_connected`). High-level auth per integration (no real values reproduced):

- **Calendly** — booking webhooks. Inbound auth: per-event HMAC signing key (`signing_key` in config / `CALENDLY_SIGNING_KEY` secret); provisioning uses an admin-supplied Personal Access Token (`calendly-setup`).
- **Stripe** — payment webhooks → deals/payments/tier resolution. Inbound auth: Stripe webhook **signing secret** (`webhook_secret`); outbound calls use the **secret key** (`secret_key`).
- **Slack** — notifications, EOD/EOW reports, DMs, slash commands. Auth: incoming-webhook URLs per channel (eod/bookings/payments/coach-assign) for one-way posts; a **bot token** + **signing secret** for the interactive `slack-app`.
- **Discord** — welcome-channel onboarding invites and (stubbed) access revoke. Auth: **bot token** + guild/channel IDs.
- **Whop** — membership/access provisioning; configured (API key + default product id) and referenced by the recovery flow (access pause/revoke currently stubbed).
- **ActiveCampaign** — email-marketing integration (provider configured in the Integrations catalog with API URL/key).
- **Fathom** — call recordings → CRM `calls`, linked to the open deal (win/loss context). Inbound auth: optional **shared secret** header (`X-Fathom-Secret` / `FATHOM_SHARED_SECRET`).
- **Claude / Anthropic** — AI **call review** (`review-call`, `claude-sonnet-4-6` with cached rubric), the weekly closer-recap coaching line, and AI-assisted Slack replies. Auth: **bearer API key** (`ANTHROPIC_API_KEY` secret).
- Additional configured providers: **Zapier** (catch-hook subscriptions via the outbound dispatcher), **Instagram** and **WhatsApp** (config present; messaging not yet wired to functions).

### 6.5 Public REST API (`public-api`)

Base path proxied at `<app-domain>/api/inbound/*` → `public-api`. `verify_jwt = false`; each request is authenticated in-function by a **bearer API key** (`Authorization: Bearer <api-key>`) validated through the Postgres `verify_api_key(plaintext, required_scope)` RPC (keys are hashed, scoped, and revocable — table from migration `0004_api_keys.sql`, minted in **Integrations → CRM API Keys**). Auth failures are logged to `integrations_log`.

Endpoints:

- **`POST /lead`** — scope `lead.create`. Upserts a lead (`full_name` required; optional email/phone/instagram/timezone/stage/scheduled_at/UTM fields/source/budget_cents/notes/tags), then emits the `lead.created` outbound event via `dispatchEvent`.
- **`POST /payment`** — scope `payment.create`. Logs a payment (email + amount_cents required; optional currency/paid_at/stripe_charge_id/notes).

Both routes are POST-only (others → 405) and share the CORS/JSON helpers. Successful operations also fan out through the outbound webhook dispatcher to any active `webhook_subscriptions`.

---

## 7. Repository Layout

```
ecompulse-crm/
├── index.html                  # SPA entry
├── vite.config.ts              # Vite + React + Tailwind plugin, @ → src alias
├── vercel.json                 # static build + /api/* rewrites → edge functions
├── components.json             # shadcn/ui config (new-york, slate, lucide)
├── tsconfig.json               # project references → app + node
├── tsconfig.app.json
├── tsconfig.node.json
├── eslint.config.js
├── public/
├── slack/                      # Slack app manifest / setup assets
├── src/
│   ├── main.tsx                # createRoot + StrictMode bootstrap
│   ├── App.tsx                 # QueryClient → AuthProvider → BrowserRouter + routes
│   ├── index.css               # Tailwind v4 @theme design tokens
│   ├── components/
│   │   ├── layout/             # AppLayout, Sidebar
│   │   ├── calls/  leads/  dashboard/  integrations/
│   │   ├── sops/   students/  team/
│   │   ├── ui/                 # shadcn/ui primitives
│   │   └── *.tsx               # PageHeader, StatCard, etc.
│   ├── pages/
│   │   └── dashboards/         # Admin/Closer/Setter/Coach dashboards
│   └── lib/
│       ├── auth.tsx  supabase.ts  nav.ts  utils.ts
│       ├── database.types.ts   # generated Supabase types
│       ├── tiers.ts  integrations.ts  slack.ts  apiKey.ts …
│       └── queries/            # one TanStack Query module per domain
└── supabase/
    ├── config.toml             # per-function verify_jwt flags
    ├── migrations/             # 30 ordered SQL migrations (0001 → 0029…)
    └── functions/
        ├── _shared/            # supabase-admin, dispatch, slack*, discord, tiers…
        ├── calendly-webhook/  stripe-webhook/  fathom-webhook/  slack-app/
        ├── public-api/  review-call/  discord-invite/  calendly-setup/
        ├── notify-deal-closed/  notify-installment-paid/  notify-commission-earned/
        ├── notify-coach-assigned/  dispatch-reminders/  check-overdue-payments/
        ├── payment-recovery-sequence/  refresh-closer-stats/  weekly-closer-recap/
        ├── eod-report/  eow-report/  health-monitor/  slack-diagnostic/
        └── admin-invite/  admin-delete-user/  automation-tests/  test-fire/
```

---

## 8. Notable Conventions & Design Decisions

- **RLS-first security.** Row-Level Security is enabled on every application table and is treated as *the* authorization boundary, not a backstop. Two `SECURITY DEFINER` helpers — `current_team_role()` and `current_team_member_id()` — anchor every policy, and ownership cascades from the `leads` spine to child rows via `EXISTS` sub-selects. The UI's role-gated navigation (`nav.ts`) is convenience only; bypassing it changes nothing because Postgres still enforces access.

- **Role-based, ownership-scoped access.** Four roles (`admin`/`closer`/`setter`/`coach`) combine with record ownership (`closer_id`/`setter_id`/`coach_id`/`recipient_id`/`team_member_id`) so each person sees exactly their slice. Admins short-circuit nearly every policy; per-person tables (reminders, notifications, commissions, sop_reads) are scoped to the owning member.

- **Self-authed edge functions.** Webhook/cron/trigger functions run with `verify_jwt = false` and re-verify inside the function — provider signatures (Calendly HMAC, Stripe signature, Slack signing secret, Fathom shared secret), a bearer-API-key RPC (`public-api`), or an `isServiceRequest()` service-request gate. User-facing functions keep `verify_jwt = true` and build a per-request client from the caller's JWT so RLS still applies. System writes deliberately use the service-role `adminClient()` to cross RLS boundaries.

- **Idempotent webhooks & automations.** External events are made replay-safe: `calls` upsert `onConflict: fathom_id`, leads upsert `onConflict: email`, commissions are unique on `(payment_id, recipient_role)`, payments unique on `stripe_charge_id`, and the payment-recovery ladder is idempotent per `event_type` against `payment_recovery_events`. Every inbound/outbound call is recorded in `integrations_log`; outbound subscriber deliveries in `webhook_deliveries`.

- **Generated, single-source TypeScript types.** `src/lib/database.types.ts` is generated from the Supabase schema; the client is `createClient<Database>(...)`, so every `.from().select()` call, query-hook return shape, and enum alias (`LeadStage`, `TeamRole`, `CallOutcome`, …) is statically typed from one source of truth shared by the UI and role-gating logic.

- **Vercel-proxied first-party API surface.** `/api/*` rewrites keep all webhook endpoints and the public REST API on the app domain instead of the raw Supabase host — cleaner third-party setup, no exposed project hostname, and no CORS/cookie friction.

- **Dual notification fan-out.** Native Slack (per-channel incoming webhooks + an interactive bot) coexists with a generic, HMAC-signable event bus (`webhook_subscriptions` → Zapier/Make/n8n), both driven by the same emitted CRM events and gated by `automation_settings` feature flags (fail-open).

- **Secrets by reference, never by value.** Integration credentials live in `integration_configs` (`secret_ref` = Vault name only) or Supabase Vault (`service_key` read at runtime via `pg_net`), so no credential is embedded in migration SQL, `pg_proc` metadata, or client code; rotation is a single Vault update. API keys are stored only as SHA-256 hashes plus a display prefix, shown in plaintext exactly once.

- **Business logic in the database.** Stage transitions, commission creation/clawback, milestone seeding, coach-assignment notifications, and stat refreshes are Postgres triggers/RPCs rather than app code — keeping invariants enforced regardless of which client (UI, webhook, cron, or public API) writes the row. Heavy reporting is pushed into SQL views and one materialized view (`closer_stats_daily`).

- **Light, semantic-token UI aesthetic.** A Linear/Attio-style, low-contrast light theme is defined entirely through Tailwind v4 `@theme` CSS variables in `src/index.css` (Inter font, near-white background, soft-grey borders, a shared radius scale). Components reference semantic tokens (`var(--color-card)`, `var(--color-muted-foreground)`) rather than hard-coded color classes, built on shadcn/ui new-york primitives with drawers/sheets for detail views and dialogs for create/edit actions.
