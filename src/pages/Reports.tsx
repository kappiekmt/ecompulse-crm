import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"

export function Reports() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reports"
        description="Funnel conversion, closer/setter leaderboards, UTM performance."
      />
      <div className="p-8">
        <Card>
          <CardContent className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
            Reports build out in phase 2. Funnel + leaderboard charts coming next.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
