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

## Deployment + branded webhook URLs

Goal: webhooks read as `https://coaching.joinecompulse.com/api/inbound/lead` and `https://coaching.joinecompulse.com/api/webhooks/calendly` instead of raw `*.functions.supabase.co` URLs.

### 1. Deploy to Vercel

```bash
npm i -g vercel
cd ~/ecompulse-crm
vercel --prod
```

Set environment variables in the Vercel project dashboard (or via `vercel env add`):

| Var | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://ecdqlgigczmiilvztsno.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | (the anon key) |
| `VITE_PUBLIC_BASE_URL` | `https://coaching.joinecompulse.com` |

### 2. Add the custom domain

In Vercel → Project → Domains, add `coaching.joinecompulse.com`. Vercel shows the DNS record(s) to create at your registrar — typically a CNAME pointing to `cname.vercel-dns.com`.

### 3. The rewrites are already configured

`vercel.json` maps:

```
/api/inbound/lead              →  <supabase>/functions/v1/public-api/lead
/api/inbound/payment           →  <supabase>/functions/v1/public-api/payment
/api/webhooks/calendly         →  <supabase>/functions/v1/calendly-webhook
/api/webhooks/stripe           →  <supabase>/functions/v1/stripe-webhook
/api/webhooks/instagram        →  <supabase>/functions/v1/instagram-webhook
/(everything else)             →  /index.html        (SPA fallback)
```

Once `VITE_PUBLIC_BASE_URL` is set, the Integrations page automatically shows the branded URLs in the "Your Webhook Endpoint" card and in each integration's expanded view — paste those into Calendly/Stripe/Instagram.
