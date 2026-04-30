import * as React from "react"
import {
  CalendarX,
  CalendarClock,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { QUICK_PICK_STAGES, stageLabel } from "@/components/leads/StageBadge"
import {
  useAddPayment,
  useDeleteLead,
  useLead,
  useLeadPayments,
  useLogCallOutcome,
  useUpdateLead,
  type CallResult,
} from "@/lib/queries/leads"
import { useTeamMembers } from "@/lib/queries/dashboard"
import type { LeadStage } from "@/lib/database.types"
import { cn, formatCurrency, formatDateTime } from "@/lib/utils"
import { TIERS } from "@/lib/tiers"

interface LeadDetailDrawerProps {
  leadId: string | null
  onClose: () => void
}

export function LeadDetailDrawer({ leadId, onClose }: LeadDetailDrawerProps) {
  const open = Boolean(leadId)
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="560px">
        {leadId && <Inner leadId={leadId} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function Inner({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const lead = useLead(leadId)
  const closers = useTeamMembers("closer")
  const setters = useTeamMembers("setter")
  const payments = useLeadPayments(leadId)
  const update = useUpdateLead()
  const remove = useDeleteLead()
  const logOutcome = useLogCallOutcome()

  if (lead.isLoading) {
    return (
      <SheetBody>
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading lead…
        </div>
      </SheetBody>
    )
  }
  if (!lead.data) {
    return (
      <SheetBody>
        <p className="text-sm text-[var(--color-muted-foreground)]">Lead not found.</p>
      </SheetBody>
    )
  }

  const l = lead.data

  function patch(p: Parameters<typeof update.mutate>[0]["patch"]) {
    update.mutate({ id: l.id, patch: p })
  }

  // Map a quick-pick stage to the call_outcomes.result value (if any). Stages
  // that aren't post-call outcomes don't write to call_outcomes — they only
  // update the lead row.
  const STAGE_TO_OUTCOME: Partial<Record<LeadStage, CallResult>> = {
    showed: "showed",
    no_show: "no_show",
    won: "closed",
    lost: "lost",
  }

  function setStage(stage: LeadStage) {
    const now = new Date().toISOString()
    const extra: Record<string, string | null> = {}
    if (stage === "won" || stage === "lost") extra.closed_at = now
    if (stage === "cancelled") extra.cancelled_at = now
    patch({ stage, ...extra })

    const result = STAGE_TO_OUTCOME[stage]
    if (result) {
      logOutcome.mutate({
        leadId: l.id,
        closerId: l.closer_id,
        result,
        occurredAt: now,
      })
    }
  }

  async function deleteLead() {
    if (!confirm("Delete this lead? This is permanent.")) return
    await remove.mutateAsync(l.id)
    onClose()
  }

  return (
    <>
      <SheetHeader>
        <div className="flex items-center justify-between gap-3">
          <SheetTitle>{l.full_name}</SheetTitle>
        </div>
      </SheetHeader>

      <SheetBody>
        {/* STATUS PILLS */}
        <Section label="Status">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PICK_STAGES.map((stage) => {
              const active = l.stage === stage
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setStage(stage)}
                  disabled={update.isPending}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-foreground)] hover:text-[var(--color-foreground)]"
                  )}
                >
                  {stageLabel(stage).toLowerCase()}
                </button>
              )
            })}
          </div>
        </Section>

        {/* ASSIGNMENTS */}
        <Section label="Assignments">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Closer">
              <Select
                value={l.closer_id ?? ""}
                onChange={(e) => patch({ closer_id: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {(closers.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Setter">
              <Select
                value={l.setter_id ?? ""}
                onChange={(e) => patch({ setter_id: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {(setters.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        {/* CONTACT INFORMATION */}
        <Section label="Contact information">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <Field label="Email">
              <BlurEditable
                value={l.email ?? ""}
                placeholder="-"
                onCommit={(v) => patch({ email: v || null })}
              />
            </Field>
            <Field label="Phone">
              <BlurEditable
                value={l.phone ?? ""}
                placeholder="-"
                onCommit={(v) => patch({ phone: v || null })}
              />
            </Field>
            <Field label="Instagram">
              <BlurEditable
                value={l.instagram ?? ""}
                placeholder="-"
                onCommit={(v) => patch({ instagram: v || null })}
              />
            </Field>
            <Field label="Budget">
              <BlurEditable
                value={l.budget_cents != null ? formatCurrency(l.budget_cents) : ""}
                placeholder="-"
                onCommit={(v) => {
                  const cleaned = v.replace(/[^0-9.]/g, "")
                  if (!cleaned) return patch({ budget_cents: null })
                  const cents = Math.round(parseFloat(cleaned) * 100)
                  patch({ budget_cents: Number.isFinite(cents) ? cents : null })
                }}
              />
            </Field>
            <Field label="Tier (offer)">
              <Select
                value={l.intended_tier ?? ""}
                onChange={(e) => patch({ intended_tier: e.target.value || null })}
              >
                <option value="">— Not pitched yet —</option>
                {TIERS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label} ({formatCurrency(t.price_cents)})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        {/* CALL DETAILS */}
        <Section label="Call details">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <Readout label="Source" value={l.source ?? "-"} />
            <Readout
              label="Booked at"
              value={l.booked_at ? formatDateTime(l.booked_at) : "-"}
            />
            <Readout
              label="Scheduled"
              value={l.scheduled_at ? formatDateTime(l.scheduled_at) : "-"}
            />
            <Readout
              label="Closed at"
              value={l.closed_at ? formatDateTime(l.closed_at) : "-"}
            />
          </div>
          {(l.calendly_cancel_url || l.calendly_reschedule_url) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {l.calendly_cancel_url && (
                <a href={l.calendly_cancel_url} target="_blank" rel="noreferrer">
                  <Button variant="outline" className="w-full" type="button">
                    <CalendarX className="h-4 w-4" />
                    Cancel appointment
                  </Button>
                </a>
              )}
              {l.calendly_reschedule_url && (
                <a href={l.calendly_reschedule_url} target="_blank" rel="noreferrer">
                  <Button variant="outline" className="w-full" type="button">
                    <CalendarClock className="h-4 w-4" />
                    Reschedule
                  </Button>
                </a>
              )}
            </div>
          )}
        </Section>

        {/* PRE-CALL */}
        <Section label="Pre-call SOP">
          <div className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Pre-call started</span>
              {l.pre_call_started && l.pre_call_started_at ? (
                <span className="text-xs text-[var(--color-success)]">
                  Started {formatDateTime(l.pre_call_started_at)}
                </span>
              ) : (
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  Toggle on when the closer begins the pre-call SOP for this lead.
                </span>
              )}
            </div>
            <Switch
              checked={l.pre_call_started}
              onCheckedChange={(checked) => {
                patch({
                  pre_call_started: checked,
                  pre_call_started_at: checked ? new Date().toISOString() : null,
                })
              }}
              aria-label="Toggle pre-call started"
            />
          </div>
        </Section>

        {/* PAYMENTS */}
        <PaymentsSection
          leadId={l.id}
          payments={(payments.data ?? []) as PaymentRow[]}
          onChanged={() => qc.invalidateQueries({ queryKey: ["lead-payments", l.id] })}
        />

        {/* NOTES */}
        <Section label="Notes">
          <Textarea
            rows={3}
            placeholder="No notes added"
            defaultValue={l.notes ?? ""}
            onBlur={(e) => {
              const v = e.target.value
              if (v !== (l.notes ?? "")) patch({ notes: v || null })
            }}
          />
        </Section>
      </SheetBody>

      <SheetFooter>
        <button
          type="button"
          onClick={deleteLead}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-destructive)] hover:underline"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete this lead
        </button>
      </SheetFooter>
    </>
  )
}

interface PaymentRow {
  id: string
  amount_cents: number
  currency: string
  paid_at: string
  source: string
  is_refund: boolean
  notes: string | null
}

function PaymentsSection({
  leadId,
  payments,
  onChanged,
}: {
  leadId: string
  payments: PaymentRow[]
  onChanged: () => void
}) {
  const add = useAddPayment()
  const [adding, setAdding] = React.useState(false)
  const [amount, setAmount] = React.useState("")
  const [notes, setNotes] = React.useState("")

  const total = payments.reduce(
    (sum, p) => sum + (p.is_refund ? -p.amount_cents : p.amount_cents),
    0
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const cents = Math.round(parseFloat(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) return
    await add.mutateAsync({
      leadId,
      amount_cents: cents,
      notes: notes.trim() || null,
    })
    setAmount("")
    setNotes("")
    setAdding(false)
    onChanged()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Payments
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>

      {!adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center justify-center gap-1 rounded-md py-2 text-xs font-medium text-[var(--color-primary)] hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add payment
        </button>
      )}

      {adding && (
        <form onSubmit={submit} className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="Amount (EUR)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={add.isPending}>
              {add.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save payment
            </Button>
          </div>
        </form>
      )}

      {payments.length === 0 && !adding && (
        <p className="text-center text-xs text-[var(--color-muted-foreground)]">
          No payments recorded
        </p>
      )}

      {payments.length > 0 && (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="flex flex-col">
                <span className="font-medium tabular-nums">
                  {p.is_refund ? "-" : ""}
                  {formatCurrency(Math.abs(p.amount_cents))}
                </span>
                {p.notes && (
                  <span className="text-xs text-[var(--color-muted-foreground)]">{p.notes}</span>
                )}
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {formatDateTime(p.paid_at)}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  {p.source}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        {label}
      </span>
      {children}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--color-muted-foreground)]">{label}</span>
      {children}
    </div>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--color-muted-foreground)]">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

/** A field that edits in place, commits on blur or Enter. */
function BlurEditable({
  value,
  placeholder,
  onCommit,
}: {
  value: string
  placeholder?: string
  onCommit: (v: string) => void
}) {
  const [local, setLocal] = React.useState(value)
  React.useEffect(() => setLocal(value), [value])
  return (
    <Input
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        if (e.key === "Escape") {
          setLocal(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className="border-transparent bg-transparent px-0 shadow-none focus-visible:border-[var(--color-input)] focus-visible:bg-[var(--color-background)] focus-visible:px-3"
    />
  )
}
