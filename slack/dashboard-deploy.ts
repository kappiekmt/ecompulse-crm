// Self-contained slack-app function for paste-into-dashboard deployment.
//
// This is a flattened version of supabase/functions/slack-app/index.ts with
// all _shared/ helpers inlined, so it can be deployed via the Supabase
// dashboard without the CLI. When you eventually move to CLI-based deploys,
// use supabase/functions/slack-app/index.ts (the modular version) instead.
//
// Single endpoint dispatches by body shape — Slack can point all three
// integration types (slash commands, events, interactivity) at the same URL:
//   - JSON with `type` field         → Events API
//   - form-encoded with `command`    → slash command
//   - form-encoded with `payload`    → interactivity (buttons/modals)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

const SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET") ?? ""
const BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") ?? ""
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? ""
const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "https://coaching.joinecompulse.com"

// ---------- Supabase admin ----------

function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function logIntegration(
  client: SupabaseClient,
  args: {
    provider: string
    direction: "inbound" | "outbound"
    event_type: string
    status: "pending" | "success" | "failed" | "retrying"
    error?: string | null
    request_payload?: unknown
  },
) {
  await client.from("integrations_log").insert({
    provider: args.provider,
    direction: args.direction,
    event_type: args.event_type,
    status: args.status,
    error: args.error ?? null,
    request_payload: args.request_payload ?? null,
  })
}

// ---------- Slack signature verification ----------

const enc = new TextEncoder()

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let m = 0
  for (let i = 0; i < a.length; i++) m |= a[i] ^ b[i]
  return m === 0
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("v0=") ? hex.slice(3) : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

async function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): Promise<boolean> {
  if (!timestamp || !signature || !SIGNING_SECRET) return false
  const tsNum = Number(timestamp)
  if (!Number.isFinite(tsNum)) return false
  if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 300) return false

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`v0:${timestamp}:${rawBody}`))
  return timingSafeEqual(new Uint8Array(mac), hexToBytes(signature))
}

// ---------- Slack Web API ----------

async function slackApi<T = unknown>(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${BOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  })
  return (await res.json()) as { ok: boolean; error?: string } & T
}

async function postMessage(args: { channel: string; text?: string; blocks?: unknown[]; thread_ts?: string }) {
  return slackApi("chat.postMessage", args as Record<string, unknown>)
}

// ---------- Helpers ----------

function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(body).entries()) out[k] = v
  return out
}

function ephemeral(text: string, blocks?: unknown[]): Response {
  return new Response(JSON.stringify({ response_type: "ephemeral", text, blocks }), {
    headers: { "Content-Type": "application/json" },
  })
}

interface SlashPayload {
  command: string
  text: string
  user_id: string
  user_name: string
  channel_id: string
  response_url: string
  trigger_id: string
}

// ---------- Slash command handlers ----------

async function handleLead(p: SlashPayload) {
  const supabase = adminClient()
  const q = p.text.trim()
  if (!q) return ephemeral("Usage: `/lead <email or name>`")

  const { data } = await supabase
    .from("leads")
    .select("id, full_name, email, stage, scheduled_at")
    .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
    .limit(5)

  if (!data || data.length === 0) return ephemeral(`No leads matched \`${q}\`.`)

  const blocks: unknown[] = data.flatMap((l) => [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${l.full_name ?? "(no name)"}*\n${l.email ?? "—"}\nStage: \`${l.stage}\``,
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Open in CRM" },
        url: `${PUBLIC_APP_URL}/leads?id=${l.id}`,
      },
    },
    { type: "divider" },
  ])

  return new Response(JSON.stringify({ response_type: "ephemeral", blocks }), {
    headers: { "Content-Type": "application/json" },
  })
}

async function handleNote(p: SlashPayload) {
  const supabase = adminClient()
  const text = p.text.trim()
  if (!text) return ephemeral("Usage: `/note <email-or-name> :: <note text>`")

  const [target, ...rest] = text.split("::").map((s) => s.trim())
  const note = rest.join("::").trim()
  if (!target || !note) return ephemeral("Usage: `/note <email-or-name> :: <note text>`")

  const { data: lead } = await supabase
    .from("leads")
    .select("id, full_name")
    .or(`email.ilike.%${target}%,full_name.ilike.%${target}%`)
    .limit(1)
    .maybeSingle()

  if (!lead) return ephemeral(`No lead matched \`${target}\`.`)

  await supabase.from("activities").insert({
    lead_id: lead.id,
    type: "note.added",
    payload: { note, slack_user_id: p.user_id, slack_user_name: p.user_name } as never,
  })

  return ephemeral(`📝 Note added to *${lead.full_name ?? "(unnamed)"}*.`)
}

async function handleStudentStatus(p: SlashPayload) {
  const supabase = adminClient()
  const q = p.text.trim()
  if (!q) return ephemeral("Usage: `/student-status <name or email>`")

  const { data: leads } = await supabase
    .from("leads")
    .select("id, full_name")
    .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
    .limit(10)

  const ids = (leads ?? []).map((l) => l.id)
  if (ids.length === 0) return ephemeral(`No leads matched \`${q}\` — and no students either.`)

  const { data } = await supabase
    .from("students")
    .select(
      "id, program, coaching_tier, onboarding_status, enrolled_at, lead:leads(full_name, email), coach:team_members(full_name)",
    )
    .in("lead_id", ids)
    .limit(5)

  if (!data || data.length === 0) {
    const names = (leads ?? []).map((l) => l.full_name).filter(Boolean).join(", ")
    return ephemeral(
      `Found lead${leads!.length > 1 ? "s" : ""} *${names}* but no student record yet — they haven't paid / been enrolled.`
    )
  }

  const blocks = data.map((s) => {
    const lead = (s.lead ?? {}) as { full_name?: string; email?: string }
    const coach = (s.coach ?? {}) as { full_name?: string }
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${lead.full_name ?? "(no name)"}* — ${lead.email ?? "—"}`,
          `Tier: \`${s.coaching_tier ?? "—"}\` · Status: \`${s.onboarding_status}\``,
          `Coach: ${coach.full_name ?? "(unassigned)"} · Enrolled: ${new Date(s.enrolled_at).toLocaleDateString()}`,
        ].join("\n"),
      },
    }
  })

  return new Response(JSON.stringify({ response_type: "ephemeral", blocks }), {
    headers: { "Content-Type": "application/json" },
  })
}

async function handleSlashCommand(form: SlashPayload): Promise<Response> {
  try {
    switch (form.command) {
      case "/lead": return await handleLead(form)
      case "/note": return await handleNote(form)
      case "/student-status": return await handleStudentStatus(form)
      default: return ephemeral(`Unknown command \`${form.command}\``)
    }
  } catch (err) {
    await logIntegration(adminClient(), {
      provider: "slack",
      direction: "inbound",
      event_type: `command:${form.command}`,
      status: "failed",
      error: (err as Error).message,
    })
    return ephemeral(`Command failed: ${(err as Error).message}`)
  }
}

// ---------- Events API ----------

async function handleAppMention(event: { user: string; channel: string; text: string; ts: string }) {
  const text = event.text.replace(/<@[^>]+>\s*/, "").trim()
  const m = text.match(/^summarize(?:\s+lead)?\s+(.+)$/i)
  if (!m || !ANTHROPIC_KEY) {
    await postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: "Try: `@EcomPulse CRM summarize <lead name or email>`",
    })
    return
  }

  const supabase = adminClient()
  const q = m[1].trim()
  const { data: lead } = await supabase
    .from("leads")
    .select("id, full_name, email, phone, stage, source, scheduled_at, calendly_event_name")
    .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
    .limit(1)
    .maybeSingle()

  if (!lead) {
    await postMessage({ channel: event.channel, thread_ts: event.ts, text: `No lead matched \`${q}\`.` })
    return
  }

  const { data: activities } = await supabase
    .from("activities")
    .select("type, payload, created_at")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(20)

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are a sales-coaching assistant. Summarize this CRM lead in 3 short bullets focused on: who they are, where they are in the pipeline, and the next best action.\n\nLead: ${JSON.stringify(lead)}\n\nRecent activities: ${JSON.stringify(activities ?? [])}`,
      }],
    }),
  })
  const j = await r.json() as { content?: { text: string }[] }
  const summary = j.content?.[0]?.text ?? "(no summary returned)"

  await postMessage({
    channel: event.channel,
    thread_ts: event.ts,
    text: `*${lead.full_name ?? "(no name)"}* — ${lead.email}\n${summary}\n<${PUBLIC_APP_URL}/leads?id=${lead.id}|Open in CRM>`,
  })
}

async function handleEventsPayload(payload: {
  type: string
  challenge?: string
  event?: { type: string; user: string; channel: string; text: string; ts: string }
}, signatureValid: boolean): Promise<Response> {
  // url_verification is the one-time setup challenge. We let it through even
  // if signature verification fails so the misconfiguration is visible in the
  // function logs rather than just a generic Slack "didn't respond" error.
  if (payload.type === "url_verification") {
    if (!signatureValid) {
      console.warn("[slack-app] url_verification with bad signature", {
        hasSecret: !!SIGNING_SECRET,
        secretLen: SIGNING_SECRET.length,
      })
    }
    return new Response(payload.challenge ?? "", { headers: { "Content-Type": "text/plain" } })
  }

  if (!signatureValid) return new Response("invalid signature", { status: 401 })

  if (payload.type === "event_callback" && payload.event?.type === "app_mention") {
    queueMicrotask(() => handleAppMention(payload.event!).catch((e) => console.error(e)))
  }
  return new Response("", { status: 200 })
}

// ---------- Router ----------
//
// One URL handles all three Slack inbound types — we dispatch by inspecting
// the body. This avoids any dependence on how Supabase routes sub-paths
// for dashboard-deployed functions.

serve(async (req) => {
  if (req.method === "GET") return new Response("slack-app ok", { status: 200 })
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  const rawBody = await req.text()
  const ts = req.headers.get("x-slack-request-timestamp")
  const sig = req.headers.get("x-slack-signature")
  const signatureValid = await verifySlackSignature(rawBody, ts, sig)

  const contentType = req.headers.get("content-type") ?? ""

  // Events API — JSON body with a `type` field.
  if (contentType.includes("application/json")) {
    try {
      const payload = JSON.parse(rawBody)
      return await handleEventsPayload(payload, signatureValid)
    } catch {
      return new Response("bad json", { status: 400 })
    }
  }

  // Slash commands + interactivity arrive form-encoded.
  if (contentType.includes("application/x-www-form-urlencoded")) {
    if (!signatureValid) return new Response("invalid signature", { status: 401 })
    const form = parseForm(rawBody)

    // Interactivity payloads come as form field "payload" containing JSON.
    if (form.payload) {
      console.log("[slack-app] interactivity received")
      return new Response("", { status: 200 })
    }

    // Slash commands have a `command` field like "/lead".
    if (form.command) {
      return await handleSlashCommand(form as unknown as SlashPayload)
    }

    return new Response("unknown form payload", { status: 400 })
  }

  return new Response("unsupported content-type", { status: 415 })
})
