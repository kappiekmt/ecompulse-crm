import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link as LinkIcon, Loader2, RefreshCw, AlertTriangle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CopyableUrl } from "@/components/integrations/CopyableUrl"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { generateApiKey } from "@/lib/apiKey"
import { inboundLeadWebhookUrl } from "@/lib/integrations"

interface ActiveKey {
  id: string
  name: string
  prefix: string
  status: "active" | "revoked"
  created_at: string
}

export function WebhookEndpointCard() {
  const qc = useQueryClient()
  const [generating, setGenerating] = React.useState(false)
  const [revealed, setRevealed] = React.useState<string | null>(null)

  const { data: activeKey, isLoading } = useQuery<ActiveKey | null>({
    queryKey: ["active-api-key"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data } = await supabase
        .from("api_keys_safe_v")
        .select("id, name, prefix, status, created_at")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      return (data as ActiveKey | null) ?? null
    },
  })

  const webhookUrl = inboundLeadWebhookUrl()

  async function generate() {
    setGenerating(true)
    setRevealed(null)
    const generated = await generateApiKey()
    const { error } = await supabase.from("api_keys").insert({
      name: "Default webhook key",
      prefix: generated.prefix,
      hashed_key: generated.hashedKey,
      scopes: ["lead.create", "payment.create"],
    })
    setGenerating(false)
    if (error) {
      alert(`Failed to create key: ${error.message}`)
      return
    }
    setRevealed(generated.plaintext)
    qc.invalidateQueries({ queryKey: ["active-api-key"] })
    qc.invalidateQueries({ queryKey: ["api-keys"] })
  }

  return (
    <Card className="border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5">
      <CardContent className="flex flex-col gap-5 p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            <LinkIcon className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Your Webhook Endpoint</span>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              Single URL + API key for inbound leads from Zapier, landing pages, partners.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-[80px_1fr] items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
            URL
          </span>
          {webhookUrl ? (
            <CopyableUrl value={webhookUrl} />
          ) : (
            <span className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
              Set Supabase URL to resolve
            </span>
          )}

          <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted-foreground)]">
            API Key
          </span>
          <div className="flex items-center gap-2">
            {revealed ? (
              <CopyableUrl value={revealed} />
            ) : isLoading ? (
              <span className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </span>
            ) : activeKey ? (
              <CopyableUrl value={`${activeKey.prefix} ••••••••••••••••`} />
            ) : (
              <span className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                No key yet — generate one to enable inbound calls.
              </span>
            )}
            <Button
              size="sm"
              variant={activeKey ? "outline" : "default"}
              onClick={generate}
              disabled={generating || !isSupabaseConfigured}
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {activeKey ? "Rotate" : "Generate"}
            </Button>
          </div>
        </div>

        {revealed && (
          <div className="flex items-start gap-2 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Save this key now — it won't be shown again. Treat it like a password. Use it as{" "}
              <code className="font-mono">Authorization: Bearer …</code>.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
