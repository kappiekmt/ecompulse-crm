// POST /admin-delete-user { team_member_id }
//
// Admin-only. Permanently deletes a team member: the team_members row AND
// the associated auth.users record. ON DELETE SET NULL on leads.closer_id /
// setter_id / students.coach_id leaves their previously-assigned records
// intact, just unassigned.
//
// Guards:
//  - Caller must be admin (verified via team_members RLS).
//  - Cannot delete yourself.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient } from "../_shared/supabase-admin.ts"

interface Body {
  team_member_id?: string
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  // Identify caller (admin check).
  const auth = req.headers.get("authorization") ?? ""
  const url = Deno.env.get("SUPABASE_URL")
  const anon = Deno.env.get("SUPABASE_ANON_KEY")
  if (!url || !anon) return jsonResponse({ error: "Server misconfigured" }, { status: 500 })

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user: caller },
  } = await userClient.auth.getUser()
  if (!caller) return jsonResponse({ error: "Not authenticated" }, { status: 401 })

  const { data: callerProfile } = await userClient
    .from("team_members")
    .select("id, role")
    .eq("user_id", caller.id)
    .maybeSingle()
  if (!callerProfile || callerProfile.role !== "admin") {
    return jsonResponse({ error: "Admin access required" }, { status: 403 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!body.team_member_id) {
    return jsonResponse({ error: "team_member_id is required" }, { status: 400 })
  }

  if (body.team_member_id === callerProfile.id) {
    return jsonResponse(
      { error: "You can't delete your own admin account." },
      { status: 400 }
    )
  }

  const admin = adminClient()

  // Look up the target so we know which auth user to delete too.
  const { data: target, error: lookupErr } = await admin
    .from("team_members")
    .select("id, user_id, full_name, email, role")
    .eq("id", body.team_member_id)
    .maybeSingle()
  if (lookupErr) return jsonResponse({ error: lookupErr.message }, { status: 500 })
  if (!target) return jsonResponse({ error: "Team member not found" }, { status: 404 })

  // Delete the team_members row first (ON DELETE SET NULL clears assignments).
  const { error: deleteRowErr } = await admin
    .from("team_members")
    .delete()
    .eq("id", target.id)
  if (deleteRowErr) {
    return jsonResponse(
      { error: `Failed to delete team_members row: ${deleteRowErr.message}` },
      { status: 500 }
    )
  }

  // Delete the auth.users record (best-effort — if it fails, the team_members
  // row is already gone and we'll surface the auth error to the admin).
  if (target.user_id) {
    const { error: deleteAuthErr } = await admin.auth.admin.deleteUser(target.user_id)
    if (deleteAuthErr) {
      return jsonResponse(
        {
          ok: true,
          warning: `team_members row deleted but auth user removal failed: ${deleteAuthErr.message}. Delete the user manually from Supabase Auth dashboard.`,
          deleted: { full_name: target.full_name, email: target.email },
        },
        { status: 200 }
      )
    }
  }

  return jsonResponse({
    ok: true,
    deleted: { full_name: target.full_name, email: target.email, role: target.role },
  })
})
