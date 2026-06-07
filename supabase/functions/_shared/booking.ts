// Shared inbound-event handlers for the public API.
//
// One module, four handlers — lead / payment / call-booked / call-cancelled —
// so the `public-api` function can expose them through both the legacy
// per-route endpoints (POST /lead, POST /payment) AND a single universal
// router (POST /event with an `event` field). Add a new automation = add one
// handler + one case in /event; the URL and API key never change.
//
// Handlers return a plain { status, body } so the caller owns the HTTP
// response shaping (CORS, content-type). They never throw for expected
// conditions (missing email, no matching lead) — they return a 4xx/200 with a
// descriptive body that shows up in the caller's run log (e.g. Zapier).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getIntegrationConfig, logIntegration } from "./supabase-admin.ts"
import { dispatchEvent } from "./dispatch.ts"
import { leadDeepLink, postToSlack, slackMention } from "./slack.ts"

export interface HandlerResult {
  status: number
  body: unknown
}

// ---------------------------------------------------------------------------
// Forgiving field parsing — Zapier/landing-page payloads are hand-mapped, so
// be generous about field names and casing.
// ---------------------------------------------------------------------------

export type Bag = Record<string, unknown>

/** Lowercase every top-level key so picks are case-insensitive. */
export function lowerKeyed(obj: unknown): Bag {
  const out: Bag = {}
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Bag)) out[k.toLowerCase()] = v
  }
  return out
}

export function pick(bag: Bag, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = bag[k.toLowerCase()]
    if (typeof v === "string" && v.trim()) return v.trim()
    if (typeof v === "number") return String(v)
  }
  return null
}

export function pickNumber(bag: Bag, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = bag[k.toLowerCase()]
    if (typeof v === "number" && !Number.isNaN(v)) return v
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v)
  }
  return null
}

export function pickBool(bag: Bag, ...keys: string[]): boolean {
  for (const k of keys) {
    const v = bag[k.toLowerCase()]
    if (v === true) return true
    if (typeof v === "string" && ["true", "yes", "1", "on"].includes(v.trim().toLowerCase())) return true
    if (typeof v === "number" && v === 1) return true
  }
  return false
}

export function asEmail(value: string | null): string | null {
  if (!value) return null
  const m = value.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  return m?.[0]?.trim() ?? null
}

function asHttpUrl(value: string | null): string | null {
  return value && /^https?:\/\//.test(value) ? value : null
}

export type InboundEvent = "lead" | "booked" | "cancelled" | "payment" | "deal"

/** Map the `event`/`action` field (or, failing that, payload shape) to one of
 *  the handlers. Returns null when it can't tell — the caller 400s with a
 *  message so a misconfigured Zap is obvious. */
export function classifyEvent(bag: Bag): InboundEvent | null {
  const s = (pick(bag, "event", "action", "type", "event_type", "trigger") ?? "").toLowerCase()
  if (!s) {
    if (pick(bag, "canceled_at", "cancelled_at", "cancellation_reason", "cancel_reason", "canceled_by")) {
      return "cancelled"
    }
    return null
  }
  if (s.includes("cancel")) return "cancelled"
  // "deal" before "pay" so a deal row whose status mentions payment still routes
  // to the deal handler (it creates lead + deal + payment in one shot).
  if (s.includes("deal") || s.includes("close") || s.includes("sale")) return "deal"
  if (s.includes("pay")) return "payment"
  if (s.includes("book") || s.includes("invitee.created") || s === "created" || s.includes("schedul")) {
    return "booked"
  }
  if (s.includes("lead")) return "lead"
  return null
}

// ---------------------------------------------------------------------------
// Typed inputs + builders from a raw bag
// ---------------------------------------------------------------------------

export interface LeadInput {
  full_name?: string
  email?: string | null
  phone?: string | null
  instagram?: string | null
  timezone?: string | null
  stage?: string | null
  scheduled_at?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  source_landing_page?: string | null
  source?: string | null
  budget_cents?: number | null
  notes?: string | null
  tags?: string[] | null
}

export interface PaymentInput {
  email?: string | null
  amount_cents?: number | null
  currency?: string | null
  paid_at?: string | null
  stripe_charge_id?: string | null
  notes?: string | null
}

export interface BookingInput {
  email: string | null
  name: string | null
  phone: string | null
  timezone: string | null
  closerEmail: string | null
  scheduledFor: string | null
  eventName: string | null
  eventId: string | null
  joinUrl: string | null
  cancelUrl: string | null
  rescheduleUrl: string | null
  cancelledAt: string | null
  cancelReason: string | null
  rescheduled: boolean
  newEventId: string | null
  utm: Utm
  source: string
  rawPayload: unknown
}

interface Utm {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
}

function utmFromBag(bag: Bag): Utm {
  return {
    utm_source: pick(bag, "utm_source"),
    utm_medium: pick(bag, "utm_medium"),
    utm_campaign: pick(bag, "utm_campaign"),
    utm_content: pick(bag, "utm_content"),
    utm_term: pick(bag, "utm_term"),
  }
}

export function toLeadInput(bag: Bag): LeadInput {
  const tagsRaw = bag["tags"]
  return {
    full_name: pick(bag, "full_name", "name", "invitee_name", "fullname") ?? undefined,
    email: asEmail(pick(bag, "email", "invitee_email", "lead_email")),
    phone: pick(bag, "phone", "phone_number", "text_reminder_number", "mobile"),
    instagram: pick(bag, "instagram", "ig", "instagram_handle"),
    timezone: pick(bag, "timezone", "tz", "time_zone"),
    stage: pick(bag, "stage"),
    scheduled_at: pick(bag, "scheduled_at", "start_time", "event_start_time"),
    source: pick(bag, "source") ?? "zapier",
    source_landing_page: pick(bag, "source_landing_page", "landing_page", "page_url"),
    budget_cents: pickNumber(bag, "budget_cents"),
    notes: pick(bag, "notes", "message", "comments"),
    tags: Array.isArray(tagsRaw) ? (tagsRaw as unknown[]).map(String) : undefined,
    ...utmFromBag(bag),
  }
}

export function toPaymentInput(bag: Bag): PaymentInput {
  return {
    email: asEmail(pick(bag, "email", "invitee_email", "customer_email")),
    amount_cents: pickNumber(bag, "amount_cents"),
    currency: pick(bag, "currency"),
    paid_at: pick(bag, "paid_at", "payment_date", "created"),
    stripe_charge_id: pick(bag, "stripe_charge_id", "charge_id", "transaction_id"),
    notes: pick(bag, "notes"),
  }
}

// A logged deal from the Google "Deal & Comms tracker" sheet. One sheet row =
// one closed deal; the handler fans it out into lead + won-deal + payment.
export interface DealInput {
  deal_ref: string | null // stable per-row id (the sheet's hidden sync column)
  lead_name: string | null
  email?: string | null
  offer?: string | null
  amount_cents: number | null
  currency?: string | null
  closer_name?: string | null
  setter_name?: string | null
  status?: string | null
  plan_type?: string | null
  source?: string | null
  deal_date?: string | null
}

/** Deal value arrives in major units ($713.44) from the sheet; accept
 *  amount_cents too in case a caller pre-converts. */
function dealAmountCents(bag: Bag): number | null {
  const cents = pickNumber(bag, "amount_cents")
  if (cents != null) return Math.round(cents)
  const major = pickNumber(bag, "deal_value", "deal value", "amount", "value", "price", "contract_value")
  if (major != null) return Math.round(major * 100)
  return null
}

export function toDealInput(bag: Bag): DealInput {
  return {
    deal_ref: pick(bag, "deal_ref", "row_id", "sync_id", "id"),
    lead_name: pick(bag, "lead_name", "lead name", "name", "full_name", "lead"),
    email: asEmail(pick(bag, "email", "lead_email")),
    offer: pick(bag, "offer", "product", "offer_product", "offer / product", "program"),
    amount_cents: dealAmountCents(bag),
    currency: pick(bag, "currency"),
    closer_name: pick(bag, "closer", "closer_name"),
    setter_name: pick(bag, "setter", "setter_name"),
    status: pick(bag, "status"),
    plan_type: pick(bag, "plan_type", "plan type", "plan"),
    source: pick(bag, "source", "lead_source"),
    deal_date: pick(bag, "deal_date", "date", "closed_at"),
  }
}

export function toBookingInput(bag: Bag, rawPayload: unknown): BookingInput {
  return {
    email: asEmail(pick(bag, "email", "invitee_email", "attendee_email", "lead_email", "guest_email")),
    name: pick(bag, "name", "full_name", "invitee_name", "fullname", "attendee_name"),
    phone: pick(bag, "phone", "phone_number", "text_reminder_number", "mobile", "invitee_phone"),
    timezone: pick(bag, "timezone", "tz", "invitee_timezone", "time_zone"),
    closerEmail: asEmail(
      pick(bag, "closer_email", "host_email", "event_host_email", "host", "assigned_to", "owner_email")
    ),
    scheduledFor: pick(bag, "scheduled_at", "start_time", "event_start_time", "scheduled_event_start_time"),
    eventName: pick(bag, "event_name", "event_type_name", "calendly_event_name", "meeting_name"),
    eventId: pick(bag, "event_id", "event_uri", "scheduled_event_uri", "calendly_event_uri", "uri"),
    joinUrl: asHttpUrl(pick(bag, "join_url", "location", "meeting_url", "video_url", "conference_url")),
    cancelUrl: asHttpUrl(pick(bag, "cancel_url", "cancellation_url")),
    rescheduleUrl: asHttpUrl(pick(bag, "reschedule_url", "rescheduling_url")),
    cancelledAt: pick(bag, "canceled_at", "cancelled_at", "cancellation_created_at"),
    cancelReason: pick(bag, "cancel_reason", "cancellation_reason", "reason"),
    rescheduled: pickBool(bag, "rescheduled", "is_reschedule", "was_rescheduled"),
    newEventId: pick(bag, "new_event_id", "new_invitee", "new_event_uri", "rescheduled_to"),
    utm: utmFromBag(bag),
    source: pick(bag, "source") ?? "calendly",
    rawPayload,
  }
}

const BOOKED_STAGES = ["booked", "confirmed", "showed", "no_show", "pitched", "won", "lost"]

// ---------------------------------------------------------------------------
// Lead — faithful port of the original POST /lead logic so /lead and /event
// (event:"lead") behave identically.
// ---------------------------------------------------------------------------

export async function applyLead(supabase: SupabaseClient, body: LeadInput): Promise<HandlerResult> {
  if (!body.full_name) {
    return { status: 400, body: { error: "full_name is required" } }
  }

  const stage = body.stage ?? "new"
  const row: Record<string, unknown> = {
    full_name: body.full_name,
    stage,
    source: body.source ?? "public_api",
  }
  if (BOOKED_STAGES.includes(stage)) row.booked_at = new Date().toISOString()
  if (body.scheduled_at) row.scheduled_at = body.scheduled_at
  if (body.budget_cents != null) row.budget_cents = body.budget_cents

  const optional: (keyof LeadInput)[] = [
    "email",
    "phone",
    "instagram",
    "timezone",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "source_landing_page",
    "notes",
  ]
  for (const k of optional) {
    const v = body[k]
    if (v !== undefined && v !== null && v !== "") row[k] = v
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .upsert(row, { onConflict: "email" })
    .select("id")
    .single()

  if (error || !lead) {
    await logIntegration(supabase, {
      provider: "public_api",
      direction: "inbound",
      event_type: "lead.create",
      status: "failed",
      request_payload: body as never,
      error: error?.message ?? "lead upsert failed",
    })
    return { status: 500, body: { error: error?.message ?? "lead upsert failed" } }
  }

  if (body.tags?.length) {
    const { data: tagRows } = await supabase.from("lead_tags").select("id, name").in("name", body.tags)
    if (tagRows?.length) {
      await supabase
        .from("lead_tag_assignments")
        .upsert(tagRows.map((t) => ({ lead_id: lead.id, tag_id: t.id })), { onConflict: "lead_id,tag_id" })
    }
  }

  if (body.scheduled_at) {
    const scheduledAt = new Date(body.scheduled_at)
    if (!Number.isNaN(scheduledAt.getTime())) {
      const fireAt = new Date(scheduledAt.getTime() - 15 * 60 * 1000).toISOString()
      const { data: existing } = await supabase
        .from("reminders")
        .select("id")
        .eq("lead_id", lead.id)
        .eq("kind", "pre_call_15m")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existing) {
        await supabase
          .from("reminders")
          .update({
            fire_at: fireAt,
            status: "scheduled",
            completed_at: null,
            payload: { scheduled_for: scheduledAt.toISOString(), source: "public_api" } as never,
          })
          .eq("id", existing.id)
      } else {
        await supabase.from("reminders").insert({
          lead_id: lead.id,
          kind: "pre_call_15m",
          fire_at: fireAt,
          payload: { scheduled_for: scheduledAt.toISOString(), source: "public_api" } as never,
        })
      }
    }
  }

  await supabase.from("activities").insert({
    lead_id: lead.id,
    type: "public_api.lead.create",
    payload: body as never,
  })

  await logIntegration(supabase, {
    provider: "public_api",
    direction: "inbound",
    event_type: "lead.create",
    status: "success",
    request_payload: body as never,
    related_lead_id: lead.id,
  })

  await dispatchEvent(supabase, {
    event_type: "lead.created",
    data: {
      lead: {
        id: lead.id,
        full_name: body.full_name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        instagram: body.instagram ?? null,
        stage,
        source: body.source ?? "public_api",
        tags: body.tags ?? [],
        utm_source: body.utm_source ?? null,
        utm_medium: body.utm_medium ?? null,
        utm_campaign: body.utm_campaign ?? null,
        utm_content: body.utm_content ?? null,
        utm_term: body.utm_term ?? null,
        notes: body.notes ?? null,
      },
    },
  })

  return { status: 201, body: { ok: true, lead_id: lead.id } }
}

// ---------------------------------------------------------------------------
// Payment — faithful port of POST /payment (plus an audit log line).
// ---------------------------------------------------------------------------

export async function applyPayment(supabase: SupabaseClient, body: PaymentInput): Promise<HandlerResult> {
  if (!body.email || !body.amount_cents) {
    return { status: 400, body: { error: "email and amount_cents are required" } }
  }

  const { data: lead } = await supabase.from("leads").select("id").eq("email", body.email).maybeSingle()

  const { data: payment, error } = await supabase
    .from("payments")
    .insert({
      lead_id: lead?.id ?? null,
      amount_cents: body.amount_cents,
      currency: body.currency ?? "EUR",
      paid_at: body.paid_at ?? new Date().toISOString(),
      stripe_charge_id: body.stripe_charge_id ?? null,
      source: "manual",
      notes: body.notes ?? null,
    })
    .select("id")
    .single()

  if (error) {
    await logIntegration(supabase, {
      provider: "public_api",
      direction: "inbound",
      event_type: "payment.received",
      status: "failed",
      request_payload: body as never,
      error: error.message,
      related_lead_id: lead?.id ?? null,
    })
    return { status: 500, body: { error: error.message } }
  }

  await logIntegration(supabase, {
    provider: "public_api",
    direction: "inbound",
    event_type: "payment.received",
    status: "success",
    request_payload: body as never,
    related_lead_id: lead?.id ?? null,
  })

  await dispatchEvent(supabase, {
    event_type: "payment.received",
    data: {
      payment: {
        id: payment?.id,
        lead_id: lead?.id ?? null,
        amount_cents: body.amount_cents,
        currency: body.currency ?? "EUR",
        paid_at: body.paid_at ?? new Date().toISOString(),
        source: "public_api",
      },
    },
  })

  return { status: 201, body: { ok: true, payment_id: payment?.id } }
}

// ---------------------------------------------------------------------------
// Deal — a closed deal logged in the Google "Deal & Comms tracker" sheet.
//
// One sheet row → lead (matched/created by name) + won deal + (when Paid) a
// full-value payment. The payment insert auto-fires the commission engine
// (closer + setter rows via the create_commission_on_payment trigger), and the
// deal feeds the Manager Dashboard's Order Value while the payment feeds Cash
// Collected.
//
// Idempotent per row: the deal is anchored on `stripe_payment_intent_id =
// sheet:<deal_ref>` and the payment on `stripe_charge_id = sheet:<deal_ref>:p1`,
// so backfilling the whole sheet and re-syncing edited rows is safe (re-sync
// updates in place rather than duplicating). No new schema — it reuses the
// existing unique `payments.stripe_charge_id` and the `deals` Stripe id column
// as sync anchors.
// ---------------------------------------------------------------------------

interface TeamMatch {
  id: string
  full_name: string
  role: string
}

/** Resolve a closer/setter NAME from the sheet to a team_member. The sheet
 *  carries names ("Nick"), not emails, so match tolerantly: exact, then
 *  first-name, then prefix, then substring. Returns null when nothing matches
 *  (the deal is still logged; the caller reports which side went unmatched). */
async function resolveTeamMemberByName(
  supabase: SupabaseClient,
  name: string | null | undefined
): Promise<TeamMatch | null> {
  const target = (name ?? "").trim().toLowerCase()
  if (!target) return null
  const { data } = await supabase
    .from("team_members")
    .select("id, full_name, role")
    .eq("is_active", true)
  const rows = (data ?? []) as TeamMatch[]
  const norm = (s: string) => s.trim().toLowerCase()
  return (
    rows.find((r) => norm(r.full_name) === target) ??
    rows.find((r) => norm(r.full_name).split(/\s+/)[0] === target) ??
    rows.find((r) => norm(r.full_name).startsWith(target)) ??
    rows.find((r) => norm(r.full_name).includes(target)) ??
    null
  )
}

/** Find a lead by email (if given) else by case-insensitive full name, taking
 *  the most recent match; create one when nothing exists. */
async function findOrCreateLead(
  supabase: SupabaseClient,
  name: string,
  email: string | null | undefined,
  source: string | null | undefined
): Promise<{ id: string } | null> {
  if (email) {
    const { data } = await supabase.from("leads").select("id").eq("email", email).maybeSingle()
    if (data) return data as { id: string }
  }
  const { data: byName } = await supabase
    .from("leads")
    .select("id")
    .ilike("full_name", name)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (byName) return byName as { id: string }

  const insertRow: Record<string, unknown> = { full_name: name, stage: "new", source: source ?? "deal_log" }
  if (email) insertRow.email = email
  const { data: created, error } = await supabase
    .from("leads")
    .insert(insertRow)
    .select("id")
    .single()
  if (error || !created) return null
  return created as { id: string }
}

function parseDealDate(value: string | null | undefined): string {
  if (value) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

export async function applyDeal(supabase: SupabaseClient, body: DealInput): Promise<HandlerResult> {
  if (!body.deal_ref) {
    return { status: 400, body: { error: "deal_ref is required (a stable id for the sheet row)" } }
  }
  if (!body.lead_name) {
    return { status: 400, body: { error: "lead_name is required" } }
  }
  if (body.amount_cents == null || body.amount_cents < 0) {
    return { status: 400, body: { error: "deal value (amount) is required" } }
  }

  const status = (body.status ?? "").toLowerCase()
  const isRefunded = status.includes("refund")
  // "Paid" (or a refunded row, which was paid then refunded) means cash moved;
  // anything else (pending / unpaid / deposit-only) logs the deal without a
  // payment, so it counts toward Order Value but not Cash Collected yet.
  const paidNow = status.includes("paid") || isRefunded
  const currency = (body.currency ?? "USD").toUpperCase()
  const closedAt = parseDealDate(body.deal_date)
  const dealRef = `sheet:${body.deal_ref}`
  const paymentRef = `${dealRef}:p1`

  const closer = await resolveTeamMemberByName(supabase, body.closer_name)
  const setter = await resolveTeamMemberByName(supabase, body.setter_name)

  const lead = await findOrCreateLead(supabase, body.lead_name, body.email, body.source)
  if (!lead) {
    await logIntegration(supabase, {
      provider: "public_api",
      direction: "inbound",
      event_type: "deal.logged",
      status: "failed",
      request_payload: body as never,
      error: "Could not find or create the lead",
    })
    return { status: 500, body: { error: "Could not find or create the lead" } }
  }

  // Stamp attribution + stage on the lead so the funnel + setter commission line
  // up. Only set what we resolved; never clobber a real assignment with a blank.
  const leadPatch: Record<string, unknown> = {}
  if (closer) leadPatch.closer_id = closer.id
  if (setter) leadPatch.setter_id = setter.id
  if (paidNow && !isRefunded) leadPatch.stage = "won"
  if (Object.keys(leadPatch).length) {
    await supabase.from("leads").update(leadPatch).eq("id", lead.id)
  }

  const noteBits = [
    "Synced from Deal & Comms tracker",
    body.plan_type ? `Plan: ${body.plan_type}` : null,
    body.source ? `Source: ${body.source}` : null,
    closer ? null : body.closer_name ? `⚠ unmatched closer "${body.closer_name}"` : null,
    setter ? null : body.setter_name ? `⚠ unmatched setter "${body.setter_name}"` : null,
  ].filter(Boolean)

  const dealRow: Record<string, unknown> = {
    lead_id: lead.id,
    program: body.offer ?? "Deal",
    amount_cents: body.amount_cents,
    currency,
    status: isRefunded ? "refunded" : "won",
    closed_at: closedAt,
    closed_by_id: closer?.id ?? null,
    notes: noteBits.join(" · "),
    stripe_payment_intent_id: dealRef,
  }

  const { data: existingDeal } = await supabase
    .from("deals")
    .select("id")
    .eq("stripe_payment_intent_id", dealRef)
    .maybeSingle()

  let dealId: string
  if (existingDeal) {
    dealId = (existingDeal as { id: string }).id
    await supabase.from("deals").update(dealRow).eq("id", dealId)
  } else {
    const { data: created, error } = await supabase.from("deals").insert(dealRow).select("id").single()
    if (error || !created) {
      await logIntegration(supabase, {
        provider: "public_api",
        direction: "inbound",
        event_type: "deal.logged",
        status: "failed",
        request_payload: body as never,
        error: error?.message ?? "deal insert failed",
        related_lead_id: lead.id,
      })
      return { status: 500, body: { error: error?.message ?? "deal insert failed" } }
    }
    dealId = (created as { id: string }).id
  }

  // Payment — only when there's cash and a positive amount. The unique
  // stripe_charge_id makes it idempotent; on re-sync we reconcile amount +
  // refund flag (the clawback trigger handles a Paid→Refunded flip on update).
  let paymentId: string | null = null
  if (paidNow && body.amount_cents > 0) {
    const { data: existingPay } = await supabase
      .from("payments")
      .select("id")
      .eq("stripe_charge_id", paymentRef)
      .maybeSingle()
    if (existingPay) {
      paymentId = (existingPay as { id: string }).id
      await supabase
        .from("payments")
        .update({ amount_cents: body.amount_cents, currency, paid_at: closedAt, is_refund: isRefunded })
        .eq("id", paymentId)
    } else {
      const { data: pay, error: payErr } = await supabase
        .from("payments")
        .insert({
          lead_id: lead.id,
          deal_id: dealId,
          amount_cents: body.amount_cents,
          currency,
          paid_at: closedAt,
          stripe_charge_id: paymentRef,
          source: "import",
          is_refund: isRefunded,
        })
        .select("id")
        .single()
      if (payErr) {
        console.error("[booking.applyDeal] payment insert failed", payErr)
      } else {
        paymentId = (pay as { id: string } | null)?.id ?? null
      }
    }
  }

  const unmatched: string[] = []
  if (body.closer_name && !closer) unmatched.push(`closer:${body.closer_name}`)
  if (body.setter_name && !setter) unmatched.push(`setter:${body.setter_name}`)

  await logIntegration(supabase, {
    provider: "public_api",
    direction: "inbound",
    event_type: "deal.logged",
    status: "success",
    request_payload: body as never,
    related_lead_id: lead.id,
    error: unmatched.length ? `Unmatched team names — ${unmatched.join(", ")}` : undefined,
  })

  return {
    status: 200,
    body: {
      ok: true,
      deal_id: dealId,
      payment_id: paymentId,
      lead_id: lead.id,
      deduped: Boolean(existingDeal),
      closer_matched: Boolean(closer),
      setter_matched: Boolean(setter),
      unmatched: unmatched.length ? unmatched : undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// Call booked — reschedule-safe, idempotent, Slack to #bookings.
// ---------------------------------------------------------------------------

export async function applyBooked(supabase: SupabaseClient, n: BookingInput): Promise<HandlerResult> {
  // Email is the lead key. Missing = misconfigured mapping → fail loudly so it
  // doesn't silently create duplicate null-email leads.
  if (!n.email) {
    await logIntegration(supabase, {
      provider: "public_api",
      direction: "inbound",
      event_type: "call.booked",
      status: "failed",
      request_payload: n.rawPayload as never,
      error: "Booking is missing an email — map the invitee email to the `email` field.",
    })
    return { status: 400, body: { ok: false, error: "Missing `email`. Map the invitee email to the `email` field." } }
  }

  const deduped = await alreadyProcessed(supabase, "call.booked", n.eventId)
  if (deduped) return { status: 200, body: { ok: true, deduped: true, event: "booked" } }

  let closerId: string | null = null
  let closerFullName: string | null = null
  let closerSlackId: string | null = null
  let closerTimezone: string | null = null
  if (n.closerEmail) {
    const { data } = await supabase
      .from("team_members")
      .select("id, full_name, slack_user_id, timezone")
      .eq("email", n.closerEmail)
      .eq("is_active", true)
      .in("role", ["closer", "admin"])
      .maybeSingle()
    closerId = data?.id ?? null
    closerFullName = data?.full_name ?? null
    closerSlackId = data?.slack_user_id ?? null
    closerTimezone = data?.timezone ?? null
  }

  const row: Record<string, unknown> = {
    email: n.email,
    full_name: n.name ?? "Unknown",
    stage: "booked",
    source: n.source,
    booked_at: new Date().toISOString(),
  }
  if (n.phone) row.phone = n.phone
  if (n.timezone) row.timezone = n.timezone
  if (closerId) row.closer_id = closerId
  if (n.scheduledFor) row.scheduled_at = n.scheduledFor
  if (n.cancelUrl) row.calendly_cancel_url = n.cancelUrl
  if (n.rescheduleUrl) row.calendly_reschedule_url = n.rescheduleUrl
  if (n.eventId) row.calendly_event_id = n.eventId
  if (n.eventName) row.calendly_event_name = n.eventName
  if (n.joinUrl) row.calendly_join_url = n.joinUrl
  if (n.utm.utm_source) row.utm_source = n.utm.utm_source
  if (n.utm.utm_medium) row.utm_medium = n.utm.utm_medium
  if (n.utm.utm_campaign) row.utm_campaign = n.utm.utm_campaign
  if (n.utm.utm_content) row.utm_content = n.utm.utm_content
  if (n.utm.utm_term) row.utm_term = n.utm.utm_term

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .upsert(row, { onConflict: "email" })
    .select("id")
    .single()

  if (leadErr || !lead) {
    await logIntegration(supabase, {
      provider: "public_api",
      direction: "inbound",
      event_type: "call.booked",
      status: "failed",
      request_payload: withEventId(n.rawPayload, n.eventId),
      error: leadErr?.message ?? "Unknown lead upsert failure",
    })
    return { status: 500, body: { ok: false, error: leadErr?.message ?? "Lead upsert failed" } }
  }

  if (n.scheduledFor) {
    try {
      await supabase
        .from("reminders")
        .update({ status: "cancelled" })
        .eq("lead_id", lead.id)
        .eq("status", "scheduled")
      const fireAt = new Date(new Date(n.scheduledFor).getTime() - 15 * 60 * 1000).toISOString()
      const { error: remErr } = await supabase.from("reminders").insert({
        lead_id: lead.id,
        team_member_id: closerId,
        kind: "pre_call_15m",
        fire_at: fireAt,
        payload: { scheduled_for: n.scheduledFor },
      })
      if (remErr) console.error("[booking.applyBooked] reminder insert failed", remErr)
    } catch (e) {
      console.error("[booking.applyBooked] reminder scheduling threw", e)
    }
  }

  await supabase
    .from("activities")
    .insert({ lead_id: lead.id, type: "calendly.invitee.created", payload: n.rawPayload as never })

  await logIntegration(supabase, {
    provider: "public_api",
    direction: "inbound",
    event_type: "call.booked",
    status: "success",
    request_payload: withEventId(n.rawPayload, n.eventId),
    related_lead_id: lead.id,
  })

  try {
    await dispatchEvent(supabase, {
      event_type: "call.booked",
      data: {
        lead: { id: lead.id, full_name: n.name, email: n.email, timezone: n.timezone },
        booking: { scheduled_for: n.scheduledFor, closer_email: n.closerEmail, closer_id: closerId },
        attribution: { ...n.utm },
        via: "inbound_api",
      },
    })
  } catch (e) {
    console.error("[booking.applyBooked] dispatch failed", e)
  }

  try {
    await maybePostBookingSlack(supabase, {
      kind: "created",
      lead: { id: lead.id, full_name: n.name ?? "Unknown", email: n.email, phone: n.phone, instagram: null },
      scheduledFor: n.scheduledFor,
      closerName: closerFullName,
      closerSlackId,
      closerTimezone,
      eventName: n.eventName,
      joinUrl: n.joinUrl,
      cancelUrl: n.cancelUrl,
      rescheduleUrl: n.rescheduleUrl,
      attribution: n.utm,
    })
  } catch (e) {
    console.error("[booking.applyBooked] Slack failed", e)
  }

  return { status: 200, body: { ok: true, event: "booked", lead_id: lead.id } }
}

// ---------------------------------------------------------------------------
// Call cancelled — only downgrades the lead when the cancel targets its CURRENT
// booking (reschedule-safe). Slack to #cancellations.
// ---------------------------------------------------------------------------

export async function applyCancelled(supabase: SupabaseClient, n: BookingInput): Promise<HandlerResult> {
  if (!n.email) {
    await logIntegration(supabase, {
      provider: "public_api",
      direction: "inbound",
      event_type: "call.cancelled",
      status: "success",
      request_payload: n.rawPayload as never,
      error: "Cancel had no email — nothing to apply.",
    })
    return { status: 200, body: { ok: true, event: "cancelled", applied: false, reason: "no email" } }
  }

  const deduped = await alreadyProcessed(supabase, "call.cancelled", n.eventId)
  if (deduped) return { status: 200, body: { ok: true, deduped: true, event: "cancelled" } }

  const cancelledAt = n.cancelledAt ?? new Date().toISOString()

  const { data: lead } = await supabase
    .from("leads")
    .select("id, calendly_event_id")
    .eq("email", n.email)
    .maybeSingle()

  if (!lead) {
    await logIntegration(supabase, {
      provider: "public_api",
      direction: "inbound",
      event_type: "call.cancelled",
      status: "success",
      request_payload: withEventId(n.rawPayload, n.eventId),
      error: "No matching lead for cancelled email — logged only.",
    })
    return { status: 200, body: { ok: true, event: "cancelled", applied: false, reason: "no matching lead" } }
  }

  const leadId = lead.id as string
  const currentEventUri = (lead as { calendly_event_id: string | null }).calendly_event_id
  const superseded =
    n.rescheduled ||
    Boolean(n.newEventId) ||
    (n.eventId != null && currentEventUri != null && n.eventId !== currentEventUri)
  const cancelIsCurrent = !superseded

  await supabase.from("activities").insert({
    lead_id: leadId,
    type: "calendly.invitee.canceled",
    payload: n.rawPayload as never,
    created_at: cancelledAt,
  })

  if (cancelIsCurrent) {
    await supabase.from("leads").update({ stage: "cancelled", cancelled_at: cancelledAt }).eq("id", leadId)
    await supabase
      .from("reminders")
      .update({ status: "cancelled" })
      .eq("lead_id", leadId)
      .eq("status", "scheduled")
  }

  await logIntegration(supabase, {
    provider: "public_api",
    direction: "inbound",
    event_type: "call.cancelled",
    status: "success",
    request_payload: withEventId(n.rawPayload, n.eventId),
    related_lead_id: leadId,
    error: cancelIsCurrent
      ? undefined
      : "Superseded by a newer booking (reschedule) — logged + notified, lead status kept.",
  })

  try {
    await dispatchEvent(supabase, {
      event_type: "call.cancelled",
      data: {
        lead: { id: leadId, email: n.email, full_name: n.name },
        cancel_url: n.cancelUrl,
        reason: n.cancelReason,
        superseded: !cancelIsCurrent,
        via: "inbound_api",
      },
    })
  } catch (e) {
    console.error("[booking.applyCancelled] dispatch failed", e)
  }

  try {
    const { data: l } = await supabase
      .from("leads")
      .select(
        "scheduled_at, phone, instagram, calendly_event_name, calendly_reschedule_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, closer:team_members!leads_closer_id_fkey(full_name, slack_user_id, timezone)"
      )
      .eq("id", leadId)
      .maybeSingle()
    const ll = (l ?? {}) as {
      scheduled_at?: string | null
      phone?: string | null
      instagram?: string | null
      calendly_event_name?: string | null
      calendly_reschedule_url?: string | null
      utm_source?: string | null
      utm_medium?: string | null
      utm_campaign?: string | null
      utm_content?: string | null
      utm_term?: string | null
      closer?: { full_name?: string; slack_user_id?: string | null; timezone?: string | null } | null
    }
    await maybePostBookingSlack(supabase, {
      kind: "cancelled",
      lead: {
        id: leadId,
        full_name: n.name ?? "Unknown",
        email: n.email,
        phone: ll.phone ?? n.phone,
        instagram: ll.instagram ?? null,
      },
      scheduledFor: n.scheduledFor ?? ll.scheduled_at ?? null,
      closerName: ll.closer?.full_name ?? null,
      closerSlackId: ll.closer?.slack_user_id ?? null,
      closerTimezone: ll.closer?.timezone ?? null,
      eventName: n.eventName ?? ll.calendly_event_name ?? null,
      cancelUrl: n.cancelUrl,
      rescheduleUrl: n.rescheduleUrl ?? ll.calendly_reschedule_url ?? null,
      attribution: {
        utm_source: ll.utm_source ?? null,
        utm_medium: ll.utm_medium ?? null,
        utm_campaign: ll.utm_campaign ?? null,
        utm_content: ll.utm_content ?? null,
        utm_term: ll.utm_term ?? null,
      },
    })
  } catch (e) {
    console.error("[booking.applyCancelled] Slack failed", e)
  }

  return { status: 200, body: { ok: true, event: "cancelled", applied: cancelIsCurrent, lead_id: leadId } }
}

// ---------------------------------------------------------------------------
// Idempotency — Zapier (and retries) can replay a task. If we already logged a
// success for this (event_type, event_id), skip. Best-effort.
// ---------------------------------------------------------------------------

async function alreadyProcessed(
  supabase: SupabaseClient,
  eventType: string,
  eventId: string | null
): Promise<boolean> {
  if (!eventId) return false
  try {
    const { data } = await supabase
      .from("integrations_log")
      .select("id")
      .eq("provider", "public_api")
      .eq("event_type", eventType)
      .eq("status", "success")
      .filter("request_payload->>event_id", "eq", eventId)
      .limit(1)
      .maybeSingle()
    return Boolean(data)
  } catch (_e) {
    return false
  }
}

/** Stamp the normalized event_id at the top level of the logged payload so the
 *  idempotency lookup (request_payload->>event_id) is reliable. */
function withEventId(rawPayload: unknown, eventId: string | null): Record<string, unknown> {
  const base = rawPayload && typeof rawPayload === "object" ? (rawPayload as Bag) : { raw: rawPayload }
  return { ...base, event_id: eventId }
}

// ---------------------------------------------------------------------------
// Slack — identical look to the bookings/cancellations channel posts. Gated by
// the new_call_booked / call_cancelled toggles; routed to the configured
// bookings / cancellations channels.
// ---------------------------------------------------------------------------

interface BookingSlackArgs {
  kind: "created" | "cancelled"
  lead: { id: string | null; full_name: string; email: string | null; phone: string | null; instagram: string | null }
  scheduledFor: string | null
  closerName: string | null
  closerSlackId: string | null
  closerTimezone: string | null
  eventName?: string | null
  joinUrl?: string | null
  cancelUrl?: string | null
  rescheduleUrl?: string | null
  attribution?: Utm
}

async function maybePostBookingSlack(supabase: SupabaseClient, args: BookingSlackArgs) {
  const settingKey = args.kind === "created" ? "new_call_booked" : "call_cancelled"
  const { data: setting } = await supabase
    .from("automation_settings")
    .select("enabled")
    .eq("key", settingKey)
    .maybeSingle()
  if (setting && setting.enabled === false) return

  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhookUrl =
    args.kind === "cancelled"
      ? slackConfig?.cancellations_webhook_url || slackConfig?.bookings_webhook_url
      : slackConfig?.bookings_webhook_url
  if (!webhookUrl) return

  const closerLine = args.closerName ? slackMention(args.closerSlackId) ?? `*${args.closerName}*` : "_Unassigned_"
  const message =
    args.kind === "created" ? buildCreatedMessage(args, closerLine) : buildCancelledMessage(args, closerLine)

  const result = await postToSlack(webhookUrl, message)
  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: args.kind === "created" ? "slack.call_booked" : "slack.call_cancelled",
    status: result.ok ? "success" : "failed",
    request_payload: { lead_email: args.lead.email, via: "inbound_api" } as never,
    response_payload: { status: result.status, body: result.body } as never,
    error: result.error,
    related_lead_id: args.lead.id,
  })
}

function buildCreatedMessage(args: BookingSlackArgs, closerLine: string) {
  const firstName = args.lead.full_name.split(" ")[0] || args.lead.full_name
  const whenLine = formatShortLocalTime(args.scheduledFor, args.closerTimezone)
  const sourceLine = formatAttribution(args.attribution) || "—"
  const phoneFmt = args.lead.phone ? formatPhone(args.lead.phone) : "—"

  const fields = [
    { type: "mrkdwn", text: `*When:*\n${whenLine}` },
    { type: "mrkdwn", text: `*Closer:*\n${closerLine}` },
    { type: "mrkdwn", text: `*Email:*\n${args.lead.email ?? "—"}` },
    { type: "mrkdwn", text: `*Phone:*\n${phoneFmt}` },
  ]

  const actions: Record<string, unknown>[] = []
  if (args.lead.phone) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "📱  WhatsApp (pre-call SOP)", emoji: true },
      url: whatsappUrl(args.lead.phone, buildPreCallTemplate(args, firstName)),
      style: "primary",
    })
  }
  if (args.joinUrl) actions.push({ type: "button", text: { type: "plain_text", text: "Join call" }, url: args.joinUrl })
  if (args.rescheduleUrl)
    actions.push({ type: "button", text: { type: "plain_text", text: "Reschedule" }, url: args.rescheduleUrl })
  if (args.lead.email)
    actions.push({ type: "button", text: { type: "plain_text", text: "Email" }, url: `mailto:${args.lead.email}` })
  if (args.lead.id)
    actions.push({ type: "button", text: { type: "plain_text", text: "Open in CRM" }, url: leadDeepLink(args.lead.id) })

  const closerMentionTag = slackMention(args.closerSlackId)
  const blocks: Record<string, unknown>[] = []
  if (closerMentionTag) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `${closerMentionTag} — you've got a new call 📅` } })
  }
  blocks.push(
    { type: "section", text: { type: "mrkdwn", text: `📅  *Call booked · ${firstName}*` } },
    { type: "section", fields }
  )
  if (actions.length > 0) blocks.push({ type: "actions", elements: actions.slice(0, 5) })
  if (args.eventName) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `_${args.eventName}_` }] })
  if (sourceLine !== "—")
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `🧭  *Attribution:* ${sourceLine}` }] })

  return { text: `Call booked · ${args.lead.full_name} — ${whenLine}`, blocks }
}

function buildCancelledMessage(args: BookingSlackArgs, closerLine: string) {
  const firstName = args.lead.full_name.split(" ")[0] || args.lead.full_name
  const wasScheduled = formatShortLocalTime(args.scheduledFor, args.closerTimezone)
  const phoneFmt = args.lead.phone ? formatPhone(args.lead.phone) : "—"
  const closerMentionTag = slackMention(args.closerSlackId)

  const fields = [
    { type: "mrkdwn", text: `*Was scheduled:*\n${wasScheduled}` },
    { type: "mrkdwn", text: `*Closer:*\n${closerLine}` },
    { type: "mrkdwn", text: `*Email:*\n${args.lead.email ?? "—"}` },
    { type: "mrkdwn", text: `*Phone:*\n${phoneFmt}` },
  ]

  const blocks: Record<string, unknown>[] = []
  if (closerMentionTag) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `${closerMentionTag} — heads up, your call was cancelled ❌` },
    })
  }
  blocks.push(
    { type: "section", text: { type: "mrkdwn", text: `❌  *Call cancelled · ${firstName}*` } },
    { type: "section", fields }
  )

  const actions: Record<string, unknown>[] = []
  if (args.lead.phone) {
    const message = `Hi ${firstName}, sorry we missed each other. Want to reschedule for another time that works for you?`
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "📱  WhatsApp follow-up", emoji: true },
      url: whatsappUrl(args.lead.phone, message),
      style: "primary",
    })
  }
  if (args.lead.email)
    actions.push({ type: "button", text: { type: "plain_text", text: "Email" }, url: `mailto:${args.lead.email}` })
  if (args.lead.id)
    actions.push({ type: "button", text: { type: "plain_text", text: "Open in CRM" }, url: leadDeepLink(args.lead.id) })
  if (actions.length > 0) blocks.push({ type: "actions", elements: actions.slice(0, 5) })

  if (args.eventName) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `_${args.eventName}_` }] })
  const sourceLine = formatAttribution(args.attribution)
  if (sourceLine) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `🧭  *Attribution:* ${sourceLine}` }] })

  return { text: `Call cancelled · ${args.lead.full_name} (was ${wasScheduled})`, blocks }
}

function formatShortLocalTime(iso: string | null, timezone: string | null | undefined): string {
  if (!iso) return "—"
  const tz = timezone ?? "UTC"
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value])) as Record<
    string,
    string
  >
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} (${tz})`
}

function formatAttribution(attr?: Utm): string {
  if (!attr) return ""
  return [attr.utm_source, attr.utm_campaign, attr.utm_content, attr.utm_medium]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(" · ")
}

function formatPhone(phone: string): string {
  const cleaned = phone.trim()
  const m = cleaned.match(/^(\+\d{1,3})\s*(\d.*)$/)
  return m ? `${m[1]} ${m[2].replace(/\s+/g, "")}` : cleaned
}

function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(message)}`
}

function buildPreCallTemplate(args: BookingSlackArgs, firstName: string): string {
  const closerFirst = args.closerName?.split(" ")[0] ?? "the team"
  const when = formatShortLocalTime(args.scheduledFor, args.closerTimezone)
  return `Hi ${firstName} 👋 It's ${closerFirst} from EcomPulse. Just confirming our call: ${when}. To make the most of it, can you share what your current situation looks like and what 'a great call' would mean for you?`
}
