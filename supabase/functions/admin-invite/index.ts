// POST /admin-invite { email, full_name, role, timezone?, … }
//
// Admin-only. Creates a team member with a generated password and returns that
// password to the admin so they can pass it on. No magic link / email round-trip
// required — the account is created already email-confirmed, so the new member
// signs in immediately at /sign-in with their email + the generated password.
//
// If a member with that email already exists, we RESET their password instead
// (idempotent "re-issue access"). Their team_members row is left untouched.
//
// If RESEND_API_KEY (+ ONBOARDING_FROM_EMAIL) secrets are set, we also email the
// password automatically; otherwise the admin copies it from the UI and sends it.

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

const APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "https://coaching.joinecompulse.com"

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

/** Readable, strong temporary password: e.g. "Ecom-7QXP-4F2K-9M". */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // no I/O/0/1/L ambiguity
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length])
  return `Ecom-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 10).join("")}`
}

/** Best-effort email of the credentials via Resend. Returns true if sent. */
async function emailPassword(to: string, fullName: string, password: string): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  const from = Deno.env.get("ONBOARDING_FROM_EMAIL")
  if (!apiKey || !from) return false
  const firstName = fullName.split(" ")[0] || "there"
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: "Your EcomPulse CRM login",
        html: `
          <p>Hi ${firstName},</p>
          <p>Your EcomPulse CRM account is ready. Sign in here:</p>
          <p><a href="${APP_URL}/sign-in">${APP_URL}/sign-in</a></p>
          <p><strong>Email:</strong> ${to}<br/>
             <strong>Temporary password:</strong> <code>${password}</code></p>
          <p>Please change your password after your first sign-in.</p>
        `,
      }),
    })
    return res.ok
  } catch (_e) {
    return false
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  const auth = req.headers.get("authorization") ?? ""
  const url = Deno.env.get("SUPABASE_URL")
  const anon = Deno.env.get("SB_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")
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

  const email = body.email?.trim().toLowerCase()
  const fullName = body.full_name?.trim()
  if (!email || !fullName || !body.role) {
    return jsonResponse({ error: "email, full_name, and role are required" }, { status: 400 })
  }
  if (!["admin", "closer", "setter", "coach"].includes(body.role)) {
    return jsonResponse({ error: "Invalid role" }, { status: 400 })
  }

  const admin = adminClient()
  const password = generatePassword()

  // Re-issue path: a member with this email already exists → just reset their password.
  const { data: existing } = await admin
    .from("team_members")
    .select("id, user_id, role")
    .eq("email", email)
    .maybeSingle()

  if (existing) {
    if (!existing.user_id) {
      return jsonResponse(
        { error: "That member exists but has no linked auth user. Remove and re-add them." },
        { status: 409 }
      )
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(existing.user_id, {
      password,
      email_confirm: true,
    })
    if (updErr) return jsonResponse({ error: updErr.message }, { status: 500 })

    const emailed = await emailPassword(email, fullName, password)
    return jsonResponse(
      { ok: true, reset: true, email, password, role: existing.role, emailed, sign_in_url: `${APP_URL}/sign-in` },
      { status: 200 }
    )
  }

  // New member path: create the auth user already confirmed, then insert the row.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createErr || !created?.user) {
    return jsonResponse(
      { error: createErr?.message ?? "Failed to create user" },
      { status: 500 }
    )
  }

  const userId = created.user.id
  const { data: tm, error: tmErr } = await admin
    .from("team_members")
    .insert({
      user_id: userId,
      full_name: fullName,
      email,
      role: body.role,
      timezone: body.timezone ?? null,
      commission_pct: body.commission_pct ?? null,
      capacity: body.capacity ?? null,
      slack_user_id: body.slack_user_id ?? null,
    })
    .select("id")
    .single()

  if (tmErr) {
    await admin.auth.admin.deleteUser(userId) // avoid orphaned auth user
    return jsonResponse({ error: tmErr.message }, { status: 500 })
  }

  const emailed = await emailPassword(email, fullName, password)
  return jsonResponse(
    {
      ok: true,
      reset: false,
      team_member_id: tm?.id,
      user_id: userId,
      email,
      password,
      role: body.role,
      emailed,
      sign_in_url: `${APP_URL}/sign-in`,
    },
    { status: 201 }
  )
})
