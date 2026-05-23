// POST /check-overdue-payments
//
// Daily cron at 09:00 Amsterdam (07:00 UTC summer / 08:00 UTC winter via
// two cron rows in 0021 follow-up). Finds scheduled installments past
// their grace period, flips them to status='failed', logs an
// overdue_detected recovery event, and fires one summary alert per
// closer to #b-payment-failed plus an admin rollup.
//
// Idempotent — installments already at status='failed' won't be re-flipped.
// Gated by automation_settings.recovery_enabled.
//
// Auth: gateway enforces JWT (service_role from pg_cron, or admin testing).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { isServiceRequest } from "../_shared/supabase-admin.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"
import { leadDeepLink, slackMention } from "../_shared/slack.ts"
import { postMessage } from "../_shared/slack-bot.ts"
import { tierByKey } from "../_shared/tiers.ts"

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
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function fmtDate(d: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(d + "T00:00:00Z"))
}

function daysOverdue(dueDate: string): number {
  const due = new Date(dueDate + "T00:00:00Z").getTime()
  const now = Date.now()
  return Math.max(0, Math.floor((now - due) / (24 * 3600 * 1000)))
}

interface OverdueRow {
  id: string
  deal_id: string
  seq: number
  amount_cents: number
  due_date: string
  grace_period_days: number
  deal: {
    id: string
    lead_id: string
    coaching_tier: string | null
    amount_cents: number
    lead: { full_name: string; email: string | null; closer_id: string | null } | null
    closer: { id: string; full_name: string; slack_user_id: string | null } | null
  } | null
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (!isServiceRequest(req)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  const supabase = adminClient()

  // Feature flag check
  const { data: flag } = await supabase
    .from("automation_settings")
    .select("enabled")
    .eq("key", "recovery_enabled")
    .maybeSingle()
  if (!flag?.enabled) {
    return jsonResponse({ ok: true, skipped: "recovery_enabled is off" })
  }

  // Find installments past their grace period.
  // We compute "now - grace_period_days days < due_date" in JS rather than
  // SQL because grace_period_days lives per-row. Pull candidates first.
  const { data: candidates, error: candErr } = await supabase
    .from("deal_installments")
    .select(
      "id, deal_id, seq, amount_cents, due_date, grace_period_days, " +
        "deal:deals(id, lead_id, coaching_tier, amount_cents, " +
          "lead:leads(full_name, email, closer_id), " +
          "closer:team_members!deals_closed_by_id_fkey(id, full_name, slack_user_id)" +
        ")"
    )
    .eq("status", "scheduled")
    .lte("due_date", new Date().toISOString().slice(0, 10))

  if (candErr) {
    return jsonResponse({ error: candErr.message }, { status: 500 })
  }

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const overdue = ((candidates ?? []) as unknown as OverdueRow[]).filter((row) => {
    const due = new Date(row.due_date + "T00:00:00Z")
    const cutoff = new Date(
      today.getTime() - row.grace_period_days * 24 * 3600 * 1000
    )
    return due.getTime() <= cutoff.getTime()
  })

  if (overdue.length === 0) {
    await logIntegration(supabase, {
      provider: "slack",
      direction: "outbound",
      event_type: "recovery.check",
      status: "success",
      request_payload: { newly_failed: 0 },
    })
    return jsonResponse({ ok: true, newly_failed: 0 })
  }

  // Flip status + log events
  const nowIso = new Date().toISOString()
  const ids = overdue.map((o) => o.id)

  const { error: upErr } = await supabase
    .from("deal_installments")
    .update({
      status: "failed",
      failed_at: nowIso,
      failure_reason: "Past grace period (cron-detected)",
    })
    .in("id", ids)
    .eq("status", "scheduled")
  if (upErr) {
    return jsonResponse({ error: `Status flip failed: ${upErr.message}` }, { status: 500 })
  }

  const eventRows = overdue
    .filter((o) => o.deal?.lead_id)
    .map((o) => ({
      installment_id: o.id,
      deal_id: o.deal_id,
      lead_id: o.deal!.lead_id,
      event_type: "overdue_detected",
      is_system: true,
      metadata: {
        days_overdue: daysOverdue(o.due_date),
        amount_cents: o.amount_cents,
        grace_period_days: o.grace_period_days,
      },
    }))
  if (eventRows.length > 0) {
    await supabase.from("payment_recovery_events").insert(eventRows)
  }

  // Group by closer for the alert
  type Bucket = { closer: OverdueRow["deal"] extends infer T ? T : never; rows: OverdueRow[] }
  const byCloser = new Map<string, { closer: OverdueRow["deal"]["closer"]; rows: OverdueRow[] }>()
  for (const o of overdue) {
    const closer = o.deal?.closer ?? null
    const key = closer?.id ?? "__unassigned__"
    const bucket = byCloser.get(key) ?? { closer, rows: [] }
    bucket.rows.push(o)
    byCloser.set(key, bucket)
  }

  const botToken = Deno.env.get("SLACK_BOT_TOKEN") ?? ""
  const channel = Deno.env.get("SLACK_CHANNEL_PAYMENT_FAILED") ?? "#b-payment-failed"

  const closerResults: { closer_id: string; ok: boolean; error: string | null }[] = []
  if (botToken) {
    for (const [key, bucket] of byCloser) {
      const closer = bucket.closer
      const closerLine = closer
        ? slackMention(closer.slack_user_id) ?? `*${closer.full_name}*`
        : "_Unassigned closer_"

      const totalCents = bucket.rows.reduce((s, r) => s + r.amount_cents, 0)
      const lineItems = bucket.rows.map((r) => {
        const lead = r.deal?.lead
        const tier = tierByKey(r.deal?.coaching_tier ?? null)?.label ?? "—"
        const days = daysOverdue(r.due_date)
        return `• *${lead?.full_name ?? "Unknown lead"}* (${tier}) — *${fmtEUR(r.amount_cents)}* · due ${fmtDate(r.due_date)} · *${days}d overdue*\n   <${leadDeepLink(r.deal!.lead_id)}|Open in CRM>`
      })

      const blocks = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `:warning: Overdue payment${bucket.rows.length > 1 ? "s" : ""} detected`,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${closerLine} — *${bucket.rows.length}* installment${bucket.rows.length > 1 ? "s" : ""} totaling *${fmtEUR(totalCents)}* just flipped past grace period.`,
          },
        },
        { type: "section", text: { type: "mrkdwn", text: lineItems.join("\n\n") } },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "Recovery sequence runs daily — Day 3 the closer gets a tagged alert, Day 7 admin escalation, Day 14 access pause.",
            },
          ],
        },
      ]

      const r = await postMessage(botToken, {
        channel,
        text: `${bucket.rows.length} overdue installment${bucket.rows.length > 1 ? "s" : ""} for ${closer?.full_name ?? "unassigned closer"} — ${fmtEUR(totalCents)}`,
        blocks,
      })
      closerResults.push({ closer_id: key, ok: r.ok, error: r.error })
    }

    // Admin rollup
    const totalCents = overdue.reduce((s, r) => s + r.amount_cents, 0)
    await postMessage(botToken, {
      channel,
      text: `Daily recovery sweep: ${overdue.length} new overdue (${fmtEUR(totalCents)})`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:bar_chart: *Daily sweep summary* — ${overdue.length} new overdue installment${overdue.length > 1 ? "s" : ""} across ${byCloser.size} closer${byCloser.size > 1 ? "s" : ""}. Total at risk: *${fmtEUR(totalCents)}*.`,
          },
        },
      ],
    })
  }

  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: "recovery.check",
    status: "success",
    request_payload: {
      newly_failed: overdue.length,
      closer_buckets: byCloser.size,
    },
    response_payload: { closer_results: closerResults },
  })

  return jsonResponse({
    ok: true,
    newly_failed: overdue.length,
    closer_buckets: byCloser.size,
    closer_results: closerResults,
  })
})
