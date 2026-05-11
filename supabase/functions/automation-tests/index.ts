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

type TestId = "call_booked" | "call_cancelled" | "pre_call" | "eod" | "subscriptions"

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
    body.tests ?? ["call_booked", "call_cancelled", "pre_call", "eod", "subscriptions"]
  )

  const supabase = adminClient()
  const authHeader = req.headers.get("authorization") ?? ""

  const tasks: Promise<TestResult | TestResult[]>[] = []
  if (wanted.has("call_booked")) tasks.push(testCallBooked(supabase))
  if (wanted.has("call_cancelled")) tasks.push(testCallCancelled(supabase))
  if (wanted.has("pre_call")) tasks.push(testPreCall(supabase))
  if (wanted.has("eod")) tasks.push(testEod(authHeader))
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
