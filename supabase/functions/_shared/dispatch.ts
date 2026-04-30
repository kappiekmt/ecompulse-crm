// Outbound webhook dispatcher.
//
// Given an event_type + data payload, fans out to all active subscriptions
// whose event_types include this event. Each delivery is HMAC-signed (when
// the subscription has a signing_secret) and logged to webhook_deliveries
// regardless of outcome.
//
// Fire-and-await: callers can `await dispatchEvent(...)` to be sure the
// delivery was attempted before returning their response. Individual POSTs
// have a 10s timeout so a slow subscriber never blocks the whole request.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

interface Subscription {
  id: string
  target_url: string
  signing_secret: string | null
}

interface DispatchArgs {
  event_type: string
  data: Record<string, unknown>
}

const TIMEOUT_MS = 10_000

export async function dispatchEvent(
  client: SupabaseClient,
  args: DispatchArgs
): Promise<void> {
  const { data: subs, error } = await client
    .from("webhook_subscriptions")
    .select("id, target_url, signing_secret")
    .eq("is_active", true)
    .contains("event_types", [args.event_type])

  if (error) {
    console.error("[dispatch] subscription lookup failed", error)
    return
  }
  if (!subs?.length) return

  const event_id = crypto.randomUUID()
  const occurred_at = new Date().toISOString()
  const body = {
    event: args.event_type,
    event_id,
    occurred_at,
    data: args.data,
  }
  const bodyStr = JSON.stringify(body)

  await Promise.allSettled(
    subs.map((sub) => deliver(client, sub as Subscription, args.event_type, event_id, bodyStr, body))
  )
}

async function deliver(
  client: SupabaseClient,
  sub: Subscription,
  event_type: string,
  event_id: string,
  bodyStr: string,
  body: Record<string, unknown>
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "EcomPulse-CRM/1.0",
    "X-Ecompulse-Event": event_type,
    "X-Ecompulse-Event-Id": event_id,
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
    const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(sub.target_url, {
        method: "POST",
        headers,
        body: bodyStr,
        signal: ctrl.signal,
      })
      responseStatus = res.status
      try {
        responseBody = (await res.text()).slice(0, 500)
      } catch {
        responseBody = ""
      }
      status = res.ok ? "success" : "failed"
      if (!res.ok) errorMsg = `Subscriber returned ${res.status}`
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    const e = err as Error
    errorMsg = e.name === "AbortError" ? `Timed out after ${TIMEOUT_MS}ms` : e.message
  }

  await client.from("webhook_deliveries").insert({
    subscription_id: sub.id,
    event_type,
    event_id,
    payload: body,
    status,
    attempts: 1,
    response_status: responseStatus,
    response_body_preview: responseBody,
    error: errorMsg,
    delivered_at: status === "success" ? new Date().toISOString() : null,
  })
}

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
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
