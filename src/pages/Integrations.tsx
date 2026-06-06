import * as React from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDownToLine, ArrowUpFromLine, Plug, ToggleRight, ArrowRight, type LucideIcon } from "lucide-react"
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

/** A labelled group on the Integrations page: icon + title + one-line "what
 *  this is for", with an optional header action (e.g. a link to another tab). */
function Section({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border)] pb-2">
        <div className="flex items-start gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-secondary)] text-[var(--color-foreground)]">
            <Icon className="h-4 w-4" />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold leading-tight">{title}</h2>
            <p className="max-w-2xl text-xs text-[var(--color-muted-foreground)]">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
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
        description="Everything that connects to your CRM — data coming in, the tools it talks to, and events going out."
      />
      <div className="flex flex-col gap-10 p-8">
        {/* 1 — INBOUND: data into the CRM. The webhook URL + API key (Bearer) live here. */}
        <Section
          icon={ArrowDownToLine}
          title="1 · Inbound — get leads & bookings into the CRM"
          description="Your landing pages, ad lead-forms and Zapier push data here. POST to the Events URL below with an `event` field (booked / cancelled / lead / payment), authenticated with the API key as a Bearer token."
        >
          <WebhookEndpointCard />
          <ApiKeysPanel />
        </Section>

        {/* 2 — CONNECTED TOOLS: per-provider credentials. */}
        <Section
          icon={Plug}
          title="2 · Connected tools — services your CRM works with"
          description="Credentials for the apps the CRM reads from or notifies — Calendly, Slack, Stripe, Discord and more. Click one to connect or update it."
        >
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
        </Section>

        {/* 3 — OUTBOUND: forward CRM events to other apps. */}
        <Section
          icon={ArrowUpFromLine}
          title="3 · Outbound — forward CRM events to other apps"
          description="When something happens in the CRM (call booked, payment received…), forward it to a Zapier / Make / n8n Catch Hook."
        >
          <WebhookSubscriptionsPanel />
        </Section>

        {/* 4 — SWITCHES: enable/disable automations. Live health lives on /automations. */}
        <Section
          icon={ToggleRight}
          title="Automation switches"
          description="Turn individual CRM automations on or off. Changes save instantly."
          action={
            <Link
              to="/automations"
              className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-[var(--color-primary)] hover:underline"
            >
              Live health &amp; tests <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <AutomationsCard />
        </Section>
      </div>
    </div>
  )
}
