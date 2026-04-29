# Supabase Edge Functions

These run on Supabase's Deno runtime and act as the public webhook receivers for the CRM. They use the `service_role` key to bypass RLS and write into the database.

## Functions

| Function | Purpose | External setup |
|---|---|---|
| `calendly-webhook` | New booking → upsert lead + assign closer + schedule 15-min reminder. Cancellation → cancel reminder. | Calendly Webhook v2, subscribe to `invitee.created` and `invitee.canceled` |
| `stripe-webhook` | Payment success → create deal + payment + activity, advance stage to `won`. Refund → flag deal, log negative payment. | Stripe Dashboard → Webhooks |

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
```

After deploying, the URLs will be:

- `https://<project-ref>.functions.supabase.co/calendly-webhook`
- `https://<project-ref>.functions.supabase.co/stripe-webhook`

Paste these into Calendly and Stripe respectively.

## Adding more functions

Drop a new folder under `supabase/functions/<name>/index.ts`. Use the helpers in `_shared/` for the admin client and integration logging. Always log every webhook (success and failure) to `integrations_log` so the Integrations page can show health.
