import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars")
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
