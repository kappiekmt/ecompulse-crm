// POST /calendly-setup { personal_access_token }
//
// Admin-only. Provisions a Calendly v2 webhook subscription pointing at our
// /api/webhooks/calendly receiver, stores the PAT + signing key + subscription
// URI in integration_configs, and marks Calendly as connected.
//
// Idempotent: if a subscription already exists for our URL, it is deleted and
// recreated so we get a fresh signing key (Calendly returns the key only at
// creation time).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"

const CALENDLY_API = "https://api.calendly.com"

interface CalendlyMe {
  resource: {
    uri: string
    current_organization: string
    name?: string
    email?: string
    timezone?: string
  }
}

interface CalendlySubscription {
  uri: string
  callback_url: string
  events: string[]
  organization?: string
  user?: string
  scope: "organization" | "user"
  state: "active" | "disabled"
  signing_key?: string
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
}

/**
 * Recursively walks an arbitrary JSON value and returns the first string value
 * found at any key matching /signing.?key/i. Defensive in case Calendly nests
 * the field one level deeper than expected.
 */
function deepFindSigningKey(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const r = deepFindSigningKey(item)
      if (r) return r
    }
    return undefined
  }
  for (const [k, v] of Object.entries(value)) {
    if (/signing.?key/i.test(k) && typeof v === "string" && v) return v
    const r = deepFindSigningKey(v)
    if (r) return r
  }
  return undefined
}

async function calendlyApi<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  pat: string,
  body?: unknown
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(`${CALENDLY_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    let err = text
    try {
      const parsed = JSON.parse(text)
      err = parsed?.message ?? parsed?.title ?? parsed?.details?.[0]?.message ?? text
    } catch {
      /* keep raw */
    }
    return { ok: false, status: res.status, error: err.slice(0, 300) }
  }
  if (!text) return { ok: true, data: undefined as T }
  try {
    return { ok: true, data: JSON.parse(text) as T }
  } catch {
    return { ok: false, status: 500, error: "Calendly returned non-JSON response" }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, { status: 405 })

  // Admin-only.
  const auth = req.headers.get("authorization") ?? ""
  const url = Deno.env.get("SUPABASE_URL")
  const anon = Deno.env.get("SUPABASE_ANON_KEY")
  if (!url || !anon) return jsonResponse({ error: "Server misconfigured" }, { status: 500 })

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: me } = await userClient.from("team_members").select("role").limit(2)
  if (!me?.length || me.every((m) => m.role !== "admin")) {
    return jsonResponse({ error: "Admin access required" }, { status: 403 })
  }

  let body: { personal_access_token?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
  }
  const pat = body.personal_access_token?.trim()
  if (!pat) {
    return jsonResponse({ error: "personal_access_token is required" }, { status: 400 })
  }

  const supabase = adminClient()

  // 1. Validate PAT and get organization URI.
  const meResp = await calendlyApi<CalendlyMe>("GET", "/users/me", pat)
  if (!meResp.ok) {
    await logIntegration(supabase, {
      provider: "calendly",
      direction: "outbound",
      event_type: "setup.users_me",
      status: "failed",
      error: meResp.error,
    })
    return jsonResponse(
      {
        error:
          meResp.status === 401
            ? "Calendly rejected the token. Double-check it was copied in full."
            : `Calendly /users/me returned ${meResp.status}: ${meResp.error}`,
      },
      { status: meResp.status === 401 ? 401 : 502 }
    )
  }
  const userUri = meResp.data.resource.uri
  const orgUri = meResp.data.resource.current_organization
  const accountEmail = meResp.data.resource.email

  // 2. List existing org-scoped webhook subscriptions.
  // Calendly's GET /webhook_subscriptions with scope=organization rejects the
  // `user` query param. Only pass `user` when scope=user.
  const callbackUrl = "https://coaching.joinecompulse.com/api/webhooks/calendly"
  const listPath = `/webhook_subscriptions?organization=${encodeURIComponent(orgUri)}&scope=organization`
  const listResp = await calendlyApi<{ collection: CalendlySubscription[] }>(
    "GET",
    listPath,
    pat
  )
  if (!listResp.ok) {
    return jsonResponse(
      { error: `Calendly list webhooks: ${listResp.error}` },
      { status: 502 }
    )
  }

  // 3. Delete any existing subscription pointing at our URL (so we can mint a fresh signing key).
  for (const sub of listResp.data.collection ?? []) {
    if (sub.callback_url === callbackUrl) {
      const id = sub.uri.split("/").pop()
      await calendlyApi<void>("DELETE", `/webhook_subscriptions/${id}`, pat)
    }
  }

  // 4. Create a new subscription.
  const createResp = await calendlyApi<Record<string, unknown>>(
    "POST",
    "/webhook_subscriptions",
    pat,
    {
      url: callbackUrl,
      events: ["invitee.created", "invitee.canceled"],
      organization: orgUri,
      scope: "organization",
    }
  )
  if (!createResp.ok) {
    await logIntegration(supabase, {
      provider: "calendly",
      direction: "outbound",
      event_type: "setup.create_subscription",
      status: "failed",
      error: createResp.error,
    })
    return jsonResponse(
      {
        error: `Calendly couldn't create the webhook: ${createResp.error}. Make sure the token has webhook_subscriptions:write scope.`,
      },
      { status: 502 }
    )
  }

  // Calendly's response shape has occasionally been observed in two forms:
  //   { "resource": { "signing_key": "...", "uri": "..." } }
  //   { "signing_key": "...", "uri": "..." }
  // Probe both and fall back to a deep search for any "signing_key" field so
  // we don't flake on minor response-shape changes.
  const responseAny = createResp.data as Record<string, unknown>
  const resource = (responseAny.resource ?? responseAny) as Record<string, unknown>
  const sub: CalendlySubscription = {
    uri: String(resource.uri ?? ""),
    callback_url: String(resource.callback_url ?? callbackUrl),
    events: (resource.events as string[]) ?? [],
    scope: (resource.scope as "organization" | "user") ?? "organization",
    state: (resource.state as "active" | "disabled") ?? "active",
    signing_key: (resource.signing_key as string | undefined) ?? deepFindSigningKey(responseAny),
  }

  if (!sub.signing_key) {
    // Log the full Calendly response so the admin can inspect it (admin-only via RLS).
    await logIntegration(supabase, {
      provider: "calendly",
      direction: "outbound",
      event_type: "setup.create_subscription",
      status: "failed",
      request_payload: { url: callbackUrl, organization: orgUri } as never,
      response_payload: responseAny as never,
      error: "Calendly response missing signing_key",
    })
    return jsonResponse(
      {
        error:
          "Calendly created the webhook but didn't return a signing key. " +
          "The full response has been logged to integrations_log for inspection. " +
          "Most common cause: PAT scope or account plan doesn't include webhook signing. " +
          "Check Calendly → API & Webhooks → Personal access tokens scopes, or contact Calendly support.",
        subscription_uri: sub.uri,
        response_keys: Object.keys(responseAny),
        resource_keys: Object.keys(resource),
      },
      { status: 502 }
    )
  }

  // 5. Persist into integration_configs.
  const { error: cfgErr } = await supabase
    .from("integration_configs")
    .upsert(
      {
        provider: "calendly",
        display_name: "Calendly",
        is_connected: true,
        connected_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        config: {
          personal_access_token: pat,
          signing_key: sub.signing_key,
          subscription_uri: sub.uri,
          organization_uri: orgUri,
          user_uri: userUri,
          account_email: accountEmail ?? null,
        },
      },
      { onConflict: "provider" }
    )
  if (cfgErr) {
    return jsonResponse({ error: cfgErr.message }, { status: 500 })
  }

  await logIntegration(supabase, {
    provider: "calendly",
    direction: "outbound",
    event_type: "setup.complete",
    status: "success",
    request_payload: { account_email: accountEmail, organization: orgUri } as never,
    response_payload: { subscription_uri: sub.uri } as never,
  })

  return jsonResponse({
    ok: true,
    account_email: accountEmail,
    subscription_uri: sub.uri,
    callback_url: callbackUrl,
    events: sub.events,
  })
})
