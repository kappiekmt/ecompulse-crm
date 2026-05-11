import * as React from "react"
import { Check, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useLeadDeal, useMarkInstallmentPaid, type InstallmentRow } from "@/lib/queries/closes"
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

export function PaymentScheduleSection({ leadId }: PaymentScheduleSectionProps) {
  const deal = useLeadDeal(leadId)
  const markPaid = useMarkInstallmentPaid()
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [slackError, setSlackError] = React.useState<string | null>(null)

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

  return (
    <div className="flex flex-col gap-2">
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

      {installments.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-3 text-center text-xs text-[var(--color-muted-foreground)]">
          No installments recorded for this deal.
        </div>
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

      <div className="mt-1 grid grid-cols-3 gap-3 text-xs text-[var(--color-muted-foreground)]">
        <span>
          Contract:{" "}
          <span className="font-medium text-[var(--color-foreground)]">
            {formatCurrency(total)}
          </span>
        </span>
        <span>
          Paid:{" "}
          <span className="font-medium text-[var(--color-foreground)]">
            {formatCurrency(paid)}
          </span>
        </span>
        <span>
          Outstanding:{" "}
          <span
            className={cn(
              "font-medium",
              outstanding > 0
                ? "text-[var(--color-foreground)]"
                : "text-[var(--color-muted-foreground)]"
            )}
          >
            {formatCurrency(outstanding)}
          </span>
        </span>
      </div>

      {slackError && (
        <p className="text-xs text-[var(--color-destructive)]">{slackError}</p>
      )}
    </div>
  )
}
