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

function fmtMoney(cents: number | null | undefined, currency = "EUR"): string {
  if (cents === null || cents === undefined) return "—"
  const sym = currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `
  return `${sym}${(cents / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(iso: string | null | undefined, tz = "Europe/Amsterdam"): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

async function leadDetailBlocks(leadId: string): Promise<unknown[]> {
  const supabase = adminClient()

  const [leadRes, dealsRes, paymentsRes, activitiesRes, studentRes] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, full_name, email, phone, instagram, timezone, stage, source, budget_cents, notes, created_at, booked_at, scheduled_at, cancelled_at, closed_at, calendly_event_name, calendly_join_url, calendly_cancel_url, calendly_reschedule_url, pre_call_started, closer:team_members!leads_closer_id_fkey(full_name), setter:team_members!leads_setter_id_fkey(full_name), tags:lead_tag_assignments(tag:lead_tags(name))",
      )
      .eq("id", leadId)
      .maybeSingle(),
    supabase
      .from("deals")
      .select("id, program, amount_cents, currency, status, coaching_tier, payment_plan, closed_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select("amount_cents, currency, paid_at, is_refund")
      .eq("lead_id", leadId)
      .order("paid_at", { ascending: false }),
    supabase
      .from("activities")
      .select("type, payload, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("students")
      .select("program, coaching_tier, onboarding_status, coach:team_members(full_name)")
      .eq("lead_id", leadId)
      .maybeSingle(),
  ])

  const lead = leadRes.data as Record<string, unknown> | null
  if (!lead) return [{ type: "section", text: { type: "mrkdwn", text: "Lead not found." } }]

  const closer = (lead.closer as { full_name?: string } | null)?.full_name ?? "—"
  const setter = (lead.setter as { full_name?: string } | null)?.full_name ?? "—"
  const tags = ((lead.tags as { tag?: { name?: string } }[] | null) ?? [])
    .map((t) => t.tag?.name)
    .filter(Boolean)
    .join(", ") || "—"
  const tz = (lead.timezone as string | null) ?? "Europe/Amsterdam"

  const totalPaid = (paymentsRes.data ?? []).reduce(
    (sum, p) => sum + (p.is_refund ? -(p.amount_cents ?? 0) : (p.amount_cents ?? 0)),
    0,
  )
  const currency = paymentsRes.data?.[0]?.currency ?? dealsRes.data?.[0]?.currency ?? "EUR"

  const contact = [lead.email, lead.phone, lead.instagram ? `@${(lead.instagram as string).replace(/^@/, "")}` : null]
    .filter(Boolean)
    .join(" · ") || "—"

  const blocks: unknown[] = []

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: (lead.full_name as string) ?? "(no name)" },
  })
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: [
        contact,
        `Stage: \`${lead.stage}\` · Source: \`${lead.source ?? "—"}\` · Tags: ${tags}`,
        lead.budget_cents ? `Budget: ${fmtMoney(lead.budget_cents as number, currency)}` : null,
      ].filter(Boolean).join("\n"),
    },
  })

  if (lead.scheduled_at || lead.calendly_event_name) {
    const callBits = [
      lead.calendly_event_name ? `*${lead.calendly_event_name}*` : "*Strategy call*",
      fmtDate(lead.scheduled_at as string | null, tz),
    ].join(" — ")
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `📅 ${callBits}` } })
    const callButtons: unknown[] = []
    if (lead.calendly_join_url) {
      callButtons.push({
        type: "button",
        text: { type: "plain_text", text: "Join call" },
        url: lead.calendly_join_url,
        style: "primary",
      })
    }
    if (lead.calendly_reschedule_url) {
      callButtons.push({
        type: "button",
        text: { type: "plain_text", text: "Reschedule" },
        url: lead.calendly_reschedule_url,
      })
    }
    if (lead.calendly_cancel_url) {
      callButtons.push({
        type: "button",
        text: { type: "plain_text", text: "Cancel" },
        url: lead.calendly_cancel_url,
        style: "danger",
      })
    }
    if (callButtons.length) blocks.push({ type: "actions", elements: callButtons })
  }

  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Closer:*\n${closer}` },
      { type: "mrkdwn", text: `*Setter:*\n${setter}` },
      { type: "mrkdwn", text: `*Booked:*\n${fmtDate(lead.booked_at as string | null, tz)}` },
      { type: "mrkdwn", text: `*Pre-call SOP:*\n${lead.pre_call_started ? "✅ started" : "⏳ not started"}` },
    ],
  })

  const deals = dealsRes.data ?? []
  if (deals.length) {
    blocks.push({ type: "divider" })
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "💰 *Deals*",
          ...deals.map((d) => {
            const tierLabel = d.coaching_tier ? ` · \`${d.coaching_tier}\`` : ""
            return `• ${d.program} — ${fmtMoney(d.amount_cents, d.currency)} · \`${d.status}\`${tierLabel}`
          }),
          `Total paid: ${fmtMoney(totalPaid, currency)}`,
        ].join("\n"),
      },
    })
  }

  const student = studentRes.data as { program?: string; coaching_tier?: string; onboarding_status?: string; coach?: { full_name?: string } } | null
  if (student) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🎓 *Student:* ${student.program} · tier \`${student.coaching_tier ?? "—"}\` · status \`${student.onboarding_status}\` · coach ${student.coach?.full_name ?? "—"}`,
      },
    })
  }

  const acts = activitiesRes.data ?? []
  if (acts.length) {
    blocks.push({ type: "divider" })
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "🕒 *Recent activity*",
          ...acts.map((a) => `• ${new Date(a.created_at).toLocaleDateString("en-GB")} — \`${a.type}\``),
        ].join("\n"),
      },
    })
  }

  if (lead.notes) {
    blocks.push({ type: "divider" })
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📝 *Notes*\n${(lead.notes as string).slice(0, 800)}` },
    })
  }

  blocks.push({
    type: "actions",
    elements: [{
      type: "button",
      text: { type: "plain_text", text: "Open in CRM" },
      url: `${PUBLIC_APP_URL}/leads?id=${lead.id}`,
      style: "primary",
    }],
  })

  return blocks
}

async function handleLead(p: SlashPayload) {
  const supabase = adminClient()
  const q = p.text.trim()
  if (!q) return ephemeral("Usage: `/lead <email or name>`")

  const { data } = await supabase
    .from("leads")
    .select("id, full_name, email, stage")
    .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
    .limit(5)

  if (!data || data.length === 0) return ephemeral(`No leads matched \`${q}\`.`)

  // Single match — render the full card.
  if (data.length === 1) {
    const blocks = await leadDetailBlocks(data[0].id)
    return new Response(JSON.stringify({ response_type: "ephemeral", blocks }), {
      headers: { "Content-Type": "application/json" },
    })
  }

  // Multiple matches — compact list, user re-runs with a more specific query.
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `${data.length} matches for \`${q}\` — refine your query for the full card:` } },
    ...data.flatMap((l) => [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${l.full_name ?? "(no name)"}* — ${l.email ?? "—"} · \`${l.stage}\`` },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Open" },
          url: `${PUBLIC_APP_URL}/leads?id=${l.id}`,
        },
      },
    ]),
  ]

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
      system: [
        "You are a sales-coaching assistant inside Slack. Output strictly in",
        "Slack mrkdwn — *single asterisks for bold*, _underscores for italic_,",
        "never use **double asterisks**, # or ### headers, or backticks for emphasis.",
        "Reply with exactly three bullet lines starting with '• '. Each bullet is",
        "one sentence, max ~25 words. The three bullets cover, in order:",
        "1) *Who:* who the lead is in one line.",
        "2) *Status:* where they are in the pipeline + most recent signal.",
        "3) *Next:* the single best next action with concrete timing.",
        "No preamble, no closing, no headers — just the three bullets.",
      ].join(" "),
      messages: [{
        role: "user",
        content: `Lead: ${JSON.stringify(lead)}\n\nRecent activities: ${JSON.stringify(activities ?? [])}`,
      }],
    }),
  })
  const j = await r.json() as { content?: { text: string }[] }
  let summary = j.content?.[0]?.text ?? "(no summary returned)"

  // Defensive: convert any standard markdown the model may have slipped in.
  summary = summary
    .replace(/\*\*(.+?)\*\*/g, "*$1*")          // **bold** -> *bold*
    .replace(/^#{1,6}\s+/gm, "")                 // strip headers
    .replace(/^\s*[-*]\s+/gm, "• ")              // - or * bullets -> •
    .trim()

  await postMessage({
    channel: event.channel,
    thread_ts: event.ts,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${lead.full_name ?? "(no name)"} — Lead summary` },
      },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `${lead.email ?? "—"} · stage \`${lead.stage}\``,
        }],
      },
      { type: "section", text: { type: "mrkdwn", text: summary } },
      {
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "Open in CRM" },
          url: `${PUBLIC_APP_URL}/leads?id=${lead.id}`,
          style: "primary",
        }],
      },
    ],
    text: `${lead.full_name ?? "(no name)"} — Lead summary`,
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
