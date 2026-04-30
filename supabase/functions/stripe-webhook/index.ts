// Stripe webhook receiver.
// Configure in Stripe: https://dashboard.stripe.com/webhooks
// Subscribe to: checkout.session.completed, charge.succeeded, charge.refunded,
//               customer.subscription.deleted
// Endpoint: https://<project>.functions.supabase.co/stripe-webhook
//
// Set Function secrets:
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@14?target=deno"
import { corsHeaders } from "../_shared/cors.ts"
import { adminClient, getIntegrationConfig, logIntegration } from "../_shared/supabase-admin.ts"
import { dispatchEvent } from "../_shared/dispatch.ts"
import { resolveCoachingTier } from "../_shared/coaching-tier.ts"
import { tierByAmountCents, tierByKey } from "../_shared/tiers.ts"
import { pickLeastLoadedCoach } from "../_shared/coach-assign.ts"

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  const supabase = adminClient()
  const config = await getIntegrationConfig(supabase, "stripe")
  const stripeSecretKey = config?.secret_key ?? ""
  const webhookSecret = config?.webhook_secret ?? ""

  if (!stripeSecretKey || !webhookSecret) {
    await logIntegration(supabase, {
      provider: "stripe",
      direction: "inbound",
      event_type: "config_missing",
      status: "failed",
      error: "Stripe is not connected — paste keys in Integrations.",
    })
    return new Response("Stripe not configured", { status: 503, headers: corsHeaders })
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2024-06-20",
    httpClient: Stripe.createFetchHttpClient(),
  })

  const sig = req.headers.get("stripe-signature") ?? ""
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret)
  } catch (err) {
    await logIntegration(supabase, {
      provider: "stripe",
      direction: "inbound",
      event_type: "signature_invalid",
      status: "failed",
      request_payload: body.slice(0, 1000),
      error: (err as Error).message,
    })
    return new Response(`Webhook signature error`, { status: 400, headers: corsHeaders })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const email = session.customer_details?.email ?? null
        const amount = session.amount_total ?? 0
        const currency = (session.currency ?? "eur").toUpperCase()
        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id ?? null

        // Resolve coaching tier from Stripe metadata, payment-link / line-item
        // descriptions. Stays stable across PIF + installment variants.
        let lineItemNames: string[] = []
        try {
          const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 })
          lineItemNames = items.data.flatMap((it) => [
            it.description ?? null,
            typeof it.price?.product === "string" ? null : it.price?.product?.name ?? null,
          ].filter((s): s is string => !!s))
        } catch (err) {
          console.warn("[stripe] could not list line items", (err as Error).message)
        }
        const coachingTier = resolveCoachingTier(
          (session.metadata?.tier as string | undefined) ?? null,
          (session.metadata?.program as string | undefined) ?? null,
          ...lineItemNames,
        )

        let leadId: string | null = null
        let leadIntendedTier: string | null = null
        if (email) {
          const { data } = await supabase
            .from("leads")
            .select("id, intended_tier")
            .eq("email", email)
            .maybeSingle()
          leadId = data?.id ?? null
          leadIntendedTier = data?.intended_tier ?? null
        }

        // Resolve which coaching offer this payment is for. Order:
        //   1. lead.intended_tier (closer's pitch is the source of truth)
        //   2. Stripe metadata.tier
        //   3. amount-based fallback (€997 → fundament, etc.)
        const tier =
          tierByKey(leadIntendedTier) ??
          tierByKey((session.metadata?.tier as string | undefined) ?? null) ??
          tierByAmountCents(amount)
        const programName =
          tier?.program ??
          (session.metadata?.program as string | undefined) ??
          "default"

        if (leadId) {
          await supabase
            .from("leads")
            .update({ stage: "won" })
            .eq("id", leadId)

          const { data: deal } = await supabase
            .from("deals")
            .insert({
              lead_id: leadId,
              program: programName,
              coaching_tier: coachingTier,
              amount_cents: amount,
              currency,
              stripe_customer_id: customerId,
              stripe_payment_intent_id:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : session.payment_intent?.id ?? null,
              status: "won",
              closed_at: new Date().toISOString(),
            })
            .select("id")
            .single()

          await supabase.from("payments").insert({
            lead_id: leadId,
            deal_id: deal?.id ?? null,
            amount_cents: amount,
            currency,
            paid_at: new Date().toISOString(),
            source: "stripe",
          })

          await supabase.from("activities").insert({
            lead_id: leadId,
            type: "stripe.payment.received",
            payload: { amount_cents: amount, currency, tier: tier?.key ?? null } as never,
          })

          // Auto-create a student row so onboarding can begin. Coach is
          // round-robin assigned to the least-loaded active coach (or admin
          // acting as coach) so the new student isn't stuck waiting.
          if (deal?.id) {
            const { data: existing } = await supabase
              .from("students")
              .select("id, coach_id")
              .eq("deal_id", deal.id)
              .maybeSingle()
            if (!existing) {
              const coachId = await pickLeastLoadedCoach(supabase)
              const { data: newStudent } = await supabase
                .from("students")
                .insert({
                  lead_id: leadId,
                  deal_id: deal.id,
                  coach_id: coachId,
                  program: programName,
                  onboarding_status: "pending",
                  enrolled_at: new Date().toISOString(),
                })
                .select("id")
                .single()
              if (newStudent?.id) {
                await supabase.from("activities").insert({
                  student_id: newStudent.id,
                  type: "student.enrolled",
                  payload: {
                    tier: tier?.key ?? null,
                    program: programName,
                    auto_assigned_coach_id: coachId,
                  } as never,
                })
              }
            } else if (!existing.coach_id) {
              // Existing student row but no coach — backfill.
              const coachId = await pickLeastLoadedCoach(supabase)
              if (coachId) {
                await supabase
                  .from("students")
                  .update({ coach_id: coachId })
                  .eq("id", existing.id)
              }
            }
          }
        }

        await logIntegration(supabase, {
          provider: "stripe",
          direction: "inbound",
          event_type: event.type,
          status: "success",
          request_payload: event as never,
          related_lead_id: leadId,
        })

        await dispatchEvent(supabase, {
          event_type: "payment.received",
          data: {
            lead_id: leadId,
            email: session.customer_details?.email ?? null,
            amount_cents: amount,
            currency,
            source: "stripe",
            stripe_session_id: session.id,
            stripe_customer_id: customerId,
          },
        })
        await dispatchEvent(supabase, {
          event_type: "deal.won",
          data: {
            lead_id: leadId,
            program: (session.metadata?.program as string | undefined) ?? "default",
            coaching_tier: coachingTier,
            amount_cents: amount,
            currency,
          },
        })
        break
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null
        if (piId) {
          await supabase
            .from("deals")
            .update({ status: "refunded" })
            .eq("stripe_payment_intent_id", piId)
        }
        await supabase.from("payments").insert({
          amount_cents: -(charge.amount_refunded ?? 0),
          currency: charge.currency.toUpperCase(),
          paid_at: new Date().toISOString(),
          stripe_charge_id: charge.id,
          stripe_payment_intent_id: piId,
          source: "stripe",
          is_refund: true,
        })
        await logIntegration(supabase, {
          provider: "stripe",
          direction: "inbound",
          event_type: event.type,
          status: "success",
          request_payload: event as never,
        })

        await dispatchEvent(supabase, {
          event_type: "payment.refunded",
          data: {
            stripe_charge_id: charge.id,
            stripe_payment_intent_id: piId,
            amount_refunded_cents: charge.amount_refunded ?? 0,
            currency: charge.currency.toUpperCase(),
          },
        })
        break
      }

      default:
        await logIntegration(supabase, {
          provider: "stripe",
          direction: "inbound",
          event_type: event.type,
          status: "success",
          request_payload: { type: event.type } as never,
        })
    }
  } catch (err) {
    await logIntegration(supabase, {
      provider: "stripe",
      direction: "inbound",
      event_type: event.type,
      status: "failed",
      request_payload: event as never,
      error: (err as Error).message,
    })
    return new Response((err as Error).message, { status: 500, headers: corsHeaders })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
