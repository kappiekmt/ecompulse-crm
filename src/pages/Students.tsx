import { PageHeader } from "@/components/PageHeader"
import { Card, CardContent } from "@/components/ui/card"

export function Students() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Students"
        description="Active enrollments, coach assignments, and onboarding progress."
      />
      <div className="p-8">
        <Card>
          <CardContent className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
            Students appear here once a lead converts via Stripe payment.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
