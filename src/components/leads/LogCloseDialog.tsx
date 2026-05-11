import * as React from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { TIERS, type TierKey } from "@/lib/tiers"
import { useLogClose, type InstallmentInput } from "@/lib/queries/closes"
import { useAuth } from "@/lib/auth"
import { useTeamMembers } from "@/lib/queries/dashboard"
import { formatCurrency } from "@/lib/utils"

interface LogCloseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadId: string
  leadName: string
  defaultCloserId?: string | null
}

interface DraftInstallment extends InstallmentInput {
  uid: string
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() + days)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

function newDraft(seed: Partial<DraftInstallment> = {}): DraftInstallment {
  return {
    uid: crypto.randomUUID(),
    amount_cents: seed.amount_cents ?? 0,
    due_date: seed.due_date ?? todayIso(),
    paid_today: seed.paid_today ?? false,
  }
}

export function LogCloseDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  defaultCloserId,
}: LogCloseDialogProps) {
  const { profile } = useAuth()
  const closers = useTeamMembers("closer")
  const logClose = useLogClose()

  const [tier, setTier] = React.useState<TierKey>("fundament")
  const [amountEuros, setAmountEuros] = React.useState<string>("997")
  const [closerId, setCloserId] = React.useState<string>("")
  const [notes, setNotes] = React.useState<string>("")
  const [installments, setInstallments] = React.useState<DraftInstallment[]>([
    newDraft({ amount_cents: 99700, paid_today: true }),
  ])
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setError(null)
      return
    }
    const t = TIERS[0]
    setTier(t.key)
    setAmountEuros(String(t.price_cents / 100))
    setNotes("")
    setInstallments([
      newDraft({ amount_cents: t.price_cents, paid_today: true }),
    ])
    const initialCloser =
      defaultCloserId ??
      (profile?.role === "closer" || profile?.role === "admin" ? profile.id : "")
    setCloserId(initialCloser ?? "")
  }, [open, defaultCloserId, profile?.id, profile?.role])

  function pickTier(key: TierKey) {
    setTier(key)
    const t = TIERS.find((x) => x.key === key)
    if (t) {
      setAmountEuros(String(t.price_cents / 100))
      setInstallments([newDraft({ amount_cents: t.price_cents, paid_today: true })])
    }
  }

  function patchInstallment(uid: string, patch: Partial<DraftInstallment>) {
    setInstallments((prev) => prev.map((i) => (i.uid === uid ? { ...i, ...patch } : i)))
  }

  function addInstallment() {
    const last = installments[installments.length - 1]
    setInstallments((prev) => [
      ...prev,
      newDraft({
        amount_cents: 0,
        due_date: last ? addDays(last.due_date, 30) : todayIso(),
      }),
    ])
  }

  function removeInstallment(uid: string) {
    setInstallments((prev) => (prev.length > 1 ? prev.filter((i) => i.uid !== uid) : prev))
  }

  const totalCents = Math.round((parseFloat(amountEuros || "0") || 0) * 100)
  const scheduledCents = installments.reduce((s, i) => s + (i.amount_cents || 0), 0)
  const paidNowCents = installments.reduce(
    (s, i) => s + (i.paid_today ? i.amount_cents || 0 : 0),
    0
  )
  const diff = totalCents - scheduledCents

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (totalCents <= 0) {
      setError("Contract value must be greater than 0.")
      return
    }
    if (!closerId) {
      setError("Pick which closer logged this deal.")
      return
    }
    if (installments.some((i) => i.amount_cents <= 0)) {
      setError("Each installment needs an amount > €0.")
      return
    }
    if (scheduledCents !== totalCents) {
      setError(
        `Installments (${formatCurrency(scheduledCents)}) don't equal the contract value (${formatCurrency(
          totalCents
        )}).`
      )
      return
    }

    try {
      const result = await logClose.mutateAsync({
        lead_id: leadId,
        closer_id: closerId,
        tier,
        amount_cents: totalCents,
        notes: notes.trim() || null,
        installments: installments.map((i) => ({
          amount_cents: i.amount_cents,
          due_date: i.due_date,
          paid_today: i.paid_today,
        })),
      })
      if (!result.slack.ok) {
        setError(
          `Deal saved, but Slack alert failed: ${result.slack.error ?? "unknown error"}. Check the #payments webhook config.`
        )
        return
      }
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Log close — {leadName}</DialogTitle>
          <DialogDescription>
            Tier, contract value, and the custom payment schedule. Posts a deal-closed alert to
            the #payments Slack channel on save.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <DialogBody>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="close-tier">Tier</Label>
                <Select
                  id="close-tier"
                  value={tier}
                  onChange={(e) => pickTier(e.target.value as TierKey)}
                >
                  {TIERS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label} — {formatCurrency(t.price_cents)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="close-amount">Contract value (EUR)</Label>
                <Input
                  id="close-amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amountEuros}
                  onChange={(e) => setAmountEuros(e.target.value)}
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="close-closer">Closer</Label>
                <Select
                  id="close-closer"
                  value={closerId}
                  onChange={(e) => setCloserId(e.target.value)}
                >
                  <option value="">— Select closer —</option>
                  {(closers.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Payment schedule</Label>
                <Button type="button" size="sm" variant="outline" onClick={addInstallment}>
                  <Plus className="h-3.5 w-3.5" />
                  Add payment
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {installments.map((i, idx) => (
                  <div
                    key={i.uid}
                    className="grid grid-cols-[28px_1fr_1fr_auto_28px] items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 px-2 py-2"
                  >
                    <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                      #{idx + 1}
                    </span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="Amount"
                      value={i.amount_cents ? (i.amount_cents / 100).toString() : ""}
                      onChange={(e) =>
                        patchInstallment(i.uid, {
                          amount_cents: Math.round((parseFloat(e.target.value || "0") || 0) * 100),
                        })
                      }
                    />
                    <Input
                      type="date"
                      value={i.due_date}
                      onChange={(e) => patchInstallment(i.uid, { due_date: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                      <Switch
                        checked={i.paid_today}
                        onCheckedChange={(v) => patchInstallment(i.uid, { paid_today: v })}
                      />
                      Paid
                    </label>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeInstallment(i.uid)}
                      disabled={installments.length <= 1}
                      aria-label="Remove installment"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-3 gap-3 text-xs text-[var(--color-muted-foreground)]">
                <span>
                  Scheduled:{" "}
                  <span
                    className={
                      diff === 0
                        ? "font-medium text-[var(--color-foreground)]"
                        : "font-medium text-[var(--color-destructive)]"
                    }
                  >
                    {formatCurrency(scheduledCents)}
                  </span>
                </span>
                <span>
                  Paid today:{" "}
                  <span className="font-medium text-[var(--color-foreground)]">
                    {formatCurrency(paidNowCents)}
                  </span>
                </span>
                <span>
                  Outstanding:{" "}
                  <span className="font-medium text-[var(--color-foreground)]">
                    {formatCurrency(Math.max(0, totalCents - paidNowCents))}
                  </span>
                </span>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-1.5">
              <Label htmlFor="close-notes">Notes (internal — also posted to Slack)</Label>
              <Textarea
                id="close-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Special terms, discounts, anything finance should know…"
              />
            </div>

            {error && <p className="mt-3 text-xs text-[var(--color-destructive)]">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={logClose.isPending}>
              {logClose.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Log close + notify Slack
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
