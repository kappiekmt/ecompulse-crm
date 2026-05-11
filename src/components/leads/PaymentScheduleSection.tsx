import * as React from "react"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  useAddInstallment,
  useLeadDeal,
  useLeadStudent,
  useMarkInstallmentPaid,
  useRecoveryAction,
  useResumeAccess,
  type InstallmentRow,
  type InstallmentStatus,
  type RecoveryEventRow,
  type RecoveryEventType,
} from "@/lib/queries/closes"
import { useAuth } from "@/lib/auth"
import { cn, formatCurrency, formatDateTime } from "@/lib/utils"

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

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const STATUS_LABEL: Record<InstallmentStatus, string> = {
  scheduled: "Scheduled",
  paid: "Paid",
  failed: "Failed",
  recovering: "Recovering",
  written_off: "Written off",
  refunded: "Refunded",
}

function badgeVariantFor(
  status: InstallmentStatus
): "muted" | "success" | "destructive" | "warning" | "outline" {
  switch (status) {
    case "paid":
      return "success"
    case "failed":
      return "destructive"
    case "recovering":
      return "warning"
    case "written_off":
      return "outline"
    case "refunded":
      return "outline"
    default:
      return "muted"
  }
}

const EVENT_LABEL: Record<RecoveryEventType, string> = {
  overdue_detected: "Overdue detected",
  reminder_sent: "Reminder sent",
  closer_notified: "Closer notified",
  admin_escalated: "Admin escalated",
  access_paused: "Access paused",
  access_resumed: "Access resumed",
  resolved: "Resolved",
  written_off: "Written off",
  marked_recovering: "Marked recovering",
  closer_contacted_customer: "Closer contacted customer",
  closer_unable_to_reach: "Closer unable to reach",
}

const EVENT_TONE: Record<RecoveryEventType, string> = {
  overdue_detected: "text-[var(--color-warning)]",
  reminder_sent: "text-[var(--color-muted-foreground)]",
  closer_notified: "text-[var(--color-warning)]",
  admin_escalated: "text-[var(--color-destructive)]",
  access_paused: "text-[var(--color-destructive)]",
  access_resumed: "text-[var(--color-success)]",
  resolved: "text-[var(--color-success)]",
  written_off: "text-[var(--color-muted-foreground)]",
  marked_recovering: "text-[var(--color-warning)]",
  closer_contacted_customer: "text-[var(--color-success)]",
  closer_unable_to_reach: "text-[var(--color-warning)]",
}

export function PaymentScheduleSection({ leadId }: PaymentScheduleSectionProps) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === "admin"
  const deal = useLeadDeal(leadId)
  const student = useLeadStudent(leadId)
  const markPaid = useMarkInstallmentPaid()
  const addInstallment = useAddInstallment()
  const recoveryAction = useRecoveryAction()
  const resumeAccess = useResumeAccess()

  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [slackError, setSlackError] = React.useState<string | null>(null)
  const [adderOpen, setAdderOpen] = React.useState(false)
  const [newAmountEuros, setNewAmountEuros] = React.useState<string>("")
  const [newDueDate, setNewDueDate] = React.useState<string>(todayIso())
  const [newPaidNow, setNewPaidNow] = React.useState<boolean>(true)
  const [writeOffFor, setWriteOffFor] = React.useState<InstallmentRow | null>(null)
  const [writeOffReason, setWriteOffReason] = React.useState<string>("")

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
  const paid = installments.reduce(
    (s, i) => s + (i.status === "paid" ? i.amount_cents : 0),
    0
  )
  const writtenOff = installments.reduce(
    (s, i) => s + (i.status === "written_off" ? i.amount_cents : 0),
    0
  )
  const outstanding = Math.max(0, total - paid - writtenOff)
  const allPaid =
    installments.length > 0 &&
    outstanding === 0 &&
    installments.every((i) => i.status !== "failed" && i.status !== "recovering")
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0

  async function onMarkPaid(row: InstallmentRow) {
    if (!deal.data) return
    if (
      !confirm(
        `Mark installment ${row.seq} (${formatCurrency(row.amount_cents)}) as paid? This will post to #b-new-payment.`
      )
    ) {
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

  async function onMarkRecovering(row: InstallmentRow) {
    if (!deal.data) return
    const note = prompt(`Mark installment ${row.seq} as recovering — optional note:`)
    if (note === null) return
    setPendingId(row.id)
    try {
      await recoveryAction.mutateAsync({
        installment_id: row.id,
        deal_id: deal.data.id,
        lead_id: leadId,
        action: "mark_recovering",
        note: note.trim() || undefined,
      })
    } catch (err) {
      setSlackError((err as Error).message)
    } finally {
      setPendingId(null)
    }
  }

  async function onConfirmWriteOff() {
    if (!writeOffFor || !deal.data || !writeOffReason.trim()) return
    setPendingId(writeOffFor.id)
    try {
      await recoveryAction.mutateAsync({
        installment_id: writeOffFor.id,
        deal_id: deal.data.id,
        lead_id: leadId,
        action: "write_off",
        note: writeOffReason.trim(),
      })
      setWriteOffFor(null)
      setWriteOffReason("")
    } catch (err) {
      setSlackError((err as Error).message)
    } finally {
      setPendingId(null)
    }
  }

  async function onResumeAccess() {
    if (!student.data) return
    if (!confirm("Resume this student's access? They'll be flagged as reactivated.")) return
    try {
      await resumeAccess.mutateAsync({
        student_id: student.data.id,
        lead_id: leadId,
      })
    } catch (err) {
      setSlackError((err as Error).message)
    }
  }

  const isPaused = student.data?.payment_status === "paused_payment"

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

      {isPaused && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/5 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <Pause className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-destructive)]" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-[var(--color-destructive)]">
                Access paused for unpaid balance
              </span>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                Discord + Whop revoke logged as pending. Resume once they're back in good standing.
              </span>
            </div>
          </div>
          {isAdmin && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onResumeAccess}
              disabled={resumeAccess.isPending}
            >
              {resumeAccess.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Resume access
            </Button>
          )}
        </div>
      )}

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
          <span className="text-[var(--color-muted-foreground)]">{pct}%</span>
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
            const installEvents = deal.data!.events.filter(
              (e) => e.installment_id === row.id
            )
            return (
              <InstallmentCard
                key={row.id}
                row={row}
                events={installEvents}
                pendingId={pendingId}
                isAdmin={isAdmin}
                markPaidPending={markPaid.isPending}
                onMarkPaid={() => onMarkPaid(row)}
                onMarkRecovering={() => onMarkRecovering(row)}
                onWriteOff={() => {
                  setWriteOffFor(row)
                  setWriteOffReason("")
                }}
              />
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

      {writeOffFor && (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/5 px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-destructive)]">
              Write off installment #{writeOffFor.seq} · {formatCurrency(writeOffFor.amount_cents)}
            </span>
            <button
              type="button"
              onClick={() => setWriteOffFor(null)}
              aria-label="Cancel"
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Textarea
            rows={2}
            placeholder="Reason (required) — refunded, fraud, bankruptcy, agreed cancellation…"
            value={writeOffReason}
            onChange={(e) => setWriteOffReason(e.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setWriteOffFor(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onConfirmWriteOff}
              disabled={!writeOffReason.trim() || recoveryAction.isPending}
            >
              {recoveryAction.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Confirm write-off
            </Button>
          </div>
        </div>
      )}

      {!allPaid && !adderOpen && !writeOffFor && (
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

function InstallmentCard({
  row,
  events,
  pendingId,
  isAdmin,
  markPaidPending,
  onMarkPaid,
  onMarkRecovering,
  onWriteOff,
}: {
  row: InstallmentRow
  events: RecoveryEventRow[]
  pendingId: string | null
  isAdmin: boolean
  markPaidPending: boolean
  onMarkPaid: () => void
  onMarkRecovering: () => void
  onWriteOff: () => void
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(row.due_date + "T00:00:00")
  const overdueLabel =
    row.status === "scheduled" && due.getTime() < today.getTime()
      ? "overdue"
      : row.status === "scheduled" && due.getTime() === today.getTime()
        ? "due today"
        : null

  const borderClass = cn(
    "rounded-md border",
    row.status === "paid" && "border-[var(--color-border)] bg-[var(--color-muted)]/30",
    row.status === "failed" && "border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/5",
    row.status === "recovering" && "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5",
    row.status === "written_off" && "border-[var(--color-border)] bg-[var(--color-muted)]/20 opacity-70",
    row.status === "scheduled" && overdueLabel === "overdue" && "border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5",
    row.status === "scheduled" && overdueLabel === "due today" && "border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5",
    row.status === "scheduled" && !overdueLabel && "border-[var(--color-border)]"
  )

  return (
    <div className={borderClass}>
      <div className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2 text-sm">
        <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
          #{row.seq}
        </span>
        <div className="flex flex-col">
          <span
            className={cn(
              "font-medium tabular-nums",
              (row.status === "paid" || row.status === "written_off") &&
                "line-through text-[var(--color-muted-foreground)]"
            )}
          >
            {formatCurrency(row.amount_cents)}
          </span>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {fmtDate(row.due_date)}
            {overdueLabel === "overdue" && (
              <span className="ml-1.5 font-medium text-[var(--color-destructive)]">
                · overdue
              </span>
            )}
            {overdueLabel === "due today" && (
              <span className="ml-1.5 font-medium text-[var(--color-primary)]">
                · due today
              </span>
            )}
          </span>
        </div>

        <Badge variant={badgeVariantFor(row.status)} className="text-[10px]">
          {row.status === "paid" && <Check className="h-3 w-3" />}
          {row.status === "failed" && <AlertTriangle className="h-3 w-3" />}
          {row.status === "written_off" && <XCircle className="h-3 w-3" />}
          {row.status === "recovering" && <RotateCcw className="h-3 w-3" />}
          {STATUS_LABEL[row.status]}
        </Badge>

        {row.status === "paid" ? (
          <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
        ) : row.status === "written_off" ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">—</span>
        ) : (
          <div className="flex items-center gap-1">
            {(row.status === "failed" || row.status === "recovering") && isAdmin && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onMarkRecovering}
                  disabled={pendingId === row.id}
                  title="Mark recovering"
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onWriteOff}
                  disabled={pendingId === row.id}
                  title="Write off"
                  className="text-[var(--color-destructive)]"
                >
                  <XCircle className="h-3 w-3" />
                </Button>
              </>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onMarkPaid}
              disabled={pendingId === row.id || markPaidPending}
            >
              {pendingId === row.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Mark paid
            </Button>
          </div>
        )}
      </div>

      {events.length > 0 && (
        <div className="border-t border-[var(--color-border)]/60 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Recovery timeline
          </span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {events.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "flex items-center justify-between gap-2 text-xs",
                  EVENT_TONE[e.event_type]
                )}
              >
                <span>
                  {EVENT_LABEL[e.event_type]}
                  {e.actor?.full_name && (
                    <span className="text-[var(--color-muted-foreground)]">
                      {" "}
                      · {e.actor.full_name}
                    </span>
                  )}
                  {e.is_system && (
                    <span className="text-[var(--color-muted-foreground)]"> · auto</span>
                  )}
                </span>
                <span className="text-[var(--color-muted-foreground)]">
                  {formatDateTime(e.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
