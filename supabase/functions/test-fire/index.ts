// POST /test-fire { subscription_id, event_type? }
//
// Admin-only. Sends a synthetic event to a specific webhook subscription so
// the user can verify their Zapier Catch Hook (or any URL) is set up
// correctly without waiting for a real lead/payment to come through.
//
// Uses the caller's JWT (verified by Supabase gateway) so RLS enforces
// admin-only access via the api_keys / team_members chain.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient } from "../_shared/supabase-admin.ts"

const SAMPLE_PAYLOADS: Record<string, Record<string, unknown>> = {
  "lead.created": {
    lead: {
      id: "00000000-0000-0000-0000-000000000001",
      full_name: "Sample Lead (test fire)",
      email: "sample@ecompulse.test",
      phone: null,
      instagram: "@sample_lead",
      stage: "new",
      source: "test_fire",
      tags: ["Hot"],
      utm_source: "test",
      utm_campaign: "verify_zap",
    },
  },
  "lead.updated": {
    lead: {
      id: "00000000-0000-0000-0000-000000000001",
      full_name: "Sample Lead (test fire)",
      stage: "booked",
    },
  },
  "call.booked": {
    lead: {
      id: "00000000-0000-0000-0000-000000000001",
      full_name: "Sample Lead",
      email: "sample@ecompulse.test",
      timezone: "Europe/Amsterdam",
    },
    booking: {
      scheduled_for: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      closer_email: "closer@example.com",
      closer_id: null,
    },
    attribution: { utm_source: "test", utm_campaign: "verify_zap" },
  },
  "call.cancelled": {
    lead: { email: "sample@ecompulse.test", full_name: "Sample Lead" },
    cancel_url: "https://calendly.com/cancellations/sample",
  },
  "payment.received": {
    lead_id: "00000000-0000-0000-0000-000000000001",
    email: "sample@ecompulse.test",
    amount_cents: 99700,
    currency: "EUR",
    source: "stripe",
    stripe_session_id: "cs_test_sample",
  },
  "payment.refunded": {
    stripe_charge_id: "ch_test_sample",
    stripe_payment_intent_id: "pi_test_sample",
    amount_refunded_cents: 99700,
    currency: "EUR",
  },
  "deal.won": {
    lead_id: "00000000-0000-0000-0000-000000000001",
    program: "EcomPulse Coaching",
    amount_cents: 99700,
    currency: "EUR",
  },
  "deal.lost": {
    lead_id: "00000000-0000-0000-0000-000000000001",
    reason: "price",
  },
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  // Caller is authenticated via JWT (verify_jwt = true on this function).
  // We use a per-request client bound to that JWT to enforce RLS.
  const auth = req.headers.get("authorization") ?? ""
  const url = Deno.env.get("SUPABASE_URL")
  const anon = Deno.env.get("SUPABASE_ANON_KEY")
  if (!url || !anon) return jsonResponse({ error: "Server misconfigured" }, { status: 500 })

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let body: { subscription_id?: string; event_type?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.subscription_id) {
    return jsonResponse({ error: "subscription_id is required" }, { status: 400 })
  }

  // RLS will block unless caller is admin.
  const { data: sub, error: subErr } = await userClient
    .from("webhook_subscriptions")
    .select("id, target_url, signing_secret, event_types")
    .eq("id", body.subscription_id)
    .maybeSingle()

  if (subErr) return jsonResponse({ error: subErr.message }, { status: 403 })
  if (!sub) return jsonResponse({ error: "Subscription not found or access denied" }, { status: 404 })

  const eventType = body.event_type ?? sub.event_types[0]
  const sample = SAMPLE_PAYLOADS[eventType] ?? { test: true }

  // Build the same envelope the real dispatcher uses.
  const event_id = `test_${crypto.randomUUID()}`
  const occurred_at = new Date().toISOString()
  const envelope = {
    event: eventType,
    event_id,
    occurred_at,
    test: true,
    data: sample,
  }
  const bodyStr = JSON.stringify(envelope)

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "EcomPulse-CRM/1.0 (test-fire)",
    "X-Ecompulse-Event": eventType,
    "X-Ecompulse-Event-Id": event_id,
    "X-Ecompulse-Test": "true",
    "X-Ecompulse-Delivery-Timestamp": String(Math.floor(Date.now() / 1000)),
  }

  if (sub.signing_secret) {
    const sig = await hmacSha256Hex(sub.signing_secret, bodyStr)
    headers["X-Ecompulse-Signature"] = `sha256=${sig}`
  }

  let status: "success" | "failed" = "failed"
  let responseStatus: number | null = null
  let responseBody = ""
  let errorMsg: string | null = null

  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 10_000)
    try {
      const res = await fetch(sub.target_url, {
        method: "POST",
        headers,
        body: bodyStr,
        signal: ctrl.signal,
      })
      responseStatus = res.status
      try { responseBody = (await res.text()).slice(0, 500) } catch { responseBody = "" }
      status = res.ok ? "success" : "failed"
      if (!res.ok) errorMsg = `Subscriber returned ${res.status}`
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    const e = err as Error
    errorMsg = e.name === "AbortError" ? "Timed out after 10s" : e.message
  }

  // Log via service role so we don't depend on the user's RLS for the insert.
  const admin = adminClient()
  await admin.from("webhook_deliveries").insert({
    subscription_id: sub.id,
    event_type: eventType,
    event_id,
    payload: envelope,
    status,
    attempts: 1,
    response_status: responseStatus,
    response_body_preview: responseBody,
    error: errorMsg,
    delivered_at: status === "success" ? new Date().toISOString() : null,
  })

  return jsonResponse({
    ok: status === "success",
    status: responseStatus,
    error: errorMsg,
    response_body_preview: responseBody.slice(0, 200),
  })
})

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")
}
