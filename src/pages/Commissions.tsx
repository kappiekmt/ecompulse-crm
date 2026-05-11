import * as React from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  Download,
  Loader2,
  Pencil,
  Send,
  Wallet,
} from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@/lib/auth"
import {
  useProcessPayout,
  useTeamCommissionSummary,
  useUpdateCommissionRate,
  type CloserCommissionSummary,
} from "@/lib/queries/commissions"
import { supabase } from "@/lib/supabase"
import { cn, formatCurrency, formatDateTime } from "@/lib/utils"
import type { CommissionRecord } from "@/lib/queries/commissions"

export function Commissions() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === "admin"
  const team = useTeamCommissionSummary()

  const [editing, setEditing] = React.useState<CloserCommissionSummary | null>(null)
  const [payingOut, setPayingOut] = React.useState<CloserCommissionSummary | null>(null)

  if (!isAdmin) {
    return (
      <div className="flex flex-col">
        <PageHeader
          title="Commissions"
          description="Per-closer earnings + payout management — admins only."
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

  const rows = team.data ?? []
  const totals = rows.reduce(
    (acc, r) => ({
      pending: acc.pending + r.pending_payout_cents,
      mtd: acc.mtd + r.commission_mtd_cents,
      lifetime_earned: acc.lifetime_earned + r.lifetime_earned_cents,
      lifetime_paid: acc.lifetime_paid + r.lifetime_paid_out_cents,
    }),
    { pending: 0, mtd: 0, lifetime_earned: 0, lifetime_paid: 0 }
  )

  async function exportLedgerCsv() {
    const { data } = await supabase
      .from("commission_records")
      .select(
        "earned_at, status, payment_amount_cents, commission_rate, commission_amount_cents, " +
          "paid_out_at, payout_reference, " +
          "closer:team_members!commission_records_closer_id_fkey(full_name), " +
          "lead:leads(full_name, email), " +
          "deal:deals(coaching_tier)"
      )
      .order("earned_at", { ascending: false })
    const records = (data ?? []) as unknown as (CommissionRecord & {
      closer: { full_name: string } | null
    })[]
    const rows = records.map((r) => [
      new Date(r.earned_at).toISOString(),
      r.status,
      r.closer?.full_name ?? "",
      r.lead?.full_name ?? "",
      r.deal?.coaching_tier ?? "",
      (r.payment_amount_cents / 100).toFixed(2),
      r.commission_rate,
      (r.commission_amount_cents / 100).toFixed(2),
      r.paid_out_at ? new Date(r.paid_out_at).toISOString() : "",
      r.payout_reference ?? "",
    ])
    const header = [
      "earned_at",
      "status",
      "closer",
      "lead",
      "tier",
      "payment_eur",
      "rate_pct",
      "commission_eur",
      "paid_out_at",
      "payout_reference",
    ]
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((v) => {
            const s = String(v ?? "")
            return s.includes(",") || s.includes('"')
              ? `"${s.replaceAll('"', '""')}"`
              : s
          })
          .join(",")
      )
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `commission-ledger-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Commissions"
        description="Per-closer earnings, payouts, rate management."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportLedgerCsv}>
              <Download className="h-4 w-4" />
              Export ledger CSV
            </Button>
            <Link to="/team">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" />
                Team
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <KpiCard label="Pending payout (all)" value={formatCurrency(totals.pending)} />
          <KpiCard label="Earned MTD" value={formatCurrency(totals.mtd)} />
          <KpiCard label="Lifetime earned" value={formatCurrency(totals.lifetime_earned)} />
          <KpiCard label="Lifetime paid out" value={formatCurrency(totals.lifetime_paid)} />
        </div>

        <Card>
          <CardContent className="p-0">
            {team.isLoading ? (
              <div className="flex items-center gap-2 p-10 text-sm text-[var(--color-muted-foreground)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading commissions…
              </div>
            ) : rows.length === 0 ? (
              <p className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
                No closers/admins with commission records yet.
              </p>
            ) : (
              <table className="w-full">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/30 text-left text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  <tr>
                    <th className="px-3 py-2">Closer</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2 text-right">Cash MTD</th>
                    <th className="px-3 py-2 text-right">Earned MTD</th>
                    <th className="px-3 py-2 text-right">Pending</th>
                    <th className="px-3 py-2 text-right">Lifetime earned</th>
                    <th className="px-3 py-2 text-right">Lifetime paid</th>
                    <th className="px-3 py-2">Last payout</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {rows.map((r) => (
                    <tr key={r.closer_id}>
                      <td className="px-3 py-2 font-medium">{r.full_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.commission_rate}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(r.cash_mtd_cents)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--color-success)]">
                        {formatCurrency(r.commission_mtd_cents)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.pending_payout_cents > 0 ? (
                          <Badge variant="warning" className="text-[10px]">
                            {formatCurrency(r.pending_payout_cents)}
                          </Badge>
                        ) : (
                          <span className="text-[var(--color-muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(r.lifetime_earned_cents)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(r.lifetime_paid_out_cents)}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                        {r.last_payout_at ? formatDateTime(r.last_payout_at) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            title="Edit rate"
                            onClick={() => setEditing(r)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            title="Process payout"
                            disabled={r.pending_payout_cents === 0}
                            onClick={() => setPayingOut(r)}
                          >
                            <Send className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {editing && (
        <EditRateDialog closer={editing} onClose={() => setEditing(null)} />
      )}
      {payingOut && (
        <ProcessPayoutDialog
          closer={payingOut}
          onClose={() => setPayingOut(null)}
        />
      )}
    </div>
  )
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
          <Wallet className="h-4 w-4" />
          {label}
        </div>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  )
}

function EditRateDialog({
  closer,
  onClose,
}: {
  closer: CloserCommissionSummary
  onClose: () => void
}) {
  const update = useUpdateCommissionRate()
  const [rate, setRate] = React.useState(String(closer.commission_rate))
  const [error, setError] = React.useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const n = parseFloat(rate)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setError("Rate must be between 0 and 100.")
      return
    }
    try {
      await update.mutateAsync({ closer_id: closer.closer_id, new_rate: n })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit commission rate · {closer.full_name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <DialogBody>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rate">New rate (%)</Label>
              <Input
                id="rate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                autoFocus
              />
              <span className="text-xs text-[var(--color-muted-foreground)]">
                Past commission_records keep their snapshot rate. Only future
                payments use the new value.
              </span>
            </div>
            {error && (
              <p className="mt-2 text-xs text-[var(--color-destructive)]">{error}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProcessPayoutDialog({
  closer,
  onClose,
}: {
  closer: CloserCommissionSummary
  onClose: () => void
}) {
  const payout = useProcessPayout()
  const [records, setRecords] = React.useState<CommissionRecord[]>([])
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [reference, setReference] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("commission_records")
        .select(
          "id, payment_amount_cents, commission_amount_cents, earned_at, lead:leads(full_name)"
        )
        .eq("closer_id", closer.closer_id)
        .eq("status", "earned")
        .order("earned_at", { ascending: true })
      const rs = (data ?? []) as unknown as CommissionRecord[]
      setRecords(rs)
      setSelected(new Set(rs.map((r) => r.id)))
      setLoading(false)
    })()
  }, [closer.closer_id])

  const total = records
    .filter((r) => selected.has(r.id))
    .reduce((s, r) => s + r.commission_amount_cents, 0)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (selected.size === 0) {
      setError("Pick at least one record.")
      return
    }
    if (!reference.trim()) {
      setError("Payout reference required (bank transfer ID, Wise reference, etc.)")
      return
    }
    try {
      await payout.mutateAsync({
        closer_id: closer.closer_id,
        record_ids: [...selected],
        payout_reference: reference.trim(),
      })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Process payout · {closer.full_name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <DialogBody>
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-xs text-[var(--color-muted-foreground)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading earned records…
              </div>
            ) : records.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--color-muted-foreground)]">
                No earned records to pay out.
              </p>
            ) : (
              <>
                <div className="max-h-80 overflow-y-auto rounded-md border border-[var(--color-border)]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[var(--color-muted)]/30 text-left text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      <tr>
                        <th className="w-8 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected.size === records.length}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? new Set(records.map((r) => r.id))
                                  : new Set()
                              )
                            }
                          />
                        </th>
                        <th className="px-3 py-2">Earned</th>
                        <th className="px-3 py-2">Lead</th>
                        <th className="px-3 py-2 text-right">Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {records.map((r) => (
                        <tr key={r.id}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selected.has(r.id)}
                              onChange={(e) => {
                                setSelected((prev) => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(r.id)
                                  else next.delete(r.id)
                                  return next
                                })
                              }}
                            />
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {formatDateTime(r.earned_at)}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {r.lead?.full_name ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCurrency(r.commission_amount_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-[var(--color-muted-foreground)]">
                    {selected.size} of {records.length} selected
                  </span>
                  <span className="font-semibold tabular-nums">
                    Total: {formatCurrency(total)}
                  </span>
                </div>
                <div className="mt-4 flex flex-col gap-1.5">
                  <Label htmlFor="ref">Payout reference</Label>
                  <Input
                    id="ref"
                    placeholder="Bank transfer ID, Wise ref, etc."
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
              </>
            )}
            {error && (
              <p className="mt-2 text-xs text-[var(--color-destructive)]">{error}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={payout.isPending || selected.size === 0}
              className={cn(payout.isPending && "opacity-50")}
            >
              {payout.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Mark {selected.size} paid out
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
