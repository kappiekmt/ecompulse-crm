import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
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
import { RoleCheckboxes } from "@/components/team/RoleCheckboxes"
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
  const [roles, setRoles] = React.useState<TeamRole[]>(["closer"])
  const [timezone, setTimezone] = React.useState("Europe/Amsterdam")
  const [commission, setCommission] = React.useState("")
  const [capacity, setCapacity] = React.useState("")
  const [slackId, setSlackId] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [sent, setSent] = React.useState<{
    email: string
    password: string
    emailed: boolean
    reset: boolean
    signInUrl: string
  } | null>(null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setEmail("")
      setFullName("")
      setRoles(["closer"])
      setTimezone("Europe/Amsterdam")
      setCommission("")
      setCapacity("")
      setSlackId("")
      setError(null)
      setSent(null)
      setCopied(false)
    }
  }, [open])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !fullName.trim()) {
      setError("Email and full name are required")
      return
    }
    if (roles.length === 0) {
      setError("Pick at least one role")
      return
    }
    setSubmitting(true)
    const res = await inviteTeamMember({
      email: email.trim(),
      full_name: fullName.trim(),
      roles,
      timezone: timezone.trim() || undefined,
      commission_pct: commission ? Number(commission) : null,
      capacity: capacity ? Number(capacity) : null,
      slack_user_id: slackId ? normalizeSlackId(slackId) : null,
    })
    setSubmitting(false)
    if (!res.ok) {
      setError(res.error ?? "Failed to create account")
      return
    }
    setSent({
      email: res.email!,
      password: res.password ?? "",
      emailed: res.emailed ?? false,
      reset: res.reset ?? false,
      signInUrl: res.sign_in_url ?? "",
    })
    qc.invalidateQueries({ queryKey: ["team-list"] })
    qc.invalidateQueries({ queryKey: ["team-members"] })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {sent ? (sent.reset ? "Access re-issued" : "Account created") : "Add team member"}
          </DialogTitle>
          <DialogDescription>
            {sent
              ? sent.emailed
                ? "We emailed them their login. The password is also shown below in case you want to send it yourself."
                : "Copy the temporary password below and send it to them. They sign in with their email + this password."
              : "We create their account with a temporary password. Send it to them → they sign in → done. No email link required."}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <>
            <DialogBody>
              <div className="flex flex-col gap-1.5">
                <Label>Email</Label>
                <code className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 font-mono text-sm">
                  {sent.email}
                </code>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Temporary password</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 font-mono text-sm tracking-wide">
                    {sent.password}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(sent.password)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
              {sent.emailed ? (
                <div className="rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 p-3 text-xs">
                  ✓ We also emailed these credentials to {sent.email}.
                </div>
              ) : (
                <a
                  href={`mailto:${sent.email}?subject=${encodeURIComponent(
                    "Your EcomPulse CRM login"
                  )}&body=${encodeURIComponent(
                    `Hi,\n\nYour EcomPulse CRM account is ready.\n\nSign in: ${sent.signInUrl}\nEmail: ${sent.email}\nTemporary password: ${sent.password}\n\nPlease change your password after your first sign-in.`
                  )}`}
                  className="text-xs font-medium text-[var(--color-primary)] underline"
                >
                  Open a pre-filled email to {sent.email} →
                </a>
              )}
              <p className="text-xs text-[var(--color-muted-foreground)]">
                They sign in at <span className="font-mono">{sent.signInUrl}</span> with the email
                and password above. This password is only shown once.
              </p>
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
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label>Roles</Label>
                  <RoleCheckboxes value={roles} onChange={setRoles} />
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    Pick one or more — e.g. someone who both books and closes can be Setter + Closer.
                  </span>
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
                Create account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
