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
     (nets to zero, claws back commission) — i.e. excluded from payroll, matching
     the sheet's note.
   - Any other status logs the deal without a payment (counts toward Order Value,
     not Cash Collected yet).

### Idempotency

The script stamps a UUID into a hidden **`CRM Sync ID`** column (one per row).
The CRM anchors the deal on `deals.stripe_payment_intent_id = sheet:<uuid>` and
the payment on `payments.stripe_charge_id = sheet:<uuid>:p1`. So **backfilling
the whole sheet and re-syncing edited rows is safe** — re-syncs update in place
instead of duplicating. No DB migration was required.

## Setup

1. **Generate an API key** in the CRM: Integrations → API Keys → Generate, with
   **both** `lead.create` and `payment.create` scopes (the "Generate" button on
   the Webhook Endpoint card mints both). Copy the key.
2. In the sheet: **Extensions → Apps Script**, paste `DealSync.gs`, **Save**.
3. Reload the sheet. Use the new **CRM Sync** menu → **Set credentials…** and
   paste the endpoint URL (`…/api/inbound/event`) and the API key.
4. **CRM Sync → Install auto-sync** (authorize when prompted).
5. **CRM Sync → Sync all rows (backfill)** to import existing deals.

After that, flipping a row's **Status** to Paid — or editing any deal row —
syncs it automatically.

## Notes / caveats

- **Team name matching:** make sure each closer/setter's CRM name matches the
  name used in the sheet (a first name like "Nick" matches "Nick Lastname").
  Unmatched names show up in the "Sync all" summary and in the deal's notes.
- **Commission rates** in the CRM come from each team member's configured
  `commission_pct` (Team page), **not** the sheet's 5% / 10% columns. Set the
  rates in the CRM (closers 10%, setters 5%) so commission amounts match. Cash
  Collected and Order Value are unaffected by this.
- **Currency:** rows are sent as USD. The dashboard sums amounts in cents
  regardless of currency symbol.
- **Lead matching is name-only** (the sheet has no email column). Watch for
  duplicate leads from name typos; fixing the sheet name and re-syncing is safe.
