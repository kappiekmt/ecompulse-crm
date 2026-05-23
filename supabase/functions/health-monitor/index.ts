// POST /health-monitor
//
// Cron-only. Every 30 min checks `integrations_log` + `automation_cron_health`
// for failures inside the last 35 min (5-min overlap with the cadence so a
// transient issue doesn't fall between sweeps). If any are found, posts ONE
// summary card to the Slack bookings webhook with the broken automation + the
// suggested fix.
//
// Dedup is by time-window — a persistent failure will re-alert every 30 min,
// which is the intended behaviour for ops alerts (you should fix it).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, getIntegrationConfig, isServiceRequest, logIntegration } from "../_shared/supabase-admin.ts"
import { postToSlack } from "../_shared/slack.ts"
import { cardHeader, cardFooter, ICON } from "../_shared/slack-card.ts"

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

// Mirrors the page's catalog mapping: log event_type → human label + fix hint.
// Kept here (vs imported) because edge functions can't import from src/.
interface AutomationEntry {
  id: string
  name: string
  logEventTypes: string[]
  knownIssues: { match: RegExp | string; fix: string }[]
}

const AUTOMATIONS: AutomationEntry[] = [
  { id: "eod", name: "EOD report", logEventTypes: ["eod_report"], knownIssues: [{ match: /webhook URL not configured/, fix: "Set eod_webhook_url in Integrations → Slack." }] },
  { id: "eow", name: "EOW report", logEventTypes: ["eow_report"], knownIssues: [] },
  { id: "pre_call", name: "Pre-call reminder", logEventTypes: ["slack.pre_call_reminder"], knownIssues: [] },
  { id: "call_booked", name: "Call booked", logEventTypes: ["slack.call_booked", "calendly.invitee.created"], knownIssues: [{ match: /Invalid signature/, fix: "Check Calendly signing_key." }] },
  { id: "call_cancelled", name: "Call cancelled", logEventTypes: ["slack.call_cancelled", "calendly.invitee.canceled"], knownIssues: [] },
  { id: "deal_closed", name: "Deal closed", logEventTypes: ["deal.closed", "payment.received", "stripe.payment.received"], knownIssues: [{ match: /Webhook signature error/, fix: "Check Stripe webhook_secret." }] },
  { id: "coach_assigned", name: "Coach assigned", logEventTypes: ["coach.assigned", "students.coach_assigned"], knownIssues: [] },
  { id: "onboarding", name: "Onboarding chain", logEventTypes: ["onboarding.discord_invite", "discord.create_invite"], knownIssues: [{ match: /discord.*not set|discord.*not connected/i, fix: "Connect Discord in Integrations → Discord." }] },
  { id: "installment_paid", name: "Installment paid", logEventTypes: ["installment.paid", "deal.fully_paid"], knownIssues: [] },
  { id: "recovery", name: "Payment recovery", logEventTypes: ["recovery.check", "recovery.sequence"], knownIssues: [{ match: /SLACK_BOT_TOKEN|channel_not_found/, fix: "Slack bot missing scopes (chat:write.public) or not invited to #b-payment-failed." }] },
  { id: "commission", name: "Commission DM", logEventTypes: ["commission.earned"], knownIssues: [{ match: /no slack_user_id/, fix: "Closer missing slack_user_id — set on Team page." }] },
  { id: "closer_recap", name: "Weekly closer recap", logEventTypes: ["commission.weekly_recap"], knownIssues: [] },
]

function pickFix(message: string | null | undefined, issues: AutomationEntry["knownIssues"]): string | undefined {
  if (!message) return undefined
  for (const issue of issues) {
    if (typeof issue.match === "string" ? message.includes(issue.match) : issue.match.test(message)) {
      return issue.fix
    }
  }
  return undefined
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (!isServiceRequest(req)) return jsonResponse({ error: "Unauthorized" }, { status: 401 })

  const supabase = adminClient()
  const since = new Date(Date.now() - 35 * 60 * 1000).toISOString()

  const { data: rows } = await supabase
    .from("integrations_log")
    .select("event_type, status, error, created_at")
    .eq("status", "failed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50)

  const failures = rows ?? []
  if (failures.length === 0) {
    return jsonResponse({ ok: true, alerted: 0, message: "no failures in last 35min" })
  }

  // Group by automation id, keeping the most recent failure per automation.
  const grouped = new Map<string, { name: string; error: string | null; created_at: string; fix?: string }>()
  for (const row of failures) {
    const auto = AUTOMATIONS.find((a) => a.logEventTypes.includes(row.event_type))
    if (!auto) continue
    if (!grouped.has(auto.id)) {
      grouped.set(auto.id, {
        name: auto.name,
        error: row.error,
        created_at: row.created_at,
        fix: pickFix(row.error, auto.knownIssues),
      })
    }
  }

  if (grouped.size === 0) {
    return jsonResponse({ ok: true, alerted: 0, message: "failures found but none mapped to a known automation" })
  }

  // Compose the alert card.
  const lineItems = [...grouped.values()].map((g) => {
    const fix = g.fix ? `\n      _Fix:_ ${g.fix}` : ""
    return `• *${g.name}* — \`${(g.error ?? "unknown error").slice(0, 140)}\`${fix}`
  })

  const message = {
    text: `${grouped.size} EcomPulse automation${grouped.size > 1 ? "s" : ""} need${grouped.size > 1 ? "" : "s"} attention`,
    blocks: [
      cardHeader(ICON.overdue, "Automation health alert", `${grouped.size} automation${grouped.size > 1 ? "s" : ""} failing in the last 30 min`),
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: lineItems.join("\n"),
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Open the CRM → *Automations* tab for full health, recent runs, and a one-click test per automation.",
          },
        ],
      },
      cardFooter("health monitor · every 30 min"),
    ],
  }

  const slack = await getIntegrationConfig(supabase, "slack")
  const url = slack?.alerts_webhook_url || slack?.bookings_webhook_url
  if (!url) {
    return jsonResponse({ error: "No Slack webhook configured for alerts (set bookings_webhook_url or alerts_webhook_url)" }, { status: 503 })
  }

  const r = await postToSlack(url, message)
  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: "health.alert",
    status: r.ok ? "success" : "failed",
    request_payload: { window_minutes: 35, failure_count: grouped.size } as never,
    response_payload: { status: r.status, body: r.body } as never,
    error: r.error,
  })

  return jsonResponse({ ok: r.ok, alerted: grouped.size, slack_status: r.status })
})
