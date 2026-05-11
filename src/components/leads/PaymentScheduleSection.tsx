import * as React from "react"
import { Check, CheckCircle2, Loader2, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  useAddInstallment,
  useLeadDeal,
  useMarkInstallmentPaid,
  type InstallmentRow,
} from "@/lib/queries/closes"
import { cn, formatCurrency } from "@/lib/utils"

interface PaymentScheduleSectionProps {
  leadId: string
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z")
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function statusOf(row: InstallmentRow): "paid" | "due_today" | "overdue" | "upcoming" {
  if (row.paid_at) return "paid"
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(row.due_date + "T00:00:00")
  if (due.getTime() < today.getTime()) return "overdue"
  if (due.getTime() === today.getTime()) return "due_today"
  return "upcoming"
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function PaymentScheduleSection({ leadId }: PaymentScheduleSectionProps) {
  const deal = useLeadDeal(leadId)
  const markPaid = useMarkInstallmentPaid()
  const addInstallment = useAddInstallment()
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [slackError, setSlackError] = React.useState<string | null>(null)
  const [adderOpen, setAdderOpen] = React.useState(false)
  const [newAmountEuros, setNewAmountEuros] = React.useState<string>("")
  const [newDueDate, setNewDueDate] = React.useState<string>(todayIso())
  const [newPaidNow, setNewPaidNow] = React.useState<boolean>(true)

  if (deal.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Payment schedule
        </span>
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-3 text-xs text-[var(--color-muted-foreground)]">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      </div>
    )
  }

  if (!deal.data) return null

  const installments = deal.data.installments
  const total = deal.data.amount_cents ?? 0
  const paid = installments.reduce((s, i) => s + (i.paid_at ? i.amount_cents : 0), 0)
  const outstanding = Math.max(0, total - paid)
  const allPaid = installments.length > 0 && outstanding === 0

  async function onMarkPaid(row: InstallmentRow) {
    if (!deal.data) return
    if (!confirm(`Mark installment ${row.seq} (${formatCurrency(row.amount_cents)}) as paid? This will post to #b-new-payment.`)) {
      return
    }
    setPendingId(row.id)
    setSlackError(null)
    try {
      const r = await markPaid.mutateAsync({
        installment_id: row.id,
        lead_id: leadId,
        deal_id: deal.data.id,
        amount_cents: row.amount_cents,
      })
      if (!r.slack.ok) {
        setSlackError(
          `Payment saved, but Slack alert failed: ${r.slack.error ?? "unknown error"}.`
        )
      }
    } catch (err) {
      setSlackError((err as Error).message)
    } finally {
      setPendingId(null)
    }
  }

  async function onAddInstallment(e: React.FormEvent) {
    e.preventDefault()
    if (!deal.data) return
    const amountCents = Math.round((parseFloat(newAmountEuros || "0") || 0) * 100)
    if (amountCents <= 0) {
      setSlackError("Amount must be greater than 0.")
      return
    }
    setSlackError(null)
    try {
      const r = await addInstallment.mutateAsync({
        deal_id: deal.data.id,
        lead_id: leadId,
        amount_cents: amountCents,
        due_date: newDueDate,
        paid_now: newPaidNow,
      })
      if (!r.slack.ok) {
        setSlackError(
          `Saved, but Slack alert failed: ${r.slack.error ?? "unknown error"}.`
        )
      }
      setNewAmountEuros("")
      setNewDueDate(todayIso())
      setNewPaidNow(true)
      setAdderOpen(false)
    } catch (err) {
      setSlackError((err as Error).message)
    }
  }

  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Payment schedule
        </span>
        {allPaid && (
          <Badge variant="success" className="text-[10px]">
            <Check className="h-3 w-3" />
            Fully paid
          </Badge>
        )}
      </div>

      {/* Summary block: contract, progress bar, paid / remaining */}
      <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-[var(--color-muted-foreground)]">Contract</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatCurrency(total)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
          <div
            className={cn(
              "h-full transition-all",
              allPaid ? "bg-[var(--color-success)]" : "bg-[var(--color-primary)]"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-[var(--color-muted-foreground)]">
            <span className="font-medium text-[var(--color-foreground)]">
              {formatCurrency(paid)}
            </span>{" "}
            paid
          </span>
          <span className="text-[var(--color-muted-foreground)]">
            {pct}%
          </span>
          <span className="text-[var(--color-muted-foreground)]">
            <span className="font-medium text-[var(--color-foreground)]">
              {formatCurrency(outstanding)}
            </span>{" "}
            outstanding
          </span>
        </div>
      </div>

      {installments.length === 0 ? (
        <p className="text-center text-xs text-[var(--color-muted-foreground)]">
          No payments recorded yet for this deal.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {installments.map((row) => {
            const status = statusOf(row)
            return (
              <div
                key={row.id}
                className={cn(
                  "grid grid-cols-[28px_1fr_1fr_auto] items-center gap-2 rounded-md border px-3 py-2 text-sm",
                  status === "paid" &&
                    "border-[var(--color-border)] bg-[var(--color-muted)]/30 text-[var(--color-muted-foreground)] line-through",
                  status === "overdue" && "border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/5",
                  status === "due_today" && "border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5",
                  status === "upcoming" && "border-[var(--color-border)]"
                )}
              >
                <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                  #{row.seq}
                </span>
                <span className="font-medium">{formatCurrency(row.amount_cents)}</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {fmtDate(row.due_date)}
                  {status === "overdue" && (
                    <span className="ml-1.5 font-medium text-[var(--color-destructive)]">
                      · overdue
                    </span>
                  )}
                  {status === "due_today" && (
                    <span className="ml-1.5 font-medium text-[var(--color-primary)]">
                      · due today
                    </span>
                  )}
                </span>
                {status === "paid" ? (
                  <CheckCircle2 className="h-4 w-4 text-[var(--color-success,_currentColor)]" />
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onMarkPaid(row)}
                    disabled={pendingId === row.id || markPaid.isPending}
                  >
                    {pendingId === row.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    Mark paid
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {adderOpen && (
        <form
          onSubmit={onAddInstallment}
          className="flex flex-col gap-2 rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5 px-3 py-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Add payment
            </span>
            <button
              type="button"
              onClick={() => setAdderOpen(false)}
              aria-label="Cancel"
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Amount (EUR)"
              value={newAmountEuros}
              onChange={(e) => setNewAmountEuros(e.target.value)}
            />
            <Input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
              <Switch checked={newPaidNow} onCheckedChange={setNewPaidNow} />
              Paid now
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdderOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={addInstallment.isPending}>
              {addInstallment.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {newPaidNow ? "Record payment + notify Slack" : "Schedule"}
            </Button>
          </div>
        </form>
      )}

      {!allPaid && !adderOpen && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setAdderOpen(true)}
          className="w-full"
        >
          <Plus className="h-3.5 w-3.5" />
          Add payment
        </Button>
      )}

      {slackError && (
        <p className="text-xs text-[var(--color-destructive)]">{slackError}</p>
      )}
    </div>
  )
}
