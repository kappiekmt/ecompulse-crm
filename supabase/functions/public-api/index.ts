// Public REST API for the EcomPulse CRM.
// Authenticated by an API key issued in the CRM (Integrations → API Keys).
//
// Endpoint base:  https://<project-ref>.functions.supabase.co/public-api
//   (or, branded: https://coaching.joinecompulse.com/api/inbound)
// Auth header:    Authorization: Bearer <api-key>
//
// Routes:
//   POST /lead     → create a lead              (scope: lead.create)
//   POST /payment  → log a payment              (scope: payment.create)
//   POST /event    → UNIVERSAL inbound router   (scope depends on `event`)
//                    Body: { "event": "lead" | "booked" | "cancelled" | "payment", ... }
//                    One URL + one key for every automation — set `event` per Zap.
//
// All four behaviours live in ../_shared/booking.ts so /lead, /payment and
// /event share one implementation. Adding a new automation = one new case here.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"
import {
  applyBooked,
  applyCancelled,
  applyLead,
  applyPayment,
  classifyEvent,
  type LeadInput,
  lowerKeyed,
  type PaymentInput,
  toBookingInput,
  toLeadInput,
  toPaymentInput,
} from "../_shared/booking.ts"

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
}

async function authenticate(req: Request, requiredScope: string): Promise<{ keyId: string } | Response> {
  const supabase = adminClient()
  const auth = req.headers.get("authorization") ?? ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) {
    return jsonResponse({ error: "Missing bearer token" }, { status: 401 })
  }
  const plaintext = m[1].trim()

  const { data, error } = await supabase.rpc("verify_api_key", {
    plaintext,
    required_scope: requiredScope,
  })

  if (error || !data) {
    await logIntegration(supabase, {
      provider: "public_api",
      direction: "inbound",
      event_type: "auth_failed",
      status: "failed",
      error: error?.message ?? "Invalid or revoked API key",
    })
    return jsonResponse({ error: "Invalid or revoked API key" }, { status: 401 })
  }

  return { keyId: data as unknown as string }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/public-api/, "")

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 })
  }

  const supabase = adminClient()

  // POST /lead — generic lead intake (landing pages, ad lead-forms, partners).
  if (path === "/lead") {
    const auth = await authenticate(req, "lead.create")
    if (auth instanceof Response) return auth
    let body: LeadInput
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
    }
    const r = await applyLead(supabase, body)
    return jsonResponse(r.body, { status: r.status })
  }

  // POST /payment — log a payment.
  if (path === "/payment") {
    const auth = await authenticate(req, "payment.create")
    if (auth instanceof Response) return auth
    let body: PaymentInput
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
    }
    const r = await applyPayment(supabase, body)
    return jsonResponse(r.body, { status: r.status })
  }

  // POST /event — UNIVERSAL inbound router. One URL + one API key for every
  // automation: the `event` field ("lead" | "booked" | "cancelled" | "payment")
  // selects the handler, and the field mapping is forgiving (case-insensitive,
  // many aliases). Scope follows the event — payments need payment.create,
  // everything else needs lead.create. Add a new automation = one new case.
  if (path === "/event") {
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
    }
    const bag = lowerKeyed(raw)
    const event = classifyEvent(bag)
    if (!event) {
      return jsonResponse(
        {
          error:
            'Could not determine the event. Add an "event" field set to "lead", "booked", "cancelled", or "payment".',
        },
        { status: 400 }
      )
    }

    const auth = await authenticate(req, event === "payment" ? "payment.create" : "lead.create")
    if (auth instanceof Response) return auth

    const result =
      event === "lead"
        ? await applyLead(supabase, toLeadInput(bag))
        : event === "booked"
          ? await applyBooked(supabase, toBookingInput(bag, raw))
          : event === "cancelled"
            ? await applyCancelled(supabase, toBookingInput(bag, raw))
            : await applyPayment(supabase, toPaymentInput(bag))

    return jsonResponse(result.body, { status: result.status })
  }

  return jsonResponse({ error: "Unknown route" }, { status: 404 })
})
