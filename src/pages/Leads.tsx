import { Plus } from "lucide-react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function Leads() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Leads"
        description="Every lead from Calendly bookings, ad funnels, and manual entry."
        actions={
          <Button>
            <Plus className="h-4 w-4" /> Add lead
          </Button>
        }
      />
      <div className="p-8">
        <Card>
          <CardContent className="p-10 text-center text-sm text-[var(--color-muted-foreground)]">
            No leads yet. Wire up Calendly webhook to start populating this list.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
