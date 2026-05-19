// Fathom webhook receiver.
//
// Fathom doesn't have a fixed webhook schema — payload shape depends on how
// the user configured the "Send webhook" automation. This handler is forgiving:
// it accepts the common shapes (Fathom Zapier-style + raw automation), maps
// what's there, and stores everything in `calls`.
//
// Configure in Fathom:
//   Settings → Integrations → Webhooks → New webhook
//   Trigger: "Meeting completed"
//   URL:    https://coaching.joinecompulse.com/api/webhooks/fathom
//   Body:   send everything (host email, invitees, summary, action items,
//           recording URL, share URL, transcript or transcript_url)
//
// Set Function secrets (optional but recommended):
//   supabase secrets set FATHOM_SHARED_SECRET=<random-string>
// Then add header `X-Fathom-Secret: <same>` on the Fathom webhook config.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import {
  adminClient,
  logIntegration,
} from "../_shared/supabase-admin.ts"
import { dispatchEvent } from "../_shared/dispatch.ts"

interface FathomPayload {
  // Meeting / recording — Fathom variants observed in the wild.
  meeting?: {
    id?: string | number
    title?: string
    scheduled_start_time?: string
    scheduled_end_time?: string
    recording_url?: string
    share_url?: string
    transcript_url?: string
  }
  recording?: {
    id?: string | number
    url?: string
    share_url?: string
    duration_seconds?: number
  }

  // Flat-shape fields (some Fathom Zaps send these directly at the root).
  id?: string | number
  fathom_id?: string | number
  title?: string
  share_url?: string
  recording_url?: string
  transcript_url?: string
  started_at?: string
  ended_at?: string
  duration_seconds?: number

  // Participants.
  host?: { name?: string; email?: string } | string
  host_email?: string
  invitees?: Array<{ name?: string; email?: string } | string>
  attendees?: Array<{ name?: string; email?: string } | string>

  // Content.
  summary?: string
  ai_summary?: string
  transcript?: string

  action_items?: Array<
    string | {
      description?: string
      text?: string
      assignee?: string
      due_date?: string
    }
  >
}

function pickEmail(value: unknown): string | null {
  if (!value) return null
  if (typeof value === "string") {
    const m = value.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
    return m?.[0]?.toLowerCase() ?? null
  }
  if (typeof value === "object" && "email" in (value as Record<string, unknown>)) {
    const e = (value as { email?: string }).email
    return typeof e === "string" ? e.toLowerCase() : null
  }
  return null
}

function normalize(payload: FathomPayload) {
  const meeting = payload.meeting ?? {}
  const recording = payload.recording ?? {}

  const fathom_id = String(
    payload.fathom_id ?? payload.id ?? meeting.id ?? recording.id ?? ""
  ) || null

  const title = payload.title ?? meeting.title ?? null
  const recording_url =
    payload.recording_url ?? meeting.recording_url ?? recording.url ?? null
  const share_url =
    payload.share_url ?? meeting.share_url ?? recording.share_url ?? null
  const transcript_url = payload.transcript_url ?? meeting.transcript_url ?? null

  const started_at = payload.started_at ?? meeting.scheduled_start_time ?? null
  const ended_at = payload.ended_at ?? meeting.scheduled_end_time ?? null
  let duration_seconds = payload.duration_seconds ?? recording.duration_seconds ?? null
  if (!duration_seconds && started_at && ended_at) {
    const d = Math.round((Date.parse(ended_at) - Date.parse(started_at)) / 1000)
    if (d > 0) duration_seconds = d
  }

  const host_email = pickEmail(payload.host) ?? payload.host_email?.toLowerCase() ?? null

  const attendees: string[] = []
  for (const v of [...(payload.invitees ?? []), ...(payload.attendees ?? [])]) {
    const e = pickEmail(v)
    if (e && !attendees.includes(e)) attendees.push(e)
  }

  const summary = payload.summary ?? payload.ai_summary ?? null
  const transcript = payload.transcript ?? null

  const action_items: { description: string; assignee: string | null; due_date: string | null }[] = []
  for (const item of payload.action_items ?? []) {
    if (typeof item === "string") {
      action_items.push({ description: item, assignee: null, due_date: null })
    } else if (item && typeof item === "object") {
      const desc = item.description ?? item.text
      if (desc) {
        action_items.push({
          description: desc,
          assignee: item.assignee ?? null,
          due_date: item.due_date ?? null,
        })
      }
    }
  }

  return {
    fathom_id,
    title,
    recording_url,
    share_url,
    transcript_url,
    started_at,
    ended_at,
    duration_seconds,
    host_email,
    attendees,
    summary,
    transcript,
    action_items,
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  const supabase = adminClient()
  const body = await req.text()

  // Optional shared-secret check — Fathom doesn't HMAC-sign, so we rely on
  // a custom header that the user sets on the webhook config.
  const required = Deno.env.get("FATHOM_SHARED_SECRET")
  if (required) {
    const provided = req.headers.get("x-fathom-secret")
    if (provided !== required) {
      await logIntegration(supabase, {
        provider: "fathom",
        direction: "inbound",
        event_type: "auth_failed",
        status: "failed",
        request_payload: body.slice(0, 500),
        error: "Bad or missing X-Fathom-Secret header",
      })
      return new Response("Unauthorized", { status: 401, headers: corsHeaders })
    }
  }

  let payload: FathomPayload
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders })
  }

  const n = normalize(payload)

  // Resolve closer by host email — match against active team members with a
  // role that takes sales calls (closer or admin/founder).
  let closer_id: string | null = null
  if (n.host_email) {
    const { data } = await supabase
      .from("team_members")
      .select("id")
      .eq("email", n.host_email)
      .eq("is_active", true)
      .in("role", ["closer", "admin"])
      .maybeSingle()
    closer_id = data?.id ?? null
  }

  // Resolve lead by first attendee that isn't the host.
  let lead_id: string | null = null
  const leadEmail = n.attendees.find((e) => e !== n.host_email) ?? null
  if (leadEmail) {
    const { data } = await supabase
      .from("leads")
      .select("id")
      .eq("email", leadEmail)
      .maybeSingle()
    lead_id = data?.id ?? null
  }

  // Resolve the most recent open deal for that lead, if any.
  let deal_id: string | null = null
  if (lead_id) {
    const { data } = await supabase
      .from("deals")
      .select("id")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    deal_id = data?.id ?? null
  }

  const row = {
    source: "fathom" as const,
    fathom_id: n.fathom_id,
    fathom_share_url: n.share_url,
    recording_url: n.recording_url,
    transcript_url: n.transcript_url,
    title: n.title,
    started_at: n.started_at,
    ended_at: n.ended_at,
    duration_seconds: n.duration_seconds,
    host_email: n.host_email,
    attendee_emails: n.attendees,
    summary: n.summary,
    transcript: n.transcript,
    closer_id,
    lead_id,
    deal_id,
  }

  // Idempotent on fathom_id — webhook retries won't duplicate.
  const { data: call, error: callErr } = n.fathom_id
    ? await supabase.from("calls").upsert(row, { onConflict: "fathom_id" }).select("id").single()
    : await supabase.from("calls").insert(row).select("id").single()

  if (callErr || !call) {
    await logIntegration(supabase, {
      provider: "fathom",
      direction: "inbound",
      event_type: "meeting.completed",
      status: "failed",
      request_payload: payload as never,
      error: callErr?.message ?? "Unknown call upsert failure",
      related_lead_id: lead_id,
    })
    return new Response("Call upsert failed", { status: 500, headers: corsHeaders })
  }

  // Replace action items rather than dedupe — Fathom is authoritative for them.
  if (n.action_items.length > 0) {
    await supabase.from("call_action_items").delete().eq("call_id", call.id).eq("source", "fathom")
    await supabase.from("call_action_items").insert(
      n.action_items.map((a) => ({
        call_id: call.id,
        description: a.description,
        assignee: a.assignee,
        due_date: a.due_date,
        source: "fathom" as const,
      }))
    )
  }

  await supabase.from("activities").insert({
    lead_id,
    type: "call.recorded",
    payload: {
      call_id: call.id,
      source: "fathom",
      duration_seconds: n.duration_seconds,
      share_url: n.share_url,
    } as never,
  })

  await logIntegration(supabase, {
    provider: "fathom",
    direction: "inbound",
    event_type: "meeting.completed",
    status: "success",
    request_payload: payload as never,
    related_lead_id: lead_id,
  })

  // Fire outbound event so subscribers (e.g. AI review queue) can react.
  await dispatchEvent(supabase, {
    event_type: "call.recorded",
    data: {
      call_id: call.id,
      lead_id,
      closer_id,
      deal_id,
      share_url: n.share_url,
      summary: n.summary,
      duration_seconds: n.duration_seconds,
    },
  })

  // Kick off the AI review asynchronously — no await, so the webhook returns
  // quickly even if Claude is slow. The review function handles its own logging.
  if (n.transcript) {
    const aiUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/review-call`
    fetch(aiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ call_id: call.id }),
    }).catch((e) => console.error("[fathom-webhook] review-call dispatch failed", e))
  }

  return new Response(JSON.stringify({ ok: true, call_id: call.id, lead_id, closer_id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
