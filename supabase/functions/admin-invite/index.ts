// POST /admin-invite { email, full_name, role, timezone?, … }
//
// Admin-only. Sends a real invite email via Supabase Auth's
// inviteUserByEmail flow. The new user clicks the link in their inbox,
// lands on /set-password, picks a password, and is then signed in.
//
// We also insert the team_members row immediately so the admin can already
// see them in the Team list (with status = pending until they accept).
// If the team_members insert fails, we delete the just-created auth user
// to avoid orphans.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient } from "../_shared/supabase-admin.ts"

interface InviteBody {
  email: string
  full_name: string
  role: "admin" | "closer" | "setter" | "coach"
  timezone?: string
  commission_pct?: number | null
  capacity?: number | null
  slack_user_id?: string | null
}

const REDIRECT_TO =
  Deno.env.get("PUBLIC_APP_URL") ?? "https://coaching.joinecompulse.com/set-password"

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  const auth = req.headers.get("authorization") ?? ""
  const url = Deno.env.get("SUPABASE_URL")
  const anon = Deno.env.get("SUPABASE_ANON_KEY")
  if (!url || !anon) return jsonResponse({ error: "Server misconfigured" }, { status: 500 })

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: me } = await userClient.from("team_members").select("id, role").limit(2)
  if (!me?.length || me.every((m) => m.role !== "admin")) {
    return jsonResponse({ error: "Admin access required" }, { status: 403 })
  }

  let body: InviteBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.email?.trim() || !body.full_name?.trim() || !body.role) {
    return jsonResponse({ error: "email, full_name, and role are required" }, { status: 400 })
  }
  if (!["admin", "closer", "setter", "coach"].includes(body.role)) {
    return jsonResponse({ error: "Invalid role" }, { status: 400 })
  }

  const admin = adminClient()

  // Block duplicates so we don't send a second invite to an already-existing member.
  const { data: existing } = await admin
    .from("team_members")
    .select("id")
    .eq("email", body.email.trim())
    .maybeSingle()
  if (existing) {
    return jsonResponse(
      { error: "A team member with that email already exists" },
      { status: 409 }
    )
  }

  // Send the invite email. Supabase creates the auth user behind the scenes
  // and emails them a magic link that lands on REDIRECT_TO.
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    body.email.trim(),
    {
      data: { full_name: body.full_name.trim() },
      redirectTo: REDIRECT_TO,
    }
  )

  if (inviteErr || !invited?.user) {
    return jsonResponse(
      {
        error:
          inviteErr?.message ??
          "Failed to send invite. Check Supabase Auth → SMTP settings.",
      },
      { status: 500 }
    )
  }

  const userId = invited.user.id

  const { data: tm, error: tmErr } = await admin
    .from("team_members")
    .insert({
      user_id: userId,
      full_name: body.full_name.trim(),
      email: body.email.trim(),
      role: body.role,
      timezone: body.timezone ?? null,
      commission_pct: body.commission_pct ?? null,
      capacity: body.capacity ?? null,
      slack_user_id: body.slack_user_id ?? null,
    })
    .select("id")
    .single()

  if (tmErr) {
    // Clean up the dangling invited auth user.
    await admin.auth.admin.deleteUser(userId)
    return jsonResponse({ error: tmErr.message }, { status: 500 })
  }

  return jsonResponse(
    {
      ok: true,
      team_member_id: tm?.id,
      user_id: userId,
      email: body.email.trim(),
      invite_sent_to: body.email.trim(),
      redirect_to: REDIRECT_TO,
    },
    { status: 201 }
  )
})
