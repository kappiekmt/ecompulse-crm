import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const TRACKS = [
  {
    name: "Booking flow",
    triggers: "Calendly → CRM → Slack",
    description: "Lead booked → closer assigned → Slack alert + 15-min reminder.",
    status: "Pending wiring",
  },
  {
    name: "Onboarding chain",
    triggers: "Stripe → Discord → Whop → Slack",
    description: "Payment success → Discord invite → Whop access → coach assigned and notified.",
    status: "Pending wiring",
  },
  {
    name: "Nurture & downsell",
    triggers: "ActiveCampaign",
    description: "Pre-call SOP nudges, value content sequence, post-call followup or downsell.",
    status: "Pending wiring",
  },
  {
    name: "Finance log",
    triggers: "Stripe → Sheets",
    description: "Every payment auto-logged. Closer/setter commission calculated.",
    status: "Pending wiring",
  },
]

export function Automations() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Automations"
        description="The four tracks from your flowchart, mapped to integration jobs."
      />
      <div className="grid grid-cols-1 gap-4 p-8 md:grid-cols-2">
        {TRACKS.map((t) => (
          <Card key={t.name}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{t.name}</CardTitle>
                  <CardDescription>{t.triggers}</CardDescription>
                </div>
                <Badge variant="muted">{t.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-[var(--color-muted-foreground)]">
              {t.description}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
