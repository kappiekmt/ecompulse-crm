// Calendly webhook receiver.
// Configure in Calendly: https://calendly.com/integrations/api_webhooks
// Subscribe to: invitee.created, invitee.canceled
// Endpoint: https://<project>.functions.supabase.co/calendly-webhook
//
// Set Function secrets:
//   supabase secrets set CALENDLY_SIGNING_KEY=<from Calendly>

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"

interface CalendlyEvent {
  event: string // "invitee.created" | "invitee.canceled"
  payload: {
    name?: string
    email?: string
    timezone?: string
    text_reminder_number?: string
    scheduled_event?: {
      start_time?: string
      end_time?: string
      location?: { type?: string; location?: string }
      event_memberships?: { user_email?: string; user_name?: string }[]
    }
    tracking?: {
      utm_source?: string
      utm_medium?: string
      utm_campaign?: string
      utm_content?: string
      utm_term?: string
    }
    cancel_url?: string
    questions_and_answers?: { question: string; answer: string }[]
  }
}

async function verifySignature(req: Request, body: string): Promise<boolean> {
  const signingKey = Deno.env.get("CALENDLY_SIGNING_KEY")
  if (!signingKey) return true // dev fallback; never deploy without setting this
  const header = req.headers.get("calendly-webhook-signature")
  if (!header) return false
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=")))
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return false
  const data = `${t}.${body}`
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data))
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return hex === v1
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  const supabase = adminClient()
  const body = await req.text()

  if (!(await verifySignature(req, body))) {
    await logIntegration(supabase, {
      provider: "calendly",
      direction: "inbound",
      event_type: "signature_invalid",
      status: "failed",
      request_payload: body.slice(0, 1000),
      error: "Signature verification failed",
    })
    return new Response("Invalid signature", { status: 401, headers: corsHeaders })
  }

  let evt: CalendlyEvent
  try {
    evt = JSON.parse(body)
  } catch (e) {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders })
  }

  if (evt.event === "invitee.created") {
    const p = evt.payload
    const closerEmail = p.scheduled_event?.event_memberships?.[0]?.user_email ?? null
    const utm = p.tracking ?? {}
    const scheduledFor = p.scheduled_event?.start_time ?? null

    let closerId: string | null = null
    if (closerEmail) {
      const { data } = await supabase
        .from("team_members")
        .select("id")
        .eq("email", closerEmail)
        .eq("role", "closer")
        .maybeSingle()
      closerId = data?.id ?? null
    }

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .upsert(
        {
          full_name: p.name ?? "Unknown",
          email: p.email ?? null,
          timezone: p.timezone ?? null,
          stage: "booked",
          closer_id: closerId,
          utm_source: utm.utm_source ?? null,
          utm_medium: utm.utm_medium ?? null,
          utm_campaign: utm.utm_campaign ?? null,
          utm_content: utm.utm_content ?? null,
          utm_term: utm.utm_term ?? null,
        },
        { onConflict: "email" }
      )
      .select("id")
      .single()

    if (leadErr || !lead) {
      await logIntegration(supabase, {
        provider: "calendly",
        direction: "inbound",
        event_type: evt.event,
        status: "failed",
        request_payload: evt,
        error: leadErr?.message ?? "Unknown lead upsert failure",
      })
      return new Response("Lead upsert failed", { status: 500, headers: corsHeaders })
    }

    if (scheduledFor) {
      const fireAt = new Date(new Date(scheduledFor).getTime() - 15 * 60 * 1000).toISOString()
      await supabase.from("reminders").insert({
        lead_id: lead.id,
        team_member_id: closerId,
        kind: "pre_call_15m",
        fire_at: fireAt,
        payload: { scheduled_for: scheduledFor },
      })
    }

    await supabase.from("activities").insert({
      lead_id: lead.id,
      type: "calendly.invitee.created",
      payload: evt.payload as never,
    })

    await logIntegration(supabase, {
      provider: "calendly",
      direction: "inbound",
      event_type: evt.event,
      status: "success",
      request_payload: evt,
      related_lead_id: lead.id,
    })

    return new Response(JSON.stringify({ ok: true, lead_id: lead.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (evt.event === "invitee.canceled") {
    const p = evt.payload
    if (p.email) {
      const { data: lead } = await supabase
        .from("leads")
        .select("id")
        .eq("email", p.email)
        .maybeSingle()
      if (lead) {
        await supabase.from("activities").insert({
          lead_id: lead.id,
          type: "calendly.invitee.canceled",
          payload: evt.payload as never,
        })
        await supabase.from("reminders")
          .update({ status: "cancelled" })
          .eq("lead_id", lead.id)
          .eq("status", "scheduled")
      }
    }
    await logIntegration(supabase, {
      provider: "calendly",
      direction: "inbound",
      event_type: evt.event,
      status: "success",
      request_payload: evt,
    })
    return new Response("ok", { headers: corsHeaders })
  }

  return new Response("Ignored", { status: 200, headers: corsHeaders })
})
