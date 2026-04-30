// Calendly webhook receiver.
// Configure in Calendly: https://calendly.com/integrations/api_webhooks
// Subscribe to: invitee.created, invitee.canceled
// Endpoint: https://<project>.functions.supabase.co/calendly-webhook
//
// Set Function secrets:
//   supabase secrets set CALENDLY_SIGNING_KEY=<from Calendly>

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, getIntegrationConfig, logIntegration } from "../_shared/supabase-admin.ts"
import { dispatchEvent } from "../_shared/dispatch.ts"
import {
  formatLocalTime,
  leadDeepLink,
  postToSlack,
  slackMention,
} from "../_shared/slack.ts"

interface CalendlyEvent {
  event: string // "invitee.created" | "invitee.canceled"
  payload: {
    name?: string
    email?: string
    timezone?: string
    text_reminder_number?: string
    uri?: string
    event?: string                    // event uri
    scheduled_event?: {
      uri?: string
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
    reschedule_url?: string
    cancellation?: {
      canceled_by?: string
      reason?: string
      created_at?: string
    }
    questions_and_answers?: { question: string; answer: string }[]
  }
}

async function verifySignature(
  req: Request,
  body: string,
  signingKey: string | null
): Promise<boolean> {
  if (!signingKey) return false // never accept unsigned events in production
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

  const config = await getIntegrationConfig(supabase, "calendly")
  const signingKey = config?.signing_key ?? null
  const signingDisabled = config?.signing_disabled === "true" || config?.signing_disabled === true

  if (signingDisabled) {
    // Calendly Standard tier doesn't issue signing keys. We accept the event
    // without HMAC verification — the URL is secret and we sanity-check the
    // payload shape later. Log every accepted unsigned event so admins can
    // audit what came through.
    await logIntegration(supabase, {
      provider: "calendly",
      direction: "inbound",
      event_type: "unsigned_accepted",
      status: "success",
      request_payload: body.slice(0, 1000),
      error: "Accepted without signature verification (signing_disabled=true)",
    })
  } else if (!(await verifySignature(req, body, signingKey))) {
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
    let closerFullName: string | null = null
    let closerSlackId: string | null = null
    let closerTimezone: string | null = null
    if (closerEmail) {
      const { data } = await supabase
        .from("team_members")
        .select("id, full_name, slack_user_id, timezone")
        .eq("email", closerEmail)
        .eq("role", "closer")
        .maybeSingle()
      closerId = data?.id ?? null
      closerFullName = data?.full_name ?? null
      closerSlackId = data?.slack_user_id ?? null
      closerTimezone = data?.timezone ?? null
    }

    const nowIso = new Date().toISOString()
    const row: Record<string, unknown> = {
      full_name: p.name ?? "Unknown",
      stage: "booked",
      source: "calendly",
      booked_at: nowIso,
    }
    if (p.email) row.email = p.email
    if (p.text_reminder_number) row.phone = p.text_reminder_number
    if (p.timezone) row.timezone = p.timezone
    if (closerId) row.closer_id = closerId
    if (scheduledFor) row.scheduled_at = scheduledFor
    if (p.cancel_url) row.calendly_cancel_url = p.cancel_url
    if (p.reschedule_url) row.calendly_reschedule_url = p.reschedule_url
    if (p.scheduled_event?.uri) row.calendly_event_id = p.scheduled_event.uri
    if (utm.utm_source) row.utm_source = utm.utm_source
    if (utm.utm_medium) row.utm_medium = utm.utm_medium
    if (utm.utm_campaign) row.utm_campaign = utm.utm_campaign
    if (utm.utm_content) row.utm_content = utm.utm_content
    if (utm.utm_term) row.utm_term = utm.utm_term

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .upsert(row, { onConflict: "email" })
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

    await dispatchEvent(supabase, {
      event_type: "call.booked",
      data: {
        lead: {
          id: lead.id,
          full_name: p.name ?? null,
          email: p.email ?? null,
          timezone: p.timezone ?? null,
        },
        booking: {
          scheduled_for: scheduledFor,
          closer_email: closerEmail,
          closer_id: closerId,
        },
        attribution: {
          utm_source: utm.utm_source ?? null,
          utm_medium: utm.utm_medium ?? null,
          utm_campaign: utm.utm_campaign ?? null,
          utm_content: utm.utm_content ?? null,
          utm_term: utm.utm_term ?? null,
        },
      },
    })

    // Native Slack notification — gated by automation toggle + presence of webhook URL.
    await maybePostBookingSlack(supabase, {
      kind: "created",
      lead: {
        id: lead.id,
        full_name: p.name ?? "Unknown",
        email: p.email ?? null,
        phone: p.text_reminder_number ?? null,
        instagram: null,
      },
      scheduledFor,
      closerName: closerFullName,
      closerSlackId,
      closerTimezone,
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
        await supabase
          .from("leads")
          .update({
            stage: "cancelled",
            cancelled_at: new Date().toISOString(),
          })
          .eq("id", lead.id)
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

    await dispatchEvent(supabase, {
      event_type: "call.cancelled",
      data: {
        lead: { email: p.email ?? null, full_name: p.name ?? null },
        cancel_url: p.cancel_url ?? null,
      },
    })

    // Look up the lead so we can deep-link the closer back to it from Slack.
    let cancelledLeadId: string | null = null
    let cancelledScheduledAt: string | null = null
    let cancelledCloserName: string | null = null
    let cancelledCloserSlackId: string | null = null
    let cancelledCloserTimezone: string | null = null
    if (p.email) {
      const { data: l } = await supabase
        .from("leads")
        .select(
          "id, scheduled_at, closer:team_members!leads_closer_id_fkey(full_name, slack_user_id, timezone)"
        )
        .eq("email", p.email)
        .maybeSingle()
      if (l) {
        cancelledLeadId = (l as { id: string }).id
        cancelledScheduledAt = (l as { scheduled_at: string | null }).scheduled_at
        const c = (l as { closer: { full_name?: string; slack_user_id?: string | null; timezone?: string | null } | null }).closer
        cancelledCloserName = c?.full_name ?? null
        cancelledCloserSlackId = c?.slack_user_id ?? null
        cancelledCloserTimezone = c?.timezone ?? null
      }
    }

    await maybePostBookingSlack(supabase, {
      kind: "cancelled",
      lead: {
        id: cancelledLeadId,
        full_name: p.name ?? "Unknown",
        email: p.email ?? null,
        phone: null,
        instagram: null,
      },
      scheduledFor: cancelledScheduledAt,
      closerName: cancelledCloserName,
      closerSlackId: cancelledCloserSlackId,
      closerTimezone: cancelledCloserTimezone,
    })

    return new Response("ok", { headers: corsHeaders })
  }

  return new Response("Ignored", { status: 200, headers: corsHeaders })
})

interface BookingSlackArgs {
  kind: "created" | "cancelled"
  lead: {
    id: string | null
    full_name: string
    email: string | null
    phone: string | null
    instagram: string | null
  }
  scheduledFor: string | null
  closerName: string | null
  closerSlackId: string | null
  closerTimezone: string | null
}

async function maybePostBookingSlack(
  supabase: ReturnType<typeof adminClient>,
  args: BookingSlackArgs
) {
  // Gate by the automation toggle.
  const settingKey = args.kind === "created" ? "new_call_booked" : "call_cancelled"
  const { data: setting } = await supabase
    .from("automation_settings")
    .select("enabled")
    .eq("key", settingKey)
    .maybeSingle()
  if (setting && setting.enabled === false) return

  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhookUrl = slackConfig?.bookings_webhook_url
  if (!webhookUrl) return

  const closerLine = args.closerName
    ? slackMention(args.closerSlackId) ?? `*${args.closerName}*`
    : "_Unassigned_"
  const scheduledLine = formatLocalTime(args.scheduledFor, args.closerTimezone)

  const message =
    args.kind === "created"
      ? buildCreatedMessage(args, closerLine, scheduledLine)
      : buildCancelledMessage(args, closerLine, scheduledLine)

  const result = await postToSlack(webhookUrl, message)
  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: args.kind === "created" ? "slack.call_booked" : "slack.call_cancelled",
    status: result.ok ? "success" : "failed",
    request_payload: { lead_email: args.lead.email } as never,
    response_payload: { status: result.status, body: result.body } as never,
    error: result.error,
    related_lead_id: args.lead.id,
  })
}

function buildCreatedMessage(
  args: BookingSlackArgs,
  closerLine: string,
  scheduledLine: string
) {
  const fields: { type: "mrkdwn"; text: string }[] = [
    { type: "mrkdwn", text: `*Lead*\n${args.lead.full_name}` },
    { type: "mrkdwn", text: `*Closer*\n${closerLine}` },
  ]
  if (args.lead.email) fields.push({ type: "mrkdwn", text: `*Email*\n${args.lead.email}` })
  if (args.lead.phone) fields.push({ type: "mrkdwn", text: `*Phone*\n${args.lead.phone}` })
  fields.push({ type: "mrkdwn", text: `*Scheduled*\n${scheduledLine}` })

  const ctxParts: string[] = ["EcomPulse CRM · bookings"]
  if (args.lead.id) {
    ctxParts.push(`<${leadDeepLink(args.lead.id)}|Open lead in CRM →>`)
  }

  return {
    text: `New lead booked: ${args.lead.full_name} — ${scheduledLine}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🗓  New Lead Booked", emoji: true },
      },
      { type: "section", fields },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            (slackMention(args.closerSlackId) ?? "") +
            (slackMention(args.closerSlackId) ? " — " : "") +
            "Start your *Pre-Call SOP* now.",
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: ctxParts.join("  ·  ") }],
      },
    ],
  }
}

function buildCancelledMessage(
  args: BookingSlackArgs,
  closerLine: string,
  scheduledLine: string
) {
  const fields: { type: "mrkdwn"; text: string }[] = [
    { type: "mrkdwn", text: `*Lead*\n${args.lead.full_name}` },
    { type: "mrkdwn", text: `*Closer*\n${closerLine}` },
  ]
  if (args.lead.email) fields.push({ type: "mrkdwn", text: `*Email*\n${args.lead.email}` })
  fields.push({ type: "mrkdwn", text: `*Was scheduled*\n${scheduledLine}` })

  const ctxParts: string[] = ["EcomPulse CRM · bookings"]
  if (args.lead.id) {
    ctxParts.push(`<${leadDeepLink(args.lead.id)}|Open lead in CRM →>`)
  }

  return {
    text: `Call cancelled: ${args.lead.full_name}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "❌  Call Cancelled", emoji: true },
      },
      { type: "section", fields },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: ctxParts.join("  ·  ") }],
      },
    ],
  }
}
