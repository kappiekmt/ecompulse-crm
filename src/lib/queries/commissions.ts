import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { useAuth } from "@/lib/auth"

export interface CommissionRecord {
  id: string
  payment_id: string
  installment_id: string | null
  deal_id: string
  lead_id: string
  closer_id: string
  payment_amount_cents: number
  commission_rate: number
  commission_amount_cents: number
  status: "earned" | "paid_out" | "clawed_back" | "adjusted"
  earned_at: string
  paid_out_at: string | null
  payout_reference: string | null
  clawback_reason: string | null
  notes: string | null
  lead?: { full_name: string } | null
  deal?: { coaching_tier: string | null; amount_cents: number } | null
  closer?: { full_name: string } | null
}

export interface DealCommissionSummary {
  deal_id: string
  lead_id: string
  closer_id: string
  contract_amount_cents: number
  cash_collected_cents: number
  commission_earned_cents: number
  outstanding_cents: number
  current_rate: number
  projected_remaining_commission_cents: number
  payments_received_count: number
  installments_planned: number
  lead?: { full_name: string; email: string | null } | null
  next_installment_due_date?: string | null
  next_installment_amount_cents?: number | null
}

export interface CloserDashboardData {
  commission_mtd_cents: number
  commission_last_month_cents: number
  cash_mtd_cents: number
  cash_last_month_cents: number
  deals_with_payment_mtd: number
  pending_payout_cents: number
  calls_today: number
  payments_today_count: number
  commission_today_cents: number
}

function monthStart(offsetMonths = 0): string {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCMonth(d.getUTCMonth() + offsetMonths)
  return d.toISOString()
}

function todayStartUtc(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

export function useCloserDashboard() {
  const { profile } = useAuth()
  return useQuery<CloserDashboardData>({
    queryKey: ["closer-dashboard", profile?.id],
    enabled: isSupabaseConfigured && Boolean(profile?.id),
    queryFn: async () => {
      const thisMonth = monthStart(0)
      const lastMonth = monthStart(-1)
      const today = todayStartUtc()

      // RLS filters to current closer's records automatically
      const [
        { data: mtd },
        { data: lastMonthRows },
        { data: pending },
        { data: todayRows },
        { data: todayCalls },
      ] = await Promise.all([
        supabase
          .from("commission_records")
          .select("payment_amount_cents, commission_amount_cents, deal_id, status")
          .gte("earned_at", thisMonth)
          .neq("status", "clawed_back"),
        supabase
          .from("commission_records")
          .select("payment_amount_cents, commission_amount_cents, status")
          .gte("earned_at", lastMonth)
          .lt("earned_at", thisMonth)
          .neq("status", "clawed_back"),
        supabase
          .from("commission_records")
          .select("commission_amount_cents")
          .eq("status", "earned"),
        supabase
          .from("commission_records")
          .select("commission_amount_cents, payment_amount_cents")
          .gte("earned_at", today)
          .neq("status", "clawed_back"),
        supabase
          .from("leads")
          .select("id, scheduled_at")
          .gte("scheduled_at", today),
      ])

      const commission_mtd_cents =
        (mtd ?? []).reduce((s, r) => s + r.commission_amount_cents, 0)
      const cash_mtd_cents =
        (mtd ?? []).reduce((s, r) => s + r.payment_amount_cents, 0)
      const deals_with_payment_mtd = new Set((mtd ?? []).map((r) => r.deal_id)).size
      const commission_last_month_cents =
        (lastMonthRows ?? []).reduce((s, r) => s + r.commission_amount_cents, 0)
      const cash_last_month_cents =
        (lastMonthRows ?? []).reduce((s, r) => s + r.payment_amount_cents, 0)
      const pending_payout_cents =
        (pending ?? []).reduce((s, r) => s + r.commission_amount_cents, 0)
      const commission_today_cents =
        (todayRows ?? []).reduce((s, r) => s + r.commission_amount_cents, 0)
      const payments_today_count = (todayRows ?? []).length
      const calls_today = (todayCalls ?? []).length

      return {
        commission_mtd_cents,
        commission_last_month_cents,
        cash_mtd_cents,
        cash_last_month_cents,
        deals_with_payment_mtd,
        pending_payout_cents,
        calls_today,
        payments_today_count,
        commission_today_cents,
      }
    },
  })
}

export function useOutstandingDeals() {
  return useQuery<DealCommissionSummary[]>({
    queryKey: ["outstanding-deals"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      // RLS scopes to current closer's deals via commission_records policy
      const { data, error } = await supabase
        .from("deal_commission_summary")
        .select("*, lead:leads(full_name, email)")
        .gt("outstanding_cents", 0)
      if (error) throw error
      const rows = (data ?? []) as DealCommissionSummary[]
      if (rows.length === 0) return rows

      // Tack on the next-due installment for each deal
      const dealIds = rows.map((r) => r.deal_id)
      const { data: nextInst } = await supabase
        .from("deal_installments")
        .select("deal_id, due_date, amount_cents, paid_at, status")
        .in("deal_id", dealIds)
        .is("paid_at", null)
        .neq("status", "written_off")
        .order("due_date", { ascending: true })

      const nextByDeal = new Map<string, { due_date: string; amount_cents: number }>()
      for (const i of nextInst ?? []) {
        if (!nextByDeal.has(i.deal_id)) {
          nextByDeal.set(i.deal_id, {
            due_date: i.due_date,
            amount_cents: i.amount_cents,
          })
        }
      }
      const enriched = rows.map((r) => ({
        ...r,
        next_installment_due_date: nextByDeal.get(r.deal_id)?.due_date ?? null,
        next_installment_amount_cents:
          nextByDeal.get(r.deal_id)?.amount_cents ?? null,
      }))
      // Sort by next due date asc, no-date rows last
      enriched.sort((a, b) => {
        const aD = a.next_installment_due_date ?? "9999-12-31"
        const bD = b.next_installment_due_date ?? "9999-12-31"
        return aD.localeCompare(bD)
      })
      return enriched
    },
  })
}

export function useRecentCommissions(limit = 10) {
  return useQuery<CommissionRecord[]>({
    queryKey: ["recent-commissions", limit],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commission_records")
        .select(
          "*, lead:leads(full_name), deal:deals(coaching_tier, amount_cents)"
        )
        .order("earned_at", { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as CommissionRecord[]
    },
  })
}

export function useCommissionLedger() {
  return useQuery<{
    this_month: CommissionRecord[]
    pending: CommissionRecord[]
    paid_out: CommissionRecord[]
    clawbacks: CommissionRecord[]
  }>({
    queryKey: ["commission-ledger"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const thisMonth = monthStart(0)
      const { data } = await supabase
        .from("commission_records")
        .select("*, lead:leads(full_name), deal:deals(coaching_tier)")
        .order("earned_at", { ascending: false })
        .limit(500)
      const rows = ((data ?? []) as CommissionRecord[])
      return {
        this_month: rows.filter(
          (r) => r.earned_at >= thisMonth && r.status !== "clawed_back"
        ),
        pending: rows.filter(
          (r) => r.status === "earned" && r.earned_at < thisMonth
        ),
        paid_out: rows.filter((r) => r.status === "paid_out"),
        clawbacks: rows.filter((r) => r.status === "clawed_back"),
      }
    },
  })
}

// ─── Admin helpers ─────────────────────────────────────────────────────────

export interface CloserCommissionSummary {
  closer_id: string
  full_name: string
  commission_rate: number
  cash_mtd_cents: number
  commission_mtd_cents: number
  pending_payout_cents: number
  lifetime_earned_cents: number
  lifetime_paid_out_cents: number
  last_payout_at: string | null
}

export function useTeamCommissionSummary() {
  return useQuery<CloserCommissionSummary[]>({
    queryKey: ["team-commission-summary"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const thisMonth = monthStart(0)
      const { data: closers } = await supabase
        .from("team_members")
        .select("id, full_name, commission_pct, is_active, role")
        .in("role", ["closer", "admin"])
        .eq("is_active", true)
      const { data: records } = await supabase
        .from("commission_records")
        .select("closer_id, payment_amount_cents, commission_amount_cents, status, earned_at, paid_out_at")

      const rows = (records ?? []) as {
        closer_id: string
        payment_amount_cents: number
        commission_amount_cents: number
        status: string
        earned_at: string
        paid_out_at: string | null
      }[]

      return (closers ?? []).map((c) => {
        const mine = rows.filter((r) => r.closer_id === c.id)
        const active = mine.filter((r) => r.status !== "clawed_back")
        const mtd = active.filter((r) => r.earned_at >= thisMonth)
        const pending = mine.filter((r) => r.status === "earned")
        const paid = mine.filter((r) => r.status === "paid_out")
        const lastPayout = paid
          .map((r) => r.paid_out_at)
          .filter((d): d is string => Boolean(d))
          .sort()
          .pop()
        return {
          closer_id: c.id,
          full_name: c.full_name,
          commission_rate: c.commission_pct ?? 10,
          cash_mtd_cents: mtd.reduce((s, r) => s + r.payment_amount_cents, 0),
          commission_mtd_cents: mtd.reduce(
            (s, r) => s + r.commission_amount_cents,
            0
          ),
          pending_payout_cents: pending.reduce(
            (s, r) => s + r.commission_amount_cents,
            0
          ),
          lifetime_earned_cents: active.reduce(
            (s, r) => s + r.commission_amount_cents,
            0
          ),
          lifetime_paid_out_cents: paid.reduce(
            (s, r) => s + r.commission_amount_cents,
            0
          ),
          last_payout_at: lastPayout ?? null,
        }
      })
    },
  })
}

interface UpdateRateInput {
  closer_id: string
  new_rate: number
}

export function useUpdateCommissionRate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateRateInput) => {
      const { data: me } = await supabase
        .from("team_members")
        .select("id")
        .limit(1)
        .maybeSingle()
      const { error } = await supabase
        .from("team_members")
        .update({
          commission_pct: input.new_rate,
          commission_rate_updated_at: new Date().toISOString(),
          commission_rate_updated_by: me?.id ?? null,
        })
        .eq("id", input.closer_id)
      if (error) throw new Error(error.message)
      return { ok: true }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-commission-summary"] })
      qc.invalidateQueries({ queryKey: ["team-list"] })
    },
  })
}

interface ProcessPayoutInput {
  closer_id: string
  record_ids: string[]
  payout_reference: string
}

export function useProcessPayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ProcessPayoutInput) => {
      const nowIso = new Date().toISOString()
      const { data: me } = await supabase
        .from("team_members")
        .select("id")
        .limit(1)
        .maybeSingle()
      const { error } = await supabase
        .from("commission_records")
        .update({
          status: "paid_out",
          paid_out_at: nowIso,
          paid_out_by: me?.id ?? null,
          payout_reference: input.payout_reference,
        })
        .in("id", input.record_ids)
        .eq("status", "earned")
      if (error) throw new Error(error.message)
      return { ok: true, count: input.record_ids.length }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-commission-summary"] })
      qc.invalidateQueries({ queryKey: ["closer-dashboard"] })
      qc.invalidateQueries({ queryKey: ["commission-ledger"] })
    },
  })
}
