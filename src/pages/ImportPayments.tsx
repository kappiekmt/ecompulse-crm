import { CreditCard } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function ImportPayments() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Import Payments"
        description="Backfill historical Stripe charges or upload a CSV of past payments."
        actions={
          <Button variant="outline">
            <CreditCard className="h-4 w-4" /> Sync Stripe
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-8">
        <Card>
          <CardContent className="flex flex-col gap-3 border border-dashed border-[var(--color-border)] py-14 text-center">
            <span className="text-sm font-medium">Drop payment CSV here</span>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              Columns: lead_email, amount_cents, currency, paid_at, stripe_id (optional).
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-3 text-sm font-semibold">Sync history</h3>
            <p className="text-xs text-[var(--color-muted-foreground)]">No syncs yet.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
