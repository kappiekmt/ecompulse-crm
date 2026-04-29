import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"

export function Finance() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Finance"
        description="Cash collected, refunds, commission splits, and Sheets export."
      />
      <div className="p-8">
        <Card>
          <CardContent className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
            Stripe-driven revenue ledger will populate here once webhooks are connected.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
