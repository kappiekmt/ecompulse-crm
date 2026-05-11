import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
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
      qc.invalidateQueries({ queryKey: ["lead-deal"] })
      qc.invalidateQueries({ queryKey: ["kpi-snapshot"] })
      qc.invalidateQueries({ queryKey: ["closer-performance"] })
    },
  })
}

// ─── Lead → deal + installments ────────────────────────────────────────────

export interface InstallmentRow {
  id: string
  seq: number
  amount_cents: number
  due_date: string
  paid_at: string | null
}

export interface LeadDeal {
  id: string
  coaching_tier: "fundament" | "groepscoaching" | "one_on_one" | "nick_1_on_1" | null
  amount_cents: number
  currency: string
  notes: string | null
  closed_at: string | null
  installments: InstallmentRow[]
}

export function useLeadDeal(leadId: string | null) {
  return useQuery<LeadDeal | null>({
    queryKey: ["lead-deal", leadId],
    enabled: isSupabaseConfigured && Boolean(leadId),
    queryFn: async () => {
      if (!leadId) return null
      const { data: deal } = await supabase
        .from("deals")
        .select("id, coaching_tier, amount_cents, currency, notes, closed_at")
        .eq("lead_id", leadId)
        .order("closed_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if (!deal) return null

      const { data: inst } = await supabase
        .from("deal_installments")
        .select("id, seq, amount_cents, due_date, paid_at")
        .eq("deal_id", deal.id)
        .order("seq", { ascending: true })

      return {
        ...deal,
        installments: (inst ?? []) as InstallmentRow[],
      } as LeadDeal
    },
  })
}

interface MarkPaidInput {
  installment_id: string
  lead_id: string
  deal_id: string
  amount_cents: number
}

async function markInstallmentPaid(input: MarkPaidInput) {
  const nowIso = new Date().toISOString()

  const { error: instErr } = await supabase
    .from("deal_installments")
    .update({ paid_at: nowIso })
    .eq("id", input.installment_id)
    .is("paid_at", null)
  if (instErr) throw new Error(instErr.message)

  const { error: payErr } = await supabase.from("payments").insert({
    lead_id: input.lead_id,
    deal_id: input.deal_id,
    amount_cents: input.amount_cents,
    currency: "EUR",
    paid_at: nowIso,
    source: "manual",
    is_refund: false,
  })
  if (payErr) console.warn("[markInstallmentPaid] payments insert failed:", payErr.message)

  const { data: sess } = await supabase.auth.getSession()
  const jwt = sess.session?.access_token
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-installment-paid`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ installment_id: input.installment_id }),
  })
  const slack = (await res.json()) as { ok?: boolean; error?: string }
  return {
    slack: { ok: Boolean(slack.ok), error: slack.error ?? null },
  }
}

export function useMarkInstallmentPaid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markInstallmentPaid,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-deal"] })
      qc.invalidateQueries({ queryKey: ["lead-payments"] })
    },
  })
}

interface AddInstallmentInput {
  deal_id: string
  lead_id: string
  amount_cents: number
  due_date: string
  paid_now: boolean
}

async function addInstallment(input: AddInstallmentInput) {
  const { data: existing } = await supabase
    .from("deal_installments")
    .select("seq")
    .eq("deal_id", input.deal_id)
    .order("seq", { ascending: false })
    .limit(1)
  const nextSeq = (existing?.[0]?.seq ?? 0) + 1
  const nowIso = new Date().toISOString()

  const { data: inserted, error: insErr } = await supabase
    .from("deal_installments")
    .insert({
      deal_id: input.deal_id,
      seq: nextSeq,
      amount_cents: input.amount_cents,
      due_date: input.due_date,
      paid_at: input.paid_now ? nowIso : null,
    })
    .select("id")
    .single()
  if (insErr || !inserted) throw new Error(insErr?.message ?? "Failed to add installment")

  if (input.paid_now) {
    const { error: payErr } = await supabase.from("payments").insert({
      lead_id: input.lead_id,
      deal_id: input.deal_id,
      amount_cents: input.amount_cents,
      currency: "EUR",
      paid_at: nowIso,
      source: "manual",
      is_refund: false,
    })
    if (payErr) console.warn("[addInstallment] payments insert failed:", payErr.message)

    const { data: sess } = await supabase.auth.getSession()
    const jwt = sess.session?.access_token
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-installment-paid`
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ installment_id: inserted.id }),
    })
    const slack = (await res.json()) as { ok?: boolean; error?: string }
    return { slack: { ok: Boolean(slack.ok), error: slack.error ?? null } }
  }

  return { slack: { ok: true, error: null } }
}

export function useAddInstallment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: addInstallment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-deal"] })
      qc.invalidateQueries({ queryKey: ["lead-payments"] })
    },
  })
}
