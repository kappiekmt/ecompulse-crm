// POST /eod-report
//
// Builds today's (Amsterdam TZ) end-of-day team report and posts it to the
// configured Slack incoming webhook.
//
// Auth & gating:
//  - service_role token (cron path) → only sends when current Amsterdam hour
//    is 21 AND automation_settings.daily_eod_reports is enabled.
//  - admin user JWT (manual button) → sends immediately, no time/toggle gate.
//
// Optional body: { "date": "YYYY-MM-DD" } to backfill a specific day.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, getIntegrationConfig, logIntegration } from "../_shared/supabase-admin.ts"

const TZ = "Europe/Amsterdam"

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

function amsterdamNowParts() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "long",
    hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  ) as Record<string, string>
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour ?? "0", 10),
    weekday: parts.weekday ?? "",
  }
}

function dayBoundsAmsterdam(dateIso: string): { startUtc: Date; endUtc: Date } {
  // Find UTC for 00:00 in Amsterdam on dateIso. Amsterdam is UTC+1 (CET) or UTC+2 (CEST).
  // Construct two candidates and pick the one whose Intl-formatted Amsterdam date matches.
  const [y, m, d] = dateIso.split("-").map((n) => parseInt(n, 10))
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

  function findMidnight(): Date {
    // Try -2h then -1h (CEST/CET offsets) and pick the candidate that lands at 00:00 Amsterdam.
    for (const offsetH of [2, 1]) {
      const candidate = new Date(Date.UTC(y, m - 1, d, offsetH, 0, 0))
      const parts = Object.fromEntries(
        fmt.formatToParts(candidate).map((p) => [p.type, p.value])
      ) as Record<string, string>
      if (
        parts.year === String(y) &&
        parts.month === String(m).padStart(2, "0") &&
        parts.day === String(d).padStart(2, "0") &&
        parts.hour === "00" &&
        parts.minute === "00"
      ) {
        return candidate
      }
    }
    // Fallback: UTC midnight (acceptable in unusual edge cases).
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  }

  const startUtc = findMidnight()
  const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000)
  return { startUtc, endUtc }
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

interface AuthResult {
  ok: true
  source: "service_role" | "user"
}

async function authorize(req: Request): Promise<AuthResult | Response> {
  const auth = req.headers.get("authorization") ?? ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return jsonResponse({ error: "Missing bearer token" }, { status: 401 })
  const token = m[1].trim()

  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (serviceRole && token === serviceRole) return { ok: true, source: "service_role" }

  const url = Deno.env.get("SUPABASE_URL")
  const anon = Deno.env.get("SUPABASE_ANON_KEY")
  if (!url || !anon) return jsonResponse({ error: "Server misconfigured" }, { status: 500 })

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: me } = await userClient.from("team_members").select("role").limit(2)
  if (!me?.length || me.every((r) => r.role !== "admin")) {
    return jsonResponse({ error: "Admin access required" }, { status: 403 })
  }
  return { ok: true, source: "user" }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  const auth = await authorize(req)
  if (auth instanceof Response) return auth
  const supabase = adminClient()

  let body: { date?: string } = {}
  try {
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      body = await req.json()
    }
  } catch {
    /* body optional */
  }

  const ams = amsterdamNowParts()

  // CRON path: only fire at 21:00 Amsterdam, and only if the toggle is on.
  if (auth.source === "service_role") {
    if (ams.hour !== 21) {
      return jsonResponse({ ok: false, skipped: `not 21:00 amsterdam (got ${ams.hour}:00)` })
    }
    const { data: setting } = await supabase
      .from("automation_settings")
      .select("enabled")
      .eq("key", "daily_eod_reports")
      .maybeSingle()
    if (setting && setting.enabled === false) {
      return jsonResponse({ ok: false, skipped: "automation disabled" })
    }
  }

  const dateStr = body.date ?? ams.isoDate
  const { startUtc, endUtc } = dayBoundsAmsterdam(dateStr)

  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhookUrl = slackConfig?.eod_webhook_url
  if (!webhookUrl) {
    return jsonResponse(
      { error: "Slack EOD webhook URL not configured" },
      { status: 503 }
    )
  }

  // Pull today's data.
  const [{ data: leadsToday }, { data: outcomesToday }, { data: paymentsToday }, { data: members }] =
    await Promise.all([
      supabase
        .from("leads")
        .select("id, closer_id, setter_id, stage")
        .gte("created_at", startUtc.toISOString())
        .lt("created_at", endUtc.toISOString())
        .neq("stage", "new"),
      supabase
        .from("call_outcomes")
        .select("id, closer_id, result")
        .gte("occurred_at", startUtc.toISOString())
        .lt("occurred_at", endUtc.toISOString()),
      supabase
        .from("payments")
        .select("amount_cents, lead_id")
        .gte("paid_at", startUtc.toISOString())
        .lt("paid_at", endUtc.toISOString())
        .eq("is_refund", false),
      supabase
        .from("team_members")
        .select("id, full_name, role")
        .eq("is_active", true)
        .in("role", ["closer", "setter"]),
    ])

  const paymentLeadIds = [
    ...new Set((paymentsToday ?? []).map((p) => p.lead_id).filter(Boolean) as string[]),
  ]
  let paymentLeadCloser = new Map<string, string | null>()
  if (paymentLeadIds.length) {
    const { data: paymentLeads } = await supabase
      .from("leads")
      .select("id, closer_id")
      .in("id", paymentLeadIds)
    paymentLeadCloser = new Map((paymentLeads ?? []).map((l) => [l.id, l.closer_id]))
  }

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

  const message = buildSlackMessage({ dateStr, weekday: ams.weekday, team, closers, setters })

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
    event_type: "eod_report",
    status: slackError ? "failed" : "success",
    request_payload: { dateStr, source: auth.source, team, closers: closers.length, setters: setters.length } as never,
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
  weekday,
  team,
  closers,
  setters,
}: {
  dateStr: string
  weekday: string
  team: TeamTotals
  closers: CloserMetrics[]
  setters: SetterMetrics[]
}) {
  // Pretty date: "Wednesday, April 30"
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10))
  const monthName = new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", { month: "long" })
  const prettyDate = `${weekday}, ${monthName} ${d}`

  const blocks: unknown[] = []

  // Header.
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `🌙  EOD Report  ·  ${prettyDate}`, emoji: true },
  })

  // Subtitle as a context block.
  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `*Team performance for ${dateStr}* (Amsterdam)` },
    ],
  })

  blocks.push({ type: "divider" })

  // Team KPI grid — 2x2.
  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `💰 *Cash Collected*\n*${eur(team.cash_collected_cents)}*` },
      { type: "mrkdwn", text: `🏆 *Deals Won*\n*${team.deals_won}*` },
      { type: "mrkdwn", text: `📞 *Calls Booked*\n*${team.calls_booked}*` },
      {
        type: "mrkdwn",
        text: `✅ *Show Rate*\n*${team.show_rate_pct}%* (${team.calls_showed}/${team.calls_showed + team.calls_no_show})`,
      },
    ],
  })

  // Highlight: top closer if there's anyone with cash today.
  const topCloser = closers[0]
  if (topCloser && topCloser.cash_collected_cents > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🥇  *Top closer today:*  *${topCloser.full_name}*  —  ${eur(topCloser.cash_collected_cents)}  ·  ${topCloser.deals_won} won`,
      },
    })
  }

  blocks.push({ type: "divider" })

  // Closers section.
  if (closers.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*👤  Closers*\n_No active closers._" },
    })
  } else {
    const RANK_EMOJI = ["🥇", "🥈", "🥉"]
    const lines = closers.map((c, i) => {
      const rank = RANK_EMOJI[i] ?? "  •"
      const showed = `${c.calls_showed}/${c.calls_showed + c.calls_no_show}`
      const showRate = c.calls_showed + c.calls_no_show > 0 ? ` (${c.show_rate_pct}%)` : ""
      return `${rank}  *${c.full_name}*  —  ${eur(c.cash_collected_cents)}  ·  ${c.deals_won} won  ·  ${showed} showed${showRate}  ·  close ${c.close_rate_pct}%`
    })
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*👤  Closers*\n${lines.join("\n")}` },
    })
  }

  blocks.push({ type: "divider" })

  // Setters section.
  if (setters.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*📅  Setters*\n_No active setters._" },
    })
  } else {
    const lines = setters.map(
      (s) =>
        `  •  *${s.full_name}*  —  ${s.bookings_made} booking${s.bookings_made === 1 ? "" : "s"}`
    )
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*📅  Setters*\n${lines.join("\n")}` },
    })
  }

  // Footer.
  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `EcomPulse CRM  ·  automated EOD  ·  21:00 Amsterdam` },
    ],
  })

  return {
    text: `EOD ${prettyDate} — ${eur(team.cash_collected_cents)} · ${team.deals_won} deals · ${team.calls_booked} calls`,
    blocks,
  }
}
