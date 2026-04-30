// POST /dispatch-reminders
//
// Cron-driven worker. Scans the `reminders` table for rows that are due to
// fire (status='scheduled' AND fire_at <= now()) and dispatches the
// corresponding outbound webhook event for each. Today the only reminder kind
// is `pre_call_15m` → emits `pre_call.reminder`.
//
// Auth: service_role token only (this is a system endpoint).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, getIntegrationConfig, logIntegration } from "../_shared/supabase-admin.ts"
import { dispatchEvent } from "../_shared/dispatch.ts"
import { leadDeepLink, postToSlack, slackMention } from "../_shared/slack.ts"

interface ReminderRow {
  id: string
  lead_id: string | null
  team_member_id: string | null
  kind: string
  fire_at: string
  payload: Record<string, unknown> | null
}

interface LeadRow {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  instagram: string | null
  timezone: string | null
  stage: string
  scheduled_at: string | null
  pre_call_started: boolean
  pre_call_started_at: string | null
  closer_id: string | null
  setter_id: string | null
}

interface MemberRow {
  id: string
  full_name: string
  email: string
  timezone: string | null
  slack_user_id: string | null
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

/**
 * The Supabase gateway enforces verify_jwt = true on this function, so any
 * request that reaches us already has a valid JWT in the Authorization header.
 * We only run when the JWT's role claim is `service_role` (i.e. pg_cron) so
 * regular users can't fan out reminder events.
 */
function authorize(req: Request): true | Response {
  const auth = req.headers.get("authorization") ?? ""
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) return jsonResponse({ error: "Missing bearer token" }, { status: 401 })
  // Decode the JWT payload (validation already done by the gateway).
  const parts = token.split(".")
  if (parts.length !== 3) {
    return jsonResponse({ error: "Token is not a JWT" }, { status: 401 })
  }
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
    if (payload.role !== "service_role") {
      return jsonResponse({ error: "Service role required" }, { status: 403 })
    }
  } catch {
    return jsonResponse({ error: "Cannot decode JWT" }, { status: 401 })
  }
  return true
}

/** Format the closer-local time for the message: "Wednesday, 29 Apr at 06:00 PM (Amsterdam)". */
function formatLocalTime(iso: string, timezone: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const tz = timezone ?? "UTC"
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value])) as Record<string, string>
  const tzShort = tz.split("/").pop() ?? tz
  return `${parts.weekday}, ${parts.day} ${parts.month} at ${parts.hour}:${parts.minute} ${parts.dayPeriod} (${tzShort})`
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  const auth = authorize(req)
  if (auth !== true) return auth

  const supabase = adminClient()

  // 1. Find due reminders.
  const { data: due, error: dueErr } = await supabase
    .from("reminders")
    .select("id, lead_id, team_member_id, kind, fire_at, payload")
    .eq("status", "scheduled")
    .lte("fire_at", new Date().toISOString())
    .limit(50)

  if (dueErr) return jsonResponse({ error: dueErr.message }, { status: 500 })
  if (!due?.length) return jsonResponse({ ok: true, dispatched: 0 })

  let dispatched = 0
  let failed = 0

  for (const r of due as ReminderRow[]) {
    try {
      if (r.kind === "pre_call_15m" && r.lead_id) {
        // Pull lead + closer details for the payload.
        const { data: lead } = await supabase
          .from("leads")
          .select(
            "id, full_name, email, phone, instagram, timezone, stage, scheduled_at, pre_call_started, pre_call_started_at, closer_id, setter_id"
          )
          .eq("id", r.lead_id)
          .maybeSingle<LeadRow>()
        if (!lead) {
          await supabase.from("reminders").update({ status: "failed" }).eq("id", r.id)
          failed++
          continue
        }

        let closer: MemberRow | null = null
        if (lead.closer_id) {
          const { data } = await supabase
            .from("team_members")
            .select("id, full_name, email, timezone, slack_user_id")
            .eq("id", lead.closer_id)
            .maybeSingle<MemberRow>()
          closer = data ?? null
        }

        const scheduledAt = lead.scheduled_at ?? (r.payload?.scheduled_for as string | undefined) ?? null
        const tz = closer?.timezone ?? lead.timezone ?? "UTC"

        await dispatchEvent(supabase, {
          event_type: "pre_call.reminder",
          data: {
            lead: {
              id: lead.id,
              full_name: lead.full_name,
              email: lead.email,
              phone: lead.phone,
              instagram: lead.instagram,
              stage: lead.stage,
            },
            closer: closer
              ? {
                  id: closer.id,
                  full_name: closer.full_name,
                  email: closer.email,
                  timezone: closer.timezone,
                  slack_user_id: closer.slack_user_id,
                  slack_mention: closer.slack_user_id ? `<@${closer.slack_user_id}>` : null,
                }
              : null,
            scheduled_at: scheduledAt,
            scheduled_at_local: scheduledAt ? formatLocalTime(scheduledAt, tz) : null,
            timezone: tz,
            pre_call: {
              started: lead.pre_call_started,
              started_at: lead.pre_call_started_at,
              status: lead.pre_call_started ? "Confirmed" : "Not started",
            },
          },
        })

        // Native Slack post — gated by automation toggle + presence of webhook URL.
        await maybePostPreCallSlack(supabase, lead, closer, scheduledAt, tz)

        await supabase
          .from("reminders")
          .update({ status: "sent", completed_at: new Date().toISOString() })
          .eq("id", r.id)
        dispatched++
      } else {
        // Unknown kind — skip but mark sent so we don't retry forever.
        await supabase
          .from("reminders")
          .update({ status: "sent", completed_at: new Date().toISOString() })
          .eq("id", r.id)
      }
    } catch (err) {
      console.error("[dispatch-reminders]", err)
      await supabase.from("reminders").update({ status: "failed" }).eq("id", r.id)
      failed++
    }
  }

  return jsonResponse({ ok: true, dispatched, failed, scanned: due.length })
})

/** Post a pre-call reminder to Slack with @-mention to the closer. */
async function maybePostPreCallSlack(
  supabase: ReturnType<typeof adminClient>,
  lead: LeadRow,
  closer: MemberRow | null,
  scheduledAt: string | null,
  tz: string
): Promise<void> {
  // Toggle gate.
  const { data: setting } = await supabase
    .from("automation_settings")
    .select("enabled")
    .eq("key", "pre_call_15m_reminder")
    .maybeSingle()
  if (setting && setting.enabled === false) return

  const slackConfig = await getIntegrationConfig(supabase, "slack")
  // Prefer a dedicated pre-call URL if set, fall back to the bookings URL.
  const webhookUrl =
    slackConfig?.pre_call_webhook_url || slackConfig?.bookings_webhook_url
  if (!webhookUrl) return

  const closerMention = slackMention(closer?.slack_user_id ?? null)
  const closerName = closer?.full_name ?? "Unassigned"
  const leadFirst = lead.full_name.split(" ")[0] || lead.full_name
  const whenLine = scheduledAt ? formatShortLocalTime(scheduledAt, tz) : "—"
  const phoneFmt = lead.phone ? formatPhone(lead.phone) : "—"

  // Pre-call status indicator.
  const preCallLine = lead.pre_call_started ? "✅ Confirmed" : "⚠️ Not started"

  const blocks: Record<string, unknown>[] = []

  // @-mention prefix so Slack actually pings the closer.
  if (closerMention) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${closerMention} — your call starts in 15 minutes ⏰`,
      },
    })
  }

  blocks.push(
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⏰  *Pre-call reminder · ${closerName.split(" ")[0]}*`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*When:*\n${whenLine}` },
        { type: "mrkdwn", text: `*Lead:*\n${lead.full_name}` },
        { type: "mrkdwn", text: `*Phone:*\n${phoneFmt}` },
        { type: "mrkdwn", text: `*Pre-call:*\n${preCallLine}` },
      ],
    }
  )

  // Action buttons.
  const actions: Record<string, unknown>[] = []
  if (lead.phone) {
    const digits = normalizeDutchPhone(lead.phone)
    const message = `Hi ${leadFirst} 👋 We're starting our call in 15 minutes. See you there!`
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "📱  WhatsApp lead", emoji: true },
      url: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
      style: "primary",
    })
  }
  // We don't store calendly_join_url on the lead here without re-querying — keep
  // it simple: if scheduledAt exists, link to the lead drawer where the closer
  // can see the join URL + reschedule URL + everything else.
  actions.push({
    type: "button",
    text: { type: "plain_text", text: "Open in CRM" },
    url: leadDeepLink(lead.id),
  })
  blocks.push({ type: "actions", elements: actions.slice(0, 5) })

  const result = await postToSlack(webhookUrl, {
    text: `Pre-call reminder · ${lead.full_name} — ${whenLine}`,
    blocks,
  })

  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: "slack.pre_call_reminder",
    status: result.ok ? "success" : "failed",
    request_payload: { lead_id: lead.id, closer_id: closer?.id ?? null } as never,
    response_payload: { status: result.status, body: result.body } as never,
    error: result.error,
    related_lead_id: lead.id,
  })
}

function formatShortLocalTime(iso: string, timezone: string | null | undefined): string {
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
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value])
  ) as Record<string, string>
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} (${tz})`
}

function formatPhone(phone: string): string {
  const cleaned = phone.trim()
  const m = cleaned.match(/^(\+\d{1,3})\s*(\d.*)$/)
  return m ? `${m[1]} ${m[2].replace(/\s+/g, "")}` : cleaned
}

function normalizeDutchPhone(phone: string): string {
  let digits = phone.replace(/[^\d]/g, "")
  // If starts with 0 (national), prepend country code 31 (NL default).
  if (digits.startsWith("0")) digits = "31" + digits.slice(1)
  return digits
}
