// Public REST API for the EcomPulse CRM.
// Authenticated by an API key issued in the CRM (Integrations → API Keys).
//
// Endpoint base:  https://<project-ref>.functions.supabase.co/public-api
// Auth header:    Authorization: Bearer <api-key>
//
// Routes:
//   POST /lead     → create a lead   (scope: lead.create)
//   POST /payment  → log a payment   (scope: payment.create)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"
import { dispatchEvent } from "../_shared/dispatch.ts"

interface LeadPayload {
  full_name: string
  email?: string
  phone?: string
  instagram?: string
  timezone?: string
  stage?: string
  scheduled_at?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  source_landing_page?: string
  source?: string                     // 'calendly' | 'zapier' | 'landing_page' | etc.
  budget_cents?: number
  notes?: string
  tags?: string[]
}

interface PaymentPayload {
  email: string
  amount_cents: number
  currency?: string
  paid_at?: string
  stripe_charge_id?: string
  notes?: string
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })
}

async function authenticate(req: Request, requiredScope: string): Promise<{ keyId: string } | Response> {
  const supabase = adminClient()
  const auth = req.headers.get("authorization") ?? ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) {
    return jsonResponse({ error: "Missing bearer token" }, { status: 401 })
  }
  const plaintext = m[1].trim()

  const { data, error } = await supabase.rpc("verify_api_key", {
    plaintext,
    required_scope: requiredScope,
  })

  if (error || !data) {
    await logIntegration(supabase, {
      provider: "public_api",
      direction: "inbound",
      event_type: "auth_failed",
      status: "failed",
      error: error?.message ?? "Invalid or revoked API key",
    })
    return jsonResponse({ error: "Invalid or revoked API key" }, { status: 401 })
  }

  return { keyId: data as unknown as string }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/public-api/, "")

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 })
  }

  const supabase = adminClient()

  // POST /lead
  if (path === "/lead") {
    const auth = await authenticate(req, "lead.create")
    if (auth instanceof Response) return auth

    let body: LeadPayload
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body.full_name) {
      return jsonResponse({ error: "full_name is required" }, { status: 400 })
    }

    // Build the row with only the fields the caller actually provided so
    // unspecified columns are preserved on conflict (instead of being nulled).
    const stage = body.stage ?? "new"
    const row: Record<string, unknown> = {
      full_name: body.full_name,
      stage,
      source: body.source ?? "public_api",
    }
    if (
      ["booked", "confirmed", "showed", "no_show", "pitched", "won", "lost"].includes(stage)
    ) {
      row.booked_at = new Date().toISOString()
    }
    if (body.scheduled_at) row.scheduled_at = body.scheduled_at
    if (body.budget_cents != null) row.budget_cents = body.budget_cents

    const optional: (keyof LeadPayload)[] = [
      "email",
      "phone",
      "instagram",
      "timezone",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "source_landing_page",
      "notes",
    ]
    for (const k of optional) {
      const v = body[k]
      if (v !== undefined && v !== null && v !== "") row[k] = v
    }

    const { data: lead, error } = await supabase
      .from("leads")
      .upsert(row, { onConflict: "email" })
      .select("id")
      .single()

    if (error || !lead) {
      await logIntegration(supabase, {
        provider: "public_api",
        direction: "inbound",
        event_type: "lead.create",
        status: "failed",
        request_payload: body as never,
        error: error?.message ?? "lead upsert failed",
      })
      return jsonResponse({ error: error?.message ?? "lead upsert failed" }, { status: 500 })
    }

    if (body.tags?.length) {
      const { data: tagRows } = await supabase
        .from("lead_tags")
        .select("id, name")
        .in("name", body.tags)
      if (tagRows?.length) {
        await supabase
          .from("lead_tag_assignments")
          .upsert(tagRows.map((t) => ({ lead_id: lead.id, tag_id: t.id })), {
            onConflict: "lead_id,tag_id",
          })
      }
    }

    await supabase.from("activities").insert({
      lead_id: lead.id,
      type: "public_api.lead.create",
      payload: body as never,
    })

    await logIntegration(supabase, {
      provider: "public_api",
      direction: "inbound",
      event_type: "lead.create",
      status: "success",
      request_payload: body as never,
      related_lead_id: lead.id,
    })

    await dispatchEvent(supabase, {
      event_type: "lead.created",
      data: {
        lead: {
          id: lead.id,
          full_name: body.full_name,
          email: body.email ?? null,
          phone: body.phone ?? null,
          instagram: body.instagram ?? null,
          stage: "new",
          source: "public_api",
          tags: body.tags ?? [],
          utm_source: body.utm_source ?? null,
          utm_medium: body.utm_medium ?? null,
          utm_campaign: body.utm_campaign ?? null,
          utm_content: body.utm_content ?? null,
          utm_term: body.utm_term ?? null,
          notes: body.notes ?? null,
        },
      },
    })

    return jsonResponse({ ok: true, lead_id: lead.id }, { status: 201 })
  }

  // POST /payment
  if (path === "/payment") {
    const auth = await authenticate(req, "payment.create")
    if (auth instanceof Response) return auth

    let body: PaymentPayload
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body.email || !body.amount_cents) {
      return jsonResponse({ error: "email and amount_cents are required" }, { status: 400 })
    }

    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .eq("email", body.email)
      .maybeSingle()

    const { data: payment, error } = await supabase
      .from("payments")
      .insert({
        lead_id: lead?.id ?? null,
        amount_cents: body.amount_cents,
        currency: body.currency ?? "EUR",
        paid_at: body.paid_at ?? new Date().toISOString(),
        stripe_charge_id: body.stripe_charge_id ?? null,
        source: "manual",
        notes: body.notes ?? null,
      })
      .select("id")
      .single()

    if (error) {
      return jsonResponse({ error: error.message }, { status: 500 })
    }

    await dispatchEvent(supabase, {
      event_type: "payment.received",
      data: {
        payment: {
          id: payment?.id,
          lead_id: lead?.id ?? null,
          amount_cents: body.amount_cents,
          currency: body.currency ?? "EUR",
          paid_at: body.paid_at ?? new Date().toISOString(),
          source: "public_api",
        },
      },
    })

    return jsonResponse({ ok: true, payment_id: payment?.id }, { status: 201 })
  }

  return jsonResponse({ error: "Unknown route" }, { status: 404 })
})
