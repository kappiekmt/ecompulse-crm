// POST /discord-invite { student_id }
//
// Generates a fresh one-time invite for the welcome channel, saves it on
// the student row, and returns the URL. Caller must be an admin or the
// student's assigned coach.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import {
  adminClient,
  getIntegrationConfig,
  logIntegration,
} from "../_shared/supabase-admin.ts"
import { createChannelInvite, isDiscordError } from "../_shared/discord.ts"

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  // Auth: admin OR the student's assigned coach.
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

  let body: { student_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.student_id) {
    return jsonResponse({ error: "student_id is required" }, { status: 400 })
  }

  // RLS lets admins see all students, coaches see only theirs. If the read
  // returns nothing, the caller has no business issuing this invite.
  const { data: student, error: studentErr } = await userClient
    .from("students")
    .select("id, lead_id, coach_id, lead:leads(full_name, email)")
    .eq("id", body.student_id)
    .maybeSingle()
  if (studentErr) return jsonResponse({ error: studentErr.message }, { status: 403 })
  if (!student)
    return jsonResponse({ error: "Student not found or access denied" }, { status: 404 })

  const supabase = adminClient()
  const cfg = await getIntegrationConfig(supabase, "discord")
  const botToken = cfg?.bot_token
  const channelId = cfg?.welcome_channel_id
  if (!botToken) {
    return jsonResponse(
      { error: "Discord not connected — set bot_token in Integrations" },
      { status: 400 }
    )
  }
  if (!channelId) {
    return jsonResponse(
      { error: "Discord welcome_channel_id not set in Integrations" },
      { status: 400 }
    )
  }

  type LeadShape = { full_name?: string; email?: string | null } | null
  const leadObj = (student as { lead?: LeadShape }).lead ?? null
  const reason = `Invite for student ${leadObj?.full_name ?? student.id}`
  const result = await createChannelInvite({
    botToken,
    channelId,
    maxAgeSeconds: 7 * 24 * 3600,
    maxUses: 1,
    reason,
  })

  if (isDiscordError(result)) {
    await logIntegration(supabase, {
      provider: "discord",
      direction: "outbound",
      event_type: "discord.create_invite",
      status: "failed",
      request_payload: { student_id: student.id, channel_id: channelId } as never,
      response_payload: { status: result.status, body: result.raw } as never,
      error: result.message,
      related_lead_id: student.lead_id,
    })
    return jsonResponse(
      { error: `Discord rejected the invite: ${result.message}`, detail: result.raw },
      { status: 502 }
    )
  }

  // Persist the invite on the student.
  const { error: updErr } = await supabase
    .from("students")
    .update({
      discord_invite_url: result.url,
      discord_invite_code: result.code,
      discord_invite_expires_at: result.expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", student.id)
  if (updErr) {
    return jsonResponse({ error: `Saved on Discord but DB update failed: ${updErr.message}` }, { status: 500 })
  }

  await logIntegration(supabase, {
    provider: "discord",
    direction: "outbound",
    event_type: "discord.create_invite",
    status: "success",
    request_payload: { student_id: student.id, channel_id: channelId } as never,
    response_payload: { code: result.code, url: result.url } as never,
    error: null,
    related_lead_id: student.lead_id,
  })

  // Activity log so it shows up in the student timeline.
  await supabase.from("activities").insert({
    student_id: student.id,
    type: "discord_invite_issued",
    payload: { url: result.url, code: result.code },
  })

  return jsonResponse({
    ok: true,
    url: result.url,
    code: result.code,
    expires_at: result.expires_at,
  })
})
