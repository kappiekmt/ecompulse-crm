// POST /refresh-closer-stats
//
// Runs every 15 minutes via pg_cron. Refreshes the closer_stats_daily
// materialized view so the closer dashboard reflects the last 15 min of
// payment activity without scanning commission_records on every page
// load. Uses CONCURRENTLY so the dashboard never sees a half-refreshed
// view (unique index on (closer_id, stat_date) makes this safe).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { isServiceRequest } from "../_shared/supabase-admin.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (!isServiceRequest(req)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  const supabase = adminClient()

  const { data: flag } = await supabase
    .from("automation_settings")
    .select("enabled")
    .eq("key", "commission_tracking_enabled")
    .maybeSingle()
  if (!flag?.enabled) {
    return jsonResponse({ ok: true, skipped: "commission_tracking_enabled is off" })
  }

  // No supabase-js helper for raw SQL; pg-meta REST exposes /query.
  const url = Deno.env.get("SUPABASE_URL")
  const key = (Deno.env.get("SB_SECRET_KEY") ?? (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")))
  if (!url || !key)
    return jsonResponse({ error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" }, { status: 500 })

  let ok = false
  let error: string | null = null
  try {
    const r = await fetch(`${url}/rest/v1/rpc/refresh_closer_stats_daily`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
    if (r.ok) ok = true
    else error = `RPC returned ${r.status}: ${(await r.text()).slice(0, 200)}`
  } catch (err) {
    error = (err as Error).message
  }

  await logIntegration(supabase, {
    provider: "postgres",
    direction: "outbound",
    event_type: "refresh_closer_stats_daily",
    status: ok ? "success" : "failed",
    error,
  })

  return jsonResponse({ ok, error })
})
