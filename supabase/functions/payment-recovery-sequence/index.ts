// POST /payment-recovery-sequence
//
// Daily cron at 10:00 Amsterdam. Walks each failed installment and fires
// the right stage based on days since failed_at:
//
//   Day  1 → reminder_sent       (email/SMS stubbed, logs event)
//   Day  3 → closer_notified     (Slack alert in #b-payment-failed, tagging closer)
//   Day  7 → admin_escalated     (Slack alert with @here)
//   Day 14 → access_paused       (flip student.payment_status, Slack with @channel,
//                                 Discord/Whop revoke stubbed)
//
// Idempotent — before firing a stage we check that event_type hasn't
// already been logged for this installment. Gated by recovery_enabled.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { isServiceRequest } from "../_shared/supabase-admin.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"
import { leadDeepLink, slackMention } from "../_shared/slack.ts"
import { postMessage } from "../_shared/slack-bot.ts"
import { tierByKey } from "../_shared/tiers.ts"

type StageType =
  | "reminder_sent"
  | "closer_notified"
  | "admin_escalated"
  | "access_paused"

interface Stage {
  day: number
  event_type: StageType
  urgency: "low" | "high" | "critical" | "max"
}

const STAGES: Stage[] = [
  { day: 1, event_type: "reminder_sent", urgency: "low" },
  { day: 3, event_type: "closer_notified", urgency: "high" },
  { day: 7, event_type: "admin_escalated", urgency: "critical" },
  { day: 14, event_type: "access_paused", urgency: "max" },
]

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

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000))
}

interface FailedRow {
  id: string
  deal_id: string
  seq: number
  amount_cents: number
  due_date: string
  failed_at: string
  status: string
  deal: {
    id: string
    lead_id: string
    coaching_tier: string | null
    amount_cents: number
    lead: { full_name: string; email: string | null } | null
    closer: { id: string; full_name: string; slack_user_id: string | null } | null
  } | null
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
    .eq("key", "recovery_enabled")
    .maybeSingle()
  if (!flag?.enabled) return jsonResponse({ ok: true, skipped: "recovery_enabled is off" })

  // Pull every failed/recovering installment with its context
  const { data: rows } = await supabase
    .from("deal_installments")
    .select(
      "id, deal_id, seq, amount_cents, due_date, failed_at, status, " +
        "deal:deals(id, lead_id, coaching_tier, amount_cents, " +
          "lead:leads(full_name, email), " +
          "closer:team_members!deals_closed_by_id_fkey(id, full_name, slack_user_id)" +
        ")"
    )
    .in("status", ["failed", "recovering"])
    .not("failed_at", "is", null)

  const failed = ((rows ?? []) as unknown as FailedRow[]).filter((r) => r.deal?.lead_id)
  if (failed.length === 0) return jsonResponse({ ok: true, fired: 0 })

  // Pull all logged events for these installments in one query so the
  // idempotency check is O(1) per stage lookup.
  const ids = failed.map((r) => r.id)
  const { data: priorEvents } = await supabase
    .from("payment_recovery_events")
    .select("installment_id, event_type")
    .in("installment_id", ids)
  const eventKey = (instId: string, type: string) => `${instId}|${type}`
  const fired = new Set<string>(
    (priorEvents ?? []).map((e) => eventKey(e.installment_id, e.event_type))
  )

  const botToken = Deno.env.get("SLACK_BOT_TOKEN") ?? ""
  const channel = Deno.env.get("SLACK_CHANNEL_PAYMENT_FAILED") ?? "#b-payment-failed"

  const results: { installment_id: string; stage: StageType; ok: boolean; error?: string }[] = []

  for (const row of failed) {
    const days = daysSince(row.failed_at)
    // Walk stages in reverse so we only ever fire at most one stage per
    // installment per run (the most-advanced eligible one). Earlier stages
    // are still required to have logged their event — we backfill quietly
    // if the cron missed a day.
    const eligible = STAGES.filter((s) => days >= s.day && !fired.has(eventKey(row.id, s.event_type)))
    if (eligible.length === 0) continue

    for (const stage of eligible) {
      const r = await runStage(supabase, botToken, channel, row, stage, days)
      results.push({ installment_id: row.id, stage: stage.event_type, ...r })
      if (r.ok) fired.add(eventKey(row.id, stage.event_type))
    }
  }

  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: "recovery.sequence",
    status: "success",
    request_payload: { processed: failed.length, fired: results.filter((r) => r.ok).length },
    response_payload: { results },
  })

  return jsonResponse({
    ok: true,
    processed: failed.length,
    fired: results.filter((r) => r.ok).length,
    results,
  })
})

// ─── Stage handlers ─────────────────────────────────────────────────────────

async function runStage(
  supabase: ReturnType<typeof adminClient>,
  botToken: string,
  channel: string,
  row: FailedRow,
  stage: Stage,
  days: number
): Promise<{ ok: boolean; error?: string }> {
  const lead = row.deal!.lead
  const closer = row.deal?.closer
  const tier = tierByKey(row.deal?.coaching_tier ?? null)?.label ?? "—"
  const closerLine = closer
    ? slackMention(closer.slack_user_id) ?? `*${closer.full_name}*`
    : "_Unassigned_"
  const leadName = lead?.full_name ?? "Unknown lead"
  const amount = fmtEUR(row.amount_cents)

  let blocks: unknown[] = []
  let text = ""
  let metadata: Record<string, unknown> = { days_since_failed: days }

  switch (stage.event_type) {
    case "reminder_sent": {
      // Email/SMS stubbed until Gmail/Twilio wired. Log event, no Slack post.
      metadata = {
        ...metadata,
        stub: true,
        channels_attempted: ["email", "sms"],
        todo: "Wire Gmail + Twilio to actually send the reminder.",
      }
      await logIntegration(supabase, {
        provider: "gmail",
        direction: "outbound",
        event_type: "recovery.reminder_stub",
        status: "pending",
        request_payload: { installment_id: row.id, lead_id: row.deal!.lead_id },
        related_lead_id: row.deal!.lead_id,
      })
      await supabase.from("payment_recovery_events").insert({
        installment_id: row.id,
        deal_id: row.deal_id,
        lead_id: row.deal!.lead_id,
        event_type: stage.event_type,
        is_system: true,
        metadata,
      })
      return { ok: true }
    }

    case "closer_notified": {
      text = `:rotating_light: Closer action needed — ${leadName} · ${amount} overdue ${days}d`
      blocks = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🚨  Day 3  ·  Closer action needed`,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${closerLine}, *${leadName}* hasn't paid installment #${row.seq} (*${amount}*, ${tier}) and it's been *${days} days*. Reach out today.`,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Lead:*\n${leadName}` },
            { type: "mrkdwn", text: `*Email:*\n${lead?.email ?? "—"}` },
            { type: "mrkdwn", text: `*Amount:*\n${amount}` },
            { type: "mrkdwn", text: `*Days overdue:*\n${days}` },
          ],
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "I contacted them", emoji: true },
              action_id: `recovery.contacted:${row.id}`,
              style: "primary",
              value: row.id,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Unable to reach", emoji: true },
              action_id: `recovery.unreachable:${row.id}`,
              value: row.id,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Open in CRM", emoji: true },
              url: leadDeepLink(row.deal!.lead_id),
            },
          ],
        },
      ]
      break
    }

    case "admin_escalated": {
      text = `:warning: <!here> Admin escalation — ${leadName} · ${amount} overdue ${days}d`
      blocks = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🚨  Day 7  ·  Admin escalation`,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `<!here> *${leadName}* — installment #${row.seq} (*${amount}*, ${tier}) is *${days} days overdue*. Closer ${closerLine} was notified at Day 3 but no resolution. Consider pausing access at Day 14.`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open in CRM", emoji: true },
              url: leadDeepLink(row.deal!.lead_id),
              style: "primary",
            },
          ],
        },
      ]
      break
    }

    case "access_paused": {
      // Flip student.payment_status and revoke (Discord/Whop stubbed)
      const { data: student } = await supabase
        .from("students")
        .select("id, discord_user_id, whop_membership_id, payment_status")
        .eq("lead_id", row.deal!.lead_id)
        .maybeSingle()
      if (student && student.payment_status !== "paused_payment") {
        await supabase
          .from("students")
          .update({ payment_status: "paused_payment" })
          .eq("id", student.id)
        metadata = {
          ...metadata,
          student_id: student.id,
          discord_revoke_todo: !!student.discord_user_id,
          whop_revoke_todo: !!student.whop_membership_id,
        }
        if (student.discord_user_id) {
          await logIntegration(supabase, {
            provider: "discord",
            direction: "outbound",
            event_type: "recovery.access_paused_stub",
            status: "pending",
            request_payload: { student_id: student.id, action: "remove_tier_role" },
            related_lead_id: row.deal!.lead_id,
          })
        }
        if (student.whop_membership_id) {
          await logIntegration(supabase, {
            provider: "whop",
            direction: "outbound",
            event_type: "recovery.access_paused_stub",
            status: "pending",
            request_payload: { student_id: student.id, action: "revoke_membership" },
            related_lead_id: row.deal!.lead_id,
          })
        }
      } else if (!student) {
        metadata = { ...metadata, no_student_row: true }
      }

      text = `:no_entry: <!channel> Access PAUSED — ${leadName} · ${amount} unpaid ${days}d`
      blocks = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🛑  Day 14  ·  Access paused`,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `<!channel> *${leadName}* has been moved to *paused_payment* status. Installment #${row.seq} (*${amount}*, ${tier}) is *${days} days overdue*. Discord + Whop revoke logged as pending until those APIs are wired.`,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Closer:*\n${closer?.full_name ?? "—"}` },
            { type: "mrkdwn", text: `*Lead email:*\n${lead?.email ?? "—"}` },
            { type: "mrkdwn", text: `*Contract value:*\n${fmtEUR(row.deal?.amount_cents ?? 0)}` },
            { type: "mrkdwn", text: `*Overdue amount:*\n${amount}` },
          ],
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open in CRM", emoji: true },
              url: leadDeepLink(row.deal!.lead_id),
              style: "danger",
            },
          ],
        },
      ]
      break
    }
  }

  let ok = true
  let error: string | null = null
  if (botToken && blocks.length > 0) {
    const r = await postMessage(botToken, { channel, text, blocks })
    ok = r.ok
    error = r.error
  }

  if (ok) {
    await supabase.from("payment_recovery_events").insert({
      installment_id: row.id,
      deal_id: row.deal_id,
      lead_id: row.deal!.lead_id,
      event_type: stage.event_type,
      is_system: true,
      metadata,
    })
  }

  return { ok, error: error ?? undefined }
}
