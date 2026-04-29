# EcomPulse CRM

Custom CRM for EcomPulse — handles strategy-call bookings, sales pipeline, student onboarding, and the team's automation chain (Calendly → Slack → Stripe → Discord/Whop → ActiveCampaign).

## Stack

- React 19 + Vite 8 + TypeScript
- Tailwind CSS v4 + shadcn/ui (light, intuitive UI)
- Supabase (Postgres + Auth + RLS) for backend
- React Router for routing, TanStack Query for data fetching
- Lucide for icons

## Roles

Four account types with their own dashboards and RLS policies:

- **Admin** — full access; manages team, automations, finance.
- **Closer** — sees their assigned calls + pre-call SOPs + personal stats.
- **Setter** — sees their bookings + attribution + conversion.
- **Coach** — sees only their assigned students.

## Integrations to wire up

| Tool | Direction | Purpose |
|---|---|---|
| Calendly | webhook in | New strategy-call booking → create lead, assign closer |
| Stripe | webhook in | Payment → start onboarding; refund → flag deal |
| Slack | API out | Booking alerts, 15-min reminders, coach DMs, finance log |
| Discord | API out (bot) | Auto-invite student into community |
| Whop | API out | Grant program access |
| ActiveCampaign | API out | Nurture, value content, downsell sequence |
| Gmail / SMTP | API out | Pre-call confirmations, onboarding emails |
| Google Sheets | API out | Mirror finance rows for accounting |
| Claude API | API out | Lead enrichment, message drafting |

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL + anon key
npm run dev
```

## Database

See [`supabase/README.md`](./supabase/README.md). Run `supabase/migrations/0001_init.sql` in the Supabase SQL editor on first setup.
