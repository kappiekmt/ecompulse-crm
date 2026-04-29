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
import { adminClient, logIntegration } from "../_shared/supabase-admin.ts"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
})

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? ""

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })

  const supabase = adminClient()
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

        let leadId: string | null = null
        if (email) {
          const { data } = await supabase
            .from("leads")
            .select("id")
            .eq("email", email)
            .maybeSingle()
          leadId = data?.id ?? null
        }

        if (leadId) {
          await supabase
            .from("leads")
            .update({ stage: "won" })
            .eq("id", leadId)

          const { data: deal } = await supabase
            .from("deals")
            .insert({
              lead_id: leadId,
              program: (session.metadata?.program as string | undefined) ?? "default",
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
            payload: { amount_cents: amount, currency } as never,
          })
        }

        await logIntegration(supabase, {
          provider: "stripe",
          direction: "inbound",
          event_type: event.type,
          status: "success",
          request_payload: event as never,
          related_lead_id: leadId,
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
