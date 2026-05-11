// POST /notify-commission-earned
//
// Called from the CRM right after a payment is recorded. The
// trg_create_commission_on_payment trigger has already inserted the
// commission_records row by the time we get here (triggers run inside
// the same txn as the INSERT, before the client gets a response). We
// look it up by payment_id and DM the closer with their cut.
//
// Body: { payment_id: string }
//
// Idempotent — Slack DM is fire-and-forget, no DB writes here beyond
// integrations_log.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"
import { leadDeepLink } from "../_shared/slack.ts"
import { sendDirectMessage } from "../_shared/slack-bot.ts"
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  let body: { payment_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.payment_id)
    return jsonResponse({ error: "Missing payment_id" }, { status: 400 })

  const supabase = adminClient()

  const { data: flag } = await supabase
    .from("automation_settings")
    .select("enabled")
    .eq("key", "commission_tracking_enabled")
    .maybeSingle()
  if (!flag?.enabled) {
    return jsonResponse({ ok: true, skipped: "commission_tracking_enabled is off" })
  }

  const { data: record } = await supabase
    .from("commission_records")
    .select(
      "id, payment_amount_cents, commission_rate, commission_amount_cents, " +
        "earned_at, installment_id, deal_id, lead_id, closer_id, " +
        "closer:team_members!commission_records_closer_id_fkey(full_name, slack_user_id), " +
        "lead:leads(full_name), " +
        "deal:deals(coaching_tier, amount_cents)"
    )
    .eq("payment_id", body.payment_id)
    .maybeSingle()

  if (!record) {
    return jsonResponse({ ok: true, skipped: "no commission for this payment" })
  }

  // Skip backfilled records — only fire for fresh payments
  const earnedAge = Date.now() - new Date(record.earned_at).getTime()
  if (earnedAge > 24 * 3600 * 1000) {
    return jsonResponse({ ok: true, skipped: "backfilled" })
  }

  const closer = (record.closer ?? {}) as {
    full_name?: string
    slack_user_id?: string | null
  }
  if (!closer.slack_user_id) {
    await logIntegration(supabase, {
      provider: "slack",
      direction: "outbound",
      event_type: "commission.earned.no_slack_id",
      status: "failed",
      error: `Closer ${closer.full_name ?? record.closer_id} has no slack_user_id`,
      related_lead_id: record.lead_id,
    })
    return jsonResponse({ ok: false, error: "Closer has no slack_user_id" })
  }

  const lead = (record.lead ?? {}) as { full_name?: string }
  const deal = (record.deal ?? {}) as { coaching_tier?: string; amount_cents?: number }
  const tier = tierByKey(deal.coaching_tier ?? null)?.label ?? "—"

  // Cumulative progress on the deal
  const { data: progress } = await supabase
    .from("commission_records")
    .select("payment_amount_cents, commission_amount_cents, status")
    .eq("deal_id", record.deal_id)
  const cashCollected = (progress ?? [])
    .filter((r) => r.status !== "clawed_back")
    .reduce((s, r) => s + r.payment_amount_cents, 0)
  const commissionTotal = (progress ?? [])
    .filter((r) => r.status !== "clawed_back")
    .reduce((s, r) => s + r.commission_amount_cents, 0)
  const contract = deal.amount_cents ?? 0
  const pct = contract > 0 ? Math.round((cashCollected / contract) * 100) : 0

  // Installment context
  let installmentLine = ""
  if (record.installment_id) {
    const { data: inst } = await supabase
      .from("deal_installments")
      .select("seq")
      .eq("deal_id", record.deal_id)
    const total = inst?.length ?? 0
    const { data: thisInst } = await supabase
      .from("deal_installments")
      .select("seq")
      .eq("id", record.installment_id)
      .maybeSingle()
    if (thisInst && total > 0) {
      installmentLine = ` (installment ${thisInst.seq} of ${total})`
    }
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `:moneybag: Commission earned: ${fmtEUR(record.commission_amount_cents)}`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Payment from *${lead.full_name ?? "Unknown lead"}* — *${fmtEUR(record.payment_amount_cents)}* collected${installmentLine}.`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Tier:*\n${tier}` },
        { type: "mrkdwn", text: `*Rate:*\n${record.commission_rate}%` },
        {
          type: "mrkdwn",
          text: `*Deal total collected:*\n${fmtEUR(cashCollected)} of ${fmtEUR(contract)} (${pct}%)`,
        },
        {
          type: "mrkdwn",
          text: `*Commission on this deal so far:*\n${fmtEUR(commissionTotal)}`,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in CRM", emoji: true },
          url: leadDeepLink(record.lead_id),
          style: "primary",
        },
      ],
    },
  ]

  const botToken = Deno.env.get("SLACK_BOT_TOKEN") ?? ""
  let ok = false
  let error: string | null = null
  if (botToken) {
    const r = await sendDirectMessage(botToken, closer.slack_user_id, {
      text: `Commission earned: ${fmtEUR(record.commission_amount_cents)} from ${lead.full_name ?? "lead"}`,
      blocks,
    })
    ok = r.ok
    error = r.error
  } else {
    error = "SLACK_BOT_TOKEN missing"
  }

  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: "commission.earned.dm",
    status: ok ? "success" : "failed",
    request_payload: {
      commission_record_id: record.id,
      closer_id: record.closer_id,
    },
    error,
    related_lead_id: record.lead_id,
  })

  return jsonResponse({ ok, error })
})
