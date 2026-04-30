// POST /admin-invite { email, full_name, role, timezone? }
//
// Admin-only. Creates a Supabase Auth user (email_confirm: true, random temp
// password) and inserts a matching team_members row. Returns the temp password
// once so the admin can pass it to the new user (or send them a reset link).
//
// Caller must be authenticated as an admin (verify_jwt = true). We instantiate
// a per-request user-bound client to verify their role via team_members RLS.

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

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

function generatePassword(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "")
    .replace(/\//g, "")
    .replace(/=+$/, "")
    .slice(0, 24)
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  // Confirm caller is an admin via RLS-protected query.
  const auth = req.headers.get("authorization") ?? ""
  const url = Deno.env.get("SUPABASE_URL")
  const anon = Deno.env.get("SUPABASE_ANON_KEY")
  if (!url || !anon) return jsonResponse({ error: "Server misconfigured" }, { status: 500 })

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: me, error: meErr } = await userClient
    .from("team_members")
    .select("id, role")
    .limit(2)
  if (meErr || !me?.length || me.every((m) => m.role !== "admin")) {
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

  // Pre-check: is the email already a team_member?
  const { data: existing } = await admin
    .from("team_members")
    .select("id")
    .eq("email", body.email.trim())
    .maybeSingle()
  if (existing) {
    return jsonResponse({ error: "A team member with that email already exists" }, { status: 409 })
  }

  // Create the auth user (email confirmed so they can sign in immediately).
  const tempPassword = generatePassword()
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: body.email.trim(),
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: body.full_name.trim() },
  })

  if (createErr || !created?.user) {
    return jsonResponse(
      { error: createErr?.message ?? "Failed to create auth user" },
      { status: 500 }
    )
  }

  const userId = created.user.id

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
    // Roll back auth user so we don't have an orphan.
    await admin.auth.admin.deleteUser(userId)
    return jsonResponse({ error: tmErr.message }, { status: 500 })
  }

  return jsonResponse(
    {
      ok: true,
      team_member_id: tm?.id,
      user_id: userId,
      email: body.email.trim(),
      temp_password: tempPassword,
    },
    { status: 201 }
  )
})
