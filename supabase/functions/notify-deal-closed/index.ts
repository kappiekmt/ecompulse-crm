// POST /notify-deal-closed
//
// Called from the CRM after a closer logs a closed deal. Reads the freshly
// inserted deal + its installments + the lead + the closer, then posts a
// rich message to the #payments Slack channel.
//
// Body: { deal_id: string }
//
// Auth: any authenticated team member can fire this (gateway enforces JWT).
// We use the admin client for the DB read so RLS doesn't block (a setter
// won't have read access to the deal otherwise).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, getIntegrationConfig, isAutomationEnabled, logIntegration } from "../_shared/supabase-admin.ts"
import { formatLocalTime, leadDeepLink, postToSlack, slackMention } from "../_shared/slack.ts"
import { postMessage } from "../_shared/slack-bot.ts"
import { TIERS, tierByKey } from "../_shared/tiers.ts"

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

function tierLabel(key: string | null | undefined): string {
  const t = tierByKey(key)
  if (t) return t.label
  return key ?? "—"
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  let body: { deal_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.deal_id) return jsonResponse({ error: "Missing deal_id" }, { status: 400 })

  const supabase = adminClient()

  // Honour the "Payment received / deal closed" automation toggle.
  if (!(await isAutomationEnabled(supabase, "payment_received"))) {
    return jsonResponse({ ok: false, skipped: "payment_received automation disabled" })
  }

  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .select(
      "id, lead_id, program, coaching_tier, amount_cents, currency, notes, closed_at, closed_by_id, " +
        "lead:leads(full_name, email, phone, intended_tier), " +
        "closer:team_members!deals_closed_by_id_fkey(full_name, slack_user_id, timezone)"
    )
    .eq("id", body.deal_id)
    .maybeSingle()

  if (dealErr || !deal) {
    return jsonResponse(
      { error: "Deal not found", detail: dealErr?.message ?? null },
      { status: 404 }
    )
  }

  const { data: installments } = await supabase
    .from("deal_installments")
    .select("seq, amount_cents, due_date, paid_at")
    .eq("deal_id", deal.id)
    .order("seq", { ascending: true })

  // Routing: prefer the bot token (it can post to #payments directly via
  // chat:write.public). Fall back to the incoming-webhook URL stored in
  // integration_configs.slack if the bot isn't installed.
  const botToken = Deno.env.get("SLACK_BOT_TOKEN") ?? ""
  const paymentsChannel = Deno.env.get("SLACK_CHANNEL_PAYMENTS") ?? "#payments"
  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhook =
    slackConfig?.payments_webhook_url || slackConfig?.bookings_webhook_url

  if (!botToken && !webhook) {
    await logIntegration(supabase, {
      provider: "slack",
      direction: "outbound",
      event_type: "deal.closed",
      status: "failed",
      error: "No SLACK_BOT_TOKEN and no payments_webhook_url / bookings_webhook_url",
      related_lead_id: deal.lead_id,
    })
    return jsonResponse(
      { error: "Slack not configured for #payments" },
      { status: 500 }
    )
  }

  const lead = (deal.lead ?? {}) as {
    full_name?: string
    email?: string | null
    phone?: string | null
  }
  const closer = (deal.closer ?? {}) as {
    full_name?: string
    slack_user_id?: string | null
    timezone?: string | null
  }

  const total = deal.amount_cents ?? 0
  const paidNow = (installments ?? []).reduce(
    (sum, i) => sum + (i.paid_at ? i.amount_cents : 0),
    0
  )
  const outstanding = total - paidNow

  const installmentLines = (installments ?? []).map((i) => {
    const status = i.paid_at ? ":white_check_mark: paid" : ":hourglass_flowing_sand: due"
    return `${i.seq}. *${fmtEUR(i.amount_cents)}* — ${fmtDate(i.due_date)}  · ${status}`
  })
  const installmentsBlock =
    installmentLines.length > 0
      ? installmentLines.join("\n")
      : "_No installments recorded — full PIF expected._"

  const closerLine = closer.full_name
    ? (slackMention(closer.slack_user_id) ?? `*${closer.full_name}*`)
    : "_Unknown closer_"

  const closedAtLine = deal.closed_at
    ? formatLocalTime(deal.closed_at, closer.timezone ?? "Europe/Amsterdam")
    : "—"

  const message = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `💰  Deal closed  ·  ${tierLabel(deal.coaching_tier)}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${closerLine} closed *${lead.full_name ?? "Unknown lead"}* for *${fmtEUR(total)}*.`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Tier:*\n${tierLabel(deal.coaching_tier)}` },
          { type: "mrkdwn", text: `*Contract value:*\n${fmtEUR(total)}` },
          { type: "mrkdwn", text: `*Paid today:*\n${fmtEUR(paidNow)}` },
          { type: "mrkdwn", text: `*Outstanding:*\n${fmtEUR(outstanding)}` },
          { type: "mrkdwn", text: `*Lead email:*\n${lead.email ?? "—"}` },
          { type: "mrkdwn", text: `*Closed at:*\n${closedAtLine}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Payment schedule:*\n${installmentsBlock}`,
        },
      },
      ...(deal.notes
        ? [
            {
              type: "section",
              text: { type: "mrkdwn", text: `*Notes:*\n${deal.notes}` },
            },
          ]
        : []),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open in CRM", emoji: true },
            url: leadDeepLink(deal.lead_id),
            style: "primary",
          },
        ],
      },
    ],
  }

  let ok = false
  let status: number | null = null
  let errorMsg: string | null = null
  let route: "bot" | "webhook" = "bot"
  let botError: string | null = null

  if (botToken) {
    const fallbackText = `Deal closed — ${tierLabel(deal.coaching_tier)} · ${fmtEUR(total)} · ${lead.full_name ?? "Unknown lead"}`
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
    status = r.status
    errorMsg = r.error
  }

  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: "deal.closed",
    status: ok ? "success" : "failed",
    request_payload: { deal_id: deal.id, route, channel: paymentsChannel },
    response_payload: { status },
    error: errorMsg,
    related_lead_id: deal.lead_id,
  })

  // Silences unused-import warning since TIERS is only used transitively
  // via tierByKey when the deal's tier is set on a future code path.
  void TIERS

  return jsonResponse({ ok, status, route, error: errorMsg, bot_error: botError, channel: paymentsChannel })
})
