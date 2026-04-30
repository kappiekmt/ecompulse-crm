import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ExternalLink, Loader2, Sparkles, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { supabase } from "@/lib/supabase"

interface CalendlyAutoSetupProps {
  /** Existing config so we can show the current state. */
  savedConfig: Record<string, string> | null
  /** Called after a successful setup so the parent can refetch. */
  onSetupComplete: () => void
}

interface SetupResult {
  ok?: boolean
  account_email?: string
  subscription_uri?: string
  callback_url?: string
  events?: string[]
  error?: string
}

export function CalendlyAutoSetup({ savedConfig, onSetupComplete }: CalendlyAutoSetupProps) {
  const qc = useQueryClient()
  const [pat, setPat] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [result, setResult] = React.useState<SetupResult | null>(null)

  const isConnected = Boolean(savedConfig?.subscription_uri && savedConfig?.signing_key)

  async function runSetup() {
    if (!pat.trim()) {
      setResult({ ok: false, error: "Paste your Calendly Personal Access Token first." })
      return
    }
    setSubmitting(true)
    setResult(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const jwt = sess.session?.access_token
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendly-setup`
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ personal_access_token: pat.trim() }),
      })
      const json = (await res.json()) as SetupResult
      if (!res.ok || !json.ok) {
        setResult({ ok: false, error: json.error ?? `HTTP ${res.status}` })
      } else {
        setResult(json)
        setPat("")
        qc.invalidateQueries({ queryKey: ["integration-configs"] })
        onSetupComplete()
      }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 text-[var(--color-primary)]" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">One-click webhook setup</span>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              Paste a Calendly Personal Access Token. We'll create the webhook
              subscription on your behalf and store the signing key.
            </span>
          </div>
        </div>
        {isConnected && (
          <Badge variant="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Connected
          </Badge>
        )}
      </div>

      {isConnected && savedConfig && (
        <div className="flex flex-col gap-1 rounded-md bg-[var(--color-card)] p-3 text-xs">
          {savedConfig.account_email && (
            <Row label="Account">{savedConfig.account_email}</Row>
          )}
          <Row label="Webhook">
            <code className="font-mono text-[10px]">{savedConfig.subscription_uri}</code>
          </Row>
          <Row label="Events">
            <span className="font-mono text-[10px]">invitee.created · invitee.canceled</span>
          </Row>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cal-pat">Personal Access Token</Label>
        <div className="flex items-center gap-2">
          <Input
            id="cal-pat"
            type="password"
            placeholder="eyJraWQiOi…"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            autoComplete="off"
          />
          <Button onClick={runSetup} disabled={submitting || !pat.trim()}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isConnected ? "Re-provision" : "Set up webhook"}
          </Button>
        </div>
        <a
          href="https://calendly.com/integrations/api_webhooks"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          Get a token at calendly.com/integrations/api_webhooks → Personal access tokens
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {result?.ok && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 p-3 text-xs">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-success)]" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">Connected as {result.account_email}.</span>
            <span className="text-[var(--color-muted-foreground)]">
              New Calendly bookings will land in /leads automatically. Cancellations flip the
              lead to "cancelled".
            </span>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-destructive)]" />
          <span>{result.error}</span>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className="truncate text-right">{children}</span>
    </div>
  )
}
