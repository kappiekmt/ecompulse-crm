import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Loader2 } from "lucide-react"
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
import { Select } from "@/components/ui/select"
import { CopyableUrl } from "@/components/integrations/CopyableUrl"
import { inviteTeamMember } from "@/lib/queries/team"
import { normalizeSlackId } from "@/lib/slack"
import type { TeamRole } from "@/lib/database.types"

interface InviteMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InviteMemberDialog({ open, onOpenChange }: InviteMemberDialogProps) {
  const qc = useQueryClient()
  const [email, setEmail] = React.useState("")
  const [fullName, setFullName] = React.useState("")
  const [role, setRole] = React.useState<TeamRole>("closer")
  const [timezone, setTimezone] = React.useState("Europe/Amsterdam")
  const [commission, setCommission] = React.useState("")
  const [capacity, setCapacity] = React.useState("")
  const [slackId, setSlackId] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [created, setCreated] = React.useState<{ email: string; password: string } | null>(null)

  React.useEffect(() => {
    if (!open) {
      setEmail("")
      setFullName("")
      setRole("closer")
      setTimezone("Europe/Amsterdam")
      setCommission("")
      setCapacity("")
      setSlackId("")
      setError(null)
      setCreated(null)
    }
  }, [open])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !fullName.trim()) {
      setError("Email and full name are required")
      return
    }
    setSubmitting(true)
    const res = await inviteTeamMember({
      email: email.trim(),
      full_name: fullName.trim(),
      role,
      timezone: timezone.trim() || undefined,
      commission_pct: commission ? Number(commission) : null,
      capacity: capacity ? Number(capacity) : null,
      slack_user_id: slackId ? normalizeSlackId(slackId) : null,
    })
    setSubmitting(false)
    if (!res.ok || !res.temp_password) {
      setError(res.error ?? "Failed to invite member")
      return
    }
    setCreated({ email: res.email!, password: res.temp_password })
    qc.invalidateQueries({ queryKey: ["team-list"] })
    qc.invalidateQueries({ queryKey: ["team-members"] })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? "Member invited" : "Invite team member"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Share these credentials with the new member. The password is shown once."
              : "Creates an auth user + team_members row. They sign in immediately at /sign-in."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <>
            <DialogBody>
              <div className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs">
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Tell them to change this password after first sign-in.
                </span>
              </div>
              <CopyableUrl label="Email" value={created.email} />
              <CopyableUrl label="Temporary password" value={created.password} />
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogBody>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label htmlFor="m-name">Full name</Label>
                  <Input
                    id="m-name"
                    autoFocus
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label htmlFor="m-email">Email</Label>
                  <Input
                    id="m-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="m-role">Role</Label>
                  <Select
                    id="m-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as TeamRole)}
                  >
                    <option value="closer">Closer</option>
                    <option value="setter">Setter</option>
                    <option value="coach">Coach</option>
                    <option value="admin">Admin</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="m-tz">Timezone</Label>
                  <Input
                    id="m-tz"
                    placeholder="Europe/Amsterdam"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="m-comm">Commission %</Label>
                  <Input
                    id="m-comm"
                    type="number"
                    step="0.1"
                    placeholder="10"
                    value={commission}
                    onChange={(e) => setCommission(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="m-cap">Capacity (calls/week)</Label>
                  <Input
                    id="m-cap"
                    type="number"
                    placeholder="20"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label htmlFor="m-slack">Slack User ID</Label>
                  <Input
                    id="m-slack"
                    placeholder="U07ABC123"
                    value={slackId}
                    onChange={(e) => setSlackId(e.target.value)}
                  />
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    Optional. In Slack: profile → ⋯ → "Copy member ID". Used to @-mention them in EOD + pre-call reminders.
                  </span>
                </div>
              </div>
              {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Send invite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
