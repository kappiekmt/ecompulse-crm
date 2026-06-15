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

interface DraftFuture {
  uid: string
  amount_cents: number
  due_date: string
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

function newFuture(seed: Partial<DraftFuture> = {}): DraftFuture {
  return {
    uid: crypto.randomUUID(),
    amount_cents: seed.amount_cents ?? 0,
    due_date: seed.due_date ?? addDays(todayIso(), 30),
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
  const [contractEuros, setContractEuros] = React.useState<string>("997")
  const [paidNowEuros, setPaidNowEuros] = React.useState<string>("997")
  const [closerId, setCloserId] = React.useState<string>("")
  const [notes, setNotes] = React.useState<string>("")
  const [future, setFuture] = React.useState<DraftFuture[]>([])
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setError(null)
      return
    }
    const t = TIERS[0]
    setTier(t.key)
    setContractEuros(String(t.price_cents / 100))
    setPaidNowEuros(String(t.price_cents / 100))
    setNotes("")
    setFuture([])
    const isCloserOrAdmin =
      profile?.roles?.some((r) => r === "closer" || r === "admin") ?? false
    const initialCloser = defaultCloserId ?? (isCloserOrAdmin ? profile?.id : "")
    setCloserId(initialCloser ?? "")
  }, [open, defaultCloserId, profile?.id, profile?.roles])

  function pickTier(key: TierKey) {
    setTier(key)
    const t = TIERS.find((x) => x.key === key)
    if (t) {
      setContractEuros(String(t.price_cents / 100))
      setPaidNowEuros(String(t.price_cents / 100))
      setFuture([])
    }
  }

  function patchFuture(uid: string, patch: Partial<DraftFuture>) {
    setFuture((prev) => prev.map((i) => (i.uid === uid ? { ...i, ...patch } : i)))
  }

  function addFuturePayment() {
    const last = future[future.length - 1]
    setFuture((prev) => [
      ...prev,
      newFuture({
        amount_cents: 0,
        due_date: last ? addDays(last.due_date, 30) : addDays(todayIso(), 30),
      }),
    ])
  }

  function removeFuturePayment(uid: string) {
    setFuture((prev) => prev.filter((i) => i.uid !== uid))
  }

  const contractCents = Math.round((parseFloat(contractEuros || "0") || 0) * 100)
  const paidNowCents = Math.round((parseFloat(paidNowEuros || "0") || 0) * 100)
  const scheduledCents = future.reduce((s, i) => s + (i.amount_cents || 0), 0)
  const outstandingCents = Math.max(0, contractCents - paidNowCents - scheduledCents)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (contractCents <= 0) {
      setError("Contract value must be greater than 0.")
      return
    }
    if (!closerId) {
      setError("Pick which closer logged this deal.")
      return
    }
    if (paidNowCents < 0) {
      setError("Paid at close cannot be negative.")
      return
    }
    if (future.some((i) => i.amount_cents <= 0)) {
      setError("Scheduled payments need an amount > €0.")
      return
    }
    if (paidNowCents + scheduledCents > contractCents) {
      setError(
        `Paid + scheduled (${formatCurrency(paidNowCents + scheduledCents)}) exceeds the contract value (${formatCurrency(contractCents)}).`
      )
      return
    }

    const installments: InstallmentInput[] = []
    if (paidNowCents > 0) {
      installments.push({
        amount_cents: paidNowCents,
        due_date: todayIso(),
        paid_today: true,
      })
    }
    for (const f of future) {
      installments.push({
        amount_cents: f.amount_cents,
        due_date: f.due_date,
        paid_today: false,
      })
    }

    try {
      const result = await logClose.mutateAsync({
        lead_id: leadId,
        closer_id: closerId,
        tier,
        amount_cents: contractCents,
        notes: notes.trim() || null,
        installments,
      })
      if (!result.slack.ok) {
        setError(
          `Deal saved, but Slack alert failed: ${result.slack.error ?? "unknown error"}.`
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
            Record the tier, contract value, and what the lead paid right now. Schedule the
            rest later from the lead's Payment schedule section. Posts to #b-new-payment on
            save.
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="close-contract">Contract value (EUR)</Label>
                <Input
                  id="close-contract"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={contractEuros}
                  onChange={(e) => setContractEuros(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="close-paid-now">Paid at close (EUR)</Label>
                <Input
                  id="close-paid-now"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={paidNowEuros}
                  onChange={(e) => setPaidNowEuros(e.target.value)}
                />
                <span className="text-[10px] text-[var(--color-muted-foreground)]">
                  What the lead actually paid today. Leave equal to contract value if PIF.
                </span>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Scheduled future payments (optional)</Label>
                <Button type="button" size="sm" variant="outline" onClick={addFuturePayment}>
                  <Plus className="h-3.5 w-3.5" />
                  Add scheduled payment
                </Button>
              </div>
              {future.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-3 text-center text-xs text-[var(--color-muted-foreground)]">
                  {outstandingCents > 0
                    ? `${formatCurrency(outstandingCents)} outstanding — leave blank to track later, or add scheduled payments now.`
                    : "No future payments — paid in full at close."}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {future.map((i, idx) => (
                    <div
                      key={i.uid}
                      className="grid grid-cols-[28px_1fr_1fr_28px] items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 px-2 py-2"
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
                          patchFuture(i.uid, {
                            amount_cents: Math.round(
                              (parseFloat(e.target.value || "0") || 0) * 100
                            ),
                          })
                        }
                      />
                      <Input
                        type="date"
                        value={i.due_date}
                        onChange={(e) => patchFuture(i.uid, { due_date: e.target.value })}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeFuturePayment(i.uid)}
                        aria-label="Remove scheduled payment"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-1 grid grid-cols-3 gap-3 text-xs text-[var(--color-muted-foreground)]">
                <span>
                  Paid at close:{" "}
                  <span className="font-medium text-[var(--color-foreground)]">
                    {formatCurrency(paidNowCents)}
                  </span>
                </span>
                <span>
                  Scheduled:{" "}
                  <span className="font-medium text-[var(--color-foreground)]">
                    {formatCurrency(scheduledCents)}
                  </span>
                </span>
                <span>
                  Outstanding:{" "}
                  <span className="font-medium text-[var(--color-foreground)]">
                    {formatCurrency(outstandingCents)}
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
