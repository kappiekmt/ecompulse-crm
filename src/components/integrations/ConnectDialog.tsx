import * as React from "react"
import { ExternalLink, Loader2 } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { CopyableUrl } from "@/components/integrations/CopyableUrl"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { webhookUrlFor, type IntegrationSpec } from "@/lib/integrations"

interface ConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  spec: IntegrationSpec | null
  onSaved?: () => void
}

export function ConnectDialog({ open, onOpenChange, spec, onSaved }: ConnectDialogProps) {
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setValues({})
      setError(null)
    }
  }, [open])

  if (!spec) return null

  const webhookUrl = webhookUrlFor(spec.provider)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!spec) return
    setError(null)

    const missing = spec.fields.filter((f) => !f.optional && !values[f.key]?.trim())
    if (missing.length) {
      setError(`Missing required: ${missing.map((m) => m.label).join(", ")}`)
      return
    }

    if (!isSupabaseConfigured) {
      setError("Connect Supabase first (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).")
      return
    }

    setSubmitting(true)
    const { error: dbErr } = await supabase
      .from("integration_configs")
      .upsert(
        {
          provider: spec.provider,
          display_name: spec.displayName,
          is_connected: true,
          config: values,
          connected_at: new Date().toISOString(),
        },
        { onConflict: "provider" }
      )
    setSubmitting(false)

    if (dbErr) {
      setError(dbErr.message)
      return
    }
    onSaved?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect {spec.displayName}</DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <DialogBody>
            {webhookUrl && (
              <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-4">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Webhook URL</span>
                  <span className="text-xs text-[var(--color-muted-foreground)]">
                    Paste this into {spec.displayName} so events POST to the CRM.
                  </span>
                </div>
                <CopyableUrl value={webhookUrl} />
                {spec.webhookEvents && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                      Subscribe to:
                    </span>
                    {spec.webhookEvents.map((evt) => (
                      <Badge key={evt} variant="muted">
                        {evt}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!webhookUrl && spec.webhookPath && (
              <div className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs">
                Set <code className="font-mono">VITE_SUPABASE_URL</code> in <code className="font-mono">.env.local</code>{" "}
                to see the webhook URL.
              </div>
            )}

            <div className="flex flex-col gap-3">
              {spec.fields.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={f.key}>
                    {f.label}
                    {f.optional && (
                      <span className="ml-1 text-xs font-normal text-[var(--color-muted-foreground)]">
                        (optional)
                      </span>
                    )}
                  </Label>
                  {f.kind === "textarea" ? (
                    <Textarea
                      id={f.key}
                      placeholder={f.placeholder}
                      rows={5}
                      value={values[f.key] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <Input
                      id={f.key}
                      type={f.kind === "secret" ? "password" : "text"}
                      placeholder={f.placeholder}
                      autoComplete="off"
                      value={values[f.key] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    />
                  )}
                  {f.helper && (
                    <span className="text-xs text-[var(--color-muted-foreground)]">{f.helper}</span>
                  )}
                </div>
              ))}
            </div>

            {error && (
              <div className="rounded-md border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 p-3 text-xs text-[var(--color-destructive)]">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Save & Connect
            </Button>
            <a
              href={spec.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            >
              {spec.displayName} docs <ExternalLink className="h-3 w-3" />
            </a>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
