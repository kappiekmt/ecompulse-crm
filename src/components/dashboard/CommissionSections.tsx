import * as React from "react"
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  Clock,
  Loader2,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  useCloserDashboard,
  useCommissionLedger,
  useOutstandingDeals,
  useRecentCommissions,
} from "@/lib/queries/commissions"
import { tierByKey } from "@/lib/tiers"
import { cn, formatCurrency, formatDateTime } from "@/lib/utils"

function pctDelta(curr: number, prev: number): {
  pct: number | null
  sign: "up" | "down" | "flat" | "new"
} {
  if (prev === 0 && curr === 0) return { pct: 0, sign: "flat" }
  if (prev === 0) return { pct: null, sign: "new" }
  const d = ((curr - prev) / prev) * 100
  return {
    pct: Math.abs(Math.round(d)),
    sign: d > 0.5 ? "up" : d < -0.5 ? "down" : "flat",
  }
}

function DeltaBadge({
  current,
  prior,
}: {
  current: number
  prior: number
}) {
  const { pct, sign } = pctDelta(current, prior)
  if (sign === "new")
    return <span className="text-[10px] text-[var(--color-muted-foreground)]">new this period</span>
  if (pct === null || sign === "flat")
    return null
  const Arrow = sign === "up" ? ArrowUp : ArrowDown
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] font-medium",
        sign === "up" ? "text-[var(--color-success)]" : "text-[var(--color-destructive)]"
      )}
    >
      <Arrow className="h-2.5 w-2.5" />
      {pct}% vs last month
    </span>
  )
}

export function CommissionKpiCards({
  leadsToday,
}: {
  leadsToday: number
}) {
  const dash = useCloserDashboard()
  const d = dash.data

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="flex flex-col gap-2 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
            <Wallet className="h-4 w-4 text-[var(--color-success)]" />
            Commission MTD
          </div>
          <span className="text-3xl font-semibold tabular-nums">
            {formatCurrency(d?.commission_mtd_cents ?? 0)}
          </span>
          {d && (
            <DeltaBadge
              current={d.commission_mtd_cents}
              prior={d.commission_last_month_cents}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
            <Banknote className="h-4 w-4 text-[var(--color-primary)]" />
            Cash collected MTD
          </div>
          <span className="text-3xl font-semibold tabular-nums">
            {formatCurrency(d?.cash_mtd_cents ?? 0)}
          </span>
          <span className="text-[10px] text-[var(--color-muted-foreground)]">
            {d?.deals_with_payment_mtd ?? 0} deals received payments
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
            <Clock className="h-4 w-4 text-[var(--color-warning)]" />
            Pending payout
          </div>
          <span className="text-3xl font-semibold tabular-nums">
            {formatCurrency(d?.pending_payout_cents ?? 0)}
          </span>
          <span className="text-[10px] text-[var(--color-muted-foreground)]">
            Earned but not paid out
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
            <TrendingUp className="h-4 w-4 text-[var(--color-primary)]" />
            Today
          </div>
          <span className="text-3xl font-semibold tabular-nums">
            {formatCurrency(d?.commission_today_cents ?? 0)}
          </span>
          <span className="text-[10px] text-[var(--color-muted-foreground)]">
            {leadsToday} calls · {d?.payments_today_count ?? 0} payments
          </span>
        </CardContent>
      </Card>
    </div>
  )
}

export function OutstandingDealsTable({
  onOpenLead,
  role = "closer",
}: {
  onOpenLead: (leadId: string) => void
  /** Which side's earned + projected to display. Defaults to "closer". */
  role?: "closer" | "setter"
}) {
  const deals = useOutstandingDeals()
  const data = deals.data ?? []

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-6">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-base font-semibold">Money still coming</span>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              Your won deals with outstanding payments — sorted by next due date.
            </span>
          </div>
          {data.length > 0 && (
            <Badge variant="muted">{data.length} active</Badge>
          )}
        </div>

        {deals.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-[var(--color-muted-foreground)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : data.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--color-muted-foreground)]">
            No deals with outstanding balance — every won deal is paid in full.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="pb-2 pr-3">Lead</th>
                  <th className="pb-2 pr-3 text-right">Collected</th>
                  <th className="pb-2 pr-3 text-right">Outstanding</th>
                  <th className="pb-2 pr-3 text-right">Earned</th>
                  <th className="pb-2 pr-3 text-right">Projected</th>
                  <th className="pb-2">Next due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.map((row) => {
                  const pct = row.contract_amount_cents
                    ? Math.round(
                        (row.cash_collected_cents / row.contract_amount_cents) * 100
                      )
                    : 0
                  return (
                    <tr
                      key={row.deal_id}
                      onClick={() => onOpenLead(row.lead_id)}
                      className="cursor-pointer hover:bg-[var(--color-muted)]/30"
                    >
                      <td className="py-2 pr-3">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {row.lead?.full_name ?? "—"}
                          </span>
                          <div className="mt-1 flex h-1.5 w-32 overflow-hidden rounded-full bg-[var(--color-border)]">
                            <div
                              className="h-full bg-[var(--color-primary)]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-[var(--color-muted-foreground)]">
                            {pct}% of {formatCurrency(row.contract_amount_cents)}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatCurrency(row.cash_collected_cents)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">
                        {formatCurrency(row.outstanding_cents)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-success)]">
                        +{formatCurrency(
                          role === "setter"
                            ? row.setter_commission_earned_cents
                            : row.commission_earned_cents
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-muted-foreground)]">
                        +{formatCurrency(
                          role === "setter"
                            ? row.projected_remaining_setter_commission_cents
                            : row.projected_remaining_commission_cents
                        )}
                      </td>
                      <td className="py-2 text-xs">
                        {row.next_installment_due_date ? (
                          <div className="flex flex-col">
                            <span>
                              {new Date(
                                row.next_installment_due_date + "T00:00:00Z"
                              ).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                              })}
                            </span>
                            <span className="text-[var(--color-muted-foreground)]">
                              {formatCurrency(
                                row.next_installment_amount_cents ?? 0
                              )}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[var(--color-muted-foreground)]">
                            unscheduled
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function RecentCommissionsAndLedger({
  onOpenLead,
}: {
  onOpenLead: (leadId: string) => void
}) {
  const recent = useRecentCommissions(10)
  const ledger = useCommissionLedger()
  const [tab, setTab] = React.useState<"this_month" | "pending" | "paid_out" | "clawbacks">(
    "this_month"
  )

  const ledgerRows = ledger.data?.[tab] ?? []
  const ledgerTotal = ledgerRows.reduce(
    (s, r) => s + r.commission_amount_cents,
    0
  )

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="flex flex-col gap-3 p-6">
          <div className="flex flex-col">
            <span className="text-base font-semibold">Recent payments</span>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              Last 10 payments + your commission cut.
            </span>
          </div>
          {recent.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-[var(--color-muted-foreground)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : (recent.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--color-muted-foreground)]">
              No commission records yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--color-border)]">
              {(recent.data ?? []).map((r) => (
                <li
                  key={r.id}
                  onClick={() => onOpenLead(r.lead_id)}
                  className="flex cursor-pointer items-center justify-between gap-2 py-2.5 hover:opacity-80"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {r.lead?.full_name ?? "Lead"}
                    </span>
                    <span className="text-[10px] text-[var(--color-muted-foreground)]">
                      {tierByKey(r.deal?.coaching_tier ?? null)?.label ?? ""} ·{" "}
                      {formatDateTime(r.earned_at)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-medium tabular-nums">
                      {formatCurrency(r.payment_amount_cents)}
                    </span>
                    <span className="text-[10px] font-medium text-[var(--color-success)]">
                      +{formatCurrency(r.commission_amount_cents)} commission
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-6">
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold">Commission ledger</span>
            <span className="text-sm font-semibold tabular-nums">
              {formatCurrency(ledgerTotal)}
            </span>
          </div>
          <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-0.5">
            {(["this_month", "pending", "paid_out", "clawbacks"] as const).map(
              (t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "flex-1 rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors",
                    tab === t
                      ? "bg-[var(--color-secondary)] text-[var(--color-foreground)]"
                      : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  )}
                >
                  {t.replace("_", " ")}
                </button>
              )
            )}
          </div>
          {ledger.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-[var(--color-muted-foreground)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : ledgerRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--color-muted-foreground)]">
              Nothing here yet.
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col divide-y divide-[var(--color-border)] overflow-y-auto">
              {ledgerRows.map((r) => (
                <li
                  key={r.id}
                  onClick={() => onOpenLead(r.lead_id)}
                  className="flex cursor-pointer items-center justify-between gap-2 py-2 text-xs hover:opacity-80"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-[var(--color-foreground)]">
                      {r.lead?.full_name ?? "Lead"}
                    </span>
                    <span className="text-[10px] text-[var(--color-muted-foreground)]">
                      {formatDateTime(r.earned_at)}
                      {r.payout_reference && ` · ${r.payout_reference}`}
                      {r.clawback_reason && ` · ${r.clawback_reason}`}
                    </span>
                  </div>
                  <span className="font-medium tabular-nums">
                    {formatCurrency(r.commission_amount_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
