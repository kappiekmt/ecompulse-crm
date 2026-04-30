# Slack App — Phase 1 Setup

Step-by-step manual instructions to get the EcomPulse CRM Slack app live.
Phase 1 ships: `/lead`, `/note`, `/student-status`, and `@crm-bot summarize <name>`.

---

## 1. Run the migration

Open the Supabase SQL editor and run:

```
supabase/migrations/0014_coaching_tier.sql
```

This adds the `coaching_tier` enum + columns on `deals` and `students`.

---

## 2. Create the Slack app from the manifest

1. Go to https://api.slack.com/apps → **Create New App** → **From a manifest**.
2. Pick the workspace **ecompulse-coaching**.
3. Paste the contents of `slack/manifest.json`.
4. Click **Create**.

The manifest registers:
- Bot user named *EcomPulse CRM*
- Slash commands: `/lead`, `/note`, `/student-status`
- Event subscriptions: `app_mention`, `message.im`
- Interactivity (for buttons later)
- All required OAuth scopes

> **Note:** the request URLs point at `https://coaching.joinecompulse.com/api/slack/...`. Slack will *not* try to verify them at create time — verification happens only after install + when you save event subscriptions. Don't worry that the function isn't deployed yet.

---

## 3. Deploy the edge function

```bash
cd ~/ecompulse-crm
supabase functions deploy slack-app
```

This deploys the function without secrets yet — the next step adds those.

---

## 4. Set Supabase function secrets

Grab the credentials from the Slack app dashboard:

| Secret | Where in Slack |
|---|---|
| `SLACK_BOT_TOKEN` | Slack app → **OAuth & Permissions** → *Bot User OAuth Token* (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | Slack app → **Basic Information** → *App Credentials* → *Signing Secret* |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → *API Keys* (only needed for the AI summary feature) |

```bash
supabase secrets set SLACK_BOT_TOKEN=xoxb-… \
                     SLACK_SIGNING_SECRET=… \
                     ANTHROPIC_API_KEY=sk-ant-…
```

> You'll get the bot token *after* the next step (install). It's fine to set the signing secret now and add the bot token after install.

---

## 5. Install the app to the workspace

1. Slack app dashboard → **Install App** → *Install to Workspace*.
2. Approve the scopes.
3. Copy the new *Bot User OAuth Token* (`xoxb-…`) and run the secret-set command from step 4 with it.

---

## 6. Push and deploy the rewrite

The Vercel rewrite at `/api/slack/*` → Supabase needs to be live for Slack's request URLs to resolve.

```bash
git add -A
git commit -m "Phase 1: Slack app skeleton (commands, events, AI summary)"
git push -u origin feat/slack-app
```

Then either:
- Merge to `main` so the production Vercel deploy picks up the new `vercel.json`, **or**
- Test from the branch's Vercel preview deploy by temporarily pointing the Slack request URLs at the preview domain (Slack app dashboard → Slash Commands / Event Subscriptions / Interactivity → edit URL).

---

## 7. Smoke test

In any Slack channel where the bot is invited:

```
/lead senna
/student-status senna
/note senna@example.com :: said he's hitting €5k/day, ready for 1-on-1
@EcomPulse CRM summarize senna
```

If a command returns `dispatch_failed`, check Supabase function logs:

```bash
supabase functions logs slack-app --tail
```

Most common causes:
- `SLACK_SIGNING_SECRET` doesn't match → 401 invalid signature
- `SLACK_BOT_TOKEN` missing → events handler can't post replies
- Vercel rewrite not deployed yet → Slack hits a 404 on `/api/slack/...`

---

## 8. Coaching-tier matching

The Stripe webhook now writes `deals.coaching_tier` based on the price/product
name. The matcher (`supabase/functions/_shared/coaching-tier.ts`) recognizes:

- `fundament` → `fundament`
- anything containing `groep` → `groepscoaching`
- `1-1`, `1 op 1`, `one on one` → `one_on_one`

As long as those keywords stay in your Stripe payment-link descriptions, PIF
and installment links both classify correctly. To verify, look at
`integrations_log` after a test payment — the deal row should have a non-null
`coaching_tier`.

---

## What's next

Phase 2 — Discord bot for student-side actions (channel creation for 1-on-1,
auto-add to group channels, coach DM with lead context). Triggered by the
`deal.won` event the Stripe webhook already dispatches.
