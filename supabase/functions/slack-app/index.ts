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

interface MilestoneShape {
  id?: string
  title?: string
  completed_at?: string | null
  target_date?: string | null
}

async function handleStudent(payload: SlashPayload) {
  const supabase = adminClient()
  const query = payload.text.trim()
  if (!query) return ephemeral("Usage: `/student <name or email>`")

  // Two-step: find matching leads, then fetch their student rows. Avoids
  // PostgREST's brittle cross-table OR syntax.
  const { data: leads } = await supabase
    .from("leads")
    .select("id")
    .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`)
    .limit(10)

  const leadIds = (leads ?? []).map((l) => l.id)
  if (leadIds.length === 0) return ephemeral(`No students matched \`${query}\`.`)

  const { data } = await supabase
    .from("students")
    .select(
      "id, program, onboarding_status, onboarding_checklist, enrolled_at, discord_invite_url, lead:leads(full_name, email), coach:team_members!students_coach_id_fkey(full_name, slack_user_id)",
    )
    .in("lead_id", leadIds)
    .limit(5)

  if (!data || data.length === 0) return ephemeral(`No students matched \`${query}\`.`)

  type StudentJoined = {
    id: string
    program: string
    onboarding_status: "pending" | "in_progress" | "complete"
    onboarding_checklist: MilestoneShape[] | null
    enrolled_at: string
    discord_invite_url: string | null
    lead: { full_name?: string; email?: string | null } | null
    coach: { full_name?: string; slack_user_id?: string | null } | null
  }
  const rows = data as unknown as StudentJoined[]

  // Pull the most-recent note per student so the bot can show "what
  // happened last" — coaches care about that.
  const studentIds = rows.map((s) => s.id)
  const { data: notes } = await supabase
    .from("activities")
    .select("student_id, payload, created_at")
    .in("student_id", studentIds)
    .eq("type", "note")
    .order("created_at", { ascending: false })
  const lastNote = new Map<string, { body: string; created_at: string }>()
  for (const n of notes ?? []) {
    if (!lastNote.has(n.student_id)) {
      const body = (n.payload as { body?: string })?.body ?? ""
      lastNote.set(n.student_id, { body, created_at: n.created_at })
    }
  }

  const blocks: unknown[] = []
  rows.forEach((s, i) => {
    const milestones = Array.isArray(s.onboarding_checklist) ? s.onboarding_checklist : []
    const total = milestones.length
    const done = milestones.filter((m) => m?.completed_at).length
    const pct = total === 0 ? 0 : Math.round((done / total) * 100)
    const nextOpen = milestones.find((m) => !m?.completed_at)
    const coachLabel = s.coach?.slack_user_id
      ? `<@${s.coach.slack_user_id}>`
      : s.coach?.full_name
      ? `*${s.coach.full_name}*`
      : "_unassigned_"
    const statusEmoji =
      s.onboarding_status === "complete" ? "✅"
      : s.onboarding_status === "in_progress" ? "🟡"
      : "⏳"
    const note = lastNote.get(s.id)

    if (i > 0) blocks.push({ type: "divider" })

    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*${s.lead?.full_name ?? "(no name)"}*\n${s.lead?.email ?? "—"}`,
        },
        {
          type: "mrkdwn",
          text: `${statusEmoji} *${s.onboarding_status.replace(/_/g, " ")}*\n*Program:* ${s.program}`,
        },
        {
          type: "mrkdwn",
          text: `*Coach:*\n${coachLabel}`,
        },
        {
          type: "mrkdwn",
          text: `*Enrolled:*\n${new Date(s.enrolled_at).toLocaleDateString()}`,
        },
      ],
    })

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            total === 0
              ? "_No milestones set._"
              : `*Milestones:* ${done}/${total} done · ${pct}%${
                  nextOpen?.title ? ` · _Next:_ ${nextOpen.title}` : ""
                }`,
        },
      ],
    })

    if (note) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `📝 *Last note* (${new Date(note.created_at).toLocaleDateString()}): ${note.body.slice(0, 240)}${
              note.body.length > 240 ? "…" : ""
            }`,
          },
        ],
      })
    }

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "👉 See in CRM", emoji: true },
          url: `${PUBLIC_APP_URL}/students?student=${s.id}`,
          style: "primary",
        },
      ],
    })
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
      case "/student":
      case "/student-status":
        return await handleStudent(form)
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
