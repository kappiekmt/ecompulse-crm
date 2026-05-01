import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"

export interface PaymentLedgerRow {
  id: string
  paid_at: string
  amount_cents: number
  currency: string
  is_refund: boolean
  source: string
  notes: string | null
  lead_id: string | null
  deal_id: string | null
  lead_name: string | null
  lead_email: string | null
  closer_id: string | null
  closer_name: string | null
  closer_pct: number | null
  setter_id: string | null
  setter_name: string | null
  setter_pct: number | null
  closer_commission_cents: number
  setter_commission_cents: number
  /** Amount paid out to the team in commissions for this payment row. */
  total_commission_cents: number
  /** Net for the house after commissions (still gross of overhead). */
  net_cents: number
}

export interface FinanceSummary {
  revenue_cents: number
  refund_cents: number
  net_revenue_cents: number
  closer_commission_cents: number
  setter_commission_cents: number
  total_commission_cents: number
  profit_cents: number
  payment_count: number
  refund_count: number
}

export interface TeamCommissionRow {
  team_member_id: string
  full_name: string
  role: string
  closer_cents: number
  setter_cents: number
  total_cents: number
  payment_count: number
}

export interface ProfitSplitShare {
  team_member_id: string
  full_name: string
  share_pct: number
  share_cents: number
}

export interface FinanceReport {
  rows: PaymentLedgerRow[]
  summary: FinanceSummary
  byTeamMember: TeamCommissionRow[]
  splits: ProfitSplitShare[]
}

export interface FinancePeriod {
  startUtc: string
  endUtc: string
}

interface PaymentRow {
  id: string
  paid_at: string
  amount_cents: number
  currency: string
  is_refund: boolean
  source: string
  notes: string | null
  lead_id: string | null
  deal_id: string | null
  lead: {
    full_name: string | null
    email: string | null
    closer_id: string | null
    setter_id: string | null
  } | null
}

interface TeamMember {
  id: string
  full_name: string
  role: string
  commission_pct: number | null
}

interface ProfitSplitRow {
  team_member_id: string
  share_pct: number
  display_order: number
  team: { full_name: string } | null
}

export function useFinanceReport(period: FinancePeriod) {
  return useQuery<FinanceReport>({
    queryKey: ["finance-report", period.startUtc, period.endUtc],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const [{ data: paymentsData, error: paymentsErr }, { data: teamData }, { data: splitsData }] =
        await Promise.all([
          supabase
            .from("payments")
            .select(
              "id, paid_at, amount_cents, currency, is_refund, source, notes, lead_id, deal_id, lead:leads(full_name, email, closer_id, setter_id)"
            )
            .gte("paid_at", period.startUtc)
            .lt("paid_at", period.endUtc)
            .order("paid_at", { ascending: false }),
          supabase
            .from("team_members")
            .select("id, full_name, role, commission_pct"),
          supabase
            .from("profit_splits")
            .select("team_member_id, share_pct, display_order, team:team_members!profit_splits_team_member_id_fkey(full_name)")
            .order("display_order"),
        ])

      if (paymentsErr) throw paymentsErr

      const team = new Map<string, TeamMember>()
      for (const m of (teamData ?? []) as TeamMember[]) team.set(m.id, m)

      const rows: PaymentLedgerRow[] = ((paymentsData ?? []) as unknown as PaymentRow[]).map(
        (p) => {
          const lead = p.lead
          const closerId = lead?.closer_id ?? null
          const setterId = lead?.setter_id ?? null
          const closer = closerId ? team.get(closerId) ?? null : null
          const setter = setterId ? team.get(setterId) ?? null : null
          const closerPct = closer?.commission_pct ?? 0
          const setterPct = setter?.commission_pct ?? 0
          // Commissions follow the sign of the payment (refunds → negative,
          // i.e. clawback). Round to whole cents.
          const closerCommission = Math.round((p.amount_cents * Number(closerPct)) / 100)
          const setterCommission = Math.round((p.amount_cents * Number(setterPct)) / 100)
          const totalCommission = closerCommission + setterCommission
          return {
            id: p.id,
            paid_at: p.paid_at,
            amount_cents: p.amount_cents,
            currency: p.currency,
            is_refund: p.is_refund,
            source: p.source,
            notes: p.notes,
            lead_id: p.lead_id,
            deal_id: p.deal_id,
            lead_name: lead?.full_name ?? null,
            lead_email: lead?.email ?? null,
            closer_id: closerId,
            closer_name: closer?.full_name ?? null,
            closer_pct: closer ? Number(closerPct) : null,
            setter_id: setterId,
            setter_name: setter?.full_name ?? null,
            setter_pct: setter ? Number(setterPct) : null,
            closer_commission_cents: closerCommission,
            setter_commission_cents: setterCommission,
            total_commission_cents: totalCommission,
            net_cents: p.amount_cents - totalCommission,
          }
        }
      )

      let revenueCents = 0
      let refundCents = 0
      let closerComm = 0
      let setterComm = 0
      let paymentCount = 0
      let refundCount = 0
      const byTeam = new Map<string, TeamCommissionRow>()

      function addToTeam(
        memberId: string,
        memberName: string,
        memberRole: string,
        kind: "closer" | "setter",
        cents: number
      ) {
        let row = byTeam.get(memberId)
        if (!row) {
          row = {
            team_member_id: memberId,
            full_name: memberName,
            role: memberRole,
            closer_cents: 0,
            setter_cents: 0,
            total_cents: 0,
            payment_count: 0,
          }
          byTeam.set(memberId, row)
        }
        if (kind === "closer") row.closer_cents += cents
        else row.setter_cents += cents
        row.total_cents += cents
        row.payment_count += 1
      }

      for (const r of rows) {
        if (r.is_refund) {
          // Refund amounts are stored negative; track magnitude separately.
          refundCents += -r.amount_cents
          refundCount += 1
        } else {
          revenueCents += r.amount_cents
          paymentCount += 1
        }
        closerComm += r.closer_commission_cents
        setterComm += r.setter_commission_cents
        if (r.closer_id && r.closer_name) {
          addToTeam(
            r.closer_id,
            r.closer_name,
            team.get(r.closer_id)?.role ?? "closer",
            "closer",
            r.closer_commission_cents
          )
        }
        if (r.setter_id && r.setter_name) {
          addToTeam(
            r.setter_id,
            r.setter_name,
            team.get(r.setter_id)?.role ?? "setter",
            "setter",
            r.setter_commission_cents
          )
        }
      }

      const netRevenue = revenueCents - refundCents
      const totalComm = closerComm + setterComm
      const profit = netRevenue - totalComm

      const summary: FinanceSummary = {
        revenue_cents: revenueCents,
        refund_cents: refundCents,
        net_revenue_cents: netRevenue,
        closer_commission_cents: closerComm,
        setter_commission_cents: setterComm,
        total_commission_cents: totalComm,
        profit_cents: profit,
        payment_count: paymentCount,
        refund_count: refundCount,
      }

      const splits: ProfitSplitShare[] = ((splitsData ?? []) as unknown as ProfitSplitRow[]).map(
        (s) => {
          const pct = Number(s.share_pct)
          return {
            team_member_id: s.team_member_id,
            full_name: s.team?.full_name ?? "Unknown",
            share_pct: pct,
            share_cents: Math.round((profit * pct) / 100),
          }
        }
      )

      const byTeamMember = [...byTeam.values()].sort(
        (a, b) => b.total_cents - a.total_cents
      )

      return { rows, summary, byTeamMember, splits }
    },
  })
}

// ─── Profit splits CRUD ─────────────────────────────────────────────────────

export interface ProfitSplitEditableRow {
  id: string
  team_member_id: string
  share_pct: number
  display_order: number
  full_name: string
}

export function useProfitSplits() {
  return useQuery<ProfitSplitEditableRow[]>({
    queryKey: ["profit-splits"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profit_splits")
        .select(
          "id, team_member_id, share_pct, display_order, team:team_members!profit_splits_team_member_id_fkey(full_name)"
        )
        .order("display_order")
      if (error) throw error
      type Joined = {
        id: string
        team_member_id: string
        share_pct: number
        display_order: number
        team: { full_name: string } | null
      }
      return ((data ?? []) as unknown as Joined[]).map((r) => ({
        id: r.id,
        team_member_id: r.team_member_id,
        share_pct: Number(r.share_pct),
        display_order: r.display_order,
        full_name: r.team?.full_name ?? "Unknown",
      }))
    },
  })
}

export function useUpdateProfitSplit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, share_pct }: { id: string; share_pct: number }) => {
      const { error } = await supabase
        .from("profit_splits")
        .update({ share_pct, updated_at: new Date().toISOString() })
        .eq("id", id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profit-splits"] })
      qc.invalidateQueries({ queryKey: ["finance-report"] })
    },
  })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export interface PeriodPreset {
  key: "this_month" | "last_month" | "quarter_to_date" | "year_to_date" | "all_time"
  label: string
}

export const PERIOD_PRESETS: PeriodPreset[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "quarter_to_date", label: "Quarter to date" },
  { key: "year_to_date", label: "Year to date" },
  { key: "all_time", label: "All time" },
]

export function periodFromPreset(key: PeriodPreset["key"]): FinancePeriod {
  const now = new Date()
  const startOfMonth = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  const startOfQuarter = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1))
  const startOfYear = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), 0, 1))

  let start: Date
  let end: Date = new Date(now.getTime() + 24 * 3600 * 1000)
  switch (key) {
    case "this_month":
      start = startOfMonth(now)
      break
    case "last_month": {
      const lm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      start = lm
      end = startOfMonth(now)
      break
    }
    case "quarter_to_date":
      start = startOfQuarter(now)
      break
    case "year_to_date":
      start = startOfYear(now)
      break
    case "all_time":
    default:
      start = new Date(0)
  }
  return { startUtc: start.toISOString(), endUtc: end.toISOString() }
}

/** Build a CSV from the per-payment ledger rows. */
export function ledgerToCsv(rows: PaymentLedgerRow[]): string {
  const cols: { key: keyof PaymentLedgerRow | "amount_eur" | "closer_commission_eur" | "setter_commission_eur" | "net_eur"; label: string }[] = [
    { key: "paid_at", label: "Paid at" },
    { key: "is_refund", label: "Refund" },
    { key: "source", label: "Source" },
    { key: "lead_name", label: "Lead" },
    { key: "lead_email", label: "Email" },
    { key: "amount_eur", label: "Amount (EUR)" },
    { key: "closer_name", label: "Closer" },
    { key: "closer_pct", label: "Closer %" },
    { key: "closer_commission_eur", label: "Closer commission (EUR)" },
    { key: "setter_name", label: "Setter" },
    { key: "setter_pct", label: "Setter %" },
    { key: "setter_commission_eur", label: "Setter commission (EUR)" },
    { key: "net_eur", label: "Net for house (EUR)" },
    { key: "notes", label: "Notes" },
  ]
  const escape = (val: unknown) => {
    if (val === null || val === undefined) return ""
    const s = String(val)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const header = cols.map((c) => escape(c.label)).join(",")
  const lines = rows.map((r) =>
    cols
      .map((c) => {
        switch (c.key) {
          case "amount_eur":
            return escape((r.amount_cents / 100).toFixed(2))
          case "closer_commission_eur":
            return escape((r.closer_commission_cents / 100).toFixed(2))
          case "setter_commission_eur":
            return escape((r.setter_commission_cents / 100).toFixed(2))
          case "net_eur":
            return escape((r.net_cents / 100).toFixed(2))
          default:
            return escape(r[c.key as keyof PaymentLedgerRow])
        }
      })
      .join(",")
  )
  return [header, ...lines].join("\n")
}
