# Supabase Edge Functions

These run on Supabase's Deno runtime and act as the public webhook receivers for the CRM. They use the `service_role` key to bypass RLS and write into the database.

## Functions

| Function | Purpose | External setup |
|---|---|---|
| `calendly-webhook` | New booking → upsert lead + assign closer + schedule 15-min reminder. Cancellation → cancel reminder. | Calendly Webhook v2, subscribe to `invitee.created` and `invitee.canceled` |
| `stripe-webhook` | Payment success → create deal + payment + activity, advance stage to `won`. Refund → flag deal, log negative payment. | Stripe Dashboard → Webhooks |
| `public-api` | REST API for landing pages / Zapier / partners. Authenticated by API keys minted in CRM. Routes: `POST /lead`, `POST /payment`. | Provide consumer with API key + base URL from Integrations page |

## First-time deploy

```bash
# Install Supabase CLI if needed
brew install supabase/tap/supabase

# Login + link to your project
supabase login
supabase link --project-ref <your-project-ref>

# Set secrets (function env vars)
supabase secrets set CALENDLY_SIGNING_KEY=<from_calendly>
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set STRIPE_SECRET_KEY=sk_live_...

# Deploy
supabase functions deploy calendly-webhook
supabase functions deploy stripe-webhook
supabase functions deploy public-api
```

After deploying, the URLs will be:

- `https://<project-ref>.functions.supabase.co/calendly-webhook`
- `https://<project-ref>.functions.supabase.co/stripe-webhook`
- `https://<project-ref>.functions.supabase.co/public-api`

Paste the first two into Calendly and Stripe respectively. The `public-api` URL goes to landing pages, Zapier flows, and partners — paired with an API key minted in **Integrations → CRM API Keys**.

## Public API usage

```bash
# Create a lead
curl -X POST https://<ref>.functions.supabase.co/public-api/lead \
  -H "Authorization: Bearer ek_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Tatiana Zadoina",
    "email": "tat@example.com",
    "instagram": "@tat",
    "utm_source": "ig_ads",
    "utm_campaign": "ecompulse_q2",
    "tags": ["Hot"]
  }'
```

## Adding more functions

Drop a new folder under `supabase/functions/<name>/index.ts`. Use the helpers in `_shared/` for the admin client and integration logging. Always log every webhook (success and failure) to `integrations_log` so the Integrations page can show health.
