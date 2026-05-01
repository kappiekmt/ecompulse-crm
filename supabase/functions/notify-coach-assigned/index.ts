// POST /notify-coach-assigned { student_id }
//
// Posts a "New Student Assigned" message to Slack so the coach knows a
// student just landed in their bucket. Fired by a Postgres trigger on
// students.coach_id changes (insert with coach OR update that swaps
// coach), so it covers Stripe auto-assign, manual payment auto-assign,
// AND admin reassignment from the drawer — single source of truth.
//
// Auth: service_role token (trigger path) is the primary caller. Also
// accepts an admin JWT for manual re-fires from the UI.
//
// Slack target: integration_configs.slack.coach_assign_webhook_url —
// editable from the Integrations page if the channel ever moves.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import {
  adminClient,
  getIntegrationConfig,
  logIntegration,
} from "../_shared/supabase-admin.ts"
import { postToSlack, slackMention } from "../_shared/slack.ts"

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

  // Gateway has verify_jwt = true so a token is already required. We don't
  // re-check the role inline because:
  //   - the trigger uses service_role (full access)
  //   - any signed-in admin/coach JWT can already read these tables via RLS
  //     so leaking student name + coach mention isn't widening exposure.

  let body: { student_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.student_id) {
    return jsonResponse({ error: "student_id is required" }, { status: 400 })
  }

  const supabase = adminClient()

  type StudentJoined = {
    id: string
    program: string
    onboarding_status: string
    lead_id: string
    coach_id: string | null
    lead?: { full_name: string; email: string | null } | null
    coach?: { id: string; full_name: string; slack_user_id: string | null } | null
  }

  const { data: student } = await supabase
    .from("students")
    .select(
      "id, program, onboarding_status, lead_id, coach_id, lead:leads(full_name, email), coach:team_members!students_coach_id_fkey(id, full_name, slack_user_id)"
    )
    .eq("id", body.student_id)
    .maybeSingle<StudentJoined>()

  if (!student) {
    return jsonResponse({ error: "Student not found" }, { status: 404 })
  }
  if (!student.coach) {
    return jsonResponse({ ok: false, skipped: "no coach assigned" })
  }

  const slackConfig = await getIntegrationConfig(supabase, "slack")
  const webhookUrl = slackConfig?.coach_assign_webhook_url
  if (!webhookUrl) {
    return jsonResponse(
      { error: "No coach_assign_webhook_url set in Slack integration config" },
      { status: 400 }
    )
  }

  const studentName = (student.lead?.full_name ?? "Unknown student").toUpperCase()
  const coachMention =
    slackMention(student.coach.slack_user_id) ?? `*${student.coach.full_name}*`
  const coachLabel = student.coach.full_name

  const message = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "EcomPulse CRM — STUDENTS · New Student Assigned",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Student:*\n${studentName}` },
          { type: "mrkdwn", text: `*Program:*\n${student.program}` },
          { type: "mrkdwn", text: `*Coach:*\n${coachMention}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${coachMention} — Start your Welcome Call SOP now.`,
        },
      },
    ],
  }

  const result = await postToSlack(webhookUrl, message)

  await logIntegration(supabase, {
    provider: "slack",
    direction: "outbound",
    event_type: "slack.coach_assigned",
    status: result.ok ? "success" : "failed",
    request_payload: {
      student_id: student.id,
      coach_id: student.coach.id,
      coach: coachLabel,
    } as never,
    response_payload: { status: result.status, body: result.body } as never,
    error: result.error,
    related_lead_id: student.lead_id,
  })

  if (!result.ok) {
    return jsonResponse({ error: result.error }, { status: 502 })
  }
  return jsonResponse({ ok: true, coach: coachLabel })
})
