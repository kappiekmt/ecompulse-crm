import * as React from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { useLogCallOutcome, type CallResult } from "@/lib/queries/leads"

const RESULTS: { value: CallResult; label: string }[] = [
  { value: "showed", label: "Showed" },
  { value: "no_show", label: "No-show" },
  { value: "pitched", label: "Pitched" },
  { value: "closed", label: "Closed (won)" },
  { value: "lost", label: "Lost" },
  { value: "rescheduled", label: "Rescheduled" },
]

export function LogCallOutcomeForm({
  leadId,
  closerId,
}: {
  leadId: string
  closerId: string | null
}) {
  const log = useLogCallOutcome()
  const [result, setResult] = React.useState<CallResult>("showed")
  const [reason, setReason] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [occurredAt, setOccurredAt] = React.useState(() =>
    new Date().toISOString().slice(0, 16)
  )
  const [success, setSuccess] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSuccess(false)
    await log.mutateAsync({
      leadId,
      closerId,
      result,
      occurredAt: new Date(occurredAt).toISOString(),
      reason: reason.trim() || null,
      notes: notes.trim() || null,
    })
    setReason("")
    setNotes("")
    setSuccess(true)
    setTimeout(() => setSuccess(false), 2000)
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Result</Label>
          <Select value={result} onChange={(e) => setResult(e.target.value as CallResult)}>
            {RESULTS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Occurred at</Label>
          <Input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">
          Reason <span className="text-[var(--color-muted-foreground)]">(optional)</span>
        </Label>
        <Input
          placeholder="e.g. price, timing, fit"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">
          Notes <span className="text-[var(--color-muted-foreground)]">(optional)</span>
        </Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex items-center justify-end gap-2">
        {success && (
          <span className="text-xs text-[var(--color-success)]">✓ Logged. Stage updated.</span>
        )}
        <Button type="submit" size="sm" disabled={log.isPending}>
          {log.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Log outcome
        </Button>
      </div>
    </form>
  )
}
