import * as React from "react"
import { ChevronDown, ExternalLink, Loader2, Settings2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CopyableUrl } from "@/components/integrations/CopyableUrl"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { type IntegrationSpec, webhookUrlFor } from "@/lib/integrations"

interface IntegrationCardItemProps {
  spec: IntegrationSpec
  connected: boolean
  savedConfig: Record<string, string> | null
  onSaved: () => void
}

export function IntegrationCardItem({
  spec,
  connected,
  savedConfig,
  onSaved,
}: IntegrationCardItemProps) {
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<Record<string, string>>(savedConfig ?? {})
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setValues(savedConfig ?? {})
  }, [savedConfig])

  const webhookUrl = webhookUrlFor(spec.provider)
  const hasFields = spec.fields.length > 0

  async function save() {
    setSaving(true)
    setError(null)
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
    setSaving(false)
    if (dbErr) {
      setError(dbErr.message)
      return
    }
    onSaved()
  }

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-[var(--color-muted)]/40"
      >
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white",
            spec.iconBg
          )}
        >
          {spec.iconLetter}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{spec.displayName}</span>
            {connected && (
              <Badge variant="success" className="text-[10px]">
                Connected
              </Badge>
            )}
          </div>
          <span className="truncate text-sm text-[var(--color-muted-foreground)]">
            {spec.description}
          </span>
        </div>
        <a
          href={spec.openUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto"
        >
          <Button variant="default" size="sm" type="button">
            {spec.openLabel}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (hasFields || webhookUrl) && (
        <div className="flex flex-col gap-4 border-t border-[var(--color-border)] bg-[var(--color-muted)]/30 p-5">
          {webhookUrl && (
            <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  Webhook URL for {spec.displayName}
                </span>
                <Badge variant="muted" className="font-mono text-[10px]">
                  {spec.webhookPath}
                </Badge>
              </div>
              <CopyableUrl value={webhookUrl} />
              {spec.webhookEvents && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-[var(--color-muted-foreground)]">
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

          {hasFields && (
            <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div className="flex items-center gap-2">
                <Settings2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  Credentials
                </span>
              </div>
              {spec.fields.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`${spec.provider}-${f.key}`}>
                    {f.label}
                    {f.optional && (
                      <span className="ml-1 text-xs font-normal text-[var(--color-muted-foreground)]">
                        (optional)
                      </span>
                    )}
                  </Label>
                  {f.kind === "textarea" ? (
                    <Textarea
                      id={`${spec.provider}-${f.key}`}
                      placeholder={f.placeholder}
                      rows={4}
                      value={values[f.key] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <Input
                      id={`${spec.provider}-${f.key}`}
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
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {f.helper}
                    </span>
                  )}
                </div>
              ))}

              {error && (
                <p className="text-xs text-[var(--color-destructive)]">{error}</p>
              )}
              <div className="flex items-center justify-end gap-2">
                <a
                  href={spec.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mr-auto inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                >
                  Docs <ExternalLink className="h-3 w-3" />
                </a>
                <Button onClick={save} disabled={saving} size="sm">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {connected ? "Update credentials" : "Save & Connect"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
