import * as React from "react"
import {
  Banknote,
  CircleDollarSign,
  Download,
  Loader2,
  PiggyBank,
  Receipt,
  Settings2,
  TrendingDown,
  Users,
} from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  ledgerToCsv,
  PERIOD_PRESETS,
  periodFromPreset,
  useFinanceReport,
  useProfitSplits,
  useUpdateProfitSplit,
  type PeriodPreset,
} from "@/lib/queries/finance"
import { useAuth } from "@/lib/auth"
import { cn, formatCurrency, formatDateTime, initials } from "@/lib/utils"

export function Finance() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === "admin"
  const [presetKey, setPresetKey] = React.useState<PeriodPreset["key"]>("this_month")
  const period = React.useMemo(() => periodFromPreset(presetKey), [presetKey])
  const report = useFinanceReport(period)

  // Don't even fetch finance data if the user isn't an admin — RLS would
  // block writes anyway, but the client-side gate keeps the page from
  // flashing partial content while loading.
  if (!isAdmin) {
    return (
      <div className="flex flex-col">
        <PageHeader
          title="Finance"
          description="Cash, commissions, and profit split — admins only."
        />
        <div className="p-8">
          <Card>
            <CardContent className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
              You don't have permission to view this page.
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const summary = report.data?.summary
  const splits = report.data?.splits ?? []
  const byTeamMember = report.data?.byTeamMember ?? []
  const rows = report.data?.rows ?? []

  function downloadCsv() {
    if (!rows.length) return
    const csv = ledgerToCsv(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const periodSlug = presetKey.replace(/_/g, "-")
    a.href = url
    a.download = `ecompulse-ledger-${periodSlug}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Finance"
        description="Cash collected, commission payouts to closers/setters, and profit split."
        actions={
          <Button onClick={downloadCsv} disabled={!rows.length}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-8">
        {/* Period picker */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Period
          </span>
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5">
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPresetKey(p.key)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition-colors",
                  presetKey === p.key
                    ? "bg-[var(--color-secondary)] text-[var(--color-foreground)]"
                    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {report.isLoading && (
            <Loader2 className="ml-1 h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
          )}
          {report.data && (
            <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">
              {summary?.payment_count ?? 0} payment{summary?.payment_count === 1 ? "" : "s"}
              {(summary?.refund_count ?? 0) > 0
                ? ` · ${summary?.refund_count} refund${
                    summary?.refund_count === 1 ? "" : "s"
                  }`
                : ""}
            </span>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard
            label="Net revenue"
            value={formatCurrency(summary?.net_revenue_cents ?? 0)}
            sub={`Gross ${formatCurrency(summary?.revenue_cents ?? 0)} · Refunds ${formatCurrency(
              summary?.refund_cents ?? 0
            )}`}
            icon={<Banknote className="h-4 w-4" />}
            tone="default"
          />
          <SummaryCard
            label="Closer commissions"
            value={formatCurrency(summary?.closer_commission_cents ?? 0)}
            sub="Sum of payment × commission %"
            icon={<Users className="h-4 w-4" />}
            tone="muted"
          />
          <SummaryCard
            label="Setter commissions"
            value={formatCurrency(summary?.setter_commission_cents ?? 0)}
            sub="Sum of payment × commission %"
            icon={<Users className="h-4 w-4" />}
            tone="muted"
          />
          <SummaryCard
            label="Profit"
            value={formatCurrency(summary?.profit_cents ?? 0)}
            sub="Net revenue − all commissions"
            icon={<PiggyBank className="h-4 w-4" />}
            tone="success"
          />
        </div>

        {/* Profit split */}
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-success)]/10 text-[var(--color-success)]">
                  <CircleDollarSign className="h-4 w-4" />
                </span>
                <div className="flex flex-col">
                  <span className="text-base font-semibold">Profit split</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    Each owner's share of the {formatCurrency(summary?.profit_cents ?? 0)} profit
                    based on configured percentages.
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {splits.map((s) => (
                <div
                  key={s.team_member_id}
                  className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-4"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-secondary)] text-xs font-semibold">
                      {initials(s.full_name)}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{s.full_name}</span>
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        {s.share_pct}%
                      </span>
                    </div>
                  </div>
                  <span className="text-xl font-semibold tabular-nums">
                    {formatCurrency(s.share_cents)}
                  </span>
                </div>
              ))}
            </div>
            <ProfitSplitEditor />
          </CardContent>
        </Card>

        {/* Per-team commission breakdown */}
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-secondary)]">
                <Receipt className="h-4 w-4" />
              </span>
              <div className="flex flex-col">
                <span className="text-base font-semibold">Commissions by team member</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  What each closer / setter earned in this period.
                </span>
              </div>
            </div>
            {byTeamMember.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--color-border)] py-4 text-center text-xs text-[var(--color-muted-foreground)]">
                No commissions in this period — either no payments yet or no team members are
                assigned.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium">Team member</th>
                      <th className="px-2 py-2 text-left font-medium">Role</th>
                      <th className="px-2 py-2 text-right font-medium">Closer comm.</th>
                      <th className="px-2 py-2 text-right font-medium">Setter comm.</th>
                      <th className="px-2 py-2 text-right font-medium">Total</th>
                      <th className="px-2 py-2 text-right font-medium">Payments</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {byTeamMember.map((m) => (
                      <tr key={m.team_member_id}>
                        <td className="px-2 py-2 font-medium">{m.full_name}</td>
                        <td className="px-2 py-2 text-xs text-[var(--color-muted-foreground)] capitalize">
                          {m.role}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {m.closer_cents ? formatCurrency(m.closer_cents) : "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {m.setter_cents ? formatCurrency(m.setter_cents) : "—"}
                        </td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums">
                          {formatCurrency(m.total_cents)}
                        </td>
                        <td className="px-2 py-2 text-right text-xs text-[var(--color-muted-foreground)]">
                          {m.payment_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-payment ledger */}
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-secondary)]">
                  <TrendingDown className="h-4 w-4" />
                </span>
                <div className="flex flex-col">
                  <span className="text-base font-semibold">Payment ledger</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    Every payment + refund in this period, with the commissions it triggered.
                  </span>
                </div>
              </div>
            </div>
            {rows.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--color-border)] py-4 text-center text-xs text-[var(--color-muted-foreground)]">
                No payments in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium">Date</th>
                      <th className="px-2 py-2 text-left font-medium">Lead</th>
                      <th className="px-2 py-2 text-right font-medium">Amount</th>
                      <th className="px-2 py-2 text-left font-medium">Closer</th>
                      <th className="px-2 py-2 text-right font-medium">Closer comm.</th>
                      <th className="px-2 py-2 text-left font-medium">Setter</th>
                      <th className="px-2 py-2 text-right font-medium">Setter comm.</th>
                      <th className="px-2 py-2 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {rows.map((r) => (
                      <tr key={r.id} className={r.is_refund ? "bg-[var(--color-destructive)]/5" : undefined}>
                        <td className="px-2 py-2 text-xs text-[var(--color-muted-foreground)]">
                          {formatDateTime(r.paid_at)}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <span>{r.lead_name ?? "—"}</span>
                            {r.is_refund && <Badge variant="destructive">Refund</Badge>}
                          </div>
                          <div className="text-xs text-[var(--color-muted-foreground)]">
                            {r.lead_email ?? ""}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {formatCurrency(r.amount_cents, r.currency)}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {r.closer_name ?? <span className="text-[var(--color-muted-foreground)]">—</span>}
                          {r.closer_pct !== null && r.closer_pct > 0 && (
                            <span className="ml-1 text-[var(--color-muted-foreground)]">
                              ({r.closer_pct}%)
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-xs">
                          {r.closer_commission_cents
                            ? formatCurrency(r.closer_commission_cents)
                            : "—"}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {r.setter_name ?? <span className="text-[var(--color-muted-foreground)]">—</span>}
                          {r.setter_pct !== null && r.setter_pct > 0 && (
                            <span className="ml-1 text-[var(--color-muted-foreground)]">
                              ({r.setter_pct}%)
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-xs">
                          {r.setter_commission_cents
                            ? formatCurrency(r.setter_commission_cents)
                            : "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-medium">
                          {formatCurrency(r.net_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string
  value: string
  sub: string
  icon: React.ReactNode
  tone: "default" | "muted" | "success"
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md",
              tone === "success"
                ? "bg-[var(--color-success)]/10 text-[var(--color-success)]"
                : tone === "muted"
                ? "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
                : "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
            )}
          >
            {icon}
          </span>
          <span className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {label}
          </span>
        </div>
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        <span className="text-[11px] text-[var(--color-muted-foreground)]">{sub}</span>
      </CardContent>
    </Card>
  )
}

function ProfitSplitEditor() {
  const splits = useProfitSplits()
  const update = useUpdateProfitSplit()
  const [open, setOpen] = React.useState(false)

  const total = (splits.data ?? []).reduce((s, r) => s + r.share_pct, 0)

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-[var(--color-border)] p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <Settings2 className="h-3.5 w-3.5" />
        {open ? "Hide" : "Edit"} profit split
        <span className="ml-auto">
          Total:{" "}
          <span
            className={
              total === 100
                ? "text-[var(--color-success)]"
                : "text-[var(--color-warning)]"
            }
          >
            {total}%
          </span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 pt-2">
          {(splits.data ?? []).map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-md border border-[var(--color-border)] px-3 py-2"
            >
              <span className="flex-1 text-sm">{s.full_name}</span>
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={s.share_pct}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value)
                  if (!Number.isFinite(v) || v < 0 || v > 100) return
                  if (v === s.share_pct) return
                  update.mutate({ id: s.id, share_pct: v })
                }}
                className="h-8 w-20 text-right text-xs"
              />
              <span className="text-xs text-[var(--color-muted-foreground)]">%</span>
            </div>
          ))}
          {total !== 100 && (
            <p className="text-xs text-[var(--color-warning)]">
              Shares total {total}% — the math still distributes the profit but the
              percentages should add up to 100.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
