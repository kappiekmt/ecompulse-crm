// POST /automation-tests
//
// Admin-only. Fires synthetic events at every wired Slack automation so the
// user can see end-to-end whether each channel/template still works. Returns
// a structured report — one row per automation with status + error.
//
// Body: { tests?: ("call_booked"|"call_cancelled"|"pre_call"|"eod")[] }
//   - omit tests → run all
//   - the EOD test runs the real /eod-report endpoint (which itself posts to
//     Slack) so we don't duplicate logic.
//
// Auth: caller must be an admin team_member. We re-issue our own service-role
// admin client for the actual DB reads, so the function works even when the
// caller's RLS would block direct table access.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, getIntegrationConfig } from "../_shared/supabase-admin.ts"
import {
  formatLocalTime,
  postToSlack,
  slackMention,
} from "../_shared/slack.ts"

type TestId =
  | "call_booked"
  | "call_cancelled"
  | "pre_call"
  | "eod"
  | "eow"
  | "deal_closed"
  | "commission"
  | "onboarding"
  | "recovery"
  | "subscriptions"

interface TestResult {
  id: TestId | string
  label: string
  ok: boolean
  status?: number | null
  detail?: string
  error?: string | null
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

async function authorize(req: Request): Promise<Response | null> {
  const auth = req.headers.get("authorization") ?? ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return jsonResponse({ error: "Missing bearer token" }, { status: 401 })
  const token = m[1].trim()

  const url = Deno.env.get("SUPABASE_URL")
  const anon = (Deno.env.get("SB_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"))
  if (!url || !anon) return jsonResponse({ error: "Server misconfigured" }, { status: 500 })

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: me } = await userClient.from("team_members").select("role").limit(2)
  if (!me?.length || me.every((r) => r.role !== "admin")) {
    return jsonResponse({ error: "Admin access required" }, { status: 403 })
  }
  return null
}

const SAMPLE_LEAD = {
  id: "00000000-0000-0000-0000-000000000001",
  full_name: "Test Lead",
  email: "test@ecompulse.test",
  phone: "31612345678",
  instagram: "@test_lead",
}

async function pickSampleCloser(
  supabase: ReturnType<typeof adminClient>
): Promise<{ full_name: string; slack_user_id: string | null; timezone: string | null } | null> {
  const { data } = await supabase
    .from("team_members")
    .select("full_name, slack_user_id, timezone")
    .in("role", ["closer", "admin"])
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// ─── call.booked test ───────────────────────────────────────────────────────

async function testCallBooked(
  supabase: ReturnType<typeof adminClient>
): Promise<TestResult> {
  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhook = slackConfig?.bookings_webhook_url
  if (!webhook) {
    return {
      id: "call_booked",
      label: "Slack — call.booked",
      ok: false,
      error: "No bookings_webhook_url configured in Slack integration",
    }
  }
  const closer = await pickSampleCloser(supabase)
  const closerLine = closer
    ? slackMention(closer.slack_user_id) ?? `*${closer.full_name}*`
    : "_Unassigned_"
  const scheduledAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  const whenLine = formatLocalTime(scheduledAt, closer?.timezone ?? "Europe/Amsterdam")

  const message = {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🧪 TEST · 📅 New strategy call booked", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${SAMPLE_LEAD.full_name}* booked a strategy call.`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*When:*\n${whenLine}` },
          { type: "mrkdwn", text: `*Closer:*\n${closerLine}` },
          { type: "mrkdwn", text: `*Email:*\n${SAMPLE_LEAD.email}` },
          { type: "mrkdwn", text: `*Phone:*\n${SAMPLE_LEAD.phone}` },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "_This is a test fire from the CRM — no real lead created._" },
        ],
      },
    ],
  }
  const r = await postToSlack(webhook, message)
  return {
    id: "call_booked",
    label: "Slack — call.booked",
    ok: r.ok,
    status: r.status,
    detail: closer ? `as ${closer.full_name}` : "no active closer in DB",
    error: r.error,
  }
}

// ─── call.cancelled test ────────────────────────────────────────────────────

async function testCallCancelled(
  supabase: ReturnType<typeof adminClient>
): Promise<TestResult> {
  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhook =
    slackConfig?.cancellations_webhook_url || slackConfig?.bookings_webhook_url
  if (!webhook) {
    return {
      id: "call_cancelled",
      label: "Slack — call.cancelled",
      ok: false,
      error: "No cancellations_webhook_url or bookings_webhook_url configured",
    }
  }
  const closer = await pickSampleCloser(supabase)
  const closerLine = closer
    ? slackMention(closer.slack_user_id) ?? `*${closer.full_name}*`
    : "_Unassigned_"

  const message = {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🧪 TEST · 🚫 Strategy call cancelled", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${SAMPLE_LEAD.full_name}* cancelled their strategy call.`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Closer:*\n${closerLine}` },
          { type: "mrkdwn", text: `*Email:*\n${SAMPLE_LEAD.email}` },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "_This is a test fire from the CRM — no real lead affected._" },
        ],
      },
    ],
  }
  const r = await postToSlack(webhook, message)
  return {
    id: "call_cancelled",
    label: "Slack — call.cancelled",
    ok: r.ok,
    status: r.status,
    detail: webhook === slackConfig?.cancellations_webhook_url
      ? "→ cancellations channel"
      : "→ bookings channel (no dedicated cancellations URL set)",
    error: r.error,
  }
}

// ─── pre-call reminder test ─────────────────────────────────────────────────

async function testPreCall(
  supabase: ReturnType<typeof adminClient>
): Promise<TestResult> {
  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhook =
    slackConfig?.precall_webhook_url || slackConfig?.bookings_webhook_url
  if (!webhook) {
    return {
      id: "pre_call",
      label: "Slack — pre-call reminder",
      ok: false,
      error: "No precall_webhook_url or bookings_webhook_url configured",
    }
  }
  const closer = await pickSampleCloser(supabase)
  const closerLine = closer
    ? slackMention(closer.slack_user_id) ?? `*${closer.full_name}*`
    : "_Unassigned_"
  const inFifteen = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  const whenLine = formatLocalTime(inFifteen, closer?.timezone ?? "Europe/Amsterdam")

  const message = {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🧪 TEST · ⏰ Pre-call SOP reminder", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${closerLine} — your call with *${SAMPLE_LEAD.full_name}* starts in 15 minutes. Run the pre-call SOP now.`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*When:*\n${whenLine}` },
          { type: "mrkdwn", text: `*Lead:*\n${SAMPLE_LEAD.full_name}` },
          { type: "mrkdwn", text: `*Email:*\n${SAMPLE_LEAD.email}` },
          { type: "mrkdwn", text: `*Phone:*\n${SAMPLE_LEAD.phone}` },
        ],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "_Test fire — no real call scheduled._" }],
      },
    ],
  }
  const r = await postToSlack(webhook, message)
  return {
    id: "pre_call",
    label: "Slack — pre-call reminder",
    ok: r.ok,
    status: r.status,
    error: r.error,
  }
}

// ─── EOD report (delegates to /eod-report) ──────────────────────────────────

async function testEod(authHeader: string): Promise<TestResult> {
  const url = Deno.env.get("SUPABASE_URL")
  if (!url) return { id: "eod", label: "EOD report", ok: false, error: "SUPABASE_URL missing" }
  try {
    const res = await fetch(`${url}/functions/v1/eod-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: "{}",
    })
    const txt = (await res.text()).slice(0, 200)
    return {
      id: "eod",
      label: "EOD report",
      ok: res.ok,
      status: res.status,
      detail: txt,
      error: res.ok ? null : `eod-report returned ${res.status}`,
    }
  } catch (err) {
    return {
      id: "eod",
      label: "EOD report",
      ok: false,
      error: (err as Error).message,
    }
  }
}

// ─── EOW report (delegates to /eow-report) ──────────────────────────────────

async function testEow(authHeader: string): Promise<TestResult> {
  const url = Deno.env.get("SUPABASE_URL")
  if (!url) return { id: "eow", label: "EOW report", ok: false, error: "SUPABASE_URL missing" }
  try {
    const res = await fetch(`${url}/functions/v1/eow-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: "{}",
    })
    const txt = (await res.text()).slice(0, 200)
    return {
      id: "eow",
      label: "EOW report",
      ok: res.ok,
      status: res.status,
      detail: txt,
      error: res.ok ? null : `eow-report returned ${res.status}`,
    }
  } catch (err) {
    return { id: "eow", label: "EOW report", ok: false, error: (err as Error).message }
  }
}

// ─── deal closed / payment (posts a TEST card to #payments) ──────────────────

async function testDealClosed(
  supabase: ReturnType<typeof adminClient>
): Promise<TestResult> {
  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhook = slackConfig?.payments_webhook_url
  if (!webhook) {
    return {
      id: "deal_closed",
      label: "Slack — deal closed / payment",
      ok: false,
      error: "No payments_webhook_url configured in Slack integration",
    }
  }
  const closer = await pickSampleCloser(supabase)
  const closerLine = closer
    ? slackMention(closer.slack_user_id) ?? `*${closer.full_name}*`
    : "_Unassigned_"
  const message = {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🧪 TEST · 💰 Deal closed", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${SAMPLE_LEAD.full_name}* closed — *€997* collected.` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Closer:*\n${closerLine}` },
          { type: "mrkdwn", text: `*Program:*\nEcomPulse Coaching` },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "_Test fire from the CRM — no real deal or payment created._" },
        ],
      },
    ],
  }
  const r = await postToSlack(webhook, message)
  return {
    id: "deal_closed",
    label: "Slack — deal closed / payment",
    ok: r.ok,
    status: r.status,
    detail: "→ payments channel",
    error: r.error,
  }
}

// ─── Readiness checks (NOT fired — these have real external side effects) ────
// commission DMs a real closer, onboarding creates a real Discord invite, and
// recovery flips installments to `failed` + dunns real customers. We verify
// each is wired/configured instead of triggering it.

async function testCommissionReadiness(
  supabase: ReturnType<typeof adminClient>
): Promise<TestResult> {
  const issues: string[] = []
  if (!Deno.env.get("SLACK_BOT_TOKEN")) issues.push("SLACK_BOT_TOKEN secret not set")
  const { data: toggle } = await supabase
    .from("automation_settings")
    .select("enabled")
    .eq("key", "commission_tracking_enabled")
    .maybeSingle()
  if (!toggle) issues.push("commission_tracking_enabled toggle missing")
  else if (toggle.enabled === false) issues.push("commission_tracking_enabled is off")
  const { data: dmTargets } = await supabase
    .from("team_members")
    .select("id")
    .in("role", ["closer", "admin"])
    .eq("is_active", true)
    .not("slack_user_id", "is", null)
    .limit(1)
  if (!dmTargets?.length) issues.push("no active closer has a slack_user_id (no DM target)")
  const ok = issues.length === 0
  return {
    id: "commission",
    label: "Commission DM (readiness — not fired)",
    ok,
    detail: ok ? "ready: bot token + toggle + DM target all present" : undefined,
    error: ok ? null : issues.join("; "),
  }
}

async function testOnboardingReadiness(
  supabase: ReturnType<typeof adminClient>
): Promise<TestResult> {
  const issues: string[] = []
  const cfg = await getIntegrationConfig(supabase, "discord")
  if (!cfg?.bot_token) issues.push("discord bot_token not set")
  if (!cfg?.welcome_channel_id) issues.push("discord welcome_channel_id not set")
  const ok = issues.length === 0
  return {
    id: "onboarding",
    label: "Onboarding chain (readiness — not fired)",
    ok,
    detail: ok ? "ready: Discord invite configured" : undefined,
    error: ok ? null : issues.join("; "),
  }
}

async function testRecoveryReadiness(
  supabase: ReturnType<typeof adminClient>
): Promise<TestResult> {
  const issues: string[] = []
  if (!Deno.env.get("SLACK_BOT_TOKEN")) issues.push("SLACK_BOT_TOKEN secret not set")
  const { data: toggle } = await supabase
    .from("automation_settings")
    .select("enabled")
    .eq("key", "recovery_enabled")
    .maybeSingle()
  if (!toggle) issues.push("recovery_enabled toggle missing")
  else if (toggle.enabled === false) issues.push("recovery_enabled is off")
  const ok = issues.length === 0
  return {
    id: "recovery",
    label: "Payment recovery (readiness — not fired)",
    ok,
    detail: ok
      ? "ready: toggle on + bot token present (note: verify the daily cron is registered)"
      : undefined,
    error: ok ? null : issues.join("; "),
  }
}

// ─── Outbound webhook subscriptions ─────────────────────────────────────────

async function testSubscriptions(
  supabase: ReturnType<typeof adminClient>,
  authHeader: string
): Promise<TestResult[]> {
  const { data: subs } = await supabase
    .from("webhook_subscriptions")
    .select("id, label, target_url, is_active, event_types")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
  if (!subs?.length) {
    return [
      {
        id: "subscriptions",
        label: "Outbound webhook subscriptions",
        ok: true,
        detail: "no active subscriptions to test",
      },
    ]
  }
  const url = Deno.env.get("SUPABASE_URL")
  const out: TestResult[] = []
  for (const s of subs) {
    try {
      const res = await fetch(`${url}/functions/v1/test-fire`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ subscription_id: s.id }),
      })
      const json = (await res.json()) as { ok?: boolean; status?: number; error?: string }
      out.push({
        id: `sub:${s.id}`,
        label: `Webhook → ${s.label}`,
        ok: Boolean(json.ok),
        status: json.status ?? null,
        error: json.error ?? null,
      })
    } catch (err) {
      out.push({
        id: `sub:${s.id}`,
        label: `Webhook → ${s.label}`,
        ok: false,
        error: (err as Error).message,
      })
    }
  }
  return out
}

// ─── Handler ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  const denied = await authorize(req)
  if (denied) return denied

  let body: { tests?: TestId[] } = {}
  try {
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      body = await req.json()
    }
  } catch {
    /* body optional */
  }
  const wanted = new Set<TestId>(
    body.tests ?? [
      "call_booked",
      "call_cancelled",
      "pre_call",
      "eod",
      "eow",
      "deal_closed",
      "commission",
      "onboarding",
      "recovery",
      "subscriptions",
    ]
  )

  const supabase = adminClient()
  const authHeader = req.headers.get("authorization") ?? ""

  const tasks: Promise<TestResult | TestResult[]>[] = []
  if (wanted.has("call_booked")) tasks.push(testCallBooked(supabase))
  if (wanted.has("call_cancelled")) tasks.push(testCallCancelled(supabase))
  if (wanted.has("pre_call")) tasks.push(testPreCall(supabase))
  if (wanted.has("eod")) tasks.push(testEod(authHeader))
  if (wanted.has("eow")) tasks.push(testEow(authHeader))
  if (wanted.has("deal_closed")) tasks.push(testDealClosed(supabase))
  if (wanted.has("commission")) tasks.push(testCommissionReadiness(supabase))
  if (wanted.has("onboarding")) tasks.push(testOnboardingReadiness(supabase))
  if (wanted.has("recovery")) tasks.push(testRecoveryReadiness(supabase))
  if (wanted.has("subscriptions")) tasks.push(testSubscriptions(supabase, authHeader))

  const settled = await Promise.all(tasks)
  const results: TestResult[] = settled.flatMap((r) => (Array.isArray(r) ? r : [r]))

  return jsonResponse({
    ok: results.every((r) => r.ok),
    count: results.length,
    passed: results.filter((r) => r.ok).length,
    results,
  })
})
