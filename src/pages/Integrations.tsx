import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ConnectDialog } from "@/components/integrations/ConnectDialog"
import { ApiKeysPanel } from "@/components/integrations/ApiKeysPanel"
import { CopyableUrl } from "@/components/integrations/CopyableUrl"
import { INTEGRATION_SPECS, webhookUrlFor, type IntegrationSpec } from "@/lib/integrations"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"

interface IntegrationConfigRow {
  provider: string
  is_connected: boolean
  display_name: string | null
  connected_at: string | null
  last_synced_at: string | null
}

export function Integrations() {
  const qc = useQueryClient()
  const [active, setActive] = React.useState<IntegrationSpec | null>(null)

  const { data: configs } = useQuery<Record<string, IntegrationConfigRow>>({
    queryKey: ["integration-configs"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_configs")
        .select("provider, is_connected, display_name, connected_at, last_synced_at")
      if (error) throw error
      const map: Record<string, IntegrationConfigRow> = {}
      for (const row of data ?? []) map[row.provider] = row as IntegrationConfigRow
      return map
    },
  })

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Integrations"
        description="Connect every tool from the EcomPulse automation flow. Each connection logs to integrations_log for retries and debugging."
      />
      <div className="flex flex-col gap-6 p-8">
        <ApiKeysPanel />

        <WebhookUrlsCard />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {INTEGRATION_SPECS.map((spec) => {
            const config = configs?.[spec.provider]
            const connected = config?.is_connected
            return (
              <Card key={spec.provider}>
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{spec.displayName}</span>
                        <Badge variant={connected ? "success" : "muted"}>
                          {connected ? "Connected" : "Not connected"}
                        </Badge>
                        {spec.webhookPath && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            webhook
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        {spec.description}
                      </p>
                    </div>
                    <Button variant={connected ? "outline" : "default"} size="sm" onClick={() => setActive(spec)}>
                      {connected ? "Manage" : "Connect"}
                    </Button>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
                    <a
                      href={spec.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-[var(--color-foreground)]"
                    >
                      Docs <ExternalLink className="h-3 w-3" />
                    </a>
                    {connected && config?.connected_at && (
                      <span>Connected {new Date(config.connected_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      <ConnectDialog
        open={Boolean(active)}
        onOpenChange={(o) => !o && setActive(null)}
        spec={active}
        onSaved={() => qc.invalidateQueries({ queryKey: ["integration-configs"] })}
      />
    </div>
  )
}

function WebhookUrlsCard() {
  const inboundSpecs = INTEGRATION_SPECS.filter((s) => s.webhookPath)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Inbound Webhook URLs</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Paste these into the matching service so events POST into the CRM. Resolved from your Supabase project URL.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {inboundSpecs.map((spec) => {
            const url = webhookUrlFor(spec.provider)
            return (
              <div
                key={spec.provider}
                className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{spec.displayName}</span>
                  <Badge variant="muted" className="font-mono text-[10px]">
                    {spec.webhookPath}
                  </Badge>
                </div>
                {url ? (
                  <CopyableUrl value={url} />
                ) : (
                  <span className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                    Set Supabase URL to resolve
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
