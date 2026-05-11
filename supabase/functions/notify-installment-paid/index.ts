// POST /notify-installment-paid
//
// Fired from the CRM after a closer marks a single installment paid in the
// lead drawer. Posts a concise installment-payment card to the same
// #b-new-payment channel as deal.closed, but scoped to *this* payment so
// finance can see every installment as it lands, not just the original close.
//
// Body: { installment_id: string }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, getIntegrationConfig, logIntegration } from "../_shared/supabase-admin.ts"
import { leadDeepLink, postToSlack, slackMention } from "../_shared/slack.ts"
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
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(d + "T00:00:00Z"))
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  let body: { installment_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.installment_id)
    return jsonResponse({ error: "Missing installment_id" }, { status: 400 })

  const supabase = adminClient()

  const { data: inst, error: instErr } = await supabase
    .from("deal_installments")
    .select("id, seq, amount_cents, due_date, paid_at, deal_id")
    .eq("id", body.installment_id)
    .maybeSingle()

  if (instErr || !inst)
    return jsonResponse({ error: "Installment not found" }, { status: 404 })

  const { data: deal } = await supabase
    .from("deals")
    .select(
      "id, lead_id, coaching_tier, amount_cents, " +
        "lead:leads(full_name, email), " +
        "closer:team_members!deals_closed_by_id_fkey(full_name, slack_user_id)"
    )
    .eq("id", inst.deal_id)
    .maybeSingle()

  if (!deal) return jsonResponse({ error: "Deal not found" }, { status: 404 })

  const { data: allInst } = await supabase
    .from("deal_installments")
    .select("amount_cents, paid_at")
    .eq("deal_id", inst.deal_id)
    .order("seq", { ascending: true })

  const total = deal.amount_cents ?? 0
  const paidTotal = (allInst ?? []).reduce(
    (s, i) => s + (i.paid_at ? i.amount_cents : 0),
    0
  )
  const outstanding = Math.max(0, total - paidTotal)
  const installmentCount = (allInst ?? []).length
  const paidCount = (allInst ?? []).filter((i) => i.paid_at).length

  const lead = (deal.lead ?? {}) as { full_name?: string; email?: string | null }
  const closer = (deal.closer ?? {}) as {
    full_name?: string
    slack_user_id?: string | null
  }
  const closerLine = closer.full_name
    ? slackMention(closer.slack_user_id) ?? `*${closer.full_name}*`
    : "_Unknown closer_"
  const tierLabel = tierByKey(deal.coaching_tier)?.label ?? deal.coaching_tier ?? "—"

  const fullyPaid = outstanding === 0

  const headerText = fullyPaid
    ? `:tada: Final payment received — ${lead.full_name ?? "Unknown lead"}`
    : `:moneybag: Payment received — ${lead.full_name ?? "Unknown lead"}`

  const message = {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: headerText, emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${closerLine} marked *installment ${inst.seq}/${installmentCount}* paid — *${fmtEUR(inst.amount_cents)}*.`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Tier:*\n${tierLabel}` },
          { type: "mrkdwn", text: `*Paid in total:*\n${fmtEUR(paidTotal)} of ${fmtEUR(total)}` },
          {
            type: "mrkdwn",
            text: `*Progress:*\n${paidCount}/${installmentCount} installments`,
          },
          { type: "mrkdwn", text: `*Outstanding:*\n${fmtEUR(outstanding)}` },
          { type: "mrkdwn", text: `*Due date:*\n${fmtDate(inst.due_date)}` },
          { type: "mrkdwn", text: `*Email:*\n${lead.email ?? "—"}` },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `<${leadDeepLink(deal.lead_id)}|Open lead in CRM>`,
          },
        ],
      },
    ],
  }

  const botToken = Deno.env.get("SLACK_BOT_TOKEN") ?? ""
  const paymentsChannel = Deno.env.get("SLACK_CHANNEL_PAYMENTS") ?? "#b-new-payment"
  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhook =
    slackConfig?.payments_webhook_url || slackConfig?.bookings_webhook_url

  let ok = false
  let errorMsg: string | null = null
  let route: "bot" | "webhook" = "bot"
  let botError: string | null = null

  if (botToken) {
    const fallbackText = `Payment ${inst.seq}/${installmentCount} · ${fmtEUR(inst.amount_cents)} · ${lead.full_name ?? "Unknown"}`
    const r = await postMessage(botToken, {
      channel: paymentsChannel,
      text: fallbackText,
      blocks: message.blocks,
    })
    ok = r.ok
    errorMsg = r.error
    botError = r.error
  }

  if (!ok && webhook) {
    route = "webhook"
    const r = await postToSlack(webhook, message)
    ok = r.ok
    errorMsg = r.error
  }

  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: fullyPaid ? "deal.fully_paid" : "installment.paid",
    status: ok ? "success" : "failed",
    request_payload: { installment_id: inst.id, deal_id: inst.deal_id, route },
    error: errorMsg,
    related_lead_id: deal.lead_id,
  })

  return jsonResponse({ ok, route, error: errorMsg, bot_error: botError })
})
