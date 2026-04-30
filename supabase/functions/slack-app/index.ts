// Slack App receiver — handles slash commands, events, and interactivity.
//
// Single edge function with three sub-paths configured in the Slack app:
//   /slack-app/commands       — slash commands (/lead, /note, /student-status)
//   /slack-app/events         — Events API (url_verification, app_mention, …)
//   /slack-app/interactivity  — button clicks, modal submits
//
// Slack requires a 200 within 3 seconds. Slow work is deferred to a
// fire-and-forget async task that posts back via response_url or chat.postMessage.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"
import { verifySlackSignature, postMessage } from "../_shared/slack-bot.ts"

const SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET") ?? ""
const BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") ?? ""
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? ""

const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "https://coaching.joinecompulse.com"

interface SlashPayload {
  command: string
  text: string
  user_id: string
  user_name: string
  channel_id: string
  response_url: string
  trigger_id: string
}

function parseForm(body: string): Record<string, string> {
  const params = new URLSearchParams(body)
  const out: Record<string, string> = {}
  for (const [k, v] of params.entries()) out[k] = v
  return out
}

function ephemeral(text: string, blocks?: unknown[]): Response {
  return new Response(
    JSON.stringify({ response_type: "ephemeral", text, blocks }),
    { headers: { "Content-Type": "application/json" } },
  )
}

// ---------- Slash command handlers ----------

async function handleLead(payload: SlashPayload) {
  const supabase = adminClient()
  const query = payload.text.trim()
  if (!query) return ephemeral("Usage: `/lead <email or name>`")

  const { data } = await supabase
    .from("leads")
    .select("id, name, email, phone, stage, calendly_event_name, calendly_join_url, scheduled_at, owner_id")
    .or(`email.ilike.%${query}%,name.ilike.%${query}%`)
    .limit(5)

  if (!data || data.length === 0) return ephemeral(`No leads matched \`${query}\`.`)

  const blocks: unknown[] = data.flatMap((lead) => [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${lead.name ?? "(no name)"}*\n${lead.email ?? "—"}\nStage: \`${lead.stage}\``,
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "Open in CRM" },
        url: `${PUBLIC_APP_URL}/leads?id=${lead.id}`,
      },
    },
    { type: "divider" },
  ])

  return new Response(
    JSON.stringify({ response_type: "ephemeral", blocks }),
    { headers: { "Content-Type": "application/json" } },
  )
}

async function handleNote(payload: SlashPayload) {
  const supabase = adminClient()
  const text = payload.text.trim()
  if (!text) return ephemeral("Usage: `/note <email-or-name> :: <note text>`")

  const [target, ...rest] = text.split("::").map((s) => s.trim())
  const note = rest.join("::").trim()
  if (!target || !note) return ephemeral("Usage: `/note <email-or-name> :: <note text>`")

  const { data: lead } = await supabase
    .from("leads")
    .select("id, name")
    .or(`email.ilike.%${target}%,name.ilike.%${target}%`)
    .limit(1)
    .maybeSingle()

  if (!lead) return ephemeral(`No lead matched \`${target}\`.`)

  await supabase.from("activities").insert({
    lead_id: lead.id,
    type: "note.added",
    payload: { note, slack_user_id: payload.user_id, slack_user_name: payload.user_name } as never,
  })

  return ephemeral(`📝 Note added to *${lead.name ?? "(unnamed)"}*.`)
}

async function handleStudentStatus(payload: SlashPayload) {
  const supabase = adminClient()
  const query = payload.text.trim()
  if (!query) return ephemeral("Usage: `/student-status <name or email>`")

  // Two-step: find matching leads, then fetch their student rows. Avoids
  // brittle cross-table OR syntax in PostgREST.
  const { data: leads } = await supabase
    .from("leads")
    .select("id")
    .or(`email.ilike.%${query}%,name.ilike.%${query}%`)
    .limit(10)

  const leadIds = (leads ?? []).map((l) => l.id)
  if (leadIds.length === 0) return ephemeral(`No students matched \`${query}\`.`)

  const { data } = await supabase
    .from("students")
    .select(
      "id, program, coaching_tier, onboarding_status, enrolled_at, lead:leads(name, email), coach:team_members(full_name)",
    )
    .in("lead_id", leadIds)
    .limit(5)

  if (!data || data.length === 0) return ephemeral(`No students matched \`${query}\`.`)

  const blocks = data.map((s) => {
    const lead = (s.lead ?? {}) as { name?: string; email?: string }
    const coach = (s.coach ?? {}) as { full_name?: string }
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*${lead.name ?? "(no name)"}* — ${lead.email ?? "—"}`,
          `Tier: \`${s.coaching_tier ?? "—"}\` · Status: \`${s.onboarding_status}\``,
          `Coach: ${coach.full_name ?? "(unassigned)"} · Enrolled: ${new Date(s.enrolled_at).toLocaleDateString()}`,
        ].join("\n"),
      },
    }
  })

  return new Response(
    JSON.stringify({ response_type: "ephemeral", blocks }),
    { headers: { "Content-Type": "application/json" } },
  )
}

async function handleSlashCommand(req: Request): Promise<Response> {
  const rawBody = await req.text()

  const valid = await verifySlackSignature(
    rawBody,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
    SIGNING_SECRET,
  )
  if (!valid) return new Response("invalid signature", { status: 401 })

  const form = parseForm(rawBody) as unknown as SlashPayload

  try {
    switch (form.command) {
      case "/lead": return await handleLead(form)
      case "/note": return await handleNote(form)
      case "/student-status": return await handleStudentStatus(form)
      default:
        return ephemeral(`Unknown command \`${form.command}\``)
    }
  } catch (err) {
    console.error("[slack-app] command error", err)
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
  const summarizeMatch = text.match(/^summarize(?:\s+lead)?\s+(.+)$/i)

  if (!summarizeMatch || !ANTHROPIC_KEY) {
    await postMessage(BOT_TOKEN, {
      channel: event.channel,
      thread_ts: event.ts,
      text: "Try: `@crm-bot summarize <lead name or email>`",
    })
    return
  }

  const supabase = adminClient()
  const query = summarizeMatch[1].trim()
  const { data: lead } = await supabase
    .from("leads")
    .select("id, name, email, phone, stage, source, scheduled_at, calendly_event_name")
    .or(`email.ilike.%${query}%,name.ilike.%${query}%`)
    .limit(1)
    .maybeSingle()

  if (!lead) {
    await postMessage(BOT_TOKEN, {
      channel: event.channel,
      thread_ts: event.ts,
      text: `No lead matched \`${query}\`.`,
    })
    return
  }

  const { data: activities } = await supabase
    .from("activities")
    .select("type, payload, created_at")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(20)

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
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
  const claudeJson = await claudeRes.json() as { content?: { text: string }[] }
  const summary = claudeJson.content?.[0]?.text ?? "(no summary returned)"

  await postMessage(BOT_TOKEN, {
    channel: event.channel,
    thread_ts: event.ts,
    text: `*${lead.name ?? "(no name)"}* — ${lead.email}\n${summary}\n<${PUBLIC_APP_URL}/leads?id=${lead.id}|Open in CRM>`,
  })
}

async function handleEvents(req: Request): Promise<Response> {
  const rawBody = await req.text()

  const valid = await verifySlackSignature(
    rawBody,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
    SIGNING_SECRET,
  )
  if (!valid) return new Response("invalid signature", { status: 401 })

  const payload = JSON.parse(rawBody) as {
    type: string
    challenge?: string
    event?: { type: string; user: string; channel: string; text: string; ts: string }
  }

  if (payload.type === "url_verification") {
    return new Response(payload.challenge ?? "", { headers: { "Content-Type": "text/plain" } })
  }

  if (payload.type === "event_callback" && payload.event?.type === "app_mention") {
    // Ack immediately; do work async.
    queueMicrotask(() => handleAppMention(payload.event!).catch((e) => console.error(e)))
  }

  return new Response("", { status: 200 })
}

// ---------- Interactivity (buttons / modals) ----------

async function handleInteractivity(req: Request): Promise<Response> {
  const rawBody = await req.text()

  const valid = await verifySlackSignature(
    rawBody,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
    SIGNING_SECRET,
  )
  if (!valid) return new Response("invalid signature", { status: 401 })

  const form = parseForm(rawBody)
  const payload = JSON.parse(form.payload ?? "{}") as { type: string }

  // Stub — no interactive components shipped yet in Phase 1.
  console.log("[slack-app] interactivity received:", payload.type)
  return new Response("", { status: 200 })
}

// ---------- Router ----------

serve(async (req) => {
  const path = new URL(req.url).pathname

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  if (path.endsWith("/commands")) return await handleSlashCommand(req)
  if (path.endsWith("/events")) return await handleEvents(req)
  if (path.endsWith("/interactivity")) return await handleInteractivity(req)

  return new Response("not found", { status: 404 })
})
