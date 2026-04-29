import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface Integration {
  name: string
  description: string
  status: "connected" | "disconnected"
  category: "booking" | "payment" | "messaging" | "community" | "marketing" | "data" | "ai"
}

const INTEGRATIONS: Integration[] = [
  {
    name: "Calendly",
    description: "New strategy-call booking webhooks → create lead, assign closer.",
    status: "disconnected",
    category: "booking",
  },
  {
    name: "Stripe",
    description: "Payment success → start onboarding chain. Refund webhooks → flag deal.",
    status: "disconnected",
    category: "payment",
  },
  {
    name: "Slack",
    description: "Booking alerts, 15-min reminders, coach DMs, finance updates.",
    status: "disconnected",
    category: "messaging",
  },
  {
    name: "Discord",
    description: "Auto-invite student to community, assign role per program.",
    status: "disconnected",
    category: "community",
  },
  {
    name: "Whop",
    description: "Create membership, grant program access on payment.",
    status: "disconnected",
    category: "community",
  },
  {
    name: "ActiveCampaign",
    description: "Add to nurture list, tag by stage, trigger downsell sequences.",
    status: "disconnected",
    category: "marketing",
  },
  {
    name: "Gmail",
    description: "Pre-call confirmations, onboarding emails, manual follow-ups.",
    status: "disconnected",
    category: "messaging",
  },
  {
    name: "Google Sheets",
    description: "Mirror finance ledger for the accountant.",
    status: "disconnected",
    category: "data",
  },
  {
    name: "Instagram",
    description: "Pull DMs into IG Chat, attribute to leads, reply from CRM.",
    status: "disconnected",
    category: "messaging",
  },
  {
    name: "Claude API",
    description: "Lead enrichment, message drafting, summarization.",
    status: "disconnected",
    category: "ai",
  },
]

export function Integrations() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Integrations"
        description="Connect every tool from the EcomPulse automation flow. Each one logs to integrations_log for retries and debugging."
      />
      <div className="grid grid-cols-1 gap-3 p-8 md:grid-cols-2">
        {INTEGRATIONS.map((i) => (
          <Card key={i.name}>
            <CardContent className="flex items-start justify-between gap-3 p-5">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{i.name}</span>
                  <Badge variant={i.status === "connected" ? "success" : "muted"}>
                    {i.status === "connected" ? "Connected" : "Not connected"}
                  </Badge>
                </div>
                <p className="text-sm text-[var(--color-muted-foreground)]">{i.description}</p>
              </div>
              <Button variant="outline" size="sm">
                {i.status === "connected" ? "Manage" : "Connect"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
