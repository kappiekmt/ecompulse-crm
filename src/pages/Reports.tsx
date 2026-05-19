import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { CallStatsCard } from "@/components/calls/CallStatsCard"

export function Reports() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reports"
        description="Funnel conversion, closer/setter leaderboards, UTM performance."
      />
      <div className="flex flex-col gap-6 p-8">
        <CallStatsCard
          heading="Closer scorecards"
          description="Last 30 days of recorded calls. Close rate uses tagged outcomes only."
        />
        <Card>
          <CardContent className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
            Funnel + UTM charts are part of phase 2.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
