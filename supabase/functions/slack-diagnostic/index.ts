// POST /slack-diagnostic
//
// Admin/service-only. Probes the Slack workspace via the bot token to verify
// the channels notify-deal-closed (#payments) and dispatch-reminders (#pre-call)
// expect actually exist, the bot can reach them, and a real test card lands.
//
// Returns per-channel: { exists, channel_id, is_member, posted, slack_error }
// so we can tell the difference between "channel doesn't exist", "bot isn't in
// the channel", and "bot can post fine".
//
// Body (optional): { "channels": ["#payments", "#pre-call", ...] }
// Default probes: #payments, #pre-call, #eod, #bookings.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { isServiceRequest } from "../_shared/supabase-admin.ts"

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

interface SlackChannel {
  id: string
  name: string
  is_member?: boolean
  is_archived?: boolean
  is_private?: boolean
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (!isServiceRequest(req)) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 })
  }

  const bot = Deno.env.get("SLACK_BOT_TOKEN") ?? ""
  if (!bot) return jsonResponse({ error: "SLACK_BOT_TOKEN env var not set" }, { status: 503 })

  let body: { channels?: string[] } = {}
  try {
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      body = await req.json()
    }
  } catch { /* body optional */ }

  const targets = (body.channels ?? ["#payments", "#pre-call", "#eod", "#bookings"]).map(
    (n) => n.replace(/^#/, "")
  )

  // 1. Bot identity.
  const auth: { ok?: boolean; user?: string; team?: string; bot_id?: string; error?: string } =
    await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { Authorization: `Bearer ${bot}` },
    }).then((r) => r.json())

  if (!auth.ok) {
    return jsonResponse({ error: "auth.test failed", detail: auth }, { status: 502 })
  }

  // 2. List channels (public + private the bot can see) — paginate just in case.
  const all: SlackChannel[] = []
  let cursor: string | undefined
  for (let i = 0; i < 10; i++) {
    const u = new URL("https://slack.com/api/conversations.list")
    u.searchParams.set("types", "public_channel,private_channel")
    u.searchParams.set("limit", "200")
    u.searchParams.set("exclude_archived", "true")
    if (cursor) u.searchParams.set("cursor", cursor)
    const r = await fetch(u, { headers: { Authorization: `Bearer ${bot}` } })
    const j = (await r.json()) as { ok: boolean; channels?: SlackChannel[]; response_metadata?: { next_cursor?: string }; error?: string }
    if (!j.ok) break
    for (const c of j.channels ?? []) all.push(c)
    cursor = j.response_metadata?.next_cursor
    if (!cursor) break
  }

  // 3. Per-target: try posting by NAME directly (which works with chat:write.public
  //    even when channels:read isn't granted). If conversations.list also returned
  //    the channel, surface its membership info; otherwise just rely on the post.
  const results: Array<Record<string, unknown>> = []
  for (const name of targets) {
    const ch = all.find((c) => c.name === name)
    const postRes: { ok: boolean; error?: string; ts?: string; channel?: string } = await fetch(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${bot}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: `#${name}`,
          text: `🧪 EcomPulse CRM — slack-diagnostic probe (please ignore — automated channel verification).`,
        }),
      }
    ).then((r) => r.json())
    results.push({
      channel: `#${name}`,
      seen_in_list: Boolean(ch),
      ...(ch ? { channel_id: ch.id, is_private: ch.is_private ?? false, is_member: ch.is_member ?? false } : {}),
      posted: postRes.ok,
      posted_channel_id: postRes.channel ?? null,
      slack_error: postRes.error ?? null,
    })
  }

  return jsonResponse({
    bot: { user: auth.user, team: auth.team, bot_id: auth.bot_id },
    channels_visible_to_bot: all.length,
    results,
  })
})
