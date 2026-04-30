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
import { Switch } from "@/components/ui/switch"
import { supabase } from "@/lib/supabase"
import { WEBHOOK_EVENTS } from "@/lib/webhookEvents"

interface ExistingSub {
  id: string
  name: string
  target_url: string
  event_types: string[]
  signing_secret: string | null
  is_active: boolean
  description: string | null
}

interface SubscriptionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  existing?: ExistingSub | null
}

export function SubscriptionDialog({
  open,
  onOpenChange,
  onSaved,
  existing,
}: SubscriptionDialogProps) {
  const [name, setName] = React.useState("")
  const [targetUrl, setTargetUrl] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [eventTypes, setEventTypes] = React.useState<string[]>([])
  const [signingSecret, setSigningSecret] = React.useState("")
  const [isActive, setIsActive] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    if (existing) {
      setName(existing.name)
      setTargetUrl(existing.target_url)
      setDescription(existing.description ?? "")
      setEventTypes(existing.event_types)
      setSigningSecret(existing.signing_secret ?? "")
      setIsActive(existing.is_active)
    } else {
      setName("")
      setTargetUrl("")
      setDescription("")
      setEventTypes(["lead.created"])
      setSigningSecret("")
      setIsActive(true)
    }
    setError(null)
  }, [open, existing])

  function toggleEvent(key: string) {
    setEventTypes((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError("Name is required")
    if (!targetUrl.trim() || !/^https?:\/\//.test(targetUrl)) {
      return setError("Target URL must start with http:// or https://")
    }
    if (eventTypes.length === 0) return setError("Pick at least one event")

    setSubmitting(true)
    const payload = {
      name: name.trim(),
      target_url: targetUrl.trim(),
      event_types: eventTypes,
      signing_secret: signingSecret.trim() || null,
      is_active: isActive,
      description: description.trim() || null,
    }
    const { error: dbErr } = existing
      ? await supabase.from("webhook_subscriptions").update(payload).eq("id", existing.id)
      : await supabase.from("webhook_subscriptions").insert(payload)
    setSubmitting(false)
    if (dbErr) return setError(dbErr.message)
    onSaved()
    onOpenChange(false)
  }

  const grouped = React.useMemo(() => {
    const groups: Record<string, typeof WEBHOOK_EVENTS> = {}
    for (const e of WEBHOOK_EVENTS) {
      groups[e.group] = groups[e.group] ?? []
      groups[e.group].push(e)
    }
    return groups
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit subscription" : "New webhook subscription"}</DialogTitle>
          <DialogDescription>
            POST CRM events to a Zapier Catch Hook (or any URL). Each delivery is HMAC-signed when a secret is set.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <DialogBody>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sub-name">Name</Label>
              <Input
                id="sub-name"
                placeholder="e.g. Slack alert via Zapier"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sub-url">Target URL</Label>
              <Input
                id="sub-url"
                placeholder="https://hooks.zapier.com/hooks/catch/..."
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
              />
              <span className="text-xs text-[var(--color-muted-foreground)]">
                In Zapier: pick "Webhooks by Zapier" → "Catch Hook" trigger and paste the URL Zapier shows you.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sub-desc">Description (optional)</Label>
              <Textarea
                id="sub-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this Zap do downstream?"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Events to send</Label>
              <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-3">
                {Object.entries(grouped).map(([group, events]) => (
                  <div key={group} className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      {group}
                    </span>
                    {events.map((evt) => (
                      <label
                        key={evt.key}
                        className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-[var(--color-muted)]/40"
                      >
                        <input
                          type="checkbox"
                          checked={eventTypes.includes(evt.key)}
                          onChange={() => toggleEvent(evt.key)}
                          className="mt-0.5"
                        />
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-1.5 text-sm">
                            <code className="font-mono text-xs text-[var(--color-foreground)]">
                              {evt.key}
                            </code>
                            <span className="text-[var(--color-muted-foreground)]">
                              · {evt.displayName}
                            </span>
                          </span>
                          <span className="text-xs text-[var(--color-muted-foreground)]">
                            {evt.description}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sub-secret">Signing secret (optional)</Label>
              <Input
                id="sub-secret"
                type="password"
                placeholder="Any random string"
                value={signingSecret}
                onChange={(e) => setSigningSecret(e.target.value)}
              />
              <span className="text-xs text-[var(--color-muted-foreground)]">
                If set, the CRM signs each payload with HMAC-SHA256 in the{" "}
                <code className="font-mono">X-Ecompulse-Signature</code> header. Verify it on your end.
              </span>
            </div>

            <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] px-3 py-2">
              <span className="text-sm font-medium">Active</span>
              <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Active" />
            </div>

            {error && (
              <p className="text-xs text-[var(--color-destructive)]">{error}</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {existing ? "Save changes" : "Create subscription"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
