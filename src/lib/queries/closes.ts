import { useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import type { TierKey } from "@/lib/tiers"

export interface InstallmentInput {
  amount_cents: number
  due_date: string
  paid_today: boolean
}

export interface LogCloseInput {
  lead_id: string
  closer_id: string | null
  tier: TierKey
  amount_cents: number
  notes: string | null
  installments: InstallmentInput[]
}

interface LogCloseResult {
  deal_id: string
  slack: { ok: boolean; status: number | null; error: string | null }
}

type CoachingTier = "fundament" | "groepscoaching" | "one_on_one" | "nick_1_on_1"

const TIER_TO_ENUM: Record<TierKey, CoachingTier> = {
  fundament: "fundament",
  groepscoaching: "groepscoaching",
  "1_on_1": "one_on_one",
  nick_1_on_1: "nick_1_on_1",
}

const TIER_TO_PROGRAM: Record<TierKey, string> = {
  fundament: "Fundament",
  groepscoaching: "Groepscoaching",
  "1_on_1": "1-1 Coaching",
  nick_1_on_1: "Nick 1-1",
}

async function logClose(input: LogCloseInput): Promise<LogCloseResult> {
  const nowIso = new Date().toISOString()

  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .insert({
      lead_id: input.lead_id,
      program: TIER_TO_PROGRAM[input.tier],
      coaching_tier: TIER_TO_ENUM[input.tier],
      amount_cents: input.amount_cents,
      currency: "EUR",
      status: "won",
      closed_at: nowIso,
      closed_by_id: input.closer_id,
      notes: input.notes,
    })
    .select("id")
    .single()
  if (dealErr || !deal) throw new Error(dealErr?.message ?? "Failed to create deal")

  if (input.installments.length > 0) {
    const rows = input.installments.map((i, idx) => ({
      deal_id: deal.id,
      seq: idx + 1,
      amount_cents: i.amount_cents,
      due_date: i.due_date,
      paid_at: i.paid_today ? nowIso : null,
    }))
    const { error: instErr } = await supabase.from("deal_installments").insert(rows)
    if (instErr) throw new Error(`Deal saved but installments failed: ${instErr.message}`)

    const paidRows = input.installments
      .filter((i) => i.paid_today)
      .map((i) => ({
        lead_id: input.lead_id,
        deal_id: deal.id,
        amount_cents: i.amount_cents,
        currency: "EUR",
        paid_at: nowIso,
        source: "manual",
        is_refund: false,
      }))
    if (paidRows.length > 0) {
      const { error: payErr } = await supabase.from("payments").insert(paidRows)
      if (payErr) {
        console.warn("[logClose] payments insert failed:", payErr.message)
      }
    }
  }

  await supabase.from("leads").update({ stage: "won" }).eq("id", input.lead_id)

  const { data: sess } = await supabase.auth.getSession()
  const jwt = sess.session?.access_token
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-deal-closed`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ deal_id: deal.id }),
  })
  const slack = (await res.json()) as { ok?: boolean; status?: number; error?: string }

  return {
    deal_id: deal.id,
    slack: {
      ok: Boolean(slack.ok),
      status: slack.status ?? null,
      error: slack.error ?? null,
    },
  }
}

export function useLogClose() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: logClose,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads-list"] })
      qc.invalidateQueries({ queryKey: ["lead"] })
      qc.invalidateQueries({ queryKey: ["lead-payments"] })
      qc.invalidateQueries({ queryKey: ["kpi-snapshot"] })
      qc.invalidateQueries({ queryKey: ["closer-performance"] })
    },
  })
}
