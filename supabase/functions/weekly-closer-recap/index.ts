// POST /weekly-closer-recap
//
// Monday 09:00 Amsterdam (DST-aware via two cron rows). For every active
// closer (or admin acting as closer) with at least one call last week,
// builds a recap card: calls booked, showed, closed, close rate, cash
// collected, commission earned, vs. the prior 4-week rolling average +
// their team rank for the week (anonymized). Claude generates a single
// coaching-insight line. Posted as a DM via the bot.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { isServiceRequest } from "../_shared/supabase-admin.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"
import { sendDirectMessage } from "../_shared/slack-bot.ts"

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

function fmtEUR(cents: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function pctDelta(curr: number, prev: number): string {
  if (prev === 0) return curr > 0 ? "(new)" : "(—)"
  const d = ((curr - prev) / prev) * 100
  const sign = d > 0 ? "▲" : d < 0 ? "▼" : "·"
  return `${sign} ${Math.abs(Math.round(d))}% vs 4-wk avg`
}

interface Closer {
  id: string
  full_name: string
  slack_user_id: string | null
  role: string
}

interface WeekStats {
  closer_id: string
  calls_booked: number
  calls_showed: number
  deals_closed: number
  close_rate_pct: number
  cash_collected_cents: number
  commission_earned_cents: number
}

async function statsForWindow(
  supabase: ReturnType<typeof adminClient>,
  closers: Closer[],
  startIso: string,
  endIso: string
): Promise<Map<string, WeekStats>> {
  const result = new Map<string, WeekStats>()
  for (const c of closers) {
    result.set(c.id, {
      closer_id: c.id,
      calls_booked: 0,
      calls_showed: 0,
      deals_closed: 0,
      close_rate_pct: 0,
      cash_collected_cents: 0,
      commission_earned_cents: 0,
    })
  }

  const { data: leads } = await supabase
    .from("leads")
    .select("closer_id, booked_at")
    .gte("booked_at", startIso)
    .lt("booked_at", endIso)
  for (const l of leads ?? []) {
    if (!l.closer_id) continue
    const s = result.get(l.closer_id)
    if (s) s.calls_booked++
  }

  const { data: outcomes } = await supabase
    .from("call_outcomes")
    .select("closer_id, result, occurred_at")
    .gte("occurred_at", startIso)
    .lt("occurred_at", endIso)
  for (const o of outcomes ?? []) {
    if (!o.closer_id) continue
    const s = result.get(o.closer_id)
    if (!s) continue
    if (o.result === "showed" || o.result === "closed" || o.result === "lost") s.calls_showed++
    if (o.result === "closed") s.deals_closed++
  }

  const { data: commissions } = await supabase
    .from("commission_records")
    .select("closer_id, payment_amount_cents, commission_amount_cents, status")
    .gte("earned_at", startIso)
    .lt("earned_at", endIso)
  for (const cr of commissions ?? []) {
    if (cr.status === "clawed_back") continue
    const s = result.get(cr.closer_id)
    if (!s) continue
    s.cash_collected_cents += cr.payment_amount_cents
    s.commission_earned_cents += cr.commission_amount_cents
  }

  for (const s of result.values()) {
    s.close_rate_pct =
      s.calls_showed === 0
        ? 0
        : Math.round((s.deals_closed / s.calls_showed) * 100)
  }
  return result
}

async function generateInsight(
  thisWeek: WeekStats,
  rolling: WeekStats,
  closerName: string
): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY")
  if (!key) return ""
  try {
    const prompt = `You are coaching ${closerName}, a closer at a Dutch ecommerce coaching company (Fundament €997, Groepscoaching €2997, 1-1 Coaching €4997, Nick 1-1 €6997). Write ONE concise sentence (max 25 words) acknowledging or coaching based on these numbers:

This week: ${thisWeek.calls_booked} booked, ${thisWeek.calls_showed} showed, ${thisWeek.deals_closed} closed (${thisWeek.close_rate_pct}% close rate), ${fmtEUR(thisWeek.cash_collected_cents)} collected.
4-week avg: ${rolling.calls_booked} booked, ${rolling.calls_showed} showed, ${rolling.deals_closed} closed (${rolling.close_rate_pct}% close rate), ${fmtEUR(rolling.cash_collected_cents)} collected.

Plain text, no preamble, no "Hi" or greeting. Just the insight.`

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-7",
        max_tokens: 80,
        messages: [{ role: "user", content: prompt }],
      }),
    })
    if (!r.ok) return ""
    const j = (await r.json()) as { content: { text: string }[] }
    return j.content?.[0]?.text?.trim() ?? ""
  } catch {
    return ""
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (!isServiceRequest(req)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  const supabase = adminClient()

  const { data: flag } = await supabase
    .from("automation_settings")
    .select("enabled")
    .eq("key", "commission_tracking_enabled")
    .maybeSingle()
  if (!flag?.enabled)
    return jsonResponse({ ok: true, skipped: "commission_tracking_enabled is off" })

  // Window: previous ISO week (Mon 00:00 → next Mon 00:00, Amsterdam)
  const now = new Date()
  // Yesterday in Amsterdam ≈ now - 24h is the prior Sunday, but easier:
  // last Monday is today - 7 days (since cron runs on Monday).
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00+02:00")
  const lastMon = new Date(today.getTime() - 7 * 24 * 3600 * 1000)
  const thisMon = today
  const fourWeeksBack = new Date(today.getTime() - 35 * 24 * 3600 * 1000)

  const { data: closers } = await supabase
    .from("team_members")
    .select("id, full_name, slack_user_id, role")
    .in("role", ["closer", "admin"])
    .eq("is_active", true)
  const list = (closers ?? []) as Closer[]
  if (list.length === 0) return jsonResponse({ ok: true, sent: 0 })

  const weekStats = await statsForWindow(supabase, list, lastMon.toISOString(), thisMon.toISOString())
  const baselineStats = await statsForWindow(
    supabase,
    list,
    fourWeeksBack.toISOString(),
    lastMon.toISOString()
  )

  // Rank closers by cash collected this week (anonymous to each individual)
  const ranked = [...weekStats.values()].sort(
    (a, b) => b.cash_collected_cents - a.cash_collected_cents
  )
  const rankByCloser = new Map(ranked.map((s, idx) => [s.closer_id, idx + 1]))
  const totalRanked = ranked.length

  const botToken = Deno.env.get("SLACK_BOT_TOKEN") ?? ""
  let sent = 0
  const results: { closer_id: string; ok: boolean; skipped?: string }[] = []

  for (const c of list) {
    const wk = weekStats.get(c.id)!
    const base = baselineStats.get(c.id)!
    const baseAvg: WeekStats = {
      ...base,
      calls_booked: Math.round(base.calls_booked / 4),
      calls_showed: Math.round(base.calls_showed / 4),
      deals_closed: Math.round(base.deals_closed / 4),
      cash_collected_cents: Math.round(base.cash_collected_cents / 4),
      commission_earned_cents: Math.round(base.commission_earned_cents / 4),
    }

    if (wk.calls_booked === 0 && wk.cash_collected_cents === 0) {
      results.push({ closer_id: c.id, ok: true, skipped: "no activity" })
      continue
    }
    if (!c.slack_user_id) {
      results.push({ closer_id: c.id, ok: false, skipped: "no slack_user_id" })
      continue
    }

    const rank = rankByCloser.get(c.id)
    const insight = await generateInsight(wk, baseAvg, c.full_name)

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: ":calendar: Your week in review", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${c.full_name}, here's last week (${lastMon.toISOString().slice(5, 10)} → ${thisMon.toISOString().slice(5, 10)}):`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Calls booked:*\n${wk.calls_booked} ${pctDelta(wk.calls_booked, baseAvg.calls_booked)}`,
          },
          {
            type: "mrkdwn",
            text: `*Showed:*\n${wk.calls_showed} ${pctDelta(wk.calls_showed, baseAvg.calls_showed)}`,
          },
          {
            type: "mrkdwn",
            text: `*Closed:*\n${wk.deals_closed} ${pctDelta(wk.deals_closed, baseAvg.deals_closed)}`,
          },
          {
            type: "mrkdwn",
            text: `*Close rate:*\n${wk.close_rate_pct}% (4-wk: ${baseAvg.close_rate_pct}%)`,
          },
          {
            type: "mrkdwn",
            text: `*Cash collected:*\n${fmtEUR(wk.cash_collected_cents)} ${pctDelta(wk.cash_collected_cents, baseAvg.cash_collected_cents)}`,
          },
          {
            type: "mrkdwn",
            text: `*Commission earned:*\n${fmtEUR(wk.commission_earned_cents)}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Rank this week:* #${rank} of ${totalRanked} (by cash collected)`,
        },
      },
      ...(insight
        ? [
            {
              type: "section",
              text: { type: "mrkdwn", text: `:bulb: *Coach's note*\n${insight}` },
            },
          ]
        : []),
    ]

    if (botToken) {
      const r = await sendDirectMessage(botToken, c.slack_user_id, {
        text: `Weekly recap — ${fmtEUR(wk.cash_collected_cents)} collected, ${fmtEUR(wk.commission_earned_cents)} commission`,
        blocks,
      })
      results.push({ closer_id: c.id, ok: r.ok })
      if (r.ok) sent++
    }
  }

  // A run with everyone legitimately skipped (no activity / no slack_user_id
  // counts as not-sent but is reported as ok:true) is still a *success*. Only
  // a real send failure (ok:false on any closer) flips this to "failed".
  const anyFailure = results.some((r) => !r.ok)
  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: "commission.weekly_recap",
    status: anyFailure ? "failed" : "success",
    request_payload: { window: [lastMon, thisMon] },
    response_payload: { sent, total: list.length, results },
  })

  return jsonResponse({ ok: true, sent, total: list.length, results })
})
