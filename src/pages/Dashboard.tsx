import { CalendarClock, DollarSign, PhoneCall, Users } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { StatCard } from "@/components/StatCard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function Dashboard() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Dashboard"
        description="Pipeline health and team performance at a glance."
      />
      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Calls booked (7d)" value="—" icon={<CalendarClock className="h-4 w-4" />} />
          <StatCard label="Show rate" value="—" icon={<PhoneCall className="h-4 w-4" />} />
          <StatCard label="Cash collected (MTD)" value="—" icon={<DollarSign className="h-4 w-4" />} />
          <StatCard label="Active students" value="—" icon={<Users className="h-4 w-4" />} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Upcoming calls</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-[var(--color-muted-foreground)]">
              Calendly bookings will appear here once webhooks are wired up.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="muted">Calendly</Badge>
              <Badge variant="muted">Stripe</Badge>
              <Badge variant="muted">Slack</Badge>
              <Badge variant="muted">Discord</Badge>
              <Badge variant="muted">Whop</Badge>
              <Badge variant="muted">ActiveCampaign</Badge>
              <Badge variant="muted">Gmail</Badge>
              <Badge variant="muted">Google Sheets</Badge>
              <Badge variant="muted">Claude</Badge>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
