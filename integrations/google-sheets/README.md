# Deal & Comms tracker → CRM sync

Pushes each closed-deal row from the Google "Deal & Comms tracker" sheet into
the CRM so the **Manager Dashboard** stays current (Cash Collected, Order Value,
leaderboard, per-closer/setter performance, commissions).

## How it works

The sheet calls the CRM's existing universal inbound endpoint:

```
POST  https://<crm-domain>/api/inbound/event
Authorization: Bearer <api-key>
{ "event": "deal", "deal_ref": "<uuid>", "lead_name": "...", "deal_value": 713.44,
  "closer": "Nick", "setter": "Nick", "status": "Paid", "plan_type": "Payment Plan",
  "offer": "1-1 coaching pilot", "source": "Referral", "deal_date": "2026-03-05",
  "currency": "USD" }
```

For each row the CRM (`applyDeal` in `supabase/functions/_shared/booking.ts`):

1. **Finds or creates the lead** by name (case-insensitive; most recent match).
2. **Resolves closer/setter names** against active CRM team members (exact →
   first name → prefix → substring). Unmatched names are reported back and noted
   on the deal, but the deal still logs.
3. **Logs a won deal** (`deals.status = 'won'`) → feeds **Order Value**.
4. **When Status = Paid**, logs a full-value **payment** → feeds **Cash
   Collected** and auto-fires the closer + setter **commission** engine.
   - `Refunded` rows log the deal as `refunded` and the payment as `is_refund`
     (nets to zero, claws back commission).
   - Any other status logs the deal without a payment (counts toward Order Value,
     not Cash Collected yet).

## Automatic syncing

`Install auto-sync` sets up **two** triggers:

- **On-edit trigger** — fires the instant you edit a deal row in the browser, so
  flipping Status to Paid (or editing any field) syncs that row immediately.
- **Hourly backstop** — re-syncs every row on a timer. On-edit triggers only
  fire for **manual edits in the UI**; they do NOT fire when rows are changed by
  an import, the Sheets API, or another script. The backstop catches those.
  Re-syncing is idempotent (see below), so this never duplicates anything.

The deal sheet is detected by its **headers** ("Lead Name" + "Deal Value"), so
renaming the tab no longer breaks auto-sync. Failed auto-syncs leave a red
**note** on the hidden `CRM Sync ID` cell of that row (hover to read the error).

### Idempotency

The script stamps a UUID into a hidden **`CRM Sync ID`** column (one per row).
The CRM anchors the deal on `deals.stripe_payment_intent_id = sheet:<uuid>` and
the payment on `payments.stripe_charge_id = sheet:<uuid>:p1`. So **backfilling
the whole sheet and re-syncing edited rows is safe** — re-syncs update in place
instead of duplicating.

## Setup

1. **Generate an API key** in the CRM: Integrations → API Keys → Generate, with
   **both** `lead.create` and `payment.create` scopes (the "Generate" button on
   the Webhook Endpoint card mints both). Copy the key.
2. In the sheet: **Extensions → Apps Script**, paste `DealSync.gs`, **Save**.
3. Reload the sheet. **CRM Sync → Set credentials…** and paste the endpoint URL
   (`…/api/inbound/event`) and the API key.
4. **CRM Sync → Test connection / diagnose** — confirms the key is accepted, the
   deal tab is detected, and (after step 5) that the triggers are installed.
5. **CRM Sync → Install auto-sync** (authorize when prompted).
6. **CRM Sync → Sync all rows (backfill)** to import existing deals.

## Troubleshooting — "it isn't syncing automatically"

Run **CRM Sync → Test connection / diagnose** first; it checks all four things
below and tells you which one is broken.

1. **Triggers not installed / got disabled.** Re-run **Install auto-sync**. Then
   open **Apps Script → Triggers** (clock icon) and confirm `onEditAutoSync`
   (event: On edit) and `backstopSync` (time-driven) are listed. Google
   auto-disables a trigger after repeated failures — check **Apps Script →
   Executions** for red errors and re-install.
2. **Wrong tab name (legacy bug).** Older versions only synced a tab named
   exactly `Deal Log`. This version detects the tab by its headers, so just
   re-paste `DealSync.gs` and Save.
3. **API key rejected.** Diagnose shows `key REJECTED (401/403)`. Generate a new
   key in the CRM with **both** scopes and re-run **Set credentials…**.
4. **Row has a red note on the hidden `CRM Sync ID` column.** That row's last
   sync failed — hover the note for the exact error (e.g. unmatched closer name).
5. **Edits made by another tool/import don't fire on-edit** — that's expected;
   the **hourly backstop** picks them up within the hour. Run **Sync all rows**
   for an immediate catch-up.

## Notes / caveats

- **Team name matching:** make sure each closer/setter's CRM name matches the
  name used in the sheet (a first name like "Nick" matches "Nick Lastname").
  Unmatched names show up in the "Sync all" summary and in the deal's notes.
- **Commission rates** in the CRM come from each team member's configured
  `commission_pct` (Team page), **not** the sheet's 5% / 10% columns.
- **Currency:** rows are sent as USD. The dashboard sums amounts in cents.
- **Lead matching is name-only** (the sheet has no email column). Fixing a name
  typo and re-syncing is safe.
