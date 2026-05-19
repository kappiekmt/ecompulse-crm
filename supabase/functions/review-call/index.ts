// AI call review (Claude).
//
// Reads a call's transcript, asks Claude to score it against EcomPulse's sales
// framework, extract objections, and flag review-worthy calls for the sales
// lead.
//
// Trigger paths:
//   - Automatic: fathom-webhook fires this fire-and-forget when a transcript
//     arrives.
//   - Manual: the Calls UI invokes it via supabase.functions.invoke('review-call').
//
// Env: ANTHROPIC_API_KEY (set via `supabase secrets set`).
//
// We use the system prompt's cache_control so the framework rubric is cached
// across calls. With Sonnet that turns most reviews into a single cached
// system block + small per-call user block (~$0.005 per call).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
const MODEL = "claude-sonnet-4-6"

const SYSTEM_PROMPT = `You are an expert sales coach reviewing a recorded sales call for EcomPulse, a Dutch ecommerce-coaching program. Your job is to produce a fair, actionable review the closer can learn from.

Score the call against this framework (1-10):
  - Discovery: did the closer understand the prospect's current situation, pain, and goals?
  - Pitch fit: was the offer framed around the prospect's actual problem?
  - Objection handling: were objections surfaced, acknowledged, and resolved?
  - Close: was a clear ask made, with a next step?

Rules:
- Be specific. "Strong discovery" is useless; "Asked 3 layers deep on revenue, didn't probe lifestyle goals" is useful.
- Flag needs_review=true ONLY when the call is unusually weak (multiple framework elements scored <=4) OR there's a coaching teachable moment that's worth the sales lead's time.
- Identify objections that were actually raised — match them to the catalog provided. Use category 'other' only if nothing fits.
- Return STRICTLY valid JSON matching the schema. No prose outside the JSON.

Schema:
{
  "framework_score": <integer 1-10, average of the four sub-scores>,
  "discovery_score": <1-10>,
  "pitch_score": <1-10>,
  "objection_score": <1-10>,
  "close_score": <1-10>,
  "summary": "<2-3 sentence coaching summary>",
  "strengths": ["<bullet>", ...],
  "improvements": ["<bullet>", ...],
  "objections_raised": [
    { "objection_label": "<one of the catalog labels>", "quote": "<short excerpt>" }
  ],
  "needs_review": <boolean>
}`

interface CallRow {
  id: string
  transcript: string | null
  summary: string | null
  duration_seconds: number | null
  lead_id: string | null
  closer_id: string | null
}

interface ObjectionRow {
  id: string
  label: string
  category: string
}

interface ClaudeResult {
  framework_score?: number
  discovery_score?: number
  pitch_score?: number
  objection_score?: number
  close_score?: number
  summary?: string
  strengths?: string[]
  improvements?: string[]
  objections_raised?: { objection_label?: string; quote?: string }[]
  needs_review?: boolean
}

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

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")
  if (!apiKey) return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })

  let body: { call_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.call_id) return jsonResponse({ error: "call_id is required" }, { status: 400 })

  const supabase = adminClient()

  const { data: call, error: callErr } = await supabase
    .from("calls")
    .select("id, transcript, summary, duration_seconds, lead_id, closer_id")
    .eq("id", body.call_id)
    .maybeSingle<CallRow>()
  if (callErr || !call) return jsonResponse({ error: "Call not found" }, { status: 404 })
  if (!call.transcript) {
    return jsonResponse({ error: "Call has no transcript to review." }, { status: 422 })
  }

  const { data: objections } = await supabase
    .from("objections")
    .select("id, label, category")
    .order("label")
  const catalog = (objections ?? []) as ObjectionRow[]
  const catalogList = catalog.map((o) => `- ${o.label} (${o.category})`).join("\n")

  const truncated = call.transcript.slice(0, 60_000)

  const userBlock =
    `Objection catalog:\n${catalogList}\n\n` +
    `Fathom AI summary (for context, not authoritative):\n${call.summary ?? "(none)"}\n\n` +
    `Duration: ${call.duration_seconds ?? "?"}s\n\n` +
    `Transcript:\n${truncated}`

  let claudeRes: Response
  try {
    claudeRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        // Cache the framework rubric so every subsequent review hits the cache.
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userBlock }],
      }),
    })
  } catch (e) {
    await logIntegration(supabase, {
      provider: "anthropic",
      direction: "outbound",
      event_type: "review-call.fetch_error",
      status: "failed",
      error: (e as Error).message,
      related_lead_id: call.lead_id,
    })
    return jsonResponse({ error: "Claude API unreachable" }, { status: 502 })
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text()
    await logIntegration(supabase, {
      provider: "anthropic",
      direction: "outbound",
      event_type: "review-call.api_error",
      status: "failed",
      response_payload: errText.slice(0, 1000),
      error: `HTTP ${claudeRes.status}`,
      related_lead_id: call.lead_id,
    })
    return jsonResponse({ error: "Claude API error", status: claudeRes.status }, { status: 502 })
  }

  const claudeBody = await claudeRes.json()
  const text: string = claudeBody?.content?.[0]?.text ?? ""

  let parsed: ClaudeResult | null = null
  try {
    // Claude is told to return strict JSON. Extract the first {...} block defensively.
    const m = text.match(/\{[\s\S]*\}/)
    parsed = m ? JSON.parse(m[0]) : null
  } catch (e) {
    console.error("[review-call] JSON parse failed", e, text.slice(0, 500))
  }

  if (!parsed) {
    await logIntegration(supabase, {
      provider: "anthropic",
      direction: "outbound",
      event_type: "review-call.parse_failed",
      status: "failed",
      response_payload: text.slice(0, 1000),
      related_lead_id: call.lead_id,
    })
    return jsonResponse({ error: "Could not parse Claude response" }, { status: 502 })
  }

  // Save review on the call.
  await supabase
    .from("calls")
    .update({
      ai_review: parsed,
      ai_reviewed_at: new Date().toISOString(),
    })
    .eq("id", call.id)

  // Auto-tag objections Claude found. Match by label (case-insensitive).
  // Skip ones already attached so we don't churn the rows on re-runs.
  const lcCatalog = new Map(catalog.map((o) => [o.label.toLowerCase(), o]))
  const { data: existing } = await supabase
    .from("call_objections")
    .select("objection_id")
    .eq("call_id", call.id)
  const existingIds = new Set((existing ?? []).map((r) => (r as { objection_id: string }).objection_id))

  const toInsert: Array<{
    call_id: string
    objection_id: string
    quote: string | null
    source: "ai"
  }> = []
  for (const item of parsed.objections_raised ?? []) {
    const label = item.objection_label?.trim().toLowerCase()
    if (!label) continue
    const match = lcCatalog.get(label)
    if (!match || existingIds.has(match.id)) continue
    toInsert.push({
      call_id: call.id,
      objection_id: match.id,
      quote: item.quote?.slice(0, 500) ?? null,
      source: "ai",
    })
  }
  if (toInsert.length > 0) {
    await supabase.from("call_objections").insert(toInsert)
  }

  await logIntegration(supabase, {
    provider: "anthropic",
    direction: "outbound",
    event_type: "review-call.success",
    status: "success",
    request_payload: { call_id: call.id, model: MODEL } as never,
    response_payload: {
      framework_score: parsed.framework_score,
      needs_review: parsed.needs_review,
      objections_tagged: toInsert.length,
      cache_read_input_tokens: claudeBody?.usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: claudeBody?.usage?.cache_creation_input_tokens ?? 0,
    } as never,
    related_lead_id: call.lead_id,
  })

  return jsonResponse({
    ok: true,
    call_id: call.id,
    framework_score: parsed.framework_score,
    needs_review: parsed.needs_review,
    objections_tagged: toInsert.length,
  })
})
