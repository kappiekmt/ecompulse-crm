import { useQuery, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/PageHeader"
import { WebhookEndpointCard } from "@/components/integrations/WebhookEndpointCard"
import { AutomationsCard } from "@/components/integrations/AutomationsCard"
import { IntegrationCardItem } from "@/components/integrations/IntegrationCardItem"
import { ApiKeysPanel } from "@/components/integrations/ApiKeysPanel"
import { WebhookSubscriptionsPanel } from "@/components/integrations/WebhookSubscriptionsPanel"
import { INTEGRATION_SPECS } from "@/lib/integrations"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"

interface IntegrationConfigRow {
  provider: string
  is_connected: boolean
  display_name: string | null
  config: Record<string, string> | null
}

export function Integrations() {
  const qc = useQueryClient()

  const { data: configs } = useQuery<Record<string, IntegrationConfigRow>>({
    queryKey: ["integration-configs"],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_configs")
        .select("provider, is_connected, display_name, config")
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
        description="Connect your tools in a few clicks."
      />
      <div className="flex flex-col gap-5 p-8">
        <WebhookEndpointCard />
        <WebhookSubscriptionsPanel />
        <AutomationsCard />

        <div className="flex flex-col gap-3">
          {INTEGRATION_SPECS.map((spec) => {
            const cfg = configs?.[spec.provider]
            return (
              <IntegrationCardItem
                key={spec.provider}
                spec={spec}
                connected={Boolean(cfg?.is_connected)}
                savedConfig={cfg?.config ?? null}
                onSaved={() => qc.invalidateQueries({ queryKey: ["integration-configs"] })}
              />
            )
          })}
        </div>

        <ApiKeysPanel />
      </div>
    </div>
  )
}
