import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

/** Service-role-equivalent key. Prefers the new secret API key (sb_secret_…),
 *  falling back to the legacy service_role JWT during the key migration. */
export function serviceKey(): string | undefined {
  return Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
}

/** Anon-equivalent key for user-scoped clients. Prefers the new publishable
 *  key (sb_publishable_…), falling back to the legacy anon JWT. */
export function publishableKey(): string | undefined {
  return Deno.env.get("SB_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")
}

/** True when a request is from a trusted server caller (cron / DB trigger):
 *  carries the project secret key, or — during migration — a service_role JWT.
 *  Used by functions that run with verify_jwt disabled. */
export function isServiceRequest(req: Request): boolean {
  const secret = Deno.env.get("SB_SECRET_KEY")
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  const apikey = (req.headers.get("apikey") ?? "").trim()
  if (secret && (bearer === secret || apikey === secret)) return true
  try {
    const payload = bearer.split(".")[1]
    if (payload) {
      const role = (JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string }).role
      if (role === "service_role") return true
    }
  } catch {
    /* not a JWT */
  }
  return false
}

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")
  const key = serviceKey()
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or service key (SB_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY)")
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function logIntegration(
  client: SupabaseClient,
  args: {
    provider: string
    direction: "inbound" | "outbound"
    event_type: string
    status: "pending" | "success" | "failed" | "retrying"
    request_payload?: unknown
    response_payload?: unknown
    error?: string | null
    related_lead_id?: string | null
  }
) {
  const { error } = await client.from("integrations_log").insert({
    provider: args.provider,
    direction: args.direction,
    event_type: args.event_type,
    status: args.status,
    request_payload: args.request_payload ?? null,
    response_payload: args.response_payload ?? null,
    error: args.error ?? null,
    related_lead_id: args.related_lead_id ?? null,
  })
  if (error) console.error("[logIntegration]", error)
}

/** Fetch the saved config JSON for a provider from integration_configs. */
export async function getIntegrationConfig(
  client: SupabaseClient,
  provider: string
): Promise<Record<string, string> | null> {
  const { data, error } = await client
    .from("integration_configs")
    .select("config, is_connected")
    .eq("provider", provider)
    .maybeSingle()
  if (error || !data) return null
  return (data.config as Record<string, string>) ?? null
}

/**
 * Whether an automation toggle is enabled. Defaults to `true` when the row is
 * missing (fail-open) so a forgotten seed never silently disables a feature —
 * mirrors the inline check used in calendly-webhook.
 */
export async function isAutomationEnabled(
  client: SupabaseClient,
  key: string
): Promise<boolean> {
  const { data } = await client
    .from("automation_settings")
    .select("enabled")
    .eq("key", key)
    .maybeSingle()
  return data?.enabled !== false
}
