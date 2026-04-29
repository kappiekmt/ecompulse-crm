import { CalendarClock, AlertTriangle, ListChecks, MessageCircle } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const PANELS = [
  {
    title: "Today's Calls",
    description: "Bookings happening today, with pre-call SOP status and lead context.",
    icon: CalendarClock,
  },
  {
    title: "Action Queue",
    description: "Stuck deals, missing onboarding steps, no-shows to follow up, refunds to process.",
    icon: ListChecks,
  },
  {
    title: "Stuck Automations",
    description: "Failed Slack/Discord/Whop calls that need a manual retry.",
    icon: AlertTriangle,
  },
  {
    title: "Inbox",
    description: "DM and IG threads waiting on a closer or setter response.",
    icon: MessageCircle,
  },
]

export function CommandCenter() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Command Center"
        description="The single screen managers, closers, and setters open first thing in the morning."
      />
      <div className="grid grid-cols-1 gap-4 p-8 md:grid-cols-2">
        {PANELS.map((p) => (
          <Card key={p.title}>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-secondary)]">
                  <p.icon className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                </span>
                <CardTitle>{p.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-[var(--color-muted-foreground)]">
              {p.description}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
