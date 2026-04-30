// Catalog of events the CRM emits to webhook subscribers (Zapier, Make, n8n,
// custom). Edge functions emit these by exact `event_type` string — keep this
// list in sync with what the dispatchEvent calls actually send.

export interface WebhookEventDef {
  key: string
  displayName: string
  description: string
  group: "lead" | "call" | "payment" | "deal" | "reminder"
}

export const WEBHOOK_EVENTS: WebhookEventDef[] = [
  {
    key: "lead.created",
    displayName: "Lead created",
    description: "A new lead enters the CRM (public API, Calendly booking, manual).",
    group: "lead",
  },
  {
    key: "lead.updated",
    displayName: "Lead updated",
    description: "A lead is updated (re-posted via API, stage change, manual edit).",
    group: "lead",
  },
  {
    key: "call.booked",
    displayName: "Call booked",
    description: "Strategy call is booked via Calendly. Includes attribution + closer.",
    group: "call",
  },
  {
    key: "call.cancelled",
    displayName: "Call cancelled",
    description: "Calendly invitee cancels their booking.",
    group: "call",
  },
  {
    key: "payment.received",
    displayName: "Payment received",
    description: "Stripe checkout completes successfully (or manual payment logged).",
    group: "payment",
  },
  {
    key: "payment.refunded",
    displayName: "Payment refunded",
    description: "Stripe charge is refunded (full or partial).",
    group: "payment",
  },
  {
    key: "deal.won",
    displayName: "Deal won",
    description: "A deal closes successfully — fires alongside payment.received.",
    group: "deal",
  },
  {
    key: "deal.lost",
    displayName: "Deal lost",
    description: "A deal is marked lost with a reason.",
    group: "deal",
  },
  {
    key: "pre_call.reminder",
    displayName: "Pre-call reminder (T-15)",
    description:
      "Fires 15 minutes before each scheduled call. Payload includes lead, closer, scheduled time (UTC + closer-local), and pre_call_started status.",
    group: "reminder",
  },
]

export function eventDef(key: string): WebhookEventDef | undefined {
  return WEBHOOK_EVENTS.find((e) => e.key === key)
}
