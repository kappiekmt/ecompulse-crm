// POST /eod-report
//
// Builds today's (Dubai TZ) end-of-day team report and posts it to the
// configured Slack incoming webhook.
//
// Auth options:
// 1. Admin-bound user JWT in Authorization header (Dashboard "Send Team EOD" button)
// 2. service_role key in Authorization header (pg_cron scheduled call)
//
// Body (optional):
//   { "date": "YYYY-MM-DD" }  — override "today". Useful for backfills.
//   { "test": true }           — prefix "TEST" so a real message isn't confused with a real EOD.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, getIntegrationConfig, logIntegration } from "../_shared/supabase-admin.ts"

const DUBAI_OFFSET_HOURS = 4

interface CloserMetrics {
  closer_id: string
  full_name: string
  calls_booked: number
  calls_showed: number
  calls_no_show: number
  deals_won: number
  cash_collected_cents: number
  show_rate_pct: number
  close_rate_pct: number
}

interface SetterMetrics {
  setter_id: string
  full_name: string
  bookings_made: number
}

interface TeamTotals {
  cash_collected_cents: number
  deals_won: number
  calls_booked: number
  calls_showed: number
  calls_no_show: number
  show_rate_pct: number
  close_rate_pct: number
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

function dubaiDayBounds(date?: string): { dateStr: string; startUtc: Date; endUtc: Date } {
  let y: number, m: number, d: number
  if (date) {
    const parts = date.split("-").map((n) => parseInt(n, 10))
    y = parts[0]
    m = parts[1] - 1
    d = parts[2]
  } else {
    const dubaiNow = new Date(Date.now() + DUBAI_OFFSET_HOURS * 3600 * 1000)
    y = dubaiNow.getUTCFullYear()
    m = dubaiNow.getUTCMonth()
    d = dubaiNow.getUTCDate()
  }
  const dubaiMidnightUtcMs = Date.UTC(y, m, d) - DUBAI_OFFSET_HOURS * 3600 * 1000
  const startUtc = new Date(dubaiMidnightUtcMs)
  const endUtc = new Date(dubaiMidnightUtcMs + 24 * 3600 * 1000)
  const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  return { dateStr, startUtc, endUtc }
}

function eur(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function pct(num: number, den: number): number {
  if (den === 0) return 0
  return Math.round((num / den) * 1000) / 10
}

async function authorize(req: Request): Promise<{ ok: true } | Response> {
  const auth = req.headers.get("authorization") ?? ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return jsonResponse({ error: "Missing bearer token" }, { status: 401 })
  const token = m[1].trim()

  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (serviceRole && token === serviceRole) return { ok: true }

  // Otherwise must be an admin user JWT.
  const url = Deno.env.get("SUPABASE_URL")
  const anon = Deno.env.get("SUPABASE_ANON_KEY")
  if (!url || !anon) return jsonResponse({ error: "Server misconfigured" }, { status: 500 })

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: me } = await userClient
    .from("team_members")
    .select("role")
    .limit(2)
  if (!me?.length || me.every((r) => r.role !== "admin")) {
    return jsonResponse({ error: "Admin access required" }, { status: 403 })
  }
  return { ok: true }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  const authResult = await authorize(req)
  if (authResult instanceof Response) return authResult

  const supabase = adminClient()

  let body: { date?: string; test?: boolean } = {}
  try {
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      body = await req.json()
    }
  } catch {
    /* ignore parse errors, treat as empty body */
  }

  // Check feature flag.
  const { data: setting } = await supabase
    .from("automation_settings")
    .select("enabled")
    .eq("key", "daily_eod_reports")
    .maybeSingle()
  if (!body.test && setting && setting.enabled === false) {
    return jsonResponse({ ok: false, skipped: "automation disabled" }, { status: 200 })
  }

  // Resolve Slack webhook from integration_configs.
  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhookUrl = slackConfig?.eod_webhook_url
  if (!webhookUrl) {
    return jsonResponse(
      { error: "Slack EOD webhook URL not configured" },
      { status: 503 }
    )
  }

  const { dateStr, startUtc, endUtc } = dubaiDayBounds(body.date)

  // 1. Pull today's leads (i.e. things that became calls).
  const { data: leadsToday } = await supabase
    .from("leads")
    .select("id, closer_id, setter_id, stage")
    .gte("created_at", startUtc.toISOString())
    .lt("created_at", endUtc.toISOString())
    .neq("stage", "new")

  // 2. Pull today's call outcomes.
  const { data: outcomesToday } = await supabase
    .from("call_outcomes")
    .select("id, closer_id, result")
    .gte("occurred_at", startUtc.toISOString())
    .lt("occurred_at", endUtc.toISOString())

  // 3. Pull today's payments (cash).
  const { data: paymentsToday } = await supabase
    .from("payments")
    .select("amount_cents, lead_id, is_refund")
    .gte("paid_at", startUtc.toISOString())
    .lt("paid_at", endUtc.toISOString())
    .eq("is_refund", false)

  // 4. Pull active team members.
  const { data: members } = await supabase
    .from("team_members")
    .select("id, full_name, role")
    .eq("is_active", true)
    .in("role", ["closer", "setter"])

  // For payment-to-closer attribution, we need lead.closer_id. Pull leads referenced by today's payments.
  const paymentLeadIds = [...new Set((paymentsToday ?? []).map((p) => p.lead_id).filter(Boolean) as string[])]
  let paymentLeadCloser = new Map<string, string | null>()
  if (paymentLeadIds.length) {
    const { data: paymentLeads } = await supabase
      .from("leads")
      .select("id, closer_id")
      .in("id", paymentLeadIds)
    paymentLeadCloser = new Map(
      (paymentLeads ?? []).map((l) => [l.id, l.closer_id])
    )
  }

  // Aggregate per-closer.
  const closers: CloserMetrics[] = (members ?? [])
    .filter((m) => m.role === "closer")
    .map((m) => {
      const calls_booked = (leadsToday ?? []).filter((l) => l.closer_id === m.id).length
      const calls_showed = (outcomesToday ?? []).filter(
        (o) => o.closer_id === m.id && o.result === "showed"
      ).length
      const calls_no_show = (outcomesToday ?? []).filter(
        (o) => o.closer_id === m.id && o.result === "no_show"
      ).length
      const deals_won = (outcomesToday ?? []).filter(
        (o) => o.closer_id === m.id && o.result === "closed"
      ).length
      const cash_collected_cents = (paymentsToday ?? [])
        .filter((p) => p.lead_id && paymentLeadCloser.get(p.lead_id) === m.id)
        .reduce((sum, p) => sum + (p.amount_cents ?? 0), 0)

      return {
        closer_id: m.id,
        full_name: m.full_name,
        calls_booked,
        calls_showed,
        calls_no_show,
        deals_won,
        cash_collected_cents,
        show_rate_pct: pct(calls_showed, calls_showed + calls_no_show),
        close_rate_pct: pct(deals_won, calls_showed),
      }
    })
    .sort((a, b) => b.cash_collected_cents - a.cash_collected_cents)

  const setters: SetterMetrics[] = (members ?? [])
    .filter((m) => m.role === "setter")
    .map((m) => ({
      setter_id: m.id,
      full_name: m.full_name,
      bookings_made: (leadsToday ?? []).filter((l) => l.setter_id === m.id).length,
    }))
    .sort((a, b) => b.bookings_made - a.bookings_made)

  const team: TeamTotals = {
    cash_collected_cents: (paymentsToday ?? []).reduce(
      (s, p) => s + (p.amount_cents ?? 0),
      0
    ),
    deals_won: (outcomesToday ?? []).filter((o) => o.result === "closed").length,
    calls_booked: leadsToday?.length ?? 0,
    calls_showed: (outcomesToday ?? []).filter((o) => o.result === "showed").length,
    calls_no_show: (outcomesToday ?? []).filter((o) => o.result === "no_show").length,
    show_rate_pct: 0,
    close_rate_pct: 0,
  }
  team.show_rate_pct = pct(team.calls_showed, team.calls_showed + team.calls_no_show)
  team.close_rate_pct = pct(team.deals_won, team.calls_showed)

  const message = buildSlackMessage({
    dateStr,
    isTest: Boolean(body.test),
    team,
    closers,
    setters,
  })

  // Send to Slack.
  let slackStatus: number | null = null
  let slackBody = ""
  let slackError: string | null = null
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    })
    slackStatus = res.status
    slackBody = (await res.text()).slice(0, 200)
    if (!res.ok) slackError = `Slack returned ${res.status}: ${slackBody}`
  } catch (err) {
    slackError = (err as Error).message
  }

  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: body.test ? "eod_report.test" : "eod_report",
    status: slackError ? "failed" : "success",
    request_payload: { dateStr, team, closers: closers.length, setters: setters.length } as never,
    response_payload: { status: slackStatus, body: slackBody } as never,
    error: slackError,
  })

  return jsonResponse({
    ok: !slackError,
    date: dateStr,
    slack_status: slackStatus,
    error: slackError,
    metrics: { team, closers_count: closers.length, setters_count: setters.length },
  })
})

function buildSlackMessage({
  dateStr,
  isTest,
  team,
  closers,
  setters,
}: {
  dateStr: string
  isTest: boolean
  team: TeamTotals
  closers: CloserMetrics[]
  setters: SetterMetrics[]
}) {
  const headerText = `${isTest ? "🧪 TEST · " : ""}📊 EOD Report — ${dateStr}`

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: headerText } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Cash collected*\n${eur(team.cash_collected_cents)}` },
        { type: "mrkdwn", text: `*Deals won*\n${team.deals_won}` },
        { type: "mrkdwn", text: `*Calls booked*\n${team.calls_booked}` },
        { type: "mrkdwn", text: `*Showed*\n${team.calls_showed} (${team.show_rate_pct}%)` },
        { type: "mrkdwn", text: `*No-shows*\n${team.calls_no_show}` },
        { type: "mrkdwn", text: `*Close rate*\n${team.close_rate_pct}%` },
      ],
    },
    { type: "divider" },
  ]

  if (closers.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Closers:* no active closers." },
    })
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Closers*" },
    })
    for (const c of closers) {
      const line = `• *${c.full_name}* — ${eur(c.cash_collected_cents)} · ${c.deals_won} won · ${c.calls_showed}/${c.calls_booked} showed (${c.show_rate_pct}%) · close ${c.close_rate_pct}%`
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: line },
      })
    }
  }

  blocks.push({ type: "divider" })

  if (setters.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Setters:* no active setters." },
    })
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Setters*" },
    })
    for (const s of setters) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `• *${s.full_name}* — ${s.bookings_made} bookings` },
      })
    }
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "EcomPulse CRM · automated EOD report (Dubai 21:00)",
      },
    ],
  })

  // Slack also wants `text` as fallback for clients that don't support blocks.
  return {
    text: `EOD Report — ${dateStr}: ${eur(team.cash_collected_cents)} cash, ${team.deals_won} deals won, ${team.calls_booked} calls`,
    blocks,
  }
}
