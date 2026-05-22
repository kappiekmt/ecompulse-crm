// POST /eow-report
//
// Builds the end-of-week team report for the Amsterdam week that just closed
// (Monday 00:00 → Sunday 24:00) and posts it to the SAME Slack incoming
// webhook as the daily EOD — i.e. the #eod channel. The weekly summary lands
// in the channel right after Sunday's final EOD.
//
// Auth & gating:
//  - service_role token (cron path) → only sends when it's Sunday AND the
//    current Amsterdam hour is 22 AND automation_settings.weekly_report is
//    enabled. (EOD fires at 21:00; EOW follows an hour later.)
//  - admin user JWT (manual button) → sends immediately, no day/time/toggle
//    gate. Mid-week this reports the current week-to-date.
//
// Optional body: { "week_start": "YYYY-MM-DD" } — a Monday — to backfill a
// specific week. When omitted, uses the Monday of the current Amsterdam week.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, getIntegrationConfig, logIntegration } from "../_shared/supabase-admin.ts"

const TZ = "Europe/Amsterdam"

interface CloserMetrics {
  closer_id: string
  full_name: string
  slack_user_id: string | null
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
  slack_user_id: string | null
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

const WEEKDAY_INDEX: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
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

/** Shift an ISO date (YYYY-MM-DD) by `days`, returning a new ISO date. Uses
 *  UTC-noon arithmetic so it never trips over a DST transition. */
function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map((n) => parseInt(n, 10))
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  t.setUTCDate(t.getUTCDate() + days)
  const yy = t.getUTCFullYear()
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(t.getUTCDate()).padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}

/** UTC instant for 00:00 Amsterdam on the given ISO date. */
function midnightAmsterdam(dateIso: string): Date {
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
  // Amsterdam is UTC+2 (CEST) or UTC+1 (CET). Try both and keep the candidate
  // that actually lands at 00:00 local on dateIso.
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
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
}

/** Monday→Monday UTC bounds for the week containing (or starting on) weekStart. */
function weekBoundsAmsterdam(weekStartIso: string): { startUtc: Date; endUtc: Date } {
  const startUtc = midnightAmsterdam(weekStartIso)
  // 7 days later, recomputed from the Sunday+1 date so a DST shift inside the
  // week doesn't drift the end boundary off local midnight.
  const endUtc = midnightAmsterdam(addDays(weekStartIso, 7))
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

function slackName(fullName: string, slackUserId: string | null): string {
  if (slackUserId) return `<@${slackUserId}>`
  return `*${fullName}*`
}

interface AuthResult {
  ok: true
  source: "service_role" | "user"
}

function decodeJwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1]
    if (!payload) return null
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    ) as { role?: string }
    return decoded.role ?? null
  } catch {
    return null
  }
}

async function authorize(req: Request): Promise<AuthResult | Response> {
  const auth = req.headers.get("authorization") ?? ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return jsonResponse({ error: "Missing bearer token" }, { status: 401 })
  const token = m[1].trim()

  const role = decodeJwtRole(token)
  if (role === "service_role") return { ok: true, source: "service_role" }

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

  let body: { week_start?: string } = {}
  try {
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      body = await req.json()
    }
  } catch {
    /* body optional */
  }

  const ams = amsterdamNowParts()

  // CRON path: only fire Sunday 22:00 Amsterdam, and only if the toggle is on.
  if (auth.source === "service_role") {
    if (ams.weekday !== "Sunday") {
      return jsonResponse({ ok: false, skipped: `not Sunday (got ${ams.weekday})` })
    }
    if (ams.hour !== 22) {
      return jsonResponse({ ok: false, skipped: `not 22:00 amsterdam (got ${ams.hour}:00)` })
    }
    const { data: setting } = await supabase
      .from("automation_settings")
      .select("enabled")
      .eq("key", "weekly_report")
      .maybeSingle()
    if (setting && setting.enabled === false) {
      return jsonResponse({ ok: false, skipped: "automation disabled" })
    }
  }

  // Resolve the Monday that anchors the week. Backfill via body.week_start,
  // otherwise the Monday of the current Amsterdam week.
  const daysSinceMonday = (WEEKDAY_INDEX[ams.weekday] ?? 1) - 1
  const weekStart = body.week_start ?? addDays(ams.isoDate, -daysSinceMonday)
  const weekEnd = addDays(weekStart, 6) // Sunday (inclusive) for display
  const { startUtc, endUtc } = weekBoundsAmsterdam(weekStart)

  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhookUrl = slackConfig?.eod_webhook_url
  if (!webhookUrl) {
    return jsonResponse(
      { error: "Slack EOD webhook URL not configured" },
      { status: 503 }
    )
  }

  // Pull the week's data.
  const [{ data: leadsWeek }, { data: outcomesWeek }, { data: paymentsWeek }, { data: members }] =
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
        .select("id, full_name, role, slack_user_id")
        .eq("is_active", true)
        .in("role", ["closer", "setter"]),
    ])

  const paymentLeadIds = [
    ...new Set((paymentsWeek ?? []).map((p) => p.lead_id).filter(Boolean) as string[]),
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
      const calls_booked = (leadsWeek ?? []).filter((l) => l.closer_id === m.id).length
      const calls_showed = (outcomesWeek ?? []).filter(
        (o) => o.closer_id === m.id && o.result === "showed"
      ).length
      const calls_no_show = (outcomesWeek ?? []).filter(
        (o) => o.closer_id === m.id && o.result === "no_show"
      ).length
      const deals_won = (outcomesWeek ?? []).filter(
        (o) => o.closer_id === m.id && o.result === "closed"
      ).length
      const cash_collected_cents = (paymentsWeek ?? [])
        .filter((p) => p.lead_id && paymentLeadCloser.get(p.lead_id) === m.id)
        .reduce((sum, p) => sum + (p.amount_cents ?? 0), 0)
      return {
        closer_id: m.id,
        full_name: m.full_name,
        slack_user_id: (m as { slack_user_id?: string | null }).slack_user_id ?? null,
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
      slack_user_id: (m as { slack_user_id?: string | null }).slack_user_id ?? null,
      bookings_made: (leadsWeek ?? []).filter((l) => l.setter_id === m.id).length,
    }))
    .sort((a, b) => b.bookings_made - a.bookings_made)

  const team: TeamTotals = {
    cash_collected_cents: (paymentsWeek ?? []).reduce(
      (s, p) => s + (p.amount_cents ?? 0),
      0
    ),
    deals_won: (outcomesWeek ?? []).filter((o) => o.result === "closed").length,
    calls_booked: leadsWeek?.length ?? 0,
    calls_showed: (outcomesWeek ?? []).filter((o) => o.result === "showed").length,
    calls_no_show: (outcomesWeek ?? []).filter((o) => o.result === "no_show").length,
    show_rate_pct: 0,
    close_rate_pct: 0,
  }
  team.show_rate_pct = pct(team.calls_showed, team.calls_showed + team.calls_no_show)
  team.close_rate_pct = pct(team.deals_won, team.calls_showed)

  const message = buildSlackMessage({ weekStart, weekEnd, team, closers, setters })

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
    event_type: "eow_report",
    status: slackError ? "failed" : "success",
    request_payload: { weekStart, weekEnd, source: auth.source, team, closers: closers.length, setters: setters.length } as never,
    response_payload: { status: slackStatus, body: slackBody } as never,
    error: slackError,
  })

  return jsonResponse({
    ok: !slackError,
    week_start: weekStart,
    week_end: weekEnd,
    slack_status: slackStatus,
    error: slackError,
    metrics: { team, closers_count: closers.length, setters_count: setters.length },
  })
})

function buildSlackMessage({
  weekStart,
  weekEnd,
  team,
  closers,
  setters,
}: {
  weekStart: string
  weekEnd: string
  team: TeamTotals
  closers: CloserMetrics[]
  setters: SetterMetrics[]
}) {
  // Pretty range: "April 28 – May 4" (drops the repeated month when equal).
  const fmtDay = (iso: string, withMonth: boolean) => {
    const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10))
    const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", { month: "long" })
    return withMonth ? `${month} ${d}` : `${d}`
  }
  const sameMonth = weekStart.slice(0, 7) === weekEnd.slice(0, 7)
  const prettyRange = `${fmtDay(weekStart, true)} – ${fmtDay(weekEnd, !sameMonth)}`

  const blocks: unknown[] = []

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `📊  EOW Report  ·  ${prettyRange}`, emoji: true },
  })

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `*Team performance for the week of ${weekStart} → ${weekEnd}* (Amsterdam)` },
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

  // Highlight: top closer of the week if anyone collected cash.
  const topCloser = closers[0]
  if (topCloser && topCloser.cash_collected_cents > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🥇  *Closer of the week:*  ${slackName(topCloser.full_name, topCloser.slack_user_id)}  —  ${eur(topCloser.cash_collected_cents)}  ·  ${topCloser.deals_won} won`,
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
      return `${rank}  ${slackName(c.full_name, c.slack_user_id)}  —  ${eur(c.cash_collected_cents)}  ·  ${c.deals_won} won  ·  ${showed} showed${showRate}  ·  close ${c.close_rate_pct}%`
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
        `  •  ${slackName(s.full_name, s.slack_user_id)}  —  ${s.bookings_made} booking${s.bookings_made === 1 ? "" : "s"}`
    )
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*📅  Setters*\n${lines.join("\n")}` },
    })
  }

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `EcomPulse CRM  ·  automated EOW  ·  Sundays 22:00 Amsterdam` },
    ],
  })

  return {
    text: `EOW ${prettyRange} — ${eur(team.cash_collected_cents)} · ${team.deals_won} deals · ${team.calls_booked} calls`,
    blocks,
  }
}
