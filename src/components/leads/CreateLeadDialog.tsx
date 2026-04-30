import * as React from "react"
import { Loader2 } from "lucide-react"
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
import { useCreateLead } from "@/lib/queries/leads"
import { useTeamMembers } from "@/lib/queries/dashboard"
import { ALL_LEAD_STAGES } from "@/components/leads/StageBadge"
import type { LeadStage } from "@/lib/database.types"

interface CreateLeadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateLeadDialog({ open, onOpenChange }: CreateLeadDialogProps) {
  const create = useCreateLead()
  const closers = useTeamMembers("closer")
  const setters = useTeamMembers("setter")

  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [instagram, setInstagram] = React.useState("")
  const [stage, setStage] = React.useState<LeadStage>("new")
  const [closerId, setCloserId] = React.useState("")
  const [setterId, setSetterId] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setName("")
      setEmail("")
      setPhone("")
      setInstagram("")
      setStage("new")
      setCloserId("")
      setSetterId("")
      setNotes("")
      setError(null)
    }
  }, [open])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError("Full name is required")
      return
    }
    try {
      await create.mutateAsync({
        full_name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        instagram: instagram.trim() || null,
        stage,
        closer_id: closerId || null,
        setter_id: setterId || null,
        notes: notes.trim() || null,
      })
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add lead</DialogTitle>
          <DialogDescription>Manual entry. Calendly bookings and API leads create rows automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <DialogBody>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="lead-name">Full name</Label>
                <Input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-email">Email</Label>
                <Input id="lead-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-phone">Phone</Label>
                <Input id="lead-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-ig">Instagram</Label>
                <Input id="lead-ig" value={instagram} onChange={(e) => setInstagram(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-stage">Stage</Label>
                <Select id="lead-stage" value={stage} onChange={(e) => setStage(e.target.value as LeadStage)}>
                  {ALL_LEAD_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-closer">Closer</Label>
                <Select id="lead-closer" value={closerId} onChange={(e) => setCloserId(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {(closers.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-setter">Setter</Label>
                <Select id="lead-setter" value={setterId} onChange={(e) => setSetterId(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {(setters.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="lead-notes">Notes</Label>
                <Textarea id="lead-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
